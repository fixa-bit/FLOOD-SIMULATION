import { useEffect, useMemo, useRef, useState } from 'react';
import { SavedScenario } from '../../core/scenarios/scenarioStorage';
import { depthDifference } from '../../core/analysis/eventResults';
import { dataSources } from '../../core/analysis/dataSources';
import { DataSourceLabels } from './DataSourceLabels';
import { TimingRaster } from './EventMaps';
import { hasTiming } from '../../core/analysis/timingMaps';

function FloodMap({ scenario, depth, max, difference = false, title }: {
  scenario: SavedScenario; depth: Float32Array; max: number; difference?: boolean; title: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height, elevation, minElevation, maxElevation } = scenario.inputs.dem;
    canvas.width = width; canvas.height = height;
    const pixels = ctx.createImageData(width, height);
    for (let i = 0; i < depth.length; i++) {
      const t = Math.min(1, Math.abs(depth[i]) / Math.max(0.01, max));
      let color: number[];
      if (difference) color = depth[i] >= 0 ? [255, 255 - 210 * t, 255 - 210 * t] : [255 - 210 * t, 255 - 130 * t, 255];
      else if (depth[i] >= scenario.result!.floodDepthThreshold) color = [80 - 65 * t, 200 - 150 * t, 255 - 110 * t];
      else {
        const shade = 90 + 100 * (elevation[i] - minElevation) / Math.max(1, maxElevation - minElevation);
        color = [shade, shade, shade];
      }
      pixels.data.set([...color, 255], i * 4);
    }
    ctx.putImageData(pixels, 0, 0);
  }, [scenario, depth, max, difference]);
  return <figure className="min-w-0">
    <figcaption className="text-sm font-semibold mb-2">{title}</figcaption>
    <canvas ref={ref} role="img" aria-label={title} className="w-full max-h-[42vh] object-contain border border-slate-600 rounded-lg bg-slate-900" />
    <p className="text-xs text-slate-400 mt-1">North up · {scenario.inputs.dem.width} × {scenario.inputs.dem.height} grid</p>
  </figure>;
}

