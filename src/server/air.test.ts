import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../shared/defaults.ts';
import { AIR_ENDPOINT, AirQualityService, normalizeAirQuality, offAirQuality, type AirScale } from './air.ts';

// Synthetic provider payloads shaped like the Open-Meteo air-quality API with timeformat=unixtime.
const NOW = Date.parse('2026-10-18T13:20:00Z');
const HOUR = Date.parse('2026-10-18T13:00:00Z') / 1000;
function airFixture(scale: AirScale = 'us', hours = 25, start = HOUR - 3600) {
  const time = Array.from({ length: hours }, (_, index) => start + index * 3600);
  const sub = scale === 'us'
    ? { us_aqi_pm2_5: 42, us_aqi_pm10: 18, us_aqi_ozone: 30, us_aqi_nitrogen_dioxide: 9, us_aqi_sulphur_dioxide: 1, us_aqi_carbon_monoxide: 3 }
    : { european_aqi_pm2_5: 21, european_aqi_pm10: 12, european_aqi_ozone: 34, european_aqi_nitrogen_dioxide: 8, european_aqi_sulphur_dioxide: 1 };
  return {
    latitude: 43.65, longitude: -79.38, timezone: 'America/Toronto', utc_offset_seconds: -14400,
    current: { time: HOUR, interval: 3600, [`${scale}_aqi`]: scale === 'us' ? 42 : 34, ...sub, pm2_5: 12.3, pm10: 18.9, uv_index: 3.15 },
    hourly: { time, [`${scale}_aqi`]: time.map((_, index) => 30 + index), uv_index: time.map((_, index) => Math.max(0, 5 - Math.abs(index - 4))) },
  };
}

test('normalization keeps the AQI, dominant pollutant, concentrations, UV and 24 upcoming instants', () => {
  const settings = defaultSettings();
  const us = normalizeAirQuality(airFixture('us'), settings, 'us', NOW);
  assert.equal(us.status, 'fresh'); assert.equal(us.source, 'CAMS via Open-Meteo'); assert.equal(us.scale, 'us');
  assert.equal(us.updatedAt, new Date(NOW).toISOString());
  assert.deepEqual(us.current, { time: '2026-10-18T13:00:00.000Z', aqi: 42, dominant: 'pm2_5', pm2_5: 12.3, pm10: 18.9, uvIndex: 3.15 });
  assert.equal(us.hourly.length, 24, 'the past hour is dropped and at most 24 instants remain');
  assert.equal(us.hourly[0]!.time, '2026-10-18T13:00:00.000Z', 'the current hour is the first instant');
  assert.deepEqual(us.hourly[1], { time: '2026-10-18T14:00:00.000Z', aqi: 32, uvIndex: 3 });
  const european = normalizeAirQuality(airFixture('european'), settings, 'european', NOW);
  assert.equal(european.current?.aqi, 34); assert.equal(european.current?.dominant, 'ozone'); assert.equal(european.scale, 'european');
});

test('malformed or partial data becomes unavailable or nulls, never invented values', () => {
  const settings = defaultSettings();
  const partial = airFixture('us');
  delete (partial.current as Record<string, unknown>).us_aqi;
  (partial.current as Record<string, unknown>).pm2_5 = 'twelve';
  (partial.current as Record<string, unknown>).us_aqi_pm2_5 = null;
  (partial.hourly.us_aqi as (number | null)[])[3] = null;
  const state = normalizeAirQuality(partial, settings, 'us', NOW);
  assert.equal(state.current?.aqi, null); assert.equal(state.current?.pm2_5, null);
  assert.equal(state.current?.dominant, 'ozone', 'dominant uses only known sub-indices');
  assert.equal(state.hourly[2]!.aqi, null);
  const noSubIndices = airFixture('us');
  for (const key of Object.keys(noSubIndices.current)) if (key.startsWith('us_aqi_')) delete (noSubIndices.current as Record<string, unknown>)[key];
  assert.equal(normalizeAirQuality(noSubIndices, settings, 'us', NOW).current?.dominant, null);
  const misaligned = airFixture('us'); (misaligned.hourly.uv_index as number[]).pop();
  assert.throws(() => normalizeAirQuality(misaligned, settings, 'us', NOW), /Incomplete/);
  const missingSeries = airFixture('us'); delete (missingSeries.hourly as Record<string, unknown>).us_aqi;
  assert.throws(() => normalizeAirQuality(missingSeries, settings, 'us', NOW), /Incomplete/);
  assert.throws(() => normalizeAirQuality({ hourly: { time: [] } }, settings, 'us', NOW));
  // A European payload read with the US scale has no US series.
  assert.throws(() => normalizeAirQuality(airFixture('european'), settings, 'us', NOW));
});

