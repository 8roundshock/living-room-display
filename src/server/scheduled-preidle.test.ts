import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture, photoFixture } from './fixtures.ts';
import { defaultSettings } from '../shared/defaults.ts';
import type { PreparationBootstrap, PreparationConfig } from './preidle.ts';
import { ScheduleStore } from './schedule.ts';

const BASE = new Date(2026, 9, 19, 7, 59, 50).getTime();
const RULE = '00000000-0000-4000-8000-000000000001';
const json = (value: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
async function fixture(initialScheduledOff = false) {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-scheduled-preidle-synthetic-'));
  if (initialScheduledOff) {
    const saved = await ScheduleStore.open(directory);
    await saved.configure({ enabled: true, fallbackPresetId: 'visible', rules: [{ id: RULE, presetId: 'hidden', days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '08:00' }] }, null);
  }
  const clock = { now: BASE, monotonic: 10_000 };
  let bootstrap!: PreparationBootstrap, children = 0, stops = 0;
  const app = await createApplication({ dataDirectory: directory, now: () => clock.now, preparationMonotonic: () => clock.monotonic,
    fetcher: async () => Response.json(forecastFixture()), preparation: { source: 'a'.repeat(40), start(value) {
      bootstrap = value; children++; return { stop() { stops++; } };
    } } });
  const manual = defaultSettings(); manual.idle.enabled = true;
  const { appearance, widgets, widgetGrid, widgetOverrides, widgetBehavior, preview } = structuredClone(manual);
  const visual = { appearance, widgets, widgetGrid, widgetOverrides, widgetBehavior, preview };
  manual.savedPresets = [
    { id: 'visible', name: 'Synthetic visible', visual },
    { id: 'hidden', name: 'Synthetic hidden', visual: { ...visual, preview: { ...preview, enabled: false } } },
    { id: 'widget-hidden', name: 'Synthetic hidden widget', visual: { ...visual, widgets: { ...widgets, preview: false } } },
  ];
  if (initialScheduledOff) manual.preview.enabled = false;
  await app.store.update(data => { data.settings = manual; });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const native = (path: string, method = 'GET', headers: Record<string, string> = {}, content?: Buffer) => new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = httpRequest(base + path, { method, headers }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode!, text: Buffer.concat(chunks).toString() }));
    }); request.on('error', reject); request.end(content);
  });
  const auth = () => ({ 'X-LRD-Preparation': bootstrap.token });
  const config = async (): Promise<PreparationConfig> => {
    const result = await native('/api/preview/preparation', 'GET', { ...auth(), 'X-Preparation-Safe': '1', 'X-Session-Id': '1' }); assert.equal(result.status, 200); return JSON.parse(result.text);
  };
  const schedule = (presetId = 'hidden', start = '08:00', end = '08:01') => ({ enabled: true, fallbackPresetId: 'visible', rules: [{ id: RULE, presetId, days: [0, 1, 2, 3, 4, 5, 6], start, end }] });
  const put = async (value: unknown) => { assert.equal((await fetch(base + '/api/schedule', { method: 'PUT', ...json(value) })).status, 200); };
  const advance = (milliseconds: number) => { clock.now += milliseconds; clock.monotonic += milliseconds; };
  const frameHeaders = (current: PreparationConfig) => ({ ...auth(), 'Content-Type': 'image/png',
    'X-Preparation-Generation': String(current.generation), 'X-Preparation-Configuration': current.configuration,
    'X-Input-Tick': '123', 'X-Session-Id': '1', 'X-Desktop-Id': 'Default', 'X-Captured-At': new Date(clock.now - 100).toISOString(),
    'X-Completed-At': new Date(clock.now).toISOString(), 'X-Completed-Monotonic-Ms': String(clock.monotonic), 'X-Idle-Timeout-Seconds': '600' });
  let preparedMonotonic = clock.monotonic;
  const prepare = async (current: PreparationConfig) => { preparedMonotonic = clock.monotonic; return native('/api/preview/preparation', 'POST', frameHeaders(current), photoFixture()); };
  const claim = async (current: PreparationConfig) => {
    const result = await native('/api/preview/preparation/claim', 'POST', { ...auth(), 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify({
      generation: current.generation, configuration: current.configuration, processId: 200,
      processStartedAt: new Date(clock.now - 100).toISOString(), startedMonotonicMs: clock.monotonic - 100,
      inputTick: 123, sessionId: 1, desktopId: 'Default', completedMonotonicMs: preparedMonotonic,
    })));
    assert.equal(result.status, 200); return JSON.parse(result.text).claimed as boolean;
  };
  return { ...app, base, directory, clock, native, auth, config, schedule, put, advance, frameHeaders, prepare, claim,
    get children() { return children; }, get stops() { return stops; },
    async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); } };
}

