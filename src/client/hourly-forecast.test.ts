// Hourly forecast (#714): the pure shaping. Synthetic weather only; sun times come from astronomy.ts.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { LocationSettings, WeatherState } from '../shared/contracts.ts';
import { sunDay } from './astronomy.ts';
import { weatherTime } from './format.ts';
import {
  HOURLY_CHANCE_MIN, NOTABLE_GUST, TREND_MIN_SPAN, hourlyColumns, hourlyForecastSlots, hourlyForecastView, nextSunEvent, peakGust,
  sunEvents, trendLevels, trendPaths, type HourlyForecastOptions,
} from './hourly-forecast.ts';

const HOUR = 3_600_000, MINUTE = 60_000;
const TORONTO: LocationSettings = { name: 'Synthetic city', latitude: 43.65, longitude: -79.38, timezone: 'America/Toronto' };
const TROMSO: LocationSettings = { name: 'Synthetic north', latitude: 69.65, longitude: 18.96, timezone: 'Europe/Oslo' };
const readable = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

interface Hours { temperature?: (index: number) => number | null; code?: (index: number) => number | null; chance?: (index: number) => number | null; gust?: (index: number) => number | null }
/** Hourly instants from `start` (default: the hour containing `now`), each with the interval that starts at it. */
function weather(now: number, { count = 16, start = Math.floor(now / HOUR) * HOUR, location = TORONTO, status = 'fresh' as WeatherState['status'], updatedAt = now - 5 * MINUTE, temperature = index => 10 - index, code = () => 0, chance = () => 0, gust = () => 10 }: Hours & { count?: number; start?: number; location?: LocationSettings; status?: WeatherState['status']; updatedAt?: number } = {}): WeatherState {
  const at = (index: number) => new Date(start + index * HOUR).toISOString();
  return {
    status, updatedAt: new Date(updatedAt).toISOString(), error: null, source: 'Open-Meteo', sourceUrl: 'https://open-meteo.com/', location,
    units: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' },
    current: { time: new Date(now).toISOString(), temperature: 21.4, feelsLike: 20, weatherCode: 3, isDay: true, windSpeed: 5 },
    daily: [],
    hourly: Array.from({ length: count }, (_, index) => ({ intervalStart: at(index), intervalEnd: at(index + 1), precipitationProbability: chance(index), precipitationAmount: 0, rainAmount: 0 })),
    details: Array.from({ length: count }, (_, index) => ({ time: at(index), weatherCode: code(index), temperature: temperature(index), humidity: 60, dewPoint: 2, pressure: 1012, visibility: 20_000, cloudCover: 20, windSpeed: 9, windDirection: 270, windGust: gust(index) })),
  };
}
const options = (now: number, overrides: Partial<HourlyForecastOptions> = {}): HourlyForecastOptions => ({ now, slots: 12, clockFormat: '24h', timeZone: 'America/Toronto', disconnected: false, ...overrides });
const kinds = (state: WeatherState, settings: HourlyForecastOptions) => hourlyColumns(state, settings).columns.map(column => column.kind === 'hour' ? (column.now ? 'now' : 'hour') : column.kind);
const labels = (state: WeatherState, settings: HourlyForecastOptions) => hourlyColumns(state, settings).columns.map(column => readable(column.label));
const clock = (at: Date | number, timeZone = 'America/Toronto', format: '12h' | '24h' = '24h') => readable(weatherTime(new Date(at).toISOString(), timeZone, format));

// Sunday 22 November 2026 in Toronto (EST, UTC−5): sunset about 16:46, next sunrise about 07:21.
const NOV_SUNSET = sunDay('2026-11-22', TORONTO.latitude, TORONTO.longitude, TORONTO.timezone).sunset!.getTime();
const NOV_NEXT_SUNRISE = sunDay('2026-11-23', TORONTO.latitude, TORONTO.longitude, TORONTO.timezone).sunrise!.getTime();
const EVENING = Date.parse('2026-11-22T23:20:00Z'); // 18:20, after sunset
const AFTERNOON = Date.parse('2026-11-22T18:10:00Z'); // 13:10

