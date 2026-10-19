/**
 * 2D Shallow Water Hydraulic Solver
 *
 * Implements the Bates et al. (2010) / de Almeida et al. (2012)
 * local-inertial formulation of the 2D Saint-Venant shallow water equations.
 *
 * Highly stable, mass-conserving, and computationally efficient for
 * overland flood routing, flash floods, and river overtopping.
 *
 * Features:
 * - Local-inertial flow equation with semi-implicit Manning's friction
 * - Adaptive CFL timestep calculation
 * - Inflow hydrograph injection (constant, rising-falling curve, or custom series)
 * - Uniform rainfall hyetograph (mm/hr)
 * - Free outflow or closed reflective boundary conditions
 * - Exact mass conservation accounting with error percentage logging
 */

import {
  FrameStats,
  HydrographPreset,
  InflowPoint,
  SimulationConfig,
  SimulationFrame,
} from '../types';

const GRAVITY = 9.80665;
const MIN_DEPTH_METERS = 0.001; // 1 mm dry threshold

/**
 * Calculate instantaneous discharge Q (m^3/s) for an inflow point at time t (seconds).
 */
export function calculateInflowDischarge(
  inflow: InflowPoint,
  timeSeconds: number,
  eventDurationSeconds: number,
  preset: HydrographPreset,
  startSeconds = 0
): number {
  timeSeconds -= startSeconds;
  if (timeSeconds < 0) return 0;
  const base = inflow.baseDischarge;
  const peakMult = inflow.peakMultiplier ?? 2.5;

  if (preset === 'custom' && inflow.customHydrograph && inflow.customHydrograph.length > 0) {
    const pts = inflow.customHydrograph;
    if (timeSeconds < pts[0].timeSeconds) return 0;
    if (pts.length > 1 && timeSeconds >= pts[pts.length - 1].timeSeconds) return 0;
    if (timeSeconds <= pts[0].timeSeconds) return pts[0].dischargeM3PerSec;
    if (timeSeconds > pts[pts.length - 1].timeSeconds) return 0;
    if (timeSeconds === pts[pts.length - 1].timeSeconds) return pts[pts.length - 1].dischargeM3PerSec;

    // Linear interpolation
    for (let i = 0; i < pts.length - 1; i++) {
      if (timeSeconds >= pts[i].timeSeconds && timeSeconds <= pts[i + 1].timeSeconds) {
        const factor = (timeSeconds - pts[i].timeSeconds) / (pts[i + 1].timeSeconds - pts[i].timeSeconds);
        return pts[i].dischargeM3PerSec + factor * (pts[i + 1].dischargeM3PerSec - pts[i].dischargeM3PerSec);
      }
    }
    return base;
  }

  if (timeSeconds >= eventDurationSeconds) return 0;

  if (preset === 'constant') {
    return base;
  }

  if (preset === 'rising_falling') {
    // Triangular/gamma shaped hydrograph peaking at 35% of total duration
    const peakTime = eventDurationSeconds * 0.35;
    const baseFlow = base * 0.2;
    const peakFlow = base * peakMult;

    if (timeSeconds < peakTime) {
      // Rising limb
      const tNorm = timeSeconds / peakTime;
      return baseFlow + (peakFlow - baseFlow) * Math.sin((tNorm * Math.PI) / 2);
    } else {
      // Falling recession limb
      const decayTime = eventDurationSeconds - peakTime;
      const tRecession = (timeSeconds - peakTime) / decayTime;
      const expDecay = Math.exp(-3.0 * tRecession);
      return baseFlow + (peakFlow - baseFlow) * expDecay;
    }
  }

  if (preset === 'flash_flood') {
    // Sharp rapid rise peaking at 15% of duration with steep wave front
    const peakTime = eventDurationSeconds * 0.15;
    const peakFlow = base * peakMult * 1.5;
    if (timeSeconds < peakTime) {
      return base + (peakFlow - base) * Math.pow(timeSeconds / peakTime, 2);
    } else {
      const tPost = (timeSeconds - peakTime) / (eventDurationSeconds - peakTime);
      return base + (peakFlow - base) * Math.exp(-4.5 * tPost);
    }
  }

  return base;
}

