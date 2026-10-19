// Rollback compatibility (#84): default-choice data written by this build must still parse with the
// frozen reader of the previous installed release. Synthetic data in temporary folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture, photoFixture } from './fixtures.ts';
import { DataStore } from './store.ts';
import { PREVIOUS_RELEASE } from './persistence.ts';
import { PREVIOUS_READER, VENDORED_BLOBS, assertPreviousReaderAccepts, assertPreviousReaderRejects } from './compat/previous-reader.ts';
import { defaultSettings as previousDefaults } from './compat/bedca44/shared/defaults.ts';
import { WIDGET_CATALOG as PREVIOUS_CATALOG, defaultWidgetGrid as previousGrid } from './compat/bedca44/shared/widgets.ts';
import { fitGridDensity } from '../shared/widgets.ts';
import type { Settings } from '../shared/contracts.ts';

async function application(directory: string) {
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const send = async (method: string, path: string, value?: unknown) => {
    const response = await fetch(`${url}${path}`, value === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    assert.ok(response.status < 300, `${method} ${path} returned ${response.status}: ${await response.clone().text()}`);
    return response.status === 204 ? null : response.json();
  };
  return { ...app, url, send, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); } };
}
async function readJson(directory: string, name: string): Promise<unknown> { return JSON.parse(await readFile(join(directory, name), 'utf8')); }
async function assertFilesAccepted(directory: string, label: string, backup = true) {
  assertPreviousReaderAccepts('data', await readJson(directory, 'state.json'), `${label} state.json`);
  if (backup) assertPreviousReaderAccepts('data', await readJson(directory, 'state.backup.json'), `${label} state.backup.json`);
}
async function temporary(prefix: string) { return mkdtemp(join(tmpdir(), prefix)); }

test('the frozen reader is an unedited copy of the previous release and its catalog matches PREVIOUS_RELEASE', async () => {
  for (const [path, blob] of Object.entries(VENDORED_BLOBS)) {
    const bytes = await readFile(new URL(`./compat/${path}`, import.meta.url));
    const id = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(id, blob, `${path} must stay byte-for-byte identical to ${PREVIOUS_READER.revision.slice(0, 7)}`);
  }
  assert.equal(PREVIOUS_READER.revision, PREVIOUS_RELEASE.revision);
  assert.deepEqual(Object.keys(PREVIOUS_CATALOG), [...PREVIOUS_RELEASE.widgetIds]);
  assert.deepEqual(PREVIOUS_READER.widgetIds, [...PREVIOUS_RELEASE.widgetIds]);
});

