import { BoundingBox, OsmBuilding } from '../types';

export interface BuildingObstacles {
  mask: Uint8Array;
  /** Exterior cells used to measure water against each building, in input order. */
  exposureCells: number[][];
}

/** Rasterize footprints at the same grid sample locations as the DEM.
 * Only samples inside a polygon are solid; small footprints may be unresolved.
 * This avoids expanding every small building into a full, artificial grid barrier.
 */
export function rasterizeBuildings(
  buildings: OsmBuilding[], bounds: BoundingBox, width: number, height: number
): BuildingObstacles {
  const mask = new Uint8Array(width * height);
  const footprints: number[][] = [];
  for (const building of buildings) {
    const polygon = building.polygon.map(([lon, lat]) => [
      (lon - bounds.west) / (bounds.east - bounds.west) * (width - 1),
      (bounds.north - lat) / (bounds.north - bounds.south) * (height - 1),
    ]);
    const cells: number[] = [];
    footprints.push(cells);
    if (polygon.length < 3 || polygon.some(p => !p.every(Number.isFinite))) continue;
    const minX = Math.max(0, Math.ceil(Math.min(...polygon.map(p => p[0]))));
    const maxX = Math.min(width - 1, Math.floor(Math.max(...polygon.map(p => p[0]))));
    const minY = Math.max(0, Math.ceil(Math.min(...polygon.map(p => p[1]))));
    const maxY = Math.min(height - 1, Math.floor(Math.max(...polygon.map(p => p[1]))));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let inside = false;
        let onEdge = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const [xi, yi] = polygon[i];
          const [xj, yj] = polygon[j];
          const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
          if (Math.abs(cross) < 1e-8 && x >= Math.min(xi, xj) - 1e-8 &&
              x <= Math.max(xi, xj) + 1e-8 && y >= Math.min(yi, yj) - 1e-8 &&
              y <= Math.max(yi, yj) + 1e-8) onEdge = true;
          if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
        if (inside || onEdge) {
          const index = y * width + x;
          cells.push(index);
          mask[index] = 1;
        }
      }
    }
  }
  const exposureCells = footprints.map((cells, i) => {
    const exterior = new Set<number>();
    // Unresolved footprints retain point exposure sampling, without blocking flow.
    const seeds = cells.length ? cells : [
      Math.max(0, Math.min(height - 1, buildings[i].gridY)) * width +
      Math.max(0, Math.min(width - 1, buildings[i].gridX)),
    ];
    for (const cell of seeds) {
      const x = cell % width;
      const y = Math.floor(cell / width);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox, ny = y + oy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && !mask[ny * width + nx]) {
            exterior.add(ny * width + nx);
          }
        }
      }
    }
    return [...exterior];
  });
  return { mask, exposureCells };
}

/** Exterior water-surface elevation relative to the building's ground level. */
export function buildingWaterDepth(
  building: OsmBuilding, cells: number[], depth: Float32Array, elevation: Float32Array
): number {
  let result = 0;
  for (const cell of cells) {
    if (depth[cell] > 0) result = Math.max(result, elevation[cell] + depth[cell] - building.elevation);
  }
  return result;
}