export class HydraulicSimulator {
  readonly width: number;
  readonly height: number;
  readonly dx: number;
  readonly dy: number;
  readonly cellArea: number; // dx * dy (m^2)
  readonly elevation: Float32Array;
  readonly config: SimulationConfig;
  readonly solidMask: Uint8Array;
  readonly fluidCellCount: number;

  // State arrays:
  // Water depth h (meters) at cell centers
  readonly depth: Float32Array;
  // Unit discharge qx (m^2/s) at east faces: size = (width + 1) * height
  readonly qx: Float32Array;
  // Unit discharge qy (m^2/s) at south faces: size = width * (height + 1)
  readonly qy: Float32Array;

  // Mass accounting
  initialWaterVolumeM3 = 0.0;
  totalInflowVolumeM3 = 0.0;
  totalRainfallVolumeM3 = 0.0;
  totalOutflowVolumeM3 = 0.0;

  currentTime = 0.0;
  frameCounter = 0;

  constructor(
    width: number,
    height: number,
    dx: number,
    dy: number,
    elevation: Float32Array,
    config: SimulationConfig,
    initialDepth?: Float32Array,
    solidMask?: Uint8Array
  ) {
    this.width = width;
    this.height = height;
    this.dx = dx;
    this.dy = dy;
    this.cellArea = dx * dy;
    this.elevation = elevation;
    this.config = config;

    const cellCount = width * height;
    if (solidMask && solidMask.length !== cellCount) throw new Error('Building mask size does not match the grid');
    if (initialDepth && initialDepth.length !== cellCount) throw new Error('Initial water depth size does not match the grid');
    this.solidMask = solidMask ? new Uint8Array(solidMask) : new Uint8Array(cellCount);
    this.fluidCellCount = this.solidMask.reduce((count, solid) => count + (solid ? 0 : 1), 0);
    this.depth = new Float32Array(cellCount);
    if (initialDepth) {
      for (let i = 0; i < cellCount; i++) {
        if (!Number.isFinite(initialDepth[i]) || initialDepth[i] < 0) {
          throw new Error('Initial water depths must be finite and non-negative');
        }
        // Solid interiors have no hydraulic storage, including at t=0.
        this.depth[i] = this.solidMask[i] ? 0 : initialDepth[i];
        this.initialWaterVolumeM3 += this.depth[i] * this.cellArea;
      }
    }
    this.qx = new Float32Array((width + 1) * height);
    this.qy = new Float32Array(width * (height + 1));
  }

  /**
   * Compute adaptive CFL time step:
   * dt = alpha * dx / (sqrt(g * h_max) + |v_max|)
   */
  computeAdaptiveTimestep(hMax: number, vMax: number): number {
    const cfl = this.config.cflFactor || 0.7;
    const minDx = Math.min(this.dx, this.dy);

    const waveSpeed = Math.sqrt(GRAVITY * Math.max(hMax, 0.01));
    const denom = waveSpeed + vMax + 1e-4;
    const maxStableDt = (cfl * minDx) / denom;

    // Clamp between 0.05s and 5.0s
    return Math.max(0.05, Math.min(5.0, maxStableDt));
  }

  /**
   * Step the simulation forward by deltaT seconds using Bates et al. (2010) formulation.
   */
  step(dt: number): void {
    const { width, height, dx, dy, elevation, depth, qx, qy } = this;
    const n = Math.max(0.01, this.config.manningsN);
    const g = GRAVITY;
    const isOpenBoundary = this.config.boundaryType === 'open';

    // 1. Update X-fluxes (qx at cell interfaces between (x, y) and (x+1, y))
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width - 1; x++) {
        const idxL = y * width + x;
        const idxR = y * width + (x + 1);
        const qIdx = y * (width + 1) + (x + 1);
        if (this.solidMask[idxL] || this.solidMask[idxR]) {
          qx[qIdx] = 0;
          continue;
        }

        const zL = elevation[idxL];
        const zR = elevation[idxR];
        const hL = depth[idxL];
        const hR = depth[idxR];

        const etaL = zL + hL;
        const etaR = zR + hR;

        // Effective flow depth between the two cells
        const hFlow = Math.max(0, Math.max(etaL, etaR) - Math.max(zL, zR));

        if (hFlow < MIN_DEPTH_METERS) {
          qx[qIdx] = 0.0;
          continue;
        }

        // Water surface slope: -d(eta)/dx
        const dhdx = (etaR - etaL) / dx;
        const qPrev = qx[qIdx];

        // Semi-implicit friction term: 1 + g * dt * n^2 * |q| / (h_flow^(7/3))
        const hPow = Math.pow(hFlow, 7.0 / 3.0);
        const frictionCoeff = 1.0 + (g * dt * n * n * Math.abs(qPrev)) / Math.max(1e-4, hPow);

        // Numerator: q_prev - g * h_flow * dt * (dh/dx)
        let qNext = (qPrev - g * hFlow * dt * dhdx) / frictionCoeff;

        // Froude number limiter: |v| <= sqrt(g * h_flow) to prevent unphysical supercritical shock
        const maxQ = hFlow * Math.sqrt(g * hFlow);
        if (qNext > maxQ) qNext = maxQ;
        else if (qNext < -maxQ) qNext = -maxQ;

        qx[qIdx] = qNext;
      }

