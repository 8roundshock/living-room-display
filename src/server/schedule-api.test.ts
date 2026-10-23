import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { MANUAL_OVERRIDE_MS, scheduledSettings } from '../shared/schedule.ts';
import { AIR_ENDPOINT } from './air.ts';
import { ECCC_ZONES_URL, ECCC_ALERTS_URL } from './alerts.ts';
import { assertPreviousReaderAccepts } from './compat/previous-reader.ts';

const body = (value: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });

test('editor-view state includes manual Weather/Air/Alerts demand hidden by a scheduled board without changing data', async () => {
  const now = Date.parse('2026-10-18T13:00:00Z'), hour = now / 1000;
  for (const id of ['weather', 'airQuality', 'dynamic'] as const) {
    const directory = await mkdtemp(join(tmpdir(), 'lrd-manual-preview-demand-')), requested: string[] = [];
    const app = await createApplication({ dataDirectory: directory, now: () => now, fetcher: async input => {
      const url = new URL(input), endpoint = url.origin + url.pathname; requested.push(endpoint);
      if (endpoint === ECCC_ZONES_URL) return Response.json({ type: 'FeatureCollection', features: [{ properties: { FEATURE_ID: 'synthetic-zone', NAME: 'Synthetic area' } }] });
      if (endpoint === ECCC_ALERTS_URL) return Response.json({ type: 'FeatureCollection', features: [] });
      return Response.json(endpoint === AIR_ENDPOINT ? { current: { time: hour, us_aqi: 42, pm2_5: 12, pm10: 18, uv_index: 3 }, hourly: { time: [hour, hour + 3600], us_aqi: [42, 45], uv_index: [3, 4] } } : forecastFixture(hour));
    } });
    const manual = defaultSettings();
    for (const widget of Object.keys(manual.widgets) as (keyof typeof manual.widgets)[]) manual.widgets[widget] = widget === id;
    const { appearance, widgets, widgetGrid, widgetOverrides, widgetBehavior, preview } = manual;
    manual.savedPresets = [{ id: 'clock-only', name: 'Clock only', visual: { appearance, widgets: { ...widgets, [id]: false, clock: true }, widgetGrid, widgetOverrides, widgetBehavior, preview } }];
    await app.store.update(data => { data.settings = manual; });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    const address = app.server.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
    try {
      assert.equal((await fetch(base + '/api/schedule', { method: 'PUT', ...body({ enabled: true, fallbackPresetId: 'clock-only', rules: [] }) })).status, 200);
      const before = await readFile(join(directory, 'state.json'), 'utf8');
      const ordinary = await (await fetch(base + '/api/state')).json();
      assert.equal(requested.length, 0, `${id}: ordinary state does not activate hidden manual providers`);
      assert.equal(ordinary.airQuality.status, 'off'); assert.equal(ordinary.alerts.status, 'off');
      const editor = await (await fetch(base + '/api/state', { headers: { 'X-LRD-View': 'editor' } })).json();
      assert.deepEqual(editor.settings, ordinary.settings); assert.deepEqual(editor.schedule, ordinary.schedule);
      assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), before);
      if (id === 'weather' || id === 'dynamic') assert.equal(editor.weather.status, 'fresh');
      if (id === 'airQuality' || id === 'dynamic') { assert.equal(editor.airQuality.status, 'fresh'); assert.equal(editor.airQuality.current.aqi, 42); }
      if (id === 'dynamic') { assert.equal(editor.alerts.status, 'fresh'); assert.ok(requested.includes(ECCC_ZONES_URL)); assert.ok(requested.includes(ECCC_ALERTS_URL)); }
      assert.ok(requested.length > 0, `${id}: explicit manual editor view requests its provider`);
      const ignored = await (await fetch(base + '/api/state', { headers: { 'X-LRD-View': 'something-else' } })).json();
      assert.equal(ignored.airQuality.status, 'off'); assert.equal(ignored.alerts.status, 'off');
    } finally { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); }
  }
});
test('schedule API switches at boundaries and on wake without changing manual settings, revisions, backups or exports', async () => {
  let now = new Date(2026, 9, 19, 7, 59).getTime();
  const directory = await mkdtemp(join(tmpdir(), 'lrd-schedule-api-'));
  const app = await createApplication({ dataDirectory: directory, now: () => now, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const get = async (path: string) => (await fetch(url + path)).json();
  try {
    const initial = await get('/api/state');
    assert.equal(initial.schedule.config.enabled, false);
    assert.equal((await readdir(directory)).includes('schedule.json'), false);
    const { appearance, widgets, widgetGrid, widgetOverrides, widgetBehavior, preview } = defaultSettings();
    const visual = { appearance: { ...appearance, brightness: 0.25 }, widgets, widgetGrid, widgetOverrides, widgetBehavior, preview };
    assert.equal((await fetch(url + '/api/settings', { method: 'PATCH', ...body({ savedPresets: [{ id: 'legacy-style', name: 'Synthetic morning', visual }] }) })).status, 200);
    const manualState = await fetch(url + '/api/state'); const revision = manualState.headers.get('etag');
    const manual = (await manualState.json()).settings;
    const canonical = await readFile(join(directory, 'state.json'), 'utf8');
    const backup = await readFile(join(directory, 'state.backup.json'), 'utf8');
    const exported = await get('/api/export');
    const schedule = { enabled: true, fallbackPresetId: null, rules: [{ id: '00000000-0000-4000-8000-000000000001', presetId: 'legacy-style', days: [1], start: '08:00', end: '12:00' }] };
    const saved = await fetch(url + '/api/schedule', { method: 'PUT', ...body(schedule) });
    assert.equal(saved.status, 200); const scheduleTag = saved.headers.get('etag')!;
    const before = await get('/api/changes');
    now = new Date(2026, 9, 19, 8).getTime();
    assert.notEqual((await get('/api/changes')).change, before.change);
    const effective = await fetch(url + '/api/state'); const state = await effective.json();
    assert.equal(effective.headers.get('etag'), revision);
    assert.deepEqual(state.settings, manual);
    assert.equal(state.schedule.visual.appearance.brightness, 0.25);
    assert.equal(state.schedule.selection.source, 'rule');
    const session = await new Promise<{ settings: ReturnType<typeof defaultSettings> }>((resolve, reject) => {
      const native = request(url + '/api/host/session', { headers: { 'X-LRD-Native': '1' } }, response => {
        let data = ''; response.on('data', chunk => data += chunk); response.on('end', () => { try { assert.equal(response.statusCode, 200); resolve(JSON.parse(data)); } catch (error) { reject(error); } });
      }); native.on('error', reject); native.end();
    });
    assert.equal(session.settings.appearance.brightness, 0.25);
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), canonical);
    assert.equal(await readFile(join(directory, 'state.backup.json'), 'utf8'), backup);
    assertPreviousReaderAccepts('data', JSON.parse(canonical), 'scheduled manual state');
    assertPreviousReaderAccepts('data', JSON.parse(backup), 'scheduled manual backup');
    const laterExport = await get('/api/export');
    assert.deepEqual({ ...laterExport, exportedAt: exported.exportedAt }, exported);
    assertPreviousReaderAccepts('import', laterExport, 'scheduled manual export');
    const override = await fetch(url + '/api/schedule/override', { method: 'POST', ...body({ manual: true }), headers: { ...body(null).headers, 'If-Match': scheduleTag } });
    assert.equal(override.status, 200);
    assert.equal((await get('/api/state')).schedule.selection.source, 'override');
    assert.equal((await fetch(url + '/api/schedule', { method: 'PUT', ...body(schedule), headers: { ...body(null).headers, 'If-Match': scheduleTag } })).status, 409);
    now += MANUAL_OVERRIDE_MS;
    assert.equal((await get('/api/state')).schedule.selection.source, 'rule');
    now = new Date(2026, 9, 20, 15).getTime(); // wake after an entire boundary/day was missed
    assert.equal((await get('/api/state')).schedule.selection.source, 'manual');
    const scheduleBackup = await get('/api/schedule/export');
    assert.deepEqual(scheduleBackup, { version: 1, kind: 'still-schedule', config: schedule });
    assert.equal((await fetch(url + '/api/schedule/import', { method: 'POST', ...body({ ...scheduleBackup, config: { ...schedule, enabled: 'yes' } }) })).status, 400);
    assert.deepEqual((await get('/api/schedule')).config, schedule);
    assert.equal((await fetch(url + '/api/schedule/import', { method: 'POST', ...body(scheduleBackup) })).status, 200);
    assert.equal((await fetch(url + '/api/import', { method: 'POST', ...body(exported) })).status, 200);
    assert.deepEqual((await get('/api/schedule')).config, schedule, 'ordinary settings restore keeps the local schedule');
    await fetch(url + '/api/settings', { method: 'PATCH', ...body({ savedPresets: [] }) });
    now = new Date(2026, 9, 26, 9).getTime();
    const missing = (await get('/api/state')).schedule;
    assert.equal(missing.selection.source, 'manual');
    assert.deepEqual(missing.selection.missingPresetIds, ['legacy-style']);
    assert.equal(missing.visual, null);
  } finally { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); }
});

