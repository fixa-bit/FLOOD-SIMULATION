import { describe, expect, it, vi, afterEach } from 'vitest';
import { EventAccumulator } from '../src/core/analysis/eventResults';
import { calculateInflowDischarge, HydraulicSimulator } from '../src/core/sim/shallowWater';
import { normalizeEventTiming } from '../src/core/sim/eventTiming';
import { hasTiming, timingAt } from '../src/core/analysis/timingMaps';
import type { SimulationConfig, SimulationResult, WorkerInMessage, WorkerOutMessage } from '../src/core/types';

const config: SimulationConfig = { gridSize: 256, bounds: { west: 0, east: 1, south: 0, north: 1 }, duration: 10,
  outputInterval: 5, manningsN: 0.035, verticalExaggeration: 1, boundaryType: 'closed', inflows: [], inflowPreset: 'constant',
  rainfall: { intensityMmPerHour: 0, durationSeconds: 0 }, cflFactor: 0.7, minWaterDepthThreshold: 0.5 };
const inlet = { id: 'i', gridX: 1, gridY: 1, lon: 0.5, lat: 0.5, baseDischarge: 1 };
afterEach(() => vi.unstubAllGlobals());

describe('Arrival and cumulative inundation duration', () => {
  it('distinguishes dry cells and initial water and interpolates crossings and repeated floods', () => {
    const event = new EventAccumulator(3, 100, 0.5);
    event.update(new Float32Array([0, 1, 0]), 0);
    event.update(new Float32Array([1, 0, 0]), 10);
    event.update(new Float32Array([0, 0, 0]), 20);
    event.update(new Float32Array([1, 0, 0]), 30);
    expect([...event.arrivalTimeSeconds]).toEqual([5, 0, -1]);
    expect([...event.floodDurationSeconds]).toEqual([15, 5, 0]);
    expect([...event.wetAtEnd]).toEqual([1, 0, 0]);
  });
  it('does not double-count repeated times and rejects backwards time', () => {
    const event = new EventAccumulator(1, 1, 0.5);
    event.update(new Float32Array([1]), 0);
    event.update(new Float32Array([1]), 10);
    event.update(new Float32Array([1]), 10);
    expect(event.floodDurationSeconds[0]).toBe(10);
    expect(() => event.update(new Float32Array([1]), 9)).toThrow(/nondecreasing/);
  });
  it('marks older results without timing as unavailable', () => {
    const result = { peakDepth: new Float32Array(3) } as SimulationResult;
    expect(hasTiming(result)).toBe(false);
    expect(timingAt(result, 0)).toBeNull();
  });
});

describe('Event time is independent of observation duration', () => {
  it.each(['constant', 'rising_falling', 'flash_flood'] as const)('preserves the %s event when the run is extended', preset => {
    const original = { ...config, duration: 100, hydrographDurationSeconds: 40, hydrographStartSeconds: 5, inflowPreset: preset };
    const extended = { ...original, duration: 300 };
    for (const time of [0, 5, 10, 20, 44, 45, 100]) {
      expect(calculateInflowDischarge(inlet, time, original.hydrographDurationSeconds, preset, 5))
        .toBe(calculateInflowDischarge(inlet, time, extended.hydrographDurationSeconds, preset, 5));
    }
    expect(calculateInflowDischarge(inlet, 0, 40, preset, 5)).toBe(0);
    expect(calculateInflowDischarge(inlet, 45, 40, preset, 5)).toBe(0);
    expect(calculateInflowDischarge(inlet, 20, 40, preset, 5)).toBeGreaterThan(0);
  });
  it('keeps custom curve timing and ends at its final timestamp', () => {
    const custom = { ...inlet, customHydrograph: [{ timeSeconds: 0, dischargeM3PerSec: 0 }, { timeSeconds: 10, dischargeM3PerSec: 10 }, { timeSeconds: 20, dischargeM3PerSec: 0 }] };
    expect(calculateInflowDischarge(custom, 15, 1, 'custom', 5)).toBe(10);
    expect(calculateInflowDischarge(custom, 25, 1000, 'custom', 5)).toBe(0);
    expect(calculateInflowDischarge(custom, 100, 1000, 'custom', 5)).toBe(0);
    const delayed = { ...inlet, customHydrograph: [{ timeSeconds: 3, dischargeM3PerSec: 10 }, { timeSeconds: 10, dischargeM3PerSec: 0 }] };
    expect(calculateInflowDischarge(delayed, 6, 1000, 'custom', 5)).toBe(0); // Before first sample at t=8.
    expect(calculateInflowDischarge(delayed, 8, 1000, 'custom', 5)).toBe(10);
  });
  it('freezes legacy event duration before changing the run duration', () => {
    const normalized = normalizeEventTiming(config);
    const extended = normalizeEventTiming({ ...normalized, duration: 100 });
    expect(extended.hydrographDurationSeconds).toBe(10);
    expect(extended.hydrographStartSeconds).toBe(0);
  });
  it('only adds rainfall for the rainy part of a timestep', () => {
    const sim = new HydraulicSimulator(2, 2, 1, 1, new Float32Array(4), {
      ...config, rainfall: { intensityMmPerHour: 3600, durationSeconds: 0.25 },
    });
    sim.step(1);
    expect(sim.totalRainfallVolumeM3).toBeCloseTo(0.001);
  });
  it('the real worker tracks timing between output frames and preserves the common event prefix', async () => {
    vi.resetModules();
    let messages: WorkerOutMessage[] = [];
    const scope = { onmessage: undefined as undefined | ((event: { data: WorkerInMessage }) => Promise<void>),
      postMessage: (m: WorkerOutMessage) => messages.push(m) };
    vi.stubGlobal('self', scope);
    await import('../src/core/sim/worker');
    const run = async (duration: number, outputInterval: number) => {
      messages = [];
      await scope.onmessage!({ data: { type: 'START_SIMULATION', config: { ...config, duration, outputInterval, hydrographStartSeconds: 2, hydrographDurationSeconds: 2,
        rainfall: { intensityMmPerHour: 0, durationSeconds: 0 }, inflows: [inlet], minWaterDepthThreshold: 0.001 },
        width: 3, height: 3, dx: 1, dy: 1, elevation: new Float32Array(9) } });
      return messages;
    };
    const short = await run(5, 5), long = await run(10, 5);
    const shortEnd = short.find(m => m.type === 'FINISHED');
    const longEnd = long.find(m => m.type === 'FINISHED');
    if (shortEnd?.type !== 'FINISHED' || longEnd?.type !== 'FINISHED') throw new Error('Worker did not finish');
    expect(shortEnd.result.arrivalTimeSeconds![4]).toBeGreaterThanOrEqual(2);
    expect(shortEnd.result.arrivalTimeSeconds![4]).toBeLessThan(4);
    expect(shortEnd.result.floodDurationSeconds![4]).toBeGreaterThan(0);
    const atFive = long.find(m => m.type === 'FRAME' && m.frame.simulatedTimeSeconds === 5);
    const shortFrame = short.filter(m => m.type === 'FRAME').at(-1);
    if (atFive?.type !== 'FRAME' || shortFrame?.type !== 'FRAME') throw new Error('Missing common frame');
    expect([...atFive.frame.depth]).toEqual([...shortFrame.frame.depth]);
    expect([...longEnd.result.arrivalTimeSeconds!]).toEqual([...shortEnd.result.arrivalTimeSeconds!]);
    expect(longEnd.result.floodDurationSeconds![4]).toBeGreaterThan(shortEnd.result.floodDurationSeconds![4]);
  });
});
