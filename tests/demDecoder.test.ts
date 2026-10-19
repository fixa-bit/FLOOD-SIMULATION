import { describe, it, expect } from 'vitest';
import { decodeTerrariumPixel, decodeTerrariumImageData, decodeMapboxRgbPixel } from '../src/core/terrain/demDecoder';

describe('AWS Terrarium DEM Tile Decoder', () => {
  it('correctly decodes sea level (0 meters) at RGB(128, 0, 0)', () => {
    // 128 * 256 = 32768; 32768 - 32768 = 0.0
    const elev = decodeTerrariumPixel(128, 0, 0);
    expect(elev).toBeCloseTo(0.0, 4);
  });

  it('correctly decodes positive elevation (e.g., 256 meters at RGB(129, 0, 0))', () => {
    // 129 * 256 = 33024; 33024 - 32768 = 256.0
    const elev = decodeTerrariumPixel(129, 0, 0);
    expect(elev).toBeCloseTo(256.0, 4);
  });

  it('correctly decodes high altitude (e.g., K2 / Karakoram 8611 meters)', () => {
    // Target: 8611 meters -> Raw value = 8611 + 32768 = 41379
    // R = Math.floor(41379 / 256) = 161
    // G = 41379 % 256 = 163
    // B = 0
    const r = 161;
    const g = 163;
    const b = 0;
    const elev = decodeTerrariumPixel(r, g, b);
    expect(elev).toBeCloseTo(8611.0, 4);
  });

  it('correctly decodes negative elevation (e.g., Dead Sea -430 meters)', () => {
    // Target: -430 meters -> Raw value = -430 + 32768 = 32338
    // R = Math.floor(32338 / 256) = 126
    // G = 32338 % 256 = 82
    const r = 126;
    const g = 82;
    const b = 0;
    const elev = decodeTerrariumPixel(r, g, b);
    expect(elev).toBeCloseTo(-430.0, 4);
  });

  it('decodes an entire RGBA image pixel buffer', () => {
    const width = 2;
    const height = 2;
    const rgba = new Uint8Array([
      128, 0, 0, 255,   // 0m
      129, 0, 0, 255,   // 256m
      128, 100, 0, 255, // 100m
      126, 82, 0, 255,  // -430m
    ]);

    const result = decodeTerrariumImageData(rgba, width, height);
    expect(result.length).toBe(4);
    expect(result[0]).toBeCloseTo(0.0, 4);
    expect(result[1]).toBeCloseTo(256.0, 4);
    expect(result[2]).toBeCloseTo(100.0, 4);
    expect(result[3]).toBeCloseTo(-430.0, 4);
  });

  it('Mapbox Terrain-RGB decoder decodes expected elevations', () => {
    // 0m: -10000 + 10000 = 0 -> (R*65536 + G*256 + B)*0.1 = 10000 -> 100000
    // 100000 / 65536 = 1, rem = 34464; 34464 / 256 = 134; rem = 160
    const elev = decodeMapboxRgbPixel(1, 134, 160);
    expect(elev).toBeCloseTo(0.0, 1);
  });
});
