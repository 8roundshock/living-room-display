import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { photoFixture } from './fixtures.ts';
import { SnapshotFile, SNAPSHOT_NAME } from './snapshot-file.ts';

async function fixture(replace?: Parameters<typeof SnapshotFile.open>[2]) {
  const directory = await mkdtemp(join(tmpdir(), 'still-file-fixture-'));
  const store = await SnapshotFile.open(directory, undefined, replace);
  return { directory, store, async close() { await store.clear(); await rm(directory, { recursive: true }); } };
}
const first = '2026-10-27T14:00:00.000Z', second = '2026-10-27T14:05:00.000Z';

test('one atomic PNG supplies bytes, dimensions and capture time to every reader', async () => {
  const f = await fixture();
  try {
    const png = photoFixture(3, 2);
    assert.equal(await f.store.write(png, first, () => true), true);
    for (let i = 0; i < 2; i++) {
      const frame = await f.store.read(first);
      assert.deepEqual(frame?.content, png);
      assert.deepEqual(frame?.preview, { available: true, capturedAt: first, width: 3, height: 2 });
      frame?.content.fill(0);
    }
    const next = photoFixture(4, 3);
    assert.equal(await f.store.write(next, second, () => true), true);
    assert.equal(await f.store.read(first), null, 'a stale caption cannot receive newer pixels');
    assert.deepEqual(await readFile(join(f.directory, SNAPSHOT_NAME)), next);
    assert.deepEqual(await readdir(f.directory), [SNAPSHOT_NAME], 'no history, backup or orphan temp');
  } finally { await f.close(); }
});

test('a failed atomic replacement retains the previous complete success and removes its temp', async () => {
  let fail = false;
  const { rename } = await import('node:fs/promises');
  const f = await fixture(async (from, to) => { if (fail) throw Object.assign(new Error('synthetic'), { code: 'EBUSY' }); await rename(from, to); });
  try {
    const png = photoFixture(); await f.store.write(png, first, () => true); fail = true;
    assert.equal(await f.store.write(photoFixture(3, 2), second, () => true), false);
    assert.deepEqual((await f.store.read())?.content, png);
    assert.equal(f.store.state().capturedAt, first);
    assert.deepEqual(f.store.pipeline(), { phase: 'write-failed', writes: 1, failures: 1 });
    assert.deepEqual(await readdir(f.directory), [SNAPSHOT_NAME]);
  } finally { await f.close(); }
});

test('clear while publication is queued cannot restore a frame or leave a temp', async () => {
  const f = await fixture();
  try {
    await f.store.write(photoFixture(), first, () => true);
    const incoming = f.store.write(photoFixture(3, 2), second, () => true);
    const cleared = f.store.clear();
    assert.equal(await incoming, false); await cleared;
    assert.equal(await f.store.read(), null); assert.deepEqual(await readdir(f.directory), []);
  } finally { await f.close(); }
});

test('an unknown prior-session PNG and orphan temp are removed instead of adopted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'still-file-startup-'));
  try {
    await writeFile(join(directory, SNAPSHOT_NAME), photoFixture());
    await writeFile(join(directory, '.last-screen.tmp'), photoFixture());
    const store = await SnapshotFile.open(directory);
    assert.equal(store.state().available, false); assert.equal(await store.read(), null);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true }); }
});
