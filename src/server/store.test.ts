import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataStore } from './store.ts';

test('queued concurrent writes preserve changes and survive restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-store-'));
  try {
    const store = await DataStore.open(directory);
    await Promise.all([store.patchSettings({ units: 'imperial' }), store.patchSettings({ appearance: { fontScale: 1.3 } }), store.patchSettings({ location: { name: 'My city' } })]);
    const reopened = await DataStore.open(directory);
    assert.equal(reopened.snapshot().settings.units, 'imperial');
    assert.equal(reopened.snapshot().settings.appearance.fontScale, 1.3);
    assert.equal(reopened.snapshot().settings.location.name, 'My city');
    await assert.rejects(store.patchSettings({ appearance: { brightness: 8 } }));
    assert.equal(store.snapshot().settings.appearance.brightness, 0.55);
    await store.patchSettings({ clockFormat: '24h' });
    assert.equal(store.snapshot().settings.clockFormat, '24h', 'queue remains usable after failed mutation');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('corrupt primary recovers the last valid backup without overwriting evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-recovery-'));
  try {
    const store = await DataStore.open(directory);
    await store.patchSettings({ units: 'imperial' });
    await store.patchSettings({ clockFormat: '24h' });
    await writeFile(join(directory, 'state.json'), 'broken');
    const recovered = await DataStore.open(directory);
    assert.equal(recovered.snapshot().settings.units, 'imperial');
    assert.equal(recovered.snapshot().settings.clockFormat, '12h');
    assert.match(recovered.warning!, /Recovered/);
    assert.equal(await readFile(join(directory, 'state.corrupt.json'), 'utf8'), 'broken');
    await rm(join(directory, 'state.json'));
    assert.equal((await DataStore.open(directory)).snapshot().settings.units, 'imperial', 'a missing primary also recovers the backup');
    await writeFile(join(directory, 'state.json'), 'broken again');
    await writeFile(join(directory, 'state.backup.json'), 'also broken');
    await assert.rejects(DataStore.open(directory), /Preserve the data folder/);
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), 'broken again');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
