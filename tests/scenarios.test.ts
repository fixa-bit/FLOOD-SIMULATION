import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { comparisonProblem, deleteScenario, listScenarios, readScenario, renameScenario, SavedScenario, writeScenario } from '../src/core/scenarios/scenarioStorage';
import type { ScenarioInputs } from '../src/core/scenarios/scenarioStorage';
import type { SimulationFrame, SimulationResult, WorkerOutMessage } from '../src/core/types';
import { depthDifference } from '../src/core/analysis/eventResults';
import { exportTimingGrids } from '../src/core/analysis/timingMaps';

function fixture(): SavedScenario {
  const bounds = { west: 71, east: 71.01, south: 34, north: 34.01 };
  const stats = { maxDepth: 1, meanDepth: 0.5, floodedAreaKm2: 0.0004, totalWaterVolumeM3: 200, massConservationErrorPct: 0, affectedBuildingsCount: 1, affectedRoadsKm: 0.2 };
  const result: SimulationResult = { peakDepth: new Float32Array([1, 0.5, 0, 0]), envelopeStats: stats, maximumFloodedAreaKm2: 0.0003, floodDepthThreshold: 0.02,
    arrivalTimeSeconds: new Float64Array([0, 2, -1, -1]), floodDurationSeconds: new Float64Array([10, 8, 0, 0]), wetAtEnd: new Uint8Array([1, 1, 0, 0]), observedDurationSeconds: 10 };
  const frame: SimulationFrame = { frameIndex: 0, simulatedTimeSeconds: 10, depth: new Float32Array([0.1, 0, 0, 0]), velocity: new Float32Array(4), vx: new Float32Array(4), vy: new Float32Array(4), stats };
  const inputs: ScenarioInputs = {
    config: { gridSize: 256, bounds, duration: 10, outputInterval: 5, manningsN: 0.035, verticalExaggeration: 1,
      boundaryType: 'closed', inflows: [], inflowPreset: 'constant', rainfall: { intensityMmPerHour: 10, durationSeconds: 10 }, cflFactor: 0.7, minWaterDepthThreshold: 0.02 },
    dem: { bounds, width: 2, height: 2, dx: 10, dy: 10, elevation: new Float32Array(4), minElevation: 0, maxElevation: 0, initialWaterDepth: new Float32Array(4).fill(0.1) },
    buildings: [], roads: [],
  };
  return { id: 'baseline', name: 'Baseline', version: 1, createdAt: '2026-10-19T10:00:00Z', hasResults: true, inputs, frames: [frame], result };
}

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => vi.unstubAllGlobals());

describe('Saved scenario persistence', () => {
  it('round-trips typed arrays, inputs, results and playback independently of later edits', async () => {
    const scenario = fixture();
    await writeScenario(scenario);
    scenario.inputs.dem.elevation[0] = 99;
    scenario.inputs.config.rainfall.intensityMmPerHour = 999;
    const saved = await readScenario(scenario.id);
    expect(saved.inputs.dem.elevation).toBeInstanceOf(Float32Array);
    expect(saved.inputs.dem.elevation[0]).toBe(0);
    expect(saved.inputs.config.rainfall.intensityMmPerHour).toBe(10);
    expect(saved.result!.peakDepth).toBeInstanceOf(Float32Array);
    expect(saved.result!.arrivalTimeSeconds).toBeInstanceOf(Float64Array);
    const timing = exportTimingGrids(saved.inputs, saved.result!);
    expect(timing.arrivalTimeSeconds).toEqual([0, 2, null, null]);
    expect(timing.floodDurationSeconds).toEqual([10, 8, 0, 0]);
    expect(timing.dataSources.terrain.kind).toBe('unknown');
    expect(saved.frames[0].depth[0]).toBeCloseTo(0.1);
    expect(await listScenarios()).toMatchObject([{ id: 'baseline', name: 'Baseline', createdAt: scenario.createdAt, hasResults: true,
      sources: { terrain: { kind: 'unknown' }, infrastructure: { kind: 'unknown' } } }]);
    await renameScenario('baseline', 'Renamed');
    expect((await listScenarios())[0].name).toBe('Renamed');
    expect((await readScenario('baseline')).name).toBe('Renamed');
    await deleteScenario('baseline');
    expect(await listScenarios()).toEqual([]);
    await expect(readScenario('baseline')).rejects.toThrow(/storage failed/);
  });
  it('surfaces unavailable storage without falsely reporting success', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(writeScenario(fixture())).rejects.toThrow(/unavailable/);
  });
  it('blocks incompatible maps but permits rainfall and inflow changes', () => {
    const a = fixture(), b = structuredClone(a);
    b.inputs.config.rainfall.intensityMmPerHour = 100;
    expect(comparisonProblem(a, b)).toBeNull();
    b.result!.peakDepth[0] = 3;
    expect([...depthDifference(a.result!, b.result!)]).toEqual([2, 0, 0, 0]);
    b.inputs.dem.elevation[0] = 3;
    expect(comparisonProblem(a, b)).toMatch(/Terrain/);
    b.inputs.dem.elevation[0] = 0;
    b.inputs.dem.width = 4;
    expect(comparisonProblem(a, b)).toMatch(/same area, grid/);
    b.result = null;
    expect(comparisonProblem(a, b)).toMatch(/Run and save/);
  });
});