export function ScenarioComparison({ baseline, candidate, onClose }: { baseline: SavedScenario; candidate: SavedScenario; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'peak' | 'playback' | 'difference' | 'arrival' | 'duration'>('peak');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const difference = useMemo(() => depthDifference(baseline.result!, candidate.result!), [baseline, candidate]);
  const commonEnd = Math.min(baseline.frames.at(-1)?.simulatedTimeSeconds ?? 0, candidate.frames.at(-1)?.simulatedTimeSeconds ?? 0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!playing || mode !== 'playback') return;
    const timer = window.setInterval(() => setTime(t => {
      if (t >= commonEnd) { setPlaying(false); return t; }
      return Math.min(commonEnd, t + Math.max(1, commonEnd / 120));
    }), 150);
    return () => window.clearInterval(timer);
  }, [playing, mode, commonEnd]);
  const frameAt = (s: SavedScenario) => {
    let frame = s.frames[0];
    for (const f of s.frames) { if (f.simulatedTimeSeconds > time) break; frame = f; }
    return frame;
  };
  const aFrame = frameAt(baseline), bFrame = frameAt(candidate);
  const a = baseline.result!, b = candidate.result!;
  const rows = [
    ['Peak water depth', a.envelopeStats.maxDepth, b.envelopeStats.maxDepth, 'm'],
    ['Area flooded at any time', a.envelopeStats.floodedAreaKm2, b.envelopeStats.floodedAreaKm2, 'km²'],
    ['Maximum simultaneous flooded area', a.maximumFloodedAreaKm2, b.maximumFloodedAreaKm2, 'km²'],
    ['Buildings affected at any time', a.envelopeStats.affectedBuildingsCount, b.envelopeStats.affectedBuildingsCount, ''],
    ['Road length flooded at any time', a.envelopeStats.affectedRoadsKm, b.envelopeStats.affectedRoadsKm, 'km'],
  ] as const;
  const maxDepth = Math.max(a.envelopeStats.maxDepth, b.envelopeStats.maxDepth, 0.01);
  const timingView = mode === 'arrival' || mode === 'duration';
  const aTiming = mode === 'arrival' ? a.arrivalTimeSeconds : a.floodDurationSeconds;
  const bTiming = mode === 'arrival' ? b.arrivalTimeSeconds : b.floodDurationSeconds;
  let timingMax = 0;
  if (timingView) for (const values of [aTiming, bTiming]) if (values) for (const t of values) timingMax = Math.max(timingMax, t);
  let maxDifference = 0.01;
  for (const d of difference) maxDifference = Math.max(maxDifference, Math.abs(d));
  const inputRows = [
    ['Rainfall (mm/h)', baseline.inputs.config.rainfall.intensityMmPerHour, candidate.inputs.config.rainfall.intensityMmPerHour],
    ['Rain duration (min)', baseline.inputs.config.rainfall.durationSeconds / 60, candidate.inputs.config.rainfall.durationSeconds / 60],
    ['Total base inflow (m³/s)', baseline.inputs.config.inflows.reduce((s, i) => s + i.baseDischarge, 0), candidate.inputs.config.inflows.reduce((s, i) => s + i.baseDischarge, 0)],
    ['Hydrograph', baseline.inputs.config.inflowPreset, candidate.inputs.config.inflowPreset],
    ['Run duration (min)', baseline.inputs.config.duration / 60, candidate.inputs.config.duration / 60],
    ['Event starts (min)', (baseline.inputs.config.hydrographStartSeconds ?? 0) / 60, (candidate.inputs.config.hydrographStartSeconds ?? 0) / 60],
    ['Event duration (min)', (baseline.inputs.config.hydrographDurationSeconds ?? baseline.inputs.config.duration) / 60, (candidate.inputs.config.hydrographDurationSeconds ?? candidate.inputs.config.duration) / 60],
    ["Manning’s n", baseline.inputs.config.manningsN, candidate.inputs.config.manningsN],
  ];
  return <dialog ref={dialog} onClose={onClose} onCancel={onClose} aria-labelledby="comparison-title"
    className="m-auto w-[95vw] max-w-5xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-600 bg-slate-950 text-slate-100 p-5 shadow-2xl backdrop:bg-black/75">
    <DataSourceLabels sources={dataSources(baseline.inputs)} />
    <DataSourceLabels sources={dataSources(candidate.inputs)} />
    <header className="flex justify-between items-center gap-4 mb-4">
      <h2 id="comparison-title" className="text-lg font-bold">{candidate.name} vs {baseline.name}</h2>
      <button onClick={onClose} className="px-3 py-2 bg-slate-800 rounded-lg">Close</button>
    </header>
    <label className="text-sm">Map view <select aria-label="Comparison map view" value={mode} onChange={e => { setMode(e.target.value as typeof mode); setPlaying(false); }} className="bg-slate-800 border border-slate-600 p-2 rounded-lg ml-2">
      <option value="peak">Maximum depth</option><option value="difference">Depth difference</option>
      <option value="playback">Synchronized playback</option>
      <option value="arrival" disabled={!hasTiming(a) || !hasTiming(b)}>Arrival time</option>
      <option value="duration" disabled={!hasTiming(a) || !hasTiming(b)}>Flood duration</option>
    </select></label>
    {mode === 'playback' && <div className="my-3 flex flex-wrap items-center gap-3">
      <button className="bg-sky-700 px-3 py-2 rounded" onClick={() => { if (time >= commonEnd) setTime(0); setPlaying(!playing); }}>{playing ? 'Pause' : 'Play'}</button>
      <label className="flex-1 min-w-40 text-xs">Elapsed time: {Math.round(time)} s
        <input aria-label="Comparison elapsed time" type="range" min={0} max={commonEnd} step="any" value={time} onChange={e => { setTime(Number(e.target.value)); setPlaying(false); }} className="w-full" />
      </label>
      <p className="text-xs text-slate-400 w-full">Uses each run’s latest recorded frame at or before this time; stops at the shorter run.</p>
    </div>}
    <div className="grid sm:grid-cols-2 gap-4 mt-4">
      {timingView ? <>
        <TimingRaster dem={baseline.inputs.dem} values={aTiming!} reached={a.arrivalTimeSeconds!} maxSeconds={timingMax} title={`${baseline.name} — ${mode === 'arrival' ? 'arrival' : 'duration'}`} />
        <TimingRaster dem={candidate.inputs.dem} values={bTiming!} reached={b.arrivalTimeSeconds!} maxSeconds={timingMax} title={`${candidate.name} — ${mode === 'arrival' ? 'arrival' : 'duration'}`} />
      </> : mode === 'difference' ? <FloodMap scenario={candidate} depth={difference} max={maxDifference} difference title="Candidate − baseline: maximum depth" /> : <>
        <FloodMap scenario={baseline} depth={mode === 'playback' ? aFrame.depth : a.peakDepth} max={maxDepth} title={`${baseline.name}${mode === 'playback' ? ` · ${aFrame.simulatedTimeSeconds.toFixed(0)} s` : ''}`} />
        <FloodMap scenario={candidate} depth={mode === 'playback' ? bFrame.depth : b.peakDepth} max={maxDepth} title={`${candidate.name}${mode === 'playback' ? ` · ${bFrame.simulatedTimeSeconds.toFixed(0)} s` : ''}`} />
      </>}
    </div>
    <p className="text-xs text-slate-400 my-3">{timingView ? 'Shared time scale. Gray means not reached, not zero. Durations sum wet periods within each run; compare equal observation lengths for like-for-like durations.' : mode === 'difference' ? `Blue: decreased · White: unchanged · Red: increased · Range ±${maxDifference.toFixed(2)} m` : `Shared depth scale: light blue (shallow) to dark blue (${maxDepth.toFixed(2)} m). Gray: below flood threshold.`}</p>
    <div className="overflow-x-auto"><table className="w-full text-xs text-left my-4">
      <caption className="text-left text-sm font-semibold mb-2">Whole-event results · flood threshold {a.floodDepthThreshold} m · building/road exposure ≥ 0.3 m</caption>
      <thead><tr className="border-b border-slate-700"><th className="p-2">Metric</th><th className="p-2">Baseline</th><th className="p-2">Candidate</th><th className="p-2">Change</th></tr></thead>
      <tbody>{rows.map(([label, av, bv, unit]) => <tr key={label} className="border-b border-slate-800"><th className="p-2 font-normal">{label}</th>
        <td className="p-2">{av.toFixed(unit ? 3 : 0)} {unit}</td><td className="p-2">{bv.toFixed(unit ? 3 : 0)} {unit}</td>
        <td className="p-2">{bv - av > 0 ? '+' : ''}{(bv - av).toFixed(unit ? 3 : 0)} {unit}</td></tr>)}</tbody>
    </table></div>
    <details className="text-xs"><summary className="cursor-pointer text-sky-300">Compare inputs</summary>
      <table className="w-full text-left mt-2"><thead><tr><th>Input</th><th>Baseline</th><th>Candidate</th></tr></thead>
        <tbody>{inputRows.map(([label, av, bv]) => <tr key={label} className="border-b border-slate-800"><th className="p-2 font-normal">{label}</th><td className="p-2">{av}</td><td className="p-2">{bv}</td></tr>)}</tbody>
      </table>
    </details>
  </dialog>;
}
