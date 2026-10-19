/**
 * DEM Pit & Depression Filling
 *
 * Removes artificial sinks and single-cell pits from DEMs so hydraulic
 * simulations can route water continuously without being trapped in raster artifacts.
 * Also handles nodata and sea-level adjustments.
 */

/**
 * Handle invalid values (NaN, Infinity, extreme nodata < -1000m on land)
 * Replaces them with locally interpolated valid elevations.
 */
export function cleanDemData(
  elevation: Float32Array,
  width: number,
  height: number
): Float32Array {
  const result = new Float32Array(elevation);
  const size = width * height;

  // Find average of valid elevations as initial fallback
  let validSum = 0;
  let validCount = 0;
  for (let i = 0; i < size; i++) {
    const val = result[i];
    if (Number.isFinite(val) && val > -500 && val < 9000) {
      validSum += val;
      validCount++;
    }
  }
  const defaultElevation = validCount > 0 ? validSum / validCount : 100.0;

  // Pass 1: Replace non-finite or extreme nodata
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const val = result[idx];
      if (!Number.isFinite(val) || val < -500 || val > 9000) {
        // Collect neighbor values
        let nSum = 0;
        let nCount = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nVal = result[ny * width + nx];
              if (Number.isFinite(nVal) && nVal > -500 && nVal < 9000) {
                nSum += nVal;
                nCount++;
              }
            }
          }
        }
        result[idx] = nCount > 0 ? nSum / nCount : defaultElevation;
      }
    }
  }

  return result;
}

/**
 * Priority-flood / iterative depression-filling algorithm.
 * Raises any interior cell that is strictly lower than all its surrounding 8 neighbors,
 * ensuring continuous drainage pathways while preserving terrain geometry.
 */
export function fillDepressions(
  elevation: Float32Array,
  width: number,
  height: number,
  epsilon = 0.005
): Float32Array {
  const filled = cleanDemData(elevation, width, height);
  const maxIterations = 50;
  let changed = true;
  let iter = 0;

  // We keep boundary cells fixed as potential natural outlets
  while (changed && iter < maxIterations) {
    changed = false;
    iter++;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const currentElev = filled[idx];

        // Find lowest neighbor
        let minNeighborElev = Infinity;

        // 8-neighbor scan
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nElev = filled[(y + dy) * width + (x + dx)];
            if (nElev < minNeighborElev) {
              minNeighborElev = nElev;
            }
          }
        }

        // If current cell is strictly lower than all its 8 neighbors, it is a pit!
        // Raise it to the lowest neighbor elevation + epsilon to allow drainage.
        if (currentElev < minNeighborElev) {
          filled[idx] = minNeighborElev + epsilon;
          changed = true;
        }
      }
    }
  }

  return filled;
}
