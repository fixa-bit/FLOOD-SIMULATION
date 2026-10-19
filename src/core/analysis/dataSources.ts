import { DataSource, DemData, OsmBuilding, OsmRoad } from '../types';

export interface DataSources { terrain: DataSource; infrastructure: DataSource }
export function dataSources(inputs: { dem: DemData; buildings: OsmBuilding[]; roads: OsmRoad[]; infrastructureSource?: DataSource }): DataSources {
  return {
    terrain: inputs.dem.source ?? { kind: 'unknown', label: 'Terrain source unknown (older or supplied data)' },
    infrastructure: inputs.infrastructureSource ?? (
      [...inputs.buildings, ...inputs.roads].some(x => x.id.startsWith('synthetic_'))
        ? { kind: 'synthetic', label: 'Synthetic buildings/roads', details: 'Procedurally generated infrastructure; not a real asset inventory.' }
        : { kind: 'unknown', label: 'Infrastructure source unknown (older or supplied data)' }
    ),
  };
}
export function sourceSummary(sources: DataSources): string {
  return `${sources.terrain.label}; ${sources.infrastructure.label}`;
}
