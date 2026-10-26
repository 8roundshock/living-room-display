import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings } from '../shared/defaults.ts';
import { createApplication } from './app.ts';
import { photoFixture, forecastFixture } from './fixtures.ts';
import { PreparedSnapshot, PreparationController, installedPreparationOptions, type PreparationBootstrap, type PreparationClaim, type PreparationStamp } from './preidle.ts';

const BASE = Date.parse('2026-10-23T16:00:00Z');
function slotFixture() {
  const clock = { wall: BASE, mono: 10_000 };
  const slot = new PreparedSnapshot(() => clock.wall, () => clock.mono);
  slot.configure('configuration-a'); slot.observe(1);
  const content = Buffer.from('synthetic thumbnail');
  const stamp = (): PreparationStamp => ({ generation: slot.generation, configuration: 'configuration-a', inputTick: 123,
    sessionId: 1, desktopId: 'Default', capturedAt: new Date(BASE - 100).toISOString(), completedAt: new Date(BASE).toISOString(), completedMonotonicMs: 10_000 });
  const receive = () => slot.receive({ content, capturedAt: stamp().capturedAt, width: 2, height: 2 }, stamp(), true);
  const claim = (): PreparationClaim => ({ generation: slot.generation, configuration: 'configuration-a', processId: 200,
    processStartedAt: new Date(BASE + 3_000).toISOString(), startedMonotonicMs: 13_000, inputTick: 123, sessionId: 1, desktopId: 'Default', completedMonotonicMs: 10_000 });
  const advance = (elapsed = 3_100) => { clock.wall += elapsed; clock.mono += elapsed; };
  return { slot, clock, content, stamp, receive, claim, advance };
}

test('an unpublished frame transfers once only after trusted pre-process UTC and monotonic ordering', () => {
  const f = slotFixture();
  assert.equal(f.receive(), true); f.advance();
  const claimed = f.slot.claim(f.claim(), true);
  assert.equal(claimed?.content, f.content); assert.equal(f.content.toString(), 'synthetic thumbnail');
  assert.equal(f.slot.claim(f.claim(), true), null);
  f.content.fill(0);
});

test('input/context/config/disabled/clock/order uncertainty consumes and zeroes the candidate', async t => {
  const variants: Record<string, (f: ReturnType<typeof slotFixture>, claim: PreparationClaim) => void> = {
    'wrong captured input tag': (_, claim) => { claim.inputTick++; },
    'wrong exact frame identity': (_, claim) => { claim.completedMonotonicMs++; },
    'another session': (_, claim) => { claim.sessionId++; },
    'another configuration': (_, claim) => { claim.configuration = 'configuration-b'; },
    'another generation': (_, claim) => { claim.generation++; },
    'unknown process': (_, claim) => { claim.processId = 0; },
    'process already started before capture': (_, claim) => { claim.processStartedAt = new Date(BASE - 1).toISOString(); },
    'capture completed between process start and delayed claim': (_, claim) => { claim.startedMonotonicMs = 9_999; },
    'insufficient process-start margin': (_, claim) => { claim.startedMonotonicMs = 12_000; },
    'UTC went backwards': f => { f.clock.wall -= 10_000; },
    'UTC went forwards': f => { f.clock.wall += 10_000; },
    'monotonic clock went backwards': f => { f.clock.mono -= 10_000; },
    'producer observation expired': f => { f.advance(10_001); },
  };
  for (const [name, change] of Object.entries(variants)) await t.test(name, () => {
    const f = slotFixture(); assert.equal(f.receive(), true); f.advance();
    const claim = f.claim(); change(f, claim);
    assert.equal(f.slot.claim(claim, true), null); assert.ok(f.content.every(value => value === 0));
    assert.equal(f.slot.claim(f.claim(), true), null);
  });
  const disabled = slotFixture(); disabled.receive(); disabled.advance();
  assert.equal(disabled.slot.claim(disabled.claim(), false), null); assert.ok(disabled.content.every(value => value === 0));
});

test('clear/config/failed claim invalidate arriving bodies, and an older or duplicate frame cannot replace the latest success', () => {
  for (const operation of ['clear', 'configuration', 'cold claim'] as const) {
    const f = slotFixture(), stamp = f.stamp();
    if (operation === 'clear') f.slot.clear();
    else if (operation === 'configuration') f.slot.configure('configuration-b');
    else assert.equal(f.slot.claim(f.claim(), true), null);
    assert.equal(f.slot.receive({ content: f.content, capturedAt: stamp.capturedAt, width: 2, height: 2 }, stamp, true), false);
    assert.ok(f.content.every(value => value === 0));
  }
  const f = slotFixture(); assert.equal(f.receive(), true);
  const duplicate = Buffer.from('duplicate');
  assert.equal(f.slot.receive({ content: duplicate, capturedAt: f.stamp().capturedAt, width: 2, height: 2 }, f.stamp(), true), false);
  assert.ok(duplicate.every(value => value === 0)); f.slot.clear(); assert.ok(f.content.every(value => value === 0));
});