test('request parameters for both scales: keyless, no redirects, 24 forecast hours', async () => {
  const requests: { url: URL; init?: RequestInit }[] = [];
  const service = new AirQualityService(async (input, init) => { const url = new URL(input); requests.push({ url, init }); return Response.json(airFixture(url.searchParams.get('hourly')!.startsWith('european') ? 'european' : 'us')); }, () => NOW);
  const settings = defaultSettings();
  await service.get(settings);
  await service.get(settings, 'european');
  assert.equal(requests.length, 2);
  const [us, european] = requests as [{ url: URL; init?: RequestInit }, { url: URL; init?: RequestInit }];
  assert.equal(`${us.url.origin}${us.url.pathname}`, AIR_ENDPOINT);
  assert.equal(us.url.searchParams.get('latitude'), '43.6532'); assert.equal(us.url.searchParams.get('longitude'), '-79.3832');
  assert.equal(us.url.searchParams.get('timezone'), 'America/Toronto'); assert.equal(us.url.searchParams.get('timeformat'), 'unixtime');
  assert.equal(us.url.searchParams.get('forecast_hours'), '24');
  assert.equal(us.url.searchParams.get('current'), 'us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone,us_aqi_nitrogen_dioxide,us_aqi_sulphur_dioxide,us_aqi_carbon_monoxide,pm2_5,pm10,uv_index');
  assert.equal(us.url.searchParams.get('hourly'), 'us_aqi,uv_index');
  assert.equal(european.url.searchParams.get('current'), 'european_aqi,european_aqi_pm2_5,european_aqi_pm10,european_aqi_ozone,european_aqi_nitrogen_dioxide,european_aqi_sulphur_dioxide,pm2_5,pm10,uv_index');
  assert.equal(european.url.searchParams.get('hourly'), 'european_aqi,uv_index');
  for (const { url, init } of requests) {
    assert.equal(init?.redirect, 'error'); assert.ok(init?.signal, 'request has a timeout signal');
    assert.equal([...url.searchParams.keys()].some(key => /key|token/i.test(key)), false, 'no API key');
    assert.equal(url.protocol, 'https:');
  }
  // A device location asks the provider to resolve the zone, and the resolved zone is kept.
  settings.location = { name: 'Device area', latitude: 12.3, longitude: 45.7, timezone: 'auto' };
  const device = await service.get(settings);
  assert.equal(requests[2]!.url.searchParams.get('timezone'), 'auto'); assert.equal(device.location.timezone, 'America/Toronto');
});

test('cache: 30 min TTL, 2 min retry, stale keeps the last good reading, keyed by location and scale', async () => {
  let now = NOW, calls = 0, offline = false;
  const service = new AirQualityService(async input => {
    calls++; if (offline) throw new Error('offline');
    return Response.json(airFixture(new URL(input).searchParams.get('hourly')!.startsWith('european') ? 'european' : 'us'));
  }, () => now);
  const settings = defaultSettings();
  const [first, second] = await Promise.all([service.get(settings), service.get(settings)]);
  assert.equal(calls, 1, 'concurrent requests share one fetch'); assert.equal(first.status, 'fresh'); assert.deepEqual(first, second);
  now += 29 * 60_000; assert.equal((await service.get(settings)).status, 'fresh'); assert.equal(calls, 1);
  offline = true; now += 2 * 60_000;
  const stale = await service.get(settings);
  assert.equal(calls, 2); assert.equal(stale.status, 'stale'); assert.equal(stale.updatedAt, first.updatedAt);
  assert.equal(stale.current?.aqi, 42, 'last good reading is kept'); assert.match(stale.error!, /last successful/);
  now += 60_000; await service.get(settings); assert.equal(calls, 2, 'no retry within 2 minutes');
  now += 61_000; await service.get(settings); assert.equal(calls, 3, 'retry after 2 minutes');
  // A new scale or location is its own entry and never borrows another reading.
  const european = await service.get(settings, 'european');
  assert.equal(european.status, 'unavailable'); assert.equal(european.current, null); assert.equal(european.hourly.length, 0); assert.equal(european.scale, 'european');
  assert.match(european.error!, /unavailable/);
  const moved = structuredClone(settings); moved.location = { name: 'Ottawa', latitude: 45.42, longitude: -75.69, timezone: 'America/Toronto' };
  const ottawa = await service.get(moved);
  assert.equal(ottawa.status, 'unavailable'); assert.equal(ottawa.location.name, 'Ottawa');
  offline = false; now += 2 * 60_000 + 1;
  assert.equal((await service.get(settings, 'european')).status, 'fresh');
  assert.equal((await service.get(settings)).status, 'fresh', 'recovers after the retry window');
});

