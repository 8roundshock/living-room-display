// #436 settings: Swap places (appearance.rearrange) and Keep the screen on (screen.keepAwake).
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';
import { AT_REST, persistableSettings } from './persistence.ts';
import { dataSchema, importSchema, mergeSettings, settingsPatchSchema, settingsSchema } from './validation.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { applyBuiltinPreset, getVisual, resetAppearance } from '../client/model.ts';
import { sameEffectiveSettings, settingsChanges } from '../client/draft.ts';

type Loose = Record<string, any>;

test('#436 defaults: float on, no swap, keep the screen on; a 3446400-era file without either key reads the same', () => {
  const settings = defaultSettings();
  assert.equal(settings.appearance.motionEnabled, true);
  assert.equal(settings.appearance.rearrange, false);
  assert.deepEqual(settings.screen, { keepAwake: true });
  assert.equal(AT_REST.appearance.rearrange, false, 'Swap places off is the at-rest default');
  // The owner's saved data: a 30 s interval and neither new key.
  const owner = JSON.parse(JSON.stringify(settings)) as Loose;
  owner.appearance.motionIntervalSeconds = 30; delete owner.appearance.rearrange; delete owner.screen;
  const read = settingsSchema.parse(owner);
  assert.equal(read.appearance.rearrange, false); assert.deepEqual(read.screen, { keepAwake: true });
  assert.equal(read.appearance.motionIntervalSeconds, 30); assert.equal(read.appearance.motionEnabled, true);
  // A saved style from before #436 reads as no swap too.
  owner.savedPresets = [{ id: 'old', name: 'Old', visual: getVisual(read) }];
  delete owner.savedPresets[0].visual.appearance.rearrange;
  assert.equal(settingsSchema.parse(owner).savedPresets[0]!.visual.appearance.rearrange, false);
});

