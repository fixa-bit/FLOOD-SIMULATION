/**
 * Web Worker for Hydraulic Flood Simulation
 * Runs the shallow-water solver in a background thread and streams
 * SimulationFrame objects with zero-copy ArrayBuffer transfers.
 */

import { HydraulicSimulator } from './shallowWater';
import { rasterizeBuildings, buildingWaterDepth } from './buildingObstacles';
import { sampleRoads, floodedRoadsKm, RoadSample } from '../analysis/roadExposure';
import { EventAccumulator } from '../analysis/eventResults';
import { WorkerInMessage, WorkerOutMessage, SimulationConfig, SimulationFrame, OsmBuilding, OsmRoad } from '../types';

let isRunning = false;
let shouldCancel = false;

self.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  if (msg.type === 'CANCEL_SIMULATION') {
    shouldCancel = true;
    isRunning = false;
    return;
  }

  if (msg.type === 'START_SIMULATION') {
    if (isRunning) {
      shouldCancel = true;
      // Wait for any previous run to exit
      await new Promise((r) => setTimeout(r, 50));
    }

    isRunning = true;
    shouldCancel = false;

    const { config, elevation, width, height, dx, dy, buildings, roads, initialWaterDepth } = msg;

    try {
      runSimulationWorker(config, elevation, width, height, dx, dy, buildings, roads, initialWaterDepth);
    } catch (err: any) {
      const errorMsg: WorkerOutMessage = {
        type: 'ERROR',
        error: err?.message || String(err),
      };
      self.postMessage(errorMsg);
      isRunning = false;
    }
  }
};

