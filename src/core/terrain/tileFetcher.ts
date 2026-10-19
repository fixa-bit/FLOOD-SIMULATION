import { BoundingBox, DataSource, DemData } from '../types';
import { decodeTerrariumPixel } from './demDecoder';
import {
  calculateBoundsDimensions,
  getOptimalZoomForBounds,
  lonLatToTile,
} from './geoUtils';
import { generateCacheKey, getCachedDem, setCachedDem } from './cache';
import { fillDepressions } from './pitFiller';

const AWS_TERRARIUM_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

/**
 * Fetch an image element or ImageBitmap from URL with retry support.
 */
async function fetchTileImage(url: string, retries = 2): Promise<ImageBitmap | HTMLImageElement | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) {
        if (response.status === 404) return null; // Tile not found, treat as sea level
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      if (typeof createImageBitmap !== 'undefined') {
        return await createImageBitmap(blob);
      } else if (typeof Image !== 'undefined') {
        return await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Image decode error'));
          img.src = URL.createObjectURL(blob);
        });
      }
    } catch {
      if (attempt === retries) {
        // Return null to trigger fallback
        return null;
      }
      // Wait before retry
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
    }
  }
  return null;
}

/**
 * Extract RGBA pixel data from an ImageBitmap or HTMLImageElement.
 */
function extractImageData(
  image: ImageBitmap | HTMLImageElement,
  size = 256
): Uint8ClampedArray | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, size, size);
      return ctx.getImageData(0, 0, size, size).data;
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, size, size);
      return ctx.getImageData(0, 0, size, size).data;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Procedural fallback DEM generator when offline or network fails.
 * Generates a realistic mountain valley terrain with a natural river bed.
 */
export function generateSyntheticDem(
  _bounds: BoundingBox,
  targetWidth: number,
  targetHeight: number,
  baseElevation = 320
): Float32Array {
  const size = targetWidth * targetHeight;
  const elevations = new Float32Array(size);

  for (let y = 0; y < targetHeight; y++) {
    const ny = y / (targetHeight - 1); // 0 (north) to 1 (south)
    for (let x = 0; x < targetWidth; x++) {
      const nx = x / (targetWidth - 1); // 0 (west) to 1 (east)

      // Overall slope from North/North-West down to South/South-East
      const regionalSlope = (1.0 - ny) * 80.0 + (1.0 - nx) * 30.0;

      // Meandering river channel path through the center
      const channelCenter = 0.5 + Math.sin(ny * Math.PI * 3.5) * 0.18 + Math.cos(ny * Math.PI * 1.5) * 0.08;
      const distToChannel = Math.abs(nx - channelCenter);

      // Valley profile: U-shaped valley floor with steeper walls
      const valleyShape = Math.min(1.0, distToChannel * 3.5);
      const valleyHeight = Math.pow(valleyShape, 1.8) * 95.0;

      // Channel trough
      const inChannel = Math.max(0, 1.0 - distToChannel * 18.0);
      const channelDepth = inChannel * 6.5;

      // Realistic hills/ridges noise
      const ridge1 = Math.sin(nx * 12.0 + ny * 8.0) * 8.0;
      const ridge2 = Math.cos(nx * 24.0 - ny * 16.0) * 4.0;
      const fineNoise = Math.sin(nx * 48.0) * Math.cos(ny * 48.0) * 1.5;

      const elev = baseElevation + regionalSlope + valleyHeight - channelDepth + ridge1 + ridge2 + fineNoise;
      elevations[y * targetWidth + x] = Math.max(1.0, elev);
    }
  }

  return elevations;
}

/**
 * Main terrain loader:
 * 1. Checks IndexedDB cache for instant reloads.
 * 2. Determines optimal slippy tile zoom and coordinate bounds.
 * 3. Fetches AWS Terrarium PNG tiles in parallel.
 * 4. Stitches and resamples to target grid resolution (256x256 or 512x512).
 * 5. Runs depression/pit filling algorithm.
 * 6. Stores in IndexedDB cache and returns processed DemData.
 */
