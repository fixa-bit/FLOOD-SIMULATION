import React from 'react';
import { X, TrendingUp, Gauge, Compass } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useFloodStore } from '../store/useFloodStore';
import { TimingDetails } from './EventMaps';

export const InspectPopup: React.FC = () => {
  const { inspectedCell, clearInspectedCell, result, runInputs } = useFloodStore();

  if (!inspectedCell) return null;

  const {
    elevationMeters,
    currentWaterDepthMeters,
    currentVelocityMetersPerSec,
    lon,
    lat,
    riskLevel,
    depthTimeSeries,
  } = inspectedCell;

  const elev = typeof elevationMeters === 'number' ? elevationMeters : (inspectedCell as any).elevation ?? 0;
  const depth = typeof currentWaterDepthMeters === 'number' ? currentWaterDepthMeters : (inspectedCell as any).waterDepth ?? 0;
  const vel = typeof currentVelocityMetersPerSec === 'number' ? currentVelocityMetersPerSec : (inspectedCell as any).velocity ?? 0;
  const safeLon = typeof lon === 'number' ? lon : 0;
  const safeLat = typeof lat === 'number' ? lat : 0;
  const safeSeries = Array.isArray(depthTimeSeries) ? depthTimeSeries : [];

  const peakDepth = safeSeries.reduce(
    (max, pt) => (pt.depthMeters > max ? pt.depthMeters : max),
    depth
  );

  const getRiskBadge = () => {
    switch (riskLevel) {
      case 'high':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-400 border border-red-700">HIGH HAZARD</span>;
      case 'medium':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-400 border border-amber-700">MODERATE HAZARD</span>;
      case 'low':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-lime-950 text-lime-400 border border-lime-700">LOW HAZARD</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">DRY GROUND</span>;
    }
  };

  return (
    <div className="absolute top-20 right-6 z-30 w-80 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-4 shadow-2xl text-slate-100 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">
            Cell Inspection
          </span>
        </div>
        <div className="flex items-center gap-2">
          {getRiskBadge()}
          <button
            onClick={clearInspectedCell}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Coordinates & Elevation */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-800/60 p-2 rounded-xl border border-slate-700/50">
          <span className="text-[10px] uppercase font-semibold text-slate-400 block">Coordinates</span>
          <span className="font-mono text-slate-200 text-[11px]">
            {safeLat.toFixed(4)}°, {safeLon.toFixed(4)}°
          </span>
        </div>
        <div className="bg-slate-800/60 p-2 rounded-xl border border-slate-700/50">
          <span className="text-[10px] uppercase font-semibold text-slate-400 block">Bed Elevation</span>
          <span className="font-mono text-slate-200 font-bold">{elev.toFixed(1)} m</span>
        </div>
      </div>

      {/* Hydraulic Metrics */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-800/80 p-2.5 rounded-xl border border-sky-500/30">
          <span className="text-[10px] uppercase font-semibold text-sky-400 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            Water Depth
          </span>
          <span className="text-lg font-mono font-bold text-sky-300">
            {depth.toFixed(2)}{' '}
            <span className="text-xs font-normal text-slate-400">m</span>
          </span>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            Peak: {peakDepth.toFixed(2)} m
          </span>
        </div>

        <div className="bg-slate-800/80 p-2.5 rounded-xl border border-blue-500/30">
          <span className="text-[10px] uppercase font-semibold text-blue-400 flex items-center gap-1">
            <Gauge className="w-3 h-3" />
            Flow Velocity
          </span>
          <span className="text-lg font-mono font-bold text-blue-300">
            {vel.toFixed(2)}{' '}
            <span className="text-xs font-normal text-slate-400">m/s</span>
          </span>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            Energy: {(depth * vel).toFixed(2)} m²/s
          </span>
        </div>
      </div>

      {result && runInputs && <TimingDetails result={result} cell={inspectedCell.gridY * runInputs.dem.width + inspectedCell.gridX} />}
      {/* Depth over time hydrograph chart */}
      <div className="flex flex-col gap-1.5 mt-1">
        <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
          <TrendingUp className="w-3.5 h-3.5 text-sky-400" />
          Depth Hydrograph Over Time
        </span>

        {depthTimeSeries.length > 1 ? (
          <div className="h-32 w-full bg-slate-950/60 p-1 rounded-xl border border-slate-800">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={depthTimeSeries}>
                <defs>
                  <linearGradient id="depthGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#0284c7" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="timeSeconds"
                  stroke="#64748b"
                  fontSize={10}
                  tickFormatter={(val) => `${Math.floor(val / 60)}m`}
                />
                <YAxis stroke="#64748b" fontSize={10} unit="m" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    fontSize: '11px',
                  }}
                  formatter={(val: any) => [`${Number(val).toFixed(2)} m`, 'Depth']}
                  labelFormatter={(val: any) => `Time: ${Math.floor(val / 60)} min`}
                />
                <Area
                  type="monotone"
                  dataKey="depthMeters"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#depthGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-24 flex items-center justify-center text-xs text-slate-500 bg-slate-950/40 rounded-xl border border-slate-800/80">
            Run simulation to view hydrograph
          </div>
        )}
      </div>
    </div>
  );
};
