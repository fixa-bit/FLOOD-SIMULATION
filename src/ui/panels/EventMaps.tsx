import { useEffect, useRef, useState } from 'react';
import { ScenarioInputs } from '../../core/scenarios/scenarioStorage';
import { DemData, SimulationResult } from '../../core/types';
import { exportTimingGrids, hasTiming, timingAt } from '../../core/analysis/timingMaps';
import { dataSources } from '../../core/analysis/dataSources';
import { DataSourceLabels } from './DataSourceLabels';

export function TimingDetails({ result, cell }: { result: SimulationResult; cell: number }) {
  const timing = timingAt(result, cell);
  if (!timing) return <p className="text-xs text-slate-400">Timing unavailable for this older run. Rerun it to calculate arrival and duration.</p>;
  return <dl className="grid grid-cols-2 gap-3 text-xs" aria-label="Location flood timing">
    <div><dt className="text-slate-400">First arrival</dt><dd className="font-semibold mt-1">{timing.arrivalSeconds === null ? 'Not reached during this run' : timing.arrivalSeconds === 0 ? 'Wet at start (0 s)' : `${timing.arrivalSeconds.toFixed(1)} s (${(timing.arrivalSeconds / 60).toFixed(2)} min)`}</dd></div>
    <div><dt className="text-slate-400">Total flood duration</dt><dd className="font-semibold mt-1">{timing.durationSeconds.toFixed(1)} s ({(timing.durationSeconds / 60).toFixed(2)} min)</dd></div>
    <div className="col-span-2 text-amber-200">{timing.stillWet ? 'Still flooded at run end — duration may increase if you observe longer.' : timing.arrivalSeconds === null ? 'The flood threshold was never reached.' : 'Below the flood threshold at run end.'}</div>
  </dl>;
}

export function TimingRaster({ dem, values, reached, maxSeconds, title, selected, onSelect }: {
  dem: DemData; values: Float64Array; reached: Float64Array; maxSeconds: number; title: string;
  selected?: number; onSelect?: (cell: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = dem.width; canvas.height = dem.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(dem.width, dem.height);
    for (let i = 0; i < values.length; i++) {
      const t = Math.max(0, Math.min(1, values[i] / Math.max(0.01, maxSeconds)));
      image.data.set([...(reached[i] < 0 ? [75, 85, 99] : [30 + 210 * t, 210 - 130 * t, 225 - 180 * t]), 255], i * 4);
    }
    ctx.putImageData(image, 0, 0);
  }, [dem, values, reached, maxSeconds]);
  return <figure><figcaption className="text-sm font-semibold mb-2">{title}</figcaption>
    <div className="relative w-full" style={{ aspectRatio: `${dem.dx * Math.max(1, dem.width - 1)} / ${dem.dy * Math.max(1, dem.height - 1)}` }}>
      <canvas ref={ref} role="img" aria-label={title} tabIndex={onSelect ? 0 : undefined} className="absolute inset-0 w-full h-full rounded-lg border border-slate-600 cursor-crosshair" style={{ imageRendering: 'pixelated' }}
        onClick={e => { if (!onSelect) return; const rect = e.currentTarget.getBoundingClientRect();
          const x = Math.max(0, Math.min(dem.width - 1, Math.round((e.clientX - rect.left) / rect.width * (dem.width - 1))));
          const y = Math.max(0, Math.min(dem.height - 1, Math.round((e.clientY - rect.top) / rect.height * (dem.height - 1))));
          onSelect(y * dem.width + x);
        }} onKeyDown={e => {
          if (!onSelect || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault(); const current = selected ?? 0;
          const x = Math.max(0, Math.min(dem.width - 1, current % dem.width + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0)));
          const y = Math.max(0, Math.min(dem.height - 1, Math.floor(current / dem.width) + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0)));
          onSelect(y * dem.width + x);
        }} />
      {selected !== undefined && <span aria-hidden="true" className="absolute text-white text-xl font-bold pointer-events-none -translate-x-1/2 -translate-y-1/2" style={{ left: `${(selected % dem.width) / Math.max(1, dem.width - 1) * 100}%`, top: `${Math.floor(selected / dem.width) / Math.max(1, dem.height - 1) * 100}%` }}>+</span>}
    </div><p className="text-xs text-slate-400 mt-2">North up · Cyan: 0 min → orange: {(maxSeconds / 60).toFixed(2)} min · Gray: not reached</p>
  </figure>;
}

