// The Dynamic engine (#437) with synthetic data and a fixed clock: Date.now must never be read.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AirQualityState, AlertsState, CountdownEvent, Reminder, WeatherAlert, WeatherState } from '../shared/contracts.ts';
import {
  DYNAMIC_ROTATE_MS, DYNAMIC_SCORES, DYNAMIC_THRESHOLDS, chooseDynamic, dynamicSignals, dynamicSummary, memoizeDynamicSignals, restOfToday, rotationSlot, soundsOfficial,
  type DynamicCard, type DynamicInput, type DynamicSignals,
} from './dynamic.ts';
import { sunDay } from './astronomy.ts';

Date.now = () => { throw new Error('The Dynamic engine must use its input clock, never Date.now'); };

const MINUTE = 60_000, HOUR = 60 * MINUTE;
const TZ = 'America/Toronto';
/** Tuesday 20 October 2026, 9:30 AM in Toronto. */
const NOW = Date.parse('2026-10-20T13:30:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
type Hour = { chance?: number | null; amount?: number | null; rain?: number | null };

function weather(options: { now?: number; status?: WeatherState['status']; units?: 'metric' | 'imperial'; timezone?: string; latitude?: number; longitude?: number; updatedAt?: number | null; current?: Partial<NonNullable<WeatherState['current']>> | null; days?: Partial<WeatherState['daily'][number]>[]; hours?: (index: number) => Hour; hourCount?: number; today?: string } = {}): WeatherState {
  const now = options.now ?? NOW, start = now - now % HOUR, imperial = options.units === 'imperial';
  const today = options.today ?? '2026-10-20';
  const day = (offset: number) => { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
  return {
    status: options.status ?? 'fresh', updatedAt: options.updatedAt === null ? null : iso(options.updatedAt ?? now - 10 * MINUTE), error: null, source: 'Open-Meteo', sourceUrl: 'https://open-meteo.com/',
    location: { name: 'Sample City', latitude: options.latitude ?? 43.65, longitude: options.longitude ?? -79.38, timezone: options.timezone ?? TZ },
    units: imperial ? { temperature: '°F', windSpeed: 'mph', precipitation: 'in' } : { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' },
    current: options.current === null ? null : { time: iso(start), temperature: 14, feelsLike: 13, weatherCode: 3, isDay: true, windSpeed: 8, ...options.current },
    daily: Array.from({ length: 7 }, (_, index) => ({ date: day(index), weatherCode: 3, temperatureMax: 17, temperatureMin: 9, precipitationProbability: 10, precipitationAmount: 0, ...options.days?.[index] })),
    hourly: Array.from({ length: options.hourCount ?? 24 }, (_, index) => {
      const hour = options.hours?.(index) ?? {};
      return { intervalStart: iso(start + index * HOUR), intervalEnd: iso(start + (index + 1) * HOUR), precipitationProbability: hour.chance === undefined ? 0 : hour.chance, precipitationAmount: hour.amount === undefined ? (hour.rain ?? 0) : hour.amount, rainAmount: hour.rain === undefined ? 0 : hour.rain };
    }),
  };
}
function air(options: { aqi?: number | null; scale?: 'us' | 'european'; status?: AirQualityState['status']; updatedAt?: number; uv?: (index: number) => number | null; start?: number } = {}): AirQualityState {
  const updated = options.updatedAt ?? NOW - 12 * MINUTE, start = options.start ?? updated - updated % HOUR;
  return {
    status: options.status ?? 'fresh', updatedAt: iso(updated), error: null, source: 'CAMS via Open-Meteo', sourceUrl: 'https://open-meteo.com/en/docs/air-quality-api',
    location: { name: 'Sample City', latitude: 43.65, longitude: -79.38, timezone: TZ }, scale: options.scale ?? 'us',
    current: { time: iso(start), aqi: options.aqi === undefined ? 42 : options.aqi, dominant: 'pm2_5', pm2_5: 10, pm10: 16, uvIndex: 2 },
    hourly: Array.from({ length: 24 }, (_, index) => ({ time: iso(start + index * HOUR), aqi: options.aqi === undefined ? 42 : options.aqi, uvIndex: options.uv?.(index) ?? 2 })),
  };
}
function alert(id: string, level: WeatherAlert['level'], name: string, overrides: Partial<WeatherAlert> = {}): WeatherAlert {
  return { id, level, name, area: 'City of Toronto', issuedAt: iso(NOW - HOUR), startsAt: iso(NOW - 30 * MINUTE), endsAt: iso(NOW + 8 * HOUR), expiresAt: iso(NOW + 6 * HOUR), ...overrides };
}
function alerts(list: WeatherAlert[], status: AlertsState['status'] = 'fresh'): AlertsState {
  return { status, provider: 'eccc', source: 'Environment and Climate Change Canada', sourceUrl: 'https://weather.gc.ca/', area: 'City of Toronto', checkedAt: iso(NOW - 4 * MINUTE), error: null, alerts: list };
}
let reminderId = 0;
function reminder(dueAt: number | null, text = 'Synthetic reminder', completed = false): Reminder {
  reminderId++;
  return { id: `00000000-0000-4000-8000-${String(reminderId).padStart(12, '0')}`, text, completed, dueAt: dueAt === null ? null : iso(dueAt), createdAt: iso(NOW - 2 * 86_400_000), updatedAt: iso(NOW - 86_400_000) };
}
const countdown = (id: string, date: string, title = 'Synthetic date'): CountdownEvent => ({ id: `7a1c0d4e-0000-4000-8000-${id.padStart(12, '0')}`, title, date, repeatsYearly: false });
const ALL = { weather: true, alerts: true, air: true, sky: true, personal: true };
function input(overrides: Partial<DynamicInput> = {}): DynamicInput {
  return { weather: weather(), airQuality: air(), alerts: alerts([]), reminders: [], countdowns: [], sources: ALL, onBoard: {}, clockFormat: '12h', airScale: 'us', now: NOW, disconnected: false, localTimeZone: TZ, ...overrides };
}
const all = (signals: DynamicSignals) => [...signals.alert, ...signals.focus, ...signals.notable, ...signals.calm];
const find = (signals: DynamicSignals, id: string) => all(signals).find(card => card.id === id);
const kinds = (signals: DynamicSignals) => all(signals).map(card => card.kind);
const signal = (overrides: Partial<DynamicInput> = {}) => dynamicSignals(input(overrides));

test('each threshold fires at its value and not one step below, in metric and imperial', () => {
  for (const units of ['metric', 'imperial'] as const) {
    const t = units === 'metric' ? DYNAMIC_THRESHOLDS.metric : DYNAMIC_THRESHOLDS.imperial, step = 0.1;
    const at = (patch: Parameters<typeof weather>[0]) => signal({ weather: weather({ units, ...patch }) });
    assert.equal(find(at({ days: [{ temperatureMax: t.HEAT_HIGH }] }), 'weather:heat')?.tier, 'focus', `${units} heat`);
    assert.equal(find(at({ days: [{ temperatureMax: t.HEAT_HIGH - step }] }), 'weather:heat'), undefined);
    assert.equal(find(at({ current: { feelsLike: t.COLD_FEELS } }), 'weather:cold')?.tier, 'focus', `${units} cold`);
    assert.equal(find(at({ current: { feelsLike: t.COLD_FEELS + step } }), 'weather:cold'), undefined);
    assert.equal(find(at({ current: { windSpeed: t.WIND_STRONG } }), 'weather:wind')?.kind, 'wind-strong', `${units} strong wind`);
    assert.equal(find(at({ current: { windSpeed: t.WIND_STRONG - step } }), 'weather:wind')?.kind, 'windy');
    assert.equal(find(at({ current: { windSpeed: t.WIND_BREEZY } }), 'weather:wind')?.tier, 'notable');
    assert.equal(find(at({ current: { windSpeed: t.WIND_BREEZY - step } }), 'weather:wind'), undefined);
    assert.equal(find(at({ days: [{}, { temperatureMax: t.HEAT_HIGH }] }), 'weather:tomorrow-temp')?.kind, 'heat-tomorrow', `${units} hot tomorrow`);
    assert.equal(find(at({ days: [{}, { temperatureMax: t.HEAT_HIGH - step }] }), 'weather:tomorrow-temp'), undefined);
    assert.equal(find(at({ days: [{}, { temperatureMin: t.COLD_LOW }] }), 'weather:tomorrow-temp')?.kind, 'cold-tomorrow', `${units} very cold tomorrow`);
    assert.equal(find(at({ days: [{}, { temperatureMin: t.COLD_LOW + step }] }), 'weather:tomorrow-temp'), undefined);
  }
  assert.deepEqual([DYNAMIC_THRESHOLDS.metric.HEAT_HIGH, DYNAMIC_THRESHOLDS.imperial.HEAT_HIGH, DYNAMIC_THRESHOLDS.metric.WIND_STRONG, DYNAMIC_THRESHOLDS.imperial.WIND_STRONG], [32, 90, 50, 31]);
  // AQI on both scales: focus, notable and calm boundaries.
  const aqi = (value: number, scale: 'us' | 'european') => { const signals = signal({ airQuality: air({ aqi: value, scale }), airScale: scale }); return find(signals, 'air:aqi')?.tier ?? (find(signals, 'air:calm') ? 'calm' : 'none'); };
  assert.deepEqual([151, 150, 101, 100].map(value => aqi(value, 'us')), ['focus', 'notable', 'notable', 'calm']);
  assert.deepEqual([81, 80, 61, 60].map(value => aqi(value, 'european')), ['focus', 'notable', 'notable', 'calm']);
  assert.equal(find(signal({ airQuality: air({ aqi: 160 }) }), 'air:aqi')?.headline, 'Unhealthy air');
  assert.equal(find(signal({ airQuality: air({ aqi: 90, scale: 'european' }), airScale: 'european' }), 'air:aqi')?.headline, 'Very poor air');
  assert.equal(find(signal({ airQuality: air({ aqi: 120 }) }), 'air:aqi')?.compact, 'Sensitive groups');
  assert.equal(find(signal({ airQuality: air({ aqi: 30 }) }), 'air:calm')?.headline, 'Good air');
  // UV: rounded 6 and over among today's upcoming readings.
  assert.equal(find(signal({ airQuality: air({ uv: index => index === 3 ? 6 : 1 }) }), 'air:uv')?.headline, 'High UV today');
  assert.equal(find(signal({ airQuality: air({ uv: index => index === 3 ? 5.4 : 1 }) }), 'air:uv'), undefined);
});

test('heat stops at 18:00 in the weather city', () => {
  const hot = (now: number) => find(signal({ now, weather: weather({ now, days: [{ temperatureMax: 34 }] }) }), 'weather:heat');
  assert.ok(hot(Date.parse('2026-10-20T21:59:00Z')), '5:59 PM');
  assert.equal(hot(Date.parse('2026-10-20T22:00:00Z')), undefined, '6:00 PM');
});

const wet = (from: number, to: number, chance = 80, rain = 1) => (index: number) => index >= from && index < to ? { chance, rain } : {};

test('hazards: a condition now beats today\'s forecast of it; heavy rain gives way to a rain-now card; a dry rest of today drops it', () => {
  const now = signal({ weather: weather({ current: { weatherCode: 95 }, days: [{ weatherCode: 95 }], hours: wet(4, 8) }) });
  assert.deepEqual(all(now).filter(card => card.id === 'weather:hazard').map(card => card.kind), ['storm-now'], 'one hazard card, the condition now');
  assert.equal(find(now, 'weather:hazard')?.headline, 'Thunderstorms');
  assert.equal(find(now, 'weather:hazard')?.detail, 'Now');
  assert.equal(find(signal({ weather: weather({ current: { weatherCode: 96 } }) }), 'weather:hazard')?.compact, 'Storms with hail');
  assert.equal(find(signal({ weather: weather({ current: { weatherCode: 66 } }) }), 'weather:hazard')?.headline, 'Freezing rain', 'freezing uses the condition label');
  assert.equal(find(signal({ weather: weather({ current: { weatherCode: 75 } }) }), 'weather:hazard')?.score, DYNAMIC_SCORES.heavySnowNow);
  const today = signal({ weather: weather({ days: [{ weatherCode: 95 }], hours: wet(4, 8, 70) }) });
  const storm = find(today, 'weather:hazard')!;
  assert.deepEqual([storm.kind, storm.tier, storm.headline, storm.compact, storm.detail, storm.detailCompact], ['storm-today', 'focus', 'Thunderstorms in today’s forecast', 'Storms today', 'Up to 70% chance · rest of today', 'Up to 70% chance']);
  assert.equal(find(signal({ weather: weather({ days: [{ weatherCode: 95 }] }) }), 'weather:hazard'), undefined, 'the rest of today is dry: no storm card');
  const untimed = find(signal({ weather: weather({ days: [{ weatherCode: 95 }], hourCount: 0 }) }), 'weather:hazard')!;
  assert.deepEqual([untimed.tier, untimed.detail], ['notable', 'Timing unavailable']);
  // Heavy rain: suppressed by a rain-now or rain-soon card, shown otherwise when the rest of the day is wet.
  assert.equal(find(signal({ weather: weather({ current: { weatherCode: 65 }, hours: wet(0, 4) }) }), 'weather:hazard'), undefined, 'rain now covers it');
  const heavy = find(signal({ weather: weather({ days: [{ weatherCode: 82 }], hours: index => index >= 9 && index < 11 ? { chance: 50, rain: 2 } : index < 9 ? { chance: 35 } : {} }) }), 'weather:hazard')!;
  assert.deepEqual([heavy.kind, heavy.score], ['heavy-rain', DYNAMIC_SCORES.heavyRain]);
  assert.deepEqual(restOfToday(weather({ hours: wet(14, 16) }), NOW, TZ).wet, true, 'an evening hour of today counts');
  assert.deepEqual(restOfToday(weather({ hours: wet(15, 17) }), NOW, TZ).wet, false, 'hours after midnight are tomorrow');
});

test('rain tiers and a dry spell only for a fresh, complete forecast on a connected display', () => {
  const card = (hours: (index: number) => Hour, extra: Partial<DynamicInput> = {}) => find(signal({ weather: weather({ hours }), ...extra }), 'weather:rain');
  assert.deepEqual([card(wet(0, 3))?.kind, card(wet(0, 3))?.tier, card(wet(0, 3))?.score], ['rain-now', 'focus', DYNAMIC_SCORES.rainNow]);
  assert.match(card(wet(0, 3))!.headline, /^Rain likely until 12 PM$/, 'the spell ends at 16:00 UTC, noon in Toronto');
  const soon = card(wet(3, 6))!;
  assert.deepEqual([soon.kind, soon.tier, soon.score, soon.compact.startsWith('Rain likely')], ['rain-soon', 'focus', DYNAMIC_SCORES.rainSoon, true]);
  assert.equal(soon.provenance, 'Forecast estimate'); assert.match(soon.detail ?? '', /^Peak 80% · 3 mm rain$/);
  assert.deepEqual([card(wet(3, 6, 40))?.tier, card(wet(3, 6, 40))?.score], ['notable', DYNAMIC_SCORES.rainPossibleSoon], 'possible rain soon is notable');
  assert.deepEqual([card(wet(9, 11))?.kind, card(wet(9, 11))?.score], ['rain-later', DYNAMIC_SCORES.rainLater]);
  assert.deepEqual([card(index => index === 4 ? { chance: 40 } : {})?.kind, card(index => index === 4 ? { chance: 40 } : {})?.score], ['precipitation-possible', DYNAMIC_SCORES.precipitationPossible]);
  assert.equal(card(() => ({})), undefined, 'a dry, complete forecast has no rain card');
  assert.ok(find(signal(), 'weather:dry'), 'fresh, connected and complete: dry for 12 hours');
  assert.equal(find(signal({ weather: weather({ status: 'stale' }) }), 'weather:dry'), undefined, 'not from a saved forecast');
  assert.equal(find(signal({ disconnected: true }), 'weather:dry'), undefined, 'not while offline');
  assert.equal(find(signal({ weather: weather({ hourCount: 6 }) }), 'weather:dry'), undefined, 'not from a partial forecast');
});

test('stale and offline weather: saved-forecast age in the status tone, "As of", never "Now", and no current card once hours old', () => {
  const stale = signal({ weather: weather({ status: 'stale', updatedAt: NOW - 2 * HOUR, current: { weatherCode: 95 } }) });
  const storm = find(stale, 'weather:hazard')!;
  assert.equal(storm.detail, 'As of 7:30 AM'); assert.deepEqual(storm.age, { text: 'Saved forecast · Updated 2 hr ago', caution: true });
  assert.ok(stale.statuses.some(status => status.text === 'Saved forecast' && status.source === 'weather'));
  assert.equal(find(signal({ weather: weather({ status: 'stale', updatedAt: NOW - 4 * HOUR, current: { weatherCode: 95 } }) }), 'weather:hazard'), undefined, 'over 3 hours old: no current-based card');
  const offline = signal({ disconnected: true, weather: weather({ current: { windSpeed: 55 } }) });
  assert.equal(find(offline, 'weather:wind')!.age?.text.startsWith('Offline'), true);
  assert.match(find(offline, 'weather:wind')!.detail ?? '', /As of/);
  assert.equal(offline.statuses[0]!.text, 'Offline');
  const unavailable = signal({ weather: { ...weather(), status: 'unavailable', current: null, daily: [], hourly: [], updatedAt: null } });
  assert.equal(all(unavailable).filter(card => card.source === 'weather').length, 0);
  assert.ok(unavailable.statuses.some(status => status.text === 'Weather unavailable' && status.caution));
});

test('air: estimate and last-known readings, off and unavailable; UV from upcoming hours only', () => {
  const estimate = find(signal({ airQuality: air({ aqi: 160, status: 'stale', updatedAt: NOW - 5 * HOUR, start: NOW - 5 * HOUR - (NOW - 5 * HOUR) % HOUR }) }), 'air:aqi')!;
  assert.ok(estimate, 'over 3 hours old with this hour\'s saved estimate: still shown');
  assert.match(estimate.age!.text, /^Saved estimate/); assert.equal(estimate.age!.caution, true);
  const old = NOW - 30 * HOUR;
  const lastKnown = signal({ airQuality: air({ aqi: 160, status: 'stale', updatedAt: old, start: old - old % HOUR }) });
  assert.equal(all(lastKnown).filter(card => card.source === 'air').length, 0, 'last known: no air cards');
  assert.ok(lastKnown.statuses.some(status => status.text === 'Saved air reading'));
  const off = signal({ airQuality: { ...air(), status: 'off', current: null, hourly: [] } });
  assert.equal(all(off).filter(card => card.source === 'air').length, 0);
  assert.ok(off.statuses.some(status => status.text === 'Air quality not loaded yet' && status.smallRank === null));
  const unavailable = signal({ airQuality: { ...air(), status: 'unavailable', current: null, hourly: [] } });
  assert.ok(unavailable.statuses.some(status => status.text === 'Air quality unavailable' && status.caution));
  // A morning UV peak that has passed is never today's.
  const start = NOW - 6 * HOUR - NOW % HOUR;
  assert.equal(find(signal({ airQuality: air({ start, updatedAt: NOW - 20 * MINUTE, uv: index => index === 2 ? 8 : 2 }) }), 'air:uv'), undefined);
  assert.equal(find(signal({ airQuality: air({ start, updatedAt: NOW - 20 * MINUTE, uv: index => index === 9 ? 7 : 2 }) }), 'air:uv')?.detail, 'Peaks 7 at 12 PM');
});

test('reminders: due within an hour or overdue by up to two is focus, later today and long overdue are notable, at most three', () => {
  const tier = (due: number | null, completed = false) => all(signal({ reminders: [reminder(due, 'Synthetic', completed)] })).find(card => card.source === 'personal')?.kind ?? 'none';
  assert.equal(tier(NOW + 60 * MINUTE), 'reminder-soon');
  assert.equal(tier(NOW + 61 * MINUTE), 'reminder-today');
  assert.equal(tier(NOW - 120 * MINUTE), 'reminder-overdue-recent');
  assert.equal(tier(NOW - 121 * MINUTE), 'reminder-overdue');
  assert.equal(tier(Date.parse('2026-10-21T13:00:00Z')), 'none', 'tomorrow is not today');
  assert.equal(tier(null), 'none', 'undated');
  assert.equal(tier(NOW + 10 * MINUTE, true), 'none', 'completed');
  const overdue = all(signal({ reminders: [reminder(NOW - 30 * MINUTE, 'Synthetic overdue')] })).find(card => card.source === 'personal')!;
  assert.deepEqual([overdue.detailFlag, overdue.detail, overdue.kicker], ['Overdue', 'Today · 9 AM', 'Reminder']);
  const many = signal({ reminders: [5, 10, 20, 30, 40].map(offset => reminder(NOW + offset * MINUTE)) });
  assert.equal(all(many).filter(card => card.id.startsWith('reminder:')).length, DYNAMIC_THRESHOLDS.REMINDER_MAX_CARDS);
  assert.ok(signal({ reminders: 'broken' as unknown as Reminder[] }).statuses.some(status => status.text === 'Reminders unavailable'));
  const offline = all(signal({ disconnected: true, reminders: [reminder(NOW + 20 * MINUTE)] })).find(card => card.source === 'personal')!;
  assert.deepEqual(offline.age, { text: 'Saved reminders · offline', caution: true });
});

test('countdowns: today and tomorrow are notable, the next one at least two days away joins the calm rotation', () => {
  const signals = signal({ countdowns: [countdown('1', '2026-10-20', 'Today thing'), countdown('2', '2026-10-21', 'Tomorrow thing'), countdown('3', '2026-10-25', 'Later thing'), countdown('4', '2026-11-30')] });
  assert.deepEqual(all(signals).filter(card => card.source === 'personal').map(card => [card.kind, card.tier, card.headline]), [
    ['countdown-today', 'notable', 'Today thing'], ['countdown-tomorrow', 'notable', 'Tomorrow thing'], ['countdown-next', 'calm', 'Later thing'],
  ]);
  assert.equal(find(signals, 'countdown:next')!.detail, 'In 5 days · Sun, Oct 25');
});

test('sun and moon: a sunrise or sunset within the hour, polar wording, and the full moon tonight versus in the daytime', () => {
  const sunset = sunDay('2026-10-20', 43.65, -79.38, TZ).sunset!.getTime();
  const sky = (now: number, latitude = 43.65, longitude = -79.38, timezone = TZ) => signal({ now, weather: weather({ now, latitude, longitude, timezone, today: new Date(now).toISOString().slice(0, 10) }) });
  const moment = find(sky(sunset - 60 * MINUTE), 'sky:sun')!;
  assert.deepEqual([moment.kind, moment.tier, moment.detail], ['sun-moment', 'notable', 'In 60 min']);
  assert.match(moment.headline, /^Sunset 6:2\d\u00a0PM$/);
  assert.deepEqual([find(sky(sunset - 61 * MINUTE), 'sky:sun')!.tier, find(sky(sunset - 61 * MINUTE), 'sky:sun')!.detail], ['calm', '10 h 48 min daylight']);
  assert.equal(find(sky(Date.parse('2026-12-15T12:00:00Z'), 78.22, 15.65, 'Arctic/Longyearbyen'), 'sky:sun')!.headline, 'Sun stays down today');
  assert.equal(find(sky(Date.parse('2026-06-21T12:00:00Z'), 78.22, 15.65, 'Arctic/Longyearbyen'), 'sky:sun')!.headline, 'Sun up all day');
  // Full moon on 26 October 2026 at 04:12 UTC: just after midnight on Monday in Toronto, so "tonight" on Sunday evening.
  const tonight = find(sky(Date.parse('2026-10-26T01:00:00Z')), 'sky:moon')!;
  assert.deepEqual([tonight.kind, tonight.tier, tonight.headline], ['full-moon-tonight', 'notable', 'Full moon tonight']);
  const daytime = find(sky(Date.parse('2026-10-25T16:00:00Z')), 'sky:moon')!;
  assert.deepEqual([daytime.kind, daytime.tier], ['moon-phase', 'calm'], 'in the daytime the full moon is not "tonight" yet');
  assert.equal(find(sky(NOW), 'sky:moon')!.headline, 'Full moon Mon', 'the next full moon by weekday within the week');
  assert.equal(find(sky(Date.parse('2026-10-18T13:41:00Z'), 43.65, -79.38), 'sky:moon')!.headline, 'Full moon Oct 26', 'by date further ahead');
});

test('the calm rotation skips what the board already shows, unless that would leave nothing', () => {
  const order = (onBoard: DynamicInput['onBoard'], extra: Partial<DynamicInput> = {}) => signal({ onBoard, ...extra }).calm.map(card => card.id);
  assert.deepEqual(order({}, { countdowns: [countdown('9', '2026-11-30')] }), ['weather:conditions', 'weather:high-low', 'weather:dry', 'sky:sun', 'sky:moon', 'countdown:next', 'air:calm']);
  assert.deepEqual(order({ weather: true, airQuality: true }), ['sky:sun', 'sky:moon']);
  assert.deepEqual(order({ forecast: true, sunMoon: true }), ['weather:conditions', 'weather:dry', 'air:calm']);
  assert.deepEqual(order({ weather: true, forecast: true, sunMoon: true, airQuality: true }, { reminders: [] }), ['weather:conditions', 'weather:high-low', 'weather:dry', 'sky:sun', 'sky:moon', 'air:calm'], 'everything skipped: the full calm rotation returns');
  assert.deepEqual(order({ weather: true, forecast: true, sunMoon: true, airQuality: true }, { weather: weather({ hours: wet(9, 11) }) }), [], 'a notable card keeps the rotation from being empty');
});

test('each source switched off contributes no card and no status', () => {
  const everything = input({ alerts: alerts([alert('w', 'statement', 'Special weather statement')]), reminders: [reminder(NOW + 90 * MINUTE)], countdowns: [countdown('1', '2026-10-21')], weather: weather({ hours: wet(9, 11) }), airQuality: air({ aqi: 120 }) });
  for (const source of ['weather', 'alerts', 'air', 'sky', 'personal'] as const) {
    const signals = dynamicSignals({ ...everything, sources: { ...ALL, [source]: false } });
    assert.equal(all(signals).filter(card => card.source === source).length, 0, `${source} off`);
    assert.ok(all(dynamicSignals(everything)).some(card => card.source === source), `${source} on contributes`);
  }
  const quiet = dynamicSignals({ ...everything, weather: { ...weather(), status: 'unavailable' }, sources: { ...ALL, weather: false } });
  assert.equal(quiet.statuses.some(status => status.source === 'weather'), false);
});

test('official alerts: a warning beats everything, two take turns, watch and advisory are focus, a statement notable, an ended one is gone', () => {
  const warning = alert('w1', 'warning', 'Winter storm warning');
  const signals = signal({ alerts: alerts([warning, alert('a1', 'advisory', 'Fog advisory'), alert('s1', 'statement', 'Special weather statement'), alert('v1', 'watch', 'Snowfall watch')]), weather: weather({ current: { weatherCode: 96 } }) });
  const choice = chooseDynamic(signals, 0, null, 3);
  assert.equal(choice.mode, 'alert'); assert.equal(choice.lead!.id, 'alert:w1');
  assert.deepEqual([choice.lead!.kicker, choice.lead!.kickerCaution, choice.lead!.headline, choice.lead!.official], ['Warning', true, 'Winter storm warning', true]);
  assert.equal(choice.lead!.detail, 'Until 5:30 PM · City of Toronto');
  assert.equal(choice.lead!.provenance, 'Environment and Climate Change Canada'); assert.equal(choice.lead!.provenanceShort, 'Environment Canada');
  assert.deepEqual(choice.also.map(card => card.id), ['alert:v1', 'weather:hazard', 'alert:a1'], 'then the watch (1010), hail now (1000), the advisory (945)');
  assert.equal(find(signals, 'alert:s1')!.tier, 'notable');
  const two = signal({ alerts: alerts([warning, alert('w2', 'warning', 'Wind warning', { startsAt: iso(NOW + HOUR) })]) });
  const first = chooseDynamic(two, 10, null, 2), second = chooseDynamic(two, 11, null, 2);
  assert.deepEqual([first.lead!.id, first.position], ['alert:w1', { index: 0, count: 2 }]);
  assert.deepEqual([second.lead!.id, second.position], ['alert:w2', { index: 1, count: 2 }]);
  assert.match(find(two, 'alert:w2')!.detail ?? '', /^From 10:30 AM · Until/);
  // The client re-checks expiry each minute: a saved alert past its end is dropped at render.
  assert.equal(find(signal({ alerts: alerts([alert('old', 'warning', 'Old warning', { endsAt: iso(NOW - MINUTE) })], 'stale') }), 'alert:old'), undefined);
  assert.equal(find(signal({ alerts: alerts([alert('exp', 'watch', 'Expired watch', { expiresAt: iso(NOW) })]) }), 'alert:exp'), undefined);
  // Stale: retained alerts plus the saved-alerts phrase; fresh with none: "No alerts" for the large family only.
  const stale = signal({ alerts: alerts([warning], 'stale') });
  assert.deepEqual(find(stale, 'alert:w1')!.age, { text: 'Saved alerts · checked 9:26 AM', caution: true });
  assert.deepEqual(signal().statuses.filter(status => status.source === 'alerts').map(status => [status.text, status.largeOnly]), [['No alerts · checked 9:26 AM', true]]);
  assert.equal(signal({ alerts: alerts([warning], 'stale') }).statuses.some(status => /No alerts/.test(status.text)), false, 'no "No alerts" claim while saved');
  assert.deepEqual(signal({ alerts: { ...alerts([]), status: 'unsupported', provider: null, source: null } }).statuses.filter(status => status.source === 'alerts'), [], 'unsupported says nothing on the display');
  assert.ok(signal({ alerts: { ...alerts([]), status: 'unavailable' } }).statuses.some(status => status.text === 'Weather alerts unavailable' && status.smallRank === 1));
});

test('chooseDynamic: tie-break, modulo, the latch, a new focus card breaking it, empty and unavailable, rows and the more count', () => {
  // Tie-break: score, then the earlier start, then the id.
  const ties = signal({ reminders: [reminder(NOW + 40 * MINUTE, 'B'), reminder(NOW + 20 * MINUTE, 'A'), reminder(NOW + 20 * MINUTE, 'C')] });
  const ids = ties.focus.map(card => card.id);
  assert.deepEqual(ties.focus.map(card => card.start), [NOW + 20 * MINUTE, NOW + 20 * MINUTE, NOW + 40 * MINUTE]);
  assert.ok(ids[0]! < ids[1]!, 'equal score and start: the id decides');
  // Focus: the strongest is pinned whatever the slot; the others and the notable cards follow, then calm filler.
  const focus = signal({ weather: weather({ days: [{ weatherCode: 95 }], hours: wet(3, 7, 80) }), reminders: [reminder(NOW + 30 * MINUTE)], onBoard: { weather: true, sunMoon: true, airQuality: true } });
  for (const slot of [0, 1, 7]) assert.equal(chooseDynamic(focus, slot, null, 3).lead!.kind, 'storm-today');
  const pinned = chooseDynamic(focus, 0, null, 3);
  assert.equal(pinned.mode, 'focus'); assert.equal(pinned.more, 2, 'rain soon and the reminder');
  assert.deepEqual(pinned.also.map(card => card.kind).slice(0, 2), ['rain-soon', 'reminder-soon']);
  assert.equal(pinned.also.length, 3, 'calm filler after them, never counted as more');
  assert.equal(dynamicSummary(pinned), 'Now showing: Storms today. Next: Rain soon, Reminder due soon.');
  // Rotation: notable by score, then calm in order; slot modulo the rotation; the latch holds within a slot.
  const rotate = signal({ onBoard: { weather: true, forecast: true }, countdowns: [countdown('1', '2026-10-21')] });
  const rotation = [...rotate.notable, ...rotate.calm].map(card => card.id);
  assert.deepEqual(rotation, ['countdown:7a1c0d4e-0000-4000-8000-000000000001', 'sky:sun', 'sky:moon', 'air:calm']);
  for (let slot = 0; slot < 9; slot++) assert.equal(chooseDynamic(rotate, slot, null, 3).lead!.id, rotation[slot % rotation.length]);
  assert.deepEqual(chooseDynamic(rotate, 1, null, 3).also.map(card => card.id), ['sky:moon', 'air:calm', rotation[0]], 'the following cards, wrapping');
  assert.equal(chooseDynamic(rotate, 5, { slot: 5, id: 'air:calm' }, 3).lead!.id, 'air:calm', 'latched within the slot');
  assert.equal(chooseDynamic(rotate, 6, { slot: 5, id: 'air:calm' }, 3).lead!.id, rotation[6 % 4], 'the next slot moves on');
  assert.equal(chooseDynamic(rotate, 5, { slot: 5, id: 'gone' }, 3).lead!.id, rotation[1], 'a card that left the rotation releases the latch');
  const urgent = signal({ onBoard: { weather: true, forecast: true }, reminders: [reminder(NOW + 20 * MINUTE)] });
  assert.equal(chooseDynamic(urgent, 5, { slot: 5, id: 'air:calm' }, 3).lead!.kind, 'reminder-soon', 'a new focus card replaces the lead at once');
  // Nothing at all: unavailable when a source is degraded, empty otherwise.
  const nothing = input({ sources: { weather: false, alerts: false, air: false, sky: false, personal: true } });
  assert.deepEqual(chooseDynamic(dynamicSignals(nothing), 0, null, 3), { mode: 'empty', lead: null, also: [], more: 0, position: null });
  assert.equal(chooseDynamic(dynamicSignals({ ...nothing, reminders: 'broken' as unknown as Reminder[] }), 0, null, 3).mode, 'unavailable');
  assert.equal(chooseDynamic(dynamicSignals({ ...nothing, sources: { ...nothing.sources, personal: false, weather: true }, weather: { ...weather(), status: 'unavailable', current: null, daily: [], hourly: [] } }), 0, null, 3).mode, 'unavailable');
  assert.equal(dynamicSummary(chooseDynamic(dynamicSignals(nothing), 0, null, 3)), 'Nothing to show yet.');
});

test('rotationSlot: one slot per DYNAMIC_ROTATE_MS of wall time; embedded canvases hold slot 0', () => {
  assert.equal(DYNAMIC_ROTATE_MS, 60_000);
  const start = 29_000_000 * DYNAMIC_ROTATE_MS;
  assert.equal(rotationSlot(start, false), 29_000_000);
  assert.equal(rotationSlot(start + DYNAMIC_ROTATE_MS - 1, false), 29_000_000);
  assert.equal(rotationSlot(start + DYNAMIC_ROTATE_MS, false), 29_000_001);
  assert.equal(rotationSlot(start + 5 * DYNAMIC_ROTATE_MS + 30_000, true), 0);
});

test('time zones and formats: Asia/Tokyo with the 24-hour clock, and a daylight-saving change inside a rain spell', () => {
  const tokyo = find(signal({ clockFormat: '24h', weather: weather({ timezone: 'Asia/Tokyo', today: '2026-10-20', hours: wet(3, 6) }) }), 'weather:rain')!;
  assert.equal(tokyo.headline.replace(/⁠/g, ''), 'Rain likely 01:00–04:00', '22:30 in Tokyo, rain from 1 to 4 AM');
  // 1 November 2026: Toronto falls back at 2 AM EDT. A spell from 1 AM EDT to 3 AM EST reads in wall-clock times.
  const now = Date.parse('2026-11-01T04:30:00Z');
  const dst = find(signal({ now, weather: weather({ now, today: '2026-11-01', hours: wet(1, 4) }) }), 'weather:rain')!;
  assert.equal(dst.headline.replace(/⁠/g, ''), 'Rain likely 1–3 AM');
  const reminder24 = all(signal({ clockFormat: '24h', reminders: [reminder(NOW + 30 * MINUTE)] })).find(card => card.source === 'personal')!;
  assert.equal(reminder24.time, '10:00');
});

test('wording guard: no forecast, model or personal card ever sounds official; official cards keep the provider\'s words', () => {
  const scenarios: Partial<DynamicInput>[] = [
    { weather: weather({ current: { weatherCode: 96, windSpeed: 60, feelsLike: -30 }, days: [{ weatherCode: 95, temperatureMax: 35 }, { weatherCode: 66, temperatureMin: -25 }], hours: wet(0, 3) }) },
    { weather: weather({ current: { weatherCode: 75, windSpeed: 40 }, days: [{ weatherCode: 82 }, { weatherCode: 75, temperatureMax: 33 }], hours: wet(3, 6, 40) }), airQuality: air({ aqi: 220, uv: () => 9 }) },
    { weather: weather({ hours: wet(9, 11) }), airQuality: air({ aqi: 120 }) },
    { weather: weather({ days: [{ weatherCode: 82 }], hours: index => index >= 9 && index < 11 ? { chance: 50, rain: 2 } : index < 9 ? { chance: 35 } : {} }) },
    { weather: weather({ days: [{ weatherCode: 95 }], hourCount: 0 }), airQuality: air({ aqi: 70, scale: 'european' }), airScale: 'european', reminders: [reminder(NOW - 30 * MINUTE)] },
    { weather: weather({ hours: index => index === 2 ? { chance: 40 } : {} }), reminders: [reminder(NOW + 30 * MINUTE), reminder(NOW - 5 * HOUR), reminder(NOW + 3 * HOUR)], countdowns: [countdown('1', '2026-10-20'), countdown('2', '2026-10-21'), countdown('3', '2026-11-02')] },
    { now: Date.parse('2026-10-20T21:30:00Z'), weather: weather({ now: Date.parse('2026-10-20T21:30:00Z') }) },
    { now: Date.parse('2026-10-26T01:00:00Z'), weather: weather({ now: Date.parse('2026-10-26T01:00:00Z'), today: '2026-10-25' }) },
    { weather: weather({ status: 'stale', updatedAt: NOW - 2 * HOUR }), disconnected: true },
  ];
  const seen = new Set<string>();
  for (const scenario of scenarios) for (const card of all(signal(scenario))) {
    seen.add(card.kind);
    if (card.official) continue;
    for (const text of [card.kicker, card.headline, card.compact, card.detail ?? '', card.detailCompact ?? '', card.detailFlag ?? '', card.provenance ?? '', card.label, card.age?.text ?? '']) {
      assert.equal(soundsOfficial(text), false, `${card.kind}: "${text}" must not sound official`);
    }
  }
  for (const kind of ['hail-now', 'storm-today', 'heavySnow-now', 'heavy-rain', 'rain-now', 'rain-soon', 'rain-later', 'precipitation-possible', 'freezing-tomorrow', 'heavySnow-tomorrow', 'wind-strong', 'windy', 'cold-feels', 'heat-today', 'heat-tomorrow', 'cold-tomorrow', 'air-unhealthy', 'air-sensitive', 'air-calm', 'uv-high', 'reminder-soon', 'reminder-overdue-recent', 'reminder-overdue', 'reminder-today', 'countdown-today', 'countdown-tomorrow', 'countdown-next', 'sun-moment', 'sun-next', 'full-moon-tonight', 'moon-phase', 'conditions', 'high-low', 'dry']) {
    assert.ok(seen.has(kind), `the guard covers ${kind}`);
  }
  assert.equal(soundsOfficial('Winter storm warning'), true, 'the guard itself works');
  const official = find(signal({ alerts: alerts([alert('w', 'warning', 'Winter storm warning')]) }), 'alert:w')!;
  assert.equal(official.headline, 'Winter storm warning', 'the provider\'s name, verbatim');
});

test('deterministic, and memoized on input identities and the minute', () => {
  const value = input({ reminders: [reminder(NOW + 20 * MINUTE)], alerts: alerts([alert('w', 'watch', 'Snowfall watch')]) });
  assert.deepEqual(dynamicSignals(value), dynamicSignals(structuredClone(value)));
  const memo = memoizeDynamicSignals();
  const first = memo(value);
  assert.equal(memo({ ...value, now: NOW + 29_000 }), first, 'the same minute and inputs: the same result object');
  assert.notEqual(memo({ ...value, now: NOW + 60_000 }), first, 'a new minute recomputes');
  assert.notEqual(memo({ ...value, now: NOW + 60_000, weather: weather() }), memo({ ...value, now: NOW + 60_000 }), 'new data recomputes');
});

test('every card names a source word, a tone and a label', () => {
  const signals = signal({ alerts: alerts([alert('w', 'warning', 'Winter storm warning')]), reminders: [reminder(NOW + 20 * MINUTE)], countdowns: [countdown('1', '2026-10-21')], airQuality: air({ uv: () => 7 }) });
  const words: Record<DynamicCard['source'], string[]> = { weather: ['Weather'], air: ['Air quality', 'UV index'], sky: ['Sun & moon'], personal: ['Reminder', 'Countdown'], alerts: ['Warning', 'Watch', 'Advisory', 'Statement'] };
  for (const card of all(signals)) {
    assert.ok(words[card.source].includes(card.kicker), `${card.id} kicker ${card.kicker}`);
    assert.ok(['water', 'sun', 'time', 'personal', 'sky'].includes(card.tone), `${card.id} tone`);
    assert.ok(card.label.length > 0);
  }
});
