import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { WeatherState } from '../shared/contracts.ts';
import { ageLabel, civilDate, compactWeatherRange, compactWeatherTime, forecastDay, lastKnownTime, todayForecast, upcomingDays, weatherTime, weatherTimeZone } from './format.ts';
import { rainChartLabel, rainOutlook, rainOutlookCopy } from './weather-outlook.ts';

const TORONTO = 'America/Toronto';
const HOUR = 3_600_000;
// Sunday 2026-10-18, 9 AM in Toronto (EDT, UTC-4).
const NOW = Date.parse('2026-10-18T13:00:00Z');
const readable = (text: string | null) => text?.replace(/[\u00a0\u202f]/g, ' ').replace(/\u2060/g, '') ?? null;

test('ageLabel never calls a future update time “just now” (#244)', () => {
  assert.equal(ageLabel(new Date(NOW + 60_000).toISOString(), NOW), 'Updated just now', 'up to two minutes ahead is ordinary clock skew');
  assert.equal(ageLabel(new Date(NOW + 2 * 60_000).toISOString(), NOW), 'Updated just now');
  assert.equal(ageLabel(new Date(NOW + 2 * 60_000 + 1).toISOString(), NOW), 'Update time unknown');
  assert.equal(ageLabel(new Date(NOW + 4 * HOUR).toISOString(), NOW), 'Update time unknown', 'a fetch made while the clock was 4 h fast');
  assert.equal(ageLabel('not a time', NOW), 'Update time unknown');
  assert.equal(ageLabel(new Date(NOW - 5 * HOUR).toISOString(), NOW), 'Updated 5 hr ago');
  assert.equal(ageLabel(new Date(NOW - 26 * HOUR).toISOString(), NOW), 'Updated 1 day ago', 'one day is singular (#280)');
  assert.equal(ageLabel(new Date(NOW - 50 * HOUR).toISOString(), NOW), 'Updated 2 days ago');
  assert.equal(ageLabel(null, NOW), 'Not updated yet');
});

test('compact forecast labels name tomorrow by its weekday; the full label keeps Tomorrow (#256)', () => {
  assert.equal(forecastDay('2026-10-18', TORONTO, NOW, true), 'Today');
  assert.equal(forecastDay('2026-10-19', TORONTO, NOW, true), 'Mon');
  assert.equal(forecastDay('2026-10-19', TORONTO, NOW), 'Tomorrow');
  assert.equal(forecastDay('2026-10-20', TORONTO, NOW, true), 'Tue');
  for (let day = 18; day <= 24; day++) assert.notEqual(forecastDay(`2026-10-${day}`, TORONTO, NOW, true), 'Tom.');
});

