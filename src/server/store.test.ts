import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataStore, RENAME_RETRY_DELAYS_MS } from './store.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { gridProblem } from '../shared/widgets.ts';

test('reading legacy geometry preserves original state bytes and migrates every widget in memory before a normal save', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-grid-migration-'));
  try {
    const settings = defaultSettings(); delete settings.widgetGrid.revision;
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

test('startup removes temporary files left by an interrupted save, and nothing else (#247)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-stale-temp-'));
  try {
    await DataStore.open(directory);
    const stale = [`state.json.${randomUUID()}.tmp`, `state.backup.json.${randomUUID()}.tmp`];
    const kept = ['state.json.tmp', 'notes.tmp', `other.json.${randomUUID()}.tmp`];
    for (const name of [...stale, ...kept]) await writeFile(join(directory, name), '{"private":"synthetic"}');
    await DataStore.open(directory);
    const names = await readdir(directory);
    for (const name of stale) assert.equal(names.includes(name), false, `${name} is removed`);
    for (const name of kept) assert.equal(names.includes(name), true, `${name} is not ours and stays`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
