import { BoundingBox } from '../types';

export const EARTH_RADIUS_METERS = 6378137.0;

/**
 * Convert degrees to radians.
 */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180.0;
}

/**
 * Convert radians to degrees.
 */
export function toDegrees(radians: number): number {
  return (radians * 180.0) / Math.PI;
}

/**
 * Calculate distance between two lat/lon points using the Haversine formula (in meters).
 */
export function haversineDistance(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Calculate dimensions (widthMeters, heightMeters, areaKm2) of a bounding box.
 */
export function calculateBoundsDimensions(bounds: BoundingBox): {
  widthMeters: number;
  heightMeters: number;
  areaKm2: number;
} {
  const midLat = (bounds.south + bounds.north) / 2;
  const widthMeters = haversineDistance(bounds.west, midLat, bounds.east, midLat);
  const midLon = (bounds.west + bounds.east) / 2;
  const heightMeters = haversineDistance(midLon, bounds.south, midLon, bounds.north);
  const areaKm2 = (widthMeters * heightMeters) / 1_000_000;
  return { widthMeters, heightMeters, areaKm2 };
}

/**
 * Validates area size according to requirement:
 * "Enforce an area of about 2x2 km to 20x20 km, with a clear warning above that"
 */
export function validateAreaSize(bounds: BoundingBox): {
  valid: boolean;
  areaKm2: number;
  warning?: string;
  error?: string;
} {
  const { areaKm2, widthMeters, heightMeters } = calculateBoundsDimensions(bounds);
  const minDimKm = Math.min(widthMeters, heightMeters) / 1000;
  const maxDimKm = Math.max(widthMeters, heightMeters) / 1000;

  if (minDimKm < 0.8 || areaKm2 < 1.0) {
    return {
      valid: false,
      areaKm2,
      error: `Selected area (${areaKm2.toFixed(1)} km²) is too small. Minimum recommended size is 2×2 km (4 km²).`,
    };
  }

  if (maxDimKm > 30 || areaKm2 > 450) {
    return {
      valid: false,
      areaKm2,
      error: `Selected area (${areaKm2.toFixed(1)} km²) exceeds max allowed size of 20×20 km (400 km²). Please zoom in.`,
    };
  }

  if (areaKm2 > 250) {
    return {
      valid: true,
      areaKm2,
      warning: `Selected area is ${areaKm2.toFixed(1)} km² (>15×15 km). Simulation will require more memory and computation time.`,
    };
  }

  return { valid: true, areaKm2 };
}

/**
 * Convert lon/lat to slippy tile coordinate (x, y) at zoom z.
 */
export function lonLatToTile(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = toRadians(lat);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

/**
 * Convert slippy tile coordinate (x, y) at zoom z back to bounding box lon/lat.
 */
export function tileToBounds(x: number, y: number, zoom: number): BoundingBox {
  const n = Math.pow(2, zoom);
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const northRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  return {
    west,
    east,
    north: toDegrees(northRad),
    south: toDegrees(southRad),
  };
}

/**
 * Determine optimal slippy tile zoom level for Terrarium elevation tiles given a bounding box.
 * Zoom 11-13 gives ~30-70m resolution per pixel, matching typical 256x256 grids over 2-20km.
 */
export function getOptimalZoomForBounds(bounds: BoundingBox, targetResolution = 256): number {
  const { widthMeters, heightMeters } = calculateBoundsDimensions(bounds);
  const maxDim = Math.max(widthMeters, heightMeters);
  const desiredMetersPerPixel = maxDim / targetResolution;

  // Approximate meters per pixel at equator for zoom z: 156543 / 2^z
  const midLat = (bounds.south + bounds.north) / 2;
  const cosLat = Math.cos(toRadians(midLat));

  for (let z = 14; z >= 8; z--) {
    const res = (156543.03392 * cosLat) / Math.pow(2, z);
    if (res >= desiredMetersPerPixel * 0.75) {
      return z;
    }
  }
  return 11;
}
