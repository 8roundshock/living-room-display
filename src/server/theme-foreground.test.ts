import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings } from '../shared/defaults.ts';
import { settingsSchema, settingsPatchSchema, mergeSettings, importSchema } from './validation.ts';
import { persistableSettings } from './persistence.ts';
import { DataStore } from './store.ts';
import { getVisual } from '../client/model.ts';
import { assertPreviousReaderAccepts, assertPreviousReaderRejects } from './compat/previous-reader.ts';

test('Foreground is absent by default, false normalizes to omission, and unrelated patches insert no key', () => {
  const settings = defaultSettings(), baseline = structuredClone(settings);
  assert.equal(Object.hasOwn(settings.appearance.theme, 'foreground'), false);
  assert.deepEqual(settingsSchema.parse(settings), baseline, 'no new normalized default changes an upgraded API response');
  const falseInput = { ...settings, appearance: { ...settings.appearance, theme: { ...settings.appearance.theme, foreground: false } } };
  assert.deepEqual(settingsSchema.parse(falseInput), baseline);
  assert.deepEqual(settingsPatchSchema.parse({ appearance: { brightness: .26 } }), { appearance: { brightness: .26 } });
  assert.deepEqual(persistableSettings(settingsSchema.parse(falseInput)), persistableSettings(baseline));
  for (const value of [null, 'true', 1, {}]) assert.equal(settingsPatchSchema.safeParse({ appearance: { theme: { ...settings.appearance.theme, foreground: value } } }).success, false);
});

test('Foreground stays with a saved visual while birthdays remain global and default omission stays compatible', () => {
  const settings = defaultSettings();
  settings.appearance.theme = { mode: 'seasonal', calendars: [], foreground: true };
  settings.savedPresets = [{ id: 'foreground-style', name: 'Scene style', visual: getVisual(settings) }];
  const parsed = settingsSchema.parse(settings), persisted = persistableSettings(parsed) as any;
  assert.equal(persisted.appearance.theme.foreground, true);
  assert.equal(persisted.savedPresets[0].visual.appearance.theme.foreground, true);
  assert.equal('birthdays' in persisted.savedPresets[0].visual, false);
  assertPreviousReaderRejects('data', { version: 1, settings: persisted, reminders: [], photoAsset: null }, 'foreground opt-in is an additive rollback exception');
  const oldDefault = { version: 1, settings: persistableSettings(defaultSettings()), reminders: [], photoAsset: null };
  assertPreviousReaderAccepts('data', oldDefault, 'foreground default adds no persisted field');
  assert.equal(mergeSettings(parsed, { clockFormat: '24h' }).appearance.theme.foreground, true);
  assert.equal(mergeSettings(parsed, { appearance: { theme: { mode: 'seasonal', calendars: [] } } }).appearance.theme.foreground, undefined);
});

test('Foreground opt-in survives store restart/export and clearing returns default storage without resetting other fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-foreground-'));
  try {
    const store = await DataStore.open(directory);
    await store.patchSettings({ appearance: { theme: { mode: 'combined', calendars: ['CA'], foreground: true }, brightness: .26 } });
    assert.equal((await DataStore.open(directory)).snapshot().settings.appearance.theme.foreground, true);
    const exported = { version: 1, exportedAt: new Date().toISOString(), settings: persistableSettings(store.snapshot().settings), reminders: [] };
    assert.equal(importSchema.parse(exported).settings.appearance.theme.foreground, true);
    await store.patchSettings({ appearance: { theme: { mode: 'off', calendars: ['CA', 'KR', 'RU'], foreground: false } } });
    const current = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
    assert.equal('theme' in current.settings.appearance, false);
    assert.equal(store.snapshot().settings.appearance.brightness, .26);
    assert.equal('foreground' in store.snapshot().settings.appearance.theme, false);
    assertPreviousReaderAccepts('data', current, 'clearing the opt-in restores current-file compatibility');
    const backup = JSON.parse(await readFile(join(directory, 'state.backup.json'), 'utf8'));
    assert.equal(backup.settings.appearance.theme.foreground, true, 'the previous populated backup remains an explicit exception');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
