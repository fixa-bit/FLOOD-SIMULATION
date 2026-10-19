import { BoundingBox } from '../core/types';

export interface ParsedUrlConfig {
  presetId?: string;
  bounds?: BoundingBox;
  duration?: number;
  inflowDischarge?: number;
  rainfallMmHr?: number;
  autoStart?: boolean;
}

/**
 * Parse URL query parameters to configure simulation:
 * E.g.: ?bbox=72.30,34.74,72.38,34.82&inflow=900&duration=3600&rain=25&autostart=true
 */
export function parseUrlParameters(): ParsedUrlConfig {
  if (typeof window === 'undefined' || !window.location) {
    return {};
  }

  const params = new URLSearchParams(window.location.search);
  const result: ParsedUrlConfig = {};

  // Check preset
  const preset = params.get('preset');
  if (preset) {
    result.presetId = preset;
  }

  // Check bbox: minLon,minLat,maxLon,maxLat
  const bbox = params.get('bbox');
  if (bbox) {
    const parts = bbox.split(',').map((v) => parseFloat(v.trim()));
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      result.bounds = {
        west: parts[0],
        south: parts[1],
        east: parts[2],
        north: parts[3],
      };
    }
  }

  // Inflow
  const inflow = params.get('inflow');
  if (inflow) {
    const infNum = parseFloat(inflow);
    if (!isNaN(infNum)) result.inflowDischarge = infNum;
  }

  // Duration
  const dur = params.get('duration');
  if (dur) {
    const durNum = parseFloat(dur);
    if (!isNaN(durNum)) result.duration = durNum;
  }

  // Rainfall
  const rain = params.get('rain');
  if (rain) {
    const rainNum = parseFloat(rain);
    if (!isNaN(rainNum)) result.rainfallMmHr = rainNum;
  }

  // AutoStart
  if (params.get('autostart') === 'true' || params.get('run') === 'true') {
    result.autoStart = true;
  }

  return result;
}