export function EventMaps({ inputs, result, name, onClose }: { inputs: ScenarioInputs; result: SimulationResult; name: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'arrival' | 'duration'>('arrival');
  const [selected, setSelected] = useState(0);
  const [lon, setLon] = useState(String(inputs.dem.bounds.west));
  const [lat, setLat] = useState(String(inputs.dem.bounds.north));
  const [error, setError] = useState('');
  const { dem } = inputs;
  useEffect(() => { dialog.current?.showModal(); }, []);
  const select = (cell: number) => {
    setSelected(cell); setError('');
    setLon((dem.bounds.west + cell % dem.width / Math.max(1, dem.width - 1) * (dem.bounds.east - dem.bounds.west)).toFixed(6));
    setLat((dem.bounds.north - Math.floor(cell / dem.width) / Math.max(1, dem.height - 1) * (dem.bounds.north - dem.bounds.south)).toFixed(6));
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportTimingGrids(inputs, result))], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'floodsim_timing_grids.json'; link.click(); URL.revokeObjectURL(url);
  };
  const values = mode === 'arrival' ? result.arrivalTimeSeconds : result.floodDurationSeconds;
  let max = 0;
  if (values) for (const value of values) max = Math.max(max, value);
  return <dialog ref={dialog} onClose={onClose} onCancel={onClose} aria-labelledby="event-maps-title" className="m-auto w-[95vw] max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-600 bg-slate-950 text-slate-100 p-5 backdrop:bg-black/75">
    <header className="flex justify-between items-center gap-3 mb-3"><h2 id="event-maps-title" className="font-bold">Flood timing — {name}</h2><button onClick={onClose} className="bg-slate-800 px-3 py-2 rounded-lg">Close</button></header>
    <DataSourceLabels sources={dataSources(inputs)} />
    {!hasTiming(result) ? <p className="my-4">This older saved run has no timing maps. Duplicate it and rerun to calculate arrival and duration.</p> : <>
      <p className="text-xs text-slate-400 my-3">Threshold ≥ {result.floodDepthThreshold} m · Observed {(result.observedDurationSeconds! / 60).toFixed(2)} min. First arrival and cumulative wet duration use linear crossing estimates between solver steps. Duration includes repeated flooding and stops at the run end.</p>
      <label className="text-sm">Timing map <select aria-label="Timing map" value={mode} onChange={e => setMode(e.target.value as typeof mode)} className="ml-2 bg-slate-800 rounded p-2"><option value="arrival">Arrival time</option><option value="duration">Flood duration</option></select></label>
      <div className="grid md:grid-cols-2 gap-5 my-4">
        <TimingRaster dem={dem} values={values!} reached={result.arrivalTimeSeconds!} maxSeconds={max} title={mode === 'arrival' ? 'Arrival-time map' : 'Flood-duration map'} selected={selected} onSelect={select} />
        <section className="space-y-4" aria-label="Selected location"><h3 className="font-semibold">Inspect a location</h3><p className="text-xs text-slate-400">Click the map, use arrow keys on it, or enter coordinates. Values use the nearest grid sample.</p>
          <form onSubmit={e => { e.preventDefault(); const x = Number(lon), y = Number(lat);
            if (!lon.trim() || !lat.trim() || !Number.isFinite(x) || !Number.isFinite(y) || x < dem.bounds.west || x > dem.bounds.east || y < dem.bounds.south || y > dem.bounds.north) { setError('Enter coordinates inside the selected area.'); return; }
            select(Math.round((dem.bounds.north - y) / (dem.bounds.north - dem.bounds.south) * (dem.height - 1)) * dem.width + Math.round((x - dem.bounds.west) / (dem.bounds.east - dem.bounds.west) * (dem.width - 1)));
          }} className="space-y-2">
            <label className="block text-xs">Longitude<input aria-label="Timing longitude" type="number" step="any" value={lon} onChange={e => setLon(e.target.value)} className="w-full bg-slate-800 rounded p-2 mt-1" /></label>
            <label className="block text-xs">Latitude<input aria-label="Timing latitude" type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} className="w-full bg-slate-800 rounded p-2 mt-1" /></label>
            <button className="bg-sky-700 rounded px-3 py-2 text-xs">Inspect coordinates</button>
          </form>{error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
          <TimingDetails result={result} cell={selected} />
          <p className="text-xs text-slate-400">Peak depth at selection: {result.peakDepth[selected].toFixed(2)} m</p>
          <button onClick={download} className="text-xs bg-slate-700 rounded px-3 py-2">Download timing grids (JSON)</button>
        </section>
      </div>
    </>}
  </dialog>;
}
