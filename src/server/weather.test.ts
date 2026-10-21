import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../shared/defaults.ts';
import { normalizeForecast, WeatherService } from './weather.ts';
import { forecastFixture } from './fixtures.ts';
import { location as locationSchema } from './validation.ts';

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

/** A fake wall clock that can be set back, beside a monotonic clock that only moves forward (#244). */
function clocks(start: number) {
  const state = { wall: start, mono: 0 };
  return { state, wall: () => state.wall, mono: () => state.mono, advance(ms: number) { state.wall += ms; state.mono += ms; } };
}

test('(A) a refresh that failed while the clock was fast retries a minute later on the monotonic clock (#244)', async () => {
  const real = Date.parse('2026-10-18T13:00:00Z');
  const clock = clocks(real + 4 * 3600_000); let calls = 0, offline = true;
  const service = new WeatherService(async () => { calls++; if (offline) throw new Error('offline'); return Response.json(forecastFixture(Date.parse('2026-10-18T04:00:00Z') / 1000)); }, clock.wall, clock.mono);
  const settings = defaultSettings();
  assert.equal((await service.get(settings)).status, 'unavailable'); assert.equal(calls, 1);
  clock.state.wall = real; offline = false; // The clock is corrected and the provider recovers.
  clock.state.mono += 30_000; await service.get(settings); assert.equal(calls, 1, 'still inside the one-minute back-off');
  clock.state.mono += 31_000;
  const state = await service.get(settings);
  assert.equal(calls, 2, 'retried after one monotonic minute, not four hours'); assert.equal(state.status, 'fresh');
  assert.equal(state.updatedAt, new Date(clock.state.wall).toISOString());
});

test('(B) a forecast fetched while the clock was fast is refreshed once the clock is set back (#244)', async () => {
  const real = Date.parse('2026-10-18T13:00:00Z');
  const clock = clocks(real + 4 * 3600_000); let calls = 0, offline = false;
  const service = new WeatherService(async () => { calls++; if (offline) throw new Error('offline'); return Response.json(forecastFixture(Date.parse('2026-10-18T04:00:00Z') / 1000)); }, clock.wall, clock.mono);
  const settings = defaultSettings();
  const fast = await service.get(settings);
  assert.equal(fast.updatedAt, new Date(real + 4 * 3600_000).toISOString());
  assert.equal(fast.hourly[0]?.intervalStart, '2026-10-18T06:00:00.000Z', 'hours are kept from the provider\'s current time, not dropped by the fast clock');
  clock.state.wall = real; clock.state.mono += 60_000;
  const corrected = await service.get(settings);
  assert.equal(calls, 2, 'an update time in the future is due at once');
  assert.equal(corrected.status, 'fresh'); assert.equal(corrected.updatedAt, new Date(real).toISOString());
  // When the provider is down at that moment, the future-dated data is no longer called fresh.
  const other = new WeatherService(async () => { if (offline) throw new Error('offline'); return Response.json(forecastFixture()); }, clock.wall, clock.mono);
  clock.state.wall = real + 4 * 3600_000; await other.get(settings);
  clock.state.wall = real; offline = true; clock.state.mono += 1000;
  const stale = await other.get(settings);
  assert.equal(stale.status, 'stale'); assert.match(stale.error!, /last successful/);
});

test('the TTL counts by whichever clock says more: a set-back wall clock and a sleep both refresh (#244)', async () => {
  const start = Date.parse('2026-10-18T13:00:00Z');
  const clock = clocks(start); let calls = 0;
  const service = new WeatherService(async () => { calls++; return Response.json(forecastFixture()); }, clock.wall, clock.mono);
  const settings = defaultSettings();
  await service.get(settings); assert.equal(calls, 1);
  clock.state.wall -= 60_000; clock.state.mono += 14 * 60_000; // set back a minute, within the future tolerance
  assert.equal((await service.get(settings)).status, 'fresh'); assert.equal(calls, 1);
  clock.state.mono += 61_000;
  await service.get(settings); assert.equal(calls, 2, '15 monotonic minutes refresh even though the wall clock says 14');
  clock.state.wall += 8 * 3600_000; clock.state.mono += 1000; // a sleep the monotonic clock did not count
  await service.get(settings); assert.equal(calls, 3, 'eight wall-clock hours refresh too');
});

