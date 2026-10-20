import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApplication } from './app.ts';
import { forecastFixture, photoFixture } from './fixtures.ts';

async function fixture(now?: () => number) {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-api-'));
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()), now });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  return { ...app, directory, url: `http://127.0.0.1:${address.port}`, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); } };
}
function body(value: unknown) { return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }; }

test('saved local photos stay out of state/export/import while settings and image change atomically', async () => {
  const app = await fixture();
  try {
    const png = photoFixture(); const pngBase64 = png.toString('base64');
    const patch = (value: unknown) => fetch(`${app.url}/api/settings`, { method: 'PATCH', ...body(value) });
    assert.equal((await patch({ photoChange: { pngBase64 }, appearance: { clockStyle: 'analog' } })).status, 200);
    const state = await (await fetch(`${app.url}/api/state`)).json();
    assert.equal(state.photo.available, true); assert.match(state.photo.id, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(state).includes(pngBase64), false);
    const image = await fetch(`${app.url}/api/photo/image?id=${state.photo.id}`);
    assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png'); assert.equal(image.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    assert.equal((await fetch(`${app.url}/api/photo/image?id=${'0'.repeat(64)}`)).status, 404);
    assert.equal((await patch({ photoChange: { pngBase64: Buffer.from('<svg/>').toString('base64') }, units: 'imperial' })).status, 400);
    assert.equal(app.store.snapshot().settings.units, 'metric');
    const exported = await (await fetch(`${app.url}/api/export`)).json();
    assert.equal('photoAsset' in exported, false); assert.equal(JSON.stringify(exported).includes(pngBase64), false);
    assert.equal((await fetch(`${app.url}/api/import`, { method: 'POST', ...body(exported) })).status, 200);
    assert.equal(app.store.snapshot().photoAsset?.id, state.photo.id, 'settings import cannot replace or clear another device local photo');
    assert.equal((await patch({ photoChange: null, appearance: { clockStyle: 'outline' } })).status, 200);
    assert.equal((await fetch(`${app.url}/api/photo/image`)).status, 404);
  } finally { await app.close(); }
});

test('draft Save atomically guards automatic location and does not persist request intent', async () => {
  const app = await fixture();
  try {
    const patch = (value: unknown) => fetch(`${app.url}/api/settings`, { method: 'PATCH', ...body(value) });
    await patch({ location: { name: 'Chosen city', latitude: 43, longitude: -79, timezone: 'America/Toronto' } });
    const automatic = { automaticLocation: true, locationSource: 'device', location: { name: 'Device area', latitude: 12.345, longitude: 45.678, timezone: 'auto' }, appearance: { brightness: 0.3 } };
    assert.equal((await patch(automatic)).status, 200);
    assert.equal(app.store.snapshot().settings.location.name, 'Chosen city');
    assert.equal(app.store.snapshot().settings.appearance.brightness, 0.3);
    assert.equal('automaticLocation' in app.store.snapshot().settings, false);
    assert.equal((await patch({ ...automatic, automaticLocation: false, appearance: { brightness: 9 } })).status, 400);
    assert.equal(app.store.snapshot().settings.location.name, 'Chosen city', 'invalid visual draft cannot partly save device location');
    assert.equal((await patch({ ...automatic, automaticLocation: false })).status, 200);
    assert.equal(app.store.snapshot().settings.location.latitude, 12.3);
    const exported = await (await fetch(`${app.url}/api/export`)).json();
    assert.equal('automaticLocation' in exported.settings, false);
    assert.equal((await patch({ automaticLocation: 'yes' })).status, 400);
  } finally { await app.close(); }
});

test('a failed explicit device fallback draft preserves a manual city saved by another editor', async () => {
  const app = await fixture();
  try {
    const patch = (value: unknown) => fetch(`${app.url}/api/settings`, { method: 'PATCH', ...body(value) });
    await patch({ locationSource: 'device', location: { name: 'Device area', latitude: 12.3, longitude: 45.7, timezone: 'auto' } });
    // Editor A receives a failed explicit lookup and keeps this unsaved fallback.
    const failedLookupDraft = { automaticLocation: true, locationSource: 'fallback', appearance: { brightness: 0.3 } };
    // Editor B then saves its explicit manual selection through the real API.
    await patch({ location: { name: 'Other editor city', latitude: 40, longitude: 50, timezone: 'UTC' } });
    const response = await patch(failedLookupDraft);
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.location.name, 'Other editor city');
    assert.equal(saved.locationSource, 'manual');
    assert.equal(saved.appearance.brightness, 0.3, 'unrelated valid draft changes still save atomically');
    assert.equal('automaticLocation' in saved, false);
  } finally { await app.close(); }
});

