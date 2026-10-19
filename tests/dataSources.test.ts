import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { fetchAndProcessDem } from '../src/core/terrain/tileFetcher';
import { getCachedDem, setCachedDem } from '../src/core/terrain/cache';
import { fetchOsmStructures } from '../src/core/analysis/buildingAnalysis';
import { dataSources } from '../src/core/analysis/dataSources';
import { loadDrapedTexture } from '../src/viewer/textureFetcher';
import { readScenario, writeScenario, listScenarios } from '../src/core/scenarios/scenarioStorage';

const bounds = { west: 0, east: 0.5, south: 0, north: 0.5 };
vi.mock('../src/core/terrain/geoUtils', async importOriginal => ({ ...await importOriginal<object>(), getOptimalZoomForBounds: () => 10 }));
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());

describe('Explicit data provenance', () => {
  it('retains synthetic terrain labels on cache hits', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetch);
    const first = await fetchAndProcessDem(bounds, 256);
    expect(first.source?.kind).toBe('synthetic');
    fetch.mockClear();
    const second = await fetchAndProcessDem(bounds, 256);
    expect(second.source).toEqual(first.source);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('distinguishes partial and remote terrain mosaics', async () => {
    const pixels = new Uint8ClampedArray(256 * 256 * 4);
    for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 128; pixels[i + 3] = 255; }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({}));
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage() {}, getImageData: () => ({ data: pixels }) }; } });
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ++calls % 2 ? { ok: true, blob: async () => ({}) } : { ok: false, status: 404 }));
    const partial = await fetchAndProcessDem(bounds, 256);
    expect(partial.source?.kind).toBe('mixed');
    expect(partial.source?.details).toContain('50 m');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => ({}) }));
    const real = await fetchAndProcessDem({ ...bounds, east: 0.6 }, 256);
    expect(real.source?.kind).toBe('remote');
  });
  it('preserves supplied metadata in the cache and labels OSM fallbacks', async () => {
    const source = { kind: 'mixed' as const, label: 'Partial terrain', details: 'Missing tiles' };
    await setCachedDem('test', new Float32Array([1, 2]), source);
    expect((await getCachedDem('test'))?.source).toEqual(source);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const structures = await fetchOsmStructures(bounds, new Float32Array(16), 4, 4);
    expect(structures.source.kind).toBe('synthetic');
    expect(structures.buildings[0].id).toMatch(/^synthetic_/);
    expect(structures.buildings[0].elevation).toBe(0);
  });
  it('never describes unknown older terrain as remote', () => {
    const sources = dataSources({ dem: {} as never, buildings: [], roads: [] });
    expect(sources.terrain.kind).toBe('unknown');
  });
  it('stores provenance with saved scenarios and metadata', async () => {
    const record = {
      id: 'test', name: 'Demo', version: 1 as const, hasResults: false, createdAt: new Date().toISOString(), frames: [], result: null,
      inputs: { config: {} as never, dem: { source: { kind: 'synthetic' as const, label: 'Synthetic test terrain' } } as never,
        infrastructureSource: { kind: 'synthetic' as const, label: 'Synthetic assets' }, buildings: [], roads: [] },
    };
    await writeScenario(record);
    expect((await readScenario('test')).sources?.terrain.kind).toBe('synthetic');
    expect((await listScenarios())[0].sources?.infrastructure.kind).toBe('synthetic');
  });
  it('marks procedural display texture as synthetic imagery', async () => {
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, beginPath() {}, moveTo() {}, bezierCurveTo() {}, stroke() {} }) }) });
    vi.stubGlobal('Image', class { onerror?: () => void; set src(_value: string) { queueMicrotask(() => this.onerror?.()); } });
    const texture = await loadDrapedTexture({ west: 0, east: 0.001, south: 0, north: 0.001 }, 'satellite', 32);
    expect(texture?.userData.source.kind).toBe('synthetic');
    expect(texture?.userData.source.label).toContain('not imagery');
    texture?.dispose();
  });
});