test('a non-OK provider response is unavailable and the cache holds at most 8 entries', async () => {
  let calls = 0;
  const failing = new AirQualityService(async () => { calls++; return new Response('nope', { status: 503 }); }, () => NOW);
  const state = await failing.get(defaultSettings());
  assert.equal(state.status, 'unavailable'); assert.equal(state.current, null); assert.equal(calls, 1);
  const service = new AirQualityService(async () => { calls++; return Response.json(airFixture()); }, () => NOW);
  const settings = defaultSettings(); calls = 0;
  for (let index = 0; index < 9; index++) { settings.location.latitude = 40 + index; await service.get(settings); }
  settings.location.latitude = 48; await service.get(settings); assert.equal(calls, 9, 'the most recent entry is cached');
  settings.location.latitude = 40; await service.get(settings); assert.equal(calls, 10, 'the oldest entry was evicted');
});

test('off state makes no request and carries the saved scale and location', () => {
  const settings = defaultSettings(); settings.widgetData.airQuality.scale = 'european';
  const off = offAirQuality(settings);
  assert.deepEqual({ status: off.status, scale: off.scale, current: off.current, hourly: off.hourly, updatedAt: off.updatedAt }, { status: 'off', scale: 'european', current: null, hourly: [], updatedAt: null });
  assert.equal(off.location.name, settings.location.name);
});

test('a clock set back neither stalls air-quality refreshes nor keeps a future-dated reading fresh (#244)', async () => {
  // (A) The provider failed while the wall clock was 4 h fast; after the correction the retry comes on the monotonic clock.
  const clock = { wall: NOW + 4 * 3600_000, mono: 0 };
  let calls = 0, offline = true;
  const service = new AirQualityService(async () => { calls++; if (offline) throw new Error('offline'); return Response.json(airFixture()); }, () => clock.wall, () => clock.mono);
  const settings = defaultSettings();
  assert.equal((await service.get(settings)).status, 'unavailable');
  clock.wall = NOW; offline = false; clock.mono += 60_000;
  await service.get(settings); assert.equal(calls, 1, 'inside the two-minute back-off');
  clock.mono += 61_000;
  const recovered = await service.get(settings);
  assert.equal(calls, 2, 'retried after two monotonic minutes, not four hours'); assert.equal(recovered.status, 'fresh');
  // (B) A reading fetched while the clock was fast keeps its upcoming hours and is refreshed after the correction.
  const fast = { wall: NOW + 4 * 3600_000, mono: 0 };
  let fetches = 0;
  const other = new AirQualityService(async () => { fetches++; return Response.json(airFixture()); }, () => fast.wall, () => fast.mono);
  const early = await other.get(settings);
  assert.equal(early.hourly[0]?.time, '2026-10-18T13:00:00.000Z', 'the provider\'s current hour is kept, not dropped by the fast clock');
  assert.equal(early.updatedAt, new Date(NOW + 4 * 3600_000).toISOString());
  fast.wall = NOW; fast.mono += 5_000;
  const corrected = await other.get(settings);
  assert.equal(fetches, 2, 'an update time in the future is due at once'); assert.equal(corrected.updatedAt, new Date(NOW).toISOString());
  // A sleep the monotonic clock did not count still ages the reading by the wall clock.
  fast.wall += 31 * 60_000; fast.mono += 1000;
  await other.get(settings); assert.equal(fetches, 3);
});