test('hide-empty behavior persists through partial patch, preset export/import and legacy import', async () => {
  const app = await fixture();
  try {
    const patch = (value: unknown) => fetch(`${app.url}/api/settings`, { method: 'PATCH', ...body(value) });
    assert.equal((await (await fetch(`${app.url}/api/state`)).json()).settings.widgetBehavior.reminders.hideWhenEmpty, true);
    assert.equal((await patch({ widgetBehavior: { reminders: { hideWhenEmpty: false } } })).status, 200);
    const settings = app.store.snapshot().settings;
    const { appearance, widgets, widgetOverrides, widgetBehavior, preview } = settings;
    await patch({ savedPresets: [{ id: 'override', name: 'Keep empty', visual: { appearance, widgets, widgetOverrides, widgetBehavior, preview } }] });
    const exported = await (await fetch(`${app.url}/api/export`)).json();
    await patch({ widgetBehavior: { reminders: { hideWhenEmpty: true } } });
    assert.equal((await fetch(`${app.url}/api/import`, { method: 'POST', ...body(exported) })).status, 200);
    assert.equal(app.store.snapshot().settings.widgetBehavior.reminders.hideWhenEmpty, false);
    assert.equal(app.store.snapshot().settings.savedPresets[0].visual.widgetBehavior.reminders.hideWhenEmpty, false);
    assert.equal((await patch({ widgetBehavior: { reminders: { hideWhenEmpty: 'false' } } })).status, 400);
    assert.equal((await patch({ widgetBehavior: { forecast: { hideWhenEmpty: true } } })).status, 400);
    assert.equal(app.store.snapshot().settings.widgetBehavior.reminders.hideWhenEmpty, false, 'invalid edits cannot change saved behavior');
    delete exported.settings.widgetBehavior;
    delete exported.settings.savedPresets[0].visual.widgetBehavior;
    assert.equal((await fetch(`${app.url}/api/import`, { method: 'POST', ...body(exported) })).status, 200);
    assert.equal(app.store.snapshot().settings.widgetBehavior.reminders.hideWhenEmpty, true);
    assert.equal(app.store.snapshot().settings.savedPresets[0].visual.widgetBehavior.reminders.hideWhenEmpty, true);
  } finally { await app.close(); }
});

test('reminder CRUD, nested settings patch, export/import and validation', async () => {
  const app = await fixture();
  try {
    const created = await fetch(`${app.url}/api/reminders`, { method: 'POST', ...body({ text: '  Test reminder  ', dueAt: '2026-11-01T16:00:00Z' }) });
    assert.equal(created.status, 201); const reminder = await created.json();
    assert.equal(reminder.text, 'Test reminder');
    assert.equal((await fetch(`${app.url}/api/reminders/${reminder.id}`, { method: 'PATCH', ...body({ completed: true }) })).status, 200);
    const settings = await fetch(`${app.url}/api/settings`, { method: 'PATCH', ...body({ appearance: { fontScale: 1.2 }, widgetOverrides: { clock: { scale: 1.3 } } }) });
    const updated = await settings.json(); assert.equal(updated.appearance.fontScale, 1.2); assert.equal(updated.widgetOverrides.clock.offsetX, 0);
    assert.equal((await fetch(`${app.url}/api/settings`, { method: 'PATCH', ...body({ appearance: { brightness: 5 } }) })).status, 400);
    assert.equal((await fetch(`${app.url}/api/settings`, { method: 'PATCH', ...body({ unknown: true }) })).status, 400);
    assert.equal((await fetch(`${app.url}/api/reminders`, { method: 'POST', ...body({ text: 'invalid time', dueAt: '2026-11-01T10:00' }) })).status, 400);
    const exported = await (await fetch(`${app.url}/api/export`)).json();
    assert.equal(exported.reminders[0].completed, true);
    assert.equal((await fetch(`${app.url}/api/reminders/${reminder.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${app.url}/api/import`, { method: 'POST', ...body(exported) })).status, 200);
    assert.equal(app.store.snapshot().reminders.length, 1);
    exported.reminders.push(exported.reminders[0]);
    assert.equal((await fetch(`${app.url}/api/import`, { method: 'POST', ...body(exported) })).status, 400);
    assert.equal(app.store.snapshot().reminders.length, 1, 'invalid import is atomic');
  } finally { await app.close(); }
});

