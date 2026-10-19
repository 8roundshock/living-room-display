import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';
import { DataStore } from './store.ts';
import { importSchema, mergeSettings, settingsPatchSchema, settingsSchema } from './validation.ts';
import { applyBuiltinPreset, getVisual } from '../client/model.ts';
import { settingsChanges } from '../client/draft.ts';
import { firstPlacement } from '../shared/widgets.ts';
import { defaultSettings } from '../shared/defaults.ts';
import type { CountdownEvent, Settings, WorldClockCity } from '../shared/contracts.ts';

// Synthetic content only: real labels, titles and notes are private user data.
const city = (label = 'Sample city'): WorldClockCity => ({ id: randomUUID(), label, timezone: 'Europe/London', latitude: 51.5, longitude: -0.1 });
const event = (title = 'Sample event', date = '2026-12-25'): CountdownEvent => ({ id: randomUUID(), title, date, repeatsYearly: false });
const withData = (widgetData: unknown) => ({ ...JSON.parse(JSON.stringify(defaultSettings())), widgetData });
const patch = (widgetData: unknown) => settingsPatchSchema.parse({ widgetData });

test('legacy settings, data and imports without widgetData read the defaults', async () => {
  const legacy = JSON.parse(JSON.stringify(defaultSettings())); delete legacy.widgetData;
  assert.deepEqual(settingsSchema.parse(legacy).widgetData, defaultSettings().widgetData);
  assert.deepEqual(importSchema.parse({ version: 1, exportedAt: new Date().toISOString(), settings: legacy, reminders: [] }).settings.widgetData, defaultSettings().widgetData);
  assert.deepEqual(settingsSchema.parse(withData({ note: { text: 'Hello' } })).widgetData, { ...defaultSettings().widgetData, note: { text: 'Hello' } }, 'missing sections read their defaults');
  assert.deepEqual(settingsSchema.parse(withData({ calendar: {}, note: {}, airQuality: {} })).widgetData, defaultSettings().widgetData);
  const directory = await mkdtemp(join(tmpdir(), 'lrd-widget-data-legacy-'));
  try {
    await writeFile(join(directory, 'state.json'), JSON.stringify({ version: 1, settings: legacy, reminders: [] }));
    assert.deepEqual((await DataStore.open(directory)).snapshot().settings.widgetData, defaultSettings().widgetData);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('widgetData enforces limits, unique ids, real zones and dates, and strict keys', () => {
  const duplicate = city();
  const repeated = event();
  const rejected: [string, unknown][] = [
    ['5 cities', { worldClocks: [city(), city(), city(), city(), city()] }],
    ['13 countdowns', { countdowns: Array.from({ length: 13 }, () => event()) }],
    ['duplicate city ids', { worldClocks: [duplicate, { ...duplicate, label: 'Other' }] }],
    ['duplicate countdown ids', { countdowns: [repeated, { ...repeated, title: 'Other' }] }],
    ['bad zone', { worldClocks: [{ ...city(), timezone: 'Mars/Olympus' }] }],
    ['auto zone', { worldClocks: [{ ...city(), timezone: 'auto' }] }],
    ['non-uuid id', { worldClocks: [{ ...city(), id: 'city-1' }] }],
    ['latitude', { worldClocks: [{ ...city(), latitude: 91 }] }],
    ['empty label', { worldClocks: [city('   ')] }],
    ['41-character label', { worldClocks: [city('x'.repeat(41))] }],
    ['impossible date', { countdowns: [event('Sample', '2026-02-30')] }],
    ['date format', { countdowns: [event('Sample', '2026-2-3')] }],
    ['date range', { countdowns: [event('Sample', '1899-12-31')] }],
    ['empty title', { countdowns: [event('')] }],
    ['61-character title', { countdowns: [event('x'.repeat(61))] }],
    ['201-character note', { note: { text: 'x'.repeat(201) } }],
    ['5-line note', { note: { text: 'a\nb\nc\nd\ne' } }],
    ['unknown section', { weather: {} }],
    ['unknown city key', { worldClocks: [{ ...city(), color: 'red' }] }],
    ['unknown note key', { note: { text: '', color: 'red' } }],
    ['unknown week start', { calendar: { weekStart: 'friday' } }],
    ['unknown scale', { airQuality: { scale: 'uk' } }],
  ];
  for (const [label, widgetData] of rejected) {
    assert.throws(() => settingsSchema.parse(withData(widgetData)), undefined, `persisted ${label}`);
    assert.throws(() => patch(widgetData), undefined, `PATCH ${label}`);
  }
  const accepted = settingsSchema.parse(withData({ worldClocks: [city(), city(), city(), city('  Trimmed  ')], countdowns: Array.from({ length: 12 }, () => event('Sample', '2028-02-29')), note: { text: '  a\r\nb\r\nc\nd  ' }, calendar: { weekStart: 'monday' }, airQuality: { scale: 'european' } }));
  assert.equal(accepted.widgetData.worldClocks[3]!.label, 'Trimmed');
  assert.equal(accepted.widgetData.note.text, 'a\nb\nc\nd', 'CRLF becomes LF and the note is trimmed');
  assert.equal(patch({ note: { text: 'x'.repeat(200) } }).widgetData?.note?.text?.length, 200);
});

test('PATCHes merge nested sections, replace arrays whole and never add defaults', () => {
  assert.deepEqual(patch({ note: { text: 'Hi' } }), { widgetData: { note: { text: 'Hi' } } });
  assert.deepEqual(patch({ calendar: {} }), { widgetData: { calendar: {} } });
  const kept = [event('First'), event('Second')];
  const saved = mergeSettings(defaultSettings(), patch({ countdowns: kept, worldClocks: [city()], calendar: { weekStart: 'sunday' } }));
  const noted = mergeSettings(saved, patch({ note: { text: 'Hello' } }));
  assert.deepEqual(noted.widgetData.countdowns, kept, 'a note-only PATCH keeps countdowns');
  assert.equal(noted.widgetData.calendar.weekStart, 'sunday'); assert.equal(noted.widgetData.worldClocks.length, 1);
  const replaced = mergeSettings(noted, patch({ countdowns: [kept[1]] }));
  assert.deepEqual(replaced.widgetData.countdowns, [kept[1]], 'arrays replace whole');
  assert.equal(replaced.widgetData.note.text, 'Hello');
  assert.deepEqual(mergeSettings(replaced, patch({ worldClocks: [] })).widgetData.worldClocks, []);
});

test('saved styles and built-in presets leave widgetData untouched and never contain it', () => {
  const settings: Settings = mergeSettings(defaultSettings(), patch({ note: { text: 'Kept' }, countdowns: [event()] }));
  const styled = mergeSettings(settings, { savedPresets: [{ id: 'style', name: 'Style', visual: getVisual(settings) }] });
  assert.equal('widgetData' in styled.savedPresets[0]!.visual, false);
  const applied = mergeSettings(styled, { ...styled.savedPresets[0]!.visual });
  assert.deepEqual(applied.widgetData, settings.widgetData, 'applying a saved style');
  for (const preset of ['phone', 'room', 'night'] as const) assert.deepEqual(settingsSchema.parse(applyBuiltinPreset(settings, preset)).widgetData, settings.widgetData, preset);
  assert.throws(() => settingsSchema.parse({ ...settings, savedPresets: [{ id: 'bad', name: 'Bad', visual: { ...getVisual(settings), widgetData: settings.widgetData } }] }), 'saved styles are strict visuals');
});

test('#153 each built-in style saved over a board with an added Note keeps the Note, its place, its text and the rest of the board', async () => {
  for (const preset of ['phone', 'room', 'night'] as const) {
    const directory = await mkdtemp(join(tmpdir(), `lrd-widget-data-${preset}-`));
    try {
      const store = await DataStore.open(directory);
      const start = store.snapshot().settings;
      const place = firstPlacement(start.widgetGrid, 'note', 'small', start.widgets);
      assert.ok(place, 'the default board has room for a small Note');
      // A non-default widget set: Note added with text, Last screen removed, Reminders shown when empty.
      const board = await store.patchSettings(settingsPatchSchema.parse({
        widgets: { note: true, preview: false }, preview: { enabled: false }, widgetBehavior: { reminders: { hideWhenEmpty: false } },
        widgetGrid: { placements: { note: place } }, widgetData: { note: { text: 'Synthetic note' } },
        // A look other than the target, so applying it is always an effective change.
        appearance: { brightness: 0.4 },
      }));
      const styled = applyBuiltinPreset(board, preset);
      const saved = await store.patchSettings(settingsPatchSchema.parse(settingsChanges(board, styled)));
      assert.equal(saved.widgets.note, true, `${preset} keeps Note enabled`);
      assert.deepEqual(saved.widgetGrid.placements.note, board.widgetGrid.placements.note, `${preset} keeps Note in place`);
      assert.deepEqual(saved.widgets, board.widgets, `${preset} keeps the widget set`);
      assert.deepEqual(saved.widgetGrid, board.widgetGrid, `${preset} keeps the layout`);
      assert.deepEqual(saved.widgetBehavior, board.widgetBehavior, `${preset} keeps Hide when empty`);
      assert.deepEqual(saved.preview, board.preview, `${preset} keeps Last screen off`);
      assert.deepEqual(saved.widgetData, board.widgetData, `${preset} keeps the note text`);
      assert.equal(saved.appearance.brightness, applyBuiltinPreset(defaultSettings(), preset).appearance.brightness, `${preset} sets its brightness`);
      assert.equal(saved.appearance.preset, preset);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('exports include non-default widgetData and imports restore it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-widget-data-'));
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const send = (method: string, path: string, value?: unknown) => fetch(`${url}${path}`, value === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  try {
    assert.equal('widgetData' in (await (await send('GET', '/api/export')).json()).settings, false, 'default widgetData is omitted from exports');
    const countdown = event('Synthetic');
    const response = await send('PATCH', '/api/settings', { widgetData: { countdowns: [countdown], note: { text: 'Synthetic note' } } });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.deepEqual(saved.widgetData, { ...defaultSettings().widgetData, countdowns: [countdown], note: { text: 'Synthetic note' } }, 'API responses carry every section');
    assert.deepEqual((await (await send('GET', '/api/state')).json()).settings.widgetData, saved.widgetData);
    const exported = await (await send('GET', '/api/export')).json();
    assert.deepEqual(exported.settings.widgetData, { countdowns: [countdown], note: { text: 'Synthetic note' } }, 'exports carry changed sections only');
    assert.equal((await send('PATCH', '/api/settings', { widgetData: { countdowns: [], note: { text: '' } } })).status, 200);
    assert.equal((await send('POST', '/api/import', exported)).status, 200);
    assert.deepEqual(app.store.snapshot().settings.widgetData, saved.widgetData, 'import restores the exported content');
    assert.equal((await send('PATCH', '/api/settings', { widgetData: { note: { text: 'x'.repeat(201) } } })).status, 400);
    assert.equal((await send('PATCH', '/api/settings', { widgetData: { worldClocks: [{ ...city(), timezone: 'auto' }] } })).status, 400);
  } finally { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); }
});
