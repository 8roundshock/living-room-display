// Rollback compatibility (#84): data written by this build must still parse with the frozen reader of
// the previous installed release (3446400 since #367). Synthetic data in temporary folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './app.ts';
import { colorAccentDefaults, forecastFixture, photoFixture, seedColorAccentData } from './fixtures.ts';
import { DataStore } from './store.ts';
import { AT_REST, PREVIOUS_RELEASE, persistableData } from './persistence.ts';
import {
  LEGACY_FIXTURE, LEGACY_FIXTURE_BLOBS, PREVIOUS_READER, VENDORED_BLOBS, assertPreviousReaderAccepts, assertPreviousReaderRejects,
} from './compat/previous-reader.ts';
import { defaultSettings as previousDefaults } from './compat/3446400/shared/defaults.ts';
import { AT_REST as PREVIOUS_AT_REST, persistableData as previousPersistableData } from './compat/3446400/server/persistence.ts';
import { WIDGET_CATALOG as PREVIOUS_CATALOG } from './compat/3446400/shared/widgets.ts';
import { defaultSettings as legacyDefaults } from './compat/bedca44/shared/defaults.ts';
import { WIDGET_CATALOG as LEGACY_CATALOG, defaultWidgetGrid as legacyGrid } from './compat/bedca44/shared/widgets.ts';
import { WIDGET_IDS, fitGridDensity, isPlannedWidget } from '../shared/widgets.ts';
import { applyBuiltinPreset, getVisual, resetAppearance } from '../client/model.ts';
import { settingsChanges } from '../client/draft.ts';
import type { Settings, SettingsPatch } from '../shared/contracts.ts';

type Loose = Record<string, any>;

async function application(directory: string) {
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const send = async (method: string, path: string, value?: unknown) => {
    const response = await fetch(`${url}${path}`, value === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    assert.ok(response.status < 300, `${method} ${path} returned ${response.status}: ${await response.clone().text()}`);
    return response.status === 204 ? null : response.json();
  };
  return { ...app, url, send, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); } };
}
async function readJson(directory: string, name: string): Promise<any> { return JSON.parse(await readFile(join(directory, name), 'utf8')); }
async function assertFilesAccepted(directory: string, label: string, backup = true) {
  assertPreviousReaderAccepts('data', await readJson(directory, 'state.json'), `${label} state.json`);
  if (backup) assertPreviousReaderAccepts('data', await readJson(directory, 'state.backup.json'), `${label} state.backup.json`);
}
async function temporary(prefix: string) { return mkdtemp(join(tmpdir(), prefix)); }

