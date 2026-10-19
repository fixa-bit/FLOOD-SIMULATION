import { PresetArea } from '../types';

export const PRESET_AREAS: PresetArea[] = [
  {
    id: 'swat_river',
    name: 'Swat River Valley (Mingora/Kabal)',
    region: 'Khyber Pakhtunkhwa, Pakistan',
    description:
      'Steep alpine river valley prone to rapid monsoon flash floods. High relief with narrow channel expansion.',
    bounds: {
      west: 72.3000,
      south: 34.7400,
      east: 72.3800,
      north: 34.8200,
    },
    recommendedInflows: [
      {
        gridX: 68,
        gridY: 18,
        lon: 72.321,
        lat: 34.805,
        label: 'Swat River Inflow (Upstream)',
        baseDischarge: 850, // m3/s
        peakMultiplier: 2.8,
      },
    ],
    recommendedDuration: 3600, // 1 hour
    recommendedRainfall: {
      intensityMmPerHour: 35,
      durationSeconds: 1800,
    },
  },
  {
    id: 'nowshera_kabul',
    name: 'Nowshera (Kabul River)',
    region: 'Khyber Pakhtunkhwa, Pakistan',
    description:
      'Major confluence zone and urbanized floodplain vulnerable to devastating regional inundation.',
    bounds: {
      west: 71.9300,
      south: 33.9700,
      east: 72.0300,
      north: 34.0500,
    },
    recommendedInflows: [
      {
        gridX: 30,
        gridY: 70,
        lon: 71.945,
        lat: 34.015,
        label: 'Kabul River Main Inflow',
        baseDischarge: 1200, // m3/s
        peakMultiplier: 2.2,
      },
    ],
    recommendedDuration: 7200, // 2 hours
    recommendedRainfall: {
      intensityMmPerHour: 20,
      durationSeconds: 3600,
    },
  },
  {
    id: 'indus_sukkur',
    name: 'Indus River near Sukkur',
    region: 'Sindh, Pakistan',
    description:
      'Extensive lowland alluvial floodplain near the historic Sukkur Barrage. Wide shallow inundation.',
    bounds: {
      west: 68.8000,
      south: 27.6700,
      east: 68.9100,
      north: 27.7600,
    },
    recommendedInflows: [
      {
        gridX: 120,
        gridY: 15,
        lon: 68.855,
        lat: 27.748,
        label: 'Indus River Channel',
        baseDischarge: 2500, // m3/s
        peakMultiplier: 1.6,
      },
    ],
    recommendedDuration: 5400,
    recommendedRainfall: {
      intensityMmPerHour: 10,
      durationSeconds: 1800,
    },
  },
  {
    id: 'boulder_canyon',
    name: 'Boulder Canyon & City',
    region: 'Colorado, USA',
    description:
      'Classic steep mountain canyon transitioning directly into an urban floodplain grid.',
    bounds: {
      west: -105.3200,
      south: 39.9800,
      east: -105.2400,
      north: 40.0400,
    },
    recommendedInflows: [
      {
        gridX: 25,
        gridY: 120,
        lon: -105.305,
        lat: 40.012,
        label: 'Boulder Creek Canyon Mouth',
        baseDischarge: 450,
        peakMultiplier: 3.5,
      },
    ],
    recommendedDuration: 3600,
    recommendedRainfall: {
      intensityMmPerHour: 50,
      durationSeconds: 1200,
    },
  },
];
