import { BoundingBox, FrameStats, OsmBuilding, OsmRoad, SimulationFrame, SimulationResult } from '../types';
import { sampleRoads } from './roadExposure';
import { DataSources } from './dataSources';

export interface FloodSummaryReport {
  timestamp: string;
  bounds: BoundingBox;
  simulatedDurationSeconds: number;
  stats: FrameStats;
  /** Final simultaneous state; event maxima are in inundationStats/impactStats. */
  finalStateStats: FrameStats;
  resultScope: 'whole_event';
  floodDepthThresholdMeters: number;
  dataSources?: DataSources;
  eventTiming?: { startSeconds: number; durationSeconds: number; preset: string };
  timingAnalysis: { available: boolean; observedDurationSeconds: number; method: string; stillWetCellCount: number | null };
  inundationStats: {
    peakWaterDepthMeters: number;
    meanWaterDepthMeters: number;
    floodedAreaKm2: number;
    maximumSimultaneousFloodedAreaKm2: number;
    totalWaterVolumeM3: number;
    massBalanceErrorPct: number;
  };
  impactStats: {
    totalBuildingsAssessed: number;
    floodedBuildingsCount: number;
    percentageBuildingsFlooded: number;
    totalRoadsAssessedKm: number;
    floodedRoadsKm: number;
  };
}

/**
 * Generate a detailed JSON summary report of the flood simulation results.
 */
export function generateSummaryReport(
  bounds: BoundingBox,
  lastFrame: SimulationFrame,
  buildings: OsmBuilding[],
  roads: OsmRoad[],
  result: SimulationResult,
  grid: { width: number; height: number },
  context: { sources?: DataSources; eventTiming?: FloodSummaryReport['eventTiming'] } = {}
): FloodSummaryReport {
  const totalRoadsKm = sampleRoads(roads, bounds, grid.width, grid.height).reduce((sum, sample) => sum + sample.lengthMeters, 0) / 1000;
  const floodedRoadsKm = result.envelopeStats.affectedRoadsKm;
  const floodedBldgs = result.envelopeStats.affectedBuildingsCount;
  const totalBldgs = buildings.length;

  return {
    timestamp: new Date().toISOString(),
    bounds,
    simulatedDurationSeconds: lastFrame.simulatedTimeSeconds,
    stats: lastFrame.stats,
    finalStateStats: lastFrame.stats,
    resultScope: 'whole_event',
    floodDepthThresholdMeters: result.floodDepthThreshold,
    dataSources: context.sources,
    eventTiming: context.eventTiming,
    timingAnalysis: {
      available: !!result.arrivalTimeSeconds,
      observedDurationSeconds: result.observedDurationSeconds ?? lastFrame.simulatedTimeSeconds,
      method: 'First arrival and cumulative duration at/above the flood threshold, with linear crossing estimates within solver steps. Duration ends at the observation limit.',
      stillWetCellCount: result.wetAtEnd ? result.wetAtEnd.reduce((a, b) => a + b, 0) : null,
    },
    inundationStats: {
      peakWaterDepthMeters: Number(result.envelopeStats.maxDepth.toFixed(2)),
      meanWaterDepthMeters: Number(lastFrame.stats.meanDepth.toFixed(3)),
      floodedAreaKm2: Number(result.envelopeStats.floodedAreaKm2.toFixed(3)),
      maximumSimultaneousFloodedAreaKm2: Number(result.maximumFloodedAreaKm2.toFixed(3)),
      totalWaterVolumeM3: Math.round(lastFrame.stats.totalWaterVolumeM3),
      massBalanceErrorPct: Number(lastFrame.stats.massConservationErrorPct.toFixed(2)),
    },
    impactStats: {
      totalBuildingsAssessed: totalBldgs,
      floodedBuildingsCount: floodedBldgs,
      percentageBuildingsFlooded: totalBldgs > 0 ? Number(((floodedBldgs / totalBldgs) * 100).toFixed(1)) : 0,
      totalRoadsAssessedKm: Number(totalRoadsKm.toFixed(2)),
      floodedRoadsKm: Number(floodedRoadsKm.toFixed(2)),
    },
  };
}

/**
 * Generate a standard GeoJSON FeatureCollection of the flood extent polygon(s).
 * Converts flooded cells (depth >= threshold) into simplified bounding GeoJSON polygons.
 */
export function exportFloodExtentGeoJson(
  depth: Float32Array,
  width: number,
  height: number,
  bounds: BoundingBox,
  depthThreshold = 0.05
): any {
  const features: any[] = [];
  const visited = new Uint8Array(width * height);

  // Group connected flooded cells or cell bounding boxes
  const cellLonStep = (bounds.east - bounds.west) / Math.max(1, width - 1);
  const cellLatStep = (bounds.north - bounds.south) / Math.max(1, height - 1);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (depth[idx] >= depthThreshold && !visited[idx]) {
        // Collect a horizontal run of flooded cells to form rectangular polygons
        let runEnd = x;
        while (runEnd < width && depth[y * width + runEnd] >= depthThreshold && !visited[y * width + runEnd]) {
          visited[y * width + runEnd] = 1;
          runEnd++;
        }

        const minLon = width === 1 ? bounds.west : bounds.west + Math.max(0, x - 0.5) * cellLonStep;
        const maxLon = width === 1 ? bounds.east : bounds.west + Math.min(width - 1, runEnd - 0.5) * cellLonStep;
        const maxLat = height === 1 ? bounds.north : bounds.north - Math.max(0, y - 0.5) * cellLatStep;
        const minLat = height === 1 ? bounds.south : bounds.north - Math.min(height - 1, y + 0.5) * cellLatStep;

        let maxCellDepth = 0;
        for (let column = x; column < runEnd; column++) maxCellDepth = Math.max(maxCellDepth, depth[y * width + column]);

        features.push({
          type: 'Feature',
          properties: {
            depth_m: Number(maxCellDepth.toFixed(2)),
            hazard: maxCellDepth >= 1.0 ? 'high' : maxCellDepth >= 0.3 ? 'medium' : 'low',
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [minLon, minLat],
                [maxLon, minLat],
                [maxLon, maxLat],
                [minLon, maxLat],
                [minLon, minLat],
              ],
            ],
          },
        });
      }
    }
  }

  return {
    type: 'FeatureCollection',
    name: 'FloodSim_Extent',
    crs: {
      type: 'name',
      properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' },
    },
    features,
  };
}
