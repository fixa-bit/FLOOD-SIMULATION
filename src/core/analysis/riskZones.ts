import { RiskLevel } from '../types';

/**
 * Hydraulic Risk Zone Classification
 * Based on hydraulic hazard rating H = Depth (m) x Velocity (m/s).
 */

export function calculateRiskLevel(depth: number, velocity: number): RiskLevel {
  if (depth < 0.05) {
    return 'none';
  }

  const dv = depth * velocity;

  // High hazard: deep water >= 1.0m or high energy dv >= 0.6 m^2/s (danger to life and structures)
  if (depth >= 1.0 || dv >= 0.6) {
    return 'high';
  }

  // Medium hazard: depth >= 0.3m or dv >= 0.3 m^2/s (danger to vehicles and wading adults)
  if (depth >= 0.3 || dv >= 0.3) {
    return 'medium';
  }

  // Low hazard: shallow flow
  return 'low';
}

/**
 * Generate a risk grid (0: none, 1: low, 2: medium, 3: high) for rendering.
 */
export function generateRiskGrid(
  depth: Float32Array,
  velocity: Float32Array,
  size: number
): Uint8Array {
  const riskGrid = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    const d = depth[i];
    if (d < 0.05) {
      riskGrid[i] = 0;
      continue;
    }
    const v = velocity[i];
    const dv = d * v;

    if (d >= 1.0 || dv >= 0.6) {
      riskGrid[i] = 3; // High
    } else if (d >= 0.3 || dv >= 0.3) {
      riskGrid[i] = 2; // Medium
    } else {
      riskGrid[i] = 1; // Low
    }
  }

  return riskGrid;
}
