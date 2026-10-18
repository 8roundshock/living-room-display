// #74: Rain is retired into Weather. Validation merges an enabled Rain into Weather in memory for
// settings, saved styles, imports and every PATCH; files change only at the next ordinary save, and
// everything written stays readable by the previous release. Synthetic data in temporary folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { assertPreviousReaderAccepts } from './compat/previous-reader.ts';
import { defaultSettings as previousDefaults } from './compat/bedca44/shared/defaults.ts';
import { defaultWidgetGrid as previousGrid } from './compat/bedca44/shared/widgets.ts';
import { forecastFixture } from './fixtures.ts';
import { persistableSettings } from './persistence.ts';
import { DataStore } from './store.ts';
import { mergeSettings, settingsSchema } from './validation.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { ACTIVE_WIDGET_IDS, WIDGET_IDS, absorbRetiredWidgets, absorbableGridProblem, gridProblem } from '../shared/widgets.ts';
import type { Settings, WidgetId, WidgetPlacement } from '../shared/contracts.ts';

type Loose = Record<string, any>;
const visualOf = (settings: Loose) => structuredClone({ appearance: settings.appearance, widgets: settings.widgets, widgetOverrides: settings.widgetOverrides, widgetBehavior: settings.widgetBehavior, widgetGrid: settings.widgetGrid, preview: settings.preview });

/** The pre-#74 default board (revision 2): medium Weather over medium Rain, both enabled. */
function legacy(): Loose {
  const settings = JSON.parse(JSON.stringify(previousDefaults()));
  assert.deepEqual(settings.widgetGrid.placements.weather, { column: 8, row: 0, size: 'medium' });
  assert.deepEqual(settings.widgetGrid.placements.rain, { column: 8, row: 2, size: 'medium' });
  assert.equal(settings.widgets.rain, true);
  return settings;
}
/** The same board in the current shape (every catalog id present), with overrides. */
function board(placements: Partial<Record<WidgetId, WidgetPlacement>> = {}, widgets: Partial<Record<WidgetId, boolean>> = {}): Loose {
  const settings = JSON.parse(JSON.stringify(defaultSettings()));
  settings.widgetGrid.placements.weather = { column: 8, row: 0, size: 'medium' }; settings.widgets.rain = true;
  Object.assign(settings.widgetGrid.placements, placements); Object.assign(settings.widgets, widgets);
  return settings;
}
const parse = (value: unknown): Settings => settingsSchema.parse(structuredClone(value));

const CASES: [string, () => Loose, { weather: WidgetPlacement; weatherVisible: boolean }][] = [
  ['medium over medium becomes large', () => board(), { weather: { column: 8, row: 0, size: 'large' }, weatherVisible: true }],
  ['small beside small becomes medium', () => board({ weather: { column: 8, row: 0, size: 'small' }, rain: { column: 10, row: 0, size: 'small' } }), { weather: { column: 8, row: 0, size: 'medium' }, weatherVisible: true }],
  ['small over small keeps Weather small', () => board({ weather: { column: 8, row: 0, size: 'small' }, rain: { column: 8, row: 2, size: 'small' } }), { weather: { column: 8, row: 0, size: 'small' }, weatherVisible: true }],
  ['medium beside medium keeps Weather medium', () => board({ weather: { column: 4, row: 4, size: 'medium' }, rain: { column: 8, row: 4, size: 'medium' } }, { preview: false }), { weather: { column: 4, row: 4, size: 'medium' }, weatherVisible: true }],
  ['a small Weather moves to a non-adjacent medium Rain', () => board({ weather: { column: 8, row: 0, size: 'small' }, rain: { column: 8, row: 4, size: 'medium' } }, { preview: false }), { weather: { column: 8, row: 4, size: 'medium' }, weatherVisible: true }],
  ['a hidden Weather takes Rain\'s cell', () => board({ rain: { column: 8, row: 2, size: 'medium' } }, { weather: false }), { weather: { column: 8, row: 2, size: 'medium' }, weatherVisible: true }],
  ['Rain off is a no-op', () => board({}, { rain: false }), { weather: { column: 8, row: 0, size: 'medium' }, weatherVisible: true }],
  ['both off stay off', () => board({}, { rain: false, weather: false }), { weather: { column: 8, row: 0, size: 'medium' }, weatherVisible: false }],
];