test('city search keeps the usable results and leaves out each unusable one (#246)', async () => {
  const long = 'A'.repeat(118) + ' Springs';
  const results = [
    { id: 1, name: 'Springfield', latitude: 39.8, longitude: -89.64, timezone: 'America/Chicago', country: 'United States', admin1: 'Illinois' },
    { id: 2, name: 'Springfield', latitude: 37.21, longitude: -93.3, country: 'United States', admin1: 'Missouri' },
    { id: 3, name: 'Springfield', latitude: 42.1, longitude: -72.59, timezone: '', country: 'United States' },
    { id: 4, name: 'Springfield', latitude: 44.05, longitude: -123.02, timezone: 'Not/AZone' },
    { id: 5, name: 'Nowhere', latitude: 95, longitude: 0, timezone: 'UTC' },
    { id: 6, name: '   ', latitude: 10, longitude: 10, timezone: 'UTC' },
    { id: 7, name: `  ${long}  `, latitude: -33.9, longitude: 151.2, timezone: 'Australia/Sydney', admin1: 42 },
    { name: 'No id', latitude: 1, longitude: 1, timezone: 'UTC' },
    'not an object',
  ];
  const service = new WeatherService(async () => Response.json({ results }));
  const found = await service.locations('Springfield');
  assert.deepEqual(found.map(item => item.id), [1, 7]);
  assert.deepEqual(found[0], { id: 1, name: 'Springfield', latitude: 39.8, longitude: -89.64, timezone: 'America/Chicago', country: 'United States', admin1: 'Illinois' });
  assert.equal(found[1]!.name.length, 100, 'names are trimmed to the settings limit');
  assert.equal(found[1]!.admin1, '', 'a malformed region is dropped, not the result');
  for (const item of found) {
    const parsed = locationSchema.safeParse({ name: item.name, latitude: item.latitude, longitude: item.longitude, timezone: item.timezone });
    assert.ok(parsed.success, `every offered result can be saved: ${JSON.stringify(item)}`);
  }
  // Nothing usable is an empty list, not an error; a malformed response is still an error.
  assert.deepEqual(await new WeatherService(async () => Response.json({ results: [results[1]] })).locations('Springfield MO'), []);
  await assert.rejects(new WeatherService(async () => Response.json({ results: 'nope' })).locations('x'));
});

test('hours are kept from the earlier of the provider\'s and this computer\'s current time, with 24 beyond this computer\'s (#244)', () => {
  const fixture = forecastFixture(); // provider current time 2026-10-18T06:00Z
  const behind = normalizeForecast(fixture, defaultSettings(), Date.parse('2026-10-18T13:00:00Z'));
  assert.equal(behind.hourly[0]?.intervalStart, '2026-10-18T06:00:00.000Z', 'the provider\'s current hour is kept');
  assert.equal(behind.hourly.filter(hour => Date.parse(hour.intervalEnd) > Date.parse('2026-10-18T13:00:00Z')).length, 24, 'and 24 hours beyond this computer\'s clock');
  const fast = normalizeForecast(fixture, defaultSettings(), Date.parse('2026-10-18T10:00:00Z'));
  assert.equal(fast.hourly[0]?.intervalStart, '2026-10-18T06:00:00.000Z');
  const slow = normalizeForecast(fixture, defaultSettings(), Date.parse('2026-10-18T05:30:00Z'));
  assert.equal(slow.hourly[0]?.intervalStart, '2026-10-18T05:00:00.000Z', 'a slow clock keeps the hour it considers current');
  assert.equal(slow.hourly.length, 24);
});

test('the forecast waits for a due refresh only briefly, and peek never contacts the provider (#351, #352)', async () => {
  let calls = 0; let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const service = new WeatherService(async () => { calls++; await held; return Response.json(forecastFixture()); }, () => Date.parse('2026-10-18T06:30:00Z'), undefined, 150);
  const settings = defaultSettings();
  assert.deepEqual(service.peek(settings), { ...service.peek(settings) }); assert.equal(calls, 0, 'peek makes no request');
  assert.equal(service.peek(settings).status, 'unavailable'); assert.equal(service.peek(settings).error, null);
  const started = performance.now();
  const waiting = await service.get(settings);
  assert.ok(performance.now() - started < 150 + 250, 'answered after the wait');
  assert.equal(waiting.refreshing, true); assert.equal(waiting.error, null); assert.equal(calls, 1);
  assert.equal(service.peek(settings).refreshing, true, 'peek reports the refresh in flight');
  release(); await new Promise(resolve => setTimeout(resolve, 20));
  const fresh = service.peek(settings);
  assert.equal(fresh.status, 'fresh'); assert.equal(fresh.refreshing, undefined); assert.equal(calls, 1);
});
