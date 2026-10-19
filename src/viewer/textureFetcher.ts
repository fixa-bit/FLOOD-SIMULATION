import * as THREE from 'three';
import { BoundingBox } from '../core/types';
import { getOptimalZoomForBounds, lonLatToTile } from '../core/terrain/geoUtils';

export type TextureMode = 'satellite' | 'osm' | 'hillshade';

const ESRI_SATELLITE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
const OSM_TILE_URL = 'https://tile.openstreetmap.org';

/**
 * Fetch and stitch map or satellite tiles into a single Three.js CanvasTexture.
 */
export async function loadDrapedTexture(
  bounds: BoundingBox,
  mode: TextureMode,
  targetSize = 1024,
  onProgress?: (text: string) => void
): Promise<THREE.CanvasTexture | null> {
  if (mode === 'hillshade') {
    return null; // Hillshade is rendered procedurally in the shader
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Base background while loading
  ctx.fillStyle = mode === 'satellite' ? '#2f4838' : '#e2e8f0';
  ctx.fillRect(0, 0, targetSize, targetSize);

  onProgress?.(`Loading draped ${mode === 'satellite' ? 'satellite' : 'map'} imagery...`);

  const zoom = Math.min(14, getOptimalZoomForBounds(bounds, targetSize / 4));
  const topLeft = lonLatToTile(bounds.west, bounds.north, zoom);
  const bottomRight = lonLatToTile(bounds.east, bounds.south, zoom);

  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);

  // Fetch tiles
  const fetchPromises: Promise<void>[] = [];
  let successfulTiles = 0;

  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const url =
        mode === 'satellite'
          ? `${ESRI_SATELLITE_URL}/${zoom}/${ty}/${tx}`
          : `${OSM_TILE_URL}/${zoom}/${tx}/${ty}.png`;

      const p = new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          // Calculate destination rectangle on canvas
          const n = Math.pow(2, zoom);
          const tileWest = (tx / n) * 360 - 180;
          const tileEast = ((tx + 1) / n) * 360 - 180;
          const tileNorthRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n)));
          const tileSouthRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 1)) / n)));
          const tileNorth = (tileNorthRad * 180) / Math.PI;
          const tileSouth = (tileSouthRad * 180) / Math.PI;

          // Normalize to [0, 1] relative to bounds
          const u0 = (tileWest - bounds.west) / (bounds.east - bounds.west);
          const u1 = (tileEast - bounds.west) / (bounds.east - bounds.west);
          const v0 = (bounds.north - tileNorth) / (bounds.north - bounds.south);
          const v1 = (bounds.north - tileSouth) / (bounds.north - bounds.south);

          const destX = u0 * targetSize;
          const destY = v0 * targetSize;
          const destW = (u1 - u0) * targetSize;
          const destH = (v1 - v0) * targetSize;

          ctx.drawImage(img, destX, destY, destW, destH);
          successfulTiles++;
          resolve();
        };
        img.onerror = () => resolve(); // Ignore individual tile failures
        img.src = url;
      });

      fetchPromises.push(p);
    }
  }

  // Timeout after 5 seconds to avoid waiting forever
  await Promise.race([
    Promise.all(fetchPromises),
    new Promise((r) => setTimeout(r, 5000)),
  ]);

  // If no tiles succeeded (offline), generate procedural texture
  if (successfulTiles === 0) {
    drawProceduralSatelliteTexture(ctx, targetSize);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;

  return texture;
}

/**
 * Procedural satellite imagery fallback (vegetation patterns, agricultural patchwork, riverbed)
 */
function drawProceduralSatelliteTexture(ctx: CanvasRenderingContext2D, size: number) {
  // Base earthy background
  ctx.fillStyle = '#42543e';
  ctx.fillRect(0, 0, size, size);

  // Field plots
  const gridSize = 32;
  const step = size / gridSize;
  const hues = ['#4d6148', '#5b6b47', '#6c774b', '#7c6d48', '#384d33', '#495e3a'];

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      ctx.fillStyle = hues[(gx * 7 + gy * 13) % hues.length];
      ctx.fillRect(gx * step, gy * step, step - 1, step - 1);
    }
  }

  // Soft river sands
  ctx.strokeStyle = '#c2b280';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(size * 0.45, 0);
  ctx.bezierCurveTo(size * 0.55, size * 0.3, size * 0.4, size * 0.7, size * 0.52, size);
  ctx.stroke();
}
