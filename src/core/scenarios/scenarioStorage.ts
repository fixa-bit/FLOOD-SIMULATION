import { DataSource, DemData, OsmBuilding, OsmRoad, SimulationConfig, SimulationFrame, SimulationResult } from '../types';
import { DataSources, dataSources } from '../analysis/dataSources';
import { normalizeEventTiming } from '../sim/eventTiming';

export interface ScenarioInputs {
  config: SimulationConfig;
  dem: DemData;
  buildings: OsmBuilding[];
  roads: OsmRoad[];
  infrastructureSource?: DataSource;
}
export interface ScenarioMetadata {
  id: string;
  name: string;
  createdAt: string;
  hasResults: boolean;
  sources?: DataSources;
}
export interface SavedScenario extends ScenarioMetadata {
  version: 1;
  inputs: ScenarioInputs;
  frames: SimulationFrame[];
  result: SimulationResult | null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Scenario storage is unavailable in this browser.'));
    const request = indexedDB.open('floodsim_scenarios', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('scenarios', { keyPath: 'id' });
      request.result.createObjectStore('metadata', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Could not open scenario storage.'));
    request.onblocked = () => reject(new Error('Close other FloodSim tabs to open scenario storage.'));
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (tx: IDBTransaction, done: (value: T) => void) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(['scenarios', 'metadata'], mode);
    let result: T;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(new Error('Scenario storage failed. Check available browser storage.')); };
    tx.onerror = () => { /* onabort handles the failed transaction */ };
    try { action(tx, value => { result = value; }); }
    catch (error) { tx.abort(); reject(error); }
  });
}

export const listScenarios = () => transaction<ScenarioMetadata[]>('readonly', (tx, done) => {
  const request = tx.objectStore('metadata').getAll();
  request.onsuccess = () => done(request.result.sort((a: ScenarioMetadata, b: ScenarioMetadata) => b.createdAt.localeCompare(a.createdAt)));
});

export const readScenario = (id: string) => transaction<SavedScenario>('readonly', (tx, done) => {
  const request = tx.objectStore('scenarios').get(id);
  request.onsuccess = () => {
    if (!request.result || request.result.version !== 1) tx.abort();
    else {
      const scenario = request.result as SavedScenario;
      scenario.inputs.config = normalizeEventTiming(scenario.inputs.config);
      done(scenario);
    }
  };
});

export const writeScenario = (scenario: SavedScenario) => transaction<void>('readwrite', tx => {
  const sources = dataSources(scenario.inputs);
  tx.objectStore('scenarios').put({ ...scenario, sources });
  const { id, name, createdAt, hasResults } = scenario;
  tx.objectStore('metadata').put({ id, name, createdAt, hasResults, sources });
});

export const deleteScenario = (id: string) => transaction<void>('readwrite', tx => {
  tx.objectStore('scenarios').delete(id);
  tx.objectStore('metadata').delete(id);
});

export async function renameScenario(id: string, name: string): Promise<void> {
  const scenario = await readScenario(id);
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a scenario name.');
  await writeScenario({ ...scenario, name: trimmed });
}

/** Compare only results on identical spatial inputs; rainfall/discharge/roughness may differ. */
export function comparisonProblem(a: SavedScenario, b: SavedScenario): string | null {
  if (!a.result || !b.result) return 'Run and save both scenarios before comparing results.';
  const spatial = (s: SavedScenario) => JSON.stringify({
    bounds: s.inputs.dem.bounds, width: s.inputs.dem.width, height: s.inputs.dem.height,
    dx: s.inputs.dem.dx, dy: s.inputs.dem.dy,
    buildings: s.inputs.buildings, roads: s.inputs.roads,
    threshold: s.result!.floodDepthThreshold,
  });
  if (spatial(a) !== spatial(b)) return 'Comparison requires the same area, grid, infrastructure, and flood threshold. Duplicate a baseline to keep these inputs identical.';
  for (const field of ['elevation', 'initialWaterDepth'] as const) {
    const x = a.inputs.dem[field], y = b.inputs.dem[field];
    if ((!x !== !y) || (x && y && (x.length !== y.length || x.some((v, i) => v !== y[i])))) {
      return 'Terrain or initial water differs. Duplicate a baseline to compare on the same spatial inputs.';
    }
  }
  return null;
}