test('new defaults: one large Weather where Weather and Rain were; Rain hidden and inactive', () => {
  const settings = defaultSettings();
  assert.equal(settings.widgets.rain, false); assert.equal(settings.widgets.weather, true);
  assert.deepEqual(settings.widgetGrid.placements.weather, { column: 8, row: 0, size: 'large' });
  assert.deepEqual(settings.widgetGrid.placements.rain, { column: 8, row: 2, size: 'medium' }, 'the hidden Rain placement may overlap Weather');
  assert.equal(gridProblem(settings.widgetGrid, settings.widgets), null);
  assert.equal(ACTIVE_WIDGET_IDS.includes('rain'), false);
  assert.deepEqual(parse(settings), settings, 'defaults are already merged');
});

test('Weather absorbs an enabled Rain, keeping placement intent', async t => {
  for (const [label, make, expected] of CASES) await t.test(label, () => {
    const input = make(), before = structuredClone(input), result = parse(input);
    assert.deepEqual(input, before, 'the input is never mutated');
    assert.equal(result.widgets.rain, false);
    assert.equal(result.widgets.weather, expected.weatherVisible);
    assert.deepEqual(result.widgetGrid.placements.weather, expected.weather);
    assert.deepEqual(result.widgetGrid.placements.rain, input.widgetGrid.placements.rain, 'the hidden Rain placement is kept');
    assert.equal(gridProblem(result.widgetGrid, result.widgets), null);
    for (const id of WIDGET_IDS.filter(id => id !== 'rain' && id !== 'weather')) {
      assert.equal(result.widgets[id], input.widgets[id], `${id} visibility is unchanged`);
      assert.deepEqual(result.widgetGrid.placements[id], input.widgetGrid.placements[id], `${id} placement is unchanged`);
    }
    assert.equal(result.widgets.weather, Boolean(input.widgets.weather || input.widgets.rain), 'Weather is visible if either was');
    assert.deepEqual(parse(result), result, 'idempotent: parse(parse(x)) equals parse(x)');
  });
});

test('absorbRetiredWidgets is pure, idempotent and never returns an invalid board', () => {
  for (const [, make] of CASES) {
    const input = make(); input.widgetGrid.revision = 2;
    const before = structuredClone(input), once = absorbRetiredWidgets(input as Settings), twice = absorbRetiredWidgets(once);
    assert.deepEqual(input, before); assert.deepEqual(twice, once);
    assert.equal(gridProblem(once.widgetGrid, once.widgets), null);
  }
  // When the merged rectangle cannot fit, Weather keeps its own rectangle.
  const blocked = board({ weather: { column: 8, row: 0, size: 'small' }, rain: { column: 10, row: 0, size: 'small' } }) as Settings;
  blocked.widgetGrid.revision = 2;
  const original = absorbRetiredWidgets(blocked).widgetGrid.placements.weather;
  assert.deepEqual(original, { column: 8, row: 0, size: 'medium' });
  const crowded = structuredClone(blocked); crowded.widgets.photo = true; crowded.widgetGrid.placements.photo = { column: 10, row: 0, size: 'small' };
  assert.notEqual(gridProblem(crowded.widgetGrid, crowded.widgets), null, 'photo collides with Rain in the input');
  const result = absorbRetiredWidgets(crowded);
  assert.deepEqual(result.widgetGrid.placements.weather, { column: 8, row: 0, size: 'small' }, 'the union would cover the photo, so Weather keeps its own cell');
  assert.equal(result.widgets.rain, false);
});

test('only an overlap between Rain and the Weather absorbing it is tolerated before merging', () => {
  const settings = board(); settings.widgetGrid.placements.weather.size = 'large';
  assert.notEqual(gridProblem(settings.widgetGrid, settings.widgets), null);
  assert.equal(absorbableGridProblem(settings.widgetGrid, settings.widgets), null, 'Rain inside Weather is merged, not rejected');
  assert.deepEqual(parse(settings).widgetGrid.placements.weather, { column: 8, row: 0, size: 'large' });
  const onClock = board(); onClock.widgetGrid.placements.rain = { column: 0, row: 0, size: 'medium' };
  assert.match(String(absorbableGridProblem(onClock.widgetGrid, onClock.widgets)), /overlaps/);
  assert.throws(() => parse(onClock), /overlaps/, 'Rain over another widget stays invalid');
  const outside = board(); outside.widgetGrid.placements.rain = { column: 10, row: 0, size: 'medium' };
  assert.throws(() => parse(outside), /outside|overlaps/, 'an out-of-bounds Rain stays invalid');
});

