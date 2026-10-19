import { SimulationConfig } from '../types';

/** Preserve the original event window when upgrading a config that predates explicit timing. */
export function normalizeEventTiming(config: SimulationConfig): SimulationConfig {
  return { ...config, hydrographStartSeconds: config.hydrographStartSeconds ?? 0,
    hydrographDurationSeconds: config.hydrographDurationSeconds ?? config.duration };
}
