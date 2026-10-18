// #76: the Animation level joins the normal settings draft, survives built-in styles and saved
// styles, and keeps the previous release's reader working for default (Subtle) data.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Settings } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { DataStore } from '../server/store.ts';
import { assertPreviousReaderAccepts, assertPreviousReaderRejects } from '../server/compat/previous-reader.ts';
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
  // Soft motion and clock style still reset until #110 decides.
  const custom = defaultSettings(); custom.appearance.motionEnabled = false; custom.appearance.clockStyle = 'analog';
  const room = applyBuiltinPreset(custom, 'room');
  assert.equal(room.appearance.motionEnabled, true); assert.equal(room.appearance.clockStyle, 'outline');
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

async function stateAfter(patch: Parameters<DataStore['patchSettings']>[0]): Promise<{ state: unknown; backup: unknown }> {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-motion-rollback-'));
  try {
    const store = await DataStore.open(directory);
    await store.patchSettings({ appearance: { brightness: 0.5 } });
    await store.patchSettings(patch);
    const read = async (name: string) => JSON.parse(await readFile(join(directory, name), 'utf8')) as unknown;
    return { state: await read('state.json'), backup: await read('state.backup.json') };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('#76 rollback: default Subtle data stays readable by the previous release; Off and Lively are documented exceptions', async () => {
  const subtle = await stateAfter({ appearance: { animation: 'subtle' } });
  assertPreviousReaderAccepts('data', subtle.state, 'Subtle state.json');
  assert.equal('animation' in ((subtle.state as { settings: { appearance: object } }).settings.appearance), false, 'Subtle is omitted at rest');
  const savedStyle = await stateAfter({ savedPresets: [{ id: 'style', name: 'Style', visual: getVisual(defaultSettings()) }] });
  assertPreviousReaderAccepts('data', savedStyle.state, 'saved style at the default level');
  for (const level of ['off', 'lively'] as const) {
    const chosen = await stateAfter({ appearance: { animation: level } });
    assertPreviousReaderRejects('data', chosen.state, `${level} state.json (documented exception: restore the pre-upgrade data copy)`);
    assertPreviousReaderAccepts('data', chosen.backup, `${level}: the backup of the previous save stays readable`);
    const style = await stateAfter({ savedPresets: [{ id: 'style', name: 'Style', visual: getVisual(chooseLevel(defaultSettings(), level)) }] });
    assertPreviousReaderRejects('data', style.state, `${level} inside a saved style`);
  }
});
