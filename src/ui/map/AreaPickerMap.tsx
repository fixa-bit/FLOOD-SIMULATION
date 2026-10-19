import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Search, MapPin, AlertTriangle, Crosshair, Box } from 'lucide-react';
import { useFloodStore } from '../store/useFloodStore';
import { PRESET_AREAS } from '../../core/terrain/presetAreas';
import { calculateBoundsDimensions, validateAreaSize } from '../../core/terrain/geoUtils';
import { BoundingBox } from '../../core/types';

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string];
}

export const AreaPickerMap: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const {
    bounds,
    setBounds,
    currentPresetId,
    loadPreset,
    loadTerrainForBounds,
    setIs2DMode,
    config,
    updateConfig,
  } = useFloodStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const { areaKm2, widthMeters, heightMeters } = calculateBoundsDimensions(bounds);
  const validation = validateAreaSize(bounds);

  // Estimate compute time based on area and grid
  const estSeconds = Math.round(
    ((config.duration / 3600) * (config.gridSize === 512 ? 18 : 6) * Math.max(1, areaKm2 / 25))
  );

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2],
      zoom: 12,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      // Add GeoJSON source and layers for selection box
      map.addSource('selected-area', {
        type: 'geojson',
        data: getBoundsGeoJson(bounds),
      });

      map.addLayer({
        id: 'selected-area-fill',
        type: 'fill',
        source: 'selected-area',
        paint: {
          'fill-color': '#0ea5e9',
          'fill-opacity': 0.22,
        },
      });

      map.addLayer({
        id: 'selected-area-outline',
        type: 'line',
        source: 'selected-area',
        paint: {
          'line-color': '#38bdf8',
          'line-width': 2.5,
          'line-dasharray': [2, 1],
        },
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync selection polygon when bounds change
  useEffect(() => {
    if (!mapRef.current || !mapRef.current.isStyleLoaded()) return;
    const source = mapRef.current.getSource('selected-area') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(getBoundsGeoJson(bounds));
    }
  }, [bounds]);

  function getBoundsGeoJson(b: BoundingBox) {
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [b.west, b.south],
            [b.east, b.south],
            [b.east, b.north],
            [b.west, b.north],
            [b.west, b.south],
          ],
        ],
      },
    };
  }

  // Handle place search with Nominatim
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery
        )}&limit=5`
      );
      if (resp.ok) {
        const data = await resp.json();
        setSearchResults(data);
      }
    } catch {
      // ignore
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (result: SearchResult) => {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);

    // Create a 6x6 km bounding box around found location
    const latSpan = 6000 / 111320;
    const lonSpan = 6000 / (111320 * Math.cos((lat * Math.PI) / 180));

    const newBounds: BoundingBox = {
      west: lon - lonSpan / 2,
      east: lon + lonSpan / 2,
      south: lat - latSpan / 2,
      north: lat + latSpan / 2,
    };

    setBounds(newBounds);
    setSearchResults([]);
    setSearchQuery('');

    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [lon, lat],
        zoom: 12.5,
        essential: true,
      });
    }
  };

  const handleUseCurrentView = () => {
    if (!mapRef.current) return;
    const b = mapRef.current.getBounds();
    const newBounds: BoundingBox = {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
    setBounds(newBounds);
  };

  const handleConfirmAndSimulate = async () => {
    setIs2DMode(false);
    await loadTerrainForBounds(bounds, config.gridSize);
  };

  return (
    <div className="relative w-full h-full bg-slate-950 flex flex-col">
      {/* Search and preset bar */}
      <div className="absolute top-4 left-4 z-20 w-96 flex flex-col gap-2">
        <form onSubmit={handleSearch} className="flex gap-2 bg-slate-900/90 backdrop-blur-md p-2 rounded-xl border border-slate-700/60 shadow-2xl">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search place (e.g. Swat, Nowshera, Boulder)..."
              className="w-full bg-slate-800 text-sm pl-9 pr-3 py-2 rounded-lg text-slate-100 placeholder-slate-400 border border-slate-700 focus:outline-none focus:border-sky-500"
            />
          </div>
          <button
            type="submit"
            disabled={isSearching}
            className="px-3 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition flex items-center gap-1 shadow-md"
          >
            {isSearching ? '...' : 'Search'}
          </button>
        </form>

        {/* Search results dropdown */}
        {searchResults.length > 0 && (
          <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl overflow-hidden divide-y divide-slate-800">
            {searchResults.map((r, i) => (
              <button
                key={i}
                onClick={() => handleSelectSearchResult(r)}
                className="w-full text-left p-3 text-xs text-slate-200 hover:bg-slate-800 transition flex items-start gap-2"
              >
                <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                <span className="line-clamp-2">{r.display_name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Preset areas shortcuts */}
        <div className="bg-slate-900/90 backdrop-blur-md p-3 rounded-xl border border-slate-700/60 shadow-xl flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Demo Areas</span>
            <span className="text-[10px] text-sky-400 font-normal">Presets</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESET_AREAS.map((preset) => {
              const active = currentPresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => {
                    loadPreset(preset.id);
                    if (mapRef.current) {
                      mapRef.current.flyTo({
                        center: [
                          (preset.bounds.west + preset.bounds.east) / 2,
                          (preset.bounds.south + preset.bounds.north) / 2,
                        ],
                        zoom: 12.5,
                      });
                    }
                  }}
                  className={`text-left p-2 rounded-lg text-xs font-medium transition border ${
                    active
                      ? 'bg-sky-600/30 border-sky-500 text-sky-200'
                      : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="truncate font-semibold">{preset.name.split('(')[0]}</div>
                  <div className="text-[10px] text-slate-400 truncate">{preset.region.split(',')[0]}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* MapLibre Canvas Container */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Area Statistics & Launch Overlay Bar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-[92%] max-w-3xl bg-slate-900/95 backdrop-blur-lg border border-slate-700/80 rounded-2xl p-4 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex flex-col">
            <span className="text-slate-400 uppercase text-[10px] font-semibold">Area Extent</span>
            <span className="text-base font-bold text-sky-400">
              {(widthMeters / 1000).toFixed(1)} × {(heightMeters / 1000).toFixed(1)} km{' '}
              <span className="text-xs font-normal text-slate-300">({areaKm2.toFixed(1)} km²)</span>
            </span>
          </div>

          <div className="h-8 w-px bg-slate-700 hidden sm:block" />

          <div className="flex flex-col">
            <span className="text-slate-400 uppercase text-[10px] font-semibold">Grid Resolution</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <button
                onClick={() => updateConfig({ gridSize: 256 })}
                className={`px-2 py-0.5 rounded text-xs font-mono font-medium transition border ${
                  config.gridSize === 256
                    ? 'bg-sky-600 border-sky-400 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >
                256² (Fast)
              </button>
              <button
                onClick={() => updateConfig({ gridSize: 512 })}
                className={`px-2 py-0.5 rounded text-xs font-mono font-medium transition border ${
                  config.gridSize === 512
                    ? 'bg-sky-600 border-sky-400 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >
                512² (HD)
              </button>
            </div>
          </div>

          <div className="h-8 w-px bg-slate-700 hidden sm:block" />

          <div className="flex flex-col">
            <span className="text-slate-400 uppercase text-[10px] font-semibold">Est. Compute</span>
            <span className="text-xs font-medium text-slate-200 mt-1">~{estSeconds}s</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
          <button
            onClick={handleUseCurrentView}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 rounded-xl text-xs font-medium transition flex items-center gap-1.5"
            title="Snap rectangle to current map view"
          >
            <Crosshair className="w-3.5 h-3.5 text-slate-400" />
            <span>Use View</span>
          </button>

          <button
            onClick={handleConfirmAndSimulate}
            disabled={!validation.valid}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg ${
              validation.valid
                ? 'bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white shadow-sky-500/20'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
            }`}
          >
            <Box className="w-4 h-4" />
            <span>Load 3D Terrain & Simulate</span>
          </button>
        </div>
      </div>

      {/* Validation alert banner */}
      {(!validation.valid || validation.warning) && (
        <div className="absolute top-4 right-4 z-20 max-w-sm">
          {!validation.valid ? (
            <div className="bg-red-950/90 border border-red-500/60 p-3 rounded-xl text-xs text-red-200 shadow-2xl flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{validation.error}</span>
            </div>
          ) : (
            <div className="bg-amber-950/90 border border-amber-500/60 p-3 rounded-xl text-xs text-amber-200 shadow-2xl flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>{validation.warning}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
