import React, { useState } from 'react';
import {
  Map,
  Waves,
  Sliders,
  Palette,
  Play,
  Camera,
  Video,
  Download,
  ChevronDown,
  ChevronUp,
  CloudRain,
  Compass,
  Layers,
  Sparkles,
  Minimize2,
} from 'lucide-react';
import { useFloodStore } from '../store/useFloodStore';
import { PRESET_AREAS } from '../../core/terrain/presetAreas';
import { HydrographPreset } from '../../core/types';
import { TextureMode } from '../../viewer/textureFetcher';

export const SidePanel: React.FC<{
  onCameraPreset?: (preset: 'top' | 'oblique' | 'flood') => void;
  onSnapshot?: () => void;
  onRecordToggle?: () => boolean;
  isRecording?: boolean;
}> = ({ onCameraPreset, onSnapshot, onRecordToggle, isRecording = false }) => {
  const {
    currentPresetId,
    loadPreset,
    dem,
    config,
    updateConfig,
    suggestedInflow,
    addInflow,
    status,
    startSimulation,
    setIs2DMode,
    is2DMode,
    textureMode,
    setTextureMode,
    waterLayerMode,
    setWaterLayerMode,
    verticalExaggeration,
    setVerticalExaggeration,
    layersVisible,
    toggleLayer,
    exportSummaryJson,
    exportGeoJsonFile,
  } = useFloodStore();

  // Collapsible section state
  const [openSections, setOpenSections] = useState({
    area: true,
    inflows: true,
    settings: false,
    layers: false,
  });

  const [isCollapsed, setIsCollapsed] = useState(false);

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleDownloadSummary = () => {
    const json = exportSummaryJson();
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `floodsim_summary_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadGeoJson = () => {
    const json = exportGeoJsonFile();
    if (!json) return;
    const blob = new Blob([json], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `floodsim_extent_${Date.now()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isCollapsed) {
    return (
      <div className="absolute top-4 left-4 z-20">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-3 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl text-sky-400 hover:text-white transition flex items-center gap-2"
          title="Expand Control Panel"
        >
          <Layers className="w-5 h-5" />
          <span className="text-xs font-semibold">FloodSim Controls</span>
        </button>
      </div>
    );
  }

  return (
    <div className="absolute top-4 left-4 bottom-24 z-20 w-84 md:w-96 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 select-none">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-gradient-to-tr from-sky-600 to-blue-500 shadow-lg shadow-sky-500/25">
            <Waves className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-1.5">
              FloodSim <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">3D</span>
            </h1>
            <p className="text-[11px] text-slate-400">Hydrodynamic Flood Simulator</p>
          </div>
        </div>

        <button
          onClick={() => setIsCollapsed(true)}
          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          title="Collapse Panel"
        >
          <Minimize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable Accordions */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80 p-2 space-y-1">
        {/* Section 1: Area Selection */}
        <div className="pt-1">
          <button
            onClick={() => toggleSection('area')}
            className="w-full p-2.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-300 hover:text-white rounded-xl hover:bg-slate-800/50 transition"
          >
            <span className="flex items-center gap-2">
              <Map className="w-4 h-4 text-sky-400" />
              Area & Region
            </span>
            {openSections.area ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {openSections.area && (
            <div className="p-3 pt-1 flex flex-col gap-2.5 text-xs">
              <label className="text-[11px] text-slate-400 uppercase font-semibold">Preset Demo Area</label>
              <select
                value={currentPresetId}
                onChange={(e) => loadPreset(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl p-2 focus:outline-none focus:border-sky-500"
              >
                {PRESET_AREAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <button
                onClick={() => setIs2DMode(!is2DMode)}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl text-xs font-medium text-slate-200 transition flex items-center justify-center gap-2"
              >
                <Compass className="w-3.5 h-3.5 text-sky-400" />
                <span>{is2DMode ? 'Back to 3D View' : 'Select Custom Area on 2D Map'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Section 2: Inflow Hydrograph & Rainfall */}
        <div className="pt-1">
          <button
            onClick={() => toggleSection('inflows')}
            className="w-full p-2.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-300 hover:text-white rounded-xl hover:bg-slate-800/50 transition"
          >
            <span className="flex items-center gap-2">
              <Waves className="w-4 h-4 text-sky-400" />
              Inflow & Hydrology
            </span>
            {openSections.inflows ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {openSections.inflows && (
            <div className="p-3 pt-1 flex flex-col gap-3 text-xs">
              <div>
                <label className="text-[11px] text-slate-400 uppercase font-semibold block mb-1">
                  Hydrograph Curve
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['rising_falling', 'constant', 'flash_flood'] as HydrographPreset[]).map((type) => (
                    <button
                      key={type}
                      onClick={() => updateConfig({ inflowPreset: type })}
                      className={`p-2 rounded-lg text-left transition border ${
                        config.inflowPreset === type
                          ? 'bg-sky-600/30 border-sky-500 text-sky-200'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      <span className="capitalize block font-medium">
                        {type.replace('_', ' ')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Inflow Sources List */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] text-slate-400 uppercase font-semibold">
                    Inflow Sources ({config.inflows.length})
                  </label>
                  {suggestedInflow && (
                    <button
                      onClick={() => addInflow(suggestedInflow)}
                      className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1 font-semibold"
                      title="Add lowest connected river channel auto-detected from DEM"
                    >
                      <Sparkles className="w-3 h-3" />
                      Add Suggested
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  {config.inflows.map((inf, idx) => (
                    <div
                      key={inf.id}
                      className="bg-slate-800/70 p-2.5 rounded-xl border border-slate-700/80 flex items-center justify-between"
                    >
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-200 text-xs">
                          {inf.label || `Inflow ${idx + 1}`}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          Discharge: {inf.baseDischarge} m³/s
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={inf.baseDischarge}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            const updated = config.inflows.map((i) =>
                              i.id === inf.id ? { ...i, baseDischarge: val } : i
                            );
                            updateConfig({ inflows: updated });
                          }}
                          className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-right font-mono text-xs text-sky-300"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Uniform Rainfall */}
              <div className="bg-slate-800/50 p-2.5 rounded-xl border border-slate-700/60 flex flex-col gap-2">
                <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                  <CloudRain className="w-3.5 h-3.5 text-sky-400" />
                  Uniform Rainfall (Hyetograph)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">Rate (mm/hr)</label>
                    <input
                      type="number"
                      min="0"
                      max="150"
                      value={config.rainfall.intensityMmPerHour}
                      onChange={(e) =>
                        updateConfig({
                          rainfall: {
                            ...config.rainfall,
                            intensityMmPerHour: parseFloat(e.target.value) || 0,
                          },
                        })
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">Duration (mins)</label>
                    <input
                      type="number"
                      min="0"
                      value={Math.round(config.rainfall.durationSeconds / 60)}
                      onChange={(e) =>
                        updateConfig({
                          rainfall: {
                            ...config.rainfall,
                            durationSeconds: (parseFloat(e.target.value) || 0) * 60,
                          },
                        })
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-slate-200"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Section 3: Solver & Physics Settings */}
        <div className="pt-1">
          <button
            onClick={() => toggleSection('settings')}
            className="w-full p-2.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-300 hover:text-white rounded-xl hover:bg-slate-800/50 transition"
          >
            <span className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-sky-400" />
              Hydraulic Physics
            </span>
            {openSections.settings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {openSections.settings && (
            <div className="p-3 pt-1 flex flex-col gap-3 text-xs">
              {/* Manning's n friction */}
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-slate-400">Manning's Roughness (n)</span>
                  <span className="font-mono text-sky-400 font-semibold">{config.manningsN.toFixed(3)}</span>
                </div>
                <input
                  type="range"
                  min="0.015"
                  max="0.080"
                  step="0.005"
                  value={config.manningsN}
                  onChange={(e) => updateConfig({ manningsN: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
                />
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Default 0.035 (natural channel / pasture)
                </span>
              </div>

              {/* Boundary condition */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Boundary Condition</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => updateConfig({ boundaryType: 'open' })}
                    className={`p-2 rounded-lg font-medium border text-center transition ${
                      config.boundaryType === 'open'
                        ? 'bg-sky-600/30 border-sky-500 text-sky-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    Open (Free Outflow)
                  </button>
                  <button
                    onClick={() => updateConfig({ boundaryType: 'closed' })}
                    className={`p-2 rounded-lg font-medium border text-center transition ${
                      config.boundaryType === 'closed'
                        ? 'bg-sky-600/30 border-sky-500 text-sky-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    Closed (Reflective)
                  </button>
                </div>
              </div>

              {/* Simulation Duration */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Simulated Duration</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[1800, 3600, 7200].map((dur) => (
                    <button
                      key={dur}
                      onClick={() => updateConfig({ duration: dur })}
                      className={`p-1.5 rounded-lg font-mono text-center border transition ${
                        config.duration === dur
                          ? 'bg-sky-600/30 border-sky-500 text-sky-300'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                    >
                      {dur / 3600} hr{dur > 3600 ? 's' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {/* Vertical exaggeration slider (1x - 5x) */}
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-slate-400">Vertical Exaggeration</span>
                  <span className="font-mono text-sky-400 font-semibold">{verticalExaggeration.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="5.0"
                  step="0.1"
                  value={verticalExaggeration}
                  onChange={(e) => setVerticalExaggeration(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
                />
              </div>
            </div>
          )}
        </div>

        {/* Section 4: Layers & Themes */}
        <div className="pt-1">
          <button
            onClick={() => toggleSection('layers')}
            className="w-full p-2.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-300 hover:text-white rounded-xl hover:bg-slate-800/50 transition"
          >
            <span className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-sky-400" />
              Layers & Themes
            </span>
            {openSections.layers ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {openSections.layers && (
            <div className="p-3 pt-1 flex flex-col gap-3 text-xs">
              {/* Texture mode */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Draped Surface Texture</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['satellite', 'osm', 'hillshade'] as TextureMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setTextureMode(mode)}
                      className={`p-2 rounded-lg capitalize border text-center transition ${
                        textureMode === mode
                          ? 'bg-sky-600/30 border-sky-500 text-sky-300 font-semibold'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Water styling mode */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Water Visualization</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: 0, label: 'Realistic' },
                    { id: 1, label: 'Heatmap' },
                    { id: 2, label: 'Risk Zones' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setWaterLayerMode(m.id)}
                      className={`p-2 rounded-lg border text-center transition ${
                        waterLayerMode === m.id
                          ? 'bg-sky-600/30 border-sky-500 text-sky-300 font-semibold'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Layer Toggles */}
              <div className="flex flex-col gap-2 pt-1">
                {[
                  { key: 'buildings' as const, label: '3D Buildings (OSM)' },
                  { key: 'roads' as const, label: 'Road Networks' },
                  { key: 'water' as const, label: 'Water Surface' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center justify-between cursor-pointer">
                    <span className="text-slate-300">{label}</span>
                    <input
                      type="checkbox"
                      checked={layersVisible[key]}
                      onChange={() => toggleLayer(key)}
                      className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-sky-600 focus:ring-0"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action Footer: Run Simulation & Camera Presets */}
      <div className="p-4 border-t border-slate-800/90 bg-slate-950/40 flex flex-col gap-3">
        {/* Camera Preset shortcuts */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-[11px] text-slate-400 uppercase font-semibold">Camera</span>
          <div className="flex gap-1.5">
            <button
              onClick={() => onCameraPreset?.('top')}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-[11px] border border-slate-700"
            >
              Top-Down
            </button>
            <button
              onClick={() => onCameraPreset?.('oblique')}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-[11px] border border-slate-700"
            >
              Oblique
            </button>
            <button
              onClick={() => onCameraPreset?.('flood')}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-[11px] border border-slate-700"
            >
              Inflow
            </button>
          </div>
        </div>

        {/* Primary Simulation Action Button */}
        <button
          onClick={startSimulation}
          disabled={status === 'simulating' || !dem}
          className={`w-full py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 shadow-xl ${
            status === 'simulating'
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
              : 'bg-gradient-to-r from-sky-500 via-sky-600 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white shadow-sky-500/25 active:scale-[0.98]'
          }`}
        >
          <Play className="w-4 h-4 fill-current" />
          <span>{status === 'simulating' ? 'Simulating...' : 'Run Flood Simulation'}</span>
        </button>

        {/* Media & Export Utilities */}
        <div className="grid grid-cols-4 gap-1.5 pt-1">
          <button
            onClick={onSnapshot}
            className="p-2 bg-slate-800/90 hover:bg-slate-700 text-slate-300 rounded-xl text-xs flex flex-col items-center justify-center gap-1 border border-slate-700/80 transition"
            title="Take PNG Snapshot"
          >
            <Camera className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[10px]">PNG</span>
          </button>

          <button
            onClick={() => onRecordToggle?.()}
            className={`p-2 rounded-xl text-xs flex flex-col items-center justify-center gap-1 border transition ${
              isRecording
                ? 'bg-red-600/30 border-red-500 text-red-300 animate-pulse'
                : 'bg-slate-800/90 hover:bg-slate-700 text-slate-300 border-slate-700/80'
            }`}
            title="Record WebM Video"
          >
            <Video className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[10px]">{isRecording ? 'Stop' : 'Record'}</span>
          </button>

          <button
            onClick={handleDownloadSummary}
            className="p-2 bg-slate-800/90 hover:bg-slate-700 text-slate-300 rounded-xl text-xs flex flex-col items-center justify-center gap-1 border border-slate-700/80 transition"
            title="Download JSON Summary Report"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[10px]">Report</span>
          </button>

          <button
            onClick={handleDownloadGeoJson}
            className="p-2 bg-slate-800/90 hover:bg-slate-700 text-slate-300 rounded-xl text-xs flex flex-col items-center justify-center gap-1 border border-slate-700/80 transition"
            title="Export GeoJSON Flood Extent"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[10px]">GeoJSON</span>
          </button>
        </div>
      </div>
    </div>
  );
};
