import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-api-'));
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  return { ...app, directory, url: `http://127.0.0.1:${address.port}`, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); } };
}
function body(value: unknown) { return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }; }

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