test('five-minute replacement zeroes the former frame and healthy observations retain latest success across failed refreshes', () => {
  const f = slotFixture(); assert.equal(f.receive(), true);
  const pulse = (milliseconds: number) => {
    for (let passed = 0; passed < milliseconds; passed += 5_000) {
      f.advance(Math.min(5_000, milliseconds - passed)); f.slot.observe(1);
    }
  };
  pulse(300_000);
  const latest = Buffer.from('latest successful full desktop thumbnail');
  const stamp = { ...f.stamp(), capturedAt: new Date(f.clock.wall - 100).toISOString(), completedAt: new Date(f.clock.wall).toISOString(), completedMonotonicMs: f.clock.mono, inputTick: 456 };
  assert.equal(f.slot.receive({ content: latest, capturedAt: stamp.capturedAt, width: 2, height: 2 }, stamp, true), true);
  assert.ok(f.content.every(value => value === 0), 'successful replacement erases previous bytes');
  const refused = Buffer.from('delayed older upload');
  assert.equal(f.slot.receive({ content: refused, capturedAt: f.stamp().capturedAt, width: 2, height: 2 }, f.stamp(), true), false);
  assert.ok(refused.every(value => value === 0));
  pulse(900_000); // Several failed/missed screenshot refreshes do not erase a healthy latest-success cache.
  const claim = { ...f.claim(), inputTick: 456, completedMonotonicMs: stamp.completedMonotonicMs,
    processStartedAt: new Date(f.clock.wall - 100).toISOString(), startedMonotonicMs: f.clock.mono - 100 };
  const result = f.slot.claim(claim, true);
  assert.equal(result?.content, latest); assert.equal(result?.capturedAt, stamp.capturedAt);
  latest.fill(0);
});

test('a missing safe producer observation, another session and an unknown context cannot retain cached bytes', () => {
  const f = slotFixture(); assert.equal(f.receive(), true);
  f.advance(10_001); f.slot.observe(1);
  assert.ok(f.content.every(value => value === 0), 'missed safe-context lease erases the old image before renewal');
  const next = Buffer.from('next');
  const stamp = { ...f.stamp(), generation: f.slot.generation, capturedAt: new Date(f.clock.wall - 100).toISOString(), completedAt: new Date(f.clock.wall).toISOString(), completedMonotonicMs: f.clock.mono };
  assert.equal(f.slot.receive({ content: next, capturedAt: stamp.capturedAt, width: 1, height: 1 }, stamp, true), true);
  f.slot.observe(2); assert.ok(next.every(value => value === 0), 'another session clears cache');
  f.slot.clear();
});

test('an obsolete observation timer cannot expire the renewed latest-success cache', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = slotFixture(); assert.equal(f.receive(), true);
  f.advance(5_000); t.mock.timers.tick(5_000); f.slot.observe(1);
  f.advance(5_001); t.mock.timers.tick(5_001);
  assert.equal(f.slot.claim({ ...f.claim(), processStartedAt: new Date(f.clock.wall - 100).toISOString(), startedMonotonicMs: f.clock.mono - 100 }, true)?.content, f.content);
  f.content.fill(0); f.slot.clear();
});

test('controller is inert while disabled, owns one secret child, clears on exit and never auto-restarts', () => {
  const settings = defaultSettings(); let revision = 'one', calls = 0, stops = 0, clears = 0;
  let bootstrap!: PreparationBootstrap, exited!: () => void;
  const controller = new PreparationController({ source: 'a'.repeat(40), start(value, end) {
    calls++; bootstrap = value; exited = end; return { stop() { stops++; } };
  } }, () => ({ settings, settingsRevision: revision }), () => { clears++; });
  controller.listening(54321); assert.equal(calls, 0); assert.equal(controller.pipeName, null);
  settings.idle.enabled = true; revision = 'two'; controller.refresh();
  assert.equal(calls, 1); assert.match(bootstrap.token, /^[a-f0-9]{64}$/); assert.equal(bootstrap.port, 54321);
  assert.equal(controller.authorized(bootstrap.token), true); assert.equal(controller.authorized('0'.repeat(64)), false);
  assert.equal(JSON.stringify(controller.config()).includes(bootstrap.token), false);
  assert.equal(controller.pipeName, bootstrap.pipeName); controller.refresh(); assert.equal(calls, 1);
  exited(); assert.equal(controller.authorized(bootstrap.token), false); assert.equal(controller.pipeName, null); assert.equal(clears, 1);
  controller.refresh(); assert.equal(calls, 1, 'a dead child is not retried');
  controller.close(); controller.close(); assert.equal(stops, 0);
  const noOptions = new PreparationController(undefined, () => ({ settings, settingsRevision: revision }), () => undefined);
  noOptions.listening(54321); assert.equal(noOptions.config().enabled, false); noOptions.close();
});

