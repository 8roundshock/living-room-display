import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';

async function fixture(now?: () => number) {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-api-'));
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()), now });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  return { ...app, directory, url: `http://127.0.0.1:${address.port}`, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); } };
}
function body(value: unknown) { return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }; }

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
