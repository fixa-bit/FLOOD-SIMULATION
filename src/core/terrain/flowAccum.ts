import { BoundingBox } from '../types';

/**
 * D8 Flow Direction and Accumulation
 * Computes steepest descent flow routing and cumulative upstream contributing cells.
 * Used to automatically detect main river channels and suggest inflow source locations.
 */

// 8 neighbor offsets: [dx, dy, distanceMultiplier]
const D8_OFFSETS: [number, number, number][] = [
  [1, 0, 1.0],           // East (0)
  [1, 1, Math.SQRT2],    // South-East (1)
  [0, 1, 1.0],           // South (2)
  [-1, 1, Math.SQRT2],   // South-West (3)
  [-1, 0, 1.0],          // West (4)
  [-1, -1, Math.SQRT2],  // North-West (5)
  [0, -1, 1.0],          // North (6)
  [1, -1, Math.SQRT2],   // North-East (7)
];

export interface FlowAccumResult {
  flowDirections: Int8Array;      // Index of receiver neighbor (0-7), or -1 if pit
  flowAccumulation: Int32Array;   // Number of upstream contributing cells
  suggestedInflow: {
    gridX: number;
    gridY: number;
    elevation: number;
    accumulation: number;
  };
}

export function computeFlowAccumulation(
  elevation: Float32Array,
  width: number,
  height: number,
  cellSizeMeters = 30
): FlowAccumResult {
  const size = width * height;
  const flowDir = new Int8Array(size).fill(-1);
  const accum = new Int32Array(size).fill(1); // Every cell contributes at least itself

  // Step 1: Calculate D8 flow direction for every cell
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const elev = elevation[idx];

      let maxSlope = 0;
      let bestDir = -1;

      for (let d = 0; d < 8; d++) {
        const [dx, dy, distMult] = D8_OFFSETS[d];
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nElev = elevation[ny * width + nx];
          const drop = elev - nElev;
          if (drop > 0) {
            const slope = drop / (cellSizeMeters * distMult);
            if (slope > maxSlope) {
              maxSlope = slope;
              bestDir = d;
            }
          }
        }
      }

      flowDir[idx] = bestDir;
    }
  }

  // Step 2: Sort cells by elevation descending
  // Create indices array and sort descending
  const indices = new Int32Array(size);
  for (let i = 0; i < size; i++) indices[i] = i;

  indices.sort((a, b) => elevation[b] - elevation[a]);

  // Step 3: Accumulate flow down the topological gradient
  for (let i = 0; i < size; i++) {
    const idx = indices[i];
    const dir = flowDir[idx];

    if (dir >= 0) {
      const x = idx % width;
      const y = Math.floor(idx / width);
      const [dx, dy] = D8_OFFSETS[dir];
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const receiverIdx = ny * width + nx;
        accum[receiverIdx] += accum[idx];
      }
    }
  }

  // Step 4: Find optimal inflow source
  // We want a point with high accumulation (river channel) that is situated
  // in the upper/inlet portion of the valley, ideally near an upstream boundary or valley entrance
  let bestCandidate = {
    gridX: Math.floor(width / 2),
    gridY: Math.floor(height * 0.2),
    elevation: elevation[0] || 100,
    accumulation: 0,
  };

  let maxScore = -Infinity;

  // Search within a buffer inside the domain (e.g. 5% to 40% from top/sides or channel entrance)
  for (let y = 3; y < height - 3; y++) {
    for (let x = 3; x < width - 3; x++) {
      const idx = y * width + x;
      const a = accum[idx];
      const elev = elevation[idx];

      // Prefer high accumulation cells that are higher in elevation than the lowest basin floor
      // This represents where a river enters the model domain
      if (a > 10) {
        // Distance to edge factor: upstream rivers often enter near bounds
        const distToEdge = Math.min(x, width - 1 - x, y, height - 1 - y);
        const edgeWeight = 1.0 / (1.0 + Math.max(0, distToEdge - 5) * 0.05);
        const score = Math.log(a + 1) * 2.0 + edgeWeight * 3.0;

        if (score > maxScore) {
          maxScore = score;
          bestCandidate = {
            gridX: x,
            gridY: y,
            elevation: elev,
            accumulation: a,
          };
        }
      }
    }
  }

  // Fallback: if no clear channel detected (e.g. flat plain), pick lowest point in upper quadrant
  if (maxScore === -Infinity) {
    let minElev = Infinity;
    for (let y = 5; y < Math.floor(height * 0.5); y++) {
      for (let x = 5; x < width - 5; x++) {
        const elev = elevation[y * width + x];
        if (elev < minElev) {
          minElev = elev;
          bestCandidate = {
            gridX: x,
            gridY: y,
            elevation: elev,
            accumulation: 1,
          };
        }
      }
    }
  }

  return {
    flowDirections: flowDir,
    flowAccumulation: accum,
    suggestedInflow: bestCandidate,
  };
}

export interface RiverNetworkResult {
  initialDepth: Float32Array;
  riverMask: Uint8Array;
  upstreamInlet: {
    gridX: number;
    gridY: number;
    elevation: number;
    accumulation: number;
    inletCells: { gridX: number; gridY: number }[];
  };
}

