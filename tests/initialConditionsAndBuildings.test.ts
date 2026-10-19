import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HydraulicSimulator } from '../src/core/sim/shallowWater';
import { buildingWaterDepth, rasterizeBuildings } from '../src/core/sim/buildingObstacles';
import type { DemData, OsmBuilding, SimulationConfig, WorkerInMessage, WorkerOutMessage } from '../src/core/types';

const width = 9, height = 9;
const bounds = { west: 0, east: 8, south: 0, north: 8 };
const elevation = new Float32Array(width * height);
const config: SimulationConfig = {
  gridSize: 256, bounds, duration: 5, outputInterval: 1, manningsN: 0.035,
  verticalExaggeration: 1, boundaryType: 'closed', inflows: [], inflowPreset: 'constant',
  rainfall: { intensityMmPerHour: 0, durationSeconds: 0 }, cflFactor: 0.7,
  minWaterDepthThreshold: 0.02,
};

function building(west: number, south: number, east: number, north: number): OsmBuilding {
  return {
    id: 'building', polygon: [[west, south], [east, south], [east, north], [west, north]],
    height: 6, elevation: 0, gridX: 4, gridY: 4, isFlooded: false, maxWaterDepth: 0,
  };
}

function advance(sim: HydraulicSimulator, seconds: number) {
  while (sim.currentTime < seconds) sim.step(Math.min(0.02, seconds - sim.currentTime));
}

describe('Initial water and solid buildings', () => {
  it('retains initial water, including subthreshold depths, in volume and mass balance', () => {
    const initial = new Float32Array(width * height).fill(0.005);
    const sim = new HydraulicSimulator(width, height, 1, 1, elevation, config, initial);
    expect(sim.generateFrame().stats.totalWaterVolumeM3).toBeCloseTo(81 * 0.005, 6);
    advance(sim, 1);
    const frame = sim.generateFrame();
    expect(frame.stats.massConservationErrorPct).toBeLessThan(0.001);
    expect(frame.stats.floodedAreaKm2).toBe(0);
    expect(initial[0]).toBeCloseTo(0.005);
  });

  it.each(['x', 'y'])('blocks flow across a complete building barrier on the %s axis', axis => {
    const obstacle = axis === 'x' ? building(3.6, -1, 4.4, 9) : building(-1, 3.6, 9, 4.4);
    const { mask } = rasterizeBuildings([obstacle], bounds, width, height);
    const initial = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if ((axis === 'x' ? x : y) < 4) initial[y * width + x] = 1;
    }
    const sim = new HydraulicSimulator(width, height, 1, 1, elevation, config, initial, mask);
    advance(sim, 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if ((axis === 'x' ? x : y) >= 4) expect(sim.depth[y * width + x]).toBe(0);
    }
    expect(sim.generateFrame().stats.massConservationErrorPct).toBeLessThan(0.001);
  });

  it('routes water around a footprint while keeping the interior dry', () => {
    const { mask } = rasterizeBuildings([building(2.6, 2.6, 5.4, 5.4)], bounds, width, height);
    const initial = new Float32Array(width * height);
    for (let y = 0; y < height; y++) initial[y * width] = 1;
    const sim = new HydraulicSimulator(width, height, 1, 1, elevation, config, initial, mask);
    advance(sim, 10);
    expect(sim.depth[4 * width + 7]).toBeGreaterThan(0.001);
    mask.forEach((solid, i) => { if (solid) expect(sim.depth[i]).toBe(0); });
    expect(sim.generateFrame().stats.massConservationErrorPct).toBeLessThan(0.001);
  });

  it('excludes solid cells from initial storage and rainfall and redistributes inlet water', () => {
    const { mask } = rasterizeBuildings([building(3.6, 3.6, 4.4, 4.4)], bounds, width, height);
    const initial = new Float32Array(width * height).fill(0.1);
    const wetConfig: SimulationConfig = {
      ...config, rainfall: { intensityMmPerHour: 3600, durationSeconds: 10 },
      inflows: [{ id: 'source', gridX: 4, gridY: 4, lon: 4, lat: 4, baseDischarge: 2 }],
    };
    const sim = new HydraulicSimulator(width, height, 1, 1, elevation, wetConfig, initial, mask);
    expect(sim.initialWaterVolumeM3).toBeCloseTo(8);
    sim.step(0.1);
    expect(sim.depth[40]).toBe(0);
    expect(sim.totalInflowVolumeM3).toBeCloseTo(0.2);
    expect(sim.totalRainfallVolumeM3).toBeCloseTo(0.008);
    expect(sim.generateFrame().stats.massConservationErrorPct).toBeLessThan(0.001);
    expect(initial[40]).toBeCloseTo(0.1); // Input remains untouched.
  });

  it('rejects an inlet with no fluid cells instead of silently losing discharge', () => {
    const { mask } = rasterizeBuildings([building(2.6, 2.6, 5.4, 5.4)], bounds, width, height);
    const sim = new HydraulicSimulator(width, height, 1, 1, elevation, {
      ...config, inflows: [{ id: 'blocked', gridX: 4, gridY: 4, lon: 4, lat: 4, baseDischarge: 2 }],
    }, undefined, mask);
    expect(() => sim.step(0.1)).toThrow(/entirely inside building obstacles/);
  });

  it('conserves water with obstacles and open edges even when outflow must be limited', () => {
    const { mask } = rasterizeBuildings([building(3.6, 3.6, 4.4, 4.4)], bounds, width, height);
    const sim = new HydraulicSimulator(width, height, 1, 1, elevation,
      { ...config, boundaryType: 'open' }, new Float32Array(81).fill(0.1), mask);
    sim.step(5);
    const frame = sim.generateFrame();
    expect(frame.stats.massConservationErrorPct).toBeLessThan(0.001);
    expect(frame.stats.totalWaterVolumeM3 + sim.totalOutflowVolumeM3).toBeCloseTo(sim.initialWaterVolumeM3, 5);
  });

  it('samples exterior water levels for building exposure rather than dry interiors', () => {
    const b = building(2.6, 2.6, 5.4, 5.4);
    const { mask, exposureCells } = rasterizeBuildings([b], bounds, width, height);
    const depth = new Float32Array(81);
    depth[4 * width + 2] = 0.5;
    expect(mask[40]).toBe(1);
    expect(buildingWaterDepth(b, exposureCells[0], depth, elevation)).toBe(0.5);
    expect(exposureCells[0].every(i => !mask[i])).toBe(true);
    expect(buildingWaterDepth({ ...b, elevation: 1 }, exposureCells[0], depth, elevation)).toBe(0);
  });

  it('uses the footprint shape, clips to the domain, and leaves unresolved footprints unblocked', () => {
    const triangle = { ...building(0, 0, 8, 8), polygon: [[-1, 9], [5, 9], [-1, 3]] as [number, number][] };
    const { mask } = rasterizeBuildings([triangle], bounds, width, height);
    expect(mask[0]).toBe(1);
    expect(mask[4 * width + 4]).toBe(0); // Inside bounding box, outside triangle.
    expect(rasterizeBuildings([building(3.1, 3.1, 3.2, 3.2)], bounds, width, height).mask.some(Boolean)).toBe(false);
    expect(rasterizeBuildings([building(20, 20, 21, 21)], bounds, width, height).mask.some(Boolean)).toBe(false);
  });

  it('rejects invalid initial-depth arrays', () => {
    expect(() => new HydraulicSimulator(width, height, 1, 1, elevation, config, new Float32Array(1))).toThrow(/size/);
    for (const value of [-1, NaN, Infinity]) {
      expect(() => new HydraulicSimulator(width, height, 1, 1, elevation, config, new Float32Array(81).fill(value))).toThrow(/finite and non-negative/);
    }
  });
});