test('the families have Forecast’s strip lengths: 6 columns in medium and 12 in large', () => {
  assert.equal(hourlyForecastSlots('medium'), 6); assert.equal(hourlyForecastSlots('large'), 12);
  assert.equal(hourlyColumns(weather(EVENING), options(EVENING, { slots: 6 })).columns.length, 6);
  assert.equal(hourlyColumns(weather(EVENING), options(EVENING)).columns.length, 12);
});

test('the first column is Now from the current reading; later columns are the hourly instants after now', () => {
  assert.ok(clock(NOV_SUNSET) >= '16:40' && clock(NOV_SUNSET) <= '16:50', `Toronto sunset on 22 November is about 16:46, got ${clock(NOV_SUNSET)}`);
  const state = weather(EVENING, { temperature: index => 5 - index, code: () => 0 });
  const { columns } = hourlyColumns(state, options(EVENING));
  assert.deepEqual(columns.map(column => readable(column.label)), ['Now', '19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05']);
  const [now, next] = columns;
  assert.ok(now?.kind === 'hour' && next?.kind === 'hour');
  // Now agrees with Weather: the current reading (21.4°, overcast, its own day flag), not the 18:00 model instant.
  assert.deepEqual({ now: now.now, temperature: now.temperature, code: now.weatherCode, isDay: now.isDay, time: now.time }, { now: true, temperature: 21.4, code: 3, isDay: true, time: new Date(EVENING).toISOString() });
  assert.deepEqual({ now: next.now, temperature: next.temperature, code: next.weatherCode, isDay: next.isDay, time: next.time }, { now: false, temperature: 4, code: 0, isDay: false, time: '2026-11-23T00:00:00.000Z' }, 'the 19:00 instant, at night');
  assert.deepEqual(labels(state, options(EVENING, { clockFormat: '12h', slots: 6 })), ['Now', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM']);
  // Hourly instants off the whole local hour keep their minutes on the 24-hour clock.
  assert.deepEqual(labels(weather(EVENING, { start: Date.parse('2026-11-22T22:30:00Z') }), options(EVENING, { slots: 3 })), ['Now', '18:30', '19:30']);
  // Exactly on the hour, that instant is Now's; the next column is the following hour.
  const onTheHour = Date.parse('2026-11-22T23:00:00Z');
  assert.deepEqual(labels(weather(onTheHour), options(onTheHour, { slots: 3 })), ['Now', '19', '20']);
});

test('day and night glyphs follow the sun at the weather location', () => {
  const { columns } = hourlyColumns(weather(AFTERNOON), options(AFTERNOON));
  const hours = columns.filter(column => column.kind === 'hour' && !column.now);
  for (const column of hours) if (column.kind === 'hour') assert.equal(column.isDay, Date.parse(column.time) < NOV_SUNSET, `${column.label} is ${Date.parse(column.time) < NOV_SUNSET ? 'day' : 'night'}`);
  assert.ok(hours.some(column => column.kind === 'hour' && column.isDay) && hours.some(column => column.kind === 'hour' && !column.isDay), 'the window crosses sunset');
});

test('the chance belongs to the hour that starts at the column; Now uses the hour in progress; unknown stays unknown', () => {
  assert.equal(HOURLY_CHANCE_MIN, 10);
  const state = weather(EVENING, { chance: index => index * 10 });
  const chances = (value: WeatherState) => hourlyColumns(value, options(EVENING, { slots: 4 })).columns.map(column => column.kind === 'hour' ? column.chance : 'sun');
  assert.deepEqual(chances(state), [0, 10, 20, 30], 'Now: 18:00–19:00; then 19:00–20:00, 20:00–21:00, 21:00–22:00');
  const partial = structuredClone(state); partial.hourly = partial.hourly.filter((_, index) => index !== 2); partial.hourly[2]!.precipitationProbability = null;
  assert.deepEqual(chances(partial), [0, 10, null, null], 'a missing interval and a null chance are both unknown, never 0');
});

test('a sunset is its own column between the hours it falls between, and takes a slot', () => {
  const state = weather(AFTERNOON);
  assert.deepEqual(kinds(state, options(AFTERNOON)), ['now', 'hour', 'hour', 'hour', 'sunset', 'hour', 'hour', 'hour', 'hour', 'hour', 'hour', 'hour']);
  assert.deepEqual(labels(state, options(AFTERNOON)), ['Now', '14', '15', '16', clock(NOV_SUNSET), '17', '18', '19', '20', '21', '22', '23'], 'twelve columns: the sun column replaces the last hour (00:00)');
  assert.equal(readable(hourlyColumns(state, options(AFTERNOON, { clockFormat: '12h' })).columns[4]!.label), clock(NOV_SUNSET, 'America/Toronto', '12h'));
  assert.match(clock(NOV_SUNSET, 'America/Toronto', '12h'), /^4:4\d PM$/);
  const sun = hourlyColumns(state, options(AFTERNOON)).columns[4]!;
  assert.equal(sun.time, new Date(NOV_SUNSET).toISOString());
  assert.equal('temperature' in sun || 'chance' in sun, false, 'a sun column has no temperature and no chance');
  // Medium: six columns, the same event when it is inside them.
  const late = Date.parse('2026-11-22T20:10:00Z'); // 15:10
  assert.deepEqual(kinds(weather(late), options(late, { slots: 6 })), ['now', 'hour', 'sunset', 'hour', 'hour', 'hour']);
});

test('the trend runs straight through a sun column, which sits on the course between its neighbours', () => {
  const state = weather(AFTERNOON, { temperature: index => 8 - index });
  const shaped = hourlyColumns(state, options(AFTERNOON));
  const before = shaped.columns[3]!.level!, after = shaped.columns[5]!.level!;
  assert.ok(Math.abs(shaped.columns[4]!.level! - (before + after) / 2) < 1e-9, 'half way between 16:00 and 17:00');
  assert.equal(shaped.onTrend[4], true);
  assert.equal(hourlyForecastView(state, options(AFTERNOON)).trend.length, 1, 'one unbroken line: a sun column is not a missing value');
});

test('a sun event exactly on an hour follows that hour’s column', () => {
  // Hourly instants need not be whole UTC hours: put one exactly on the sunset.
  const state = weather(AFTERNOON, { start: NOV_SUNSET - 4 * HOUR });
  const { columns } = hourlyColumns(state, options(AFTERNOON));
  const index = columns.findIndex(column => column.kind === 'sunset');
  assert.ok(index > 0);
  assert.equal(columns[index - 1]!.kind, 'hour'); assert.equal(columns[index - 1]!.time, new Date(NOV_SUNSET).toISOString(), 'the hour on the event comes first');
  assert.equal(columns[index]!.time, columns[index - 1]!.time);
  assert.equal(columns.filter(column => column.kind !== 'hour').length, 1);
  assert.equal(columns.length, 12);
});

test('two events in one window: a summer night shows the sunset and the sunrise', () => {
  const sun = sunDay('2026-06-21', TORONTO.latitude, TORONTO.longitude, TORONTO.timezone), next = sunDay('2026-06-22', TORONTO.latitude, TORONTO.longitude, TORONTO.timezone);
  const evening = Date.parse('2026-06-22T00:10:00Z'); // 20:10 EDT on 21 June
  const state = weather(evening, { temperature: index => 26 - index });
  assert.deepEqual(kinds(state, options(evening)), ['now', 'hour', 'sunset', 'hour', 'hour', 'hour', 'hour', 'hour', 'hour', 'hour', 'hour', 'sunrise']);
  assert.deepEqual(labels(state, options(evening)), ['Now', '21', clock(sun.sunset!), '22', '23', '00', '01', '02', '03', '04', '05', clock(next.sunrise!)]);
  const shaped = hourlyColumns(state, options(evening));
  // The sunrise in the last column has no hour after it: it takes the 05:00 level and the line ends at 05:00.
  assert.equal(shaped.columns[11]!.level, shaped.columns[10]!.level); assert.equal(shaped.onTrend[11], false); assert.equal(shaped.onTrend[2], true);
  const view = hourlyForecastView(state, options(evening));
  assert.equal(view.trend.length, 1); assert.match(view.trend[0]!, /C[^C]* 90\.91,[\d.]+$/, 'the line ends at the eleventh column, not the sun column');
  assert.deepEqual(view.facts, [], 'neither event is repeated in the heading');
  // Nearer the pole both can fall between the same two hours; they keep their order and share the course between them.
  const levels = hourlyColumns(weather(evening, { location: { ...TROMSO, latitude: 65.9 }, temperature: index => 20 - index, count: 24 }), options(evening, { timeZone: 'Europe/Oslo', slots: 12 }));
  const events = levels.columns.filter(column => column.kind !== 'hour');
  assert.deepEqual(events.map(column => Date.parse(column.time)), events.map(column => Date.parse(column.time)).sort((a, b) => a - b));
});

test('no sun column on a polar day or night or without a real place: nothing is invented', () => {
  const summer = Date.parse('2026-06-21T10:10:00Z'), winter = Date.parse('2026-12-21T10:10:00Z');
  for (const [now, isDay] of [[summer, true], [winter, false]] as const) {
    const state = weather(now, { location: TROMSO });
    const view = hourlyForecastView(state, options(now, { timeZone: 'Europe/Oslo' }));
    assert.equal(view.columns.length, 12);
    assert.ok(view.columns.every(column => column.kind === 'hour'), 'hours only');
    assert.ok(view.columns.slice(1).every(column => column.kind === 'hour' && column.isDay === isDay), isDay ? 'the sun stays up' : 'the sun stays down');
    assert.deepEqual(view.facts, [], 'no sun fact either');
    assert.deepEqual(sunEvents(now, now + 12 * HOUR, TROMSO.latitude, TROMSO.longitude, 'Europe/Oslo'), []);
    assert.equal(nextSunEvent(now, TROMSO.latitude, TROMSO.longitude, 'Europe/Oslo'), null);
  }
  const nowhere = weather(AFTERNOON, { location: { ...TORONTO, latitude: Number.NaN } });
  const view = hourlyForecastView(nowhere, options(AFTERNOON));
  assert.equal(view.columns.length, 12); assert.ok(view.columns.every(column => column.kind === 'hour')); assert.deepEqual(view.facts, []);
  assert.deepEqual(sunEvents(AFTERNOON, AFTERNOON + 12 * HOUR, Number.NaN, TORONTO.longitude, 'America/Toronto'), []);
});

test('daylight saving changes: hours stay one real hour apart and the sunrise keeps its place', () => {
  // Clocks go back in Toronto on 1 November 2026 at 02:00 EDT, so 01:00 comes twice.
  const fallNow = Date.parse('2026-11-01T04:30:00Z'); // 00:30 EDT
  const fall = hourlyColumns(weather(fallNow, { count: 20 }), options(fallNow));
  const fallSunrise = sunDay('2026-11-01', TORONTO.latitude, TORONTO.longitude, TORONTO.timezone).sunrise!.getTime();
  assert.deepEqual(fall.columns.map(column => readable(column.label)), ['Now', '01', '01', '02', '03', '04', '05', '06', clock(fallSunrise), '07', '08', '09']);
  assert.ok(clock(fallSunrise) > '06:45' && clock(fallSunrise) < '07:00', `sunrise in standard time, got ${clock(fallSunrise)}`);
  // Clocks go forward on 8 March 2026 at 02:00 EST, so 02:00 never comes.
  const springNow = Date.parse('2026-03-08T05:30:00Z'); // 00:30 EST
  const spring = hourlyColumns(weather(springNow, { count: 20 }), options(springNow));
  const springSunrise = sunDay('2026-03-08', TORONTO.latitude, TORONTO.longitude, TORONTO.timezone).sunrise!.getTime();
  assert.deepEqual(spring.columns.map(column => readable(column.label)), ['Now', '01', '03', '04', '05', '06', '07', clock(springSunrise), '08', '09', '10', '11']);
  assert.ok(clock(springSunrise) > '07:30' && clock(springSunrise) < '07:50', `sunrise in daylight time, got ${clock(springSunrise)}`);
  for (const shaped of [fall, spring]) {
    const hours = shaped.columns.filter(column => column.kind === 'hour' && !column.now).map(column => Date.parse(column.time));
    assert.ok(hours.slice(1).every((time, index) => time - hours[index]! === HOUR), 'every hour column is one real hour after the last');
    const sun = shaped.columns.findIndex(column => column.kind === 'sunrise');
    assert.ok(Date.parse(shaped.columns[sun - 1]!.time) <= Date.parse(shaped.columns[sun]!.time) && Date.parse(shaped.columns[sun]!.time) < Date.parse(shaped.columns[sun + 1]!.time), 'in time order');
  }
});

test('the heading names the next sunrise or sunset only when the strip does not show it', () => {
  // After sunset the next event is tomorrow’s sunrise, beyond twelve columns.
  const evening = hourlyForecastView(weather(EVENING), options(EVENING));
  assert.deepEqual(evening.facts.map(readable), [`Sunrise ${clock(NOV_NEXT_SUNRISE)}`]);
  assert.match(clock(NOV_NEXT_SUNRISE), /^07:2\d$/);
  assert.equal(readable(hourlyForecastView(weather(EVENING), options(EVENING, { clockFormat: '12h' })).facts[0]!), `Sunrise ${clock(NOV_NEXT_SUNRISE, 'America/Toronto', '12h')}`);
  // In the afternoon the sunset is a column, so the heading stays quiet (it does not skip ahead to the sunrise).
  assert.deepEqual(hourlyForecastView(weather(AFTERNOON), options(AFTERNOON)).facts, []);
  // Medium at 10:10 ends at 15:00, before the sunset, so the heading names it.
  const morning = Date.parse('2026-11-22T15:10:00Z');
  assert.deepEqual(hourlyForecastView(weather(morning), options(morning, { slots: 6 })).facts.map(readable), [`Sunset ${clock(NOV_SUNSET)}`]);
  assert.ok(hourlyForecastView(weather(morning), options(morning, { slots: 6 })).columns.every(column => column.kind === 'hour'));
  // The facts keep their words together.
  assert.match(evening.facts[0]!, /^Sunrise\u00a0\d\d:\d\d$/);
});

test('peak gusts over the shown hours appear only when notable', () => {
  assert.deepEqual(NOTABLE_GUST, { 'km/h': 40, mph: 25 });
  assert.equal(peakGust([{ windGust: 39.4 }, { windGust: 12 }], 'km/h'), null);
  assert.equal(peakGust([{ windGust: 39.5 }, { windGust: null }], 'km/h'), 40);
  assert.equal(peakGust([{ windGust: 24 }], 'mph'), null); assert.equal(peakGust([{ windGust: 25 }], 'mph'), 25);
  assert.equal(peakGust([{ windGust: null }], 'km/h'), null); assert.equal(peakGust([], 'km/h'), null);
  const calm = hourlyForecastView(weather(EVENING, { gust: () => 30 }), options(EVENING));
  assert.equal(calm.facts.length, 1, 'only the sun fact');
  const windy = hourlyForecastView(weather(EVENING, { gust: index => index === 4 ? 54.6 : 20 }), options(EVENING));
  assert.deepEqual(windy.facts.map(readable), [`Sunrise ${clock(NOV_NEXT_SUNRISE)}`, 'Gusts 55 km/h']);
  assert.equal(windy.facts[1], 'Gusts\u00a055\u00a0km/h');
  // A gust beyond the last shown hour does not count: medium ends five hours ahead.
  assert.equal(hourlyForecastView(weather(EVENING, { gust: index => index === 8 ? 80 : 20 }), options(EVENING, { slots: 6 })).facts.length, 1);
  const imperial = weather(EVENING, { gust: () => 26 }); imperial.units = { temperature: '°F', windSpeed: 'mph', precipitation: 'in' };
  assert.equal(readable(hourlyForecastView(imperial, options(EVENING)).facts[1]!), 'Gusts 26 mph');
});

test('unknown values stay unknown: a dash’s column breaks the line, and a missing instant is never filled in', () => {
  const state = weather(EVENING, { temperature: index => index === 4 ? null : 6 - index, code: index => index === 6 ? null : 0 });
  state.details = state.details!.filter((_, index) => index !== 8); // the 02:00 instant is absent
  const view = hourlyForecastView(state, options(EVENING));
  assert.deepEqual(view.columns.map(column => readable(column.label)), ['Now', '19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05'], 'the absent hour keeps its column');
  const hour = (label: string) => { const column = view.columns.find(item => readable(item.label) === label); assert.ok(column?.kind === 'hour'); return column; };
  assert.deepEqual([hour('22').temperature, hour('22').level], [null, null]);
  assert.equal(hour('00').weatherCode, null);
  assert.deepEqual([hour('02').temperature, hour('02').weatherCode, hour('02').level], [null, null, null], 'an absent instant has no values');
  assert.equal(view.trend.length, 3, 'three runs: before 22:00, between 22:00 and 02:00, after 02:00');
  for (const path of view.trend) assert.doesNotMatch(path, /NaN/);
  // The first run stops at 21:00 (column 3 of 12) and the second starts at 23:00 (column 5).
  assert.match(view.trend[0]!, / 27\.27,[\d.]+$/); assert.match(view.trend[1]!, /^M45\.45,/);
  // A sun column beside an unknown hour is off the line and takes its known neighbour’s level.
  const beside = weather(AFTERNOON, { temperature: index => index === 4 ? null : 8 - index });
  const shaped = hourlyColumns(beside, options(AFTERNOON));
  assert.equal(shaped.columns[4]!.kind, 'sunset'); assert.equal(shaped.onTrend[4], false); assert.equal(shaped.columns[4]!.level, shaped.columns[3]!.level);
  // With no known temperature there is no line at all.
  assert.deepEqual(hourlyForecastView(weather(EVENING, { temperature: () => null }), options(EVENING)).trend, []);
});

test('the hours end where the saved forecast ends, and a lone Now is not an hourly forecast', () => {
  assert.deepEqual(labels(weather(EVENING, { count: 4 }), options(EVENING)), ['Now', '19', '20', '21']);
  const none = weather(EVENING, { count: 1 });
  assert.deepEqual(labels(none, options(EVENING)), ['Now']);
  const view = hourlyForecastView(none, options(EVENING));
  assert.deepEqual([view.columns, view.facts, view.trend], [[], [], []]);
  const missing = weather(EVENING); delete missing.details;
  assert.deepEqual(hourlyForecastView(missing, options(EVENING)).columns, []);
  // Hours more than a day ahead are not this widget's.
  const far = weather(EVENING, { start: EVENING + 30 * HOUR });
  assert.deepEqual(hourlyForecastView(far, options(EVENING)).columns, []);
});

test('an hours-old saved reading is never called Now, and the status shows only while not fresh', () => {
  const fresh = hourlyForecastView(weather(EVENING), options(EVENING));
  assert.equal(fresh.status, null);
  // Saved for two hours: Weather still presents the reading as current, so Now stays.
  const recent = hourlyForecastView(weather(EVENING, { status: 'stale', updatedAt: EVENING - 2 * HOUR }), options(EVENING));
  assert.equal(readable(recent.columns[0]!.label), 'Now'); assert.equal(readable(recent.status!), 'Saved forecast · 2 hr ago');
  // Saved for five hours: no Now; the strip starts at the next hour and still has twelve columns.
  const old = hourlyForecastView(weather(EVENING, { status: 'stale', updatedAt: EVENING - 5 * HOUR }), options(EVENING));
  assert.deepEqual(old.columns.map(column => readable(column.label)), ['19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06']);
  assert.equal(readable(old.status!), 'Saved forecast · 5 hr ago'); assert.equal(old.status, 'Saved forecast\u00a0· 5\u00a0hr\u00a0ago');
  // Offline keeps “Updated”, where a bare age could read as the outage's; an hours-old reading drops Now here too.
  assert.equal(readable(hourlyForecastView(weather(EVENING, { updatedAt: EVENING - 12 * MINUTE }), options(EVENING, { disconnected: true })).status!), 'Offline · Updated 12 min ago');
  const offline = hourlyForecastView(weather(EVENING, { updatedAt: EVENING - 4 * HOUR }), options(EVENING, { disconnected: true }));
  assert.equal(readable(offline.columns[0]!.label), '19'); assert.equal(readable(offline.status!), 'Offline · Updated 4 hr ago');
  // An unknown update time shows the status word alone.
  const unknown = weather(EVENING, { status: 'stale' }); unknown.updatedAt = null;
  assert.equal(hourlyForecastView(unknown, options(EVENING)).status, 'Saved forecast');
  assert.equal(hourlyForecastView(unknown, options(EVENING, { disconnected: true })).status, 'Offline');
  // Without a current reading there is no Now.
  const noCurrent = weather(EVENING); noCurrent.current = null;
  assert.equal(readable(hourlyForecastView(noCurrent, options(EVENING)).columns[0]!.label), '19');
});

test('trend levels use the model’s values over at least a minimum range', () => {
  assert.deepEqual(TREND_MIN_SPAN, { '°C': 5, '°F': 9 });
  // A 2° range sits centred in a 5° band: a steady evening is a nearly flat line.
  assert.deepEqual(trendLevels([10, 11, 12], '°C'), [0.3, 0.5, 0.7]);
  // A wider range fills the band; values are not rounded.
  assert.deepEqual(trendLevels([0, 2.5, 10], '°C'), [0, 0.25, 1]);
  assert.deepEqual(trendLevels([50, 59], '°F'), [0, 1]);
  assert.deepEqual(trendLevels([4, null, 4], '°C'), [0.5, null, 0.5]);
  assert.deepEqual(trendLevels([null, Number.NaN], '°C'), [null, null]);
  assert.deepEqual(trendLevels([], '°C'), []);
});

test('the trend line passes through every point, breaks at unknown values and never overshoots', () => {
  assert.deepEqual(trendPaths([0, 1]), ['M0,100C33.33,66.67 66.67,33.33 100,0']);
  assert.deepEqual(trendPaths([]), []); assert.deepEqual(trendPaths([0.5]), []); assert.deepEqual(trendPaths([null, null]), []);
  // A lone known value between unknowns draws no line.
  assert.deepEqual(trendPaths([0.2, null, 0.4, null, 0.6]), []);
  assert.equal(trendPaths([0.2, 0.3, null, 0.4, 0.5, 0.6]).length, 2);
  const levels = [0.1, 0.9, 0.9, 0.2, 0.25, 1, 0];
  const [path] = trendPaths(levels);
  const numbers = path!.match(/-?[\d.]+/g)!.map(Number);
  // Every third coordinate pair after the first is a column centre at its own level.
  const points = [[numbers[0], numbers[1]], ...Array.from({ length: levels.length - 1 }, (_, index) => [numbers[2 + index * 6 + 4], numbers[2 + index * 6 + 5]])];
  points.forEach(([x, y], index) => { assert.ok(Math.abs(x! - index * 100 / 6) < 0.01); assert.ok(Math.abs(y! - (1 - levels[index]!) * 100) < 0.01); });
  // Control points stay between the two values they join, so the curve never invents a peak or dip.
  for (let index = 0; index < levels.length - 1; index++) {
    const low = Math.min(points[index]![1]!, points[index + 1]![1]!), high = Math.max(points[index]![1]!, points[index + 1]![1]!);
    for (const control of [numbers[2 + index * 6 + 1]!, numbers[2 + index * 6 + 3]!]) assert.ok(control >= low - 0.01 && control <= high + 0.01, `segment ${index}: ${control} within ${low}–${high}`);
  }
});

test('sun events are strictly after the start, up to the end, in order', () => {
  const day = Date.parse('2026-11-22T05:00:00Z'); // midnight in Toronto
  const events = sunEvents(day, day + 48 * HOUR, TORONTO.latitude, TORONTO.longitude, 'America/Toronto');
  assert.deepEqual(events.map(event => event.kind), ['sunrise', 'sunset', 'sunrise', 'sunset']);
  assert.ok(events.every((event, index) => index === 0 || event.at > events[index - 1]!.at));
  assert.deepEqual(sunEvents(NOV_SUNSET, NOV_SUNSET + HOUR, TORONTO.latitude, TORONTO.longitude, 'America/Toronto'), [], 'an event at the start is not after it');
  assert.deepEqual(sunEvents(NOV_SUNSET - HOUR, NOV_SUNSET, TORONTO.latitude, TORONTO.longitude, 'America/Toronto'), [{ kind: 'sunset', at: NOV_SUNSET }], 'an event at the end counts');
  assert.deepEqual(nextSunEvent(AFTERNOON, TORONTO.latitude, TORONTO.longitude, 'America/Toronto'), { kind: 'sunset', at: NOV_SUNSET });
  assert.deepEqual(nextSunEvent(NOV_SUNSET, TORONTO.latitude, TORONTO.longitude, 'America/Toronto'), { kind: 'sunrise', at: NOV_NEXT_SUNRISE });
});