test('(a) a fresh data folder differs from previous-release data only by Native colours (#75)', async () => {
  const directory = await temporary('lrd-rollback-fresh-');
  try {
    const store = await DataStore.open(directory);
    // New installs start Native, the documented #75 exception; nothing else in a fresh folder is new.
    const fresh = await readJson(directory, 'state.json') as { settings: { appearance: Record<string, unknown> } };
    assertPreviousReaderRejects('data', fresh, 'fresh Native state.json');
    assert.equal(fresh.settings.appearance.accentMode, 'native');
    delete fresh.settings.appearance.accentMode;
    assertPreviousReaderAccepts('data', fresh, 'fresh state.json without its accent mode');
    // Choosing a colour and saving once more leaves both files readable.
    await store.patchSettings({ appearance: { accentMode: 'color' } });
    await store.patchSettings({ units: 'imperial' });
    await assertFilesAccepted(directory, 'fresh after choosing a colour');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('(b, c) previous-release data stays readable after unrelated saves, and so does its export', async () => {
  const directory = await temporary('lrd-rollback-saves-');
  const previous = { version: 1, settings: previousDefaults(), reminders: [], photoAsset: null };
  assertPreviousReaderAccepts('data', previous, 'synthetic previous-release state');
  await writeFile(join(directory, 'state.json'), JSON.stringify(previous, null, 2));
  const app = await application(directory);
  try {
    const steps: [string, () => Promise<unknown>][] = [
      ['brightness', () => app.send('PATCH', '/api/settings', { appearance: { brightness: 0.4, preset: 'custom' } })],
      ['clock style digital', () => app.send('PATCH', '/api/settings', { appearance: { clockStyle: 'digital' } })],
      ['widget move', () => app.send('PATCH', '/api/settings', { widgetGrid: { placements: { reminders: { column: 4, row: 4 } } } })],
      ['density change', async () => {
        const settings = app.store.snapshot().settings;
        const fit = fitGridDensity(settings.widgetGrid, 'fine', settings.widgets); assert.ok(fit);
        return app.send('PATCH', '/api/settings', { widgetGrid: { density: 'fine', placements: fit.grid.placements } });
      }],
      ['reminder lifecycle', async () => {
        const reminder = await app.send('POST', '/api/reminders', { text: 'Synthetic reminder', dueAt: null }) as { id: string };
        await assertFilesAccepted(directory, 'reminder added');
        await app.send('PATCH', `/api/reminders/${reminder.id}`, { completed: true });
        await assertFilesAccepted(directory, 'reminder completed');
        await app.send('POST', '/api/reminders', { text: 'Kept reminder' });
        await app.send('DELETE', `/api/reminders/${reminder.id}`);
      }],
      ['saved style', () => {
        const { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview }: Settings = app.store.snapshot().settings;
        return app.send('PATCH', '/api/settings', { savedPresets: [{ id: 'synthetic-style', name: 'Synthetic style', visual: { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } }] });
      }],
      ['photo', () => app.send('PATCH', '/api/settings', { photoChange: { pngBase64: photoFixture().toString('base64') } })],
    ];
    for (const [label, step] of steps) {
      await step();
      await assertFilesAccepted(directory, label);
    }
    const settings = app.store.snapshot().settings;
    assert.equal(settings.appearance.clockStyle, 'digital');
    assert.equal(settings.widgetGrid.density, 'fine');
    assert.equal(settings.savedPresets.length, 1);
    assert.equal(app.store.snapshot().reminders.length, 1);
    assert.ok(app.store.snapshot().photoAsset);
    // (c) The export after those saves imports into the previous release.
    assertPreviousReaderAccepts('import', await app.send('GET', '/api/export'), 'export after saves');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('(d) a revision-one legacy file stays readable after it is opened and saved', async () => {
  const directory = await temporary('lrd-rollback-legacy-');
  try {
    const settings = JSON.parse(JSON.stringify(previousDefaults()));
    settings.widgetGrid = previousGrid(1); delete settings.widgetGrid.revision;
    delete settings.widgetBehavior; delete settings.appearance.clockStyle; delete settings.locationSource;
    await writeFile(join(directory, 'state.json'), JSON.stringify({ version: 1, settings, reminders: [] }));
    const store = await DataStore.open(directory);
    assert.equal(store.snapshot().settings.widgetGrid.revision, 2);
    await store.patchSettings({ units: 'imperial' });
    await assertFilesAccepted(directory, 'legacy after save');
    const reopened = (await DataStore.open(directory)).snapshot().settings;
    assert.equal(reopened.units, 'imperial');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('(e) non-default additive choices are the documented exceptions the previous release rejects', async () => {
  for (const [label, patch] of [
    ['accentMode native', { appearance: { accentMode: 'native' } }],
    ['animation lively', { appearance: { animation: 'lively' } }],
    ['non-default widgetData', { widgetData: { note: { text: 'Synthetic note' } } }],
  ] as const) {
    const directory = await temporary('lrd-rollback-negative-');
    try {
      // Start from previous-release data: a fresh folder is already Native (#75).
      await writeFile(join(directory, 'state.json'), JSON.stringify({ version: 1, settings: previousDefaults(), reminders: [], photoAsset: null }));
      const store = await DataStore.open(directory);
      await store.patchSettings(patch);
      assertPreviousReaderRejects('data', await readJson(directory, 'state.json'), label);
      assertPreviousReaderAccepts('data', await readJson(directory, 'state.backup.json'), `${label} backup of the previous save`);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
