import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createPhotoAsset, inspectPhoto } from './photo.ts';
import { photoFixture } from './fixtures.ts';
import { DataStore } from './store.ts';

test('normalized raster validation rejects corruption, misleading sizes and decompression expansion', () => {
  const png = photoFixture(); assert.deepEqual(inspectPhoto(png), { width: 2, height: 2 });
  assert.equal(createPhotoAsset(png.toString('base64'), '2026-10-18T00:00:00.000Z').id, createHash('sha256').update(png).digest('hex'));
  const corrupt = Buffer.from(png); corrupt[45] = corrupt[45]! ^ 255;
  assert.throws(() => inspectPhoto(corrupt));
  assert.throws(() => inspectPhoto(Buffer.concat([png, Buffer.from('<script>')])));
  assert.throws(() => inspectPhoto(photoFixture(2049, 1)));
  assert.throws(() => inspectPhoto(photoFixture(1, 1, Buffer.alloc(100_000))), /pixel/);
  assert.throws(() => inspectPhoto(photoFixture(1, 1, Buffer.from([5, 0, 0, 0, 0]))), /filter/);
  assert.throws(() => inspectPhoto(Buffer.from('<svg onload="alert(1)"></svg>')));
});

test('photo replacement and settings save are one persisted atomic operation, with safe rejection and clear', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-photo-'));
  try {
    const store = await DataStore.open(directory); const pngBase64 = photoFixture().toString('base64');
    await store.patchSettings({ appearance: { brightness: 0.35 }, photoChange: { pngBase64 } });
    const saved = store.snapshot();
    assert.equal(saved.settings.appearance.brightness, 0.35); assert.equal(saved.photoAsset?.pngBase64, pngBase64);
    assert.equal('photoChange' in saved.settings, false);
    const reopened = await DataStore.open(directory); assert.equal(reopened.snapshot().photoAsset?.id, saved.photoAsset?.id);
    await assert.rejects(store.patchSettings({ appearance: { brightness: 9 }, photoChange: null }));
    assert.equal(store.snapshot().photoAsset?.id, saved.photoAsset?.id, 'invalid settings cannot clear an existing photo');
    await assert.rejects(store.patchSettings({ units: 'imperial', photoChange: { pngBase64: Buffer.from('not a photo').toString('base64') } }));
    assert.equal(store.snapshot().settings.units, 'metric', 'invalid image cannot partly save settings');
    assert.equal(store.snapshot().photoAsset?.id, saved.photoAsset?.id);
    await store.patchSettings({ photoChange: null });
    assert.equal((await DataStore.open(directory)).snapshot().photoAsset, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
