// Rollback compatibility (#84): data written by this build must still parse with the frozen reader of
// the previous installed release (d66832b since #497). Synthetic data in temporary folders only.
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
import { AT_REST, DEFAULT_SECTIONS_AT_REST, PREVIOUS_RELEASE, persistableData } from './persistence.ts';
import {
  LEGACY_FIXTURE, LEGACY_FIXTURE_BLOBS, PREVIOUS_READER, VENDORED_BLOBS, assertPreviousReaderAccepts, assertPreviousReaderRejects,
} from './compat/previous-reader.ts';
import { defaultSettings as previousDefaults } from './compat/d66832b/shared/defaults.ts';
import { AT_REST as PREVIOUS_AT_REST, persistableData as previousPersistableData } from './compat/d66832b/server/persistence.ts';
import { WIDGET_CATALOG as PREVIOUS_CATALOG } from './compat/d66832b/shared/widgets.ts';
import { defaultSettings as legacyDefaults } from './compat/bedca44/shared/defaults.ts';
import { WIDGET_CATALOG as LEGACY_CATALOG, defaultWidgetGrid as legacyGrid } from './compat/bedca44/shared/widgets.ts';
import { WIDGET_IDS, fitGridDensity, isPlannedWidget } from '../shared/widgets.ts';
import { applyBuiltinPreset, getVisual, resetAppearance, resetLayout } from '../client/model.ts';
import { settingsChanges } from '../client/draft.ts';
import type { Settings, SettingsPatch } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';

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
  // d66832b's validation.ts and its transitive imports, nothing else (#263, #367, #497).
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

const REQUIRED_OMISSIONS = { appearance: ['daylightBrightness', 'rearrange'], sections: ['screen'] } as const;

test('#272 known omitted values stay readable; new appearance keys and Dynamic require omission', () => {
  // Default data with every omitted value present: colour accent, Subtle and the default widgetData sections,
  // in settings and in a saved style. Decision (#272): keep the omission; nothing on disk changes format here.
  // Dynamic's default sources (#437) are the exception: d66832b rejects the section, so its omission is required.
  const settings = colorAccentDefaults();
  settings.savedPresets = [{ id: 'synthetic-style', name: 'Synthetic style', visual: getVisual(settings) }];
  const full = { version: 1 as const, settings, reminders: [], photoAsset: null };
  const atRest = persistableData(full).settings as Loose;
  // Not vacuous: the at-rest form really leaves these values out.
  for (const appearance of [atRest.appearance, atRest.savedPresets[0].visual.appearance]) {
    for (const key of Object.keys(AT_REST.appearance)) assert.equal(key in appearance, false, `${key} is omitted at rest`);
  }
  assert.equal('widgetData' in atRest, false, 'default widgetData is omitted at rest');
  for (const key of DEFAULT_SECTIONS_AT_REST) assert.equal(key in atRest, false, `default ${key} is omitted at rest`);
  assert.deepEqual([...DEFAULT_SECTIONS_AT_REST], [...REQUIRED_OMISSIONS.sections], 'every omitted section is listed with its reason');
  assertPreviousReaderAccepts('data', { ...full, settings: atRest }, 'the at-rest form');
  // Keys the previous release does not know (see the #439 test below) are left out here: their
  // omission is required, not optional, until the baseline knows them.
  assert.deepEqual(KNOWN_AT_REST, ['accentMode', 'animation']);
  assert.deepEqual(NEW_AT_REST, [...REQUIRED_OMISSIONS.appearance]);
  const written = JSON.parse(JSON.stringify(full)) as Loose;
  for (const appearance of [written.settings.appearance, written.settings.savedPresets[0].visual.appearance]) {
    for (const key of NEW_AT_REST) delete appearance[key];
    for (const key of KNOWN_AT_REST) assert.equal(appearance[key], AT_REST.appearance[key], `${key} is written`);
  }
  for (const key of REQUIRED_OMISSIONS.sections) delete written.settings[key];
  assert.deepEqual(written.settings.widgetData, colorAccentDefaults().widgetData, 'every default widgetData section is written');
  assertPreviousReaderRejects('data', written, 'the default Dynamic sources and the off Dynamic id written in state.json');
  // Required, not optional, for Dynamic (#437): its default sources, and its off visibility, transform and
  // hidden placement in settings and saved styles.
  delete written.settings.widgetData.dynamic;
  for (const visual of [written.settings, written.settings.savedPresets[0].visual]) {
    delete visual.widgets.dynamic; delete visual.widgetOverrides.dynamic; delete visual.widgetGrid.placements.dynamic;
  }
  assertPreviousReaderAccepts('data', written, 'every other omitted value written in state.json');
  const exported = { version: written.version, exportedAt: new Date(0).toISOString(), settings: written.settings, reminders: [] };
  assertPreviousReaderAccepts('import', exported, 'every omitted value written in an export');
  // #436: the omissions the previous release needs. Written out, even at their defaults, it rejects them.
  for (const key of REQUIRED_OMISSIONS.appearance) {
    const data = { ...full, settings: structuredClone(atRest) } as Loose;
    data.settings.appearance[key] = (full.settings.appearance as Loose)[key];
    assertPreviousReaderRejects('data', data, `appearance.${key} written at its default`);
  }
  for (const key of REQUIRED_OMISSIONS.sections) {
    const data = { ...full, settings: structuredClone(atRest) } as Loose;
    data.settings[key] = structuredClone(full.settings[key]);
    assertPreviousReaderRejects('data', data, `${key} written at its default`);
  }
});