test('scheduled-only Weather and Air quality request data while manual settings and content stay unchanged', async () => {
  const now = Date.parse('2026-10-18T13:00:00Z'), hour = now / 1000;
  const directory = await mkdtemp(join(tmpdir(), 'lrd-schedule-demand-'));
  const requested: URL[] = [];
  const app = await createApplication({ dataDirectory: directory, now: () => now, fetcher: async input => {
    const url = new URL(input); requested.push(url);
    return Response.json(url.origin + url.pathname === AIR_ENDPOINT ? {
      current: { time: hour, us_aqi: 42, pm2_5: 12, pm10: 18, uv_index: 3 },
      hourly: { time: [hour, hour + 3600], us_aqi: [42, 45], uv_index: [3, 4] },
    } : forecastFixture(hour));
  } });
  const manual = defaultSettings();
  for (const id of Object.keys(manual.widgets) as (keyof typeof manual.widgets)[]) manual.widgets[id] = id === 'clock';
  const { appearance, widgets, widgetGrid, widgetOverrides, widgetBehavior, preview } = manual;
  const visual = { appearance, widgets, widgetGrid, widgetOverrides, widgetBehavior, preview };
  manual.savedPresets = ['weather', 'airQuality'].map(id => ({
    id, name: `Synthetic ${id}`, visual: { ...visual, widgets: { ...widgets, clock: false, [id]: true } },
  }));
  await app.store.update(data => { data.settings = manual; });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const get = async () => (await fetch(base + '/api/state')).json();
  try {
    const reminder = await fetch(base + '/api/reminders', { method: 'POST', ...body({ text: 'Synthetic schedule reminder' }) });
    assert.equal(reminder.status, 201);
    const before = await get(); assert.equal(requested.length, 0, 'manual clock-only board needs no providers');
    const select = async (fallbackPresetId: string) => {
      const result = await fetch(base + '/api/schedule', { method: 'PUT', ...body({ enabled: true, fallbackPresetId, rules: [] }) });
      assert.equal(result.status, 200);
    };
    await select('weather');
    const weather = await get();
    assert.equal(weather.weather.status, 'fresh'); assert.equal(weather.airQuality.status, 'off');
    assert.equal(requested.length, 1);
    assert.equal(requested[0]!.searchParams.get('latitude'), String(manual.location.latitude));
    assert.equal(requested[0]!.searchParams.get('longitude'), String(manual.location.longitude));
    await select('airQuality');
    const air = await get();
    assert.equal(air.airQuality.status, 'fresh'); assert.equal(air.airQuality.current.aqi, 42);
    assert.equal(requested.length, 2); assert.equal(requested[1]!.origin + requested[1]!.pathname, AIR_ENDPOINT);
    for (const state of [weather, air]) {
      assert.deepEqual(state.settings, before.settings);
      assert.deepEqual(state.reminders, before.reminders);
      const effective = scheduledSettings(state.settings, state.schedule);
      assert.deepEqual(effective.location, before.settings.location);
      assert.deepEqual(effective.units, before.settings.units);
      assert.deepEqual(effective.widgetData, before.settings.widgetData);
    }
  } finally {
    app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
    await rm(directory, { recursive: true, force: true });
  }
});
