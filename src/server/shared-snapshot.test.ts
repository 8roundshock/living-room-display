import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture, photoFixture } from './fixtures.ts';
import type { PreparationBootstrap, PreparationConfig } from './preidle.ts';

// Synthetic source backend only. Every data/cache path belongs to this fixture,
// and the explicit factory never starts a native process or captures a desktop.
async function fixture(development = false, injectMonotonic = true) {
  const root = await mkdtemp(join(tmpdir(), 'lrd-shared-snapshot-synthetic-'));
  const dataDirectory = join(root, 'data'), snapshotDirectory = join(root, 'cache');
  const clock = { wall: Date.parse('2026-10-27T16:00:00Z'), mono: 10_000 };
  let bootstrap!: PreparationBootstrap;
  const app = await createApplication({ dataDirectory, snapshotDirectory, development,
    now: () => clock.wall, ...(injectMonotonic ? { preparationMonotonic: () => clock.mono } : {}),
    fetcher: async () => Response.json(forecastFixture()),
    preparation: { source: 'a'.repeat(40), start(value) { bootstrap = value; return { stop() {} }; } } });
  await app.store.update(data => {
    data.settings.idle.enabled = true;
    data.settings.widgets.preview = true;
    data.settings.preview.enabled = true;
  });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  assert.equal(bootstrap.sharedSnapshot, true);
  const requests: ReturnType<typeof httpRequest>[] = [];
  const request = (path: string, method = 'GET', headers: Record<string, string> = {}, content?: Buffer) =>
    new Promise<{ status: number; body: Buffer; headers: IncomingHttpHeaders }>((done, reject) => {
      const outgoing = httpRequest(url + path, { method, headers }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => done({ status: response.statusCode!, body: Buffer.concat(chunks), headers: response.headers }));
        response.on('error', reject);
      });
      requests.push(outgoing); outgoing.on('error', reject); outgoing.end(content);
    });
  const auth = () => ({ 'X-LRD-Preparation': bootstrap.token });
  const config = async () => {
    const response = await request('/api/preview/preparation', 'GET', { ...auth(),
      'X-Preparation-Safe': '1', 'X-Session-Id': '1', 'X-Preparation-Capture-Eligible': '1' });
    assert.equal(response.status, 200);
    return JSON.parse(response.body.toString()) as PreparationConfig & { capturePaused: boolean; captureRevision: number };
  };
  const uploadHeaders = (current: Awaited<ReturnType<typeof config>>) => ({ ...auth(), 'Content-Type': 'image/png',
    'X-Preparation-Generation': String(current.generation), 'X-Preparation-Configuration': current.configuration,
    'X-Preparation-Capture-Revision': String(current.captureRevision),
    'X-Input-Tick': '123', 'X-Session-Id': '1', 'X-Desktop-Id': 'Default',
    'X-Captured-At': new Date(clock.wall - 100).toISOString(), 'X-Completed-At': new Date(clock.wall).toISOString(),
    'X-Completed-Monotonic-Ms': String(clock.mono), 'X-Idle-Timeout-Seconds': String(current.timeoutSeconds) });
  const upload = async (png = photoFixture(), current?: Awaited<ReturnType<typeof config>>) => {
    const selected = current ?? await config(), headers = uploadHeaders(selected);
    const response = await request('/api/preview/preparation', 'POST', headers, png);
    return { ...response, png, capturedAt: headers['X-Captured-At'] };
  };
  const preview = async () => {
    const response = await request('/api/preview'); assert.equal(response.status, 200);
    return JSON.parse(response.body.toString()) as { available: boolean; capturedAt: string | null; width: number | null; height: number | null };
  };
  const displayHeaders = () => ({ Origin: url, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty', 'X-LRD-Display': '1', 'Content-Type': 'application/json' });
  const display = (action: unknown, headers = displayHeaders()) =>
    request('/api/preview/display', 'POST', headers, Buffer.from(JSON.stringify(action)));
  return { ...app, root, snapshotDirectory, file: join(snapshotDirectory, 'last-screen.png'), clock, url,
    request, auth, config, upload, uploadHeaders, preview, display, displayHeaders,
    advance(ms: number) { clock.wall += ms; clock.mono += ms; },
    async close() {
      for (const outgoing of requests) outgoing.destroy();
      app.closePreparation(); app.server.closeAllConnections();
      const closed = once(app.server, 'close'); app.server.close(); await closed;
      assert.ok(isAbsolute(root) && dirname(resolve(root)) === resolve(tmpdir()) && basename(root).startsWith('lrd-shared-snapshot-synthetic-'));
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    } };
}

async function missing(path: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await stat(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    await new Promise(done => setTimeout(done, 10));
  }
  assert.fail('The owned synthetic snapshot file was not removed');
}

test('display presence accepts only the existing explicit Vite origins in development mode', async () => {
  for (const development of [false, true]) {
    const app = await fixture(development);
    try {
      for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173']) {
        const result = await app.display({ action: 'start' }, { ...app.displayHeaders(), Origin: origin });
        assert.equal(result.status, development ? 201 : 403);
        if (result.status === 201) {
          const id = JSON.parse(result.body.toString()).id;
          assert.equal((await app.display({ action: 'release', id }, { ...app.displayHeaders(), Origin: origin })).status, 204);
        }
      }
      assert.equal((await app.display({ action: 'start' }, { ...app.displayHeaders(), Origin: 'http://localhost:5174' })).status, 403);
    } finally { await app.close(); }
  }
});