test('scheduled preview and widget visibility disable preparation and reject a frame from before the boundary', async t => {
  for (const style of ['hidden', 'widget-hidden']) await t.test(style, async () => {
    const app = await fixture();
    try {
      await app.put(app.schedule(style)); const before = await app.config(); assert.equal(before.enabled, true);
      assert.equal((await app.prepare(before)).status, 201);
      app.advance(10_100);
      const after = await app.config(); assert.equal(after.enabled, false); assert.notEqual(after.configuration, before.configuration);
      assert.equal((await app.prepare(after)).status, 409);
      assert.equal(await app.claim(before), false);
      assert.equal((await fetch(app.base + '/api/preview/image')).status, 404);
      assert.equal(app.children, 1); assert.equal(app.stops, 0, 'scheduled off keeps the same one-shot policy child');
    } finally { await app.close(); }
  });
});

test('starting during a scheduled off interval keeps one disabled child ready for a later visible style', async () => {
  const app = await fixture(true);
  try {
    assert.equal(app.children, 1);
    const hidden = await app.config(); assert.equal(hidden.enabled, false);
    assert.equal((await app.prepare(hidden)).status, 409);
    app.advance(10_100);
    const visible = await app.config(); assert.equal(visible.enabled, true);
    assert.equal(app.children, 1); assert.equal(app.stops, 0);
    assert.equal((await app.prepare(visible)).status, 201);
    app.advance(3_100); assert.equal(await app.claim(visible), true);
  } finally { await app.close(); }
});

test('an unobserved on-off-on interval cannot resurrect a pending frame even when the current style repeats', async () => {
  const app = await fixture();
  try {
    await app.put(app.schedule()); const before = await app.config();
    assert.equal((await app.prepare(before)).status, 201);
    app.advance(70_100); // 08:01:00.100: hidden for a whole minute without any intervening poll.
    const after = await app.config(); assert.equal(after.enabled, true); assert.notEqual(after.configuration, before.configuration);
    assert.equal(await app.claim(before), false);
    assert.equal(app.children, 1); assert.equal(app.stops, 0);
    assert.equal((await fetch(app.base + '/api/preview/image')).status, 404);
  } finally { await app.close(); }
});

test('an active frame is cleared by a missed off interval or an unreconstructable clock gap', async t => {
  for (const transition of ['missed off interval', 'long gap', 'clock reversal']) await t.test(transition, async () => {
    const app = await fixture();
    try {
      await app.put(app.schedule()); const before = await app.config();
      assert.equal((await app.prepare(before)).status, 201);
      app.advance(3_100); assert.equal(await app.claim(before), true);
      assert.equal((await fetch(app.base + '/api/preview/image')).status, 200);
      app.advance(transition === 'missed off interval' ? 67_000 : transition === 'long gap' ? 95_000 : -1_000);
      assert.equal((await app.config()).enabled, true, 'the current style itself is visible');
      assert.equal((await fetch(app.base + '/api/preview/image')).status, 404, 'current-on cannot revive pre-off bytes');
      assert.equal(await app.claim(await app.config()), false);
      assert.equal(app.children, 1); assert.equal(app.stops, 0, 'no replacement worker or capture retry is created');
    } finally { await app.close(); }
  });
});

