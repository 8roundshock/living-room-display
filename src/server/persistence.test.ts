import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';
import { AT_REST, PREVIOUS_RELEASE, persistableData, persistableSettings } from './persistence.ts';
import { dataSchema, mergeSettings } from './validation.ts';
import { sameEffectiveSettings } from '../client/draft.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { WIDGET_IDS, defaultWidgetGrid } from '../shared/widgets.ts';
import type { Settings, VisualSettings } from '../shared/contracts.ts';

const previous: ReadonlySet<string> = new Set(PREVIOUS_RELEASE.widgetIds);
const visualOf = ({ appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview }: Settings): VisualSettings => structuredClone({ appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview });
function data(settings: Settings) { return { version: 1 as const, settings, reminders: [], photoAsset: null }; }
function variants(): [string, Settings][] {
  const base = defaultSettings();
  const chosen = mergeSettings(base, { appearance: { accentMode: 'native', animation: 'lively', clockStyle: 'analog' }, widgets: { rain: false, photo: true }, widgetData: { note: { text: 'Synthetic note' }, calendar: { weekStart: 'monday' } } });
  const styled = defaultSettings(); styled.savedPresets = [{ id: 'style', name: 'Style', visual: visualOf(chosen) }, { id: 'plain', name: 'Plain', visual: visualOf(base) }];
  return [['defaults', base], ['non-default choices', chosen], ['saved styles', mergeSettings(styled, {})]];
}

test('persisted data reads back to effectively the same settings, and the input is never mutated', () => {
  for (const [label, settings] of variants()) {
    const original = data(settings), before = structuredClone(original);
    const written = JSON.parse(JSON.stringify(persistableData(original)));
    assert.deepEqual(original, before, `${label}: input unmutated`);
    const read = dataSchema.parse(written);
    assert.ok(sameEffectiveSettings(read.settings, settings), `${label}: effectively equal`);
    // Identical except hidden placements of disabled non-previous ids, which return to catalog defaults.
    const expected = structuredClone(original);
    for (const visual of [expected.settings, ...expected.settings.savedPresets.map(preset => preset.visual)]) {
      for (const id of WIDGET_IDS) if (!previous.has(id) && visual.widgets[id] !== true) visual.widgetGrid.placements[id] = defaultWidgetGrid().placements[id];
    }
    assert.deepEqual(read, expected, `${label}: identical apart from hidden non-previous placements`);
  }
});

test('previous-release keys are always written; only additive defaults are omitted', () => {
  const settings = mergeSettings(defaultSettings(), { widgets: { rain: false } });
  settings.savedPresets = [{ id: 'style', name: 'Style', visual: visualOf(settings) }];
  const written = persistableSettings(settings) as any;
  for (const visual of [written, written.savedPresets[0].visual]) {
    for (const id of PREVIOUS_RELEASE.widgetIds) {
      assert.equal(typeof visual.widgets[id], 'boolean', `${id} visibility is written`);
      assert.ok(visual.widgetOverrides[id], `${id} transform is written`);
      assert.ok(visual.widgetGrid.placements[id], `${id} placement is written even when hidden`);
    }
    assert.equal(visual.widgets.rain, false);
    for (const key of Object.keys(AT_REST.appearance)) assert.equal(key in visual.appearance, false, `${key} omitted while default`);
    assert.equal(visual.appearance.clockStyle, 'outline', 'previous-release appearance keys stay');
  }
  for (const id of WIDGET_IDS.filter(id => !previous.has(id))) {
    assert.equal(id in written.widgets, false); assert.equal(id in written.widgetOverrides, false); assert.equal(id in written.widgetGrid.placements, false);
  }
  const chosen = persistableSettings(mergeSettings(defaultSettings(), { appearance: { accentMode: 'native', animation: 'off' } })) as any;
  assert.equal(chosen.appearance.accentMode, 'native'); assert.equal(chosen.appearance.animation, 'off');
});

test('files and exports omit additive defaults while state and PATCH responses carry every key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-persistence-'));
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${url}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appearance: { brightness: 0.4 } }) });
    assert.equal(response.status, 200);
    const patched = await response.json(), state = await (await fetch(`${url}/api/state`)).json();
    for (const settings of [patched, state.settings, app.store.snapshot().settings]) {
      assert.equal(settings.appearance.accentMode, 'color'); assert.equal(settings.appearance.animation, 'subtle');
      assert.deepEqual(settings.widgetData, defaultSettings().widgetData);
      assert.deepEqual(Object.keys(settings.widgets), WIDGET_IDS); assert.deepEqual(Object.keys(settings.widgetOverrides), WIDGET_IDS); assert.deepEqual(Object.keys(settings.widgetGrid.placements), WIDGET_IDS);
    }
    const exported = await (await fetch(`${url}/api/export`)).json();
    const file = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')), backup = JSON.parse(await readFile(join(directory, 'state.backup.json'), 'utf8'));
    for (const settings of [exported.settings, file.settings, backup.settings]) {
      assert.equal('accentMode' in settings.appearance, false); assert.equal('animation' in settings.appearance, false);
      assert.equal('widgetData' in settings, false);
      assert.deepEqual(Object.keys(settings.widgets), [...PREVIOUS_RELEASE.widgetIds]);
    }
  } finally { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); }
});
