import { SimulationResult } from '../types';
import { ScenarioInputs } from '../scenarios/scenarioStorage';
import { dataSources } from './dataSources';

export function hasTiming(result: SimulationResult): boolean {
  return result.arrivalTimeSeconds?.length === result.peakDepth.length &&
    result.floodDurationSeconds?.length === result.peakDepth.length && result.wetAtEnd?.length === result.peakDepth.length;
}
export function timingAt(result: SimulationResult, cell: number) {
  if (!hasTiming(result)) return null;
  const arrival = result.arrivalTimeSeconds![cell];
  return { arrivalSeconds: arrival < 0 ? null : arrival, durationSeconds: result.floodDurationSeconds![cell], stillWet: result.wetAtEnd![cell] === 1 };
}
export function exportTimingGrids(inputs: ScenarioInputs, result: SimulationResult) {
  if (!hasTiming(result)) throw new Error('This older result has no timing grids. Rerun the scenario.');
  return {
    type: 'FloodSimTimingGrids', version: 1, bounds: inputs.dem.bounds,
    width: inputs.dem.width, height: inputs.dem.height, dxMeters: inputs.dem.dx, dyMeters: inputs.dem.dy,
    layout: 'Row-major; row 0 is north; column 0 is west. Samples include bounding-box edges.',
    floodDepthThresholdMeters: result.floodDepthThreshold, observedDurationSeconds: result.observedDurationSeconds,
    method: 'Linear threshold-crossing estimates between solver steps. Duration sums wet periods within the observed run; stillWetAtEnd marks truncated durations.',
    dataSources: dataSources(inputs),
    eventTiming: { startSeconds: inputs.config.hydrographStartSeconds ?? 0, durationSeconds: inputs.config.hydrographDurationSeconds ?? inputs.config.duration, preset: inputs.config.inflowPreset },
    arrivalTimeSeconds: Array.from(result.arrivalTimeSeconds!, t => t < 0 ? null : t),
    floodDurationSeconds: Array.from(result.floodDurationSeconds!), stillWetAtEnd: Array.from(result.wetAtEnd!),
  };
}
