import { BoundingBox, DataSource, OsmBuilding, OsmRoad } from '../types';
import { haversineDistance } from '../terrain/geoUtils';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Procedural fallback OSM structures generator.
 * Creates synthetic buildings and roads distributed across habitable terrain.
 */
export function generateSyntheticStructures(
  bounds: BoundingBox,
  elevation: Float32Array,
  width: number,
  height: number
): { buildings: OsmBuilding[]; roads: OsmRoad[] } {
  const buildings: OsmBuilding[] = [];
  const roads: OsmRoad[] = [];

  // Generate ~80-150 buildings in flatter/lower areas
  const buildingCount = 120;
  for (let i = 0; i < buildingCount; i++) {
    // Clustered around settlements
    const clusterCenterX = 0.35 + (i % 3) * 0.25;
    const clusterCenterY = 0.4 + Math.sin(i) * 0.2;

    const jitterX = (Math.sin(i * 13.7) * 0.12);
    const jitterY = (Math.cos(i * 19.3) * 0.12);

    const normX = Math.max(0.05, Math.min(0.95, clusterCenterX + jitterX));
    const normY = Math.max(0.05, Math.min(0.95, clusterCenterY + jitterY));

    const gx = Math.floor(normX * (width - 1));
    const gy = Math.floor(normY * (height - 1));
    const elev = Number.isFinite(elevation[gy * width + gx]) ? elevation[gy * width + gx] : 50;

    const lon = bounds.west + normX * (bounds.east - bounds.west);
    const lat = bounds.north - normY * (bounds.north - bounds.south);

    const sizeLon = (bounds.east - bounds.west) * 0.008;
    const sizeLat = (bounds.north - bounds.south) * 0.008;

    buildings.push({
      id: `synthetic_bldg_${i}`,
      height: 4.0 + (i % 5) * 2.5, // 4m to 14m
      gridX: gx,
      gridY: gy,
      elevation: elev,
      isFlooded: false,
      maxWaterDepth: 0,
      polygon: [
        [lon - sizeLon, lat - sizeLat],
        [lon + sizeLon, lat - sizeLat],
        [lon + sizeLon, lat + sizeLat],
        [lon - sizeLon, lat + sizeLat],
      ],
    });
  }

  // Generate 3-5 main road corridors
  const roadCount = 4;
  for (let r = 0; r < roadCount; r++) {
    const coords: [number, number][] = [];
    const pointsCount = 10;
    let length = 0;

    for (let p = 0; p < pointsCount; p++) {
      const t = p / (pointsCount - 1);
      const normY = t;
      const normX = 0.25 + r * 0.2 + Math.sin(t * Math.PI * 2.0) * 0.08;

      const lon = bounds.west + normX * (bounds.east - bounds.west);
      const lat = bounds.north - normY * (bounds.north - bounds.south);
      coords.push([lon, lat]);

      if (p > 0) {
        length += haversineDistance(coords[p - 1][0], coords[p - 1][1], lon, lat);
      }
    }

    roads.push({
      id: `synthetic_road_${r}`,
      name: `Floodplain Corridor ${r + 1}`,
      type: r === 0 ? 'primary' : 'secondary',
      coordinates: coords,
      lengthMeters: length,
      isFlooded: false,
      maxWaterDepth: 0,
    });
  }

  return { buildings, roads };
}

/**
 * Fetch OpenStreetMap buildings and roads from Overpass API within the bounding box.
 * Falls back to synthetic structures if Overpass is rate-limited or unreachable.
 */
export async function fetchOsmStructures(
  bounds: BoundingBox,
  elevation: Float32Array,
  width: number,
  height: number,
  onProgress?: (text: string) => void
): Promise<{ buildings: OsmBuilding[]; roads: OsmRoad[]; source: DataSource }> {
  const query = `
    [out:json][timeout:15];
    (
      way["building"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      way["highway"~"primary|secondary|tertiary|residential"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
    );
    out body 200;
    >;
    out skel qt;
  `.replace(/\s+/g, ' ');

  onProgress?.('Fetching OSM buildings and road infrastructure...');

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 9000);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) continue;

      const data = await response.json();
      if (!data || !data.elements) continue;

      // Parse OSM node coordinates
      const nodes = new Map<number, [number, number]>();
      for (const el of data.elements) {
        if (el.type === 'node') {
          nodes.set(el.id, [el.lon, el.lat]);
        }
      }

      const buildings: OsmBuilding[] = [];
      const roads: OsmRoad[] = [];

      for (const el of data.elements) {
        if (el.type === 'way' && el.nodes && el.nodes.length >= 2) {
          const coords: [number, number][] = [];
          for (const nid of el.nodes) {
            const coord = nodes.get(nid);
            if (coord) coords.push(coord);
          }

          if (coords.length < 2) continue;

          // Building
          if (el.tags && el.tags.building) {
            const centerLon = coords.reduce((acc, c) => acc + c[0], 0) / coords.length;
            const centerLat = coords.reduce((acc, c) => acc + c[1], 0) / coords.length;

            const normX = (centerLon - bounds.west) / (bounds.east - bounds.west);
            const normY = (bounds.north - centerLat) / (bounds.north - bounds.south);

            const gx = Math.min(width - 1, Math.max(0, Math.floor(normX * (width - 1))));
            const gy = Math.min(height - 1, Math.max(0, Math.floor(normY * (height - 1))));
            const elev = Number.isFinite(elevation[gy * width + gx]) ? elevation[gy * width + gx] : 50;

            const heightVal = el.tags['building:levels']
              ? parseFloat(el.tags['building:levels']) * 3.2
              : el.tags.height
              ? parseFloat(el.tags.height)
              : 6.0;

            buildings.push({
              id: `osm_bldg_${el.id}`,
              polygon: coords,
              height: isNaN(heightVal) ? 6.0 : Math.max(3.0, Math.min(30.0, heightVal)),
              gridX: gx,
              gridY: gy,
              elevation: elev,
              isFlooded: false,
              maxWaterDepth: 0,
            });
          }

          // Road
          if (el.tags && el.tags.highway) {
            let roadLength = 0;
            for (let i = 0; i < coords.length - 1; i++) {
              roadLength += haversineDistance(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
            }

            roads.push({
              id: `osm_road_${el.id}`,
              name: el.tags.name || `Road (${el.tags.highway})`,
              type: el.tags.highway,
              coordinates: coords,
              lengthMeters: roadLength,
              isFlooded: false,
              maxWaterDepth: 0,
            });
          }
        }
      }

      if (buildings.length > 5 || roads.length > 0) {
        return { buildings, roads, source: { kind: 'remote', label: 'OpenStreetMap buildings/roads', details: 'Overpass query capped at 200 ways; coverage may be incomplete.' } };
      }
    } catch {
      // Try next endpoint or fallback
      continue;
    }
  }

  // Graceful fallback to synthetic structures
  onProgress?.('Using synthetic demo buildings and roads...');
  return { ...generateSyntheticStructures(bounds, elevation, width, height),
    source: { kind: 'synthetic', label: 'Synthetic buildings/roads — demo assets', details: 'OSM infrastructure unavailable. Counts and locations are generated, not a real asset inventory.' } };
}