test('crossing a minute without changing the effective style preserves a valid native claim', async () => {
  const app = await fixture();
  try {
    await app.put(app.schedule('hidden', '22:00', '22:01'));
    const before = await app.config(); assert.equal((await app.prepare(before)).status, 201);
    app.advance(7_000); await app.config(); // Healthy producer keeps its context lease across the minute.
    app.advance(6_100); const after = await app.config();
    assert.equal(after.configuration, before.configuration);
    assert.equal(await app.claim(before), true);
    assert.equal((await fetch(app.base + '/api/preview/image')).status, 200);
  } finally { await app.close(); }
});

test('schedule edits and temporary-override expiry invalidate preparation without replacing the epoch owner', async () => {
  const app = await fixture();
  try {
    await app.put(app.schedule());
    const before = await app.config(); assert.equal((await app.prepare(before)).status, 201);
    await app.put({ ...app.schedule(), fallbackPresetId: 'hidden' });
    app.advance(3_100); assert.equal(await app.claim(before), false);
    const overridden = await fetch(app.base + '/api/schedule/override', { method: 'POST', ...json({ manual: true }) }); assert.equal(overridden.status, 200);
    const { overrideUntil } = await overridden.json();
    // Advance close to override expiry, then take a new synthetic frame for a different input epoch.
    app.advance(Date.parse(overrideUntil) - app.clock.now - 5_000);
    const override = await app.config(); assert.equal(override.enabled, true);
    assert.equal((await app.prepare(override)).status, 201);
    app.advance(6_000); assert.equal((await app.config()).enabled, false); assert.equal(await app.claim(override), false);
    assert.equal(app.children, 1); assert.equal(app.stops, 0);
  } finally { await app.close(); }
});

test('a failed capture and schedule toggles retain the same explicitly supervised worker', async () => {
  const app = await fixture();
  try {
    await app.put(app.schedule()); const current = await app.config();
    assert.equal((await app.native('/api/preview/preparation', 'POST', app.frameHeaders(current), Buffer.from('not a PNG'))).status, 400);
    await app.put({ ...app.schedule(), fallbackPresetId: 'hidden' }); assert.equal((await app.config()).enabled, false);
    await app.put(app.schedule()); assert.equal((await app.config()).enabled, true);
    assert.equal(app.children, 1); assert.equal(app.stops, 0);
    assert.equal((await fetch(app.base + '/api/preview/image')).status, 404);
    assert.ok((await readdir(app.directory)).every(name => ['state.json', 'state.backup.json', 'schedule.json', 'schedule.backup.json'].includes(name)));
  } finally { await app.close(); }
});

test('explicit idle disable revokes the worker even when scheduled styles can show Last screen', async () => {
  const app = await fixture();
  try {
    await app.put(app.schedule()); const before = await app.config();
    assert.equal((await app.prepare(before)).status, 201);
    const oldAuth = app.auth();
    assert.equal((await fetch(app.base + '/api/settings', { method: 'PATCH', ...json({ idle: { enabled: false } }) })).status, 200);
    assert.equal(app.stops, 1);
    assert.equal((await app.native('/api/preview/preparation', 'GET', oldAuth)).status, 403);
    const disabled = JSON.parse((await app.native('/api/host/session', 'GET', { 'X-LRD-Native': '1' })).text);
    assert.equal(disabled.settings.idle.enabled, false); assert.equal(disabled.preparationPipe, null);
    assert.equal((await fetch(app.base + '/api/preview/image')).status, 404);
    assert.equal((await fetch(app.base + '/api/settings', { method: 'PATCH', ...json({ idle: { enabled: true } }) })).status, 200);
    assert.equal(app.children, 2, 'an explicit re-enable creates a cold worker, never revives its former RAM frame');
    app.advance(3_100); assert.equal(await app.claim(await app.config()), false);
    assert.equal((await app.native('/api/preview/preparation', 'GET', oldAuth)).status, 403);
  } finally { await app.close(); }
});

