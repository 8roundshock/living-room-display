import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../shared/defaults.ts';
import { normalizeForecast, WeatherService } from './weather.ts';
import { forecastFixture } from './fixtures.ts';

test('hourly precipitation uses the preceding hour and keeps rainfall separate', () => {
  const state = normalizeForecast(forecastFixture(), defaultSettings(), Date.parse('2026-10-18T06:30:00Z'));
  assert.equal(state.hourly[0]?.intervalStart, '2026-10-18T06:00:00.000Z');
  assert.equal(state.hourly[0]?.intervalEnd, '2026-10-18T07:00:00.000Z');
  assert.equal(state.hourly[0]?.precipitationProbability, 60);
  assert.equal(state.hourly[0]?.precipitationAmount, 1);
  assert.equal(state.hourly[0]?.rainAmount, 0.8);
  assert.equal(state.current?.time, '2026-10-18T06:00:00.000Z');
  assert.equal(state.daily.length, 7);
});

test('daily date labels retain provider civil dates across a DST boundary', () => {
  const fixture = forecastFixture(Date.parse('2026-10-31T04:00:00Z') / 1000);
  const state = normalizeForecast(fixture, defaultSettings(), Date.parse('2026-10-31T06:00:00Z'));
  assert.deepEqual(state.daily.map(day => day.date), ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
  const bad = forecastFixture(); bad.daily.precipitation_sum.pop();
  assert.throws(() => normalizeForecast(bad, defaultSettings(), Date.now()), /Incomplete/);
});

test('weather cache coalesces requests, reports stale data, retries and isolates locations', async () => {
  let now = Date.parse('2026-10-18T06:30:00Z'); let calls = 0; let offline = false;
  const service = new WeatherService(async () => { calls++; if (offline) throw new Error('offline'); return Response.json(forecastFixture()); }, () => now);
  const settings = defaultSettings();
  const states = await Promise.all([service.get(settings), service.get(settings)]);
  assert.equal(calls, 1); assert.equal(states[0]?.status, 'fresh');
  const fetched = states[0]?.updatedAt;
  offline = true; now += 16 * 60_000;
  const stale = await service.get(settings);
  assert.equal(stale.status, 'stale'); assert.equal(stale.updatedAt, fetched); assert.match(stale.error!, /last successful/);
  await service.get(settings); assert.equal(calls, 2, 'failed calls are backed off');
  settings.location = { name: 'Ottawa', latitude: 45.42, longitude: -75.69, timezone: 'America/Toronto' };
  const other = await service.get(settings);
  assert.equal(other.status, 'unavailable'); assert.equal(other.current, null); assert.equal(other.location.name, 'Ottawa');
  now += 61_000; offline = false;
  assert.equal((await service.get(settings)).status, 'fresh');
});

test('provider query uses explicit timezone, epoch instants, and requested units', async () => {
  let requested: URL | undefined;
  const service = new WeatherService(async input => { requested = new URL(input); return Response.json(forecastFixture()); });
  const settings = defaultSettings(); settings.units = 'imperial';
  const result = await service.get(settings);
  assert.equal(requested?.searchParams.get('timeformat'), 'unixtime');
  assert.equal(requested?.searchParams.get('timezone'), 'America/Toronto');
  assert.equal(requested?.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(requested?.searchParams.get('precipitation_unit'), 'inch');
  assert.equal(result.units.temperature, '°F');
});

test('device weather resolves the timezone from the provider instead of the browser timezone', async () => {
  const settings = defaultSettings(); settings.locationSource = 'device';
  settings.location = { name: 'Device area', latitude: 12.3, longitude: 45.7, timezone: 'auto' };
  const payload = forecastFixture(Date.parse('2026-10-17T15:00:00Z') / 1000);
  payload.timezone = 'Asia/Tokyo'; payload.utc_offset_seconds = 9 * 3600;
  let requested: URL | undefined;
  const service = new WeatherService(async input => { requested = new URL(input); return Response.json(payload); }, () => Date.parse('2026-10-18T13:00:00Z'));
  const state = await service.get(settings);
  assert.equal(requested!.searchParams.get('timezone'), 'auto');
  assert.equal(requested!.searchParams.get('latitude'), '12.3');
  assert.equal(state.location.name, 'Device area'); assert.equal(state.location.timezone, 'Asia/Tokyo');
  assert.equal(state.daily[0].date, '2026-10-18'); assert.equal(state.status, 'fresh');
});

test('unresolved device timezone cannot produce a misleading fresh forecast', async () => {
  const settings = defaultSettings(); settings.locationSource = 'device'; settings.location.timezone = 'auto';
  for (const timezone of [undefined, 'not-a-timezone']) {
    const payload = { ...forecastFixture(), timezone };
    const service = new WeatherService(async () => Response.json(payload));
    const state = await service.get(settings);
    assert.equal(state.status, 'unavailable'); assert.equal(state.daily.length, 0); assert.equal(state.current, null);
  }
});
