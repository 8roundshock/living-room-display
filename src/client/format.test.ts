import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { WeatherState } from '../shared/contracts.ts';
import { ageIsKnown, ageLabel, chartAxisLabels, civilDate, compactWeatherRange, compactWeatherTime, dateTimeFormat, forecastDay, LAST_KNOWN_AFTER_MS, lastKnownLabel, lastKnownTime, MINUS, presentedStatus, REFRESH_GRACE_MS, shortAge, temperature, todayForecast, upcomingDays, weatherIsFresh, weatherStatus, weatherTime, weatherTimeZone } from './format.ts';
import { rainChartLabel, rainOutlook, rainOutlookCopy } from './weather-outlook.ts';

const TORONTO = 'America/Toronto';
const HOUR = 3_600_000;
// Sunday 2026-10-18, 9 AM in Toronto (EDT, UTC-4).
const NOW = Date.parse('2026-10-18T13:00:00Z');
const readable = (text: string | null) => text?.replace(/[\u00a0\u202f]/g, ' ').replace(/\u2060/g, '') ?? null;

test('temperatures use the true minus sign, and a value rounding to zero prints 0° (#335)', () => {
  assert.equal(MINUS, '−');
  assert.equal(temperature(-7), '−7°');
  assert.equal(temperature(-0.4), '0°', 'rounds to −0, printed as 0°');
  assert.equal(temperature(-0.5), '0°', 'Math.round(−0.5) is −0');
  assert.equal(temperature(0), '0°');
  assert.equal(temperature(3), '3°');
  assert.equal(temperature(-21.6), '−22°');
  assert.equal(temperature(null), '—');
  for (const value of [-30, -7, -0.4, 0, 3, 41]) assert.doesNotMatch(temperature(value), /-/, `${value}: no ASCII hyphen`);
});

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

test('fresh weather has no status and so no age; a saved, offline or unavailable forecast keeps its label and age (#715)', () => {
  const at = (ms: number | null, status: WeatherState['status']) => ({ status, updatedAt: ms === null ? null : new Date(ms).toISOString() });
  // Fresh on a connected display: nothing to say, however old or odd the update time is.
  for (const updated of [NOW - 5 * 60_000, NOW, NOW - 26 * HOUR, NOW + 4 * HOUR, null]) assert.equal(weatherStatus(at(updated, 'fresh'), false, NOW), null);
  // Not fresh: the status label, with the age only there.
  assert.deepEqual(weatherStatus(at(NOW - 5 * HOUR, 'stale'), false, NOW), { label: 'Saved forecast', age: 'Updated 5 hr ago' });
  assert.deepEqual(weatherStatus(at(NOW - 26 * HOUR, 'stale'), false, NOW), { label: 'Saved forecast', age: 'Updated 1 day ago' });
  assert.deepEqual(weatherStatus(at(NOW - 5 * 60_000, 'fresh'), true, NOW), { label: 'Offline', age: 'Updated 5 min ago' }, 'a display that cannot reach the computer is never fresh');
  assert.deepEqual(weatherStatus(at(NOW - 5 * HOUR, 'stale'), true, NOW), { label: 'Offline', age: 'Updated 5 hr ago' }, 'offline comes first');
  assert.deepEqual(weatherStatus(at(null, 'stale'), false, NOW), { label: 'Saved forecast', age: 'Not updated yet' });
  assert.deepEqual(weatherStatus(at(NOW + 4 * HOUR, 'stale'), false, NOW), { label: 'Saved forecast', age: 'Update time unknown' });
  // Unavailable: the renderer's own line says so; the age shows only when an update time is known (#362).
  assert.deepEqual(weatherStatus(at(NOW - 2 * HOUR, 'unavailable'), false, NOW), { label: null, age: 'Updated 2 hr ago' });
  assert.equal(weatherStatus(at(null, 'unavailable'), false, NOW), null, 'no empty age while nothing was ever loaded');
  // "Saved …" labels take the short age; other texts stay whole.
  assert.equal(shortAge('Updated 5 hr ago'), '5 hr ago');
  assert.equal(shortAge('Updated just now'), 'just now');
  assert.equal(shortAge('Not updated yet'), 'Not updated yet');
  assert.equal(shortAge('Update time unknown'), 'Update time unknown');
  // Only an elapsed time counts as a known age; Forecast's small family drops the two phrases that tell none.
  assert.deepEqual(['Updated just now', 'Updated 5 hr ago', 'Updated 364 days ago'].map(ageIsKnown), [true, true, true]);
  assert.deepEqual(['Update time unknown', 'Not updated yet'].map(ageIsKnown), [false, false]);
  assert.equal(ageIsKnown(ageLabel(new Date(NOW + 10 * 60_000).toISOString(), NOW)), false, 'a forecast dated ahead of the clock has no age to tell (#244)');
  assert.equal(ageIsKnown(ageLabel(null, NOW)), false);
  // No status ever names a provider.
  for (const status of [weatherStatus(at(NOW - 5 * HOUR, 'stale'), false, NOW), weatherStatus(at(NOW, 'fresh'), true, NOW), weatherStatus(at(NOW - HOUR, 'unavailable'), false, NOW)]) assert.doesNotMatch(JSON.stringify(status), /Open-Meteo/);
});

