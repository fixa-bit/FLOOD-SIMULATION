import React from 'react';
import { Layers } from 'lucide-react';
import { useFloodStore } from '../store/useFloodStore';

export const DepthLegend: React.FC = () => {
  const { maxDepthLegend, setMaxDepthLegend, waterLayerMode } = useFloodStore();

  return (
    <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-3 shadow-2xl flex flex-col gap-2 w-56 text-slate-100 select-none">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-300 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-sky-400" />
          {waterLayerMode === 2 ? 'Hazard Levels' : 'Water Depth'}
        </span>
        <span className="text-[10px] text-slate-400 font-mono">
          {waterLayerMode === 2 ? 'H = d × v' : `0 - ${maxDepthLegend.toFixed(1)} m`}
        </span>
      </div>

      {waterLayerMode === 2 ? (
        // Risk Zones Legend
        <div className="flex flex-col gap-1.5 text-[11px] pt-1">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded bg-[#ef4444] border border-red-400 shrink-0" />
            <span className="text-red-300 font-medium">High (d &ge; 1.0m or dv &ge; 0.6)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded bg-[#f59e0b] border border-amber-400 shrink-0" />
            <span className="text-amber-300 font-medium">Medium (d &ge; 0.3m or dv &ge; 0.3)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded bg-[#84cc16] border border-lime-400 shrink-0" />
            <span className="text-lime-300 font-medium">Low (shallow / low energy)</span>
          </div>
        </div>
      ) : (
        // Continuous Depth Gradient
        <div className="flex flex-col gap-1.5 pt-1">
          <div
            className="h-3 w-full rounded-md shadow-inner border border-slate-700/60"
            style={{
              background:
                waterLayerMode === 1
                  ? 'linear-gradient(to right, #10b981, #eab308, #f97316, #ef4444)'
                  : 'linear-gradient(to right, rgba(56, 189, 248, 0.4), #0284c7, #075985, #082f49)',
            }}
          />
          <div className="flex justify-between text-[10px] font-mono text-slate-400">
            <span>0.0 m</span>
            <span>{(maxDepthLegend * 0.5).toFixed(1)} m</span>
            <span>{maxDepthLegend.toFixed(1)} m+</span>
          </div>

          {/* Adjustable max depth slider */}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">Scale</span>
            <input
              type="range"
              min="0.5"
              max="10.0"
              step="0.5"
              value={maxDepthLegend}
              onChange={(e) => setMaxDepthLegend(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
            />
          </div>
        </div>
      )}
    </div>
  );
};