/**
 * Extract pre-existing natural river channel network and upstream inlet cross-section.
 * Realistically initializes the river bed with flowing baseflow water before the flood begins.
 */
export function extractRiverChannelNetwork(
  elevation: Float32Array,
  accum: Int32Array,
  flowDir: Int8Array,
  width: number,
  height: number
): RiverNetworkResult {
  const size = width * height;
  const initialDepth = new Float32Array(size);
  const riverMask = new Uint8Array(size);

  let maxAccum = 1;
  for (let i = 0; i < size; i++) {
    if (accum[i] > maxAccum) maxAccum = accum[i];
  }

  // Channel threshold: top ~2% highest accumulation forms the river channel network
  const channelThreshold = Math.max(30, Math.floor(maxAccum * 0.02));

  // 1. Mark river cells and assign natural baseflow depth (0.7m to 2.2m)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const a = accum[idx];

      if (a >= channelThreshold) {
        riverMask[idx] = 1;
        const norm = (a - channelThreshold) / (maxAccum - channelThreshold + 1);
        const depth = 0.7 + Math.min(1.8, Math.pow(norm, 0.3) * 1.5);
        initialDepth[idx] = depth;
      }
    }
  }

  // 2. Downhill water surface slope continuity
  // Water surface eta = elevation + depth must decrease or stay flat towards receiver
  const indices = new Int32Array(size);
  for (let i = 0; i < size; i++) indices[i] = i;
  indices.sort((a, b) => elevation[b] - elevation[a]); // Descending elevation

  for (let i = 0; i < size; i++) {
    const idx = indices[i];
    if (riverMask[idx]) {
      const dir = flowDir[idx];
      if (dir >= 0) {
        const x = idx % width;
        const y = Math.floor(idx / width);
        const [dx, dy] = D8_OFFSETS[dir];
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const recIdx = ny * width + nx;
          if (riverMask[recIdx]) {
            const etaCurrent = elevation[idx] + initialDepth[idx];
            const etaReceiver = elevation[recIdx] + initialDepth[recIdx];
            // Ensure water flows downhill
            if (etaReceiver > etaCurrent) {
              initialDepth[idx] = Math.max(initialDepth[idx], (elevation[recIdx] + initialDepth[recIdx]) - elevation[idx] + 0.05);
            }
          }
        }
      }
    }
  }

  // 3. Find upstream river channel inlet cross-section (where river enters the domain boundary)
  let bestInlet = {
    gridX: Math.floor(width / 2),
    gridY: Math.floor(height * 0.1),
    elevation: -Infinity,
    accumulation: 0,
    inletCells: [] as { gridX: number; gridY: number }[],
  };

  const margin = 8;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isNearEdge = x < margin || x >= width - margin || y < margin || y >= height - margin;
      if (isNearEdge) {
        const idx = y * width + x;
        if (riverMask[idx]) {
          const elev = elevation[idx];
          // Upstream river entrance is at the highest elevation boundary channel cell
          if (elev > bestInlet.elevation) {
            bestInlet.elevation = elev;
            bestInlet.gridX = x;
            bestInlet.gridY = y;
            bestInlet.accumulation = accum[idx];
          }
        }
      }
    }
  }

  // Collect the contiguous river channel cross-section cells around the inlet
  const crossSectionCells: { gridX: number; gridY: number }[] = [];
  const radius = 3;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = bestInlet.gridX + dx;
      const ny = bestInlet.gridY + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (riverMask[nIdx]) {
          crossSectionCells.push({ gridX: nx, gridY: ny });
        }
      }
    }
  }

  if (crossSectionCells.length === 0) {
    crossSectionCells.push({ gridX: bestInlet.gridX, gridY: bestInlet.gridY });
  }

  bestInlet.inletCells = crossSectionCells;

  return {
    initialDepth,
    riverMask,
    upstreamInlet: bestInlet,
  };
}

/**
 * Convert grid cell (x, y) to longitude/latitude within a bounding box.
 */
export function gridToLonLat(
  gridX: number,
  gridY: number,
  width: number,
  height: number,
  bounds: BoundingBox
): { lon: number; lat: number } {
  const lon = bounds.west + (gridX / (width - 1)) * (bounds.east - bounds.west);
  // gridY 0 is north (top), gridY (height-1) is south (bottom)
  const lat = bounds.north - (gridY / (height - 1)) * (bounds.north - bounds.south);
  return { lon, lat };
}

/**
 * Convert lon/lat to grid cell (x, y) within a bounding box.
 */
export function lonLatToGrid(
  lon: number,
  lat: number,
  width: number,
  height: number,
  bounds: BoundingBox
): { gridX: number; gridY: number } {
  const normX = (lon - bounds.west) / (bounds.east - bounds.west);
  const normY = (bounds.north - lat) / (bounds.north - bounds.south);
  const gridX = Math.max(0, Math.min(width - 1, Math.round(normX * (width - 1))));
  const gridY = Math.max(0, Math.min(height - 1, Math.round(normY * (height - 1))));
  return { gridX, gridY };
}
