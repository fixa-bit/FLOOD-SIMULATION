import { useEffect, useState } from 'react';
import { useFloodStore } from '../store/useFloodStore';
import { comparisonProblem, deleteScenario, listScenarios, readScenario, renameScenario, SavedScenario, ScenarioMetadata } from '../../core/scenarios/scenarioStorage';
import { ScenarioComparison } from './ScenarioComparison';
import { DataSourceLabels } from './DataSourceLabels';
import { EventMaps } from './EventMaps';

export function ScenarioPanel() {
  const { scenarioName, saveScenario, loadScenario, status, dem, result, runInputs } = useFloodStore();
  const [showTiming, setShowTiming] = useState(false);
  const [name, setName] = useState(scenarioName);
  const [scenarios, setScenarios] = useState<ScenarioMetadata[]>([]);
  const [baseline, setBaseline] = useState('');
  const [candidate, setCandidate] = useState('');
  const [comparison, setComparison] = useState<[SavedScenario, SavedScenario] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState('');
  const [newName, setNewName] = useState('');
  useEffect(() => { setName(scenarioName); }, [scenarioName]);
  useEffect(() => { listScenarios().then(setScenarios).catch(e => setMessage(e.message)); }, []);
  const locked = busy || status === 'simulating' || status === 'loading_terrain';
  const libraryLocked = busy || status === 'simulating';
  const action = async (work: () => Promise<void>, success = '') => {
    setBusy(true); setMessage('');
    try { await work(); setScenarios(await listScenarios()); setMessage(success); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Scenario operation failed.'); }
    finally { setBusy(false); }
  };
  const compare = () => action(async () => {
    const a = await readScenario(baseline), b = await readScenario(candidate);
    const problem = comparisonProblem(a, b);
    if (problem) throw new Error(problem);
    setComparison([a, b]);
  });
  return <section className="p-2.5 space-y-3" aria-label="Saved scenarios">
    <h2 className="text-xs font-semibold uppercase tracking-wide text-sky-300">Scenario workspace</h2>
    <label className="block text-xs text-slate-400">Scenario name
      <input aria-label="Scenario name" value={name} onChange={e => setName(e.target.value)} maxLength={120} className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-100" />
    </label>
    <div className="flex gap-2 text-xs">
      <button disabled={locked || !dem || !name.trim()} onClick={() => action(async () => { await saveScenario(name, false); }, 'Inputs saved.')} className="bg-slate-700 rounded-lg px-3 py-2 disabled:opacity-40">Save inputs</button>
      <button disabled={locked || !result || status !== 'finished' || !name.trim()} onClick={() => action(async () => { await saveScenario(name, true); }, 'Run saved with its original inputs.')} className="bg-sky-700 rounded-lg px-3 py-2 disabled:opacity-40">Save completed run</button>
    </div>
    <p className="text-[11px] text-slate-400">Saved on this browser, including terrain. Completed runs keep their original inputs and playback. Duplicate a baseline to edit rainfall or inflow.</p>
    {message && <p role="status" className="text-xs text-amber-300">{message}</p>}
    <div className="space-y-2 max-h-56 overflow-y-auto">
      {scenarios.map(s => <article key={s.id} aria-label={s.name} className="bg-slate-950/70 border border-slate-800 rounded-lg p-2 text-xs">
        <div className="flex justify-between gap-2"><span className="font-semibold break-all">{s.name}</span><span className="text-slate-500 shrink-0">{s.hasResults ? 'Run' : 'Inputs'}</span></div>
        {s.sources && <DataSourceLabels sources={s.sources} />}
        {renaming === s.id ? <form className="flex gap-1 mt-2" onSubmit={e => { e.preventDefault(); action(async () => { await renameScenario(s.id, newName); setRenaming(''); }); }}>
          <input aria-label="New scenario name" autoFocus value={newName} onChange={e => setNewName(e.target.value)} maxLength={120} className="min-w-0 w-full bg-slate-800 p-1 rounded" />
          <button disabled={locked || !newName.trim()} className="text-sky-300">Save</button><button type="button" onClick={() => setRenaming('')}>Cancel</button>
        </form> : <div className="flex flex-wrap gap-3 mt-2 text-sky-300">
          <button disabled={libraryLocked} onClick={() => action(() => loadScenario(s.id))}>Load</button>
          <button disabled={libraryLocked} onClick={() => action(() => loadScenario(s.id, true))}>Duplicate & edit</button>
          <button disabled={libraryLocked} onClick={() => { setRenaming(s.id); setNewName(s.name); }}>Rename</button>
          <button disabled={libraryLocked} className="text-red-400" onClick={() => action(async () => { await deleteScenario(s.id); if (baseline === s.id) setBaseline(''); if (candidate === s.id) setCandidate(''); })}>Delete</button>
        </div>}
      </article>)}
      {!scenarios.length && <p className="text-xs text-slate-500">No saved scenarios yet.</p>}
    </div>
    <div className="grid grid-cols-2 gap-2 text-xs">
      {([['Baseline', baseline, setBaseline], ['Candidate', candidate, setCandidate]] as const).map(([label, value, setter]) => <label key={label}>{label}
        <select aria-label={`${label} scenario`} value={value} onChange={e => setter(e.target.value)} disabled={locked} className="w-full mt-1 p-2 bg-slate-950 border border-slate-700 rounded-lg">
          <option value="">Select run</option>{scenarios.filter(s => s.hasResults).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>)}
    </div>
    <button disabled={locked || !baseline || !candidate || baseline === candidate} onClick={compare} className="w-full text-xs bg-sky-700 rounded-lg py-2 disabled:opacity-40">Compare saved runs</button>
    {comparison && <ScenarioComparison baseline={comparison[0]} candidate={comparison[1]} onClose={() => setComparison(null)} />}
    <button disabled={!result || !runInputs || locked} onClick={() => setShowTiming(true)} className="w-full text-xs bg-teal-700 rounded-lg py-2 disabled:opacity-40">Arrival & duration maps</button>
    {showTiming && result && runInputs && <EventMaps inputs={runInputs} result={result} name={name} onClose={() => setShowTiming(false)} />}
  </section>;
}
