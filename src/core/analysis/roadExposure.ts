import { BoundingBox, OsmRoad } from '../types';
import { haversineDistance } from '../terrain/geoUtils';

export interface RoadSample { cell: number; lengthMeters: number }

/** Clip each segment to the domain and split it at grid-cell boundaries.
 * A road is assessed only for its in-domain length, using nearest DEM samples.
 */
export function sampleRoads(roads: OsmRoad[], bounds: BoundingBox, width: number, height: number): RoadSample[] {
  const samples: RoadSample[] = [];
  for (const road of roads) {
    for (let i = 1; i < road.coordinates.length; i++) {
      const [lon0, lat0] = road.coordinates[i - 1];
      const [lon1, lat1] = road.coordinates[i];
      if (![lon0, lat0, lon1, lat1].every(Number.isFinite)) continue;
      if (lon0 === lon1 && lat0 === lat1) continue;
      const x0 = (lon0 - bounds.west) / (bounds.east - bounds.west) * (width - 1);
      const y0 = (bounds.north - lat0) / (bounds.north - bounds.south) * (height - 1);
      const dx = (lon1 - lon0) / (bounds.east - bounds.west) * (width - 1);
      const dy = -(lat1 - lat0) / (bounds.north - bounds.south) * (height - 1);
      let start = 0, end = 1;
      for (const [position, delta, max] of [[x0, dx, width - 1], [y0, dy, height - 1]]) {
        if (delta === 0) {
          if (position < 0 || position > max) { end = -1; break; }
        } else {
          const a = -position / delta, b = (max - position) / delta;
          start = Math.max(start, Math.min(a, b));
          end = Math.min(end, Math.max(a, b));
        }
      }
      if (end <= start) continue;
      const cuts = [start, end];
      for (const [position, delta, size] of [[x0, dx, width], [y0, dy, height]]) {
        if (delta === 0) continue;
        for (let cell = 0; cell < size - 1; cell++) {
          const t = (cell + 0.5 - position) / delta;
          if (t > start && t < end) cuts.push(t);
        }
      }
      cuts.sort((a, b) => a - b);
      for (let j = 1; j < cuts.length; j++) {
        const a = cuts[j - 1], b = cuts[j];
        if (b - a < 1e-12) continue;
        const midpoint = (a + b) / 2;
        const x = Math.max(0, Math.min(width - 1, Math.round(x0 + midpoint * dx)));
        const y = Math.max(0, Math.min(height - 1, Math.round(y0 + midpoint * dy)));
        samples.push({ cell: y * width + x, lengthMeters: haversineDistance(
          lon0 + a * (lon1 - lon0), lat0 + a * (lat1 - lat0),
          lon0 + b * (lon1 - lon0), lat0 + b * (lat1 - lat0),
        ) });
      }
    }
  }
  return samples;
}

export function floodedRoadsKm(depth: Float32Array, samples: RoadSample[], threshold = 0.3): number {
  return samples.reduce((sum, sample) => sum + (depth[sample.cell] >= threshold ? sample.lengthMeters : 0), 0) / 1000;
}
