import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture, photoFixture } from './fixtures.ts';
import type { PreparationBootstrap, PreparationConfig } from './preidle.ts';

// Real API handlers with synthetic data and an inert preparer factory only.
// No installed endpoint, child process, desktop, window or image capture is used.
async function fixture(withPreparation = false) {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-native-session-synthetic-'));
  const clock = { wall: Date.parse('2026-10-25T16:00:00Z'), mono: 10_000 };
  let bootstrap!: PreparationBootstrap, children = 0;
  const app = await createApplication({ dataDirectory: directory, now: () => clock.wall,
    preparationMonotonic: () => clock.mono, fetcher: async () => Response.json(forecastFixture()),
    preparation: withPreparation ? { source: 'a'.repeat(40), start(value) {
      bootstrap = value; children++; return { stop() {} };
    } } : undefined });
  if (withPreparation) await app.store.update(data => { data.settings.idle.enabled = true; });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const requests: ReturnType<typeof httpRequest>[] = [];
  function send(path: string, method = 'GET', headers: Record<string, string> = {}, content?: Buffer, delayed = false) {
    let request!: ReturnType<typeof httpRequest>;
    const response = new Promise<{ status: number; content: Buffer }>((resolve, reject) => {
      request = httpRequest(url + path, { method, headers }, incoming => {
        const chunks: Buffer[] = []; incoming.on('data', chunk => chunks.push(chunk));
        incoming.on('end', () => resolve({ status: incoming.statusCode!, content: Buffer.concat(chunks) }));
      });
      request.on('error', reject);
      if (delayed) request.write(content!.subarray(0, 8)); else request.end(content);
    });
    response.catch(() => {}); // Teardown may abort a deliberately unfinished body.
    if (request) requests.push(request);
    return { response, finish() { request.end(content!.subarray(8)); } };
  }
  const native = (path: string, method = 'GET', headers: Record<string, string> = {}, content?: Buffer) =>
    send(path, method, headers, content).response;
  const session = async () => {
    const response = await native('/api/host/session', 'GET', { 'X-LRD-Native': '1' });
    assert.equal(response.status, 200); return JSON.parse(response.content.toString()) as { token: string; preparationPipe: string | null };
  };
  const uploadHeaders = (token: string) => ({ 'X-LRD-Token': token, 'Content-Type': 'image/png',
    'X-Captured-At': new Date(clock.wall).toISOString() });
  const current = async () => JSON.parse((await native('/api/preview')).content.toString());
  return { ...app, url, directory, clock, native, send, session, uploadHeaders, current,
    get bootstrap() { return bootstrap; }, get children() { return children; },
    advance(milliseconds: number) { clock.wall += milliseconds; clock.mono += milliseconds; },
    async close() {
      for (const request of requests) request.destroy();
      app.closePreparation(); app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
      await rm(directory, { recursive: true, force: true });
    } };
}

test('a replacement native session refuses the old helper cleanup and upload', async () => {
  const app = await fixture();
  const first = photoFixture(), replacement = photoFixture(3, 2);
  try {
    const old = await app.session();
    assert.equal((await app.native('/api/preview', 'POST', app.uploadHeaders(old.token), first)).status, 201);
    app.advance(10);
    const next = await app.session();
    const capturedAt = new Date(app.clock.wall).toISOString();
    assert.equal((await app.native('/api/preview', 'POST', app.uploadHeaders(next.token), replacement)).status, 201);
    assert.equal((await app.native('/api/preview', 'DELETE', { 'X-LRD-Token': old.token })).status, 403,
      'a delayed old helper clear must not erase a replacement frame');
    assert.equal((await app.current()).capturedAt, capturedAt);
    assert.deepEqual((await app.native('/api/preview/image')).content, replacement);
    assert.equal((await app.native('/api/preview', 'POST', app.uploadHeaders(old.token), first)).status, 403);
    assert.notEqual(old.token, next.token);
    assert.equal((await app.native('/api/preview', 'DELETE', { 'X-LRD-Token': next.token })).status, 204);
    assert.equal((await app.current()).available, false, 'the current helper still clears normally');
    assert.equal((await app.native('/api/preview/image')).status, 404);
  } finally { await app.close(); }
});

