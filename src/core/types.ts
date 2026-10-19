/**
 * FloodSim Core Types
 * Pure TypeScript definitions with zero DOM/React dependencies.
 * Designed for reuse in Web Workers, Node.js, and external integrations (FloodGuard).
 */

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type BoundaryType = 'open' | 'closed';

export type HydrographPreset = 'constant' | 'rising_falling' | 'flash_flood' | 'custom';

export interface HydrographPoint {
  timeSeconds: number;
  dischargeM3PerSec: number;
}

export interface InflowPoint {
  id: string;
  gridX: number;
  gridY: number;
  lon: number;
  lat: number;
  label?: string;
  /** Base discharge in m^3/s */
  baseDischarge: number;
  /** Peak multiplier for the hydrograph */
  peakMultiplier?: number;
  /** Optional custom hydrograph time-series */
  customHydrograph?: HydrographPoint[];
  /** River channel cross-section cells across the upstream inlet */
  inletCells?: { gridX: number; gridY: number }[];
}

export interface RainfallConfig {
  /** Uniform rainfall intensity in mm/hour */
  intensityMmPerHour: number;
  /** Duration in seconds during which rain falls */
  durationSeconds: number;
}

export interface SimulationConfig {
  /** Grid resolution along each axis (e.g., 256 or 512) */
  gridSize: 256 | 512;
  /** Bounding box in WGS84 coordinates */
  bounds: BoundingBox;
  /** Total simulated duration in seconds (e.g., 3600 for 1 hour) */
  duration: number;
  /** Interval in simulated seconds between recorded frames */
  outputInterval: number;
  /** Manning's roughness coefficient n (default 0.035 s/m^(1/3)) */
  manningsN: number;
  /** Vertical exaggeration multiplier for 3D display (1x - 5x) */
  verticalExaggeration: number;
  /** Boundary condition type */
  boundaryType: BoundaryType;
  /** Inflow source locations */
  inflows: InflowPoint[];
  /** Hydrograph curve type */
  inflowPreset: HydrographPreset;
  /** Rainfall input */
  rainfall: RainfallConfig;
  /** CFL stability safety factor (0.1 to 0.9, default 0.7) */
  cflFactor: number;
  /** Minimum water depth threshold to consider a cell flooded (meters, default 0.01) */
  minWaterDepthThreshold: number;
}

export interface FrameStats {
  maxDepth: number;
  meanDepth: number;
  floodedAreaKm2: number;
  totalWaterVolumeM3: number;
  massConservationErrorPct: number;
  affectedBuildingsCount: number;
  affectedRoadsKm: number;
}

export interface SimulationFrame {
  frameIndex: number;
  simulatedTimeSeconds: number;
  /** Float32Array of water depths in meters, length = width * height */
  depth: Float32Array;
  /** Float32Array of velocity magnitudes in m/s */
  velocity: Float32Array;
  /** Velocity x component (m/s) */
  vx: Float32Array;
  /** Velocity y component (m/s) */
  vy: Float32Array;
  stats: FrameStats;
}

export interface DemData {
  width: number;
  height: number;
  bounds: BoundingBox;
  /** Cell size along X in meters */
  dx: number;
  /** Cell size along Y in meters */
  dy: number;
  /** Elevation values in meters above sea level */
  elevation: Float32Array;
  minElevation: number;
  maxElevation: number;
  /** Optional initial depth in meters per grid sample. Finite, non-negative;
   * solid building interiors are excluded. The default DEM loader leaves this unset. */
  initialWaterDepth?: Float32Array;
  /** Binary mask where 1 represents natural river channel bed */
  riverMask?: Uint8Array;
}

export interface OsmBuilding {
  id: string;
  polygon: [number, number][]; // [lon, lat] coordinates
  height: number;              // Estimated building height in meters
  gridX: number;
  gridY: number;
  elevation: number;
  isFlooded: boolean;
  maxWaterDepth: number;
}

export interface OsmRoad {
  id: string;
  name: string;
  type: string;
  coordinates: [number, number][]; // [lon, lat] points
  lengthMeters: number;
  isFlooded: boolean;
  maxWaterDepth: number;
}

export type RiskLevel = 'none' | 'low' | 'medium' | 'high';

export interface CellInspectionData {
  gridX: number;
  gridY: number;
  lon: number;
  lat: number;
  elevationMeters: number;
  currentWaterDepthMeters: number;
  currentVelocityMetersPerSec: number;
  riskLevel: RiskLevel;
  /** Time series of depth at this cell across all recorded frames */
  depthTimeSeries: { timeSeconds: number; depthMeters: number; velocityMetersPerSec: number }[];
}

export interface PresetArea {
  id: string;
  name: string;
  region: string;
  description: string;
  bounds: BoundingBox;
  recommendedInflows: Omit<InflowPoint, 'id'>[];
  recommendedDuration: number;
  recommendedRainfall: RainfallConfig;
}

/** Messages sent from Main Thread to Sim Worker */
export type WorkerInMessage =
  | {
      type: 'START_SIMULATION';
      config: SimulationConfig;
      elevation: Float32Array;
      width: number;
      height: number;
      dx: number;
      dy: number;
      buildings?: OsmBuilding[];
      roads?: OsmRoad[];
      initialWaterDepth?: Float32Array;
    }
  | { type: 'CANCEL_SIMULATION' };

/** Messages sent from Sim Worker to Main Thread */
export type WorkerOutMessage =
  | {
      type: 'FRAME';
      frame: SimulationFrame;
    }
  | {
      type: 'PROGRESS';
      percent: number;
      simulatedTimeSeconds: number;
      totalDurationSeconds: number;
      currentTimestep: number;
    }
  | {
      type: 'FINISHED';
      totalFrames: number;
      summaryStats: FrameStats;
    }
  | {
      type: 'ERROR';
      error: string;
    };