      // X-boundaries (West at x=0, East at x=width)
      const qIdxWest = y * (width + 1);
      const qIdxEast = y * (width + 1) + width;

      if (isOpenBoundary) {
        // Free weir/gradient outflow
        const hWest = depth[y * width];
        if (!this.solidMask[y * width] && hWest > MIN_DEPTH_METERS) {
          qx[qIdxWest] = -hWest * Math.min(2.0, Math.sqrt(g * hWest));
        } else {
          qx[qIdxWest] = 0;
        }

        const hEast = depth[y * width + (width - 1)];
        if (!this.solidMask[y * width + width - 1] && hEast > MIN_DEPTH_METERS) {
          qx[qIdxEast] = hEast * Math.min(2.0, Math.sqrt(g * hEast));
        } else {
          qx[qIdxEast] = 0;
        }
      } else {
        qx[qIdxWest] = 0.0;
        qx[qIdxEast] = 0.0;
      }
    }

    // 2. Update Y-fluxes (qy at cell interfaces between (x, y) and (x, y+1))
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width; x++) {
        const idxT = y * width + x;
        const idxB = (y + 1) * width + x;
        const qIdx = (y + 1) * width + x;
        if (this.solidMask[idxT] || this.solidMask[idxB]) {
          qy[qIdx] = 0;
          continue;
        }

        const zT = elevation[idxT];
        const zB = elevation[idxB];
        const hT = depth[idxT];
        const hB = depth[idxB];

        const etaT = zT + hT;
        const etaB = zB + hB;

        const hFlow = Math.max(0, Math.max(etaT, etaB) - Math.max(zT, zB));

        if (hFlow < MIN_DEPTH_METERS) {
          qy[qIdx] = 0.0;
          continue;
        }

        const dhdy = (etaB - etaT) / dy;
        const qPrev = qy[qIdx];

        const hPow = Math.pow(hFlow, 7.0 / 3.0);
        const frictionCoeff = 1.0 + (g * dt * n * n * Math.abs(qPrev)) / Math.max(1e-4, hPow);

        let qNext = (qPrev - g * hFlow * dt * dhdy) / frictionCoeff;

        const maxQ = hFlow * Math.sqrt(g * hFlow);
        if (qNext > maxQ) qNext = maxQ;
        else if (qNext < -maxQ) qNext = -maxQ;

        qy[qIdx] = qNext;
      }
    }

    // Y-boundaries (North at y=0, South at y=height)
    for (let x = 0; x < width; x++) {
      const qIdxNorth = x;
      const qIdxSouth = height * width + x;

      if (isOpenBoundary) {
        const hNorth = depth[x];
        if (!this.solidMask[x] && hNorth > MIN_DEPTH_METERS) {
          qy[qIdxNorth] = -hNorth * Math.min(2.0, Math.sqrt(g * hNorth));
        } else {
          qy[qIdxNorth] = 0;
        }

        const hSouth = depth[(height - 1) * width + x];
        if (!this.solidMask[(height - 1) * width + x] && hSouth > MIN_DEPTH_METERS) {
          qy[qIdxSouth] = hSouth * Math.min(2.0, Math.sqrt(g * hSouth));
        } else {
          qy[qIdxSouth] = 0;
        }
      } else {
        qy[qIdxNorth] = 0.0;
        qy[qIdxSouth] = 0.0;
      }
    }

    // 3. Continuity equation: update water depth h
    // dh/dt + dqx/dx + dqy/dy = Sources (Rainfall + Point Inflows)
    const invDx = 1.0 / dx;
    const invDy = 1.0 / dy;

    // Two-pass exact donor-cell flux limiter (Bates et al. 2010 / Almeida et al. 2012)
    // Guarantees strict non-negativity (h >= 0) and exact mass conservation
    const alpha = new Float32Array(width * height).fill(1.0);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const hAvailable = depth[idx];

        if (hAvailable <= 0) {
          alpha[idx] = 0.0;
          continue;
        }

        const qxLeft = qx[y * (width + 1) + x];
        const qxRight = qx[y * (width + 1) + (x + 1)];
        const qyTop = qy[y * width + x];
        const qyBottom = qy[(y + 1) * width + x];

        // Total rate of water leaving this donor cell
        const outRate =
          (Math.max(0, qxRight) + Math.max(0, -qxLeft)) * invDx +
          (Math.max(0, qyBottom) + Math.max(0, -qyTop)) * invDy;

        const totalOutWater = outRate * dt;

        if (totalOutWater > hAvailable && totalOutWater > 1e-7) {
          alpha[idx] = hAvailable / totalOutWater;
        } else {
          alpha[idx] = 1.0;
        }
      }
    }

    // Apply donor cell scaling to all face fluxes
    // X-faces
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width - 1; x++) {
        const qIdx = y * (width + 1) + (x + 1);
        const qVal = qx[qIdx];
        if (qVal > 0) {
          // Flow from (x, y) to (x+1, y) -> donor is (x, y)
          qx[qIdx] *= alpha[y * width + x];
        } else if (qVal < 0) {
          // Flow from (x+1, y) to (x, y) -> donor is (x+1, y)
          qx[qIdx] *= alpha[y * width + (x + 1)];
        }
      }
    }

    // Y-faces
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width; x++) {
        const qIdx = (y + 1) * width + x;
        const qVal = qy[qIdx];
        if (qVal > 0) {
          // Flow from (x, y) to (x, y+1) -> donor is (x, y)
          qy[qIdx] *= alpha[y * width + x];
        } else if (qVal < 0) {
          // Flow from (x, y+1) to (x, y) -> donor is (x, y+1)
          qy[qIdx] *= alpha[(y + 1) * width + x];
        }
      }
    }

    // Limit exterior faces too, and account for the water actually discharged.
    for (let y = 0; y < height; y++) {
      const west = y * (width + 1), east = west + width;
      qx[west] *= alpha[y * width];
      qx[east] *= alpha[y * width + width - 1];
      this.totalOutflowVolumeM3 += (-qx[west] + qx[east]) * dy * dt;
    }
    for (let x = 0; x < width; x++) {
      const south = height * width + x;
      qy[x] *= alpha[x];
      qy[south] *= alpha[(height - 1) * width + x];
      this.totalOutflowVolumeM3 += (-qy[x] + qy[south]) * dx * dt;
    }

    // Rainfall source term in meters/second (roof runoff is not modeled).
    let rainRateMetersPerSec = 0.0;
    if (
      this.config.rainfall &&
      this.config.rainfall.intensityMmPerHour > 0 &&
      this.currentTime < this.config.rainfall.durationSeconds
    ) {
      const rainySeconds = Math.max(0, Math.min(dt, this.config.rainfall.durationSeconds - this.currentTime));
      rainRateMetersPerSec = (this.config.rainfall.intensityMmPerHour / 1000.0) / 3600.0 * rainySeconds / dt;
      this.totalRainfallVolumeM3 += rainRateMetersPerSec * this.cellArea * this.fluidCellCount * dt;
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;

        if (this.solidMask[idx]) continue;
        const qxLeft = qx[y * (width + 1) + x];
        const qxRight = qx[y * (width + 1) + (x + 1)];

        const qyTop = qy[y * width + x];
        const qyBottom = qy[(y + 1) * width + x];

        const netFluxX = (qxLeft - qxRight) * invDx;
        const netFluxY = (qyTop - qyBottom) * invDy;

        let hNew = depth[idx] + dt * (netFluxX + netFluxY + rainRateMetersPerSec);
        if (hNew < 0) hNew = 0;

        depth[idx] = hNew;
      }
    }

    // 4. Inflow source injection
    if (this.config.inflows && this.config.inflows.length > 0) {
      for (const inflow of this.config.inflows) {
        const discharge = calculateInflowDischarge(
          inflow,
          this.currentTime,
          this.config.hydrographDurationSeconds ?? 3600,
          this.config.inflowPreset,
          this.config.hydrographStartSeconds ?? 0
        );

        if (discharge > 0) {
          const gx = Math.max(0, Math.min(width - 1, inflow.gridX));
          const gy = Math.max(0, Math.min(height - 1, inflow.gridY));

          // Distribute inflow discharge smoothly across 3x3 kernel around source
          const kernelRadius = 1;
          let cellCountInKernel = 0;

          for (let ky = -kernelRadius; ky <= kernelRadius; ky++) {
            for (let kx = -kernelRadius; kx <= kernelRadius; kx++) {
              const nx = gx + kx;
              const ny = gy + ky;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height && !this.solidMask[ny * width + nx]) {
                cellCountInKernel++;
              }
            }
          }

          if (cellCountInKernel === 0) throw new Error(`Inflow ${inflow.id} is entirely inside building obstacles; move the inlet`);
          const dischargePerCell = discharge / cellCountInKernel;
          const addedDepth = (dischargePerCell * dt) / this.cellArea;

          for (let ky = -kernelRadius; ky <= kernelRadius; ky++) {
            for (let kx = -kernelRadius; kx <= kernelRadius; kx++) {
              const nx = gx + kx;
              const ny = gy + ky;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height && !this.solidMask[ny * width + nx]) {
                depth[ny * width + nx] += addedDepth;
              }
            }
          }

          this.totalInflowVolumeM3 += discharge * dt;
        }
      }
    }

    this.currentTime += dt;
  }

  /**
   * Produce a SimulationFrame snapshot with depth, velocity fields, and mass conservation statistics.
   */
  generateFrame(): SimulationFrame {
    const { width, height, depth, qx, qy } = this;
    const size = width * height;

    const depthCopy = new Float32Array(depth);
    const velocity = new Float32Array(size);
    const vx = new Float32Array(size);
    const vy = new Float32Array(size);

    let maxD = 0;
    let sumD = 0;
    let floodedCellCount = 0;
    let currentVolumeM3 = 0;
    const threshold = this.config.minWaterDepthThreshold || 0.01;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const d = depthCopy[idx];

        if (d > maxD) maxD = d;
        sumD += d;
        currentVolumeM3 += d * this.cellArea;

        if (d >= threshold) {
          floodedCellCount++;

          // Average face fluxes to get cell center unit discharge
          const qxL = qx[y * (width + 1) + x];
          const qxR = qx[y * (width + 1) + (x + 1)];
          const qyT = qy[y * width + x];
          const qyB = qy[(y + 1) * width + x];

          const cellQx = (qxL + qxR) * 0.5;
          const cellQy = (qyT + qyB) * 0.5;

          const velX = cellQx / d;
          const velY = cellQy / d;
          const speed = Math.sqrt(velX * velX + velY * velY);

          vx[idx] = velX;
          vy[idx] = velY;
          velocity[idx] = speed;
        }
      }
    }

    const floodedAreaKm2 = (floodedCellCount * this.cellArea) / 1_000_000;
    const totalAdded = this.initialWaterVolumeM3 + this.totalInflowVolumeM3 + this.totalRainfallVolumeM3;
    const netVolume = currentVolumeM3 + this.totalOutflowVolumeM3;

    // Mass balance error: relative difference between volume added and tracked volume
    let massErrorPct = 0;
    if (totalAdded > 0) {
      massErrorPct = (Math.abs(netVolume - totalAdded) / totalAdded) * 100.0;
    }

    const stats: FrameStats = {
      maxDepth: maxD,
      meanDepth: this.fluidCellCount > 0 ? sumD / this.fluidCellCount : 0,
      floodedAreaKm2,
      totalWaterVolumeM3: currentVolumeM3,
      massConservationErrorPct: Math.min(100, massErrorPct),
      affectedBuildingsCount: 0, // Populated by building analysis
      affectedRoadsKm: 0,
    };

    return {
      frameIndex: this.frameCounter++,
      simulatedTimeSeconds: this.currentTime,
      depth: depthCopy,
      velocity,
      vx,
      vy,
      stats,
    };
  }
}
