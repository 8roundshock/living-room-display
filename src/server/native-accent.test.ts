// Native colours on the server (#75): fresh defaults, PATCH persistence and rollback scenarios.
// Synthetic data in temporary folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';
import { DataStore } from './store.ts';
import { assertPreviousReaderAccepts, assertPreviousReaderRejects } from './compat/previous-reader.ts';
import { defaultSettings as previousDefaults } from './compat/bedca44/shared/defaults.ts';
import { applyBuiltinPreset, getVisual } from '../client/model.ts';
import { settingsChanges } from '../client/draft.ts';
import type { Settings } from '../shared/contracts.ts';

async function application(directory: string) {
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const send = async (method: string, path: string, value?: unknown) => {
    const response = await fetch(`${url}${path}`, value === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    assert.ok(response.status < 300, `${method} ${path} returned ${response.status}: ${await response.clone().text()}`);
    return response.json();
  };
  return { ...app, send, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); } };
}
const temporary = (prefix: string) => mkdtemp(join(tmpdir(), prefix));
const readJson = async (directory: string, name: string) => JSON.parse(await readFile(join(directory, name), 'utf8'));
/** A data folder written by the previous release (no accentMode: reads as color). */
async function previousRelease(directory: string) {
  await writeFile(join(directory, 'state.json'), JSON.stringify({ version: 1, settings: previousDefaults(), reminders: [], photoAsset: null }));
}

test('a fresh store defaults to native; previous-release data reads as color', async () => {
  const fresh = await temporary('lrd-native-fresh-'), legacy = await temporary('lrd-native-legacy-');
  try {
    const app = await application(fresh);
    try {
      assert.equal((await app.send('GET', '/api/state')).settings.appearance.accentMode, 'native');
      assert.equal((await readJson(fresh, 'state.json')).settings.appearance.accentMode, 'native');
    } finally { await app.close(); }
    await previousRelease(legacy);
    assert.equal((await DataStore.open(legacy)).snapshot().settings.appearance.accentMode, 'color');
  } finally { await rm(fresh, { recursive: true, force: true }); await rm(legacy, { recursive: true, force: true }); }
});

test('PATCH native, then a brightness-only PATCH keeps native through restart; a colour PATCH returns to color', async () => {
  const directory = await temporary('lrd-native-patch-');
  try {
    await previousRelease(directory);
    const app = await application(directory);
    try {
      assert.equal((await app.send('PATCH', '/api/settings', { appearance: { accentMode: 'native', preset: 'custom' } })).appearance.accentMode, 'native');
      const patched = await app.send('PATCH', '/api/settings', { appearance: { brightness: 0.4 } });
      assert.equal(patched.appearance.accentMode, 'native'); assert.equal(patched.appearance.brightness, 0.4);
      assert.equal(patched.appearance.accentColor, previousDefaults().appearance.accentColor, 'accentColor is kept for a later switch back');
    } finally { await app.close(); }
    assert.equal((await DataStore.open(directory)).snapshot().settings.appearance.accentMode, 'native');
    const store = await DataStore.open(directory);
    await store.patchSettings({ appearance: { accentMode: 'color', accentColor: '#88afa6', preset: 'custom' } });
    const reopened = (await DataStore.open(directory)).snapshot().settings.appearance;
    assert.equal(reopened.accentMode, 'color'); assert.equal(reopened.accentColor, '#88afa6');
    assert.equal('accentMode' in (await readJson(directory, 'state.json')).settings.appearance, false, 'color is omitted at rest');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('rollback: a user who never picks Native stays readable by the previous release', async () => {
  const directory = await temporary('lrd-native-rollback-color-');
  try {
    await previousRelease(directory);
    const app = await application(directory);
    try {
      const steps: [string, () => Promise<unknown>][] = [
        ['brightness', () => app.send('PATCH', '/api/settings', { appearance: { brightness: 0.4, preset: 'custom' } })],
        ['colour swatch', () => app.send('PATCH', '/api/settings', { appearance: { accentMode: 'color', accentColor: '#b8a17a', preset: 'custom' } })],
        ['custom colour', () => app.send('PATCH', '/api/settings', { appearance: { accentColor: '#123456' } })],
        ['saved style', () => app.send('PATCH', '/api/settings', { savedPresets: [{ id: 'colour-style', name: 'Colour style', visual: getVisual(app.store.snapshot().settings) }] })],
      ];
      for (const [label, step] of steps) {
        await step();
        assertPreviousReaderAccepts('data', await readJson(directory, 'state.json'), `${label} state.json`);
        assertPreviousReaderAccepts('data', await readJson(directory, 'state.backup.json'), `${label} state.backup.json`);
      }
      assertPreviousReaderAccepts('import', await app.send('GET', '/api/export'), 'export of a colour-only user');
      assert.equal(app.store.snapshot().settings.appearance.accentMode, 'color');
    } finally { await app.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('rollback: saving Native anywhere is the documented exception the previous release rejects', async () => {
  const scenarios: [string, (settings: Settings) => Settings][] = [
    ['Native in settings', settings => ({ ...settings, appearance: { ...settings.appearance, accentMode: 'native', preset: 'custom' } })],
    ['a built-in style', settings => applyBuiltinPreset(settings, 'night')],
    ['Reset appearance', settings => applyBuiltinPreset(settings, 'room')],
    ['a saved Native style', settings => ({ ...settings, savedPresets: [{ id: 'native-style', name: 'Native style', visual: getVisual({ ...settings, appearance: { ...settings.appearance, accentMode: 'native' } }) }] })],
  ];
  for (const [label, edit] of scenarios) {
    const directory = await temporary('lrd-native-rollback-native-');
    try {
      await previousRelease(directory);
      const app = await application(directory);
      try {
        const saved = app.store.snapshot().settings;
        await app.send('PATCH', '/api/settings', settingsChanges(saved, edit(structuredClone(saved))));
        assertPreviousReaderRejects('data', await readJson(directory, 'state.json'), `${label} state.json`);
        assertPreviousReaderRejects('import', await app.send('GET', '/api/export'), `${label} export`);
        assertPreviousReaderAccepts('data', await readJson(directory, 'state.backup.json'), `${label} backup of the pre-Native save`);
      } finally { await app.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