export async function fetchAndProcessDem(
  bounds: BoundingBox,
  targetResolution: 256 | 512 = 256,
  onProgress?: (progressPercent: number, stageText: string) => void
): Promise<DemData> {
  const cacheKey = generateCacheKey(
    bounds.west,
    bounds.south,
    bounds.east,
    bounds.north,
    targetResolution
  );

  onProgress?.(10, 'Checking local terrain cache...');
  const cached = await getCachedDem(cacheKey);
  const cachedElevations = cached?.elevation;

  const { widthMeters, heightMeters } = calculateBoundsDimensions(bounds);
  const dx = widthMeters / (targetResolution - 1);
  const dy = heightMeters / (targetResolution - 1);

  if (cachedElevations && cachedElevations.length === targetResolution * targetResolution) {
    onProgress?.(100, 'Loaded terrain from cache');
    let minE = Infinity;
    let maxE = -Infinity;
    for (let i = 0; i < cachedElevations.length; i++) {
      const e = cachedElevations[i];
      if (e < minE) minE = e;
      if (e > maxE) maxE = e;
    }
    return {
      width: targetResolution,
      height: targetResolution,
      bounds,
      dx,
      dy,
      elevation: cachedElevations,
      minElevation: minE,
      maxElevation: maxE,
      source: cached!.source,
    };
  }

  onProgress?.(25, 'Calculating tile footprint...');
  const zoom = getOptimalZoomForBounds(bounds, targetResolution);

  const topLeft = lonLatToTile(bounds.west, bounds.north, zoom);
  const bottomRight = lonLatToTile(bounds.east, bounds.south, zoom);

  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);

  const numTilesX = maxX - minX + 1;
  const numTilesY = maxY - minY + 1;
  const totalTiles = numTilesX * numTilesY;

  // Safeguard: if totalTiles is too large (e.g. > 16 tiles), adjust zoom down
  const safeZoom = totalTiles > 16 ? zoom - 1 : zoom;

  const adjTopLeft = lonLatToTile(bounds.west, bounds.north, safeZoom);
  const adjBottomRight = lonLatToTile(bounds.east, bounds.south, safeZoom);
  const tileMinX = Math.min(adjTopLeft.x, adjBottomRight.x);
  const tileMaxX = Math.max(adjTopLeft.x, adjBottomRight.x);
  const tileMinY = Math.min(adjTopLeft.y, adjBottomRight.y);
  const tileMaxY = Math.max(adjTopLeft.y, adjBottomRight.y);

  onProgress?.(40, `Fetching ${ (tileMaxX - tileMinX + 1) * (tileMaxY - tileMinY + 1) } terrain elevation tiles...`);

  // Fetch all tiles
  const tileMap = new Map<string, Uint8ClampedArray | null>();
  const fetchPromises: Promise<void>[] = [];

  for (let ty = tileMinY; ty <= tileMaxY; ty++) {
    for (let tx = tileMinX; tx <= tileMaxX; tx++) {
      const tileUrl = `${AWS_TERRARIUM_BASE}/${safeZoom}/${tx}/${ty}.png`;
      const key = `${tx}_${ty}`;

      const p = (async () => {
        const img = await fetchTileImage(tileUrl);
        if (img) {
          const pixels = extractImageData(img, 256);
          tileMap.set(key, pixels);
        } else {
          tileMap.set(key, null);
        }
      })();

      fetchPromises.push(p);
    }
  }

  await Promise.all(fetchPromises);

  // Check how many tiles succeeded
  let validTileCount = 0;
  for (const pixels of tileMap.values()) {
    if (pixels) validTileCount++;
  }

  let rawElevations: Float32Array;
  const tileCount = tileMap.size;
  const source: DataSource = validTileCount === 0
    ? { kind: 'synthetic', label: 'Synthetic terrain — demo model', details: 'Elevation tiles were unavailable. This generated valley does not represent the selected location.' }
    : validTileCount < tileCount
      ? { kind: 'mixed', label: 'Terrain includes synthetic elevation patches', details: `${tileCount - validTileCount} of ${tileCount} tiles unavailable; missing samples were replaced with 50 m elevations.` }
      : { kind: 'remote', label: 'AWS Terrarium elevation tiles', details: 'Resampled and depression-filled terrain.' };

  // If network failed completely or no tiles returned (e.g. offline / mock test)
  if (validTileCount === 0) {
    onProgress?.(70, 'Using terrain model fallback...');
    rawElevations = generateSyntheticDem(bounds, targetResolution, targetResolution);
  } else {
    onProgress?.(70, 'Stitching and resampling elevation raster...');
    rawElevations = new Float32Array(targetResolution * targetResolution);

    // Resample each grid cell using bilinear sampling from the fetched tiles
    for (let gy = 0; gy < targetResolution; gy++) {
      const v = gy / (targetResolution - 1);
      const lat = bounds.north - v * (bounds.north - bounds.south);

      for (let gx = 0; gx < targetResolution; gx++) {
        const u = gx / (targetResolution - 1);
        const lon = bounds.west + u * (bounds.east - bounds.west);

        // Find which tile contains this point
        const n = Math.pow(2, safeZoom);
        const tileExactX = ((lon + 180) / 360) * n;
        const latRad = (lat * Math.PI) / 180;
        const tileExactY =
          ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

        const tx = Math.floor(tileExactX);
        const ty = Math.floor(tileExactY);

        const pixels = tileMap.get(`${tx}_${ty}`);
        let elev = 0;

        if (pixels) {
          // Pixel coordinate within the 256x256 tile
          const px = Math.min(255, Math.max(0, Math.floor((tileExactX - tx) * 256)));
          const py = Math.min(255, Math.max(0, Math.floor((tileExactY - ty) * 256)));
          const offset = (py * 256 + px) * 4;
          const r = pixels[offset];
          const g = pixels[offset + 1];
          const b = pixels[offset + 2];
          elev = decodeTerrariumPixel(r, g, b);
        } else {
          // Approximate boundary tile or sea level
          elev = 50.0;
        }

        rawElevations[gy * targetResolution + gx] = elev;
      }
    }
  }

  onProgress?.(85, 'Filling terrain depressions and pits...');
  const processedElevations = fillDepressions(rawElevations, targetResolution, targetResolution);

  // Calculate min and max elevation
  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let i = 0; i < processedElevations.length; i++) {
    const val = processedElevations[i];
    if (val < minElev) minElev = val;
    if (val > maxElev) maxElev = val;
  }

  // Cache in IndexedDB
  await setCachedDem(cacheKey, processedElevations, source);
  onProgress?.(100, 'Terrain ready');

  return {
    width: targetResolution,
    height: targetResolution,
    bounds,
    dx,
    dy,
    elevation: processedElevations,
    minElevation: minElev,
    maxElevation: maxElev,
    source,
  };
}