test('rejects browser cross-origin and untrusted Host requests', async () => {
  const app = await fixture();
  try {
    assert.equal((await fetch(`${app.url}/api/state`, { headers: { Origin: 'https://attacker.example' } })).status, 403);
    const hostileHostStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${app.url}/api/health`, { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode!); });
      request.on('error', reject); request.end();
    });
    assert.equal(hostileHostStatus, 403);
    assert.equal((await fetch(`${app.url}/api/health`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(`${app.url}/api/host/session`)).status, 403);
    assert.equal((await fetch(`${app.url}/api/host/session`, { headers: { 'X-LRD-Native': '1', Origin: app.url } })).status, 403);
    assert.equal((await fetch(`${app.url}/api/settings`, { method: 'PATCH', body: '{}' })).status, 415);
  } finally { await app.close(); }
});

test('device location is rounded, fallback is Toronto, and late automatic results preserve a manual city', async () => {
  const app = await fixture();
  try {
    assert.equal(app.store.snapshot().settings.locationSource, 'fallback');
    let response = await fetch(`${app.url}/api/location`, { method: 'POST', ...body({ source: 'device', latitude: 12.34567, longitude: 45.67891, automatic: true }) });
    let settings = await response.json();
    assert.equal(settings.locationSource, 'device'); assert.equal(settings.location.name, 'Device area'); assert.equal(settings.location.latitude, 12.3); assert.equal(settings.location.longitude, 45.7); assert.equal(settings.location.timezone, 'auto');
    const weather = await (await fetch(`${app.url}/api/weather`)).json(); assert.equal(weather.location.timezone, 'America/Toronto');
    await fetch(`${app.url}/api/location`, { method: 'POST', ...body({ source: 'fallback', automatic: true }) });
    assert.equal(app.store.snapshot().settings.location.name, 'Toronto');
    await fetch(`${app.url}/api/settings`, { method: 'PATCH', ...body({ location: { name: 'Manual test city', latitude: 1, longitude: 2, timezone: 'Asia/Tokyo' } }) });
    for (const selection of [{ source: 'device', latitude: 12.34567, longitude: 45.67891, automatic: true }, { source: 'fallback', automatic: true }, { source: 'fallback', automatic: false }]) {
      settings = await (await fetch(`${app.url}/api/location`, { method: 'POST', ...body(selection) })).json();
      assert.equal(settings.locationSource, 'manual'); assert.equal(settings.location.name, 'Manual test city');
    }
    response = await fetch(`${app.url}/api/location`, { method: 'POST', ...body({ source: 'device', latitude: 99, longitude: 2, automatic: false }) }); assert.equal(response.status, 400);
    assert.equal(app.store.snapshot().settings.locationSource, 'manual');
    response = await fetch(`${app.url}/api/location`, { method: 'POST', ...body({ source: 'device', latitude: 12.34567, longitude: 45.67891, automatic: false }) }); assert.equal((await response.json()).locationSource, 'device');
    const exported = await (await fetch(`${app.url}/api/export`)).json(); assert.equal(exported.settings.location.latitude, 12.3);
    assert.equal((await fetch(`${app.url}/api/location`, { method: 'POST', headers: { ...body({}).headers, Origin: 'https://attacker.example' }, body: JSON.stringify({ source: 'fallback', automatic: true }) })).status, 403);
    assert.equal((await fetch(`${app.url}/display`)).headers.get('permissions-policy'), 'geolocation=()');
    assert.equal((await fetch(`${app.url}/editor`)).headers.get('permissions-policy'), 'geolocation=(self)');
  } finally { await app.close(); }
});

test('native preview stays in RAM and clears when disabled', async () => {
  const app = await fixture();
  try {
    // Native http clients do not send browser Fetch Metadata headers. Node fetch adds sec-fetch-mode.
    const { request } = await import('node:http');
    async function native(path: string, headers: Record<string, string>, content?: Buffer) {
      return new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request(app.url + path, { method: content ? 'POST' : 'GET', headers }, response => {
          const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString() }));
        }); req.on('error', reject); req.end(content);
      });
    }
    const session = await native('/api/host/session', { 'X-LRD-Native': '1' }); assert.equal(session.status, 200);
    const token = JSON.parse(session.body).token;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC7sAAAAASUVORK5CYII=', 'base64');
    const uploaded = await native('/api/preview', { 'X-LRD-Token': token, 'Content-Type': 'image/png', 'X-Captured-At': new Date().toISOString() }, png);
    assert.equal(uploaded.status, 201);
    assert.equal((await fetch(`${app.url}/api/preview/image`)).headers.get('cache-control'), 'no-store');
    assert.deepEqual(await readdir(app.directory), ['state.json']);
    await fetch(`${app.url}/api/settings`, { method: 'PATCH', ...body({ preview: { enabled: false } }) });
    assert.equal((await fetch(`${app.url}/api/preview/image`)).status, 404);
    assert.equal((await (await fetch(`${app.url}/api/preview`)).json()).available, false);
  } finally { await app.close(); }
});

test('every preview clear invalidates an upload whose body is still arriving', async t => {
  for (const operation of ['disable', 'hide widget', 'delete', 'import', 'expire'] as const) {
    await t.test(operation, async () => {
      let currentTime = Date.now();
      const app = await fixture(() => currentTime);
      const pendingRequests: ReturnType<typeof httpRequest>[] = [];
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC7sAAAAASUVORK5CYII=', 'base64');
      function native(path: string, method: string, headers: Record<string, string>, content?: Buffer, delayed = false) {
        let request!: ReturnType<typeof httpRequest>;
        const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
          request = httpRequest(app.url + path, { method, headers }, incoming => {
            const chunks: Buffer[] = []; incoming.on('data', chunk => chunks.push(chunk));
            incoming.on('end', () => resolve({ status: incoming.statusCode!, body: Buffer.concat(chunks).toString() }));
          });
          request.on('error', reject);
          if (delayed) request.write(content!.subarray(0, 8)); else request.end(content);
        });
        pendingRequests.push(request);
        return { response, finish() { request.end(content!.subarray(8)); } };
      }
      try {
        const session = await native('/api/host/session', 'GET', { 'X-LRD-Native': '1' }).response;
        assert.equal(session.status, 200);
        const token = JSON.parse(session.body).token;
        const headers = () => ({ 'X-LRD-Token': token, 'Content-Type': 'image/png', 'X-Captured-At': new Date(currentTime).toISOString() });
        assert.equal((await native('/api/preview', 'POST', headers(), png).response).status, 201);

        // Observe the first body bytes on the server instead of relying on a timer.
        const bodyStarted = new Promise<void>(resolve => app.server.once('request', incoming => incoming.once('data', () => resolve())));
        const delayed = native('/api/preview', 'POST', headers(), png, true);
        await bodyStarted;
        if (operation === 'disable' || operation === 'hide widget') {
          const patch = operation === 'disable' ? { preview: { enabled: false } } : { widgets: { preview: false } };
          assert.equal((await fetch(`${app.url}/api/settings`, { method: 'PATCH', ...body(patch) })).status, 200);
          // A later re-enable must not revive the upload from before the clear.
          assert.equal((await fetch(`${app.url}/api/settings`, { method: 'PATCH', ...body({ preview: { enabled: true }, widgets: { preview: true } }) })).status, 200);
        } else if (operation === 'delete') {
          assert.equal((await native('/api/preview', 'DELETE', { 'X-LRD-Token': token }).response).status, 204);
        } else if (operation === 'import') {
          const exported = await (await fetch(`${app.url}/api/export`)).json();
          assert.equal((await fetch(`${app.url}/api/import`, { method: 'POST', ...body(exported) })).status, 200);
        } else {
          currentTime += 12 * 3600_000 + 1;
        }
        assert.equal((await (await fetch(`${app.url}/api/preview`)).json()).available, false);
        delayed.finish();
        assert.equal((await delayed.response).status, 409, 'a cleared upload cannot publish');
        assert.equal((await (await fetch(`${app.url}/api/preview`)).json()).available, false);
        assert.equal((await fetch(`${app.url}/api/preview/image`)).status, 404);
        assert.equal((await native('/api/preview', 'POST', headers(), png).response).status, 201, 'a new upload after clearing still works');
        assert.ok((await readdir(app.directory)).every(name => name === 'state.json' || name === 'state.backup.json'), 'no image files are persisted');
      } finally {
        for (const request of pendingRequests) request.destroy();
        await app.close();
      }
    });
  }
});

// #351, #352, #353, #124 and #287: prompt state answers, forecast only when needed, metadata-only
// polls, HEAD for the snapshot image and stale-Save detection. Synthetic providers only.

/** A provider whose answers wait until the test releases them; every request is recorded. */
function heldProvider() {
  const requests: URL[] = []; const waiting: (() => void)[] = [];
  return {
    requests,
    forecasts: () => requests.filter(url => url.hostname === 'api.open-meteo.com').length,
    airs: () => requests.filter(url => url.hostname === 'air-quality-api.open-meteo.com').length,
    release() { for (const resolve of waiting.splice(0)) resolve(); },
    fetcher: async (input: string | URL) => {
      const url = new URL(input); requests.push(url);
      await new Promise<void>(resolve => waiting.push(resolve));
      return Response.json(url.hostname === 'air-quality-api.open-meteo.com' ? airFixture() : forecastFixture());
    },
  };
}
function airFixture() {
  const start = Date.parse('2026-10-18T06:00:00Z') / 1000, time = Array.from({ length: 24 }, (_, index) => start + index * 3600);
  return { timezone: 'America/Toronto', current: { time: start, us_aqi: 40, us_aqi_pm2_5: 40, pm2_5: 10, pm10: 15, uv_index: 1 }, hourly: { time, us_aqi: time.map(() => 40), uv_index: time.map(() => 1) } };
}
async function serve(options: Partial<Parameters<typeof createApplication>[0]>) {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-api-sync-'));
  const app = await createApplication({ dataDirectory: directory, ...options });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  return { ...app, directory, url,
    state: async () => (await fetch(`${url}/api/state`)).json(),
    patch: (value: unknown, headers: Record<string, string> = {}) => fetch(`${url}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) }),
    async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); } };
}
async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now(); const value = await work(); return { value, ms: performance.now() - started };
}
const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('/api/state, /api/weather and /api/air-quality answer within the refresh wait while the provider hangs (#351)', async () => {
  const provider = heldProvider();
  const app = await serve({ fetcher: provider.fetcher });
  try {
    assert.equal((await app.patch({ widgets: { airQuality: true } })).status, 200);
    const first = await timed(app.state);
    assert.ok(first.ms < 1000 + 250, `answered after the 1 s wait, not the provider: ${Math.round(first.ms)} ms`);
    assert.equal(first.value.weather.status, 'unavailable'); assert.equal(first.value.weather.error, null, 'the first fetch is not reported as a failure');
    assert.equal(first.value.weather.refreshing, true); assert.equal(first.value.airQuality.refreshing, true); assert.equal(first.value.airQuality.error, null);
    const parallel = await timed(() => Promise.all(Array.from({ length: 5 }, () => app.state())));
    assert.ok(parallel.ms < 1000 + 250, `parallel polls answer within the wait too: ${Math.round(parallel.ms)} ms`);
    assert.equal(provider.forecasts(), 1, 'parallel requests share one forecast refresh');
    assert.equal(provider.airs(), 1, 'and one air-quality refresh');
    for (const path of ['/api/weather', '/api/air-quality']) {
      const answer = await timed(async () => (await fetch(`${app.url}${path}`)).json());
      assert.ok(answer.ms < 1000 + 250, `${path} answers within the wait: ${Math.round(answer.ms)} ms`);
      assert.equal(answer.value.refreshing, true, `${path} says it is still refreshing`);
    }
    assert.equal(provider.forecasts() + provider.airs(), 2, 'still the same two refreshes');
    provider.release(); await settle(50);
    const later = await timed(app.state);
    assert.ok(later.ms < 250, 'nothing is due once the refresh landed');
    assert.equal(later.value.weather.status, 'fresh'); assert.equal('refreshing' in later.value.weather, false);
    assert.equal(later.value.airQuality.status, 'fresh'); assert.equal('refreshing' in later.value.airQuality, false);
  } finally { provider.release(); await app.close(); }
});

