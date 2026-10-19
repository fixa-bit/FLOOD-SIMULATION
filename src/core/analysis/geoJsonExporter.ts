import { BoundingBox, FrameStats, OsmBuilding, OsmRoad, SimulationFrame } from '../types';

export interface FloodSummaryReport {
  timestamp: string;
  bounds: BoundingBox;
  simulatedDurationSeconds: number;
  stats: FrameStats;
  inundationStats: {
    peakWaterDepthMeters: number;
    meanWaterDepthMeters: number;
    floodedAreaKm2: number;
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
  roads: OsmRoad[]
): FloodSummaryReport {
  const totalRoadsKm = roads.reduce((sum, r) => sum + r.lengthMeters, 0) / 1000.0;
  const floodedRoadsKm = lastFrame.stats.affectedRoadsKm;
  const floodedBldgs = lastFrame.stats.affectedBuildingsCount;
  const totalBldgs = buildings.length;

  return {
    timestamp: new Date().toISOString(),
    bounds,
    simulatedDurationSeconds: lastFrame.simulatedTimeSeconds,
    stats: lastFrame.stats,
    inundationStats: {
      peakWaterDepthMeters: Number(lastFrame.stats.maxDepth.toFixed(2)),
      meanWaterDepthMeters: Number(lastFrame.stats.meanDepth.toFixed(3)),
      floodedAreaKm2: Number(lastFrame.stats.floodedAreaKm2.toFixed(3)),
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
  const cellLonStep = (bounds.east - bounds.west) / width;
  const cellLatStep = (bounds.north - bounds.south) / height;

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

        const minLon = bounds.west + x * cellLonStep;
        const maxLon = bounds.west + runEnd * cellLonStep;
        const maxLat = bounds.north - y * cellLatStep;
        const minLat = bounds.north - (y + 1) * cellLatStep;

        const maxCellDepth = depth[idx];

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