function daily(first: string, count = 7) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(`${first}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), weatherCode: 3, temperatureMax: 17 + index, temperatureMin: 9, precipitationProbability: 60, precipitationAmount: 2 };
  });
}

test('a forecast saved one or three days earlier shows no past day and finds today by the city calendar (#243)', () => {
  const today = civilDate(NOW, TORONTO);
  assert.equal(today, '2026-10-18');
  const oneDay = daily('2026-10-17');
  assert.deepEqual(upcomingDays(oneDay, today).map(day => day.date), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  assert.equal(todayForecast(oneDay, TORONTO, NOW)?.temperatureMax, 18, 'today is the second saved entry, not the first');
  const threeDays = daily('2026-10-15');
  assert.deepEqual(upcomingDays(threeDays, today).map(day => day.date), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']);
  assert.equal(todayForecast(threeDays, TORONTO, NOW)?.temperatureMax, 20);
  const ended = daily('2026-10-08');
  assert.deepEqual(upcomingDays(ended, today), [], 'nothing left: the widget says Forecast unavailable');
  assert.equal(todayForecast(ended, TORONTO, NOW), undefined);
  // Today follows the city's calendar, not the computer's or UTC.
  assert.equal(todayForecast(daily('2026-10-18'), 'Asia/Tokyo', Date.parse('2026-10-18T16:00:00Z'))?.date, '2026-10-19');
});

test('a device location whose zone is still auto formats nothing in auto (independent review of c99af30, #243)', () => {
  // A saved device location stores 'auto' until its first forecast; the server reports it while the forecast is unavailable.
  assert.throws(() => civilDate(NOW, 'auto'), RangeError, 'Intl rejects the placeholder, so renderers must never format in it');
  assert.doesNotThrow(() => todayForecast([], 'auto', NOW), 'no saved day: nothing is looked up');
  assert.equal(todayForecast([], 'auto', NOW), undefined);
  const computer = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(weatherTimeZone('auto'), computer, 'unresolved: this computer\'s zone, as Sun & moon does');
  for (const unusable of ['', null, undefined, 'Not/A_Zone']) assert.equal(weatherTimeZone(unusable), computer, `${String(unusable)} falls back`);
  assert.equal(weatherTimeZone(TORONTO), TORONTO, 'a resolved city zone is used as is');
  assert.equal(weatherTimeZone('Asia/Tokyo'), 'Asia/Tokyo');
  // Everything Weather and Forecast compute for an unavailable forecast in that zone.
  const zone = weatherTimeZone('auto');
  assert.deepEqual(upcomingDays([], civilDate(NOW, zone)), []);
  assert.equal(todayForecast([], zone, NOW), undefined);
  const outlook = rainOutlook({ hourly: [], units: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' } }, NOW);
  assert.equal(rainOutlookCopy(outlook, zone, '12h', NOW, 'full').headline, 'Rain outlook unavailable');
  assert.equal(lastKnownTime({ status: 'unavailable', updatedAt: null, current: null }, true, zone, '12h', NOW), null);
});

function weather(status: WeatherState['status'], updatedAt: string | null): Pick<WeatherState, 'current' | 'status' | 'updatedAt'> {
  return { status, updatedAt, current: { time: updatedAt ?? '', temperature: 14, feelsLike: 13, weatherCode: 3, isDay: true, windSpeed: 8 } };
}

test('an hours-old saved reading is last known, with the weekday when not today (#243)', () => {
  const at = (hours: number) => new Date(NOW - hours * HOUR).toISOString();
  assert.equal(lastKnownTime(weather('stale', at(3)), false, TORONTO, '12h', NOW), null, 'three hours is not yet more than three hours');
  assert.equal(readable(lastKnownTime(weather('stale', new Date(NOW - 3 * HOUR - 60_000).toISOString()), false, TORONTO, '12h', NOW)), '5:59 AM');
  assert.equal(readable(lastKnownTime(weather('stale', at(5)), false, TORONTO, '12h', NOW)), '4 AM');
  assert.equal(readable(lastKnownTime(weather('stale', at(26)), false, TORONTO, '12h', NOW)), 'Sat 7 AM');
  assert.equal(readable(lastKnownTime(weather('stale', at(72)), false, TORONTO, '24h', NOW)), 'Thu 09:00');
  assert.equal(readable(lastKnownTime(weather('fresh', at(5)), true, TORONTO, '12h', NOW)), '4 AM', 'an offline display qualifies an old reading too');
  assert.equal(lastKnownTime(weather('fresh', at(5)), false, TORONTO, '12h', NOW), null, 'a fresh, connected reading is never qualified');
  assert.equal(lastKnownTime({ ...weather('stale', at(5)), current: null }, false, TORONTO, '12h', NOW), null, 'nothing to qualify');
  assert.equal(lastKnownTime(weather('stale', new Date(NOW + HOUR).toISOString()), false, TORONTO, '12h', NOW), null, 'a future update time is not hours old');
});

test('formatters are cached: a re-render in the same minute constructs no Intl.DateTimeFormat (#99)', () => {
  const Original = Intl.DateTimeFormat;
  let constructions = 0;
  const Spy = new Proxy(Original, { construct(target, args) { constructions++; return Reflect.construct(target, args); }, apply(target, self, args) { constructions++; return Reflect.apply(target, self, args); } });
  // Everything Weather (large, elevated) and Forecast (large) format for one render, at the minute the renderers memoize on.
  const hourly = Array.from({ length: 24 }, (_, index) => ({ intervalStart: new Date(NOW + index * HOUR).toISOString(), intervalEnd: new Date(NOW + (index + 1) * HOUR).toISOString(), precipitationProbability: index === 5 ? null : 60, precipitationAmount: 1, rainAmount: 1 }));
  const state = { hourly, units: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' } } as Pick<WeatherState, 'hourly' | 'units'>;
  const days = daily('2026-10-17');
  const render = (at: number) => {
    const now = Math.floor(at / 60_000) * 60_000;
    const outlook = rainOutlook(state, now);
    const copy = rainOutlookCopy(outlook, TORONTO, '12h', now, 'full');
    const bars = outlook.hours.map(hour => compactWeatherTime(hour.start, TORONTO, '12h'));
    const labels = upcomingDays(days, civilDate(now, TORONTO)).map(day => [forecastDay(day.date, TORONTO, now, true), forecastDay(day.date, TORONTO, now)]);
    return [copy, bars, labels, rainChartLabel(outlook, TORONTO, '12h'), todayForecast(days, TORONTO, now), lastKnownTime(weather('stale', new Date(now - 5 * HOUR).toISOString()), false, TORONTO, '12h', now),
      compactWeatherRange(hourly[1]!.intervalStart, hourly[3]!.intervalEnd, TORONTO, '12h'), weatherTime(hourly[0]!.intervalStart, TORONTO, '24h'), ageLabel(new Date(now - 5 * HOUR).toISOString(), now)];
  };
  Intl.DateTimeFormat = Spy;
  try {
    const first = render(NOW);
    constructions = 0;
    const second = render(NOW + 20_000);
    assert.equal(constructions, 0, 'a tick within the same minute constructs nothing');
    assert.deepEqual(second, first, 'and renders the same strings');
    render(NOW + 60_000); render(NOW + 2 * HOUR);
    assert.equal(constructions, 0, 'later minutes reuse the cached formatters too');
    // The spy does see constructions: a zone not used before builds its formatter once.
    compactWeatherTime(hourly[0]!.intervalStart, 'Pacific/Chatham', '12h'); compactWeatherTime(hourly[1]!.intervalStart, 'Pacific/Chatham', '12h');
    assert.equal(constructions, 1);
  } finally { Intl.DateTimeFormat = Original; }
});
