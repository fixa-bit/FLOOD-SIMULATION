import { describe, it, expect } from 'vitest';
import { HydraulicSimulator } from '../src/core/sim/shallowWater';
import { SimulationConfig } from '../src/core/types';

describe('Mass Conservation Hydraulic Tests', () => {
  it('conserves 100% of water mass with point inflow under closed boundaries', () => {
    const width = 32;
    const height = 32;
    const dx = 10; // 10m cell width
    const dy = 10; // 10m cell height
    const cellArea = dx * dy; // 100 m^2

    // Flat terrain elevation
    const elevation = new Float32Array(width * height).fill(100.0);

    const config: SimulationConfig = {
      gridSize: 256,
      bounds: { west: 72, south: 34, east: 72.1, north: 34.1 },
      duration: 120, // 120 seconds
      outputInterval: 30,
      manningsN: 0.035,
      verticalExaggeration: 1.0,
      boundaryType: 'closed', // Closed reflective boundaries: 0 mass loss
      inflowPreset: 'constant',
      inflows: [
        {
          id: 'test_inflow',
          gridX: 16,
          gridY: 16,
          lon: 72.05,
          lat: 34.05,
          baseDischarge: 50.0, // 50 m3/s
        },
      ],
      rainfall: { intensityMmPerHour: 0, durationSeconds: 0 },
      cflFactor: 0.7,
      minWaterDepthThreshold: 0.001,
    };

    const sim = new HydraulicSimulator(width, height, dx, dy, elevation, config);

    // Step simulation forward to 120 seconds
    const totalSimTime = 120;
    while (sim.currentTime < totalSimTime) {
      let maxD = 0;
      for (let i = 0; i < sim.depth.length; i++) {
        if (sim.depth[i] > maxD) maxD = sim.depth[i];
      }
      const dt = sim.computeAdaptiveTimestep(maxD, 1.0);
      const stepDt = Math.min(dt, totalSimTime - sim.currentTime);
      sim.step(stepDt);
    }

    // Expected volume = 50 m3/s * 120s = 6000 m3
    const expectedVolumeM3 = 50.0 * 120.0;

    // Calculate actual volume in domain
    let actualVolumeM3 = 0.0;
    for (let i = 0; i < sim.depth.length; i++) {
      actualVolumeM3 += sim.depth[i] * cellArea;
    }

    const relativeError = Math.abs(actualVolumeM3 - expectedVolumeM3) / expectedVolumeM3;

    // Assert conservation error is less than 0.05%
    expect(relativeError).toBeLessThan(0.0005);
  });

  it('conserves mass under uniform rainfall across domain', () => {
    const width = 20;
    const height = 20;
    const dx = 25;
    const dy = 25;
    const cellArea = dx * dy;
    const totalDomainArea = width * height * cellArea; // 20 * 20 * 625 = 250,000 m^2

    const elevation = new Float32Array(width * height).fill(50.0);

    const config: SimulationConfig = {
      gridSize: 256,
      bounds: { west: 0, south: 0, east: 0.01, north: 0.01 },
      duration: 60, // 60 seconds
      outputInterval: 30,
      manningsN: 0.03,
      verticalExaggeration: 1.0,
      boundaryType: 'closed',
      inflowPreset: 'constant',
      inflows: [],
      rainfall: {
        intensityMmPerHour: 36, // 36 mm/hr = 0.01 mm/s = 1e-5 m/s
        durationSeconds: 60,
      },
      cflFactor: 0.7,
      minWaterDepthThreshold: 0.001,
    };

    const sim = new HydraulicSimulator(width, height, dx, dy, elevation, config);

    // Step 60 seconds
    const totalSimTime = 60;
    while (sim.currentTime < totalSimTime) {
      const dt = sim.computeAdaptiveTimestep(0.1, 0.1);
      const stepDt = Math.min(dt, totalSimTime - sim.currentTime);
      sim.step(stepDt);
    }

    // Expected rain depth: (36 mm / 1000) / 3600 * 60s = 0.0006 m (0.6 mm)
    const expectedRainDepth = (36 / 1000 / 3600) * 60;
    const expectedVolume = expectedRainDepth * totalDomainArea;

    let actualVolume = 0;
    for (let i = 0; i < sim.depth.length; i++) {
      actualVolume += sim.depth[i] * cellArea;
    }

    const relError = Math.abs(actualVolume - expectedVolume) / expectedVolume;
    expect(relError).toBeLessThan(0.001);
  });
});
