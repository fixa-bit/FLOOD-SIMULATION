/**
 * Web Worker for Hydraulic Flood Simulation
 * Runs the shallow-water solver in a background thread and streams
 * SimulationFrame objects with zero-copy ArrayBuffer transfers.
 */

import { HydraulicSimulator } from './shallowWater';
import { rasterizeBuildings, buildingWaterDepth } from './buildingObstacles';
import { WorkerInMessage, WorkerOutMessage, SimulationConfig, OsmBuilding, OsmRoad } from '../types';

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
  const assessFrame = (frame: import('../types').SimulationFrame) =>
    assessImpacts(frame, buildings, roads, width, height, elevation, obstacles.exposureCells);
  const totalDuration = config.duration;
  const outputInterval = Math.max(1, config.outputInterval || 30);

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
    const stepDt = Math.min(dt, nextOutputTime - simulator.currentTime, totalDuration - simulator.currentTime);

    // 2. Step physics
    simulator.step(stepDt);

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

  self.postMessage({
    type: 'FINISHED',
    totalFrames,
    summaryStats: finalFrame.stats,
  } as WorkerOutMessage);

  isRunning = false;
}

/**
 * Assess live flood impact on buildings and roads for the current frame
 */
function assessImpacts(
  frame: any,
  buildings: OsmBuilding[] | undefined,
  roads: OsmRoad[] | undefined,
  width: number,
  height: number,
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

  let affectedRoadLengthMeters = 0;
  if (roads && roads.length > 0) {
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      if (r.coordinates.length > 0) {
        // Sample midpoint
        const midIdx = Math.floor(r.coordinates.length / 2);
        const [lon, lat] = r.coordinates[midIdx];
        // Approximate grid cell
        const gx = Math.min(width - 1, Math.max(0, Math.floor((lon + 180) / 360 * width) % width));
        const gy = Math.min(height - 1, Math.max(0, Math.floor((90 - lat) / 180 * height) % height));
        const d = depth[gy * width + gx];
        if (d >= floodThreshold) {
          affectedRoadLengthMeters += r.lengthMeters;
        }
      }
    }
  }

  frame.stats.affectedBuildingsCount = affectedBuildings;
  frame.stats.affectedRoadsKm = affectedRoadLengthMeters / 1000.0;
}
