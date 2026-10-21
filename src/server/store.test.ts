import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rename, utimes, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataStore, RENAME_RETRY_DELAYS_MS, STALE_TEMPORARY_FILE_MS, SettingsConflict } from './store.ts';
import { photoFixture } from './fixtures.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { catalogBoardDefaults } from './fixtures.ts';
import { gridProblem } from '../shared/widgets.ts';

test('reading legacy geometry preserves original state bytes and migrates every widget in memory before a normal save', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-grid-migration-'));
  try {
    // Legacy files hold the catalog board's widgets (the default before #435).
    const settings = catalogBoardDefaults(); delete settings.widgetGrid.revision;
    settings.widgetGrid.placements.clock = { column: 0, row: 0, size: 'large' };
    // A pre-#74 board: medium Weather and an enabled Rain, which Weather absorbs on read.
    settings.widgetGrid.placements.weather = { column: 8, row: 0, size: 'medium' }; settings.widgets.rain = true;
    settings.widgetGrid.placements.rain = { column: 0, row: 3, size: 'medium' };
    settings.widgetGrid.placements.reminders = { column: 5, row: 3, size: 'small' };
    settings.widgetGrid.placements.preview = { column: 8, row: 3, size: 'medium' };
    settings.widgetGrid.placements.forecast = { column: 2, row: 6, size: 'large' };
    const original = JSON.stringify({ version: 1, settings, reminders: [] });
    await writeFile(join(directory, 'state.json'), original);
    const store = await DataStore.open(directory), migrated = store.snapshot().settings;
    assert.equal(migrated.widgetGrid.revision, 2);
    assert.equal(gridProblem(migrated.widgetGrid, migrated.widgets), null);
    assert.deepEqual(migrated.widgets, { ...settings.widgets, rain: false });
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), original);
    await store.patchSettings({ clockFormat: '24h' });
    const reopened = (await DataStore.open(directory)).snapshot().settings;
    assert.equal(reopened.widgetGrid.revision, 2);
    assert.deepEqual(reopened.widgets, { ...settings.widgets, rain: false });
    assert.equal(gridProblem(reopened.widgetGrid, reopened.widgets), null);
    assert.equal(JSON.parse(await readFile(join(directory, 'state.backup.json'), 'utf8')).settings.widgetGrid.revision, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('new snapshot default preserves existing low/custom opacity and saved visual choices', async () => {
  assert.equal(defaultSettings().preview.opacity, 0.24);
  for (const opacity of [0.08, 0.17]) {
    const directory = await mkdtemp(join(tmpdir(), 'lrd-preview-settings-'));
    try {
      const settings = defaultSettings(); settings.preview.opacity = opacity;
      const { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } = structuredClone(settings);
      settings.savedPresets = [{ id: 'existing', name: 'Existing', visual: { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview: { ...preview, opacity: 0.06 } } }];
      await writeFile(join(directory, 'state.json'), JSON.stringify({ version: 1, settings, reminders: [] }));
      const store = await DataStore.open(directory);
      await store.patchSettings({ clockFormat: '24h' });
      const reloaded = (await DataStore.open(directory)).snapshot().settings;
      assert.equal(reloaded.preview.opacity, opacity);
      assert.equal(reloaded.savedPresets[0]!.visual.preview.opacity, 0.06);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('queued concurrent writes preserve changes and survive restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-store-'));
  try {
    const store = await DataStore.open(directory);
    await Promise.all([store.patchSettings({ units: 'imperial' }), store.patchSettings({ appearance: { fontScale: 1.3 } }), store.patchSettings({ location: { name: 'My city' } })]);
    const reopened = await DataStore.open(directory);
    assert.equal(reopened.snapshot().settings.units, 'imperial');
    assert.equal(reopened.snapshot().settings.appearance.fontScale, 1.3);
    assert.equal(reopened.snapshot().settings.location.name, 'My city');
    await assert.rejects(store.patchSettings({ appearance: { brightness: 8 } }));
    assert.equal(store.snapshot().settings.appearance.brightness, 0.55);
    await store.patchSettings({ clockFormat: '24h' });
    assert.equal(store.snapshot().settings.clockFormat, '24h', 'queue remains usable after failed mutation');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('legacy state without locationSource migrates to manual without replacing its city', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-location-migration-'));
  try {
    const settings: Partial<ReturnType<typeof defaultSettings>> = defaultSettings();
    delete settings.locationSource; settings.location = { name: 'Existing city', latitude: 1.25, longitude: 2.75, timezone: 'Asia/Tokyo' };
    await writeFile(join(directory, 'state.json'), JSON.stringify({ version: 1, settings, reminders: [] }));
    const store = await DataStore.open(directory);
    assert.equal(store.snapshot().settings.locationSource, 'manual'); assert.deepEqual(store.snapshot().settings.location, settings.location);
    await store.patchSettings({ units: 'imperial' });
    assert.equal((await DataStore.open(directory)).snapshot().settings.locationSource, 'manual');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('corrupt primary recovers the last valid backup without overwriting evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-recovery-'));
  try {
    const store = await DataStore.open(directory);
    await store.patchSettings({ units: 'imperial' });
    await store.patchSettings({ clockFormat: '24h' });
    await writeFile(join(directory, 'state.json'), 'broken');
    const recovered = await DataStore.open(directory);
    assert.equal(recovered.snapshot().settings.units, 'imperial');
    assert.equal(recovered.snapshot().settings.clockFormat, '12h');
    assert.match(recovered.warning!, /Recovered/);
    assert.equal(await readFile(join(directory, 'state.corrupt.json'), 'utf8'), 'broken');
    await rm(join(directory, 'state.json'));
    assert.equal((await DataStore.open(directory)).snapshot().settings.units, 'imperial', 'a missing primary also recovers the backup');
    await writeFile(join(directory, 'state.json'), 'broken again');
    await writeFile(join(directory, 'state.backup.json'), 'also broken');
    await assert.rejects(DataStore.open(directory), /Preserve the data folder/);
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), 'broken again');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('legacy settings and saved presets acquire hide-empty defaults without enabling disabled widgets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-widget-migration-'));
  try {
    const settings = JSON.parse(JSON.stringify(defaultSettings()));
    delete settings.widgetBehavior;
    settings.widgets.reminders = false;
    const { appearance, widgets, widgetOverrides, preview } = settings;
    settings.savedPresets = [{ id: 'legacy', name: 'Legacy', visual: { appearance, widgets, widgetOverrides, preview } }];
    await writeFile(join(directory, 'state.json'), JSON.stringify({ version: 1, settings, reminders: [] }));
    const store = await DataStore.open(directory);
    assert.equal(store.snapshot().settings.widgetBehavior.reminders.hideWhenEmpty, true);
    assert.equal(store.snapshot().settings.savedPresets[0].visual.widgetBehavior.reminders.hideWhenEmpty, true);
    assert.equal(store.snapshot().settings.widgets.reminders, false);
    await store.patchSettings({ widgetBehavior: { reminders: { hideWhenEmpty: false } } });
    await store.patchSettings({ widgetBehavior: { reminders: {} }, appearance: { brightness: 0.4 } });
    const reopened = (await DataStore.open(directory)).snapshot().settings;
    assert.equal(reopened.widgetBehavior.reminders.hideWhenEmpty, false, 'empty nested patch preserves override through restart');
    assert.equal(reopened.savedPresets[0].visual.widgetBehavior.reminders.hideWhenEmpty, true);
    assert.equal(reopened.widgets.reminders, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

/** A rename that fails with `code` for the first `failures` calls onto state.json, then renames normally. */
function heldStateFile(code: string, failures: number) {
  const calls: string[] = [];
  return {
    calls,
    async rename(from: string, to: string) {
      if (basename(to) === 'state.json') { calls.push(code); if (calls.length <= failures) throw Object.assign(new Error(`${code}: synthetic held state.json`), { code }); }
      await rename(from, to);
    },
  };
}
const temporaryFiles = async (directory: string) => (await readdir(directory)).filter(name => name.endsWith('.tmp'));

test('a save retries while another process briefly holds state.json (#247)', async () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const directory = await mkdtemp(join(tmpdir(), 'lrd-held-state-'));
    try {
      await DataStore.open(directory);
      const held = heldStateFile(code, 3); const store = await DataStore.open(directory, held);
      await store.patchSettings({ units: 'imperial' });
      assert.equal(held.calls.length, 4, `${code}: three failed renames, then success`);
      assert.equal((await DataStore.open(directory)).snapshot().settings.units, 'imperial', `${code}: the retried save is on disk`);
      assert.deepEqual(await temporaryFiles(directory), []);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('a save that still fails after about a second leaves no temporary copy and keeps the last save (#247)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-held-state-'));
  try {
    const first = await DataStore.open(directory); await first.patchSettings({ clockFormat: '24h' });
    const before = await readFile(join(directory, 'state.json'), 'utf8');
    const held = heldStateFile('EBUSY', Infinity); const store = await DataStore.open(directory, held);
    const started = performance.now();
    await assert.rejects(store.patchSettings({ units: 'imperial' }), /EBUSY/);
    const elapsed = performance.now() - started;
    assert.equal(held.calls.length, RENAME_RETRY_DELAYS_MS.length + 1, 'every retry was attempted');
    assert.ok(elapsed >= 900 && elapsed < 5_000, `retries last about a second: ${Math.round(elapsed)} ms`);
    assert.deepEqual(await temporaryFiles(directory), [], 'the private state is not left behind in a .tmp file');
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), before, 'state.json keeps the last successful save');
    assert.equal(JSON.parse(await readFile(join(directory, 'state.backup.json'), 'utf8')).settings.clockFormat, '24h', 'the backup holds that same save');
    assert.equal(store.snapshot().settings.units, 'metric', 'memory is unchanged by the failed save');
    // A different error is not retried.
    const denied = { calls: 0, async rename() { denied.calls++; throw Object.assign(new Error('EXDEV: synthetic'), { code: 'EXDEV' }); } };
    const other = await DataStore.open(directory, denied);
    await assert.rejects(other.patchSettings({ units: 'imperial' }), /EXDEV/);
    assert.equal(denied.calls, 1); assert.deepEqual(await temporaryFiles(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

/** Dates a file's mtime `ms` before (or, negative, after) now. */
async function age(path: string, ms: number) { const time = new Date(Date.now() - ms); await utimes(path, time, time); }

test('startup removes temporary files left by an interrupted save, and nothing else (#247, #320)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-stale-temp-'));
  try {
    await DataStore.open(directory);
    const stale = [`state.json.${randomUUID()}.tmp`, `state.backup.json.${randomUUID()}.tmp`, `state.json.${randomUUID()}.tmp`];
    const recent = [`state.json.${randomUUID()}.tmp`, `state.backup.json.${randomUUID()}.tmp`];
    const kept = ['state.json.tmp', 'notes.tmp', `other.json.${randomUUID()}.tmp`];
    for (const name of [...stale, ...recent, ...kept]) await writeFile(join(directory, name), '{"private":"synthetic"}');
    await age(join(directory, stale[0]!), STALE_TEMPORARY_FILE_MS + 1000);
    await age(join(directory, stale[1]!), 24 * 3600_000);
    await age(join(directory, stale[2]!), -(STALE_TEMPORARY_FILE_MS + 1000)); // dated ahead by a clock that went back
    for (const name of kept) await age(join(directory, name), 24 * 3600_000);
    await DataStore.open(directory);
    const names = await readdir(directory);
    for (const name of stale) assert.equal(names.includes(name), false, `${name} is removed`);
    for (const name of recent) assert.equal(names.includes(name), true, `${name} may be a save in progress in another process and stays (#320)`);
    for (const name of kept) assert.equal(names.includes(name), true, `${name} is not ours and stays`);
    // The next start after the minute has passed removes them too.
    for (const name of recent) await age(join(directory, name), STALE_TEMPORARY_FILE_MS + 1000);
    await DataStore.open(directory);
    assert.deepEqual((await readdir(directory)).filter(name => recent.includes(name)), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a second store opened on the same folder during a save leaves that save intact (#320)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-second-store-'));
  try {
    await DataStore.open(directory);
    // Store A's rename onto state.json waits, as a held file does during its retries, until B has opened.
    let renameStarted!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { renameStarted = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const a = await DataStore.open(directory, {
      async rename(from, to) {
        if (basename(to) === 'state.json') { renameStarted(); await released; }
        await rename(from, to);
      },
    });
    const saving = a.patchSettings({ units: 'imperial' });
    await started;
    assert.equal((await temporaryFiles(directory)).length, 1, 'A holds one temporary file while it renames');
    await DataStore.open(directory);
    assert.equal((await temporaryFiles(directory)).length, 1, "B leaves A's recent temporary file alone");
    release();
    await saving;
    assert.equal((await DataStore.open(directory)).snapshot().settings.units, 'imperial', "A's save succeeded");
    assert.deepEqual(await temporaryFiles(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a save that fails on a held state.backup.json keeps the last save in state.json and the one before in the backup (#325)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-held-backup-'));
  try {
    const first = await DataStore.open(directory);
    await first.patchSettings({ clockFormat: '24h' }); // save A
    await first.patchSettings({ units: 'imperial' }); // save B
    const held = { calls: 0, async rename(from: string, to: string) {
      if (basename(to) === 'state.backup.json') { held.calls++; throw Object.assign(new Error('EBUSY: synthetic held state.backup.json'), { code: 'EBUSY' }); }
      await rename(from, to);
    } };
    const store = await DataStore.open(directory, held);
    await assert.rejects(store.patchSettings({ appearance: { fontScale: 1.3 } }), /EBUSY/); // save C fails
    assert.equal(held.calls, RENAME_RETRY_DELAYS_MS.length + 1, 'the backup rename was retried, then the save failed');
    const primary = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')), backup = JSON.parse(await readFile(join(directory, 'state.backup.json'), 'utf8'));
    assert.deepEqual([primary.settings.units, primary.settings.clockFormat], ['imperial', '24h'], 'state.json holds the last successful save (B)');
    assert.deepEqual([backup.settings.units, backup.settings.clockFormat], ['metric', '24h'], 'the backup keeps the save before it (A)');
    assert.equal(primary.settings.appearance.fontScale, 1, 'the failed save wrote nothing');
    assert.deepEqual(await temporaryFiles(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the store view and photo image never copy the photo bytes per request (#353)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-store-view-'));
  try {
    const store = await DataStore.open(directory);
    const png = photoFixture(4, 4);
    await store.patchSettings({ photoChange: { pngBase64: png.toString('base64') } });
    const realClone = globalThis.structuredClone;
    const cloned: unknown[] = [];
    globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => { cloned.push(value); return realClone(value, options); }) as typeof structuredClone;
    let view: ReturnType<DataStore['view']>, first: ReturnType<DataStore['photoImage']>, second: ReturnType<DataStore['photoImage']>;
    try { view = store.view(); first = store.photoImage(); second = store.photoImage(); } finally { globalThis.structuredClone = realClone; }
    assert.ok(!cloned.some(value => JSON.stringify(value).includes(png.toString('base64'))), 'nothing holding the photo bytes was cloned');
    assert.equal(JSON.stringify(view).includes(png.toString('base64')), false);
    assert.deepEqual(Object.keys(view.photo!).sort(), ['height', 'id', 'updatedAt', 'width']);
    assert.equal(view.photo!.id, store.snapshot().photoAsset!.id);
    assert.deepEqual(first!.content, png);
    assert.equal(second, first, 'the decoded image is shared until the photo changes');
    const replacement = photoFixture(2, 2);
    await store.patchSettings({ photoChange: { pngBase64: replacement.toString('base64') } });
    const changed = store.photoImage();
    assert.notEqual(changed!.id, first!.id); assert.deepEqual(changed!.content, replacement);
    await store.patchSettings({ photoChange: null });
    assert.equal(store.photoImage(), null); assert.equal(store.view().photo, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the settings revision changes only when settings change, lives in memory and refuses a stale patch (#287)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-store-revision-'));
  try {
    const store = await DataStore.open(directory);
    const start = store.settingsRevision;
    assert.match(start, /^[0-9a-f]{12}-0$/);
    await store.update(data => { data.reminders.push({ id: randomUUID(), text: 'Synthetic', completed: false, dueAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); });
    assert.equal(store.settingsRevision, start, 'a reminder write is not a settings change');
    await store.patchSettings({ units: 'metric' });
    assert.equal(store.settingsRevision, start, 'a patch that changes nothing keeps the revision');
    const saved = await store.commitSettings({ units: 'imperial' }, Date.now(), [start]);
    assert.notEqual(saved.settingsRevision, start); assert.equal(saved.settingsRevision, store.settingsRevision);
    const stale = await store.commitSettings({ clockFormat: '24h' }, Date.now(), [start]).catch((error: unknown) => error);
    assert.ok(stale instanceof SettingsConflict, 'a patch from the old revision is refused');
    assert.equal(stale.settingsRevision, saved.settingsRevision); assert.equal(stale.settings.units, 'imperial');
    assert.equal(store.snapshot().settings.clockFormat, '12h', 'and writes nothing');
    // Two patches from the same revision: the serialized write lets exactly one through.
    const current = store.settingsRevision;
    const results = await Promise.allSettled([store.commitSettings({ clockFormat: '24h' }, Date.now(), [current]), store.commitSettings({ appearance: { fontScale: 1.2 } }, Date.now(), [current])]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
    assert.ok((results[1] as PromiseRejectedResult).reason instanceof SettingsConflict);
    assert.equal(store.snapshot().settings.appearance.fontScale, 1);
    const files = [await readFile(join(directory, 'state.json'), 'utf8'), await readFile(join(directory, 'state.backup.json'), 'utf8')];
    for (const file of files) assert.equal(file.includes(store.settingsRevision.split('-')[0]!), false, 'the revision is not persisted');
    const reopened = await DataStore.open(directory);
    assert.notEqual(reopened.settingsRevision.split('-')[0], store.settingsRevision.split('-')[0], 'a restart starts a new boot id');
    await assert.rejects(reopened.commitSettings({ units: 'metric' }, Date.now(), [store.settingsRevision]), SettingsConflict);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
