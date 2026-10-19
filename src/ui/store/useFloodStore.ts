import { create } from 'zustand';
import {
  BoundingBox,
  DemData,
  OsmBuilding,
  OsmRoad,
  SimulationConfig,
  SimulationFrame,
  CellInspectionData,
  InflowPoint,
  WorkerOutMessage,
  WorkerInMessage,
} from '../../core/types';
import { PRESET_AREAS } from '../../core/terrain/presetAreas';
import { fetchAndProcessDem } from '../../core/terrain/tileFetcher';
import { fetchOsmStructures } from '../../core/analysis/buildingAnalysis';
import { computeFlowAccumulation, gridToLonLat } from '../../core/terrain/flowAccum';
import { TextureMode } from '../../viewer/textureFetcher';
import { generateSummaryReport, exportFloodExtentGeoJson } from '../../core/analysis/geoJsonExporter';

export type SimStatus =
  | 'idle'
  | 'loading_terrain'
  | 'ready'
  | 'simulating'
  | 'paused'
  | 'finished'
  | 'error';

interface FloodState {
  // Area & Terrain
  currentPresetId: string;
  bounds: BoundingBox;
  dem: DemData | null;
  buildings: OsmBuilding[];
  roads: OsmRoad[];
  suggestedInflow: InflowPoint | null;

  // Configuration
  config: SimulationConfig;

  // Simulation Status & Progress
  status: SimStatus;
  errorMessage: string | null;
  progressPercent: number;
  progressStage: string;

  // Frame Buffer & Playback
  frames: SimulationFrame[];
  currentFrameIndex: number;
  isPlaying: boolean;
  playbackSpeed: 1 | 2 | 4 | 8;
  isLooping: boolean;

  // Inspection
  inspectedCell: CellInspectionData | null;

  // Viewer Settings
  is2DMode: boolean;
  textureMode: TextureMode;
  waterLayerMode: number;
  maxDepthLegend: number;
  verticalExaggeration: number;
  layersVisible: {
    water: boolean;
    buildings: boolean;
    roads: boolean;
    velocity: boolean;
    riskZones: boolean;
  };

  // Worker handle
  worker: Worker | null;

  // Actions
  setBounds: (bounds: BoundingBox) => void;
  loadPreset: (presetId: string) => Promise<void>;
  loadTerrainForBounds: (bounds: BoundingBox, gridSize?: 256 | 512) => Promise<void>;
  updateConfig: (patch: Partial<SimulationConfig>) => void;
  setInflows: (inflows: InflowPoint[]) => void;
  addInflow: (inflow: InflowPoint) => void;
  removeInflow: (id: string) => void;

  startSimulation: () => void;
  cancelSimulation: () => void;
  resetSimulation: () => void;

  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seekFrame: (index: number) => void;
  setPlaybackSpeed: (speed: 1 | 2 | 4 | 8) => void;
  toggleLoop: () => void;

  setInspectedCell: (data: any) => void;
  clearInspectedCell: () => void;

  setIs2DMode: (is2D: boolean) => void;
  setTextureMode: (mode: TextureMode) => void;
  setWaterLayerMode: (mode: number) => void;
  setMaxDepthLegend: (depth: number) => void;
  setVerticalExaggeration: (exaggeration: number) => void;
  toggleLayer: (layer: 'water' | 'buildings' | 'roads' | 'velocity' | 'riskZones') => void;

  exportSummaryJson: () => string | null;
  exportGeoJsonFile: () => string | null;
}

const DEFAULT_PRESET = PRESET_AREAS[0];

