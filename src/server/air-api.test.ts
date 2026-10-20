// Air quality over the local API, and rollback behaviour of the three #78 sky/time widgets.
// Synthetic provider responses only; the real provider is never called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApplication } from './app.ts';
import { forecastFixture, seedColorAccentData } from './fixtures.ts';
import { DataStore } from './store.ts';
import { assertPreviousReaderAccepts, assertPreviousReaderRejects } from './compat/previous-reader.ts';

const NOW = Date.parse('2026-10-18T13:20:00Z');
function airPayload(scale: string) {
  const start = Date.parse('2026-10-18T13:00:00Z') / 1000;
  const time = Array.from({ length: 24 }, (_, index) => start + index * 3600);
  return {
    timezone: 'America/Toronto',
    current: { time: start, [`${scale}_aqi`]: 42, [`${scale}_aqi_pm2_5`]: 42, [`${scale}_aqi_ozone`]: 20, pm2_5: 12, pm10: 18, uv_index: 3 },
    hourly: { time, [`${scale}_aqi`]: time.map(() => 40), uv_index: time.map(() => 2) },
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-air-api-'));
  // An existing user's colour-accent defaults (fresh Native data is covered in rollback.test.ts).
  await seedColorAccentData(directory);
  const requests: URL[] = [];
  const app = await createApplication({ dataDirectory: directory, now: () => NOW, fetcher: async input => {
    const url = new URL(input); requests.push(url);
    if (url.hostname === 'air-quality-api.open-meteo.com') return Response.json(airPayload(url.searchParams.get('hourly')!.split('_aqi')[0]!));
    return Response.json(forecastFixture());
  } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  return { ...app, directory, requests, url: `http://127.0.0.1:${address.port}`,
    airRequests: () => requests.filter(url => url.hostname === 'air-quality-api.open-meteo.com'),
    patch: (value: unknown) => fetch(`http://127.0.0.1:${address.port}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }),
    async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); } };
}

test('/api/state reports air quality off without contacting the provider until the widget is saved enabled', async () => {
  const app = await fixture();
  try {
    const off = await (await fetch(`${app.url}/api/state`)).json();
    assert.equal(off.airQuality.status, 'off'); assert.equal(off.airQuality.scale, 'us'); assert.equal(off.airQuality.current, null);
    assert.equal(app.airRequests().length, 0, 'no air-quality request while disabled');
    assert.equal((await app.patch({ widgets: { airQuality: true } })).status, 200);
    const fresh = await (await fetch(`${app.url}/api/state`)).json();
    assert.equal(fresh.airQuality.status, 'fresh'); assert.equal(fresh.airQuality.current.aqi, 42); assert.equal(fresh.airQuality.source, 'CAMS via Open-Meteo');
    assert.equal(fresh.weather.status, 'fresh', 'weather still loads alongside');
    assert.equal(app.airRequests().length, 1);
    await fetch(`${app.url}/api/state`); assert.equal(app.airRequests().length, 1, 'the shared 30-minute cache serves polls');
    assert.equal((await app.patch({ widgetData: { airQuality: { scale: 'european' } } })).status, 200);
    const european = await (await fetch(`${app.url}/api/state`)).json();
    assert.equal(european.airQuality.scale, 'european'); assert.equal(app.airRequests().at(-1)!.searchParams.get('hourly'), 'european_aqi,uv_index');
  } finally { await app.close(); }
});

test('/api/air-quality previews a scale for the editor, validates it and keeps the local-only checks', async () => {
  const app = await fixture();
  try {
    const preview = await fetch(`${app.url}/api/air-quality?scale=european`);
    assert.equal(preview.status, 200); assert.equal(preview.headers.get('cache-control'), 'no-store');
    const body = await preview.json();
    assert.equal(body.status, 'fresh'); assert.equal(body.scale, 'european'); assert.equal(body.location.name, 'Toronto');
    assert.equal(app.airRequests().length, 1, 'previewing does not need the widget saved enabled');
    const saved = await (await fetch(`${app.url}/api/air-quality`)).json();
    assert.equal(saved.scale, 'us', 'defaults to the saved scale');
    for (const bad of ['uk', '', 'US']) {
      const response = await fetch(`${app.url}/api/air-quality?scale=${bad}`);
      assert.equal(response.status, 400, `scale=${bad}`); assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal((await fetch(`${app.url}/api/air-quality`, { headers: { Origin: 'https://attacker.example' } })).status, 403);
    assert.equal((await fetch(`${app.url}/api/air-quality`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(`${app.url}/api/air-quality`, { headers: { Origin: app.url } })).status, 200);
    const host = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${app.url}/api/air-quality`, { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode!); });
      request.on('error', reject); request.end();
    });
    assert.equal(host, 403);
    assert.equal((await fetch(`${app.url}/display`)).headers.get('permissions-policy'), 'geolocation=()', 'the display Permissions-Policy is unchanged');
    assert.match((await fetch(`${app.url}/api/air-quality`)).headers.get('content-security-policy')!, /connect-src 'self'/, 'the browser never reaches the provider');
  } finally { await app.close(); }
});