test('a stale editor PATCH that enables or moves Rain merges into Weather', () => {
  const current = defaultSettings();
  const enabled = mergeSettings(current, { widgets: { rain: true } });
  assert.equal(enabled.widgets.rain, false); assert.deepEqual(enabled.widgetGrid.placements.weather, current.widgetGrid.placements.weather);
  const old = legacy();
  const whole = mergeSettings(current, { widgets: old.widgets, widgetGrid: { placements: { weather: old.widgetGrid.placements.weather, rain: old.widgetGrid.placements.rain } } });
  assert.equal(whole.widgets.rain, false); assert.deepEqual(whole.widgetGrid.placements.weather, { column: 8, row: 0, size: 'large' });
});

test('saved styles migrate independently of the settings', () => {
  const settings = board({}, { rain: false });
  settings.savedPresets = [{ id: 'old', name: 'Old style', visual: visualOf(legacy()) }, { id: 'rain-only', name: 'Rain only', visual: visualOf(board({}, { weather: false })) }];
  const result = parse(settings);
  assert.equal(result.widgets.rain, false); assert.deepEqual(result.widgetGrid.placements.weather, { column: 8, row: 0, size: 'medium' });
  const [old, rainOnly] = result.savedPresets.map(preset => preset.visual);
  assert.equal(old!.widgets.rain, false); assert.deepEqual(old!.widgetGrid.placements.weather, { column: 8, row: 0, size: 'large' });
  assert.equal(rainOnly!.widgets.weather, true); assert.deepEqual(rainOnly!.widgetGrid.placements.weather, { column: 8, row: 2, size: 'medium' });
});

function revisionOne(): Loose {
  const settings = JSON.parse(JSON.stringify(previousDefaults()));
  settings.widgetGrid = previousGrid(1); delete settings.widgetGrid.revision;
  return settings;
}
function denseSpacious(): Loose {
  const settings = revisionOne(); settings.widgets.photo = true; settings.widgetGrid.density = 'spacious';
  settings.widgetGrid.placements = {
    clock: { column: 0, row: 0, size: 'large' }, weather: { column: 6, row: 0, size: 'small' },
    rain: { column: 0, row: 2, size: 'medium' }, preview: { column: 4, row: 2, size: 'medium' },
    forecast: { column: 0, row: 4, size: 'medium' }, reminders: { column: 4, row: 4, size: 'small' }, photo: { column: 6, row: 4, size: 'small' },
  };
  return settings;
}

test('revision 1 migrates to revision 2, then Weather absorbs Rain; the dense spacious board loses no module', () => {
  for (const [label, make] of [['revision 1', revisionOne], ['dense spacious', denseSpacious]] as const) {
    const input = make(), result = parse(input);
    assert.equal(result.widgetGrid.revision, 2, label); assert.equal(gridProblem(result.widgetGrid, result.widgets), null, label);
    assert.equal(result.widgets.rain, false, label); assert.equal(result.widgets.weather, true, label);
    for (const id of WIDGET_IDS.filter(id => id !== 'rain')) assert.equal(result.widgets[id], Boolean(input.widgets[id]), `${label}: ${id} stays ${input.widgets[id] ? 'visible' : 'hidden'}`);
    assert.deepEqual(parse(result), result, `${label}: idempotent`);
  }
});

async function application(directory: string) {
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const send = async (method: string, path: string, value?: unknown) => {
    const response = await fetch(`${url}${path}`, value === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    assert.ok(response.status < 300, `${method} ${path} returned ${response.status}: ${await response.clone().text()}`);
    return response.json();
  };
  return { ...app, send, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); } };
}
const readJson = async (directory: string, name: string) => JSON.parse(await readFile(join(directory, name), 'utf8'));
const temporary = () => mkdtemp(join(tmpdir(), 'lrd-weather-merge-'));

