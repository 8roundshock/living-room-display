// Follow daylight brightness (#439): the appearance.daylightBrightness contract. Synthetic data in
// temporary folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';
import { DataStore } from './store.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { importSchema, mergeSettings, settingsPatchSchema, settingsSchema } from './validation.ts';
import { applyBuiltinPreset, getVisual, resetAppearance } from '../client/model.ts';
import { rebaseSettings, sameEffectiveSettings, settingsChanges } from '../client/draft.ts';

const RANGE = { dimmest: 0.25, brightest: 0.75 };

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-daylight-'));
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const patch = (value: unknown) => fetch(`${url}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  return { ...app, directory, url, patch, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); } };
}

test('new installs are Fixed; data, saved styles and imports without the key read as Fixed', () => {
  assert.equal(defaultSettings().appearance.daylightBrightness, null);
  const legacy = JSON.parse(JSON.stringify(defaultSettings()));
  delete legacy.appearance.daylightBrightness;
  legacy.savedPresets = [{ id: 'legacy', name: 'Legacy', visual: { ...getVisual(defaultSettings()), appearance: { ...legacy.appearance } } }];
  const read = settingsSchema.parse(legacy);
  const imported = importSchema.parse({ version: 1, exportedAt: new Date().toISOString(), settings: legacy, reminders: [] }).settings;
  for (const appearance of [read.appearance, read.savedPresets[0]!.visual.appearance, imported.appearance, imported.savedPresets[0]!.visual.appearance]) {
    assert.equal(appearance.daylightBrightness, null);
    assert.equal(appearance.brightness, 0.55);
  }
});

test('a PATCH sets a whole range or null; a brightness-only PATCH keeps the range (#83)', () => {
  assert.deepEqual(settingsPatchSchema.parse({ appearance: { daylightBrightness: RANGE } }), { appearance: { daylightBrightness: RANGE } });
  assert.deepEqual(settingsPatchSchema.parse({ appearance: { daylightBrightness: null } }), { appearance: { daylightBrightness: null } });
  const following = mergeSettings(defaultSettings(), { appearance: { daylightBrightness: RANGE } });
  assert.deepEqual(following.appearance.daylightBrightness, RANGE);
  const brighter = mergeSettings(following, settingsPatchSchema.parse({ appearance: { brightness: 0.4 } }));
  assert.deepEqual(brighter.appearance.daylightBrightness, RANGE, 'an unrelated appearance PATCH keeps the range');
  assert.equal(brighter.appearance.brightness, 0.4, 'brightness stays the Fixed level');
  const equal = mergeSettings(following, { appearance: { daylightBrightness: { dimmest: 0.5, brightest: 0.5 } } });
  assert.deepEqual(equal.appearance.daylightBrightness, { dimmest: 0.5, brightest: 0.5 }, 'an empty range is allowed');
  assert.equal(mergeSettings(following, { appearance: { daylightBrightness: null } }).appearance.daylightBrightness, null);
});

test('invalid ranges are 400 and change nothing; saved values survive a restart', async () => {
  const app = await fixture();
  try {
    for (const daylightBrightness of [
      { dimmest: 0.8, brightest: 0.3 }, { dimmest: 0.05, brightest: 0.5 }, { dimmest: 0.2, brightest: 1.2 }, { dimmest: 0.2 },
      { brightest: 0.6 }, { dimmest: 0.2, brightest: 0.6, peak: 'noon' }, { dimmest: '0.2', brightest: 0.6 }, 0.5, 'daylight', [],
    ]) {
      const response = await app.patch({ appearance: { daylightBrightness } });
      assert.equal(response.status, 400, JSON.stringify(daylightBrightness));
      if (JSON.stringify(daylightBrightness) === JSON.stringify({ dimmest: 0.8, brightest: 0.3 })) assert.match((await response.json()).error, /Dimmest must not be brighter than Brightest/);
    }
    assert.equal(app.store.snapshot().settings.appearance.daylightBrightness, null);
    const saved = await (await app.patch({ appearance: { daylightBrightness: RANGE } })).json();
    assert.deepEqual(saved.appearance.daylightBrightness, RANGE, 'the PATCH response carries the range');
    const state = await (await fetch(`${app.url}/api/state`)).json();
    assert.deepEqual(state.settings.appearance.daylightBrightness, RANGE);
    assert.deepEqual(JSON.parse(await readFile(join(app.directory, 'state.json'), 'utf8')).settings.appearance.daylightBrightness, RANGE);
    assert.deepEqual((await DataStore.open(app.directory)).snapshot().settings.appearance.daylightBrightness, RANGE, 'through a restart');
    // Fixed again: API responses keep the key (null); the file omits it.
    const fixed = await (await app.patch({ appearance: { daylightBrightness: null } })).json();
    assert.equal(fixed.appearance.daylightBrightness, null);
    assert.equal('daylightBrightness' in fixed.appearance, true, 'API responses always include every key');
    assert.equal('daylightBrightness' in JSON.parse(await readFile(join(app.directory, 'state.json'), 'utf8')).settings.appearance, false);
    const exported = await (await fetch(`${app.url}/api/export`)).json();
    assert.equal('daylightBrightness' in exported.settings.appearance, false, 'a Fixed export omits it');
  } finally { await app.close(); }
});

test('the editor sends the whole range, never a partial one, and Fixed ↔ Follow daylight round trips are not edits', () => {
  const saved = mergeSettings(defaultSettings(), { appearance: { daylightBrightness: RANGE } });
  const dimmer = structuredClone(saved); dimmer.appearance.daylightBrightness = { dimmest: 0.2, brightest: 0.75 };
  assert.deepEqual(settingsChanges(saved, dimmer).appearance, { daylightBrightness: { dimmest: 0.2, brightest: 0.75 } }, 'the whole range, so the server can replace it');
  const fixed = structuredClone(saved); fixed.appearance.daylightBrightness = null;
  assert.deepEqual(settingsChanges(saved, fixed).appearance, { daylightBrightness: null });
  const back = structuredClone(fixed); back.appearance.daylightBrightness = { ...RANGE };
  assert.equal(sameEffectiveSettings(saved, back), true, 'returning to the saved range is no edit');
  assert.deepEqual(settingsChanges(saved, back), {});
  // A whole-range PATCH validates, so Save can never send Dimmest above Brightest.
  assert.ok(settingsPatchSchema.safeParse(settingsChanges(saved, dimmer)).success);
});

test('a polling rebase keeps a local range whole and otherwise takes the saved one', () => {
  const base = mergeSettings(defaultSettings(), { appearance: { daylightBrightness: { dimmest: 0.3, brightest: 0.6 } } });
  // Another editor saved a lower Brightest while this one raised Dimmest: mixing them would be invalid.
  const draft = structuredClone(base); draft.appearance.daylightBrightness = { dimmest: 0.5, brightest: 0.6 };
  const incoming = structuredClone(base); incoming.appearance.daylightBrightness = { dimmest: 0.3, brightest: 0.4 }; incoming.appearance.fontScale = 1.2;
  const rebased = rebaseSettings(base, draft, incoming);
  assert.deepEqual(rebased.appearance.daylightBrightness, { dimmest: 0.5, brightest: 0.6 }, 'the local range stays whole');
  assert.equal(rebased.appearance.fontScale, 1.2, 'untouched fields refresh');
  // Untouched locally: the saved range (or Fixed) arrives.
  const untouched = rebaseSettings(base, structuredClone(base), incoming);
  assert.deepEqual(untouched.appearance.daylightBrightness, { dimmest: 0.3, brightest: 0.4 });
  const nowFixed = structuredClone(base); nowFixed.appearance.daylightBrightness = null;
  assert.equal(rebaseSettings(base, structuredClone(base), nowFixed).appearance.daylightBrightness, null);
});

test('built-in styles keep the brightness mode; Reset appearance returns to Fixed; saved styles store it', () => {
  const following = mergeSettings(defaultSettings(), { appearance: { daylightBrightness: RANGE } });
  for (const preset of ['phone', 'room', 'night'] as const) {
    const styled = applyBuiltinPreset(following, preset);
    assert.deepEqual(styled.appearance.daylightBrightness, RANGE, `${preset} keeps Follow daylight`);
    assert.equal(styled.appearance.brightness, applyBuiltinPreset(defaultSettings(), preset).appearance.brightness, `${preset} sets its Fixed level`);
  }
  assert.equal(resetAppearance(following).appearance.daylightBrightness, null, 'Reset appearance is Fixed again');
  assert.deepEqual(getVisual(following).appearance.daylightBrightness, RANGE, 'a saved style captures the range');
  const restyled = mergeSettings(following, { savedPresets: [{ id: 's', name: 'Daylight', visual: getVisual(following) }] });
  assert.deepEqual(restyled.savedPresets[0]!.visual.appearance.daylightBrightness, RANGE);
});
