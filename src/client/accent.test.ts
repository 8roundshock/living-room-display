// Native colours in the editor draft (#75): built-in styles, dirty state, minimal PATCHes and polling rebase.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaultSettings } from '../shared/defaults.ts';
import type { Settings } from '../shared/contracts.ts';
import { applyBuiltinPreset, getVisual } from './model.ts';
import { rebaseSettings, sameEffectiveSettings, settingsChanges } from './draft.ts';

/** Settings saved before #75: read as color. */
function legacy(): Settings {
  const settings = defaultSettings();
  settings.appearance.accentMode = 'color';
  return settings;
}
/** What the Style tab's Native swatch does. */
function chooseNative(settings: Settings): Settings {
  return { ...settings, appearance: { ...settings.appearance, accentMode: 'native', preset: 'custom' } };
}
/** What a colour swatch or the custom colour input does. */
function chooseColor(settings: Settings, accentColor: string): Settings {
  return { ...settings, appearance: { ...settings.appearance, accentMode: 'color', accentColor, preset: 'custom' } };
}

test('new defaults and every built-in style use native colours and keep their own overrides', () => {
  assert.equal(defaultSettings().appearance.accentMode, 'native');
  for (const preset of ['phone', 'room', 'night'] as const) {
    const applied = applyBuiltinPreset(legacy(), preset);
    assert.equal(applied.appearance.accentMode, 'native', `${preset} applies Native`);
    assert.equal(applied.appearance.preset, preset);
  }
  const night = applyBuiltinPreset(legacy(), 'night').appearance;
  assert.equal(night.brightness, 0.28); assert.equal(night.accentColor, '#9990b7'); assert.equal(night.textColor, '#a7a3bb');
  const phone = applyBuiltinPreset(legacy(), 'phone').appearance;
  assert.equal(phone.brightness, 0.7); assert.equal(phone.accentColor, '#a89ec8');
  assert.equal(applyBuiltinPreset(legacy(), 'room').appearance.brightness, 0.55);
});

test('turning Native on makes the draft dirty with a minimal PATCH; turning it off makes it clean', () => {
  const saved = legacy();
  const native = chooseNative(saved);
  assert.equal(sameEffectiveSettings(saved, native), false);
  assert.deepEqual(settingsChanges(saved, native), { appearance: { accentMode: 'native', preset: 'custom' } });
  // accentColor is kept, so returning to the same colour restores the saved output exactly.
  assert.equal(native.appearance.accentColor, saved.appearance.accentColor);
  const back = chooseColor(native, saved.appearance.accentColor);
  assert.equal(sameEffectiveSettings(saved, back), true);
  assert.deepEqual(settingsChanges(saved, back), {});
  // A different swatch after Native is a colour change, not a mode leftover.
  assert.deepEqual(settingsChanges(saved, chooseColor(native, '#b8a17a')), { appearance: { accentColor: '#b8a17a', preset: 'custom' } });
  // From a native save, choosing a colour is dirty too.
  const savedNative = chooseNative(saved);
  assert.deepEqual(settingsChanges(savedNative, chooseColor(savedNative, '#88afa6')), { appearance: { accentMode: 'color', accentColor: '#88afa6' } });
});

test('a polling rebase keeps a local Native choice while the saved brightness changes', () => {
  const base = legacy(), draft = chooseNative(base), incoming = structuredClone(base);
  incoming.appearance.brightness = 0.4;
  const next = rebaseSettings(base, draft, incoming);
  assert.equal(next.appearance.accentMode, 'native');
  assert.equal(next.appearance.brightness, 0.4);
  assert.deepEqual(settingsChanges(incoming, next), { appearance: { accentMode: 'native', preset: 'custom' } });
  // An incoming mode change applies to an untouched draft.
  const elsewhere = structuredClone(base); elsewhere.appearance.accentMode = 'native';
  assert.equal(rebaseSettings(base, structuredClone(base), elsewhere).appearance.accentMode, 'native');
});

test('saved styles store and restore the accent mode', () => {
  const settings = chooseNative(legacy());
  const visual = getVisual(settings);
  assert.equal(visual.appearance.accentMode, 'native');
  const restored = { ...legacy(), ...structuredClone(visual) };
  assert.equal(restored.appearance.accentMode, 'native');
  assert.equal(sameEffectiveSettings(restored, settings), true);
});
