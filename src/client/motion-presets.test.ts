// #76: the Animation level joins the normal settings draft, survives built-in styles and saved
// styles, and keeps every level readable by the previous release's reader.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Settings } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { DataStore } from '../server/store.ts';
import { createApplication } from '../server/app.ts';
import { assertPreviousReaderAccepts, assertPreviousReaderRejects } from '../server/compat/previous-reader.ts';
import { colorAccentDefaults, forecastFixture, seedColorAccentData } from '../server/fixtures.ts';
import { rebaseSettings, sameEffectiveSettings, settingsChanges } from './draft.ts';
import { applyBuiltinPreset, getVisual } from './model.ts';

/** What the Style tab's Animation buttons do: change the level, never the style preset. */
function chooseLevel(settings: Settings, animation: Settings['appearance']['animation']): Settings {
  return { ...settings, appearance: { ...settings.appearance, animation } };
}

test('#76 Phone, Room and Night keep the chosen Animation level', () => {
  for (const level of ['off', 'lively', 'subtle'] as const) {
    const source = chooseLevel(defaultSettings(), level);
    for (const preset of ['phone', 'room', 'night'] as const) {
      const styled = applyBuiltinPreset(source, preset);
      assert.equal(styled.appearance.animation, level, `${preset} keeps ${level}`);
      assert.equal(styled.appearance.preset, preset);
    }
  }
});

test('#110 Phone, Room and Night keep drift and fade, the move interval, the fade length and the clock style', () => {
  const custom = defaultSettings();
  Object.assign(custom.appearance, { motionEnabled: false, motionIntervalSeconds: 900, fadeSeconds: 0, clockStyle: 'analog', animation: 'off' });
  for (const preset of ['phone', 'room', 'night'] as const) {
    const styled = applyBuiltinPreset(custom, preset).appearance;
    assert.deepEqual(
      { motionEnabled: styled.motionEnabled, motionIntervalSeconds: styled.motionIntervalSeconds, fadeSeconds: styled.fadeSeconds, clockStyle: styled.clockStyle, animation: styled.animation },
      { motionEnabled: false, motionIntervalSeconds: 900, fadeSeconds: 0, clockStyle: 'analog', animation: 'off' },
      `${preset} keeps every motion preference`,
    );
  }
  // Phone's former 2-minute interval is gone: the default 3 minutes stays.
  assert.equal(applyBuiltinPreset(defaultSettings(), 'phone').appearance.motionIntervalSeconds, 180);
});

test('#110 applying a look over a saved board changes only the look, and the Save bar follows effective changes', () => {
  const saved = defaultSettings();
  Object.assign(saved.appearance, { motionEnabled: false, clockStyle: 'analog' });
  const night = applyBuiltinPreset(saved, 'night');
  assert.equal(sameEffectiveSettings(saved, night), false, 'a different look is an edit');
  assert.deepEqual(Object.keys(settingsChanges(saved, night).appearance ?? {}).sort(), ['accentColor', 'brightness', 'layout', 'preset', 'textColor'], 'only look fields are sent');
  const back = applyBuiltinPreset(night, 'room');
  assert.equal(sameEffectiveSettings(saved, back), true, 'returning to the saved look hides the Save bar');
  assert.deepEqual(settingsChanges(saved, back), {});
});

test('#224 rollback: choosing the retuned Sand keeps colour-accent data readable by the previous release', async () => {
  const sand = await stateAfter({ appearance: { accentColor: '#b6a588' } });
  assertPreviousReaderAccepts('data', sand.state, 'retuned Sand state.json');
  assertPreviousReaderAccepts('data', sand.backup, 'retuned Sand state.backup.json');
  assert.equal((sand.state as { settings: { appearance: { accentColor: string } } }).settings.appearance.accentColor, '#b6a588');
});

test('#76 choosing a level is one dirty field without a preset change, and reverting is clean', () => {
  const saved = applyBuiltinPreset(defaultSettings(), 'room');
  const draft = chooseLevel(saved, 'lively');
  assert.equal(draft.appearance.preset, 'room', 'the style preset is not marked Custom');
  assert.equal(sameEffectiveSettings(saved, draft), false, 'the Save bar appears');
  assert.deepEqual(settingsChanges(saved, draft), { appearance: { animation: 'lively' } });
  const reverted = chooseLevel(draft, 'subtle');
  assert.equal(sameEffectiveSettings(saved, reverted), true, 'switching back hides the Save bar');
  assert.deepEqual(settingsChanges(saved, reverted), {});
});

