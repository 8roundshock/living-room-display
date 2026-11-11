import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings } from '../shared/defaults.ts';
import { themeTransparency, TRANSPARENCY, withTransparency, type ThemeSettings } from '../shared/themes.ts';
import { importSchema, mergeSettings, settingsPatchSchema, settingsSchema } from './validation.ts';
import { persistableData, persistableSettings } from './persistence.ts';
import { DataStore } from './store.ts';
import { sameEffectiveSettings, settingsChanges } from '../client/draft.ts';
import { getVisual } from '../client/model.ts';
import { assertPreviousReaderAccepts, assertPreviousReaderRejects } from './compat/previous-reader.ts';

// #670: appearance.theme.transparency, an optional whole number 0-100. Absent means the standard 50,
// today's look; only another value is stored, and nothing ever adds the key on load or save.
const withTheme = (theme: Record<string, unknown>) => { const settings = defaultSettings(); return { ...settings, appearance: { ...settings.appearance, theme: { ...settings.appearance.theme, mode: 'combined', ...theme } } }; };
const wrap = (settings: unknown) => ({ version: 1, settings, reminders: [], photoAsset: null });

test('Transparency is absent by default and the standard 50 is stored as no key', () => {
  const settings = defaultSettings();
  assert.equal(Object.hasOwn(settings.appearance.theme, 'transparency'), false);
  assert.equal(themeTransparency(settings.appearance.theme), TRANSPARENCY.standard);
  assert.deepEqual(TRANSPARENCY, { min: 0, max: 100, standard: 50 });
  assert.equal(Object.hasOwn(settingsSchema.parse(settings).appearance.theme, 'transparency'), false, 'parsing never adds the key');
  assert.equal(Object.hasOwn(settingsSchema.parse(withTheme({ transparency: 50 })).appearance.theme, 'transparency'), false, '50 is accepted and normalised to omission');
  assert.deepEqual(settingsPatchSchema.parse({ appearance: { brightness: .26 } }), { appearance: { brightness: .26 } }, 'an unrelated patch inserts no key');
});

