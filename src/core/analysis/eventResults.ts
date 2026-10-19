import { SimulationResult } from '../types';

export class EventAccumulator {
  readonly peakDepth: Float32Array;
  readonly arrivalTimeSeconds: Float64Array;
  readonly floodDurationSeconds: Float64Array;
  readonly wetAtEnd: Uint8Array;
  private previousDepth: Float32Array;
  private previousTime = 0;
  private initialized = false;
  maximumFloodedAreaKm2 = 0;
  constructor(size: number, readonly cellArea: number, readonly threshold: number) {
    this.peakDepth = new Float32Array(size);
    this.arrivalTimeSeconds = new Float64Array(size).fill(-1);
    this.floodDurationSeconds = new Float64Array(size);
    this.wetAtEnd = new Uint8Array(size);
    this.previousDepth = new Float32Array(size);
  }
  update(depth: Float32Array, timeSeconds = this.previousTime): void {
    if (timeSeconds < this.previousTime || !Number.isFinite(timeSeconds)) throw new Error('Event times must be finite and nondecreasing');
    const dt = timeSeconds - this.previousTime;
    let wet = 0;
    for (let i = 0; i < depth.length; i++) {
      const wasWet = this.previousDepth[i] >= this.threshold;
      const isWet = depth[i] >= this.threshold;
      if (!this.initialized) {
        if (isWet) this.arrivalTimeSeconds[i] = timeSeconds;
      } else if (isWet && wasWet) {
        this.floodDurationSeconds[i] += dt;
      } else if (isWet !== wasWet) {
        // Linear crossing estimate within a solver step; independent of output frames.
        const fraction = Math.max(0, Math.min(1, (this.threshold - this.previousDepth[i]) / (depth[i] - this.previousDepth[i])));
        this.floodDurationSeconds[i] += dt * (isWet ? 1 - fraction : fraction);
        if (isWet && this.arrivalTimeSeconds[i] < 0) this.arrivalTimeSeconds[i] = this.previousTime + dt * fraction;
      }
      this.wetAtEnd[i] = isWet ? 1 : 0;
      this.peakDepth[i] = Math.max(this.peakDepth[i], depth[i]);
      if (depth[i] >= this.threshold) wet++;
    }
    this.maximumFloodedAreaKm2 = Math.max(this.maximumFloodedAreaKm2, wet * this.cellArea / 1e6);
    this.previousDepth.set(depth);
    this.previousTime = timeSeconds;
    this.initialized = true;
  }
}

export function depthDifference(baseline: SimulationResult, candidate: SimulationResult): Float32Array {
  if (baseline.peakDepth.length !== candidate.peakDepth.length) throw new Error('Comparison grid sizes differ');
  return Float32Array.from(candidate.peakDepth, (depth, i) => depth - baseline.peakDepth[i]);
}