test('#76 a local level survives a poll that changed something else, and a saved style restores it', () => {
  const base = defaultSettings();
  const draft = chooseLevel(base, 'off');
  const incoming = structuredClone(base); incoming.appearance.brightness = 0.4;
  const rebased = rebaseSettings(base, draft, incoming);
  assert.equal(rebased.appearance.animation, 'off', 'the local level stays');
  assert.equal(rebased.appearance.brightness, 0.4, 'the polled field refreshes');
  const fromServer = structuredClone(base); fromServer.appearance.animation = 'lively';
  assert.equal(rebaseSettings(base, structuredClone(base), fromServer).appearance.animation, 'lively', 'an untouched level refreshes');
  // Saved styles store the visual settings, including the level.
  const lively = chooseLevel(base, 'lively');
  const style = { id: 'synthetic', name: 'Synthetic', visual: getVisual(lively) };
  const restored = { ...base, ...structuredClone(style.visual) };
  assert.equal(restored.appearance.animation, 'lively');
});

type Files = { state: any; backup: any; nextBackup: any; exported: any };
/** Saves `patch` over an existing user's data, then one unrelated save; returns both files at each point and the export. */
async function stateAfter(patch: Parameters<DataStore['patchSettings']>[0]): Promise<Files> {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-motion-rollback-'));
  try {
    // An existing user's colour-accent data (#75 Native is covered in src/server/rollback.test.ts).
    await seedColorAccentData(directory);
    const store = await DataStore.open(directory);
    await store.patchSettings({ appearance: { brightness: 0.5 } });
    await store.patchSettings(patch);
    const read = async (name: string) => JSON.parse(await readFile(join(directory, name), 'utf8')) as unknown;
    const state = await read('state.json'), backup = await read('state.backup.json');
    await store.patchSettings({ units: 'imperial' });
    const nextBackup = await read('state.backup.json');
    // The export through the real route, from the same folder.
    const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    try {
      const address = app.server.address(); assert.ok(address && typeof address === 'object');
      const exported = await (await fetch(`http://127.0.0.1:${address.port}/api/export`)).json();
      return { state, backup, nextBackup, exported };
    } finally { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('#76 rollback: every Animation level stays readable by the previous release (3fee844 knows the key)', async () => {
  const subtle = await stateAfter({ appearance: { animation: 'subtle' } });
  assertPreviousReaderAccepts('data', subtle.state, 'Subtle state.json');
  assert.equal('animation' in subtle.state.settings.appearance, false, 'Subtle is omitted at rest');
  const savedStyle = await stateAfter({ savedPresets: [{ id: 'style', name: 'Style', visual: getVisual(colorAccentDefaults()) }] });
  assertPreviousReaderAccepts('data', savedStyle.state, 'saved style at the default level');
  for (const level of ['off', 'lively'] as const) {
    const chosen = await stateAfter({ appearance: { animation: level } });
    assert.equal(chosen.state.settings.appearance.animation, level, `${level} is written`);
    assertPreviousReaderAccepts('data', chosen.state, `${level} state.json`);
    assertPreviousReaderAccepts('data', chosen.backup, `${level}: the backup of the previous save`);
    assert.equal(chosen.nextBackup.settings.appearance.animation, level, `${level} reaches state.backup.json after the next save`);
    assertPreviousReaderAccepts('data', chosen.nextBackup, `${level} state.backup.json after the next save`);
    assert.equal(chosen.exported.settings.appearance.animation, level);
    assertPreviousReaderAccepts('import', chosen.exported, `${level} export`);
    const style = await stateAfter({ savedPresets: [{ id: 'style', name: 'Style', visual: getVisual(chooseLevel(colorAccentDefaults(), level)) }] });
    assert.equal(style.state.settings.savedPresets[0].visual.appearance.animation, level);
    assertPreviousReaderAccepts('data', style.state, `${level} inside a saved style`);
    assertPreviousReaderAccepts('data', style.nextBackup, `${level} inside a saved style, in state.backup.json`);
    assertPreviousReaderAccepts('import', style.exported, `${level} inside a saved style, in the export`);
    // Negative control: a level the previous release does not know is still rejected.
    const unknown = structuredClone(chosen.state); unknown.settings.appearance.animation = 'frantic';
    assertPreviousReaderRejects('data', unknown, 'an unknown animation level');
  }
});