test('a slow provider fills the next request after it completes; a failing one keeps its back-off (#351)', async () => {
  let current = Date.parse('2026-10-18T06:30:00Z'); let calls = 0; let mode: 'slow' | 'fail' = 'slow';
  const app = await serve({ now: () => current, refreshWaitMs: 300, fetcher: async () => {
    calls++; await settle(mode === 'slow' ? 2000 : 600);
    if (mode === 'fail') throw new Error('Synthetic outage');
    return Response.json(forecastFixture());
  } });
  try {
    const first = await timed(app.state);
    assert.ok(first.ms < 300 + 250, `the injected wait bounds the answer: ${Math.round(first.ms)} ms`);
    assert.equal(first.value.weather.refreshing, true);
    await settle(2000);
    const fresh = await app.state();
    assert.equal(fresh.weather.status, 'fresh'); assert.equal(calls, 1);
    // 16 minutes later a failing refresh: the retained forecast is reported stale while it runs, then failed.
    mode = 'fail'; current += 16 * 60_000;
    const during = await app.state();
    assert.equal(during.weather.status, 'stale'); assert.equal(during.weather.refreshing, true); assert.equal(during.weather.updatedAt, fresh.weather.updatedAt);
    await settle(700);
    const failed = await app.state();
    assert.equal(failed.weather.status, 'stale'); assert.match(failed.weather.error, /last successful forecast/); assert.equal('refreshing' in failed.weather, false);
    assert.equal(calls, 2);
    current += 30_000; await app.state(); assert.equal(calls, 2, 'the one-minute back-off is unchanged');
    current += 31_000; await app.state(); assert.equal(calls, 3, 'and retries after it');
  } finally { await app.close(); }
});

