import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';

test('health reports the package.json version with an unchanged response shape', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-health-'));
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => { throw new Error('no network in this test'); } });
  try {
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    const address = app.server.address(); assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as Record<string, unknown>;
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    assert.match(manifest.version, /^\d+\.\d+\.\d+/);
    assert.equal(body.version, manifest.version, 'the installer health check compares this with release.json');
    assert.equal(body.status, 'ok');
    // storageWarning is null when there is no recovery warning (a fresh data folder), and a message after a recovery (#198).
    assert.equal(body.storageWarning, null, 'a fresh data folder has no storage warning');
    assert.deepEqual(Object.keys(body).sort(), ['status', 'storageWarning', 'version'], 'the health body keeps exactly these keys');
  } finally {
    app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
    await rm(directory, { recursive: true, force: true });
  }
});

test('health reports the recovery warning as a string after a backup recovery (#198)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-health-recovered-'));
  try {
    const first = await createApplication({ dataDirectory: directory, fetcher: async () => { throw new Error('no network in this test'); } });
    await first.store.patchSettings({ units: 'imperial' }); await first.store.patchSettings({ clockFormat: '24h' });
    await writeFile(join(directory, 'state.json'), 'synthetic corruption');
    const app = await createApplication({ dataDirectory: directory, fetcher: async () => { throw new Error('no network in this test'); } });
    try {
      app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
      const address = app.server.address(); assert.ok(address && typeof address === 'object');
      const body = await (await fetch(`http://127.0.0.1:${address.port}/api/health`)).json() as Record<string, unknown>;
      assert.equal(body.status, 'ok');
      assert.match(String(body.storageWarning), /Recovered the previous saved state from backup/);
    } finally { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
