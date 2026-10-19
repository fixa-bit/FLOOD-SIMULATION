import { create } from 'zustand';
import {
  BoundingBox,
  DataSource,
  DemData,
  OsmBuilding,
  OsmRoad,
  SimulationConfig,
  SimulationFrame,
  SimulationResult,
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
import { ScenarioInputs, readScenario, writeScenario } from '../../core/scenarios/scenarioStorage';
import { normalizeEventTiming } from '../../core/sim/eventTiming';
import { dataSources } from '../../core/analysis/dataSources';

export type SimStatus =
  | 'idle'
  | 'loading_terrain'
  | 'ready'
  | 'simulating'
  | 'paused'
  | 'finished'
  | 'error';

interface FloodState {
  imagerySource: DataSource | undefined;
  setImagerySource: (source: DataSource | undefined) => void;
  infrastructureSource: DataSource | undefined;
  result: SimulationResult | null;
  runInputs: ScenarioInputs | null;
  scenarioName: string;
  saveScenario: (name: string, includeResults: boolean) => Promise<string>;
  loadScenario: (id: string, duplicate?: boolean) => Promise<void>;
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
let terrainRequestId = 0;

export const useFloodStore = create<FloodState>((set, get) => ({
  imagerySource: undefined,
  setImagerySource: imagerySource => set({ imagerySource }),
  infrastructureSource: undefined,
  result: null,
  runInputs: null,
  scenarioName: 'Untitled scenario',
  saveScenario: async (name, includeResults) => {
    const state = get();
    if (!name.trim()) throw new Error('Enter a scenario name.');
    if (!state.dem || state.status === 'loading_terrain' || state.status === 'simulating') throw new Error('Wait for loading or simulation to finish.');
    if (includeResults && (!state.result || !state.runInputs || state.status !== 'finished')) throw new Error('Complete a simulation before saving results.');
    const inputs = includeResults ? state.runInputs! : {
      config: normalizeEventTiming({ ...state.config, bounds: state.dem.bounds }), dem: state.dem, buildings: state.buildings, roads: state.roads, infrastructureSource: state.infrastructureSource,
    };
    const id = crypto.randomUUID();
    await writeScenario({
      id, name: name.trim(), createdAt: new Date().toISOString(), version: 1,
      inputs, frames: includeResults ? state.frames : [], result: includeResults ? state.result : null,
      hasResults: includeResults,
    });
    set({ scenarioName: name.trim() });
    return id;
  },
  loadScenario: async (id, duplicate = false) => {
    const scenario = await readScenario(id);
    terrainRequestId++; // Ignore pending terrain requests that could overwrite the snapshot.
    get().cancelSimulation();
    const { inputs } = scenario;
    const frames = duplicate ? [] : scenario.frames;
    set({
      ...inputs, bounds: inputs.dem.bounds, currentPresetId: '', suggestedInflow: null,
      infrastructureSource: inputs.infrastructureSource,
      frames, result: duplicate ? null : scenario.result,
      runInputs: !duplicate && scenario.result ? structuredClone(inputs) : null,
      currentFrameIndex: frames.length ? frames.length - 1 : 0,
      status: !duplicate && scenario.result ? 'finished' : 'ready',
      scenarioName: scenario.name + (duplicate ? ' copy' : ''),
      isPlaying: false, inspectedCell: null, errorMessage: null, progressPercent: 100,
      progressStage: duplicate ? 'Baseline duplicated. Edit inputs and run.' : 'Saved scenario restored.',
    });
  },
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
    hydrographDurationSeconds: DEFAULT_PRESET.recommendedDuration,
    hydrographStartSeconds: 0,
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
        hydrographDurationSeconds: preset.recommendedDuration,
        hydrographStartSeconds: 0,
        inflows: preset.recommendedInflows.map((inf, idx) => ({
          ...inf,
          id: `inflow_${idx + 1}`,
        })),
        rainfall: preset.recommendedRainfall,
      },
      frames: [],
      result: null, runInputs: null,
      currentFrameIndex: 0,
      isPlaying: false,
      inspectedCell: null,
    });

    await get().loadTerrainForBounds(preset.bounds, get().config.gridSize);
  },

  loadTerrainForBounds: async (bounds, gridSize = 256) => {
    const requestId = ++terrainRequestId;
    if (get().worker) get().cancelSimulation();
    set({
      status: 'loading_terrain',
      dem: null, buildings: [], roads: [], infrastructureSource: undefined,
      progressPercent: 5,
      progressStage: 'Initializing terrain fetcher...',
      errorMessage: null,
      frames: [],
      result: null, runInputs: null,
      currentFrameIndex: 0,
      isPlaying: false,
      inspectedCell: null,
    });

    try {
      // 1. Fetch & decode DEM
      const dem = await fetchAndProcessDem(bounds, gridSize, (pct, stage) => {
        if (requestId === terrainRequestId) set({ progressPercent: pct, progressStage: stage });
      });
      if (requestId !== terrainRequestId) return;

      // 2. Fetch OSM infrastructure
      const { buildings, roads, source: infrastructureSource } = await fetchOsmStructures(
        bounds,
        dem.elevation,
        gridSize,
        gridSize,
        (stage) => { if (requestId === terrainRequestId) set({ progressStage: stage }); }
      );
      if (requestId !== terrainRequestId) return;

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
        infrastructureSource,
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
      if (requestId !== terrainRequestId) return;
      set({
        status: 'error',
        errorMessage: err?.message || 'Failed to prepare terrain data',
        progressStage: 'Error loading terrain',
      });
    }
  },

  updateConfig: (patch) => {
    set((state) => ({
      config: { ...normalizeEventTiming(state.config), ...patch },
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
    if (!dem || get().status === 'loading_terrain') return;
    const runInputs = structuredClone({ config: normalizeEventTiming({ ...config, bounds: dem.bounds }), dem, buildings, roads, infrastructureSource: get().infrastructureSource });
    if (!Number.isFinite(runInputs.config.hydrographDurationSeconds) || runInputs.config.hydrographDurationSeconds! <= 0 ||
        !Number.isFinite(runInputs.config.hydrographStartSeconds) || runInputs.config.hydrographStartSeconds! < 0) {
      set({ status: 'error', errorMessage: 'Event duration must be positive and start time must be non-negative.' });
      return;
    }

    // Terminate existing worker if any
    if (get().worker) {
      get().worker?.terminate();
    }

    set({
      status: 'simulating',
      progressPercent: 0,
      progressStage: 'Initializing hydraulic worker...',
      frames: [],
      result: null, runInputs,
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
      if (get().worker !== worker) return;
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
          result: msg.result,
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
      if (get().worker !== worker) return;
      set({
        status: 'error',
        errorMessage: err.message || 'Worker thread failed',
      });
    };

    const startMsg: WorkerInMessage = {
      type: 'START_SIMULATION',
      config: runInputs.config,
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
      result: null, runInputs: null,
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
    const { frames, result, runInputs } = get();
    if (frames.length === 0 || !result || !runInputs) return null;
    const lastFrame = frames[frames.length - 1];
    const report = generateSummaryReport(runInputs.dem.bounds, lastFrame, runInputs.buildings, runInputs.roads, result, runInputs.dem, {
      sources: dataSources(runInputs), eventTiming: { startSeconds: runInputs.config.hydrographStartSeconds ?? 0,
        durationSeconds: runInputs.config.hydrographDurationSeconds ?? runInputs.config.duration, preset: runInputs.config.inflowPreset },
    });
    return JSON.stringify(report, null, 2);
  },

  exportGeoJsonFile: () => {
    const { result, runInputs } = get();
    if (!result || !runInputs) return null;
    const { dem } = runInputs;
    const geojson = exportFloodExtentGeoJson(
      result.peakDepth,
      dem.width,
      dem.height,
      dem.bounds,
      result.floodDepthThreshold
    );
    geojson.metadata = { dataSources: dataSources(runInputs), floodDepthThresholdMeters: result.floodDepthThreshold,
      scope: 'maximum_extent_over_observed_run', observedDurationSeconds: runInputs.config.duration };
    return JSON.stringify(geojson, null, 2);
  },
}));
