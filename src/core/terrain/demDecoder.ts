/**
 * AWS Terrarium DEM Tile Decoder
 *
 * Terrarium format encodes elevation in meters using RGB channels:
 * elevation = (R * 256 + G + B / 256) - 32768
 *
 * Range: -11000m to +8900m with sub-meter precision (~0.004m per B increment).
 */

/**
 * Decode a single RGB pixel to elevation in meters.
 */
export function decodeTerrariumPixel(r: number, g: number, b: number): number {
  return (r * 256 + g + b / 256.0) - 32768.0;
}

/**
 * Decode an entire RGBA image buffer (Uint8ClampedArray or Uint8Array) into a Float32Array of elevations.
 */
export function decodeTerrariumImageData(
  rgbaPixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Float32Array {
  const count = width * height;
  const elevations = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    const r = rgbaPixels[offset];
    const g = rgbaPixels[offset + 1];
    const b = rgbaPixels[offset + 2];
    elevations[i] = decodeTerrariumPixel(r, g, b);
  }

  return elevations;
}

/**
 * Mapbox Terrain-RGB decoder fallback:
 * height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
 */
export function decodeMapboxRgbPixel(r: number, g: number, b: number): number {
  return -10000.0 + (r * 65536.0 + g * 256.0 + b) * 0.1;
}
