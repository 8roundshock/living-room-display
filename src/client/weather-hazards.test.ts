import test from 'node:test';
import assert from 'node:assert/strict';
import type { WeatherDetailReading } from '../shared/contracts.ts';
import { gustForecastSpells, weatherHazardSpells } from './weather-hazards.ts';

const HOUR = 3600_000, NOW = Date.parse('2026-11-04T15:30:00Z');
function reading(time: number, weatherCode: number | null, windGust: number | null = null): WeatherDetailReading {
  return { time: new Date(time).toISOString(), weatherCode, windGust, temperature: null, humidity: null, dewPoint: null,
    pressure: null, visibility: null, cloudCover: null, windSpeed: null, windDirection: null };
}

test('hourly conditions never extend a past hazard, infer a duration or bridge missing samples', () => {
  const at = NOW + HOUR / 2;
  const details = [reading(at - 2 * HOUR, 95), reading(at - HOUR, 95), reading(at, 51),
    reading(at + HOUR, 95), reading(at + 2 * HOUR, 95), reading(at + 3 * HOUR, null), reading(at + 4 * HOUR, 95)];
  assert.deepEqual(weatherHazardSpells({ details }, NOW), [
    { family: 'storm', code: 95, start: at + HOUR, end: at + 2 * HOUR },
    { family: 'storm', code: 95, start: at + 4 * HOUR, end: at + 4 * HOUR },
  ]);
  assert.deepEqual(weatherHazardSpells({ details: [reading(at, 95)] }, at), [{ family: 'storm', code: 95, start: at, end: at }]);
  assert.deepEqual(weatherHazardSpells({ details: [reading(at, 95)] }, at + 1), [], 'instant is no longer upcoming');
  assert.deepEqual(weatherHazardSpells({}, NOW), []);
});

test('condition families, input ordering and the bounded horizon remain deterministic', () => {
  const at = NOW + HOUR / 2;
  const details = [reading(at + 3 * HOUR, 75), reading(at, 99), reading(at + HOUR, 66), reading(at + 2 * HOUR, 65),
    reading(at + 25 * HOUR, 95), { ...reading(at, 95), time: 'not-a-date' }];
  assert.deepEqual(weatherHazardSpells({ details }, NOW).map(spell => spell.family), ['hail', 'freezing', 'heavyRain', 'heavySnow']);
});

test('gusts use preceding-hour maxima and expire exactly at the interval end', () => {
  const at = NOW + HOUR / 2;
  const details = [reading(at - HOUR, 3, 100), reading(at, 3, 70), reading(at + HOUR, 3, 80), reading(at + 2 * HOUR, 3, null), reading(at + 3 * HOUR, 3, 75)];
  assert.deepEqual(gustForecastSpells({ details }, NOW, 70), [{ start: at - HOUR, end: at + HOUR, peak: 80 }, { start: at + 2 * HOUR, end: at + 3 * HOUR, peak: 75 }]);
  assert.deepEqual(gustForecastSpells({ details: [reading(at, 3, 70)] }, at, 70), []);
  assert.deepEqual(gustForecastSpells({ details: [reading(at, 3, 69.9)] }, NOW, 70), []);
});

test('DST repeated local hours remain distinct epoch samples rather than duplicated clock labels', () => {
  const first = Date.parse('2026-11-01T05:00:00Z'), second = Date.parse('2026-11-01T06:00:00Z');
  assert.deepEqual(weatherHazardSpells({ details: [reading(first, 95), reading(second, 95)] }, first - HOUR / 2), [
    { family: 'storm', code: 95, start: first, end: second },
  ]);
  assert.equal(gustForecastSpells({ details: [reading(second, 3, 80)] }, first, 70)[0]!.start, first);
});