test('#436 default data and exports stay readable: float, no swap and Keep the screen on are omitted at rest', async () => {
  const directory = await temporary('lrd-rollback-436-');
  // The owner's data has neither key: after the update it reads as float, no swap, keep awake, the saved interval.
  await seedColorAccentData(directory);
  const app = await application(directory);
  try {
    const settings = app.store.snapshot().settings;
    assert.equal(settings.appearance.rearrange, false); assert.deepEqual(settings.screen, { keepAwake: true });
    assert.equal(settings.appearance.motionEnabled, true);
    await app.send('PATCH', '/api/settings', { appearance: { motionIntervalSeconds: 30 } });
    const primary = await readJson(directory, 'state.json');
    assert.equal('rearrange' in primary.settings.appearance, false, 'Swap places off is omitted');
    assert.equal('screen' in primary.settings, false, 'Keep the screen on (the default) is omitted');
    await assertFilesAccepted(directory, '#436 defaults');
    const exported = await app.send('GET', '/api/export');
    assert.equal('screen' in exported.settings, false); assert.equal('rearrange' in exported.settings.appearance, false);
    assertPreviousReaderAccepts('import', exported, '#436 defaults export');
    // A saved style made now carries no screen section and no rearrange while off.
    await app.send('PATCH', '/api/settings', { savedPresets: [{ id: 'synthetic-style', name: 'Synthetic style', visual: getVisual(app.store.snapshot().settings) }] });
    const styled = await readJson(directory, 'state.json');
    assert.equal('rearrange' in styled.settings.savedPresets[0].visual.appearance, false);
    assert.equal('screen' in styled.settings.savedPresets[0].visual, false);
    await assertFilesAccepted(directory, '#436 saved style');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

/**
 * #436 documented rollback exceptions (docs/install.md): Swap places on and Keep the screen on off are
 * written, and the previous release rejects them until the user switches them back and saves.
 */
const EXCEPTIONS_436: [string, SettingsPatch, (file: Loose) => boolean, SettingsPatch][] = [
  ['#436 Swap places on', { appearance: { rearrange: true } }, file => file.settings.appearance.rearrange === true, { appearance: { rearrange: false } }],
  ['#436 Keep the screen on off', { screen: { keepAwake: false } }, file => file.settings.screen?.keepAwake === false, { screen: { keepAwake: true } }],
];

test('#436 Swap places on and Keep the screen on off are the documented exceptions; switching back and saving restores readability', async () => {
  for (const [label, patch, written, undo] of EXCEPTIONS_436) {
    const directory = await temporary('lrd-rollback-436-exception-');
    await seedColorAccentData(directory);
    const app = await application(directory);
    try {
      await app.send('PATCH', '/api/settings', patch);
      const primary = await readJson(directory, 'state.json');
      assert.ok(written(primary), `${label}: state.json carries the choice`);
      assertPreviousReaderRejects('data', primary, `${label} state.json`);
      const exported = await app.send('GET', '/api/export');
      assert.ok(written(exported), `${label}: the export carries the choice`);
      assertPreviousReaderRejects('import', exported, `${label} export`);
      // The documented way back: switch it back, Save, then roll back (the backup holds the prior save).
      await app.send('PATCH', '/api/settings', undo);
      assertPreviousReaderAccepts('data', await readJson(directory, 'state.json'), `${label} switched back`);
      await app.send('PATCH', '/api/settings', { units: 'imperial' });
      await assertFilesAccepted(directory, `${label} switched back and saved again`);
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  }
});

test('#439 Fixed brightness omits daylightBrightness at rest, which the previous release requires', () => {
  assert.ok(NEW_AT_REST.includes('daylightBrightness'), 'the previous release does not know the Follow daylight key');
  const settings = colorAccentDefaults();
  settings.savedPresets = [{ id: 'synthetic-style', name: 'Synthetic style', visual: getVisual(settings) }];
  const full = { version: 1 as const, settings, reminders: [], photoAsset: null };
  assert.equal(full.settings.appearance.daylightBrightness, null, 'Fixed in memory and in API responses');
  // Omit other additive defaults first so this rejection proves only the daylight key.
  const written = JSON.parse(JSON.stringify(persistableData(full))) as Loose;
  written.settings.appearance.daylightBrightness = null;
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
  // Exactly what the previous release (d66832b) writes for its defaults: its own at-rest form.
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
 * Every choice the bedca44 reader rejected (the former rollback exceptions in docs/install.md); every
 * baseline since 3fee844, d66832b included, knows each key. `written` proves the file or export actually carries the choice, so an
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

test('#435 Reset layout to the default board, and a saved style with it, stay readable and read as that board', async () => {
  const directory = await temporary('lrd-rollback-435-'), target = await temporary('lrd-rollback-435-import-');
  // An existing user's catalog board, so Reset layout is a real change in the files.
  await seedColorAccentData(directory); await seedColorAccentData(target);
  const app = await application(directory), imported = await application(target);
  try {
    const before = app.store.snapshot().settings;
    await app.send('PATCH', '/api/settings', settingsChanges(before, resetLayout(before)));
    await app.send('PATCH', '/api/settings', withStyle(app.store.snapshot().settings, visual => visual));
    await app.send('PATCH', '/api/settings', { units: 'imperial' });
    // Hidden placements are not effective, so the draft does not send them; compare the shown board.
    const board = defaultSettings(), shown = WIDGET_IDS.filter(id => board.widgets[id]);
    const shownBoard = (grid: Loose) => ({ revision: grid.revision, density: grid.density, placements: Object.fromEntries(shown.map(id => [id, grid.placements[id]])) });
    for (const name of ['state.json', 'state.backup.json']) {
      const file = await readJson(directory, name);
      assertPreviousReaderAccepts('data', file, `Reset layout ${name}`);
      const read = PREVIOUS_READER.dataSchema.parse(file) as Loose;
      for (const visual of [read.settings, read.settings.savedPresets[0].visual]) {
        assert.deepEqual(visual.widgets, Object.fromEntries(PREVIOUS_READER.widgetIds.map(id => [id, board.widgets[id]])), `${name}: the previous release shows the default board's widgets`);
        assert.deepEqual(shownBoard(visual.widgetGrid), shownBoard(board.widgetGrid), `${name}: in the default board's places and sizes`);
      }
    }
    const exported = await app.send('GET', '/api/export');
    assertPreviousReaderAccepts('import', exported, 'Reset layout export');
    await imported.send('POST', '/api/import', exported);
    await assertFilesAccepted(target, 'Reset layout imported');
    assert.deepEqual(shownBoard((await readJson(target, 'state.json')).settings.widgetGrid), shownBoard(board.widgetGrid));
  } finally {
    await app.close(); await imported.close();
    await rm(directory, { recursive: true, force: true }); await rm(target, { recursive: true, force: true });
  }
});

test('#135 a non-identity transform for a #78 id, sent by PATCH or import, stays readable; no planned ids remain', async () => {
  // persistableSettings writes every transform of an id the previous release knows, and never one for an id
  // it lacks (the #135 rule, #437: Dynamic). Planned ids are the case #135 guards against.
  assert.deepEqual(WIDGET_IDS.filter(isPlannedWidget), [], 'the catalog has no planned ids');
  assert.deepEqual(WIDGET_IDS.filter(id => !(PREVIOUS_RELEASE.widgetIds as readonly string[]).includes(id)), ['dynamic'], 'the ids the previous release lacks: their transforms are never written (#135), see the #437 test below');
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

test('#437 Dynamic: off, disabled again or only transformed stays readable; enabled, non-default sources or a style with it on are the documented exceptions', async () => {
  const directory = await temporary('lrd-rollback-437-'), target = await temporary('lrd-rollback-437-import-');
  await seedColorAccentData(directory); await seedColorAccentData(target);
  const app = await application(directory), imported = await application(target);
  try {
    // Accepted: a non-identity transform is never written (#135), from a PATCH or an import.
    await app.send('PATCH', '/api/settings', { widgetOverrides: { dynamic: { offsetX: 5, scale: 1.2 } } });
    assert.deepEqual(app.store.snapshot().settings.widgetOverrides.dynamic, { offsetX: 5, offsetY: 0, scale: 1.2 }, 'the store keeps it');
    assert.equal('dynamic' in (await readJson(directory, 'state.json')).settings.widgetOverrides, false, 'state.json leaves it out');
    await assertFilesAccepted(directory, 'Dynamic transform');
    const transformed = await app.send('GET', '/api/export');
    assert.equal('dynamic' in transformed.settings.widgetOverrides, false, 'the export leaves it out');
    assertPreviousReaderAccepts('import', transformed, 'export after a Dynamic transform');
    const handmade = structuredClone(transformed); handmade.settings.widgetOverrides.dynamic = { offsetX: -4, offsetY: 3, scale: 0.8 };
    await imported.send('POST', '/api/import', handmade);
    assert.equal('dynamic' in (await readJson(target, 'state.json')).settings.widgetOverrides, false, 'an imported transform is not written either');
    await assertFilesAccepted(target, 'imported Dynamic transform');

    // The documented exceptions: an enabled Dynamic, sources other than all on, a saved style made while it was on.
    await app.send('PATCH', '/api/settings', { widgets: { dynamic: true } });
    const enabled = await readJson(directory, 'state.json');
    assert.equal(enabled.settings.widgets.dynamic, true);
    assertPreviousReaderRejects('data', enabled, 'an enabled Dynamic in state.json');
    assertPreviousReaderRejects('import', await app.send('GET', '/api/export'), 'an enabled Dynamic in an export');
    await app.send('PATCH', '/api/settings', { savedPresets: [{ id: 'with-dynamic', name: 'With Dynamic', visual: getVisual(app.store.snapshot().settings) }] });
    await app.send('PATCH', '/api/settings', { widgets: { dynamic: false } });
    const styled = await readJson(directory, 'state.json');
    assert.equal(styled.settings.savedPresets[0].visual.widgets.dynamic, true, 'the style keeps Dynamic on');
    assert.equal('dynamic' in styled.settings.widgets, false, 'the board itself has Dynamic off, omitted');
    assertPreviousReaderRejects('data', styled, 'a saved style with Dynamic on');
    await app.send('PATCH', '/api/settings', { savedPresets: [] });
    await app.send('PATCH', '/api/settings', { widgetData: { dynamic: { air: false, personal: false } } });
    const sources = await readJson(directory, 'state.json');
    assert.deepEqual(sources.settings.widgetData.dynamic, { weather: true, alerts: true, air: false, sky: true, personal: false });
    assertPreviousReaderRejects('data', sources, 'non-default Dynamic sources');

    // Accepted again once the user follows the documented steps: all sources on, Dynamic off, no style with it, Save.
    await app.send('PATCH', '/api/settings', { widgetData: { dynamic: { air: true, personal: true } } });
    await app.send('PATCH', '/api/settings', { units: 'imperial' });
    const restored = await readJson(directory, 'state.json');
    assert.equal('widgetData' in restored.settings, false, 'the default sources are omitted at rest again');
    await assertFilesAccepted(directory, 'Dynamic enabled, then disabled and saved');
    assertPreviousReaderAccepts('import', await app.send('GET', '/api/export'), 'export after Dynamic was disabled');
  } finally {
    await app.close(); await imported.close();
    await rm(directory, { recursive: true, force: true }); await rm(target, { recursive: true, force: true });
  }
});

test('#438 Home day-to-day use writes nothing the previous release cannot read; timers stay in their own file', async () => {
  const directory = await temporary('lrd-rollback-home-'), target = await temporary('lrd-rollback-home-import-');
  await seedColorAccentData(directory); await seedColorAccentData(target);
  const app = await application(directory), imported = await application(target);
  try {
    // Reminders from Home's quick add and calendar, one checked off.
    const dentist = await app.send('POST', '/api/reminders', { text: 'Synthetic dentist', dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString() }) as { id: string };
    await app.send('POST', '/api/reminders', { text: 'Synthetic anytime', dueAt: null });
    await app.send('PATCH', `/api/reminders/${dentist.id}`, { completed: true });
    await assertFilesAccepted(directory, 'Home reminders');
    // Timers: one running, one paused.
    await app.send('POST', '/api/timers', { label: 'Synthetic pasta', durationMs: 600_000 });
    const paused = await app.send('POST', '/api/timers', { durationMs: 300_000 }) as { id: string };
    await app.send('PATCH', `/api/timers/${paused.id}`, { paused: true });
    // A countdown, a world clock, the note, and World clocks shown on the display from Home.
    await app.send('POST', '/api/countdowns', { title: 'Synthetic trip', date: '2027-03-14', repeatsYearly: true });
    await app.send('POST', '/api/world-clocks', { label: 'Synthetic city', timezone: 'Europe/London', latitude: 51.5, longitude: -0.1 });
    await app.send('PATCH', '/api/settings', { widgetData: { note: { text: 'Synthetic note' } } });
    await app.send('POST', '/api/widgets/worldClocks/show');
    await assertFilesAccepted(directory, 'Home day-to-day use');
    const primary = await readJson(directory, 'state.json');
    assert.equal(primary.settings.widgets.worldClocks, true, 'the shown widget is written');
    assert.equal(primary.settings.widgetData.countdowns.length, 1);
    assert.equal(primary.settings.widgetData.worldClocks.length, 1);
    const exported = await app.send('GET', '/api/export') as Loose;
    assertPreviousReaderAccepts('import', exported, 'export after Home use');
    const timersFile = await readJson(directory, 'timers.json');
    assert.equal(timersFile.timers.length, 2, 'timers.json holds both timers');
    for (const [name, value] of [['state.json', primary], ['state.backup.json', await readJson(directory, 'state.backup.json')], ['the export', exported]] as const) {
      const text = JSON.stringify(value);
      assert.equal(/timer/i.test(text), false, `${name} carries no timer data`);
      assert.equal(text.includes('Synthetic pasta'), false, `${name} carries no timer label`);
    }
    await imported.send('POST', '/api/import', exported);
    await assertFilesAccepted(target, 'imported after Home use');
  } finally {
    await app.close(); await imported.close();
    await rm(directory, { recursive: true, force: true }); await rm(target, { recursive: true, force: true });
  }
});

test('#438 the shapes Home avoided are still rejected by the previous release; a countdown through existing keys is accepted', () => {
  const valid = previousPersistableData({ version: 1, settings: previousDefaults(), reminders: [], photoAsset: null }) as Loose;
  const reminder = { id: randomUUID(), text: 'Synthetic', completed: false, dueAt: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
  const cases: [string, (data: Loose) => void][] = [
    ['a top-level timers key', data => { data.timers = []; }],
    ['widgetData.timers', data => { data.settings.widgetData = { timers: [] }; }],
    ['a timer widget id', data => { data.settings.widgets.timer = false; }],
    ['calendar reminder days', data => { data.settings.widgetData = { calendar: { weekStart: 'locale', reminderDays: true } }; }],
    ['an all-day reminder', data => { data.reminders = [{ ...reminder, allDay: true }]; }],
  ];
  for (const [label, edit] of cases) { const data = structuredClone(valid); edit(data); assertPreviousReaderRejects('data', data, label); }
  const countdown = structuredClone(valid);
  countdown.settings.widgets.countdown = true;
  countdown.settings.widgetData = { countdowns: [event('Synthetic', '2027-01-01')] };
  assertPreviousReaderAccepts('data', countdown, 'a countdown enabled through existing keys');
});