test('manual preview visibility off with scheduling disabled stops rather than retaining an unused worker', async () => {
  const app = await fixture();
  try {
    assert.equal((await fetch(app.base + '/api/settings', { method: 'PATCH', ...json({ preview: { enabled: false } }) })).status, 200);
    assert.equal(app.stops, 1);
    const session = JSON.parse((await app.native('/api/host/session', 'GET', { 'X-LRD-Native': '1' })).text);
    assert.equal(session.preparationPipe, null); assert.equal(session.settings.preview.enabled, false);
  } finally { await app.close(); }
});

test('a manual preview upload arriving across an unobserved off interval is refused too', async () => {
  const app = await fixture(); let upload!: ReturnType<typeof httpRequest>;
  try {
    await app.put(app.schedule());
    const session = JSON.parse((await app.native('/api/host/session', 'GET', { 'X-LRD-Native': '1' })).text);
    const png = photoFixture();
    const bodyStarted = new Promise<void>(resolve => app.server.once('request', incoming => incoming.once('data', () => resolve())));
    const result = new Promise<number>((resolve, reject) => {
      upload = httpRequest(app.base + '/api/preview', { method: 'POST', headers: {
        'X-LRD-Token': session.token, 'Content-Type': 'image/png', 'X-Captured-At': new Date(app.clock.now).toISOString(),
      } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
      upload.on('error', reject); upload.write(png.subarray(0, 8));
    });
    await bodyStarted; app.advance(70_100); upload.end(png.subarray(8));
    assert.equal(await result, 409); assert.equal((await fetch(app.base + '/api/preview/image')).status, 404);
  } finally { upload?.destroy(); await app.close(); }
});

test('a private preparation or claim arriving across a schedule boundary cannot publish stale pixels', async t => {
  for (const operation of ['preparation', 'claim'] as const) await t.test(operation, async () => {
    const app = await fixture(); let upload!: ReturnType<typeof httpRequest>;
    try {
      await app.put(app.schedule()); const current = await app.config();
      if (operation === 'claim') { assert.equal((await app.prepare(current)).status, 201); app.advance(3_100); }
      const content = operation === 'preparation' ? photoFixture() : Buffer.from(JSON.stringify({
        generation: current.generation, configuration: current.configuration, processId: 200,
        processStartedAt: new Date(app.clock.now - 100).toISOString(), startedMonotonicMs: app.clock.monotonic - 100,
        inputTick: 123, sessionId: 1, desktopId: 'Default', completedMonotonicMs: app.clock.monotonic - 3_100,
      }));
      const bodyStarted = new Promise<void>(resolve => app.server.once('request', incoming => incoming.once('data', () => resolve())));
      const result = new Promise<{ status: number; text: string }>((resolve, reject) => {
        upload = httpRequest(app.base + `/api/preview/preparation${operation === 'claim' ? '/claim' : ''}`, { method: 'POST',
          headers: operation === 'preparation' ? app.frameHeaders(current) : { ...app.auth(), 'Content-Type': 'application/json' },
        }, response => {
          const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => resolve({ status: response.statusCode!, text: Buffer.concat(chunks).toString() }));
        }); upload.on('error', reject); upload.write(content.subarray(0, 8));
      });
      await bodyStarted; app.advance(10_100); upload.end(content.subarray(8));
      const response = await result;
      assert.equal(response.status, operation === 'claim' ? 200 : 409);
      if (operation === 'claim') assert.equal(JSON.parse(response.text).claimed, false);
      assert.equal((await fetch(app.base + '/api/preview/image')).status, 404);
    } finally { upload?.destroy(); await app.close(); }
  });
});
