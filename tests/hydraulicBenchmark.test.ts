import { describe, it, expect } from 'vitest';
import { HydraulicSimulator } from '../src/core/sim/shallowWater';
import { SimulationConfig } from '../src/core/types';

describe('Hydraulic Dam-Break and Bathtub Benchmark Test', () => {
  it('dam-break shock wave propagates into dry domain while strictly conserving mass', () => {
    const width = 40;
    const height = 10;
    const dx = 5.0; // 5 meters cell size
    const dy = 5.0;
    const cellArea = dx * dy;

    // Flat bed elevation
    const elevation = new Float32Array(width * height).fill(10.0);

    const config: SimulationConfig = {
      gridSize: 256,
      bounds: { west: 0, south: 0, east: 0.005, north: 0.002 },
      duration: 30, // 30 seconds
      outputInterval: 5,
      manningsN: 0.03,
      verticalExaggeration: 1.0,
      boundaryType: 'closed', // Closed tank / flume
      inflowPreset: 'constant',
      inflows: [],
      rainfall: { intensityMmPerHour: 0, durationSeconds: 0 },
      cflFactor: 0.7,
      minWaterDepthThreshold: 0.001,
    };

    const sim = new HydraulicSimulator(width, height, dx, dy, elevation, config);

    // Initial Condition: Dam-break setup
    // Left half (x < 20): high water h = 4.0m
    // Right half (x >= 20): dry bed h = 0.0m
    let initialTotalVolume = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (x < 20) {
          sim.depth[idx] = 4.0;
          initialTotalVolume += 4.0 * cellArea;
        } else {
          sim.depth[idx] = 0.0;
        }
      }
    }

    // Expected uniform equilibrium depth = 2.0m
    const expectedMeanDepth = 2.0;

    // Run dam break simulation for 30 simulated seconds
    const totalSimTime = 30;
    while (sim.currentTime < totalSimTime) {
      let maxD = 0;
      for (let i = 0; i < sim.depth.length; i++) {
        if (sim.depth[i] > maxD) maxD = sim.depth[i];
      }
      const dt = sim.computeAdaptiveTimestep(maxD, 2.0);
      const stepDt = Math.min(dt, totalSimTime - sim.currentTime);
      sim.step(stepDt);
    }

    // Verify 1: Water wave has progressed onto the right half (previously dry cells now flooded)
    let rightSideVolume = 0;
    let wetCellsOnRight = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 20; x < width; x++) {
        const idx = y * width + x;
        const d = sim.depth[idx];
        if (d > 0.05) {
          wetCellsOnRight++;
          rightSideVolume += d * cellArea;
        }
      }
    }

    expect(wetCellsOnRight).toBeGreaterThan(0);
    expect(rightSideVolume).toBeGreaterThan(0);

    // Verify 2: Depths on left side have drawn down (< 4.0m)
    const midLeftDepth = sim.depth[5 * width + 5];
    expect(midLeftDepth).toBeLessThan(4.0);

    // Verify 3: Strict mass conservation throughout the shockwave
    let finalTotalVolume = 0;
    for (let i = 0; i < sim.depth.length; i++) {
      finalTotalVolume += sim.depth[i] * cellArea;
    }

    const volumeDiff = Math.abs(finalTotalVolume - initialTotalVolume);
    expect(volumeDiff).toBeLessThan(1.0); // Less than 1 m^3 out of 4000 m^3 (0.025%)

    // Verify 4: Mean depth in the basin matches expected 2.0m exactly
    const calculatedMeanDepth = finalTotalVolume / (width * height * cellArea);
    expect(calculatedMeanDepth).toBeCloseTo(expectedMeanDepth, 3);
  });
});
