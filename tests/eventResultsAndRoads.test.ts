import { describe, expect, it } from 'vitest';
import { sampleRoads, floodedRoadsKm } from '../src/core/analysis/roadExposure';
import { EventAccumulator } from '../src/core/analysis/eventResults';
import { exportFloodExtentGeoJson, generateSummaryReport } from '../src/core/analysis/geoJsonExporter';
import { haversineDistance } from '../src/core/terrain/geoUtils';
import type { FrameStats, OsmRoad, SimulationFrame, SimulationResult } from '../src/core/types';

const bounds = { west: 71, east: 71.04, south: 34, north: 34.04 };
const road = (coordinates: [number, number][]): OsmRoad => ({ id: 'r', name: 'Road', type: 'primary', coordinates, lengthMeters: 999999, isFlooded: false, maxWaterDepth: 0 });
const stats: FrameStats = { maxDepth: 0, meanDepth: 0, floodedAreaKm2: 0, totalWaterVolumeM3: 0, massConservationErrorPct: 0, affectedBuildingsCount: 0, affectedRoadsKm: 0 };

describe('Road exposure on the selected domain', () => {
  it('counts only wet portions of a two-vertex road, including away from its midpoint', () => {
    const samples = sampleRoads([road([[71, 34.02], [71.04, 34.02]])], bounds, 5, 5);
    const depths = new Float32Array(25);
    depths[10] = 0.4; // West end; midpoint stays dry.
    const fullLength = haversineDistance(71, 34.02, 71.04, 34.02);
    expect(samples.reduce((s, p) => s + p.lengthMeters, 0)).toBeCloseTo(fullLength, 3);
    expect(floodedRoadsKm(depths, samples)).toBeCloseTo(fullLength / 8 / 1000, 4);
    depths.fill(0.4);
    expect(floodedRoadsKm(depths, samples)).toBeCloseTo(fullLength / 1000, 5);
  });
  it('clips crossing segments and excludes fully out-of-domain roads', () => {
    const samples = sampleRoads([
      road([[70.9, 34.02], [71.1, 34.02]]), road([[71.1, 34.1], [71.2, 34.2]]),
    ], bounds, 5, 5);
    const expected = haversineDistance(71, 34.02, 71.04, 34.02) / 1000;
    expect(floodedRoadsKm(new Float32Array(25).fill(1), samples)).toBeCloseTo(expected, 5);
    expect(sampleRoads([road([[71.1, 34.1], [71.2, 34.2]])], bounds, 5, 5)).toEqual([]);
  });
  it('samples north-south and diagonal segments and ignores zero-length segments', () => {
    const vertical = sampleRoads([road([[71.02, 34], [71.02, 34.04]])], bounds, 5, 5);
    expect(new Set(vertical.map(s => s.cell))).toEqual(new Set([2, 7, 12, 17, 22]));
    const diagonal = sampleRoads([road([[71, 34.04], [71.04, 34]])], bounds, 5, 5);
    expect(new Set(diagonal.map(s => s.cell))).toEqual(new Set([0, 6, 12, 18, 24]));
    expect(sampleRoads([road([[71, 34], [71, 34]])], bounds, 5, 5)).toEqual([]);
  });
});

describe('Whole-event results', () => {
  it('preserves early peaks and distinguishes total extent from simultaneous area', () => {
    const event = new EventAccumulator(3, 100, 0.1);
    event.update(new Float32Array([2, 0, 0]));
    event.update(new Float32Array([0, 1, 0]));
    event.update(new Float32Array(3));
    expect([...event.peakDepth]).toEqual([2, 1, 0]);
    expect(event.maximumFloodedAreaKm2).toBe(0.0001);
    const result: SimulationResult = { peakDepth: event.peakDepth, floodDepthThreshold: 0.1, maximumFloodedAreaKm2: event.maximumFloodedAreaKm2,
      envelopeStats: { ...stats, maxDepth: 2, floodedAreaKm2: 0.0002, affectedBuildingsCount: 3, affectedRoadsKm: 1.5 } };
    const frame: SimulationFrame = { frameIndex: 0, simulatedTimeSeconds: 30, depth: new Float32Array(3), velocity: new Float32Array(3), vx: new Float32Array(3), vy: new Float32Array(3), stats };
    const report = generateSummaryReport(bounds, frame, [], [], result, { width: 3, height: 1 });
    expect(report.inundationStats.peakWaterDepthMeters).toBe(2);
    expect(report.impactStats.floodedRoadsKm).toBe(1.5);
    expect(report.stats.maxDepth).toBe(0); // Final state stays explicitly available.
    const geojson = exportFloodExtentGeoJson(event.peakDepth, 3, 1, bounds, 0.1);
    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0].properties.depth_m).toBe(2);
  });
  it('exports the maximum depth across a merged horizontal run', () => {
    const geojson = exportFloodExtentGeoJson(new Float32Array([0.1, 3, 1]), 3, 1, bounds);
    expect(geojson.features[0].properties.depth_m).toBe(3);
  });
});