async function readState(directory: string) { return JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')); }
const city = (label: string) => ({ id: randomUUID(), label, timezone: 'Asia/Tokyo', latitude: 35.68, longitude: 139.69 });


const readBackup = async (directory: string) => JSON.parse(await readFile(join(directory, 'state.backup.json'), 'utf8'));

test('rollback: defaults and these widgets in use stay readable by the previous release (3446400 knows them)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-air-rollback-'));
  try {
    // An existing user's colour-accent defaults, so each choice below is a change the files must carry.
    await seedColorAccentData(directory);
    const store = await DataStore.open(directory);
    // Saves that leave the new widgets off and their data at defaults stay readable.
    await store.patchSettings({ widgets: { worldClocks: false, sunMoon: false, airQuality: false }, widgetData: { worldClocks: [], airQuality: { scale: 'us' } }, units: 'imperial' });
    const defaults = await readState(directory);
    assertPreviousReaderAccepts('data', defaults, 'disabled new widgets with default data');
    // Default widgetData is still omitted at rest; the previous release knows the ids, so their keys are written.
    assert.equal('widgetData' in defaults.settings, false); assert.equal(defaults.settings.widgets.airQuality, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
  for (const [label, patch, written] of [
    ['World clocks enabled', { widgets: { worldClocks: true } }, (file: any) => file.settings.widgets.worldClocks === true],
    ['Sun & moon enabled', { widgets: { sunMoon: true } }, (file: any) => file.settings.widgets.sunMoon === true],
    ['Air quality enabled', { widgets: { airQuality: true } }, (file: any) => file.settings.widgets.airQuality === true],
    ['a world clock added', { widgetData: { worldClocks: [city('Synthetic city')] } }, (file: any) => file.settings.widgetData?.worldClocks?.length === 1],
    ['European scale', { widgetData: { airQuality: { scale: 'european' } } }, (file: any) => file.settings.widgetData?.airQuality?.scale === 'european'],
  ] as const) {
    const folder = await mkdtemp(join(tmpdir(), 'lrd-air-rollback-'));
    try {
      await seedColorAccentData(folder);
      const store = await DataStore.open(folder);
      await store.patchSettings(patch);
      const state = await readState(folder);
      assert.ok(written(state), `${label}: state.json carries the choice`);
      assertPreviousReaderAccepts('data', state, label);
      assertPreviousReaderAccepts('data', await readBackup(folder), `${label}: the backup of the previous save`);
      await store.patchSettings({ units: 'imperial' });
      const backup = await readBackup(folder);
      assert.ok(written(backup), `${label}: state.backup.json carries the choice after the next save`);
      assertPreviousReaderAccepts('data', backup, `${label}: state.backup.json after the next save`);
    } finally { await rm(folder, { recursive: true, force: true }); }
  }
});

test('rollback: exports with these widgets off or in use import into the previous release', async () => {
  const app = await fixture();
  try {
    assertPreviousReaderAccepts('import', await (await fetch(`${app.url}/api/export`)).json(), 'default export');
    assert.equal((await app.patch({ widgets: { sunMoon: true }, widgetData: { worldClocks: [city('Synthetic city')] } })).status, 200);
    const exported = await (await fetch(`${app.url}/api/export`)).json();
    assert.equal(exported.settings.widgets.sunMoon, true); assert.equal(exported.settings.widgetData.worldClocks.length, 1);
    assertPreviousReaderAccepts('import', exported, 'export with Sun & moon and a world clock');
    // Negative control: an AQI scale the previous release does not know is still rejected.
    assertPreviousReaderRejects('import', { ...exported, settings: { ...exported.settings, widgetData: { ...exported.settings.widgetData, airQuality: { scale: 'synthetic' } } } }, 'an unknown AQI scale');
  } finally { await app.close(); }
});
