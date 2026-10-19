import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createPhotoAsset, inspectPhoto, photoInspections } from './photo.ts';
import { photoFixture } from './fixtures.ts';
import { DataStore } from './store.ts';
import { settingsPatchSchema } from './validation.ts';

/** A synthetic noise photo: random RGBA pixels barely compress, so the PNG is about width × height × 4 bytes. */
function noisePhoto(width: number, height: number): Buffer {
  const pixels = randomBytes((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) pixels[row * (width * 4 + 1)] = 0;
  return photoFixture(width, height, pixels);
}

test('normalized raster validation rejects corruption, misleading sizes and decompression expansion', () => {
  const png = photoFixture(); assert.deepEqual(inspectPhoto(png), { width: 2, height: 2 });
  assert.equal(createPhotoAsset(png.toString('base64'), '2026-10-18T00:00:00.000Z').id, createHash('sha256').update(png).digest('hex'));
  const corrupt = Buffer.from(png); corrupt[45] = corrupt[45]! ^ 255;
  assert.throws(() => inspectPhoto(corrupt));
  // The native CRC-32 (#245) still catches a changed chunk byte and a changed checksum.
  const header = Buffer.from(png); header[20] = header[20]! ^ 1;
  assert.throws(() => inspectPhoto(header), /checksum/);
  const checksum = Buffer.from(png); checksum[29] = checksum[29]! ^ 1;
  assert.throws(() => inspectPhoto(checksum), /checksum/);
  assert.deepEqual(inspectPhoto(noisePhoto(64, 48)), { width: 64, height: 48 });
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

test('a stored photo is inspected when it changes, never again on ordinary saves (#245)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-photo-checks-'));
  try {
    const store = await DataStore.open(directory); const png = noisePhoto(256, 192); const pngBase64 = png.toString('base64');
    let before = photoInspections.count;
    // The PATCH boundary checks the upload once; building and saving the asset reuse that result.
    await store.patchSettings(settingsPatchSchema.parse({ appearance: { brightness: 0.4 }, photoChange: { pngBase64 } }));
    assert.equal(photoInspections.count - before, 1, 'one inspection for a photo upload');
    const saved = store.snapshot().photoAsset; assert.equal(saved?.id, createHash('sha256').update(png).digest('hex'));
    before = photoInspections.count;
    for (let index = 0; index < 5; index++) {
      await store.update(data => { data.reminders.push({ id: crypto.randomUUID(), text: `Synthetic ${index}`, completed: false, dueAt: null, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' }); });
      await store.patchSettings({ appearance: { brightness: 0.3 + index / 20 } });
    }
    await store.update(data => { data.settings = structuredClone(data.settings); });
    assert.equal(photoInspections.count - before, 0, 'reminder and settings saves keep the checked photo without inspecting it');
    assert.equal(store.snapshot().photoAsset?.pngBase64, pngBase64);
    // A changed photo is still checked in full: forged metadata or bytes are rejected, nothing is saved.
    await assert.rejects(store.update(data => { data.photoAsset = { ...data.photoAsset!, width: 255 }; }), /metadata/);
    const flipped = Buffer.from(png); flipped[100] = flipped[100]! ^ 1;
    await assert.rejects(store.update(data => { data.photoAsset = { ...data.photoAsset!, pngBase64: flipped.toString('base64') }; }), /checksum/);
    assert.equal(store.snapshot().photoAsset?.pngBase64, pngBase64);
    // Startup and recovery read the file as untrusted data and inspect the photo again.
    before = photoInspections.count;
    assert.equal((await DataStore.open(directory)).snapshot().photoAsset?.id, saved?.id);
    assert.ok(photoInspections.count - before <= 1, 'startup inspects the saved photo at most once');
    const file = join(directory, 'state.json'); const original = await readFile(file, 'utf8');
    const tampered = JSON.parse(original); tampered.photoAsset.pngBase64 = flipped.toString('base64');
    await writeFile(file, JSON.stringify(tampered));
    const recovered = await DataStore.open(directory);
    assert.match(recovered.warning ?? '', /Recovered/, 'a photo changed on disk fails the startup check and the backup is used');
    assert.equal(recovered.snapshot().photoAsset?.pngBase64, pngBase64);
    await store.patchSettings({ photoChange: null });
    assert.equal(store.snapshot().photoAsset, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