describe('Scenario workspace actions', () => {
  it('loads playback and duplicates original inputs without changing the baseline', async () => {
    vi.resetModules();
    const { useFloodStore } = await import('../src/ui/store/useFloodStore');
    await writeScenario(fixture());
    await useFloodStore.getState().loadScenario('baseline');
    expect(useFloodStore.getState().status).toBe('finished');
    expect(useFloodStore.getState().frames).toHaveLength(1);
    expect(JSON.parse(useFloodStore.getState().exportSummaryJson()!).inundationStats.peakWaterDepthMeters).toBe(1);
    expect(JSON.parse(useFloodStore.getState().exportGeoJsonFile()!).features[0].properties.depth_m).toBe(1);
    await useFloodStore.getState().loadScenario('baseline', true);
    expect(useFloodStore.getState().scenarioName).toBe('Baseline copy');
    expect(useFloodStore.getState().status).toBe('ready');
    expect(useFloodStore.getState().frames).toHaveLength(0);
    expect(useFloodStore.getState().result).toBeNull();
    useFloodStore.getState().updateConfig({ rainfall: { intensityMmPerHour: 50, durationSeconds: 10 } });
    const id = await useFloodStore.getState().saveScenario('Heavier rain', false);
    expect((await readScenario(id)).inputs.config.rainfall.intensityMmPerHour).toBe(50);
    expect((await readScenario('baseline')).inputs.config.rainfall.intensityMmPerHour).toBe(10);
  });
  it('saves completed runs with frozen start inputs even if controls were edited mid-run', async () => {
    vi.resetModules();
    let instance: { onmessage?: (event: { data: WorkerOutMessage }) => void };
    vi.stubGlobal('Worker', class {
      onmessage?: (event: { data: WorkerOutMessage }) => void;
      constructor() { instance = this; }
      postMessage() {}
      terminate() {}
    });
    const { useFloodStore } = await import('../src/ui/store/useFloodStore');
    const baseline = fixture();
    useFloodStore.setState({ ...baseline.inputs, bounds: baseline.inputs.dem.bounds, status: 'ready' });
    useFloodStore.getState().startSimulation();
    useFloodStore.getState().updateConfig({ rainfall: { intensityMmPerHour: 999, durationSeconds: 10 } });
    instance!.onmessage!({ data: { type: 'FRAME', frame: baseline.frames[0] } });
    instance!.onmessage!({ data: { type: 'FINISHED', totalFrames: 1, summaryStats: baseline.frames[0].stats, result: baseline.result! } });
    const id = await useFloodStore.getState().saveScenario('Completed', true);
    expect((await readScenario(id)).inputs.config.rainfall.intensityMmPerHour).toBe(10);
    expect((await readScenario(id)).hasResults).toBe(true);
  });
});