test('/api/state requests the forecast only while a saved widget needs it (#352)', async () => {
  let current = Date.parse('2026-10-18T06:30:00Z');
  const requests: URL[] = [];
  const app = await serve({ now: () => current, fetcher: async input => { requests.push(new URL(input)); return Response.json(forecastFixture()); } });
  const forecasts = () => requests.filter(url => url.hostname === 'api.open-meteo.com').length;
  try {
    // Clock, Note, Calendar and Sun & moon with a resolved city zone: no widget needs the forecast.
    assert.equal((await app.patch({ widgets: { weather: false, forecast: false, sunMoon: true, note: true, calendar: true }, widgetGrid: { placements: { sunMoon: { column: 0, row: 6, size: 'small' } } } })).status, 200);
    for (let poll = 0; poll < 12; poll++) {
      const state = await app.state();
      assert.equal(state.weather.status, 'unavailable'); assert.equal(state.weather.error, null); assert.equal(state.weather.location.name, 'Toronto');
      current += 16 * 60_000;
    }
    assert.equal(forecasts(), 0, 'twelve polls over three hours make no forecast request');
    // The editor's Weather tab asks for it explicitly; later polls serve that cached forecast without a request.
    assert.equal((await (await fetch(`${app.url}/api/weather`)).json()).status, 'fresh'); assert.equal(forecasts(), 1);
    assert.equal((await app.state()).weather.status, 'fresh', 'a poll serves the cached forecast');
    current += 16 * 60_000;
    assert.equal((await app.state()).weather.status, 'stale', 'and calls it stale once it ages, still without a request');
    assert.equal(forecasts(), 1);
    // Enabling Weather and saving fetches it on the next state request.
    assert.equal((await app.patch({ widgets: { weather: true } })).status, 200);
    assert.equal((await app.state()).weather.status, 'fresh'); assert.equal(forecasts(), 2);
    // Sun & moon needs the forecast only while the zone is still `auto`.
    assert.equal((await app.patch({ widgets: { weather: false }, locationSource: 'device', location: { name: 'Device area', latitude: 12.3, longitude: 45.7, timezone: 'auto' } })).status, 200);
    const resolved = await app.state();
    assert.equal(forecasts(), 3); assert.equal(resolved.weather.location.timezone, 'America/Toronto', 'the forecast resolves the zone Sun & moon uses');
    assert.equal((await app.patch({ widgets: { sunMoon: false, forecast: true } })).status, 200);
    current += 16 * 60_000; await app.state(); assert.equal(forecasts(), 4, 'Forecast needs it whatever the zone');
  } finally { await app.close(); }
});