test('a replacement handshake rejects an old upload already receiving its body', async () => {
  const app = await fixture();
  try {
    const old = await app.session(), first = photoFixture();
    const bodyStarted = new Promise<void>(resolve => app.server.once('request', request => request.once('data', () => resolve())));
    const delayed = app.send('/api/preview', 'POST', app.uploadHeaders(old.token), first, true);
    await bodyStarted;
    app.advance(10); const next = await app.session();
    const replacement = photoFixture(3, 2), capturedAt = new Date(app.clock.wall).toISOString();
    assert.equal((await app.native('/api/preview', 'POST', app.uploadHeaders(next.token), replacement)).status, 201);
    delayed.finish();
    assert.equal((await delayed.response).status, 403, 'authorization must be rechecked at old body completion');
    assert.equal((await app.current()).capturedAt, capturedAt);
    assert.deepEqual((await app.native('/api/preview/image')).content, replacement);
  } finally { await app.close(); }
});

test('denied browser or untrusted handshakes cannot replace the current native session', async () => {
  const app = await fixture();
  try {
    const current = await app.session();
    assert.equal((await app.native('/api/preview', 'POST', app.uploadHeaders(current.token), photoFixture())).status, 201);
    const denied: Record<string, string>[] = [{}, { 'X-LRD-Native': '1', Origin: app.url },
      { 'X-LRD-Native': '1', 'Sec-Fetch-Mode': 'cors' }, { 'X-LRD-Native': '1', Host: 'untrusted.example' }];
    for (const headers of denied) {
      assert.equal((await app.native('/api/host/session', 'GET', headers)).status, 403);
    }
    assert.equal((await app.native('/api/preview', 'DELETE', { 'X-LRD-Token': current.token, Origin: app.url })).status, 403);
    assert.equal((await app.native('/api/preview', 'DELETE', { 'X-LRD-Token': current.token, 'Sec-Fetch-Site': 'same-origin' })).status, 403);
    assert.equal((await app.current()).available, true);
    assert.equal((await app.native('/api/preview', 'DELETE', { 'X-LRD-Token': current.token })).status, 204);
  } finally { await app.close(); }
});

test('native handshake clears the earlier active image but preserves the private pending frame and preparer capability', async () => {
  const app = await fixture(true);
  try {
    const old = await app.session();
    assert.equal((await app.native('/api/preview', 'POST', app.uploadHeaders(old.token), photoFixture(3, 2))).status, 201);
    const auth = { 'X-LRD-Preparation': app.bootstrap.token };
    const config = async () => {
      const result = await app.native('/api/preview/preparation', 'GET', auth);
      assert.equal(result.status, 200); return JSON.parse(result.content.toString()) as PreparationConfig;
    };
    const before = await config(); assert.equal(before.enabled, true);
    const prepared = photoFixture();
    assert.equal((await app.native('/api/preview/preparation', 'POST', { ...auth, 'Content-Type': 'image/png',
      'X-Preparation-Generation': String(before.generation), 'X-Preparation-Configuration': before.configuration,
      'X-Input-Tick': '123', 'X-Session-Id': '1', 'X-Desktop-Id': 'Default', 'X-Captured-At': new Date(app.clock.wall - 100).toISOString(),
      'X-Completed-At': new Date(app.clock.wall).toISOString(), 'X-Completed-Monotonic-Ms': String(app.clock.mono) }, prepared)).status, 201);
    app.advance(3_100);
    const next = await app.session();
    assert.equal((await app.current()).available, false, 'a new native session must not reuse the earlier active image');
    assert.equal(next.preparationPipe, old.preparationPipe); assert.equal(app.children, 1);
    const after = await config();
    assert.equal(after.generation, before.generation); assert.equal(after.configuration, before.configuration);
    const claim = await app.native('/api/preview/preparation/claim', 'POST', { ...auth, 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify({
      generation: before.generation, configuration: before.configuration, processId: 200,
      processStartedAt: new Date(app.clock.wall - 100).toISOString(), startedMonotonicMs: app.clock.mono - 100,
      inputTick: 123, sessionId: 1, desktopId: 'Default',
    })));
    assert.equal(claim.status, 200); assert.equal(JSON.parse(claim.content.toString()).claimed, true);
    assert.deepEqual((await app.native('/api/preview/image')).content, prepared);
    assert.equal((await app.native('/api/preview', 'DELETE', { 'X-LRD-Token': old.token })).status, 403);
    assert.deepEqual((await app.native('/api/preview/image')).content, prepared, 'old clear cannot invalidate a newly claimed automatic frame');
    assert.ok((await readdir(app.directory)).every(name => ['state.json', 'state.backup.json'].includes(name)), 'synthetic pixels remain in RAM');
    assert.equal((await app.native('/api/preview', 'DELETE', { 'X-LRD-Token': next.token })).status, 204);
  } finally { await app.close(); }
});