test('ordinary source/non-Windows/missing opt-in entrypoints cannot start a preparer', () => {
  const input = { platform: 'linux', enabledFlag: '1', executable: '/test/runtime/node.exe', entry: '/test/app/dist/server/index.js', dataDirectory: '/test/data' };
  assert.equal(installedPreparationOptions(input), undefined);
  assert.equal(installedPreparationOptions({ ...input, platform: 'win32', enabledFlag: undefined }), undefined);
  assert.equal(installedPreparationOptions({ ...input, platform: 'win32', entry: '/source/src/server/index.ts' }), undefined);
});

async function apiFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-preparation-synthetic-'));
  const clock = { wall: BASE, mono: 10_000 };
  let bootstrap!: PreparationBootstrap, exited!: () => void, stopped = 0;
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()),
    now: () => clock.wall, preparationMonotonic: () => clock.mono,
    preparation: { source: 'a'.repeat(40), start(value, end) { bootstrap = value; exited = end; return { stop() { stopped++; } }; } } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const patch = (value: unknown) => fetch(url + '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal((await patch({ idle: { enabled: true } })).status, 200);
  async function native(path: string, method = 'GET', headers: Record<string, string> = {}, content?: Buffer) {
    return new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
      const request = httpRequest(url + path, { method, headers }, response => {
        const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks) }));
      }); request.on('error', reject); request.end(content);
    });
  }
  const auth = () => ({ 'X-LRD-Preparation': bootstrap.token });
  const config = async () => JSON.parse((await native('/api/preview/preparation', 'GET', { ...auth(), 'X-Preparation-Safe': '1', 'X-Session-Id': '1' })).body.toString());
  const headers = (current: { generation: number; configuration: string }) => ({ ...auth(), 'Content-Type': 'image/png',
    'X-Preparation-Generation': String(current.generation), 'X-Preparation-Configuration': current.configuration,
    'X-Input-Tick': '123', 'X-Session-Id': '1', 'X-Desktop-Id': 'Default', 'X-Captured-At': new Date(BASE - 100).toISOString(),
    'X-Completed-At': new Date(BASE).toISOString(), 'X-Completed-Monotonic-Ms': '10000' });
  return { ...app, url, directory, clock, native, auth, config, headers, patch, get bootstrap() { return bootstrap; }, get stopped() { return stopped; }, exit() { exited(); },
    async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); } };
}

test('prepared pixels stay private in RAM until the exact child attests a native pipe claim', async () => {
  const app = await apiFixture();
  try {
    const config = await app.config(), png = photoFixture();
    const host = await app.native('/api/host/session', 'GET', { 'X-LRD-Native': '1' });
    const session = JSON.parse(host.body.toString()); assert.equal(session.preparationPipe, app.bootstrap.pipeName);
    assert.equal(host.body.toString().includes(app.bootstrap.token), false);
    assert.equal((await app.native('/api/preview/preparation', 'POST', app.headers(config), png)).status, 201);
    assert.equal((await fetch(app.url + '/api/preview/image')).status, 404);
    assert.equal((await (await fetch(app.url + '/api/preview')).json()).available, false);
    assert.equal((await (await fetch(app.url + '/api/state')).json()).preview.available, false);
    assert.equal((await (await fetch(app.url + '/api/export')).text()).includes(png.toString('base64')), false);
    assert.deepEqual(await readdir(app.directory), ['state.backup.json', 'state.json']);
    assert.equal((await fetch(app.url + '/api/preview/preparation', { headers: app.auth() })).status, 403, 'browser metadata cannot use the private endpoint');
    assert.equal((await app.native('/api/preview/preparation/claim', 'POST', { 'X-LRD-Token': session.token, 'Content-Type': 'application/json' }, Buffer.from('{}'))).status, 403);
    assert.equal((await app.native('/api/preview/claim', 'POST', { 'X-LRD-Token': session.token, 'Content-Type': 'application/json' }, Buffer.from('{}'))).status, 404, 'there is no selfreported HTTP claim bypass');
    app.clock.wall += 3_100; app.clock.mono += 3_100;
    const claim: PreparationClaim = { generation: config.generation, configuration: config.configuration, processId: 200,
      processStartedAt: new Date(BASE + 3_000).toISOString(), startedMonotonicMs: 13_000, inputTick: 123, sessionId: 1, desktopId: 'Default', completedMonotonicMs: 10_000 };
    const promoted = await app.native('/api/preview/preparation/claim', 'POST', { ...app.auth(), 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify(claim)));
    assert.equal(promoted.status, 200); assert.equal(JSON.parse(promoted.body.toString()).claimed, true);
    const image = await fetch(app.url + '/api/preview/image'); assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    assert.equal((await app.native('/api/preview', 'DELETE', { 'X-LRD-Token': session.token })).status, 204);
    assert.equal((await fetch(app.url + '/api/preview/image')).status, 404);
  } finally { await app.close(); }
});