test('/api/state copies no photo bytes and the photo image is decoded once per photo (#353)', async () => {
  const app = await serve({ fetcher: async () => Response.json(forecastFixture()) });
  try {
    const png = photoFixture(8, 8), pngBase64 = png.toString('base64');
    assert.equal((await app.patch({ photoChange: { pngBase64 } })).status, 200);
    await app.state(); // warm the forecast cache
    const realClone = globalThis.structuredClone; const cloned: unknown[] = [];
    globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => { cloned.push(value); return realClone(value, options); }) as typeof structuredClone;
    let state: { photo: { available: boolean; id: string } };
    try { state = await app.state(); } finally { globalThis.structuredClone = realClone; }
    assert.ok(cloned.length > 0, 'the spy saw the request');
    assert.ok(!cloned.some(value => JSON.stringify(value).includes(pngBase64)), 'nothing holding the photo bytes was cloned for /api/state');
    assert.equal(state.photo.available, true);
    const decode = Buffer.from; let decoded = 0;
    Buffer.from = ((...args: Parameters<typeof Buffer.from>) => { if (args[1] === 'base64' && args[0] === pngBase64) decoded++; return decode(...(args as [string, BufferEncoding])); }) as typeof Buffer.from;
    try {
      for (let request = 0; request < 3; request++) {
        const image = await fetch(`${app.url}/api/photo/image?id=${state.photo.id}`);
        assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
      }
    } finally { Buffer.from = decode; }
    assert.equal(decoded, 1, 'three requests decode the image once');
    const replacement = photoFixture(2, 2);
    assert.equal((await app.patch({ photoChange: { pngBase64: replacement.toString('base64') } })).status, 200);
    const next = await app.state();
    assert.notEqual(next.photo.id, state.photo.id);
    assert.equal((await fetch(`${app.url}/api/photo/image?id=${state.photo.id}`)).status, 404, 'the old id is gone');
    assert.deepEqual(Buffer.from(await (await fetch(`${app.url}/api/photo/image?id=${next.photo.id}`)).arrayBuffer()), replacement, 'a changed photo replaces the cached image');
  } finally { await app.close(); }
});