test('the store merges a legacy file in memory, leaves its bytes until an ordinary save, then writes rain:false', async () => {
  const directory = await temporary();
  try {
    const bytes = JSON.stringify({ version: 1, settings: legacy(), reminders: [] }, null, 2);
    await writeFile(join(directory, 'state.json'), bytes);
    const store = await DataStore.open(directory), snapshot = store.snapshot().settings;
    assert.equal(snapshot.widgets.rain, false); assert.deepEqual(snapshot.widgetGrid.placements.weather, { column: 8, row: 0, size: 'large' });
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), bytes, 'opening never rewrites the file');
    await store.patchSettings({ appearance: { brightness: 0.4 } });
    const primary = await readJson(directory, 'state.json'), backup = await readJson(directory, 'state.backup.json');
    assert.equal(primary.settings.widgets.rain, false); assert.deepEqual(primary.settings.widgetGrid.placements.weather, { column: 8, row: 0, size: 'large' });
    assert.equal(primary.settings.appearance.brightness, 0.4);
    // The backup is the previous in-memory state (already merged), written in the previous release's shape.
    assert.equal(backup.settings.appearance.brightness, previousDefaults().appearance.brightness);
    assert.equal(backup.settings.widgets.rain, false);
    assertPreviousReaderAccepts('data', primary, 'primary after save'); assertPreviousReaderAccepts('data', backup, 'backup after save');
    const reopened = (await DataStore.open(directory)).snapshot().settings;
    assert.deepEqual(reopened, store.snapshot().settings, 'reopening is stable');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('importing a legacy export merges Rain, and the next export has rain:false', async () => {
  const directory = await temporary(), app = await application(directory);
  try {
    await app.send('POST', '/api/import', { version: 1, exportedAt: new Date().toISOString(), settings: legacy(), reminders: [] });
    const settings = app.store.snapshot().settings;
    assert.equal(settings.widgets.rain, false); assert.deepEqual(settings.widgetGrid.placements.weather, { column: 8, row: 0, size: 'large' });
    const exported = await app.send('GET', '/api/export');
    assert.equal(exported.settings.widgets.rain, false);
    assertPreviousReaderAccepts('import', exported, 'export after a legacy import');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('files and exports written after a save stay readable by the previous release', async t => {
  const styled = () => { const settings = legacy(); settings.savedPresets = [{ id: 'style', name: 'Style', visual: visualOf(legacy()) }, { id: 'rain-only', name: 'Rain only', visual: visualOf(board({}, { weather: false })) }]; return settings; };
  const scenarios: [string, (() => Loose) | null][] = [
    ['defaults', null],
    ['revision-2 legacy file with both enabled', legacy],
    ['rain only', () => board({}, { weather: false })],
    ['small beside small', CASES[1]![1]],
    ['non-adjacent', CASES[4]![1]],
    ['revision 1', revisionOne],
    ['dense spacious board', denseSpacious],
    ['saved styles', styled],
  ];
  for (const [label, make] of scenarios) await t.test(label, async () => {
    const directory = await temporary();
    if (make) await writeFile(join(directory, 'state.json'), JSON.stringify({ version: 1, settings: make(), reminders: [] }));
    const app = await application(directory);
    try {
      await app.send('PATCH', '/api/settings', { appearance: { brightness: 0.45, preset: 'custom' } });
      const primary = await readJson(directory, 'state.json');
      assertPreviousReaderAccepts('data', primary, `${label} state.json`);
      assertPreviousReaderAccepts('data', await readJson(directory, 'state.backup.json'), `${label} state.backup.json`);
      assertPreviousReaderAccepts('import', await app.send('GET', '/api/export'), `${label} export`);
      for (const visual of [primary.settings, ...primary.settings.savedPresets.map((preset: Loose) => preset.visual)]) {
        assert.equal(visual.widgets.rain, false, `${label}: rain is written as false`);
        assert.ok(visual.widgetGrid.placements.rain, `${label}: the hidden Rain placement is still written`);
      }
      assert.deepEqual(persistableSettings(app.store.snapshot().settings), primary.settings, `${label}: the file is the persisted form of the merged settings`);
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