test('#436 PATCH accepts exactly appearance.rearrange and screen.keepAwake, never a default, and rejects anything else', () => {
  assert.deepEqual(settingsPatchSchema.parse({ appearance: { rearrange: true } }), { appearance: { rearrange: true } });
  assert.deepEqual(settingsPatchSchema.parse({ screen: { keepAwake: false } }), { screen: { keepAwake: false } });
  assert.deepEqual(settingsPatchSchema.parse({ screen: {} }), { screen: {} });
  for (const invalid of [{ screen: { keepAwake: 'no' } }, { screen: { keepAwake: true, extra: 1 } }, { screen: null }, { appearance: { rearrange: 'sometimes' } }]) {
    assert.equal(settingsPatchSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
  // Persisted data rejects unknown screen keys too.
  const data = { version: 1, settings: { ...defaultSettings(), screen: { keepAwake: true, brightness: 1 } }, reminders: [] };
  assert.equal(dataSchema.safeParse(data).success, false);
});

test('#436 a change to one key keeps the others: a brightness change keeps Swap places and Keep the screen on', () => {
  const saved = mergeSettings(defaultSettings(), { appearance: { rearrange: true }, screen: { keepAwake: false } });
  assert.equal(saved.appearance.rearrange, true); assert.equal(saved.screen.keepAwake, false);
  const next = mergeSettings(saved, settingsPatchSchema.parse({ appearance: { brightness: 0.4, preset: 'custom' } }));
  assert.equal(next.appearance.rearrange, true); assert.equal(next.screen.keepAwake, false);
  const screenOnly = mergeSettings(saved, settingsPatchSchema.parse({ screen: { keepAwake: true } }));
  assert.equal(screenOnly.appearance.rearrange, true); assert.equal(screenOnly.screen.keepAwake, true);
});

test('#436 at rest: Swap places off and the default screen section are omitted, a chosen value is written', () => {
  const settings = defaultSettings();
  settings.savedPresets = [{ id: 'style', name: 'Style', visual: getVisual(settings) }];
  const written = persistableSettings(settings) as Loose;
  assert.equal('rearrange' in written.appearance, false);
  assert.equal('rearrange' in written.savedPresets[0].visual.appearance, false);
  assert.equal('screen' in written, false);
  const chosen = persistableSettings(mergeSettings(defaultSettings(), { appearance: { rearrange: true }, screen: { keepAwake: false } })) as Loose;
  assert.equal(chosen.appearance.rearrange, true);
  assert.deepEqual(chosen.screen, { keepAwake: false });
  // Written data reads back to the same settings.
  for (const value of [settings, mergeSettings(defaultSettings(), { appearance: { rearrange: true }, screen: { keepAwake: false } })]) {
    const read = dataSchema.parse(JSON.parse(JSON.stringify({ version: 1, settings: persistableSettings(value), reminders: [], photoAsset: null })));
    assert.ok(sameEffectiveSettings(read.settings, value));
  }
});

test('#436 saved styles never contain screen; built-in styles and Reset keep or restore the motion choices', () => {
  const settings = mergeSettings(defaultSettings(), { appearance: { rearrange: true }, screen: { keepAwake: false } });
  const visual = getVisual(settings) as Loose;
  assert.equal('screen' in visual, false, 'a saved style is visual only');
  assert.equal(visual.appearance.rearrange, true, 'Swap places is a motion choice and travels with a style, like Float gently');
  // A saved style that tries to carry screen is rejected.
  assert.equal(settingsPatchSchema.safeParse({ savedPresets: [{ id: 's', name: 'S', visual: { ...visual, screen: { keepAwake: true } } }] }).success, false);
  // #268: built-in styles keep every motion choice, Swap places included, and never touch screen.
  for (const preset of ['phone', 'room', 'night'] as const) {
    const applied = applyBuiltinPreset(settings, preset);
    assert.equal(applied.appearance.rearrange, true, preset);
    assert.deepEqual(applied.screen, { keepAwake: false }, preset);
    assert.deepEqual(settingsChanges(settings, applied).screen, undefined);
  }
  // Reset appearance returns Swap places to off; Keep the screen on is not a Style value and stays.
  const reset = resetAppearance(settings);
  assert.equal(reset.appearance.rearrange, false); assert.deepEqual(reset.screen, { keepAwake: false });
  // The editor sends only what changed.
  assert.deepEqual(settingsChanges(defaultSettings(), mergeSettings(defaultSettings(), { screen: { keepAwake: false } })), { screen: { keepAwake: false } });
  assert.deepEqual(settingsChanges(defaultSettings(), mergeSettings(defaultSettings(), { appearance: { rearrange: true } })), { appearance: { rearrange: true } });
});

test('#436 HTTP: PATCH, export and import carry the new keys; the files omit them at their defaults', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-436-http-')), target = await mkdtemp(join(tmpdir(), 'lrd-436-import-'));
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  const imported = await createApplication({ dataDirectory: target, fetcher: async () => Response.json(forecastFixture()) });
  for (const instance of [app, imported]) { instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening'); }
  const url = (instance: typeof app) => { const address = instance.server.address(); assert.ok(address && typeof address === 'object'); return `http://127.0.0.1:${address.port}`; };
  const send = async (instance: typeof app, method: string, path: string, value?: unknown) => {
    const response = await fetch(`${url(instance)}${path}`, value === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  try {
    assert.equal((await send(app, 'PATCH', '/api/settings', { screen: { keepAwake: 'yes' } })).status, 400);
    const saved = await send(app, 'PATCH', '/api/settings', { appearance: { rearrange: true }, screen: { keepAwake: false } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.appearance.rearrange, true); assert.deepEqual(saved.body.screen, { keepAwake: false });
    const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
    assert.equal(state.settings.appearance.rearrange, true); assert.deepEqual(state.settings.screen, { keepAwake: false });
    const exported = (await send(app, 'GET', '/api/export')).body;
    assert.equal(importSchema.safeParse(exported).success, true);
    assert.equal((await send(imported, 'POST', '/api/import', exported)).status < 300, true);
    assert.equal(imported.store.snapshot().settings.appearance.rearrange, true);
    assert.deepEqual(imported.store.snapshot().settings.screen, { keepAwake: false });
    // Back to the defaults: the files omit both again.
    await send(app, 'PATCH', '/api/settings', { appearance: { rearrange: false }, screen: { keepAwake: true } });
    const atRest = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
    assert.equal('rearrange' in atRest.settings.appearance, false); assert.equal('screen' in atRest.settings, false);
  } finally {
    for (const instance of [app, imported]) { instance.server.closeAllConnections(); instance.server.close(); await once(instance.server, 'close'); }
    await rm(directory, { recursive: true, force: true }); await rm(target, { recursive: true, force: true });
  }
});