describe('Initial-condition message plumbing', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('passes DEM initial depths from the store into START_SIMULATION', async () => {
    const postMessage = vi.fn();
    vi.stubGlobal('Worker', class { postMessage = postMessage; terminate() {} });
    const { useFloodStore } = await import('../src/ui/store/useFloodStore');
    const initialWaterDepth = new Float32Array(81).fill(0.5);
    const dem: DemData = { width, height, bounds, dx: 1, dy: 1, elevation, minElevation: 0, maxElevation: 0, initialWaterDepth };
    useFloodStore.setState({ dem, config, buildings: [], roads: [] });
    useFloodStore.getState().startSimulation();
    expect(postMessage.mock.calls[0][0].initialWaterDepth).toBe(initialWaterDepth);
  });

  it('emits initial water and obstruction-aware exposure from the real worker handler', async () => {
    const messages: WorkerOutMessage[] = [];
    const workerScope = {
      onmessage: undefined as undefined | ((event: { data: WorkerInMessage }) => Promise<void>),
      postMessage: (message: WorkerOutMessage) => messages.push(message),
    };
    vi.stubGlobal('self', workerScope);
    await import('../src/core/sim/worker');
    await workerScope.onmessage!({ data: {
      type: 'START_SIMULATION', config: { ...config, duration: 1 },
      elevation, width, height, dx: 1, dy: 1,
      buildings: [building(2.6, 2.6, 5.4, 5.4)], initialWaterDepth: new Float32Array(81).fill(0.5),
    } });
    const frames = messages.filter(m => m.type === 'FRAME');
    expect(frames[0].frame.depth[0]).toBe(0.5);
    expect(frames[0].frame.depth[40]).toBe(0);
    expect(frames[0].frame.stats.totalWaterVolumeM3).toBe(36);
    expect(frames[0].frame.stats.affectedBuildingsCount).toBe(1);
    expect(messages.some(m => m.type === 'FINISHED')).toBe(true);
    expect(messages.some(m => m.type === 'ERROR')).toBe(false);
    expect(frames.at(-1)!.frame.stats.massConservationErrorPct).toBeLessThan(0.001);
  });
});