function runSimulationWorker(
  config: SimulationConfig,
  elevation: Float32Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
  buildings?: OsmBuilding[],
  roads?: OsmRoad[],
  initialWaterDepth?: Float32Array
) {
  const obstacles = rasterizeBuildings(buildings ?? [], config.bounds, width, height);
  const simulator = new HydraulicSimulator(width, height, dx, dy, elevation, config, initialWaterDepth, obstacles.mask);
  const roadSamples = sampleRoads(roads ?? [], config.bounds, width, height);
  const event = new EventAccumulator(width * height, dx * dy, config.minWaterDepthThreshold);
  event.update(simulator.depth);
  const assessFrame = (frame: SimulationFrame) =>
    assessImpacts(frame, buildings, roadSamples, elevation, obstacles.exposureCells);
  const totalDuration = config.duration;
  const outputInterval = Math.max(1, config.outputInterval || 30);
  const start = config.hydrographStartSeconds ?? 0;
  const eventDuration = config.hydrographDurationSeconds ?? 3600;
  const forcingTimes = [start, start + eventDuration, config.rainfall.durationSeconds,
    start + eventDuration * (config.inflowPreset === 'flash_flood' ? 0.15 : 0.35),
    ...config.inflows.flatMap(i => (i.customHydrograph ?? []).map(p => p.timeSeconds + start)),
  ].sort((a, b) => a - b);

  let nextOutputTime = 0.0;
  let totalFrames = 0;
  let lastProgressReportTime = Date.now();

  // Emit initial frame at t = 0
  const initFrame = simulator.generateFrame();
  assessFrame(initFrame);

  self.postMessage(
    {
      type: 'FRAME',
      frame: initFrame,
    } as WorkerOutMessage,
    [
      initFrame.depth.buffer,
      initFrame.velocity.buffer,
      initFrame.vx.buffer,
      initFrame.vy.buffer,
    ]
  );
  totalFrames++;
  nextOutputTime += outputInterval;

  while (simulator.currentTime < totalDuration && !shouldCancel) {
    // 1. Find max depth and velocity across grid for CFL condition
    let maxDepth = 0;
    let maxVel = 0;
    for (let i = 0; i < simulator.depth.length; i++) {
      const d = simulator.depth[i];
      if (d > maxDepth) maxDepth = d;
    }

    const dt = simulator.computeAdaptiveTimestep(maxDepth, maxVel);
    const nextForcing = forcingTimes.find(t => t > simulator.currentTime + 1e-8) ?? Infinity;
    const stepDt = Math.min(dt, nextOutputTime - simulator.currentTime, totalDuration - simulator.currentTime, nextForcing - simulator.currentTime);

    // 2. Step physics
    simulator.step(stepDt);
    event.update(simulator.depth, simulator.currentTime);

    // 3. Emit frame if interval reached
    if (simulator.currentTime >= nextOutputTime - 1e-4 || simulator.currentTime >= totalDuration - 1e-4) {
      const frame = simulator.generateFrame();
      assessFrame(frame);

      self.postMessage(
        {
          type: 'FRAME',
          frame,
        } as WorkerOutMessage,
        [
          frame.depth.buffer,
          frame.velocity.buffer,
          frame.vx.buffer,
          frame.vy.buffer,
        ]
      );

      totalFrames++;
      nextOutputTime += outputInterval;
    }

    // 4. Progress notification (throttled to every ~100ms)
    const now = Date.now();
    if (now - lastProgressReportTime > 100) {
      const percent = Math.min(100, (simulator.currentTime / totalDuration) * 100);
      self.postMessage({
        type: 'PROGRESS',
        percent,
        simulatedTimeSeconds: simulator.currentTime,
        totalDurationSeconds: totalDuration,
        currentTimestep: stepDt,
      } as WorkerOutMessage);
      lastProgressReportTime = now;
    }
  }

  if (shouldCancel) {
    isRunning = false;
    return;
  }

  // Final summary
  const finalFrame = simulator.generateFrame();
  assessFrame(finalFrame);

  let maxDepth = 0, sumDepth = 0, wetCells = 0;
  for (const d of event.peakDepth) {
    maxDepth = Math.max(maxDepth, d);
    sumDepth += d;
    if (d >= config.minWaterDepthThreshold) wetCells++;
  }
  const envelopeFrame = { ...finalFrame, depth: event.peakDepth, stats: {
    ...finalFrame.stats, maxDepth, meanDepth: sumDepth / Math.max(1, simulator.fluidCellCount),
    floodedAreaKm2: wetCells * dx * dy / 1e6, totalWaterVolumeM3: sumDepth * dx * dy,
  } };
  assessFrame(envelopeFrame);

  self.postMessage({
    type: 'FINISHED',
    totalFrames,
    summaryStats: finalFrame.stats,
    result: {
      peakDepth: event.peakDepth, envelopeStats: envelopeFrame.stats,
      maximumFloodedAreaKm2: event.maximumFloodedAreaKm2,
      floodDepthThreshold: config.minWaterDepthThreshold,
      arrivalTimeSeconds: event.arrivalTimeSeconds,
      floodDurationSeconds: event.floodDurationSeconds,
      wetAtEnd: event.wetAtEnd,
      observedDurationSeconds: simulator.currentTime,
    },
  } as WorkerOutMessage);

  isRunning = false;
}

/**
 * Assess live flood impact on buildings and roads for the current frame
 */
function assessImpacts(
  frame: SimulationFrame,
  buildings: OsmBuilding[] | undefined,
  roadSamples: RoadSample[],
  elevation: Float32Array,
  exposureCells: number[][]
) {
  const depth = frame.depth as Float32Array;
  const floodThreshold = 0.3; // 0.3 meters threshold per requirements

  let affectedBuildings = 0;
  if (buildings && buildings.length > 0) {
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      const d = buildingWaterDepth(b, exposureCells[i], depth, elevation);
      if (d >= floodThreshold) {
        affectedBuildings++;
      }
    }
  }

  frame.stats.affectedBuildingsCount = affectedBuildings;
  frame.stats.affectedRoadsKm = floodedRoadsKm(depth, roadSamples, floodThreshold);
}
