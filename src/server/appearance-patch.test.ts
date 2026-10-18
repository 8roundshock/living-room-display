import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';
import { DataStore } from './store.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { importSchema, mergeSettings, settingsPatchSchema, settingsSchema } from './validation.ts';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-appearance-'));
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  return { ...app, directory, url: `http://127.0.0.1:${address.port}`, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); } };
}
const json = (value: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const chosen = { clockStyle: 'analog', accentMode: 'native', animation: 'lively' } as const;

test('#83: an appearance PATCH parses to exactly the supplied keys', () => {
  assert.deepEqual(settingsPatchSchema.parse({ appearance: { brightness: 0.4, preset: 'custom' } }), { appearance: { brightness: 0.4, preset: 'custom' } });
  assert.deepEqual(settingsPatchSchema.parse({ appearance: {} }), { appearance: {} });
  assert.deepEqual(settingsPatchSchema.parse({ appearance: { accentMode: 'native' } }), { appearance: { accentMode: 'native' } });
  assert.deepEqual(settingsPatchSchema.parse({ appearance: { animation: 'off' } }), { appearance: { animation: 'off' } });
  // Every other partial PATCH branch is default-free too.
  const partials = { location: { name: 'Somewhere' }, preview: { opacity: 0.1 }, idle: { idleMinutes: 5 }, widgetBehavior: { reminders: {} }, widgetGrid: { placements: { clock: { column: 1 } } }, widgetOverrides: { clock: { scale: 1.1 } } };
  assert.deepEqual(settingsPatchSchema.parse(partials), partials);
});

test('#83: a brightness-only change keeps clock style, accent mode and animation in mergeSettings', () => {
  const saved = mergeSettings(defaultSettings(), { appearance: chosen });
  const next = mergeSettings(saved, settingsPatchSchema.parse({ appearance: { brightness: 0.4, preset: 'custom' } }));
  assert.equal(next.appearance.brightness, 0.4);
  assert.deepEqual({ clockStyle: next.appearance.clockStyle, accentMode: next.appearance.accentMode, animation: next.appearance.animation }, chosen);
});

test('#83: a brightness-only change keeps saved appearance choices in the store and through restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-appearance-store-'));
  try {
    const store = await DataStore.open(directory);
    await store.patchSettings(settingsPatchSchema.parse({ appearance: chosen }));
    await store.patchSettings(settingsPatchSchema.parse({ appearance: { brightness: 0.4, preset: 'custom' } }));
    for (const settings of [store.snapshot().settings, (await DataStore.open(directory)).snapshot().settings]) {
      assert.equal(settings.appearance.brightness, 0.4);
      assert.deepEqual({ clockStyle: settings.appearance.clockStyle, accentMode: settings.appearance.accentMode, animation: settings.appearance.animation }, chosen);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('#83: a brightness-only HTTP PATCH keeps saved appearance choices; invalid values are 400', async () => {
  const app = await fixture();
  try {
    const patch = (value: unknown) => fetch(`${app.url}/api/settings`, { method: 'PATCH', ...json(value) });
    assert.equal((await patch({ appearance: chosen })).status, 200);
    const response = await patch({ appearance: { brightness: 0.4, preset: 'custom' } });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.deepEqual({ clockStyle: saved.appearance.clockStyle, accentMode: saved.appearance.accentMode, animation: saved.appearance.animation }, chosen);
    const state = await (await fetch(`${app.url}/api/state`)).json();
    assert.equal(state.settings.appearance.clockStyle, 'analog');
    for (const appearance of [{ accentMode: 'neon' }, { animation: 'fast' }, { accentMode: 1 }, { animation: null }, { clockStyle: 'neon' }, { accentMode: null }, { animation: 1 }]) {
      assert.equal((await patch({ appearance })).status, 400, JSON.stringify(appearance));
    }
    assert.deepEqual({ clockStyle: app.store.snapshot().settings.appearance.clockStyle, accentMode: app.store.snapshot().settings.appearance.accentMode, animation: app.store.snapshot().settings.appearance.animation }, chosen);
  } finally { await app.close(); }
});

test('legacy settings, saved styles and imports without the new appearance keys read as outline, color and subtle', async () => {
  const legacy = JSON.parse(JSON.stringify(defaultSettings()));
  delete legacy.appearance.clockStyle; delete legacy.appearance.accentMode; delete legacy.appearance.animation;
  const { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } = legacy;
  legacy.savedPresets = [{ id: 'legacy', name: 'Legacy', visual: { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } }];
  const expected = { clockStyle: 'outline', accentMode: 'color', animation: 'subtle' };
  const read = settingsSchema.parse(legacy);
  const imported = importSchema.parse({ version: 1, exportedAt: new Date().toISOString(), settings: legacy, reminders: [] }).settings;
  for (const value of [read.appearance, read.savedPresets[0]!.visual.appearance, imported.appearance, imported.savedPresets[0]!.visual.appearance]) {
    assert.deepEqual({ clockStyle: value.clockStyle, accentMode: value.accentMode, animation: value.animation }, expected);
  }
  const directory = await mkdtemp(join(tmpdir(), 'lrd-appearance-legacy-'));
  try {
    await writeFile(join(directory, 'state.json'), JSON.stringify({ version: 1, settings: legacy, reminders: [] }));
    const opened = (await DataStore.open(directory)).snapshot().settings.appearance;
    assert.deepEqual({ clockStyle: opened.clockStyle, accentMode: opened.accentMode, animation: opened.animation }, expected);
  } finally { await rm(directory, { recursive: true, force: true }); }
  for (const bad of ['neon', 1, null]) {
    assert.throws(() => settingsSchema.parse({ ...legacy, appearance: { ...legacy.appearance, accentMode: bad } }));
    assert.throws(() => settingsSchema.parse({ ...legacy, appearance: { ...legacy.appearance, animation: bad } }));
  }
});
