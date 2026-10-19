import { DataSources, sourceSummary, dataSources } from '../../core/analysis/dataSources';
import { useFloodStore } from '../store/useFloodStore';

export function DataSourceLabels({ sources }: { sources: DataSources }) {
  const warning = [sources.terrain, sources.infrastructure].some(s => ['synthetic', 'mixed', 'unknown'].includes(s.kind));
  return <p className={`text-xs rounded-lg px-3 py-2 border ${warning ? 'bg-amber-950/60 text-amber-200 border-amber-700/60' : 'bg-slate-900 text-slate-300 border-slate-700'}`}
    title={[sources.terrain.details, sources.infrastructure.details].filter(Boolean).join(' ')}>
    {sourceSummary(sources)}
  </p>;
}

export function DataSourceBanner() {
  const { dem, buildings, roads, infrastructureSource, imagerySource } = useFloodStore();
  if (!dem) return null;
  const sources = dataSources({ dem, buildings, roads, infrastructureSource });
  return <div aria-label="Data sources" className="shrink-0 border-b border-slate-700 bg-slate-950 px-3 py-1 text-[11px] text-amber-200 flex flex-wrap gap-x-4 gap-y-1">
    <span title={sources.terrain.details}>Terrain: {sources.terrain.label}</span>
    <span title={sources.infrastructure.details}>Infrastructure: {sources.infrastructure.label}</span>
    <span title={imagerySource?.details}>Display: {imagerySource?.label ?? 'Imagery loading'}</span>
  </div>;
}
