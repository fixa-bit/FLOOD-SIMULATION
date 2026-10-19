import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const state = await page.evaluate(async () => {
    const { useFloodStore } = await import('/src/ui/store/useFloodStore.ts');
    const s = useFloodStore.getState();
    return { status: s.status, error: s.errorMessage, progress: s.progressStage, frames: s.frames.length,
      lastTime: s.frames.at(-1)?.simulatedTimeSeconds, duration: s.config.duration, width: s.dem?.width };
  }).catch(() => 'Page unavailable');
  console.log('Scenario state:', state);
});

test('save, duplicate, compare, reload, rename and delete a scenario', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Keep software WebGL rendering from starving the scenario workflow on CI.
  // Canvas comparison maps and the actual simulation worker remain enabled.
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Map<number, { timer: number; frame?: number }>();
    let nextId = 1;
    window.requestAnimationFrame = callback => {
      const id = nextId++;
      const item = { timer: 0, frame: undefined as number | undefined };
      item.timer = window.setTimeout(() => {
        item.frame = request(time => { pending.delete(id); callback(time); });
      }, 300);
      pending.set(id, item);
      return id;
    };
    window.cancelAnimationFrame = id => {
      const item = pending.get(id);
      if (item) { clearTimeout(item.timer); if (item.frame !== undefined) cancel(item.frame); pending.delete(id); }
    };
  });
  // Keep this test offline and independent of terrain/OSM service availability.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Scenario workspace' })).toBeVisible();
  await page.evaluate(async () => {
    const { writeScenario } = await import('/src/core/scenarios/scenarioStorage.ts');
    const { useFloodStore } = await import('/src/ui/store/useFloodStore.ts');
    const bounds = { west: 71, east: 71.001, south: 34, north: 34.001 };
    await writeScenario({
      id: 'fixture', name: 'Fixture', version: 1, hasResults: false, createdAt: new Date().toISOString(), frames: [], result: null,
      inputs: {
        config: { gridSize: 256, bounds, duration: 5, outputInterval: 1, manningsN: 0.035,
          boundaryType: 'closed', verticalExaggeration: 1, cflFactor: 0.7, minWaterDepthThreshold: 0.02,
          rainfall: { intensityMmPerHour: 0, durationSeconds: 5 }, inflowPreset: 'constant',
          hydrographStartSeconds: 1, hydrographDurationSeconds: 2,
          inflows: [{ id: 'inlet', gridX: 4, gridY: 4, lon: 71.0005, lat: 34.0005, baseDischarge: 100 }],
        },
        dem: { bounds, width: 9, height: 9, dx: 10, dy: 10, minElevation: 0, maxElevation: 0, elevation: new Float32Array(81), source: { kind: 'synthetic', label: 'Synthetic terrain — test fixture' } },
        infrastructureSource: { kind: 'synthetic', label: 'Synthetic roads — test fixture' },
        buildings: [], roads: [{ id: 'road', name: 'Test road', type: 'primary', coordinates: [[71, 34.0005], [71.001, 34.0005]], lengthMeters: 92, isFlooded: false, maxWaterDepth: 0 }],
      },
    });
    await useFloodStore.getState().loadScenario('fixture', true);
  });
  const name = page.getByRole('textbox', { name: 'Scenario name', exact: true });
  await name.fill('Baseline');
  await page.getByRole('button', { name: 'Run Flood Simulation', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { useFloodStore } = await import('/src/ui/store/useFloodStore.ts');
    const s = useFloodStore.getState();
    return { status: s.status, error: s.errorMessage };
  }), { timeout: 60000 }).toEqual({ status: 'finished', error: null });
  await expect(page.getByRole('button', { name: 'Save completed run' })).toBeEnabled();
  await expect(page.getByLabel('Data sources')).toContainText('Synthetic terrain');
  await page.getByRole('button', { name: 'Arrival & duration maps' }).click();
  await expect(page.getByRole('img', { name: 'Arrival-time map' })).toBeVisible();
  await expect(page.getByLabel('Location flood timing')).toContainText('Not reached during this run');
  await page.getByLabel('Timing longitude').fill('71.0005');
  await page.getByLabel('Timing latitude').fill('34.0005');
  await page.getByRole('button', { name: 'Inspect coordinates' }).click();
  await expect(page.getByLabel('Location flood timing')).toContainText('Still flooded at run end');
  await page.getByLabel('Timing map', { exact: true }).selectOption('duration');
  await expect(page.getByRole('img', { name: 'Flood-duration map' })).toBeVisible();
  await page.screenshot({ path: '.tmp/flood-timing.png' });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download timing grids (JSON)' }).click();
  const download = await downloadEvent;
  const grids = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(grids.dataSources.terrain.kind).toBe('synthetic');
  expect(grids.arrivalTimeSeconds[0]).toBeNull();
  expect(grids.arrivalTimeSeconds[40]).toBeGreaterThanOrEqual(1);
  expect(grids.floodDurationSeconds[40]).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Save completed run' }).click();
  await expect(page.getByRole('status')).toHaveText('Run saved with its original inputs.');
  const baselineCard = page.getByRole('article', { name: 'Baseline', exact: true });
  await baselineCard.getByRole('button', { name: 'Duplicate & edit' }).click();
  await expect(name).toHaveValue('Baseline copy');
  await page.evaluate(async () => {
    const { useFloodStore } = await import('/src/ui/store/useFloodStore.ts');
    const inflows = useFloodStore.getState().config.inflows.map(i => ({ ...i, baseDischarge: 200 }));
    useFloodStore.getState().updateConfig({ inflows });
  });
  await name.fill('Higher inflow');
  await page.getByRole('button', { name: 'Run Flood Simulation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save completed run' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save completed run' }).click();
  await expect(page.getByRole('status')).toHaveText('Run saved with its original inputs.');
  await page.getByLabel('Baseline scenario').selectOption({ label: 'Baseline' });
  await page.getByLabel('Candidate scenario').selectOption({ label: 'Higher inflow' });
  await page.getByRole('button', { name: 'Compare saved runs' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Baseline', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Higher inflow', exact: true })).toBeVisible();
  await page.screenshot({ path: '.tmp/scenario-comparison.png' });
  await page.getByLabel('Comparison map view').selectOption('difference');
  await expect(page.getByRole('img', { name: 'Candidate − baseline: maximum depth' })).toBeVisible();
  await page.getByLabel('Comparison map view').selectOption('arrival');
  await expect(page.getByRole('img', { name: 'Baseline — arrival', exact: true })).toBeVisible();
  await page.getByLabel('Comparison map view').selectOption('duration');
  await expect(page.getByRole('img', { name: 'Higher inflow — duration', exact: true })).toBeVisible();
  await page.getByLabel('Comparison map view').selectOption('playback');
  await page.getByLabel('Comparison elapsed time').fill('3');
  await expect(page.getByRole('img', { name: 'Baseline · 3 s', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  const restoredBaseline = page.getByRole('article', { name: 'Baseline', exact: true });
  await restoredBaseline.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(name).toHaveValue('Baseline');
  await expect(page.getByLabel('Data sources')).toContainText('Synthetic terrain');
  await expect(page.getByLabel('Event duration (min)')).toHaveValue(String(2 / 60));
  await page.getByRole('button', { name: 'Arrival & duration maps' }).click();
  await expect(page.getByRole('img', { name: 'Arrival-time map' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save completed run' })).toBeEnabled();
  await restoredBaseline.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('New scenario name').fill('Baseline renamed');
  await restoredBaseline.getByRole('button', { name: 'Save', exact: true }).click();
  const renamed = page.getByRole('article', { name: 'Baseline renamed', exact: true });
  await expect(renamed).toBeVisible();
  await renamed.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('article', { name: 'Baseline renamed', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