test('a refresh in flight is not a saved forecast: stale data still reads as fresh while its first refresh runs (#715)', () => {
  const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
  // What the server answers when the 15-minute interval has just ended and the provider takes over a second (#351).
  const refreshing = { status: 'stale' as const, updatedAt: at(16), error: null, refreshing: true };
  assert.equal(presentedStatus(refreshing, NOW), 'fresh');
  assert.equal(weatherStatus(refreshing, false, NOW), null, 'no "Saved forecast" line while the refresh runs');
  assert.equal(weatherIsFresh(refreshing, false, NOW), true);
  assert.equal(presentedStatus({ ...refreshing, updatedAt: at(31) }, NOW), 'fresh', 'air quality refreshes every 30 minutes');
  // Not refreshing: saved, as before.
  const saved = { status: 'stale' as const, updatedAt: at(16), error: null };
  assert.equal(presentedStatus(saved, NOW), 'stale');
  assert.equal(presentedStatus({ ...saved, refreshing: false }, NOW), 'stale');
  assert.deepEqual(weatherStatus(saved, false, NOW), { label: 'Saved forecast', age: 'Updated 16 min ago' });
  // A refresh has failed since the last good one: `error` stays through the retries, so a retry in flight never blinks fresh.
  const retrying = { ...refreshing, updatedAt: at(5 * 60), error: 'Weather update failed. Showing the last successful forecast.' };
  assert.equal(presentedStatus(retrying, NOW), 'stale');
  assert.equal(presentedStatus({ ...retrying, updatedAt: at(16) }, NOW), 'stale', 'even when it is only just stale');
  assert.deepEqual(weatherStatus(retrying, false, NOW), { label: 'Saved forecast', age: 'Updated 5 hr ago' });
  assert.equal(weatherIsFresh(retrying, false, NOW), false);
  // Too old to pass as current (a PC waking from sleep): saved until the refresh lands.
  assert.equal(REFRESH_GRACE_MS, 45 * 60_000);
  assert.equal(presentedStatus({ ...refreshing, updatedAt: new Date(NOW - REFRESH_GRACE_MS).toISOString() }, NOW), 'fresh', 'the grace is inclusive');
  assert.equal(presentedStatus({ ...refreshing, updatedAt: new Date(NOW - REFRESH_GRACE_MS - 1).toISOString() }, NOW), 'stale');
  assert.equal(presentedStatus({ ...refreshing, updatedAt: at(8 * 60) }, NOW), 'stale');
  assert.ok(REFRESH_GRACE_MS < LAST_KNOWN_AFTER_MS, 'never long enough to hide a last-known reading');
  // An update time that cannot be aged is never excused; a small clock skew is.
  assert.equal(presentedStatus({ ...refreshing, updatedAt: null }, NOW), 'stale');
  assert.equal(presentedStatus({ ...refreshing, updatedAt: 'not a time' }, NOW), 'stale');
  assert.equal(presentedStatus({ ...refreshing, updatedAt: new Date(NOW + 4 * HOUR).toISOString() }, NOW), 'stale');
  assert.equal(presentedStatus({ ...refreshing, updatedAt: new Date(NOW + 60_000).toISOString() }, NOW), 'fresh');
  // Only `stale` is ever reread; every other status is the server's own, refreshing or not.
  for (const status of ['fresh', 'unavailable', 'off', 'unsupported'] as const) assert.equal(presentedStatus({ status, updatedAt: at(16), error: null, refreshing: true }, NOW), status);
  // Offline is the caller's question and stays as it is: a display that cannot reach the computer says so.
  assert.deepEqual(weatherStatus(refreshing, true, NOW), { label: 'Offline', age: 'Updated 16 min ago' });
  assert.equal(weatherIsFresh(refreshing, true, NOW), false);
  assert.equal(weatherIsFresh({ status: 'fresh', updatedAt: at(1) }, true, NOW), false);
  assert.equal(weatherIsFresh({ status: 'fresh', updatedAt: at(1) }, false, NOW), true);
  // The last-known rule reads the same status: a refreshing forecast within the grace is never "Last known".
  const current = { time: at(16), temperature: 14, feelsLike: 13, weatherCode: 3, isDay: true, windSpeed: 8 };
  assert.equal(lastKnownTime({ ...refreshing, current }, false, TORONTO, '12h', NOW), null);
  assert.equal(readable(lastKnownTime({ ...refreshing, updatedAt: at(5 * 60), current }, false, TORONTO, '12h', NOW)), '4 AM', 'a five-hour-old forecast is last known, refreshing or not');
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

test('one last-known threshold and label for Weather and Air quality (#329)', () => {
  assert.equal(LAST_KNOWN_AFTER_MS, 3 * HOUR);
  // Exact characters: no-break spaces join the weekday, the time and AM/PM (#197).
  assert.equal(lastKnownLabel(NOW - 5 * HOUR, NOW, TORONTO, '12h'), '4 AM');
  assert.equal(lastKnownLabel(NOW - 26 * HOUR, NOW, TORONTO, '12h'), 'Sat 7 AM');
  assert.equal(lastKnownLabel(NOW - 72 * HOUR, NOW, TORONTO, '24h'), 'Thu 09:00');
  assert.equal(lastKnownLabel(NOW - 3 * HOUR - 30 * 60_000, NOW, TORONTO, '12h'), '5:30 AM', 'minutes stay when not on the hour');
  // The weekday follows the place's calendar: ten hours before 9 AM Sunday in Toronto is Saturday
  // night there, but Sunday noon in Tokyo.
  assert.equal(readable(lastKnownLabel(NOW - 10 * HOUR, NOW, TORONTO, '12h')), 'Sat 11 PM');
  assert.equal(readable(lastKnownLabel(NOW - 10 * HOUR, NOW, 'Asia/Tokyo', '12h')), '12 PM');
  // Weather's label is the shared one.
  assert.equal(lastKnownTime(weather('stale', new Date(NOW - 26 * HOUR).toISOString()), false, TORONTO, '12h', NOW), lastKnownLabel(NOW - 26 * HOUR, NOW, TORONTO, '12h'));
  // The dateTimeFormat export keeps its shape for other units (#372).
  assert.equal(dateTimeFormat('en', { timeZone: TORONTO, weekday: 'short' }), dateTimeFormat('en', { timeZone: TORONTO, weekday: 'short' }), 'one cached formatter per locale and options');
});

test('chart axis labels: compact hours, “Now” for the bar covering now, the last bar\'s end (#261)', () => {
  const bars = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({ start: new Date(start + index * HOUR).toISOString(), end: new Date(start + (index + 1) * HOUR).toISOString() }));
  assert.deepEqual(chartAxisLabels(bars(NOW, 12), NOW, TORONTO, '12h'), { start: 'Now', end: '9 PM' });
  assert.deepEqual(chartAxisLabels(bars(NOW, 13), NOW + 30 * 60_000, TORONTO, '12h'), { start: 'Now', end: '10 PM' }, 'mid-hour: 13 bars, the first still covers now');
  assert.deepEqual(chartAxisLabels(bars(NOW, 24), NOW + 5 * 60_000, TORONTO, '24h'), { start: 'Now', end: '09:00' });
  assert.deepEqual(chartAxisLabels(bars(NOW + HOUR, 3), NOW, TORONTO, '12h'), { start: '10 AM', end: '1 PM' }, 'a chart starting later names its first hour');
  assert.deepEqual(chartAxisLabels(bars(NOW - HOUR, 3), NOW, TORONTO, '12h'), { start: '8 AM', end: '11 AM' }, 'an hour that has ended is not now');
  assert.equal(chartAxisLabels([], NOW, TORONTO, '12h'), null);
  assert.deepEqual(chartAxisLabels(bars(Date.parse('2026-10-18T09:00:00Z'), 2), Date.parse('2026-10-18T09:10:00Z'), 'Asia/Kolkata', '12h'), { start: 'Now', end: '4:30 PM' });
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