test('display presence ignores business wall-clock jumps but actual elapsed expiry remains fail-closed', async () => {
  const wallOnly = await fixture();
  try {
    const opened = await wallOnly.display({ action: 'start' });
    const id = JSON.parse(opened.body.toString()).id;
    wallOnly.clock.wall += 61_000;
    assert.equal((await wallOnly.display({ action: 'heartbeat', id })).status, 204, 'a timer/business clock jump is not elapsed presence time');
  } finally { await wallOnly.close(); }
  const elapsed = await fixture();
  try {
    const opened = await elapsed.display({ action: 'start' });
    const id = JSON.parse(opened.body.toString()).id;
    elapsed.clock.mono += 20_001;
    assert.equal((await elapsed.display({ action: 'heartbeat', id })).status, 409);
    const status = JSON.parse((await elapsed.request('/api/preview')).body.toString()).pipeline.display;
    assert.deepEqual(status, { paused: true, needsResume: true });
    assert.equal((await elapsed.display({ action: 'resume', confirmedAllClosed: true })).status, 204);
  } finally { await elapsed.close(); }
});

test('producer publication is immediately shared by state/browser/native image readers without a claim', async () => {
  const app = await fixture();
  try {
    const uploaded = await app.upload(photoFixture(3, 2)); assert.equal(uploaded.status, 201);
    assert.deepEqual(await app.preview(), { available: true, capturedAt: uploaded.capturedAt, width: 3, height: 2,
      pipeline: { phase: 'saved', writes: 1, failures: 0, capture: { phase: 'not-observed', sequence: 0, attempts: 0, failures: 0 }, display: { paused: false, needsResume: false } } });
    const state = await app.request('/api/state'); assert.equal(state.status, 200);
    assert.deepEqual(JSON.parse(state.body.toString()).preview, { available: true, capturedAt: uploaded.capturedAt, width: 3, height: 2 });
    const image = await app.request(`/api/preview/image?t=${encodeURIComponent(uploaded.capturedAt)}`, 'GET', {
      'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' });
    assert.equal(image.status, 200, 'same-origin browser GET works without an Origin header');
    assert.deepEqual(image.body, uploaded.png); assert.equal(image.headers['cache-control'], 'no-store');
    assert.equal(image.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(image.headers['access-control-allow-origin'], undefined);
    assert.deepEqual(await readFile(app.file), uploaded.png);
    assert.equal((await stat(app.file)).mtime.toISOString(), uploaded.capturedAt);
    assert.deepEqual(await readdir(app.snapshotDirectory), ['last-screen.png']);
    const head = await app.request('/api/preview/image', 'HEAD');
    assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.equal(Number(head.headers['content-length']), uploaded.png.length);
    const claim = await app.request('/api/preview/preparation/claim', 'POST', { ...app.auth(), 'Content-Type': 'application/json' }, Buffer.from('{}'));
    assert.equal(claim.status, 410, 'retired native claim cannot publish a second image');
    assert.deepEqual((await app.request('/api/preview/image')).body, uploaded.png);
  } finally { await app.close(); }
});

test('shared image keeps local HTTP and child-only publisher boundaries', async () => {
  const app = await fixture();
  try {
    const current = await app.config(), png = photoFixture();
    assert.equal((await app.request('/api/preview/preparation', 'POST', { ...app.uploadHeaders(current), 'X-LRD-Preparation': '0'.repeat(64) }, png)).status, 403);
    assert.equal((await app.request('/api/preview/preparation', 'GET', { ...app.auth(), Origin: app.url })).status, 403);
    assert.equal((await app.request('/api/preview/preparation', 'GET', { ...app.auth(), 'Sec-Fetch-Site': 'same-origin' })).status, 403);
    assert.equal((await app.upload(png, current)).status, 201);
    const rejectedHeaders: Record<string, string>[] = [{ Host: 'other.invalid' }, { Origin: 'https://other.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }];
    for (const headers of rejectedHeaders) {
      const response = await app.request('/api/preview/image', 'GET', headers);
      assert.equal(response.status, 403); assert.equal(response.headers['access-control-allow-origin'], undefined);
    }
    assert.deepEqual((await app.request('/api/preview/image')).body, png);
  } finally { await app.close(); }
});

test('native handshake, ordinary exit and input cleanup retain the canonical screenshot; privacy clear removes it', async () => {
  const app = await fixture();
  try {
    const uploaded = await app.upload(); assert.equal(uploaded.status, 201);
    const handshake = await app.request('/api/host/session', 'GET', { 'X-LRD-Native': '1' });
    assert.equal(handshake.status, 200);
    const session = JSON.parse(handshake.body.toString()); assert.equal(session.preparationPipe, undefined);
    assert.equal((await app.request('/api/preview', 'DELETE', { 'X-LRD-Token': session.token })).status, 204);
    assert.equal((await app.request('/api/preview/preparation', 'DELETE', { ...app.auth(), 'X-Invalidate-Active-Only': '1' })).status, 204);
    assert.equal((await app.preview()).capturedAt, uploaded.capturedAt);
    assert.deepEqual((await app.request('/api/preview/image')).body, uploaded.png);
    assert.deepEqual(await readFile(app.file), uploaded.png);
    assert.equal((await app.request('/api/preview/preparation', 'DELETE', app.auth())).status, 204);
    assert.equal((await app.preview()).available, false); assert.equal((await app.request('/api/preview/image')).status, 404);
    await missing(app.file);
  } finally { await app.close(); }
});

test('replacement binds the caption timestamp to the matching file and opt-out removes it', async () => {
  const app = await fixture();
  try {
    const first = await app.upload(photoFixture(2, 2)); assert.equal(first.status, 201);
    app.advance(1_000);
    const second = await app.upload(photoFixture(4, 3)); assert.equal(second.status, 201);
    assert.notEqual(second.capturedAt, first.capturedAt);
    assert.equal((await app.request(`/api/preview/image?t=${encodeURIComponent(first.capturedAt)}`)).status, 404);
    assert.deepEqual((await app.request(`/api/preview/image?t=${encodeURIComponent(second.capturedAt)}`)).body, second.png);
    assert.equal((await app.preview()).capturedAt, second.capturedAt); assert.deepEqual(await readdir(app.snapshotDirectory), ['last-screen.png']);
    const disabled = await app.request('/api/settings', 'PATCH', { 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify({ preview: { enabled: false }, widgets: { preview: false } })));
    assert.equal(disabled.status, 200); assert.equal((await app.preview()).available, false);
    assert.equal((await app.request('/api/preview/image')).status, 404); await missing(app.file);
  } finally { await app.close(); }
});

test('same-origin display pause fences uploads while retaining the last file and releasing resumes a fresh fence', async () => {
  const app = await fixture();
  try {
    const initial = await app.config(), first = await app.upload(photoFixture(), initial); assert.equal(first.status, 201);
    assert.equal(initial.capturePaused, false);
    const rejectedDisplayHeaders: Record<string, string>[] = [{ Origin: 'https://other.invalid' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Mode': 'navigate' }, { 'Sec-Fetch-Dest': 'document' }, { 'Sec-Fetch-Dest': '' }, { 'X-LRD-Display': '0' }];
    for (const override of rejectedDisplayHeaders) {
      assert.equal((await app.display({ action: 'start' }, { ...app.displayHeaders(), ...override })).status, 403);
    }
    const started = await app.display({ action: 'start' }); assert.equal(started.status, 201);
    const { id } = JSON.parse(started.body.toString()); assert.match(id, /^[a-f0-9]{32}$/);
    const paused = await app.config(); assert.equal(paused.capturePaused, true); assert.notEqual(paused.captureRevision, initial.captureRevision);
    app.advance(1_000);
    assert.equal((await app.upload(photoFixture(3, 3), initial)).status, 409, 'a capture begun before the browser pause cannot publish');
    assert.deepEqual((await app.request('/api/preview/image')).body, first.png, 'pause rejection retains the prior file');
    assert.equal((await app.display({ action: 'release', id })).status, 204);
    const resumed = await app.config(); assert.equal(resumed.capturePaused, false); assert.notEqual(resumed.captureRevision, paused.captureRevision);
    assert.equal((await app.upload(photoFixture(3, 3), paused)).status, 409, 'the retired pause revision cannot publish after release');
    const next = await app.upload(photoFixture(4, 2), resumed); assert.equal(next.status, 201);
    assert.deepEqual((await app.request('/api/preview/image')).body, next.png);
  } finally { await app.close(); }
});

test('safe native-display heartbeats retain the same file past five minutes without claim or image-age expiry', async () => {
  const app = await fixture();
  try {
    const uploaded = await app.upload(); assert.equal(uploaded.status, 201);
    const handshake = await app.request('/api/host/session', 'GET', { 'X-LRD-Native': '1' });
    assert.equal(handshake.status, 200); const { token } = JSON.parse(handshake.body.toString());
    for (let observation = 0; observation < 40; observation++) {
      app.advance(9_000);
      const heartbeat = await app.request('/api/preview/preparation', 'GET', { ...app.auth(),
        'X-Preparation-Safe': '1', 'X-Session-Id': '1', 'X-Preparation-Capture-Eligible': '0' });
      assert.equal(heartbeat.status, 200); assert.equal(JSON.parse(heartbeat.body.toString()).frame, null);
      assert.equal((await app.preview()).capturedAt, uploaded.capturedAt, 'safe observation retains the original capture time');
    }
    assert.deepEqual((await app.request(`/api/preview/image?t=${encodeURIComponent(uploaded.capturedAt)}`)).body, uploaded.png);
    assert.deepEqual(await readFile(app.file), uploaded.png);
    assert.equal((await stat(app.file)).mtime.toISOString(), uploaded.capturedAt);
    assert.equal((await app.request('/api/preview', 'DELETE', { 'X-LRD-Token': token })).status, 204);
    assert.equal((await app.request('/api/preview/preparation', 'DELETE', { ...app.auth(), 'X-Invalidate-Active-Only': '1' })).status, 204);
    assert.deepEqual((await app.request('/api/preview/image')).body, uploaded.png, 'ordinary dismissal/input retains the canonical file');
    const unsafe = await app.request('/api/preview/preparation', 'GET', { ...app.auth(), 'X-Preparation-Safe': '0' });
    assert.equal(unsafe.status, 200); assert.equal((await app.preview()).available, false);
    assert.equal((await app.request('/api/preview/image')).status, 404); await missing(app.file);
  } finally { await app.close(); }
});