test('ordinary-input active-only cleanup preserves the private latest frame for later automatic claim', async () => {
  const app = await apiFixture();
  try {
    const config = await app.config(), png = photoFixture();
    assert.equal(config.captureIntervalMs, 300_000); assert.equal(config.maxAgeMs, null);
    assert.equal((await app.native('/api/preview/preparation', 'POST', app.headers(config), png)).status, 201);
    assert.equal((await app.native('/api/preview/preparation', 'DELETE', { ...app.auth(), 'X-Invalidate-Active-Only': '1' })).status, 204);
    const after = await app.config(); assert.equal(after.generation, config.generation);
    app.clock.wall += 3_100; app.clock.mono += 3_100;
    const result = await app.native('/api/preview/preparation/claim', 'POST', { ...app.auth(), 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify({
      generation: config.generation, configuration: config.configuration, processId: 200,
      processStartedAt: new Date(BASE + 3_000).toISOString(), startedMonotonicMs: 13_000,
      inputTick: 123, sessionId: 1, desktopId: 'Default', completedMonotonicMs: 10_000,
    })));
    assert.equal(result.status, 200); assert.equal(JSON.parse(result.body.toString()).claimed, true);
    assert.deepEqual(Buffer.from(await (await fetch(app.url + '/api/preview/image')).arrayBuffer()), png);
  } finally { await app.close(); }
});

test('generation, settings changes and child loss reject a preparation body still arriving', async t => {
  for (const operation of ['input invalidation', 'settings change', 'child exit', 'cold claim'] as const) await t.test(operation, async () => {
    const app = await apiFixture(); let upload!: ReturnType<typeof httpRequest>;
    try {
      const config = await app.config(), png = photoFixture();
      const started = new Promise<void>(resolve => app.server.once('request', incoming => incoming.once('data', () => resolve())));
      const response = new Promise<number>((resolve, reject) => {
        upload = httpRequest(app.url + '/api/preview/preparation', { method: 'POST', headers: app.headers(config) }, incoming => {
          incoming.resume(); incoming.on('end', () => resolve(incoming.statusCode!));
        }); upload.on('error', reject); upload.write(png.subarray(0, 8));
      });
      await started;
      if (operation === 'input invalidation') assert.equal((await app.native('/api/preview/preparation', 'DELETE', { ...app.auth(), 'X-Invalidate-Active': '1' })).status, 204);
      else if (operation === 'settings change') assert.equal((await app.patch({ appearance: { brightness: 0.3 } })).status, 200);
      else if (operation === 'child exit') app.exit();
      else {
        const rejected = await app.native('/api/preview/preparation/claim', 'POST', { ...app.auth(), 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify({
          generation: config.generation, configuration: config.configuration, processId: 200,
          processStartedAt: new Date(BASE).toISOString(), startedMonotonicMs: 10_000, inputTick: 123, sessionId: 1, desktopId: 'Default', completedMonotonicMs: 10_000,
        })));
        assert.equal(rejected.status, 200); assert.equal(JSON.parse(rejected.body.toString()).claimed, false);
      }
      upload.end(png.subarray(8));
      assert.equal(await response, operation === 'child exit' ? 403 : 409);
      assert.equal((await fetch(app.url + '/api/preview/image')).status, 404);
      assert.ok((await readdir(app.directory)).every(name => ['state.json', 'state.backup.json'].includes(name)));
    } finally { upload?.destroy(); await app.close(); }
  });
});
