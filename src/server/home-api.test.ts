// Home's item, show and change-marker endpoints (#438). Synthetic data in temporary folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { showPlacement } from '../shared/show.ts';
import { forecastFixture } from './fixtures.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { WIDGET_IDS, gridProblem, placementSpan } from '../shared/widgets.ts';
import type { Settings, WidgetId } from '../shared/contracts.ts';

const START = Date.parse('2026-10-20T22:00:00.000Z');

async function application(directory: string, clock = { now: START }) {
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()), now: () => clock.now });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const send = async (method: string, path: string, value?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${url}${path}`, value === undefined ? { method, headers } : { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };
  /** A native helper request: no Origin and no browser Fetch Metadata (Node's fetch adds sec-fetch-mode). */
  const native = (path: string, method: string, headers: Record<string, string>, content?: Buffer) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(url + path, { method, headers }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject); request.end(content);
  });
  return { ...app, url, send, native, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); } };
}
async function folder() { return mkdtemp(join(tmpdir(), 'lrd-home-api-')); }
async function hash(directory: string, name: string) { return createHash('sha256').update(await readFile(join(directory, name))).digest('hex'); }
async function seed(directory: string, edit: (settings: Settings) => void) {
  const settings = defaultSettings(); edit(settings);
  assert.equal(gridProblem(settings.widgetGrid, settings.widgets), null, 'the seeded board is valid');
  await writeFile(join(directory, 'state.json'), JSON.stringify({ version: 1, settings, reminders: [] }));
}
/** Every enabled widget's cells, to prove a show never moves another widget. */
function boardOf(settings: Settings) {
  return Object.fromEntries(WIDGET_IDS.filter(id => settings.widgets[id]).map(id => [id, settings.widgetGrid.placements[id]]));
}

test('#438 countdowns and world clocks are added and removed one at a time, with limits, validation and Undo', async () => {
  const directory = await folder();
  const app = await application(directory);
  try {
    const created = await app.send('POST', '/api/countdowns', { title: '  Synthetic trip  ', date: '2026-11-02' });
    assert.equal(created.status, 201);
    const [trip] = created.body.widgetData.countdowns;
    assert.match(trip.id, /^[0-9a-f-]{36}$/, 'the server assigns a uuid');
    assert.deepEqual({ ...trip, id: 'x' }, { id: 'x', title: 'Synthetic trip', date: '2026-11-02', repeatsYearly: false });
    for (const invalid of [{ title: '', date: '2026-11-02' }, { title: 'x'.repeat(61), date: '2026-11-02' }, { title: 'A', date: '2026-02-30' }, { title: 'A', date: '2026-11-02', extra: 1 }, { title: 'A', date: '2026-11-02', id: 'nope' }])
      assert.equal((await app.send('POST', '/api/countdowns', invalid)).status, 400, JSON.stringify(invalid));
    // Two pages adding at the same time both keep their item.
    await Promise.all([app.send('POST', '/api/countdowns', { title: 'Synthetic A', date: '2026-12-01' }), app.send('POST', '/api/countdowns', { title: 'Synthetic B', date: '2026-12-02', repeatsYearly: true })]);
    const titles = (await app.send('GET', '/api/state')).body.settings.widgetData.countdowns.map((item: { title: string }) => item.title);
    assert.deepEqual(titles.toSorted(), ['Synthetic A', 'Synthetic B', 'Synthetic trip']);
    // Remove, then Undo with the same id at its old index.
    const removed = await app.send('DELETE', `/api/countdowns/${trip.id}`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.widgetData.countdowns.some((item: { id: string }) => item.id === trip.id), false);
    assert.equal((await app.send('DELETE', `/api/countdowns/${trip.id}`)).status, 404);
    const restored = await app.send('POST', '/api/countdowns', { id: trip.id, index: 0, title: trip.title, date: trip.date, repeatsYearly: false });
    assert.equal(restored.status, 201);
    assert.equal(restored.body.widgetData.countdowns[0].id, trip.id, 'Undo returns it to its place');
    const again = await app.send('POST', '/api/countdowns', { id: trip.id, index: 0, title: trip.title, date: trip.date });
    assert.equal(again.status, 200, 'a repeated Undo changes nothing');
    assert.equal(again.body.widgetData.countdowns.length, 3);
    for (let index = 3; index < 12; index++) assert.equal((await app.send('POST', '/api/countdowns', { title: `Synthetic ${index}`, date: '2027-01-01' })).status, 201);
    const full = await app.send('POST', '/api/countdowns', { title: 'One too many', date: '2027-01-01' });
    assert.deepEqual([full.status, full.body.error], [409, 'Up to 12 countdowns. Remove one to add another.']);

    const city = { label: 'Synthetic City', timezone: 'Europe/London', latitude: 51.5, longitude: -0.1 };
    const clock = await app.send('POST', '/api/world-clocks', city);
    assert.equal(clock.status, 201);
    const [london] = clock.body.widgetData.worldClocks;
    for (const invalid of [{ ...city, timezone: 'Mars/Base' }, { ...city, timezone: 'auto' }, { ...city, label: '' }, { ...city, latitude: 91 }, { ...city, index: 4 }])
      assert.equal((await app.send('POST', '/api/world-clocks', invalid)).status, 400, JSON.stringify(invalid));
    for (let index = 1; index < 4; index++) assert.equal((await app.send('POST', '/api/world-clocks', { ...city, label: `City ${index}` })).status, 201);
    const fullClocks = await app.send('POST', '/api/world-clocks', city);
    assert.deepEqual([fullClocks.status, fullClocks.body.error], [409, 'Up to 4 cities. Remove one to add another.']);
    assert.equal((await app.send('DELETE', `/api/world-clocks/${london.id}`)).status, 200);
    assert.equal((await app.send('DELETE', `/api/world-clocks/${randomUUID()}`)).status, 404);
    const undone = await app.send('POST', '/api/world-clocks', { ...city, id: london.id, index: 0 });
    assert.equal(undone.body.widgetData.worldClocks[0].id, london.id);
    // The note keeps using the ordinary settings PATCH.
    assert.equal((await app.send('PATCH', '/api/settings', { widgetData: { note: { text: 'Synthetic note' } } })).body.widgetData.note.text, 'Synthetic note');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('#438 Show on my display uses free cells only and never moves another widget', async () => {
  // Default board: Clock, Weather, Forecast, Reminders and Last screen; World clocks' saved cells are free.
  let directory = await folder();
  let app = await application(directory);
  try {
    const before = (await app.send('GET', '/api/state')).body.settings as Settings;
    const shown = await app.send('POST', '/api/widgets/worldClocks/show');
    assert.equal(shown.status, 200);
    assert.equal(shown.body.widgets.worldClocks, true);
    assert.deepEqual(shown.body.widgetGrid.placements.worldClocks, before.widgetGrid.placements.worldClocks, 'the saved placement is kept when it is free');
    assert.deepEqual({ ...boardOf(shown.body), worldClocks: undefined }, { ...boardOf(before), worldClocks: undefined }, 'no other widget moved');
    const file = await hash(directory, 'state.json');
    const repeat = await app.send('POST', '/api/widgets/worldClocks/show');
    assert.equal(repeat.status, 200);
    assert.equal(await hash(directory, 'state.json'), file, 'showing a shown widget writes nothing');
    for (const id of ['weather', 'preview', 'photo', 'rain', 'forecast', 'airQuality', 'sunMoon', 'synthetic', 'constructor'])
      assert.equal((await app.send('POST', `/api/widgets/${id}/show`)).status, 400, `${id} is not shown from Home`);
    assert.equal((await app.send('PATCH', '/api/settings', { widgets: { worldClocks: false } })).body.widgetGrid.placements.worldClocks.column, before.widgetGrid.placements.worldClocks.column, 'turning it off keeps its placement');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }

  // A board whose saved Calendar cells are taken: the first free cells at medium, else small.
  directory = await folder();
  await seed(directory, settings => {
    settings.widgets.preview = false;
    settings.widgetGrid.placements.calendar = { column: 8, row: 4, size: 'medium' };
    settings.widgets.sunMoon = true; settings.widgetGrid.placements.sunMoon = { column: 8, row: 4, size: 'small' };
  });
  app = await application(directory);
  try {
    const before = (await app.send('GET', '/api/state')).body.settings as Settings;
    const shown = await app.send('POST', '/api/widgets/calendar/show');
    assert.equal(shown.status, 200);
    const placement = shown.body.widgetGrid.placements.calendar;
    assert.equal(placement.size, 'medium');
    assert.deepEqual(placement, showPlacement(before, 'calendar'));
    assert.notDeepEqual([placement.column, placement.row], [8, 4]);
    assert.deepEqual({ ...boardOf(shown.body), calendar: undefined }, { ...boardOf(before), calendar: undefined });
    assert.equal(gridProblem(shown.body.widgetGrid, shown.body.widgets), null);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }

  // Only room for a small Clock: the family steps down from large.
  directory = await folder();
  await seed(directory, settings => {
    settings.widgets.clock = false; settings.widgets.preview = false; settings.widgets.reminders = false;
    settings.widgetGrid.placements.weather = { column: 0, row: 0, size: 'large' };
    settings.widgets.calendar = true; settings.widgetGrid.placements.calendar = { column: 4, row: 0, size: 'large' };
    settings.widgets.countdown = true; settings.widgetGrid.placements.countdown = { column: 8, row: 0, size: 'large' };
    settings.widgets.note = true; settings.widgetGrid.placements.note = { column: 0, row: 4, size: 'large' };
    settings.widgets.worldClocks = true; settings.widgetGrid.placements.worldClocks = { column: 4, row: 4, size: 'medium' };
    settings.widgets.sunMoon = true; settings.widgetGrid.placements.sunMoon = { column: 4, row: 6, size: 'medium' };
    settings.widgetGrid.placements.forecast = { column: 8, row: 6, size: 'medium' };
    settings.widgets.airQuality = true; settings.widgetGrid.placements.airQuality = { column: 8, row: 4, size: 'small' };
  });
  app = await application(directory);
  try {
    const shown = await app.send('POST', '/api/widgets/clock/show');
    assert.equal(shown.status, 200);
    assert.deepEqual(shown.body.widgetGrid.placements.clock, { column: 10, row: 4, size: 'small' });
    assert.equal(gridProblem(shown.body.widgetGrid, shown.body.widgets), null);
    // Now the board is full: no room, and nothing written.
    const file = await hash(directory, 'state.json');
    const refused = await app.send('POST', '/api/widgets/reminders/show');
    assert.deepEqual([refused.status, refused.body.error], [409, 'No room for Reminders on your display.']);
    assert.equal(await hash(directory, 'state.json'), file);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('#438 a saved free-size Reminders span is kept when it still fits', async () => {
  const directory = await folder();
  await seed(directory, settings => {
    settings.widgets.reminders = false; settings.widgets.preview = false;
    settings.widgetGrid.placements.reminders = { column: 8, row: 4, size: 'medium', span: { columns: 4, rows: 3 } };
  });
  const app = await application(directory);
  try {
    const before = (await app.send('GET', '/api/state')).body.settings as Settings;
    const shown = await app.send('POST', '/api/widgets/reminders/show');
    assert.equal(shown.status, 200);
    assert.deepEqual(placementSpan('reminders', shown.body.widgetGrid.placements.reminders), placementSpan('reminders', before.widgetGrid.placements.reminders));
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('#438 the change marker moves after every saved change and never on a read', async () => {
  const directory = await folder(), clock = { now: Date.now() };
  let app = await application(directory, clock);
  try {
    const marker = async () => {
      const response = await app.send('GET', '/api/changes');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.body.change, /^[0-9a-f]{12}\.\d+\.\d+\.\d+$/);
      return response.body.change as string;
    };
    let last = await marker();
    const expectChange = async (label: string) => { const next = await marker(); assert.notEqual(next, last, `${label} moves the marker`); last = next; };
    const expectSame = async (label: string) => assert.equal(await marker(), last, `${label} leaves the marker`);
    for (const path of ['/api/state', '/api/timers', '/api/reminders', '/api/weather', '/api/preview', '/api/export', '/api/health']) await app.send('GET', path);
    await expectSame('reads');

    await app.send('PATCH', '/api/settings', { clockFormat: '24h' }); await expectChange('a settings save');
    const reminder = (await app.send('POST', '/api/reminders', { text: 'Synthetic reminder' })).body; await expectChange('a new reminder');
    await app.send('PATCH', `/api/reminders/${reminder.id}`, { completed: true }); await expectChange('a check-off');
    await app.send('PATCH', `/api/reminders/${reminder.id}`, { completed: true }); await expectSame('a repeated check-off');
    await app.send('DELETE', `/api/reminders/${reminder.id}`); await expectChange('a reminder delete');
    const timer = (await app.send('POST', '/api/timers', { durationMs: 60_000 })).body; await expectChange('a new timer');
    await app.send('PATCH', `/api/timers/${timer.id}`, { paused: true }); await expectChange('a pause');
    await app.send('PATCH', `/api/timers/${timer.id}`, { paused: true }); await expectSame('a repeated pause');
    await app.send('DELETE', `/api/timers/${timer.id}`); await expectChange('a timer delete');
    const countdown = (await app.send('POST', '/api/countdowns', { title: 'Synthetic', date: '2027-01-01' })).body.widgetData.countdowns[0]; await expectChange('a new countdown');
    await app.send('DELETE', `/api/countdowns/${countdown.id}`); await expectChange('a countdown delete');
    await app.send('POST', '/api/world-clocks', { label: 'Synthetic', timezone: 'Asia/Tokyo', latitude: 35.7, longitude: 139.7 }); await expectChange('a new world clock');
    await app.send('POST', '/api/widgets/calendar/show'); await expectChange('a shown widget');
    await app.send('POST', '/api/widgets/calendar/show'); await expectSame('showing a shown widget');
    await app.send('POST', '/api/location', { source: 'fallback', automatic: false }); await expectChange('a location save');
    await app.send('POST', '/api/import', await (await fetch(`${app.url}/api/export`)).json()); await expectChange('an import');
    await app.send('PATCH', '/api/settings', { units: 'nonsense' }); await expectSame('a refused save');

    // The native snapshot: an upload and its clear both move the marker.
    const token = JSON.parse((await app.native('/api/host/session', 'GET', { 'X-LRD-Native': '1' })).body).token;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC7sAAAAASUVORK5CYII=', 'base64');
    assert.equal((await app.native('/api/preview', 'POST', { 'X-LRD-Token': token, 'Content-Type': 'image/png', 'X-Captured-At': new Date(clock.now).toISOString() }, png)).status, 201);
    await expectChange('a snapshot upload');
    assert.equal((await app.native('/api/preview', 'DELETE', { 'X-LRD-Token': token })).status, 204);
    await expectChange('a snapshot clear');
    assert.equal((await app.native('/api/preview', 'DELETE', { 'X-LRD-Token': token })).status, 204);
    await expectSame('clearing nothing');
    await app.close();
    app = await application(directory, clock);
    await expectChange('a restart');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('#438 Home endpoints keep the local-only protections, and only Edit display may ask for location', async () => {
  const directory = await folder();
  const app = await application(directory);
  try {
    for (const path of ['/', '/display', '/somewhere', '/api/state']) assert.equal((await fetch(`${app.url}${path}`)).headers.get('permissions-policy'), 'geolocation=()', path);
    for (const path of ['/editor', '/editor?add=worldClocks']) assert.equal((await fetch(`${app.url}${path}`)).headers.get('permissions-policy'), 'geolocation=(self)', path);
    const routes: [string, string, unknown][] = [
      ['POST', '/api/timers', { durationMs: 60_000 }], ['DELETE', '/api/timers/finished', undefined], ['POST', '/api/countdowns', { title: 'A', date: '2027-01-01' }],
      ['POST', '/api/world-clocks', { label: 'A', timezone: 'UTC', latitude: 0, longitude: 0 }], ['POST', '/api/widgets/calendar/show', undefined], ['GET', '/api/changes', undefined],
    ];
    for (const [method, path, value] of routes) {
      assert.equal((await app.send(method, path, value, { Origin: 'https://attacker.example' })).status, 403, `${method} ${path} cross-origin`);
      assert.equal((await app.send(method, path, value, { 'Sec-Fetch-Site': 'cross-site' })).status, 403, `${method} ${path} cross-site`);
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(`${app.url}${path}`, { method, headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode!); });
        request.on('error', reject); request.end();
      });
      assert.equal(status, 403, `${method} ${path} wrong host`);
    }
    for (const path of ['/api/timers', '/api/countdowns', '/api/world-clocks'])
      assert.equal((await fetch(`${app.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415, path);
    assert.equal((await app.send('POST', '/api/countdowns', { title: 'A', date: '2027-01-01', note: 'x' })).status, 400, 'unknown fields are rejected');
    assert.equal((await app.send('GET', '/api/countdowns')).status, 404);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('#438 showPlacement steps down through the families a widget supports', () => {
  const settings = defaultSettings();
  // Fill everything except one 2 × 2 corner.
  for (const id of WIDGET_IDS) settings.widgets[id] = false;
  const fill: [WidgetId, number, number, 'large' | 'medium' | 'small'][] = [['weather', 0, 0, 'large'], ['forecast', 4, 0, 'large'], ['calendar', 0, 4, 'large'], ['countdown', 4, 4, 'large'], ['note', 8, 0, 'large'], ['worldClocks', 8, 4, 'medium'], ['sunMoon', 8, 6, 'small']];
  for (const [id, column, row, size] of fill) { settings.widgets[id] = true; settings.widgetGrid.placements[id] = { column, row, size }; }
  settings.widgetGrid.placements.forecast = { column: 4, row: 2, size: 'medium' }; settings.widgets.airQuality = true; settings.widgetGrid.placements.airQuality = { column: 4, row: 0, size: 'medium' };
  assert.equal(gridProblem(settings.widgetGrid, settings.widgets), null);
  assert.deepEqual(showPlacement(settings, 'clock'), { column: 10, row: 6, size: 'small' });
  settings.widgets.photo = true; settings.widgetGrid.placements.photo = { column: 10, row: 6, size: 'small' };
  assert.equal(showPlacement(settings, 'clock'), null);
});

test('#438 item and show writes move the settings revision, so an Edit display draft from before gets 409 and the current settings', async () => {
  const directory = await folder();
  const app = await application(directory);
  try {
    const state = await fetch(`${app.url}/api/state`);
    const revision = state.headers.get('etag');
    assert.ok(revision);
    const editorSave = () => app.send('PATCH', '/api/settings', { appearance: { brightness: 0.4 } }, { 'If-Match': revision! });
    for (const [label, write] of [
      ['a countdown', () => app.send('POST', '/api/countdowns', { title: 'Synthetic from Home', date: '2027-01-01' })],
      ['a shown widget', () => app.send('POST', '/api/widgets/calendar/show')],
    ] as const) {
      const before = (await fetch(`${app.url}/api/state`)).headers.get('etag');
      assert.ok((await write()).status < 300);
      assert.notEqual((await fetch(`${app.url}/api/state`)).headers.get('etag'), before, `${label} moves the revision`);
      const conflict = await editorSave();
      assert.equal(conflict.status, 409, `an editor Save from before ${label} is refused`);
      assert.ok(conflict.body.settings.widgetData.countdowns.some((item: { title: string }) => item.title === 'Synthetic from Home'), 'the 409 carries the settings with the Home change');
    }
    // A timer write is not a settings change: it leaves the revision alone.
    const current = (await fetch(`${app.url}/api/state`)).headers.get('etag');
    await app.send('POST', '/api/timers', { durationMs: 60_000 });
    assert.equal((await fetch(`${app.url}/api/state`)).headers.get('etag'), current);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
