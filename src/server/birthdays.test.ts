// Private birthday content: synthetic names/dates and isolated temporary stores only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';
import { DataStore, SettingsConflict } from './store.ts';
import { dataSchema, importSchema, mergeSettings, settingsPatchSchema, settingsSchema } from './validation.ts';
import { persistableSettings } from './persistence.ts';
import { assertPreviousReaderAccepts, assertPreviousReaderRejects } from './compat/previous-reader.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { BIRTHDAY_LIMIT, type BirthdayEntry } from '../shared/birthdays.ts';
import { scheduledSettings } from '../shared/schedule.ts';
import { applyBuiltinPreset, getVisual, resetAppearance, resetLayout } from '../client/model.ts';

const first: BirthdayEntry = { id: '00000000-0000-4000-8000-000000000001', name: 'Birthday A', date: '01-10', treatment: 'classic' };
const second: BirthdayEntry = { id: '00000000-0000-4000-8000-000000000002', name: 'Birthday B', date: '06-12', treatment: 'korean' };
const wrap = (settings: unknown) => ({ version: 1, settings, reminders: [], photoAsset: null });
const readData = async (directory: string, name = 'state.json') => JSON.parse(await readFile(join(directory, name), 'utf8'));
async function application(directory: string) {
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const send = (method: string, path: string, value?: unknown, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${address.port}${path}`, {
    method, headers: { ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  return { ...app, send, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); } };
}

test('birthdays normalize missing data to an independent empty list and patches never insert defaults', () => {
  const original = defaultSettings();
  assert.deepEqual(original.birthdays, []);
  const legacy = persistableSettings(original);
  assert.equal('birthdays' in legacy, false);
  const firstRead = settingsSchema.parse(legacy), secondRead = settingsSchema.parse(legacy);
  firstRead.birthdays.push(first);
  assert.deepEqual(secondRead.birthdays, []);
  assert.deepEqual(original.birthdays, []);
  assert.deepEqual(settingsPatchSchema.parse({}), {});
  assert.deepEqual(settingsPatchSchema.parse({ birthdays: [] }), { birthdays: [] });
  assert.deepEqual(mergeSettings(mergeSettings(original, { birthdays: [first] }), { clockFormat: '24h' }).birthdays, [first]);
  assert.deepEqual(mergeSettings(mergeSettings(original, { birthdays: [first] }), { birthdays: [second] }).birthdays, [second], 'arrays replace whole');
});

test('birthday validation accepts bounded annual content and rejects malformed, duplicate or private extra fields', () => {
  const maximum = Array.from({ length: BIRTHDAY_LIMIT }, (_, index) => ({ ...first, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }));
  assert.equal(settingsPatchSchema.safeParse({ birthdays: maximum }).success, true);
  const trimmed = settingsPatchSchema.parse({ birthdays: [{ ...first, name: `  ${'A'.repeat(60)}  `, date: '02-29', treatment: 'russian' }] });
  assert.equal(trimmed.birthdays![0]!.name, 'A'.repeat(60));
  for (const [label, entries] of [
    ['empty name', [{ ...first, name: '  ' }]], ['long name', [{ ...first, name: 'A'.repeat(61) }]],
    ['not a UUID', [{ ...first, id: 'birthday-a' }]], ['duplicate UUID', [first, { ...second, id: first.id }]],
    ['too many', [...maximum, { ...second, id: '00000000-0000-4000-8000-000000000025' }]], ['bad month', [{ ...first, date: '13-10' }]],
    ['bad day', [{ ...first, date: '04-31' }]], ['February30', [{ ...first, date: '02-30' }]],
    ['un-padded date', [{ ...first, date: '1-10' }]], ['year included', [{ ...first, date: '2026-01-10' }]],
    ['trailing newline', [{ ...first, date: '01-10\n' }]], ['unknown treatment', [{ ...first, treatment: 'automatic' }]],
    ['birth year', [{ ...first, year: 2000 }]], ['age', [{ ...first, age: 26 }]],
    ['missing treatment', [{ id: first.id, name: first.name, date: first.date }]], ['null list', null],
  ] as const) {
    assert.equal(settingsPatchSchema.safeParse({ birthdays: entries }).success, false, label);
    assert.equal(settingsSchema.safeParse({ ...defaultSettings(), birthdays: entries }).success, false, `${label}: full settings`);
  }
});

test('birthday API saves, exports, restores and clears private entries with honest rollback boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-birthdays-api-'));
  const app = await application(directory);
  try {
    const initial = await (await app.send('GET', '/api/state')).json();
    assert.deepEqual(initial.settings.birthdays, []);
    assertPreviousReaderAccepts('data', await readData(directory), 'empty birthdays omitted in state');
    assertPreviousReaderAccepts('import', await (await app.send('GET', '/api/export')).json(), 'empty birthday export');
    const response = await app.send('PATCH', '/api/settings', { birthdays: [{ ...first, name: '  Birthday A  ' }, second] });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual((await response.json()).birthdays, [first, second]);
    assert.deepEqual(app.store.snapshot().settings.birthdays, [first, second]);
    assertPreviousReaderAccepts('data', await readData(directory, 'state.backup.json'), 'backup before first birthday save');
    assert.equal((await app.send('PATCH', '/api/settings', { clockFormat: '24h' })).status, 200);
    for (const name of ['state.json', 'state.backup.json']) {
      const written = await readData(directory, name);
      assert.deepEqual(written.settings.birthdays, [first, second], name);
      assert.deepEqual(dataSchema.parse(written).settings.birthdays, [first, second]);
      assertPreviousReaderRejects('data', written, `${name}: nonempty birthdays are an explicit older-reader exception`);
    }
    const exported = await (await app.send('GET', '/api/export')).json();
    assert.deepEqual(exported.settings.birthdays, [first, second], 'explicit private backup includes the entries');
    assert.deepEqual(importSchema.parse(exported).settings.birthdays, [first, second]);
    assertPreviousReaderRejects('import', exported, 'nonempty private birthday export');
    assert.deepEqual((await DataStore.open(directory)).snapshot().settings.birthdays, [first, second], 'entries survive a store restart');
    assert.equal((await app.send('PATCH', '/api/settings', { birthdays: [] })).status, 200);
    const cleared = await readData(directory);
    assert.equal('birthdays' in cleared.settings, false);
    assertPreviousReaderAccepts('data', cleared, 'clearing birthdays restores current file compatibility');
    assertPreviousReaderAccepts('import', await (await app.send('GET', '/api/export')).json(), 'cleared export');
    assertPreviousReaderRejects('data', await readData(directory, 'state.backup.json'), 'the previous-save backup still contains birthdays');
    assert.equal((await app.send('POST', '/api/import', exported)).status, 200);
    assert.deepEqual(app.store.snapshot().settings.birthdays, [first, second], 'explicit restore reinstates private entries');
    const legacyExport = structuredClone(exported); delete legacyExport.settings.birthdays;
    assert.equal((await app.send('POST', '/api/import', legacyExport)).status, 200);
    assert.deepEqual(app.store.snapshot().settings.birthdays, [], 'restoring an old backup normalizes the absent field');
    assert.equal((await app.send('PATCH', '/api/settings', { units: 'imperial' })).status, 200);
    const emptyBackup = await readData(directory, 'state.backup.json');
    assert.equal('birthdays' in emptyBackup.settings, false);
    assertPreviousReaderAccepts('data', emptyBackup, 'a following save also makes the backup readable by the old release');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('invalid and stale birthday writes preserve saved entries, primary bytes and backup bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-birthdays-guard-'));
  const app = await application(directory);
  try {
    const saved = await app.send('PATCH', '/api/settings', { birthdays: [first] });
    assert.equal(saved.status, 200);
    const oldRevision = saved.headers.get('etag')!;
    assert.equal((await app.send('PATCH', '/api/settings', { birthdays: [first, second] }, { 'If-Match': oldRevision })).status, 200);
    const bytes = async () => Promise.all(['state.json', 'state.backup.json'].map(name => readFile(join(directory, name), 'utf8')));
    const before = await bytes();
    const stale = await app.send('PATCH', '/api/settings', { birthdays: [] }, { 'If-Match': oldRevision });
    assert.equal(stale.status, 409);
    assert.deepEqual((await stale.json()).settings.birthdays, [first, second]);
    const invalid = { ...first, date: '04-31' };
    assert.equal((await app.send('PATCH', '/api/settings', { birthdays: [invalid] })).status, 400);
    const exported = await (await app.send('GET', '/api/export')).json(); exported.settings.birthdays = [invalid];
    assert.equal((await app.send('POST', '/api/import', exported)).status, 400);
    assert.deepEqual(app.store.snapshot().settings.birthdays, [first, second]);
    assert.deepEqual(await bytes(), before, 'rejected operations do not rewrite either file');
    await assert.rejects(app.store.commitSettings({ birthdays: [] }, Date.now(), ['stale']), SettingsConflict);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('birthday content recovers from the previous valid save and persistence never mutates normalized settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-birthdays-recovery-'));
  try {
    const store = await DataStore.open(directory);
    await store.patchSettings({ birthdays: [first, second] });
    await store.patchSettings({ clockFormat: '24h' });
    const settings = store.snapshot().settings, original = structuredClone(settings);
    assert.deepEqual((persistableSettings(settings) as { birthdays: BirthdayEntry[] }).birthdays, [first, second]);
    assert.deepEqual(settings, original);
    await writeFile(join(directory, 'state.json'), 'synthetic invalid state');
    const recovered = await DataStore.open(directory);
    assert.match(recovered.warning!, /Recovered the previous saved state/);
    assert.deepEqual(recovered.snapshot().settings.birthdays, [first, second]);
    assert.deepEqual((await readData(directory)).settings.birthdays, [first, second]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('birthday content stays global across styles and schedule changes and never enters a saved visual', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-birthdays-styles-'));
  const app = await application(directory);
  try {
    const settings = mergeSettings(defaultSettings(), { birthdays: [first, second] });
    const visual = getVisual(settings); visual.appearance.brightness = 0.25;
    assert.equal('birthdays' in visual, false);
    const preset = { id: 'birthday-test-style', name: 'Synthetic dim style', visual };
    assert.equal((await app.send('PATCH', '/api/settings', { birthdays: settings.birthdays, savedPresets: [preset] })).status, 200);
    for (const changed of [applyBuiltinPreset(settings, 'night'), resetAppearance(settings), resetLayout(settings), mergeSettings(settings, visual)]) {
      assert.deepEqual(changed.birthdays, [first, second]);
    }
    const badPreset = { ...preset, visual: { ...visual, birthdays: [first] } };
    assert.equal(settingsPatchSchema.safeParse({ savedPresets: [badPreset] }).success, false, 'private entries cannot be smuggled into a style');
    const schedule = { enabled: true, fallbackPresetId: preset.id, rules: [] };
    assert.equal((await app.send('PUT', '/api/schedule', schedule)).status, 200);
    const state = await (await app.send('GET', '/api/state')).json();
    const effective = scheduledSettings(state.settings, state.schedule);
    assert.equal(state.schedule.selection.source, 'fallback');
    assert.equal(effective.appearance.brightness, 0.25);
    assert.deepEqual(effective.birthdays, [first, second]);
    assert.equal('birthdays' in state.schedule.visual, false);
    const scheduleExport = await (await app.send('GET', '/api/schedule/export')).json();
    assert.equal(JSON.stringify(scheduleExport).includes('Birthday A'), false);
    assert.equal((await app.send('POST', '/api/schedule/import', scheduleExport)).status, 200);
    assert.deepEqual(app.store.snapshot().settings.birthdays, [first, second]);
    assert.equal((await app.send('PATCH', '/api/settings', { ...visual, savedPresets: [] })).status, 200);
    assert.deepEqual(app.store.snapshot().settings.birthdays, [first, second], 'applying or deleting a style keeps global birthdays');
    const exported = await (await app.send('GET', '/api/export')).json();
    assert.deepEqual(exported.settings.birthdays, [first, second]);
    assert.equal(exported.settings.savedPresets.length, 0);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