test('Transparency accepts whole numbers from 0 to 100 and rejects anything else', () => {
  for (const value of [0, 1, 37, 49, 51, 99, 100]) {
    assert.equal(settingsSchema.parse(withTheme({ transparency: value })).appearance.theme.transparency, value, `${value} is stored`);
    assert.equal(settingsPatchSchema.parse({ appearance: { theme: { mode: 'combined', calendars: [], transparency: value } } }).appearance?.theme?.transparency, value);
  }
  for (const value of [-1, 101, 50.5, 0.1, '50', null, true, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
    assert.equal(settingsSchema.safeParse(withTheme({ transparency: value })).success, false, `${String(value)} is rejected in settings`);
    assert.equal(settingsPatchSchema.safeParse({ appearance: { theme: { mode: 'combined', calendars: [], transparency: value } } }).success, false, `${String(value)} is rejected in a patch`);
  }
});

test('Loading settings without Transparency leaves them, and the file, byte-identical', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-transparency-'));
  try {
    for (const theme of [defaultSettings().appearance.theme, { mode: 'combined', calendars: ['CA'] }, { mode: 'seasonal', calendars: [], foreground: true }] as ThemeSettings[]) {
      const settings = defaultSettings(); settings.appearance.theme = theme;
      const persisted = persistableSettings(settings), text = JSON.stringify(wrap(persisted), null, 2);
      assert.deepStrictEqual(persistableSettings(settingsSchema.parse(persisted)), persisted, 'parse and write back give the same settings, with no new key');
      await writeFile(join(directory, 'state.json'), text, 'utf8');
      const store = await DataStore.open(directory);
      assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), text, 'opening the store does not rewrite the file');
      assert.equal(Object.hasOwn(store.snapshot().settings.appearance.theme, 'transparency'), false);
      await store.patchSettings({ clockFormat: '24h' });
      const after = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
      assert.equal(JSON.stringify(after.settings.appearance?.theme), JSON.stringify(persisted.appearance && (persisted.appearance as Record<string, unknown>).theme), 'an unrelated save writes the theme exactly as it was');
      await rm(join(directory, 'state.json')); await rm(join(directory, 'state.backup.json'), { force: true });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('A Transparency value survives restart, export, import and saved styles; a theme patch without it clears it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-transparency-'));
  try {
    const store = await DataStore.open(directory);
    await store.patchSettings({ appearance: { theme: { mode: 'combined', calendars: ['CA'], transparency: 30 } } });
    assert.equal((await DataStore.open(directory)).snapshot().settings.appearance.theme.transparency, 30);
    const exported = { version: 1, exportedAt: new Date().toISOString(), settings: persistableSettings(store.snapshot().settings), reminders: [] };
    assert.equal(importSchema.parse(JSON.parse(JSON.stringify(exported))).settings.appearance.theme.transparency, 30);
    const styled = store.snapshot().settings; styled.savedPresets = [{ id: 'transparency-style', name: 'Glassy', visual: getVisual(styled) }];
    const persisted = persistableSettings(settingsSchema.parse(styled)) as Record<string, any>;
    assert.equal(persisted.savedPresets[0].visual.appearance.theme.transparency, 30, 'a saved style keeps its Transparency');
    assert.equal(mergeSettings(store.snapshot().settings, { clockFormat: '24h' }).appearance.theme.transparency, 30, 'an unrelated patch keeps it');
    assert.equal(mergeSettings(store.snapshot().settings, { appearance: { theme: { mode: 'combined', calendars: ['CA'] } } }).appearance.theme.transparency, undefined, 'the theme object is replaced whole');
    await store.patchSettings({ appearance: { theme: { mode: 'combined', calendars: ['CA'], transparency: 50 } } });
    const current = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
    assert.deepEqual(current.settings.appearance.theme, { mode: 'combined', calendars: ['CA'] }, 'saving 50 removes the key at rest');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('A stored Transparency is an older-reader rollback exception; the default adds nothing', () => {
  const off = defaultSettings(); off.appearance.theme = withTransparency(off.appearance.theme, 50);
  assertPreviousReaderAccepts('data', persistableData(wrap(settingsSchema.parse(off)) as never), 'the standard Transparency writes no key, and Theme Off stays omitted');
  const tuned = defaultSettings(); tuned.appearance.theme = withTransparency(tuned.appearance.theme, 20);
  const written = persistableSettings(settingsSchema.parse(tuned)) as Record<string, any>;
  assert.deepEqual(written.appearance.theme, { mode: 'off', calendars: ['CA', 'KR', 'RU'], transparency: 20 }, 'a value under Off is kept, so the theme is written');
  assertPreviousReaderRejects('data', wrap(written), 'a Transparency value is a documented rollback exception (docs/install.md)');
});

test('The editor draft: the slider at 50 is no change, another value is one complete theme patch', () => {
  const base = defaultSettings(); base.appearance.theme = { mode: 'combined', calendars: ['CA', 'KR', 'RU'] };
  const moved = structuredClone(base); moved.appearance.theme = withTransparency(moved.appearance.theme, 72);
  assert.deepEqual(moved.appearance.theme, { mode: 'combined', calendars: ['CA', 'KR', 'RU'], transparency: 72 });
  assert.equal(sameEffectiveSettings(base, moved), false);
  assert.deepEqual(settingsChanges(base, moved).appearance?.theme, { mode: 'combined', calendars: ['CA', 'KR', 'RU'], transparency: 72 });
  const back = structuredClone(moved); back.appearance.theme = withTransparency(back.appearance.theme, 50);
  assert.equal(Object.hasOwn(back.appearance.theme, 'transparency'), false);
  assert.equal(sameEffectiveSettings(base, back), true, 'moving back to the saved value is no change: Save and Cancel go away');
  assert.deepEqual(settingsChanges(base, back), {});
  const saved = structuredClone(moved), lower = structuredClone(saved); lower.appearance.theme = withTransparency(lower.appearance.theme, 50);
  assert.deepEqual(settingsChanges(saved, lower).appearance?.theme, { mode: 'combined', calendars: ['CA', 'KR', 'RU'] }, 'returning a saved value to the standard sends the theme without the key');
  assert.deepEqual(withTransparency({ mode: 'seasonal', calendars: [], foreground: true }, 0), { mode: 'seasonal', calendars: [], foreground: true, transparency: 0 }, 'other theme keys are kept');
});