export const useFloodStore = create<FloodState>((set, get) => ({
  currentPresetId: DEFAULT_PRESET.id,
  bounds: DEFAULT_PRESET.bounds,
  dem: null,
  buildings: [],
  roads: [],
  suggestedInflow: null,

  config: {
    gridSize: 256,
    bounds: DEFAULT_PRESET.bounds,
    duration: DEFAULT_PRESET.recommendedDuration,
    outputInterval: 30, // 30s per frame
    manningsN: 0.035,
    verticalExaggeration: 1.5,
    boundaryType: 'open',
    inflows: DEFAULT_PRESET.recommendedInflows.map((inf, idx) => ({
      ...inf,
      id: `inflow_${idx + 1}`,
    })),
    inflowPreset: 'rising_falling',
    rainfall: DEFAULT_PRESET.recommendedRainfall,
    cflFactor: 0.7,
    minWaterDepthThreshold: 0.02,
  },

  status: 'idle',
  errorMessage: null,
  progressPercent: 0,
  progressStage: 'Select area to begin',

  frames: [],
  currentFrameIndex: 0,
  isPlaying: false,
  playbackSpeed: 1,
  isLooping: true,

  inspectedCell: null,

  is2DMode: false,
  textureMode: 'satellite',
  waterLayerMode: 0,
  maxDepthLegend: 3.0,
  verticalExaggeration: 1.5,
  layersVisible: {
    water: true,
    buildings: true,
    roads: true,
    velocity: false,
    riskZones: false,
  },

  worker: null,

  setBounds: (bounds) => {
    set((state) => ({
      bounds,
      config: { ...state.config, bounds },
    }));
  },

  loadPreset: async (presetId) => {
    const preset = PRESET_AREAS.find((p) => p.id === presetId) || PRESET_AREAS[0];
    set({
      currentPresetId: preset.id,
      bounds: preset.bounds,
      config: {
        ...get().config,
        bounds: preset.bounds,
        duration: preset.recommendedDuration,
        inflows: preset.recommendedInflows.map((inf, idx) => ({
          ...inf,
          id: `inflow_${idx + 1}`,
        })),
        rainfall: preset.recommendedRainfall,
      },
      frames: [],
      currentFrameIndex: 0,
      isPlaying: false,
      inspectedCell: null,
    });

    await get().loadTerrainForBounds(preset.bounds, get().config.gridSize);
  },

  loadTerrainForBounds: async (bounds, gridSize = 256) => {
    set({
      status: 'loading_terrain',
      progressPercent: 5,
      progressStage: 'Initializing terrain fetcher...',
      errorMessage: null,
      frames: [],
      currentFrameIndex: 0,
      isPlaying: false,
      inspectedCell: null,
    });

    try {
      // 1. Fetch & decode DEM
      const dem = await fetchAndProcessDem(bounds, gridSize, (pct, stage) => {
        set({ progressPercent: pct, progressStage: stage });
      });

      // 2. Fetch OSM infrastructure
      const { buildings, roads } = await fetchOsmStructures(
        bounds,
        dem.elevation,
        gridSize,
        gridSize,
        (stage) => set({ progressStage: stage })
      );

      // 3. Compute D8 flow accumulation to suggest optimal river channel inlet
      set({ progressStage: 'Calculating hydrological flow networks...' });
      const flowRes = computeFlowAccumulation(dem.elevation, gridSize, gridSize, dem.dx);
      const suggestedCoord = gridToLonLat(
        flowRes.suggestedInflow.gridX,
        flowRes.suggestedInflow.gridY,
        gridSize,
        gridSize,
        bounds
      );

      const suggestedInflow: InflowPoint = {
        id: 'auto_suggested_channel',
        gridX: flowRes.suggestedInflow.gridX,
        gridY: flowRes.suggestedInflow.gridY,
        lon: suggestedCoord.lon,
        lat: suggestedCoord.lat,
        label: 'Auto Channel Inflow',
        baseDischarge: 800,
        peakMultiplier: 2.5,
      };

      // If no inflows defined yet, default to suggested
      let currentInflows = get().config.inflows;
      if (!currentInflows || currentInflows.length === 0) {
        currentInflows = [suggestedInflow];
      }

      set({
        dem,
        buildings,
        roads,
        suggestedInflow,
        config: {
          ...get().config,
          bounds,
          gridSize,
          inflows: currentInflows,
        },
        status: 'ready',
        progressPercent: 100,
        progressStage: 'Ready to simulate',
      });
    } catch (err: any) {
      set({
        status: 'error',
        errorMessage: err?.message || 'Failed to prepare terrain data',
        progressStage: 'Error loading terrain',
      });
    }
  },

  updateConfig: (patch) => {
    set((state) => ({
      config: { ...state.config, ...patch },
    }));
  },

  setInflows: (inflows) => {
    set((state) => ({
      config: { ...state.config, inflows },
    }));
  },

  addInflow: (inflow) => {
    set((state) => ({
      config: { ...state.config, inflows: [...state.config.inflows, inflow] },
    }));
  },

  removeInflow: (id) => {
    set((state) => ({
      config: {
        ...state.config,
        inflows: state.config.inflows.filter((i) => i.id !== id),
      },
    }));
  },

  startSimulation: () => {
    const { dem, config, buildings, roads } = get();
    if (!dem) return;

    // Terminate existing worker if any
    if (get().worker) {
      get().worker?.terminate();
    }

    set({
      status: 'simulating',
      progressPercent: 0,
      progressStage: 'Initializing hydraulic worker...',
      frames: [],
      currentFrameIndex: 0,
      isPlaying: false,
      inspectedCell: null,
      errorMessage: null,
    });

    // Instantiate worker using Vite's worker syntax
    const worker = new Worker(
      new URL('../../core/sim/worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;

      if (msg.type === 'PROGRESS') {
        set({
          progressPercent: Number(msg.percent.toFixed(1)),
          progressStage: `Simulating flood wave: ${Math.round(msg.simulatedTimeSeconds)}s / ${msg.totalDurationSeconds}s (dt = ${msg.currentTimestep.toFixed(2)}s)`,
        });
      } else if (msg.type === 'FRAME') {
        set((state) => {
          const newFrames = [...state.frames, msg.frame];
          return {
            frames: newFrames,
            currentFrameIndex: newFrames.length - 1, // live follow simulation
          };
        });
      } else if (msg.type === 'FINISHED') {
        set({
          status: 'finished',
          progressPercent: 100,
          progressStage: `Simulation complete! Generated ${msg.totalFrames} frames.`,
          isPlaying: false,
        });
      } else if (msg.type === 'ERROR') {
        set({
          status: 'error',
          errorMessage: msg.error,
          progressStage: 'Simulation error',
        });
      }
    };

    worker.onerror = (err) => {
      set({
        status: 'error',
        errorMessage: err.message || 'Worker thread failed',
      });
    };

    const startMsg: WorkerInMessage = {
      type: 'START_SIMULATION',
      config,
      elevation: dem.elevation,
      width: dem.width,
      height: dem.height,
      dx: dem.dx,
      dy: dem.dy,
      buildings,
      roads,
      initialWaterDepth: dem.initialWaterDepth,
    };

    worker.postMessage(startMsg);
    set({ worker });
  },

  cancelSimulation: () => {
    const worker = get().worker;
    if (worker) {
      worker.postMessage({ type: 'CANCEL_SIMULATION' } as WorkerInMessage);
      worker.terminate();
    }
    set({
      worker: null,
      status: 'ready',
      progressStage: 'Simulation cancelled',
      isPlaying: false,
    });
  },

  resetSimulation: () => {
    get().cancelSimulation();
    set({
      frames: [],
      currentFrameIndex: 0,
      status: 'ready',
      progressPercent: 0,
      progressStage: 'Reset. Ready to run.',
      inspectedCell: null,
    });
  },

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

  seekFrame: (index) => {
    const total = get().frames.length;
    if (total === 0) return;
    const clamped = Math.max(0, Math.min(total - 1, index));
    set({ currentFrameIndex: clamped });

    // Update inspection data time series if currently inspecting
    const inspected = get().inspectedCell;
    if (inspected) {
      const frame = get().frames[clamped];
      const idx = inspected.gridY * (get().dem?.width || 256) + inspected.gridX;
      set({
        inspectedCell: {
          ...inspected,
          currentWaterDepthMeters: frame.depth[idx],
          currentVelocityMetersPerSec: frame.velocity[idx],
        },
      });
    }
  },

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  toggleLoop: () => set((s) => ({ isLooping: !s.isLooping })),

  setInspectedCell: (data) => {
    const { dem, frames } = get();
    if (!dem) return;

    // Generate full time-series hydrograph for this cell from all recorded frames
    const series: { timeSeconds: number; depthMeters: number; velocityMetersPerSec: number }[] = [];
    const idx = data.gridY * dem.width + data.gridX;

    for (const f of frames) {
      series.push({
        timeSeconds: f.simulatedTimeSeconds,
        depthMeters: Number(f.depth[idx].toFixed(2)),
        velocityMetersPerSec: Number(f.velocity[idx].toFixed(2)),
      });
    }

    set({
      inspectedCell: {
        ...data,
        depthTimeSeries: series,
      },
    });
  },

  clearInspectedCell: () => set({ inspectedCell: null }),

  setIs2DMode: (is2D) => set({ is2DMode: is2D }),
  setTextureMode: (mode) => set({ textureMode: mode }),
  setWaterLayerMode: (mode) => set({ waterLayerMode: mode }),
  setMaxDepthLegend: (depth) => set({ maxDepthLegend: depth }),
  setVerticalExaggeration: (exaggeration) => {
    set((s) => ({
      verticalExaggeration: exaggeration,
      config: { ...s.config, verticalExaggeration: exaggeration },
    }));
  },
  toggleLayer: (layer) => {
    set((s) => ({
      layersVisible: {
        ...s.layersVisible,
        [layer]: !s.layersVisible[layer],
      },
    }));
  },

  exportSummaryJson: () => {
    const { bounds, frames, buildings, roads } = get();
    if (frames.length === 0) return null;
    const lastFrame = frames[frames.length - 1];
    const report = generateSummaryReport(bounds, lastFrame, buildings, roads);
    return JSON.stringify(report, null, 2);
  },

  exportGeoJsonFile: () => {
    const { bounds, frames, dem } = get();
    if (frames.length === 0 || !dem) return null;
    const lastFrame = frames[frames.length - 1];
    const geojson = exportFloodExtentGeoJson(
      lastFrame.depth,
      dem.width,
      dem.height,
      bounds,
      0.05
    );
    return JSON.stringify(geojson, null, 2);
  },
}));