test('HEAD /api/preview/image answers like GET without a body (#124)', async () => {
  const app = await serve({ fetcher: async () => Response.json(forecastFixture()) });
  try {
    function raw(path: string, method: string, headers: Record<string, string> = {}, content?: Buffer) {
      return new Promise<{ status: number; headers: Record<string, unknown>; bytes: number }>((resolve, reject) => {
        const request = httpRequest(app.url + path, { method, headers }, response => {
          let bytes = 0; response.on('data', chunk => { bytes += chunk.length; });
          response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, bytes }));
        });
        request.on('error', reject); request.end(content);
      });
    }
    const compare = async (label: string) => {
      const [get, head] = [await raw('/api/preview/image', 'GET'), await raw('/api/preview/image', 'HEAD')];
      assert.equal(head.status, get.status, `${label}: same status`);
      for (const name of ['content-type', 'cache-control', 'content-length']) assert.equal(head.headers[name], get.headers[name], `${label}: same ${name}`);
      assert.equal(head.bytes, 0, `${label}: no body`);
      return get;
    };
    assert.equal((await compare('no snapshot yet')).status, 404);
    const token = JSON.parse(await new Promise<string>((resolve, reject) => {
      const request = httpRequest(`${app.url}/api/host/session`, { headers: { 'X-LRD-Native': '1' } }, response => { let text = ''; response.on('data', chunk => { text += chunk; }); response.on('end', () => resolve(text)); });
      request.on('error', reject); request.end();
    })).token;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC7sAAAAASUVORK5CYII=', 'base64');
    const upload = () => raw('/api/preview', 'POST', { 'X-LRD-Token': token, 'Content-Type': 'image/png', 'X-Captured-At': new Date().toISOString() }, png);
    assert.equal((await upload()).status, 201);
    const available = await compare('available');
    assert.equal(available.status, 200); assert.equal(available.bytes, png.length); assert.equal(available.headers['content-type'], 'image/png');
    assert.equal((await raw('/api/preview', 'DELETE', { 'X-LRD-Token': token })).status, 204);
    assert.equal((await compare('cleared')).status, 404);
    assert.equal((await upload()).status, 201);
    assert.equal((await app.patch({ preview: { enabled: false } })).status, 200);
    assert.equal((await compare('disabled')).status, 404);
  } finally { await app.close(); }
});

