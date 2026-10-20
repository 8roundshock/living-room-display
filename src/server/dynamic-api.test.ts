// Dynamic (#437) over the local API: which providers /api/state asks, and that alerts stay API-only.
// Synthetic provider responses only; the real providers are never called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture, seedColorAccentData } from './fixtures.ts';
import { needsAirQuality, needsAlerts } from '../shared/widgets.ts';
import { defaultSettings } from '../shared/defaults.ts';

const NOW = Date.parse('2026-10-20T14:00:00Z');
const ZONES = { features: [{ properties: { FEATURE_ID: 'fea1-1185', NAME: 'City of Toronto' } }] };
const ALERTS = { features: [{ id: '1001_fea1-1185', properties: {
  alert_type: 'warning', alert_name_en: 'winter storm warning', feature_id: 'fea1-1185', feature_name_en: 'City of Toronto', status_en: 'new',
  publication_datetime: new Date(NOW - 3600_000).toISOString(), validity_datetime: new Date(NOW + 3600_000).toISOString(),
  event_end_datetime: new Date(NOW + 12 * 3600_000).toISOString(), expiration_datetime: new Date(NOW + 10 * 3600_000).toISOString(),
} }] };
function airPayload() {
  const start = Date.parse('2026-10-20T14:00:00Z') / 1000, time = Array.from({ length: 24 }, (_, index) => start + index * 3600);
  return { timezone: 'America/Toronto', current: { time: start, us_aqi: 42, us_aqi_pm2_5: 42, pm2_5: 12, pm10: 18, uv_index: 3 }, hourly: { time, us_aqi: time.map(() => 40), uv_index: time.map(() => 2) } };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-dynamic-api-'));
  await seedColorAccentData(directory);
  const hosts: string[] = [];
  const app = await createApplication({ dataDirectory: directory, now: () => NOW, fetcher: async input => {
    const url = new URL(input); hosts.push(url.hostname + url.pathname);
    if (url.hostname === 'api.weather.gc.ca') return Response.json(url.pathname.includes('zones') ? ZONES : ALERTS);
    if (url.hostname === 'air-quality-api.open-meteo.com') return Response.json(airPayload());
    if (url.hostname === 'api.open-meteo.com') return Response.json(forecastFixture());
    throw new Error(`unexpected host ${url.hostname}`);
  } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  return {
    ...app, directory, url,
    count: (part: string) => hosts.filter(host => host.includes(part)).length,
    state: async () => (await fetch(`${url}/api/state`)).json(),
    patch: async (value: unknown) => { const response = await fetch(`${url}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); assert.equal(response.status, 200, await response.clone().text()); return response.json(); },
    async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); },
  };
}

test('needsAlerts and needsAirQuality follow the saved widgets and Dynamic sources', () => {
  const settings = defaultSettings();
  assert.equal(needsAlerts(settings), false); assert.equal(needsAirQuality(settings), false);
  settings.widgets.dynamic = true;
  assert.equal(needsAlerts(settings), true); assert.equal(needsAirQuality(settings), true);
  settings.widgetData.dynamic = { ...settings.widgetData.dynamic, alerts: false, air: false };
  assert.equal(needsAlerts(settings), false); assert.equal(needsAirQuality(settings), false);
  settings.widgets.airQuality = true; assert.equal(needsAirQuality(settings), true, 'the Air quality widget needs it whatever Dynamic shows');
});

test('/api/state asks for alerts only while Dynamic and its alerts are on, and for air quality while Dynamic shows Air & UV', async () => {
  const app = await fixture();
  try {
    const off = await app.state();
    assert.equal(off.alerts.status, 'off'); assert.equal(off.airQuality.status, 'off');
    assert.equal(app.count('api.weather.gc.ca'), 0, 'no alert request while Dynamic is off'); assert.equal(app.count('air-quality'), 0);

    await app.patch({ widgets: { dynamic: true }, widgetData: { dynamic: { alerts: false, air: false } } });
    const quiet = await app.state();
    assert.equal(quiet.alerts.status, 'off'); assert.equal(quiet.airQuality.status, 'off');
    assert.equal(app.count('api.weather.gc.ca'), 0, 'no alert request while its alerts are off'); assert.equal(app.count('air-quality'), 0, 'no air request while Air & UV is off');

    await app.patch({ widgetData: { dynamic: { alerts: true, air: true } } });
    const on = await app.state();
    assert.equal(on.alerts.status, 'fresh'); assert.equal(on.alerts.provider, 'eccc'); assert.equal(on.alerts.area, 'City of Toronto');
    assert.deepEqual(on.alerts.alerts.map((alert: { name: string }) => alert.name), ['Winter storm warning']);
    assert.equal(on.airQuality.status, 'fresh', 'air quality for Dynamic while the Air quality widget is off');
    assert.equal(app.store.snapshot().settings.widgets.airQuality, false);
    assert.equal(app.count('forecast-zones'), 1); assert.equal(app.count('weather-alerts'), 1); assert.equal(app.count('air-quality'), 1);
    await app.state();
    assert.equal(app.count('weather-alerts'), 1, 'polls within 5 minutes reuse the check');

    // API-only: never in state.json, its backup or an export, and the browser never contacts a provider.
    await app.patch({ units: 'imperial' });
    for (const name of ['state.json', 'state.backup.json']) {
      const text = await readFile(join(app.directory, name), 'utf8');
      assert.doesNotMatch(text, /alerts"\s*:\s*\{|Winter storm|weather\.gc\.ca/i, `${name} holds no alert`);
    }
    const exported = await (await fetch(`${app.url}/api/export`)).text();
    assert.doesNotMatch(exported, /Winter storm|"status":"fresh"|weather\.gc\.ca/i, 'the export holds no alert');
    const csp = (await fetch(`${app.url}/api/health`)).headers.get('content-security-policy') ?? '';
    assert.match(csp, /connect-src 'self'/, 'the browser still contacts no provider');
  } finally { await app.close(); }
});
