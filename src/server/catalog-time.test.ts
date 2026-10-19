// Calendar, Countdown and Note (#78): catalog activation, widgetData semantics through the API, and
// rollback. Synthetic content and temporary folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture, seedColorAccentData } from './fixtures.ts';
import { DataStore } from './store.ts';
import { settingsPatchSchema, settingsSchema } from './validation.ts';
import { assertPreviousReaderAccepts, assertPreviousReaderRejects } from './compat/previous-reader.ts';
import { defaultSettings } from '../shared/defaults.ts';
import {
  ACTIVE_WIDGET_IDS, WIDGET_CATALOG, WIDGET_CATEGORIES, WIDGET_IDS, composeWidgetGrid, defaultWidgetVisibility, gridProblem, isActiveWidget, placementSpan,
  widgetSizes, type WidgetDefinition,
} from '../shared/widgets.ts';
import type { CountdownEvent, SettingsPatch, WidgetId } from '../shared/contracts.ts';

const IDS = ['calendar', 'countdown', 'note'] as const satisfies readonly WidgetId[];
const event = (title: string, date: string, repeatsYearly = false): CountdownEvent => ({ id: randomUUID(), title, date, repeatsYearly });

async function application(directory: string) {
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const send = async (method: string, path: string, value?: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, value === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  return { ...app, send, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); } };
}
async function stateFile(directory: string, name = 'state.json'): Promise<unknown> { return JSON.parse(await readFile(join(directory, name), 'utf8')); }

test('Calendar, Countdown and Note are active, optional and grouped with valid defaults', () => {
  const expected: Record<(typeof IDS)[number], Pick<WidgetDefinition, 'category' | 'tone' | 'icon' | 'defaultSize'>> = {
    calendar: { category: 'time', tone: 'time', icon: 'calendar', defaultSize: 'medium' },
    countdown: { category: 'personal', tone: 'personal', icon: 'hourglass', defaultSize: 'small' },
    note: { category: 'personal', tone: 'personal', icon: 'note', defaultSize: 'small' },
  };
  for (const id of IDS) {
    const entry: WidgetDefinition = WIDGET_CATALOG[id];
    assert.equal(isActiveWidget(id), true, id); assert.equal(entry.status, undefined, `${id} has no status`);
    assert.ok(ACTIVE_WIDGET_IDS.includes(id), id);
    assert.deepEqual({ category: entry.category, tone: entry.tone, icon: entry.icon, defaultSize: entry.defaultSize }, expected[id], id);
    assert.deepEqual(widgetSizes(id), ['small', 'medium', 'large'], id);
    assert.equal(entry.defaultEnabled, false, `${id} is optional and off by default`);
    assert.equal(defaultWidgetVisibility()[id], false);
  }
  assert.equal(WIDGET_CATALOG.forecast.icon, 'forecast', 'the calendar glyph now belongs to Calendar');
  assert.equal(new Set(ACTIVE_WIDGET_IDS.map(id => WIDGET_CATALOG[id].icon)).size, ACTIVE_WIDGET_IDS.length, 'active widgets have distinct icons');
  assert.deepEqual(Object.keys(WIDGET_CATEGORIES), ['time', 'weather', 'personal', 'pictures']);
  for (const category of Object.keys(WIDGET_CATEGORIES)) assert.ok(ACTIVE_WIDGET_IDS.some(id => WIDGET_CATALOG[id].category === category), `${category} has an active widget`);
  const settings = defaultSettings();
  for (const id of IDS) settings.widgets[id] = true;
  assert.equal(gridProblem(settings.widgetGrid, settings.widgets), null, 'the three default placements fit beside the default board');
});