test('settings carry an in-memory revision; a stale If-Match is refused with the current settings (#287)', async () => {
  const app = await serve({ fetcher: async () => Response.json(forecastFixture()) });
  try {
    const first = await fetch(`${app.url}/api/state`);
    const revision = first.headers.get('etag');
    assert.match(revision!, /^"[0-9a-f]{12}-0"$/);
    // Reminders are not settings: their writes keep the revision.
    assert.equal((await fetch(`${app.url}/api/reminders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Synthetic' }) })).status, 201);
    assert.equal((await fetch(`${app.url}/api/state`)).headers.get('etag'), revision);
    // Tab A saves with the current revision; the response names the new one.
    const saved = await app.patch({ widgetData: { countdowns: [{ id: '11111111-1111-4111-8111-111111111111', title: 'From tab A', date: '2026-12-25', repeatsYearly: false }] } }, { 'If-Match': revision! });
    assert.equal(saved.status, 200);
    const next = saved.headers.get('etag');
    assert.ok(next && next !== revision, 'a settings write changes the revision');
    assert.equal((await fetch(`${app.url}/api/state`)).headers.get('etag'), next);
    // Tab B still has the first revision: refused, nothing written, the current settings returned.
    const stale = await app.patch({ widgetData: { countdowns: [{ id: '22222222-2222-4222-8222-222222222222', title: 'From tab B', date: '2026-12-24', repeatsYearly: false }] } }, { 'If-Match': revision! });
    assert.equal(stale.status, 409); assert.equal(stale.headers.get('etag'), next); assert.equal(stale.headers.get('cache-control'), 'no-store');
    const conflict = await stale.json();
    assert.equal(conflict.error, 'Settings changed in another window. Review and save again.');
    assert.equal(`"${conflict.revision}"`, next);
    assert.deepEqual(conflict.settings.widgetData.countdowns.map((item: { title: string }) => item.title), ['From tab A']);
    assert.deepEqual(app.store.snapshot().settings.widgetData.countdowns.map(item => item.title), ['From tab A'], 'nothing was written');
    // B retries from the current revision; a list of tags matches any; `*` and no header keep today's behaviour.
    assert.equal((await app.patch({ units: 'imperial' }, { 'If-Match': `"stale", ${next}` })).status, 200);
    assert.equal((await app.patch({ clockFormat: '24h' }, { 'If-Match': '*' })).status, 200);
    assert.equal((await app.patch({ appearance: { fontScale: 1.2 } })).status, 200);
    assert.equal((await app.patch({ appearance: { fontScale: 1.3 } }, { 'If-Match': 'not-a-tag' })).status, 409, 'an unquoted tag names no revision');
    // Validation still comes first, and the revision never reaches the files or the export.
    assert.equal((await app.patch({ appearance: { brightness: 9 } }, { 'If-Match': revision! })).status, 400);
    const files = [await readFile(join(app.directory, 'state.json'), 'utf8'), await readFile(join(app.directory, 'state.backup.json'), 'utf8'), await (await fetch(`${app.url}/api/export`)).text()];
    const boot = next!.slice(1, 13);
    for (const file of files) assert.equal(file.includes(boot), false, 'the revision is not persisted or exported');
  } finally { await app.close(); }
});