/** The git blob id of a file under ./compat/, as `git hash-object` computes it from the bytes on disk. */
async function blobId(path: string): Promise<string> {
  const bytes = await readFile(new URL(`./compat/${path}`, import.meta.url));
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
/** Every file below ./compat/<folder>/, as `<folder>/<posix path>`. */
async function vendoredFiles(folder: string): Promise<string[]> {
  const root = fileURLToPath(new URL('./compat/', import.meta.url));
  const entries = await readdir(join(root, folder), { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile()).map(entry => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/')).sort();
}

test('the frozen reader is an unedited copy of the previous release and its catalog matches PREVIOUS_RELEASE', async () => {
  const folder = PREVIOUS_READER.revision.slice(0, 7);
  // 3446400's validation.ts and its transitive imports, nothing else (#263, #367).
  assert.deepEqual(await vendoredFiles(folder), Object.keys(VENDORED_BLOBS).sort(), 'every vendored file has a blob id, and every blob id a file');
  assert.deepEqual(Object.keys(VENDORED_BLOBS).sort(), ['server/persistence.ts', 'server/photo.ts', 'server/validation.ts', 'shared/contracts.ts', 'shared/defaults.ts', 'shared/motion.ts', 'shared/palette.ts', 'shared/widgets.ts'].map(path => `${folder}/${path}`));
  for (const [path, blob] of Object.entries(VENDORED_BLOBS)) assert.equal(await blobId(path), blob, `${path} must stay byte-for-byte identical to ${folder}`);
  assert.equal(PREVIOUS_READER.revision, PREVIOUS_RELEASE.revision);
  assert.deepEqual(Object.keys(PREVIOUS_CATALOG), [...PREVIOUS_RELEASE.widgetIds]);
  assert.deepEqual(PREVIOUS_READER.widgetIds, [...PREVIOUS_RELEASE.widgetIds]);
});

test('the bedca44 legacy-data fixture stays an unedited copy of bedca44', async () => {
  const folder = LEGACY_FIXTURE.revision.slice(0, 7);
  assert.notEqual(folder, PREVIOUS_READER.revision.slice(0, 7), 'the fixture is not the rollback reader');
  assert.deepEqual(await vendoredFiles(folder), Object.keys(LEGACY_FIXTURE_BLOBS).sort());
  for (const [path, blob] of Object.entries(LEGACY_FIXTURE_BLOBS)) assert.equal(await blobId(path), blob, `${path} must stay byte-for-byte identical to ${folder}`);
  // bedca44 predates the #78 ids; the tests that use it build pre-#74/#75/#78 data from it.
  assert.deepEqual(Object.keys(LEGACY_CATALOG), ['clock', 'weather', 'rain', 'forecast', 'reminders', 'preview', 'photo']);
});

test('negative controls: the previous release still rejects an unknown key and invalid values', () => {
  const valid = previousPersistableData({ version: 1, settings: previousDefaults(), reminders: [], photoAsset: null }) as Loose;
  assertPreviousReaderAccepts('data', valid, 'the control itself');
  const exported = { version: valid.version, settings: structuredClone(valid.settings), reminders: [], exportedAt: new Date(0).toISOString() };
  assertPreviousReaderAccepts('import', exported, 'the control export');
  const cases: [string, (settings: Loose) => void][] = [
    ['an unknown settings key', settings => { settings.syntheticKey = true; }],
    ['an unknown appearance key', settings => { settings.appearance.syntheticKey = 1; }],
    ['an unknown widget id', settings => { settings.widgets.syntheticWidget = false; }],
    ['an unknown widgetData section', settings => { settings.widgetData = { syntheticSection: {} }; }],
    ['an invalid accent mode', settings => { settings.appearance.accentMode = 'rainbow'; }],
    ['an invalid animation level', settings => { settings.appearance.animation = 'frantic'; }],
    ['a span on a fixed-size widget', settings => { settings.widgetGrid.placements.weather.span = { columns: 3, rows: 3 }; }],
    ['a span wider than two thirds of the grid', settings => { settings.widgetGrid.placements.reminders.span = { columns: 11, rows: 2 }; }],
    ['a five-line note', settings => { settings.widgetData = { note: { text: '1\n2\n3\n4\n5' } }; }],
    ['an unknown week start', settings => { settings.widgetData = { calendar: { weekStart: 'friday' } }; }],
    ['an unknown AQI scale', settings => { settings.widgetData = { airQuality: { scale: 'synthetic' } }; }],
  ];
  for (const [label, edit] of cases) {
    const data = structuredClone(valid); edit(data.settings);
    assertPreviousReaderRejects('data', data, label);
    const imported = structuredClone(exported); edit(imported.settings);
    assertPreviousReaderRejects('import', imported, `${label} in an export`);
  }
});

/** AT_REST keys the previous release knows (optional omission) and those it does not (required, #439). */
const KNOWN_AT_REST = Object.keys(AT_REST.appearance).filter(key => key in PREVIOUS_AT_REST.appearance) as (keyof typeof AT_REST.appearance)[];
const NEW_AT_REST = Object.keys(AT_REST.appearance).filter(key => !(key in PREVIOUS_AT_REST.appearance)) as (keyof typeof AT_REST.appearance)[];

test('#272 every value omitted at rest is readable by the previous release when written, so the omission is optional', () => {
  // Default data with every omitted value present: colour accent, Subtle and the default widgetData sections,
  // in settings and in a saved style. Decision (#272): keep the omission; nothing on disk changes format here.
  const settings = colorAccentDefaults();
  settings.savedPresets = [{ id: 'synthetic-style', name: 'Synthetic style', visual: getVisual(settings) }];
  const full = { version: 1 as const, settings, reminders: [], photoAsset: null };
  const atRest = persistableData(full).settings as Loose;
  // Not vacuous: the at-rest form really leaves these values out.
  for (const appearance of [atRest.appearance, atRest.savedPresets[0].visual.appearance]) {
    for (const key of Object.keys(AT_REST.appearance)) assert.equal(key in appearance, false, `${key} is omitted at rest`);
  }
  assert.equal('widgetData' in atRest, false, 'default widgetData is omitted at rest');
  assertPreviousReaderAccepts('data', { ...full, settings: atRest }, 'the at-rest form');
  // Keys the previous release does not know (see the #439 test below) are left out here: their
  // omission is required, not optional, until the baseline knows them.
  assert.deepEqual(KNOWN_AT_REST, ['accentMode', 'animation']);
  const written = JSON.parse(JSON.stringify(full)) as Loose;
  for (const appearance of [written.settings.appearance, written.settings.savedPresets[0].visual.appearance]) {
    for (const key of NEW_AT_REST) delete appearance[key];
    for (const key of KNOWN_AT_REST) assert.equal(appearance[key], AT_REST.appearance[key], `${key} is written`);
  }
  assert.deepEqual(written.settings.widgetData, colorAccentDefaults().widgetData, 'every default widgetData section is written');
  assertPreviousReaderAccepts('data', written, 'every omitted value written in state.json');
  const exported = { version: written.version, exportedAt: new Date(0).toISOString(), settings: written.settings, reminders: [] };
  assertPreviousReaderAccepts('import', exported, 'every omitted value written in an export');
});

test('#439 Fixed brightness omits daylightBrightness at rest, which the previous release requires', () => {
  assert.deepEqual(NEW_AT_REST, ['daylightBrightness'], 'the previous release does not know the Follow daylight key');
  const settings = colorAccentDefaults();
  settings.savedPresets = [{ id: 'synthetic-style', name: 'Synthetic style', visual: getVisual(settings) }];
  const full = { version: 1 as const, settings, reminders: [], photoAsset: null };
  assert.equal(full.settings.appearance.daylightBrightness, null, 'Fixed in memory and in API responses');
  const written = JSON.parse(JSON.stringify(full)) as Loose;
  assertPreviousReaderRejects('data', written, 'daylightBrightness: null written out');
  assertPreviousReaderRejects('import', { version: 1, exportedAt: new Date(0).toISOString(), settings: written.settings, reminders: [] }, 'daylightBrightness: null in an export');
  const atRest = persistableData(full);
  assert.equal('daylightBrightness' in (atRest.settings as Loose).appearance, false);
  assert.equal('daylightBrightness' in (atRest.settings as Loose).savedPresets[0].visual.appearance, false);
  assertPreviousReaderAccepts('data', atRest, 'Fixed at rest');
});

const DAYLIGHT = { dimmest: 0.25, brightest: 0.75 };
const daylightOf = (file: Loose) => file.settings.appearance.daylightBrightness;
/** The documented strip (docs/install.md): delete every daylightBrightness, which is Fixed at `brightness`. */
function stripDaylight(file: Loose): Loose {
  const copy = structuredClone(file);
  for (const appearance of [copy.settings?.appearance, ...(copy.settings?.savedPresets ?? []).map((preset: Loose) => preset?.visual?.appearance)]) {
    if (appearance && typeof appearance === 'object') delete appearance.daylightBrightness;
  }
  return copy;
}

test('#439 Follow daylight is a documented rollback exception until Fixed is saved again or the key is stripped', async () => {
  const directory = await temporary('lrd-rollback-daylight-'), target = await temporary('lrd-rollback-daylight-import-');
  const app = await application(directory), imported = await application(target);
  try {
    // A fresh folder is Fixed and writes no key.
    const fresh = await readJson(directory, 'state.json');
    assert.equal('daylightBrightness' in fresh.settings.appearance, false, 'a fresh folder omits the key');
    await app.send('PATCH', '/api/settings', { appearance: { daylightBrightness: DAYLIGHT } });
    const following = await readJson(directory, 'state.json');
    assert.deepEqual(daylightOf(following), DAYLIGHT, 'state.json carries the range');
    assertPreviousReaderRejects('data', following, 'Follow daylight state.json');
    assertPreviousReaderAccepts('data', stripDaylight(following), 'Follow daylight state.json after the strip');
    assert.equal(stripDaylight(following).settings.appearance.brightness, following.settings.appearance.brightness, 'the strip keeps the Fixed level');
    const exported = await app.send('GET', '/api/export');
    assert.deepEqual(daylightOf(exported), DAYLIGHT, 'the export carries the range');
    assertPreviousReaderRejects('import', exported, 'Follow daylight export');
    assertPreviousReaderAccepts('import', stripDaylight(exported), 'Follow daylight export after the strip');
    // A saved style made while following daylight carries it too.
    await app.send('PATCH', '/api/settings', { savedPresets: [{ id: 'daylight-style', name: 'Daylight style', visual: getVisual(app.store.snapshot().settings) }] });
    const styled = await readJson(directory, 'state.json');
    assert.deepEqual(styled.settings.savedPresets[0]?.visual.appearance.daylightBrightness, DAYLIGHT);
    // Back to Fixed: settings write no key again; the saved style still needs stripping or deleting.
    await app.send('PATCH', '/api/settings', { appearance: { daylightBrightness: null } });
    const fixedAgain = await readJson(directory, 'state.json');
    assert.equal('daylightBrightness' in fixedAgain.settings.appearance, false, 'Fixed omits the key again');
    assertPreviousReaderRejects('data', fixedAgain, 'Fixed settings with a Follow daylight saved style');
    assertPreviousReaderAccepts('data', stripDaylight(fixedAgain), 'after stripping the saved style');
    await app.send('PATCH', '/api/settings', { savedPresets: [] });
    await assertFilesAccepted(directory, 'Fixed without the style, after one more save', false);
    await app.send('PATCH', '/api/settings', { units: 'imperial' });
    await assertFilesAccepted(directory, 'Fixed, state.backup.json after one more save');
    assertPreviousReaderAccepts('import', await app.send('GET', '/api/export'), 'Fixed export');
    // Importing a Follow daylight export restores the range in the newer app.
    await imported.send('POST', '/api/import', exported);
    assert.deepEqual(daylightOf(await readJson(target, 'state.json')), DAYLIGHT);
    assert.deepEqual(imported.store.snapshot().settings.appearance.daylightBrightness, DAYLIGHT);
  } finally {
    await app.close(); await imported.close();
    await rm(directory, { recursive: true, force: true }); await rm(target, { recursive: true, force: true });
  }
});

test('(a) a fresh data folder, Native colours (#75) included, is readable by the previous release', async () => {
  const directory = await temporary('lrd-rollback-fresh-');
  const app = await application(directory);
  try {
    const fresh = await readJson(directory, 'state.json');
    assert.equal(fresh.settings.appearance.accentMode, 'native', 'a fresh folder starts Native and writes it');
    assertPreviousReaderAccepts('data', fresh, 'fresh Native state.json');
    assertPreviousReaderAccepts('import', await app.send('GET', '/api/export'), 'fresh Native export');
    await app.send('PATCH', '/api/settings', { units: 'imperial' });
    await assertFilesAccepted(directory, 'fresh after an unrelated save');
    assert.equal((await readJson(directory, 'state.backup.json')).settings.appearance.accentMode, 'native', 'the backup holds the fresh Native save');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('(b, c) previous-release data stays readable after unrelated saves, and so does its export', async () => {
  const directory = await temporary('lrd-rollback-saves-');
  // Exactly what the previous release (3446400) writes for its defaults: its own at-rest form.
  const previous = previousPersistableData({ version: 1, settings: previousDefaults(), reminders: [], photoAsset: null });
  assertPreviousReaderAccepts('data', previous, 'synthetic previous-release state');
  await writeFile(join(directory, 'state.json'), JSON.stringify(previous, null, 2));
  const app = await application(directory);
  try {
    const steps: [string, () => Promise<unknown>][] = [
      ['brightness', () => app.send('PATCH', '/api/settings', { appearance: { brightness: 0.4, preset: 'custom' } })],
      ['clock style digital', () => app.send('PATCH', '/api/settings', { appearance: { clockStyle: 'digital' } })],
      ['widget move', () => app.send('PATCH', '/api/settings', { widgetGrid: { placements: { reminders: { column: 4, row: 4 } } } })],
      ['density change', async () => {
        const settings = app.store.snapshot().settings;
        const fit = fitGridDensity(settings.widgetGrid, 'fine', settings.widgets); assert.ok(fit);
        return app.send('PATCH', '/api/settings', { widgetGrid: { density: 'fine', placements: fit.grid.placements } });
      }],
      ['reminder lifecycle', async () => {
        const reminder = await app.send('POST', '/api/reminders', { text: 'Synthetic reminder', dueAt: null }) as { id: string };
        await assertFilesAccepted(directory, 'reminder added');
        await app.send('PATCH', `/api/reminders/${reminder.id}`, { completed: true });
        await assertFilesAccepted(directory, 'reminder completed');
        await app.send('POST', '/api/reminders', { text: 'Kept reminder' });
        await app.send('DELETE', `/api/reminders/${reminder.id}`);
      }],
      ['saved style', () => app.send('PATCH', '/api/settings', { savedPresets: [{ id: 'synthetic-style', name: 'Synthetic style', visual: getVisual(app.store.snapshot().settings) }] })],
      ['photo', () => app.send('PATCH', '/api/settings', { photoChange: { pngBase64: photoFixture().toString('base64') } })],
    ];
    for (const [label, step] of steps) {
      await step();
      await assertFilesAccepted(directory, label);
    }
    const settings = app.store.snapshot().settings;
    assert.equal(settings.appearance.clockStyle, 'digital');
    assert.equal(settings.widgetGrid.density, 'fine');
    assert.equal(settings.savedPresets.length, 1);
    assert.equal(app.store.snapshot().reminders.length, 1);
    assert.ok(app.store.snapshot().photoAsset);
    // (c) The export after those saves imports into the previous release.
    assertPreviousReaderAccepts('import', await app.send('GET', '/api/export'), 'export after saves');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('(d) a revision-one legacy file stays readable after it is opened and saved', async () => {
  const directory = await temporary('lrd-rollback-legacy-');
  try {
    // Built from the bedca44 fixture: a pre-#78 file with the revision-one grid.
    const settings = JSON.parse(JSON.stringify(legacyDefaults()));
    settings.widgetGrid = legacyGrid(1); delete settings.widgetGrid.revision;
    delete settings.widgetBehavior; delete settings.appearance.clockStyle; delete settings.locationSource;
    await writeFile(join(directory, 'state.json'), JSON.stringify({ version: 1, settings, reminders: [] }));
    const store = await DataStore.open(directory);
    assert.equal(store.snapshot().settings.widgetGrid.revision, 2);
    await store.patchSettings({ units: 'imperial' });
    await assertFilesAccepted(directory, 'legacy after save');
    const reopened = (await DataStore.open(directory)).snapshot().settings;
    assert.equal(reopened.units, 'imperial');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const event = (title: string, date: string) => ({ id: randomUUID(), title, date, repeatsYearly: false });
const city = (label: string) => ({ id: randomUUID(), label, timezone: 'Asia/Tokyo', latitude: 35.68, longitude: 139.69 });
const withStyle = (settings: Settings, edit: (visual: Settings) => Settings): SettingsPatch => ({ savedPresets: [{ id: 'synthetic-style', name: 'Synthetic style', visual: getVisual(edit(structuredClone(settings))) }] });
const styleOf = (file: Loose) => file.settings.savedPresets[0]?.visual as Loose | undefined;

/**
 * Every choice the bedca44 reader rejected (the former rollback exceptions in docs/install.md); 3fee844
 * and 3446400 know each key. `written` proves the file or export actually carries the choice, so an
 * accepted file is never accepted only because the choice was left out.
 */
const FORMER_EXCEPTIONS: [string, (settings: Settings) => SettingsPatch, (file: Loose) => boolean][] = [
  ['#73 custom Reminders size', () => ({ widgetGrid: { placements: { reminders: { span: { columns: 3, rows: 2 } } } } }),
    file => file.settings.widgetGrid.placements.reminders.span?.columns === 3],
  ['#73 custom size in a saved style', settings => withStyle(settings, visual => { visual.widgetGrid.placements.reminders = { ...visual.widgetGrid.placements.reminders, span: { columns: 3, rows: 2 } }; return visual; }),
    file => styleOf(file)?.widgetGrid.placements.reminders.span?.columns === 3],
  ['#75 Native in settings', () => ({ appearance: { accentMode: 'native', preset: 'custom' } }), file => file.settings.appearance.accentMode === 'native'],
  ['#75 a built-in style', settings => settingsChanges(settings, applyBuiltinPreset(settings, 'night')), file => file.settings.appearance.accentMode === 'native'],
  // The editor's Reset appearance (#234, #321), not the Room style it resembles.
  ['#75 Reset appearance', settings => settingsChanges(settings, resetAppearance(settings)), file => file.settings.appearance.accentMode === 'native'],
  ['#75 a saved Native style', settings => withStyle(settings, visual => ({ ...visual, appearance: { ...visual.appearance, accentMode: 'native' } })),
    file => styleOf(file)?.appearance.accentMode === 'native'],
  ['#76 Animation Off', () => ({ appearance: { animation: 'off' } }), file => file.settings.appearance.animation === 'off'],
  ['#76 Animation Lively', () => ({ appearance: { animation: 'lively' } }), file => file.settings.appearance.animation === 'lively'],
  ['#76 Lively in a saved style', settings => withStyle(settings, visual => ({ ...visual, appearance: { ...visual.appearance, animation: 'lively' } })),
    file => styleOf(file)?.appearance.animation === 'lively'],
  ['#78 World clocks, Calendar, Countdown and Note enabled', () => ({ widgets: { worldClocks: true, calendar: true, countdown: true, note: true } }),
    file => ['worldClocks', 'calendar', 'countdown', 'note'].every(id => file.settings.widgets[id] === true)],
  ['#78 Sun & moon and Air quality enabled', () => ({ widgets: { sunMoon: true, airQuality: true } }),
    file => file.settings.widgets.sunMoon === true && file.settings.widgets.airQuality === true],
  ['#78 widgetData', () => ({ widgetData: { worldClocks: [city('Synthetic city')], calendar: { weekStart: 'monday' }, countdowns: [event('Synthetic', '2026-12-24')], note: { text: 'Synthetic note' }, airQuality: { scale: 'european' } } }),
    file => file.settings.widgetData?.note?.text === 'Synthetic note' && file.settings.widgetData.worldClocks?.length === 1 && file.settings.widgetData.countdowns?.length === 1 && file.settings.widgetData.calendar?.weekStart === 'monday' && file.settings.widgetData.airQuality?.scale === 'european'],
  ['#78 a saved style with Calendar on', settings => withStyle(settings, visual => ({ ...visual, widgets: { ...visual.widgets, calendar: true } })),
    file => styleOf(file)?.widgets.calendar === true],
];

test('(e) every former bedca44 exception is readable by the previous release in state.json, state.backup.json and the export', async () => {
  for (const [label, patchFor, written] of FORMER_EXCEPTIONS) {
    const directory = await temporary('lrd-rollback-former-'), target = await temporary('lrd-rollback-former-import-');
    // An existing user's colour-accent defaults, so every choice below is a change that the files must carry.
    await seedColorAccentData(directory); await seedColorAccentData(target);
    const app = await application(directory), imported = await application(target);
    try {
      await app.send('PATCH', '/api/settings', patchFor(app.store.snapshot().settings));
      const primary = await readJson(directory, 'state.json');
      assert.ok(written(primary), `${label}: state.json carries the choice`);
      await assertFilesAccepted(directory, label);
      const exported = await app.send('GET', '/api/export');
      assert.ok(written(exported), `${label}: the export carries the choice`);
      assertPreviousReaderAccepts('import', exported, `${label} export`);
      // One more save moves the choice into state.backup.json too.
      await app.send('PATCH', '/api/settings', { units: 'imperial' });
      const backup = await readJson(directory, 'state.backup.json');
      assert.ok(written(backup), `${label}: state.backup.json carries the choice after the next save`);
      await assertFilesAccepted(directory, `${label} after the next save`);
      // Importing the export writes files the previous release reads.
      await imported.send('POST', '/api/import', exported);
      assert.ok(written(await readJson(target, 'state.json')), `${label}: the imported state.json carries the choice`);
      await assertFilesAccepted(target, `${label} imported`);
    } finally {
      await app.close(); await imported.close();
      await rm(directory, { recursive: true, force: true }); await rm(target, { recursive: true, force: true });
    }
  }
});

test('#135 a non-identity transform for a #78 id, sent by PATCH or import, stays readable; no planned ids remain', async () => {
  // persistableSettings writes every transform of an id the previous release knows. Planned ids are the
  // case #135 guards against; revisit that rule (normalise or reject) before adding one.
  assert.deepEqual(WIDGET_IDS.filter(isPlannedWidget), [], 'the catalog has no planned ids');
  assert.deepEqual(WIDGET_IDS.filter(id => !(PREVIOUS_RELEASE.widgetIds as readonly string[]).includes(id)), [], 'the previous release knows every catalog id: a new id needs its non-identity transforms kept out of saved data (#135) or a documented exception');
  const directory = await temporary('lrd-rollback-135-'), target = await temporary('lrd-rollback-135-import-');
  await seedColorAccentData(directory); await seedColorAccentData(target);
  const app = await application(directory), imported = await application(target);
  try {
    await app.send('PATCH', '/api/settings', { widgetOverrides: { note: { offsetX: 5 } } });
    assert.deepEqual((await readJson(directory, 'state.json')).settings.widgetOverrides.note, { offsetX: 5, offsetY: 0, scale: 1 }, 'the transform is written');
    await assertFilesAccepted(directory, 'note transform');
    const visual = getVisual(app.store.snapshot().settings); visual.widgetOverrides.countdown = { offsetX: -3, offsetY: 2, scale: 1.1 };
    await app.send('PATCH', '/api/settings', { savedPresets: [{ id: 'transformed', name: 'Transformed', visual }] });
    const primary = await readJson(directory, 'state.json');
    assert.deepEqual(primary.settings.savedPresets[0].visual.widgetOverrides.countdown, { offsetX: -3, offsetY: 2, scale: 1.1 });
    assert.deepEqual((await readJson(directory, 'state.backup.json')).settings.widgetOverrides.note, { offsetX: 5, offsetY: 0, scale: 1 }, 'the backup carries the transform');
    await assertFilesAccepted(directory, 'saved style transform');
    const exported = await app.send('GET', '/api/export');
    assert.equal(exported.settings.widgetOverrides.note.offsetX, 5);
    assertPreviousReaderAccepts('import', exported, 'export with #78 transforms');
    await imported.send('POST', '/api/import', exported);
    assert.equal((await readJson(target, 'state.json')).settings.widgetOverrides.note.offsetX, 5);
    await assertFilesAccepted(target, 'imported #78 transforms');
  } finally {
    await app.close(); await imported.close();
    await rm(directory, { recursive: true, force: true }); await rm(target, { recursive: true, force: true });
  }
});
