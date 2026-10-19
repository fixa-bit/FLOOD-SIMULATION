import React from 'react';
import { Home, Route, Waves, Droplets, ShieldAlert, CheckCircle2, Box } from 'lucide-react';
import { useFloodStore } from '../store/useFloodStore';

export const StatisticsBar: React.FC = () => {
  const { frames, currentFrameIndex, buildings } = useFloodStore();

  const currentFrame = frames[currentFrameIndex];
  const stats = currentFrame?.stats;

  if (!stats) return null;

  const totalBuildings = buildings.length;
  const floodedBuildings = stats.affectedBuildingsCount;
  const floodedRoadsKm = stats.affectedRoadsKm;
  const floodedArea = stats.floodedAreaKm2;
  const maxDepth = stats.maxDepth;
  const totalVolume = stats.totalWaterVolumeM3;
  const massError = stats.massConservationErrorPct;

  return (
    <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-2.5 px-4 shadow-2xl flex flex-wrap items-center gap-4 text-xs select-none">
      {/* Flooded Area */}
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
          <Waves className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-semibold text-slate-400">Inundated Area</span>
          <span className="font-mono font-bold text-sky-300">
            {floodedArea.toFixed(2)}{' '}
            <span className="text-[10px] font-normal text-slate-400">km²</span>
          </span>
        </div>
      </div>

      <div className="h-6 w-px bg-slate-800 hidden sm:block" />

      {/* Affected Buildings */}
      <div className="flex items-center gap-2">
        <div
          className={`p-1.5 rounded-lg border ${
            floodedBuildings > 0
              ? 'bg-red-500/10 text-red-400 border-red-500/20'
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          }`}
        >
          <Home className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-semibold text-slate-400">Flooded Buildings</span>
          <span className={`font-mono font-bold ${floodedBuildings > 0 ? 'text-red-400' : 'text-slate-200'}`}>
            {floodedBuildings}{' '}
            <span className="text-[10px] font-normal text-slate-400">/ {totalBuildings}</span>
          </span>
        </div>
      </div>

      <div className="h-6 w-px bg-slate-800 hidden sm:block" />

      {/* Affected Roads */}
      <div className="flex items-center gap-2">
        <div
          className={`p-1.5 rounded-lg border ${
            floodedRoadsKm > 0
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              : 'bg-slate-800 text-slate-400 border-slate-700'
          }`}
        >
          <Route className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-semibold text-slate-400">Submerged Roads</span>
          <span className="font-mono font-bold text-amber-300">
            {floodedRoadsKm.toFixed(1)}{' '}
            <span className="text-[10px] font-normal text-slate-400">km</span>
          </span>
        </div>
      </div>

      <div className="h-6 w-px bg-slate-800 hidden md:block" />

      {/* Max Water Depth */}
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
          <Droplets className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-semibold text-slate-400">Max Depth</span>
          <span className="font-mono font-bold text-blue-300">
            {maxDepth.toFixed(2)}{' '}
            <span className="text-[10px] font-normal text-slate-400">m</span>
          </span>
        </div>
      </div>

      <div className="h-6 w-px bg-slate-800 hidden lg:block" />

      {/* Water Volume */}
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
          <Box className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-semibold text-slate-400">Water Volume</span>
          <span className="font-mono font-bold text-sky-300">
            {(totalVolume / 1000).toFixed(0)}{' '}
            <span className="text-[10px] font-normal text-slate-400">k m³</span>
          </span>
        </div>
      </div>

      <div className="h-6 w-px bg-slate-800 hidden lg:block" />

      {/* Mass Conservation */}
      <div className="flex items-center gap-2">
        <div
          className={`p-1.5 rounded-lg border ${
            massError < 2.0
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
          }`}
          title="Mass balance conservation error across domain"
        >
          {massError < 2.0 ? <CheckCircle2 className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-semibold text-slate-400">Mass Balance</span>
          <span className="font-mono font-bold text-emerald-400">
            {massError < 0.01 ? '<0.01%' : `${massError.toFixed(2)}%`} error
          </span>
        </div>
      </div>
    </div>
  );
};
