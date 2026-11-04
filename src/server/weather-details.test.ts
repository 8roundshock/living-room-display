import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../shared/defaults.ts';
import { forecastFixture } from './fixtures.ts';
import { normalizeForecast, WeatherService } from './weather.ts';

test('hourly details preserve instant and preceding-hour gust semantics, nullable data and bounded series', async () => {
  const fixture = forecastFixture(), count = fixture.hourly.time.length;
  Object.assign(fixture.hourly, { weather_code: Array(count).fill(95), temperature_2m: Array(count).fill(14), relative_humidity_2m: Array(count).fill(65), dew_point_2m: Array(count).fill(null), surface_pressure: Array(count).fill(1012), visibility: Array(count).fill(18000), cloud_cover: Array(count).fill(40), wind_speed_10m: Array(count).fill(12), wind_direction_10m: Array(count).fill(225), wind_gusts_10m: Array(count).fill(24) });
  const now = Date.parse('2026-10-18T13:30:00Z'), state = normalizeForecast(fixture, defaultSettings(), now);
  assert.ok(state.details!.length <= 25); assert.equal(state.details![0]!.time, new Date(Math.ceil((Math.min(now, fixture.current.time * 1000) - 3600_000) / 3600_000) * 3600_000).toISOString());
  assert.equal(state.details![0]!.weatherCode, 95); assert.equal(state.details![0]!.dewPoint, null); assert.equal(state.details![0]!.visibility, 18000); assert.equal(state.details![0]!.windGust, 24);
  let url: URL | undefined;
  const settings = defaultSettings(); settings.units = 'imperial';
  await new WeatherService(async input => { url = new URL(input); return Response.json(fixture); }, () => now).get(settings);
  assert.equal(url?.searchParams.get('wind_speed_unit'), 'mph'); assert.equal(url?.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.match(url!.searchParams.get('hourly')!, /weather_code/); assert.match(url!.searchParams.get('hourly')!, /surface_pressure/); assert.match(url!.searchParams.get('hourly')!, /wind_gusts_10m/);
});
test('absent optional provider detail series remain unknown and incomplete provided series are rejected', () => {
  const fixture = forecastFixture(), now = Date.parse('2026-10-18T13:00:00Z');
  assert.equal(normalizeForecast(fixture, defaultSettings(), now).details![0]!.temperature, null);
  assert.equal(normalizeForecast(fixture, defaultSettings(), now).details![0]!.weatherCode, null);
  const shortCodes = { ...fixture, hourly: { ...fixture.hourly, weather_code: [95] } };
  assert.throws(() => normalizeForecast(shortCodes, defaultSettings(), now), /Incomplete forecast series/);
  Object.assign(fixture.hourly, { temperature_2m: [1] });
  assert.throws(() => normalizeForecast(fixture, defaultSettings(), now), /Incomplete forecast series/);
});