test('enabling the widgets and editing their content goes through the API with merge semantics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-catalog-time-'));
  const app = await application(directory);
  try {
    for (const id of IDS) assert.deepEqual(settingsPatchSchema.parse({ widgets: { [id]: true } }), { widgets: { [id]: true } }, `${id} may be enabled`);
    let response = await app.send('PATCH', '/api/settings', { widgets: { calendar: true, countdown: true, note: true } });
    assert.equal(response.status, 200, await response.clone().text());
    const trip = event('Weekend trip', '2026-10-30'), birthday = event('Birthday', '1990-11-03', true);
    response = await app.send('PATCH', '/api/settings', { widgetData: { calendar: { weekStart: 'monday' }, countdowns: [trip, birthday], note: { text: '  Dinner\r\nat seven  ' } } });
    assert.equal(response.status, 200);
    let settings = await response.json();
    assert.equal(settings.widgetData.calendar.weekStart, 'monday');
    assert.deepEqual(settings.widgetData.countdowns, [trip, birthday]);
    assert.equal(settings.widgetData.note.text, 'Dinner\nat seven', 'the server trims and normalizes line endings');
    settings = await (await app.send('PATCH', '/api/settings', { widgetData: { note: { text: 'Kept' } } })).json();
    assert.deepEqual(settings.widgetData.countdowns, [trip, birthday], 'a note-only edit keeps the countdowns');
    assert.equal(settings.widgetData.calendar.weekStart, 'monday', 'and the week start');
    settings = await (await app.send('PATCH', '/api/settings', { widgetData: { countdowns: [birthday] } })).json();
    assert.deepEqual(settings.widgetData.countdowns, [birthday], 'the list replaces whole');
    assert.equal(settings.widgetData.note.text, 'Kept');
    settings = await (await app.send('PATCH', '/api/settings', { widgetData: { calendar: {} } })).json();
    assert.equal(settings.widgetData.calendar.weekStart, 'monday', 'an empty section changes nothing');
    for (const [label, widgetData] of [
      ['empty title', { countdowns: [event('   ', '2026-12-24')] }],
      ['missing date', { countdowns: [{ ...event('Holiday', '2026-12-24'), date: '' }] }],
      ['five lines', { note: { text: '1\n2\n3\n4\n5' } }],
      ['friday', { calendar: { weekStart: 'friday' } }],
    ] as const) assert.equal((await app.send('PATCH', '/api/settings', { widgetData })).status, 400, label);
    const state = await (await app.send('GET', '/api/state')).json();
    assert.deepEqual(state.settings.widgetData.countdowns, [birthday], 'rejected PATCHes leave saved content alone');
    for (const id of IDS) assert.equal(state.settings.widgets[id], true, id);
    const exported = await (await app.send('GET', '/api/export')).json();
    assert.deepEqual(exported.settings.widgetData, { calendar: { weekStart: 'monday' }, countdowns: [birthday], note: { text: 'Kept' } }, 'exports carry the private content');
    assert.equal(settingsSchema.parse(exported.settings).widgetData.note.text, 'Kept');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('rollback: default data stays readable; enabling a widget or entering content is the documented exception', async () => {
  // Every folder starts from an existing user's colour-accent defaults, so only these widgets' data can
  // make a file unreadable: a fresh folder is Native, the separate #75 exception.
  const fresh = await mkdtemp(join(tmpdir(), 'lrd-catalog-time-fresh-'));
  try {
    await seedColorAccentData(fresh);
    const store = await DataStore.open(fresh);
    await store.patchSettings({ units: 'imperial' });
    assertPreviousReaderAccepts('data', await stateFile(fresh), 'defaults with the three widgets off and no content');
  } finally { await rm(fresh, { recursive: true, force: true }); }
  const exceptions: [string, SettingsPatch][] = [
    ['Calendar enabled', { widgets: { calendar: true } }],
    ['Countdown enabled', { widgets: { countdown: true } }],
    ['Note enabled', { widgets: { note: true } }],
    ['a countdown', { widgetData: { countdowns: [event('Synthetic', '2026-12-24')] } }],
    ['note text', { widgetData: { note: { text: 'Synthetic note' } } }],
    ['week start Monday', { widgetData: { calendar: { weekStart: 'monday' } } }],
    ['week start Sunday', { widgetData: { calendar: { weekStart: 'sunday' } } }],
  ];
  for (const [label, patch] of exceptions) {
    const directory = await mkdtemp(join(tmpdir(), 'lrd-catalog-time-exception-'));
    try {
      await seedColorAccentData(directory);
      const store = await DataStore.open(directory);
      await store.patchSettings(patch);
      assertPreviousReaderRejects('data', await stateFile(directory), label);
      assertPreviousReaderAccepts('data', await stateFile(directory, 'state.backup.json'), `${label}: the backup of the previous save`);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  // A saved style captured while a widget was on keeps it, so it stays unreadable until re-saved.
  const styled = await mkdtemp(join(tmpdir(), 'lrd-catalog-time-style-'));
  try {
    await seedColorAccentData(styled);
    const store = await DataStore.open(styled);
    const on = await store.patchSettings({ widgets: { calendar: true } });
    const { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } = on;
    await store.patchSettings({ savedPresets: [{ id: 'synthetic-style', name: 'Synthetic style', visual: { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } }] });
    await store.patchSettings({ widgets: { calendar: false } });
    await store.patchSettings({ units: 'imperial' });
    assertPreviousReaderRejects('data', await stateFile(styled), 'a saved style that includes Calendar');
    await store.patchSettings({ savedPresets: [] });
    await store.patchSettings({ units: 'metric' });
    assertPreviousReaderAccepts('data', await stateFile(styled), 'after deleting that saved style');
  } finally { await rm(styled, { recursive: true, force: true }); }
  // Turning the widgets off and clearing their content makes the files readable again; one more
  // save refreshes the backup, which still holds the previous (exceptional) save until then.
  const reverted = await mkdtemp(join(tmpdir(), 'lrd-catalog-time-reverted-'));
  try {
    await seedColorAccentData(reverted);
    const store = await DataStore.open(reverted);
    await store.patchSettings({ widgets: { calendar: true, countdown: true, note: true }, widgetData: { calendar: { weekStart: 'sunday' }, countdowns: [event('Synthetic', '2026-12-24')], note: { text: 'Synthetic' } } });
    assertPreviousReaderRejects('data', await stateFile(reverted), 'all three in use');
    await store.patchSettings({ widgets: { calendar: false, countdown: false, note: false }, widgetData: { calendar: { weekStart: 'locale' }, countdowns: [], note: { text: '' } } });
    assertPreviousReaderAccepts('data', await stateFile(reverted), 'state.json right after turning the widgets off and clearing their content');
    assertPreviousReaderRejects('data', await stateFile(reverted, 'state.backup.json'), 'the backup still holds the previous save');
    await store.patchSettings({ units: 'imperial' });
    assertPreviousReaderAccepts('data', await stateFile(reverted), 'after turning the widgets off and clearing their content');
    assertPreviousReaderAccepts('data', await stateFile(reverted, 'state.backup.json'), 'its backup');
  } finally { await rm(reverted, { recursive: true, force: true }); }
});

test('Calendar, Countdown and Note sit beside a custom Reminders span and keep a full board moving (#73, #93)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-catalog-time-span-'));
  await seedColorAccentData(directory); // colour-accent defaults: Native is the separate #75 exception
  const app = await application(directory);
  try {
    // Every Balanced cell used: a 2 × 8 Reminders column, the default widgets, Photo and the three new widgets.
    const widgets = { ...defaultWidgetVisibility(), photo: true, calendar: true, countdown: true, note: true };
    const placements = {
      reminders: { column: 0, row: 0, size: 'small', span: { columns: 2, rows: 8 } }, clock: { column: 2, row: 0, size: 'large' },
      calendar: { column: 10, row: 0, size: 'small' }, countdown: { column: 10, row: 2, size: 'small' },
      forecast: { column: 2, row: 4, size: 'large' }, note: { column: 10, row: 4, size: 'small' },
      weather: { column: 2, row: 6, size: 'medium' }, preview: { column: 6, row: 6, size: 'medium' }, photo: { column: 10, row: 6, size: 'small' },
    };
    const response = await app.send('PATCH', '/api/settings', { widgets, widgetGrid: { placements } });
    assert.equal(response.status, 200, await response.clone().text());
    const saved = app.store.snapshot().settings, enabled = { ...saved.widgets, preview: saved.widgets.preview && saved.preview.enabled };
    for (const id of IDS) assert.equal(enabled[id], true, id);
    assert.deepEqual(saved.widgetGrid.placements.reminders, placements.reminders, 'the span is stored as sent');
    assert.equal(gridProblem(saved.widgetGrid, enabled), null);
    const ids = WIDGET_IDS.filter(id => enabled[id]);
    assert.equal(ids.reduce((sum, id) => { const span = placementSpan(id, saved.widgetGrid.placements[id]); return sum + span.columns * span.rows; }, 0), 96, 'every Balanced cell is used');
    let previous = saved.widgetGrid;
    for (let cycle = 1; cycle <= 12; cycle++) {
      const next = composeWidgetGrid(saved.widgetGrid, enabled, cycle, previous);
      assert.equal(gridProblem(next, enabled), null, `cycle ${cycle}`);
      for (const id of ids) assert.deepEqual(placementSpan(id, next.placements[id]), placementSpan(id, saved.widgetGrid.placements[id]), `cycle ${cycle}: ${id} keeps its size`);
      assert.ok(ids.some(id => next.placements[id].column !== previous.placements[id].column || next.placements[id].row !== previous.placements[id].row), `cycle ${cycle} relocates the full board through a reflection`);
      previous = next;
    }
    // Rollback: the span (#73) and the new widgets (#78) are separate documented exceptions; clearing both recovers.
    assertPreviousReaderRejects('data', await stateFile(directory), 'a span beside the three widgets');
    assert.equal((await app.send('PATCH', '/api/settings', { widgets: { calendar: false, countdown: false, note: false } })).status, 200);
    assertPreviousReaderRejects('data', await stateFile(directory), 'the span alone is still the #73 exception');
    assert.equal((await app.send('PATCH', '/api/settings', { widgetGrid: { placements: { reminders: { size: 'small' } } } })).status, 200);
    assert.equal(Object.hasOwn(app.store.snapshot().settings.widgetGrid.placements.reminders, 'span'), false);
    assertPreviousReaderAccepts('data', await stateFile(directory), 'with the three widgets off and the span cleared');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
