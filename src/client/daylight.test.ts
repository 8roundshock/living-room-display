// Follow daylight brightness (#439, curve from #591): fixed instants (fake time) at fixed places.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sunAltitude, sunDay } from './astronomy.ts';
import {
  DAYLIGHT_DAWN_DEGREES, DAYLIGHT_DIM_RAMP_MINUTES, DAYLIGHT_EVENING_LEVEL, DAYLIGHT_FULL_DEGREES, DAYLIGHT_STEP_MS,
  daylightCurve, daylightLevel, daylightStatus, daylightStep, daylightTerm, daylightTimeZone, defaultDaylightRange, dimTimeLabel, effectiveBrightness,
} from './daylight.ts';
import { DEFAULT_DIM_TIME, DIM_TIMES, dimTimeMinutes, isDimTime } from '../shared/daylight.ts';

interface Place { latitude: number; longitude: number; zone: string }
const TORONTO: Place = { latitude: 43.6532, longitude: -79.3832, zone: 'America/Toronto' };
const TROMSO: Place = { latitude: 69.6492, longitude: 18.9553, zone: 'Europe/Oslo' };
const REYKJAVIK: Place = { latitude: 64.1466, longitude: -21.9426, zone: 'Atlantic/Reykjavik' };
const ANCHORAGE: Place = { latitude: 61.2181, longitude: -149.9003, zone: 'America/Anchorage' };
const QUITO: Place = { latitude: -0.18, longitude: -78.47, zone: 'America/Guayaquil' };
const SYDNEY: Place = { latitude: -33.8688, longitude: 151.2093, zone: 'Australia/Sydney' };
const RANGE = { dimmest: 0.2, brightest: 0.8, dimTime: '23:00' };
const MINUTE = 60_000, HOUR = 3_600_000;
const following = { brightness: 0.55, daylightBrightness: RANGE };
const fixed = { brightness: 0.55, daylightBrightness: null };
/** Instants from `from` to `to` (inclusive) every `step` minutes. */
function instants(from: Date | number, to: Date | number, step = 1): Date[] {
  const start = typeof from === 'number' ? from : from.getTime(), end = typeof to === 'number' ? to : to.getTime();
  const result: Date[] = [];
  for (let ms = start; ms <= end; ms += step * MINUTE) result.push(new Date(ms));
  return result;
}
const fraction = (place: Place, at: Date | string | number, dimTime: string | null = '23:00') =>
  daylightCurve(new Date(at), place.latitude, place.longitude, dimTime, place.zone).fraction;
const near = (actual: number, expected: number, tolerance: number, label: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual}, expected ${expected} ± ${tolerance}`);
const minutesBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / MINUTE;
/** The first minute at or after `from` where the sun's elevation has crossed `degrees` in the given direction. */
function sunReaches(place: Place, from: Date, degrees: number, rising: boolean): Date {
  for (const at of instants(from, from.getTime() + 14 * HOUR)) {
    const altitude = sunAltitude(at, place.latitude, place.longitude);
    if (rising ? altitude >= degrees : altitude <= degrees) return at;
  }
  throw new Error('the sun does not reach that elevation');
}

test('Fixed brightness is the saved level at every hour, exactly as before', () => {
  for (const at of instants(Date.parse('2026-10-20T00:00:00Z'), Date.parse('2026-10-21T00:00:00Z'), 60)) {
    assert.equal(effectiveBrightness(fixed, TORONTO, at, TORONTO.zone), 0.55);
    assert.equal(effectiveBrightness(fixed, TROMSO, at, TROMSO.zone), 0.55);
  }
});

test('Toronto in early November: Brightest soon after sunrise, the evening level until 11 PM, then Dimmest', () => {
  // 2026-11-09 (EST, UTC−5): sunrise 7:04 AM, sunset 4:58 PM.
  const day = sunDay('2026-11-09', TORONTO.latitude, TORONTO.longitude);
  near(minutesBetween(new Date('2026-11-09T12:04:00Z'), day.sunrise!), 0, 1.5, 'sunrise');
  near(minutesBetween(new Date('2026-11-09T21:58:00Z'), day.sunset!), 0, 1.5, 'sunset');
  // Night until civil dawn (6:35 AM).
  for (const local of ['00:00', '03:00', '06:00', '06:30']) assert.equal(fraction(TORONTO, `2026-11-09T${local}:00-05:00`), 0, `${local} is Dimmest`);
  // Through dawn: under half way at sunrise, at Brightest 36 minutes later, and then all day.
  near(fraction(TORONTO, day.sunrise!), 0.45, 0.02, 'at sunrise');
  assert.ok(fraction(TORONTO, day.sunrise!.getTime() + 20 * MINUTE) > 0.85, '20 minutes after sunrise');
  assert.ok(fraction(TORONTO, day.sunrise!.getTime() + 30 * MINUTE) > 0.97, '30 minutes after sunrise');
  for (const local of ['07:45', '09:00', '12:00', '15:00', '16:00']) assert.equal(fraction(TORONTO, `2026-11-09T${local}:00-05:00`), 1, `${local} is Brightest`);
  // Dusk eases to the evening level, never below it.
  const sunset = fraction(TORONTO, day.sunset!);
  assert.ok(sunset > 0.78 && sunset < 0.84, `at sunset ${sunset}`);
  for (const local of ['17:35', '18:00', '20:00', '22:00', '23:00']) near(fraction(TORONTO, `2026-11-09T${local}:00-05:00`), DAYLIGHT_EVENING_LEVEL, 1e-9, `${local} holds the evening level`);
  // The dim time: half way down after 15 minutes, Dimmest after 30, and through the night.
  near(fraction(TORONTO, '2026-11-09T23:15:00-05:00'), DAYLIGHT_EVENING_LEVEL / 2, 1e-9, '11:15 PM');
  for (const local of ['2026-11-09T23:30', '2026-11-10T00:00', '2026-11-10T03:00', '2026-11-10T06:00']) assert.equal(fraction(TORONTO, `${local}:00-05:00`), 0, `${local} is Dimmest`);
  // With a 20–80% range.
  assert.equal(effectiveBrightness(following, TORONTO, Date.parse('2026-11-09T15:00:00Z'), TORONTO.zone), 0.8);
  assert.equal(effectiveBrightness(following, TORONTO, Date.parse('2026-11-10T01:00:00Z'), TORONTO.zone), 0.59, '8 PM: 20% + 0.65 · 60%');
  assert.equal(effectiveBrightness(following, TORONTO, Date.parse('2026-11-10T08:00:00Z'), TORONTO.zone), 0.2);
});

test('Toronto at the solstices and equinoxes: the same shape, anchored to that day’s dawn and dusk', () => {
  for (const [date, offset] of [['2026-03-20', '-04:00'], ['2026-06-21', '-04:00'], ['2026-09-22', '-04:00'], ['2026-12-21', '-05:00']] as const) {
    const day = sunDay(date, TORONTO.latitude, TORONTO.longitude);
    const dawn = sunReaches(TORONTO, new Date(day.solarNoon.getTime() - 12 * HOUR), DAYLIGHT_DAWN_DEGREES, true);
    const full = sunReaches(TORONTO, dawn, DAYLIGHT_FULL_DEGREES, true);
    const lowering = sunReaches(TORONTO, day.solarNoon, DAYLIGHT_FULL_DEGREES, false);
    const dusk = sunReaches(TORONTO, day.solarNoon, DAYLIGHT_DAWN_DEGREES, false);
    const dim = new Date(`${date}T23:00:00${offset}`);
    // Brightest 30 to 50 minutes after sunrise (the low winter sun climbs slowest), about an hour after dawn begins.
    const afterSunrise = minutesBetween(day.sunrise!, full), afterDawn = minutesBetween(dawn, full);
    assert.ok(afterSunrise >= 30 && afterSunrise <= 50, `${date}: Brightest ${afterSunrise} min after sunrise`);
    assert.ok(afterDawn >= 55 && afterDawn <= 85, `${date}: dawn takes ${afterDawn} min`);
    assert.equal(fraction(TORONTO, dawn.getTime() - MINUTE), 0, `${date}: Dimmest before dawn`);
    assert.ok(fraction(TORONTO, day.sunrise!) > 0.4, `${date}: already well up at sunrise`);
    for (const at of instants(full, lowering.getTime() - MINUTE, 15)) assert.equal(fraction(TORONTO, at), 1, `${date}: Brightest all day at ${at.toISOString()}`);
    for (const at of instants(dusk, dim, 5)) near(fraction(TORONTO, at), DAYLIGHT_EVENING_LEVEL, 1e-9, `${date}: evening level at ${at.toISOString()}`);
    near(fraction(TORONTO, dim.getTime() + 15 * MINUTE), DAYLIGHT_EVENING_LEVEL / 2, 1e-9, `${date}: half way down`);
    const nextDawn = sunReaches(TORONTO, new Date(day.solarNoon.getTime() + 12 * HOUR), DAYLIGHT_DAWN_DEGREES, true);
    for (const at of instants(dim.getTime() + DAYLIGHT_DIM_RAMP_MINUTES * MINUTE, nextDawn.getTime() - MINUTE, 5)) assert.equal(fraction(TORONTO, at), 0, `${date}: Dimmest at ${at.toISOString()}`);
    // Never falling from the end of the night to Brightest, never rising from solar noon to the end of the dim ramp.
    const rise = instants(dawn.getTime() - HOUR, day.solarNoon).map(at => fraction(TORONTO, at));
    const fall = instants(day.solarNoon, dim.getTime() + HOUR).map(at => fraction(TORONTO, at));
    rise.slice(1).forEach((value, index) => assert.ok(value >= rise[index]!, `${date} morning dips at minute ${index + 1}`));
    fall.slice(1).forEach((value, index) => assert.ok(value <= fall[index]!, `${date} evening rises at minute ${index + 1}`));
  }
  // The morning follows the season: at 7 AM the June display is at Brightest, December's still at Dimmest.
  assert.equal(fraction(TORONTO, '2026-06-21T07:00:00-04:00'), 1);
  assert.equal(fraction(TORONTO, '2026-12-21T07:00:00-05:00'), 0);
});

test('a minute never changes the value by more than a few percent of the range: no jump anywhere in a day', () => {
  const cases: [Place, string[], string[], number][] = [
    // 11 PM and later: dawn, dusk and the dim ramp each stay under 3.5%. 2026-03-08 and 2026-11-01 are Toronto's clock changes.
    [TORONTO, ['2026-03-08', '2026-03-20', '2026-06-21', '2026-09-22', '2026-11-01', '2026-11-09', '2026-12-21'], ['23:00', '00:00', '02:30', '03:00'], 0.035],
    [TROMSO, ['2026-01-19', '2026-03-20', '2026-05-17', '2026-06-21', '2026-08-16', '2026-11-25', '2026-12-21'], ['23:00', '00:00', '03:00'], 0.035],
    [REYKJAVIK, ['2026-03-20', '2026-06-21', '2026-08-05', '2026-12-21'], ['23:00', '00:00', '03:00'], 0.035],
    [ANCHORAGE, ['2026-03-12', '2026-06-21', '2026-08-04', '2026-12-21'], ['23:00', '00:00', '03:00'], 0.035],
    [QUITO, ['2026-03-20', '2026-06-21', '2026-09-22', '2026-12-21'], ['23:00', '03:00'], 0.035],
    // An early dim time can meet dusk: both fall together, still under 4.2%.
    [TORONTO, ['2026-08-26', '2026-06-21'], ['20:00', '21:00'], 0.042],
    [SYDNEY, ['2026-01-25', '2026-12-21'], ['20:00', '20:30'], 0.042],
    // A time zone that does not belong to the longitude must not open a jump either.
    [{ ...TORONTO, zone: 'Asia/Tokyo' }, ['2026-06-21', '2026-12-21'], ['20:00', '23:00', '03:00'], 0.042],
    [{ ...SYDNEY, zone: 'America/Anchorage' }, ['2026-06-21', '2026-12-21'], ['20:00', '23:00', '03:00'], 0.042],
  ];
  for (const [place, dates, dimTimes, limit] of cases) for (const date of dates) for (const dimTime of dimTimes) {
    // 36 hours, so each run crosses a solar midnight, a noon and the following dim time.
    const start = Date.parse(`${date}T00:00:00Z`);
    let previous = fraction(place, start, dimTime);
    for (const at of instants(start + MINUTE, start + 36 * HOUR)) {
      const value = fraction(place, at, dimTime);
      assert.ok(Math.abs(value - previous) <= limit, `${place.zone} ${date} dim ${dimTime} at ${at.toISOString()}: ${previous} → ${value}`);
      previous = value;
    }
  }
});

test('a dim time after midnight belongs to the evening before', () => {
  // 12:30 AM: the evening level through midnight, Dimmest from 1 AM, and the next evening is lit again.
  for (const local of ['2026-11-09T23:30', '2026-11-10T00:00', '2026-11-10T00:30']) near(fraction(TORONTO, `${local}:00-05:00`, '00:30'), DAYLIGHT_EVENING_LEVEL, 1e-9, local);
  near(fraction(TORONTO, '2026-11-10T00:45:00-05:00', '00:30'), DAYLIGHT_EVENING_LEVEL / 2, 1e-9, '12:45 AM');
  for (const local of ['01:00', '03:00', '06:00']) assert.equal(fraction(TORONTO, `2026-11-10T${local}:00-05:00`, '00:30'), 0, local);
  near(fraction(TORONTO, '2026-11-10T20:00:00-05:00', '00:30'), DAYLIGHT_EVENING_LEVEL, 1e-9, 'the next evening');
  // Midnight and 3 AM, the latest choice.
  near(fraction(TORONTO, '2026-11-10T00:00:00-05:00', '00:00'), DAYLIGHT_EVENING_LEVEL, 1e-9, 'midnight itself');
  assert.equal(fraction(TORONTO, '2026-11-10T00:30:00-05:00', '00:00'), 0);
  near(fraction(TORONTO, '2026-11-10T03:00:00-05:00', '03:00'), DAYLIGHT_EVENING_LEVEL, 1e-9, '3 AM');
  assert.equal(fraction(TORONTO, '2026-11-10T03:30:00-05:00', '03:00'), 0);
  // An early choice: 8 PM.
  near(fraction(TORONTO, '2026-11-09T20:00:00-05:00', '20:00'), DAYLIGHT_EVENING_LEVEL, 1e-9, '8 PM');
  assert.equal(fraction(TORONTO, '2026-11-09T20:30:00-05:00', '20:00'), 0);
  // The dim time is the weather location's clock, whatever the season's offset: 11 PM EDT in June.
  near(fraction(TORONTO, '2026-06-21T23:00:00-04:00'), DAYLIGHT_EVENING_LEVEL, 1e-9, '11 PM EDT');
  assert.equal(fraction(TORONTO, '2026-06-21T23:30:00-04:00'), 0);
  // Sydney's own clock (AEDT, UTC+11).
  near(fraction(SYDNEY, '2026-12-21T23:00:00+11:00'), DAYLIGHT_EVENING_LEVEL, 1e-9, 'Sydney 11 PM');
  assert.equal(fraction(SYDNEY, '2026-12-21T23:30:00+11:00'), 0);
  assert.equal(fraction(SYDNEY, '2026-12-21T13:00:00+11:00'), 1);
});

test('a range without a usable dim time reads as 11 PM', () => {
  for (const dimTime of [null, '', '23:15', '12:00', 'late']) {
    for (const local of ['2026-11-09T22:00', '2026-11-09T23:15', '2026-11-10T02:00']) {
      assert.equal(fraction(TORONTO, `${local}:00-05:00`, dimTime), fraction(TORONTO, `${local}:00-05:00`, '23:00'), `${dimTime} at ${local}`);
    }
  }
  assert.equal(DEFAULT_DIM_TIME, '23:00');
  assert.ok(isDimTime('23:00') && isDimTime('00:00') && isDimTime('20:00') && isDimTime('03:00'), 'the default, midnight and both ends are choices');
  assert.ok(!isDimTime('19:30') && !isDimTime('03:30') && !isDimTime('23:15') && !isDimTime('7:00') && !isDimTime(23));
  assert.deepEqual([DIM_TIMES.length, DIM_TIMES[0], DIM_TIMES.at(-1)], [15, '20:00', '03:00']);
  assert.deepEqual(['20:00', '00:00', '03:00', 'x'].map(dimTimeMinutes), [1200, 0, 180, 1380]);
  assert.deepEqual([dimTimeLabel('23:00', '12h'), dimTimeLabel('23:00', '24h'), dimTimeLabel('00:00', '12h'), dimTimeLabel('00:00', '24h'), dimTimeLabel('00:30', '12h'), dimTimeLabel('20:30', '12h')],
    ['11:00 PM', '23:00', '12:00 AM (midnight)', '00:00 (midnight)', '12:30 AM', '8:30 PM']);
});

test('daylight wins: a dim time that arrives while it is light dims with the dusk instead', () => {
  // Reykjavik, 2026-08-01 (UTC all year): the sun sets about 22:30 and civil dusk is after midnight.
  const day = sunDay('2026-08-01', REYKJAVIK.latitude, REYKJAVIK.longitude);
  const dim = Date.parse('2026-08-01T23:00:00Z');
  const altitude = sunAltitude(new Date(dim), REYKJAVIK.latitude, REYKJAVIK.longitude);
  assert.ok(altitude > DAYLIGHT_DAWN_DEGREES && altitude < 0, `twilight at the dim time: ${altitude}°`);
  // Once the ramp has finished the display is exactly as bright as the twilight, and reaches Dimmest at dusk.
  for (const at of instants(dim + 30 * MINUTE, dim + 3 * HOUR, 10)) {
    assert.equal(fraction(REYKJAVIK, at), daylightTerm(sunAltitude(at, REYKJAVIK.latitude, REYKJAVIK.longitude)), at.toISOString());
  }
  assert.ok(fraction(REYKJAVIK, dim + 30 * MINUTE) > 0.02, 'still above Dimmest when the ramp ends');
  const status = daylightStatus({ ...RANGE }, REYKJAVIK, Date.parse('2026-08-01T18:00:00Z'), REYKJAVIK.zone);
  assert.equal(status.dims, 'dusk');
  assert.ok(status.dimAt.getTime() > dim && status.dimAt.getTime() < day.solarNoon.getTime() + 12 * HOUR, status.dimAt.toISOString());
  near(sunAltitude(status.dimAt, REYKJAVIK.latitude, REYKJAVIK.longitude), DAYLIGHT_DAWN_DEGREES, 0.01, 'dusk is the −6° crossing');
  assert.equal(fraction(REYKJAVIK, status.dimAt.getTime() + MINUTE), 0);
  // At the June solstice it never gets that dark: the display stays above Dimmest all night.
  const june = daylightStatus({ ...RANGE }, REYKJAVIK, Date.parse('2026-06-21T18:00:00Z'), REYKJAVIK.zone);
  assert.equal(june.dims, 'never');
  const night = instants(Date.parse('2026-06-21T12:00:00Z'), Date.parse('2026-06-22T12:00:00Z'), 5).map(at => fraction(REYKJAVIK, at));
  assert.ok(Math.min(...night) > 0.1, `lowest ${Math.min(...night)}`);
  // While the sun is 5° up the display is at Brightest, whatever the clock says: Tromsø at 11:30 PM on 2026-05-30.
  const midnightSun = new Date('2026-07-10T08:00:00Z');
  assert.ok(sunAltitude(midnightSun, TROMSO.latitude, TROMSO.longitude) > DAYLIGHT_FULL_DEGREES);
  for (const dimTime of DIM_TIMES) assert.equal(fraction(TROMSO, midnightSun, dimTime), 1);
});

test('a dawn that begins before the dim ramp ends blends with it', () => {
  // Tromsø, 2026-04-25 (CEST, UTC+2), dimming at 3 AM: civil dawn is already under way.
  const dim = Date.parse('2026-04-25T03:00:00+02:00');
  const during = new Date(dim + 20 * MINUTE);
  const curve = daylightCurve(during, TROMSO.latitude, TROMSO.longitude, '03:00', TROMSO.zone);
  assert.ok(curve.evening > 0 && curve.evening < DAYLIGHT_EVENING_LEVEL && curve.daylight > 0 && curve.daylight < 1, JSON.stringify(curve));
  near(curve.fraction, curve.evening + (1 - curve.evening) * curve.daylight, 1e-12, 'both terms count');
  let previous = fraction(TROMSO, dim - HOUR, '03:00');
  for (const at of instants(dim - HOUR + MINUTE, dim + 4 * HOUR)) {
    const value = fraction(TROMSO, at, '03:00');
    assert.ok(Math.abs(value - previous) <= 0.035, `${at.toISOString()}: ${previous} → ${value}`);
    previous = value;
  }
  assert.equal(fraction(TROMSO, dim + 4 * HOUR, '03:00'), 1, 'and the morning arrives at Brightest');
});

test('Tromsø polar day in June: Brightest while the sun is 5° up, a little lower around solar midnight', () => {
  const day = sunDay('2026-06-21', TROMSO.latitude, TROMSO.longitude);
  assert.equal(day.polar, 'day');
  const values = instants(day.solarNoon.getTime() - 12 * HOUR, day.solarNoon.getTime() + 12 * HOUR, 10).map(at => fraction(TROMSO, at));
  // The midnight sun is 3° up: the daylight term alone keeps the display at 90% of the range.
  assert.ok(Math.min(...values) > 0.85, `lowest ${Math.min(...values)}`);
  assert.equal(fraction(TROMSO, day.solarNoon), 1);
  const status = daylightStatus({ ...RANGE }, TROMSO, day.solarNoon, TROMSO.zone);
  assert.deepEqual([status.polar, status.full, status.dims], ['day', true, 'never']);
});

test('Tromsø polar night in December: Dimmest in the morning, the evening level from midday to the dim time', () => {
  const day = sunDay('2026-12-21', TROMSO.latitude, TROMSO.longitude);
  assert.equal(day.polar, 'night');
  // CET, UTC+1. No dawn: Dimmest until the evening term returns over the two hours before solar noon (11:43).
  for (const local of ['01:00', '06:00', '08:00', '09:00']) assert.equal(fraction(TROMSO, `2026-12-21T${local}:00+01:00`), 0, local);
  const noon = fraction(TROMSO, day.solarNoon);
  // Civil twilight at noon (the sun 3° below the horizon) adds a little to the evening level.
  assert.ok(noon > DAYLIGHT_EVENING_LEVEL && noon < 0.75, `solar noon ${noon}`);
  for (const local of ['15:00', '18:00', '23:00']) near(fraction(TROMSO, `2026-12-21T${local}:00+01:00`), DAYLIGHT_EVENING_LEVEL, 1e-9, local);
  assert.equal(fraction(TROMSO, '2026-12-21T23:30:00+01:00'), 0);
  const all = instants(Date.parse('2026-12-21T00:00:00Z'), Date.parse('2026-12-22T00:00:00Z'), 10).map(at => fraction(TROMSO, at));
  assert.ok(Math.max(...all) < 0.75, `never near Brightest: ${Math.max(...all)}`);
  const status = daylightStatus({ ...RANGE }, TROMSO, Date.parse('2026-12-21T10:45:00Z'), TROMSO.zone);
  assert.deepEqual([status.polar, status.full, status.fullAt, status.dims], ['night', false, null, 'time']);
  assert.equal(status.dimAt.toISOString(), '2026-12-21T22:00:00.000Z');
});

test('a low sun (under 5° at noon) peaks below Brightest instead of flashing to it', () => {
  // Tromsø a few days after the polar night: the sun clears the horizon for about an hour.
  const day = sunDay('2026-01-19', TROMSO.latitude, TROMSO.longitude);
  assert.equal(day.polar, null);
  const peak = fraction(TROMSO, day.solarNoon);
  assert.ok(peak > 0.8 && peak < 0.95, `peak ${peak}`);
  for (const at of instants(day.solarNoon.getTime() - 6 * HOUR, day.solarNoon.getTime() + 6 * HOUR, 5)) assert.ok(fraction(TROMSO, at) <= peak + 1e-12);
  const status = daylightStatus({ ...RANGE }, TROMSO, day.solarNoon, TROMSO.zone);
  assert.deepEqual([status.full, status.fullAt], [false, null], 'the next solar day stays low too');
});

test('the status reports when the display is at Brightest and when it next dims', () => {
  const at = (iso: string) => daylightStatus({ ...RANGE }, TORONTO, Date.parse(iso), TORONTO.zone);
  // 3 AM: this morning's arrival at Brightest (7:40 AM EST) and tonight's dim time.
  const night = at('2026-11-09T03:00:00-05:00');
  assert.deepEqual([night.full, night.dims, night.brightness, night.eveningBrightness], [false, 'time', 0.2, 0.59]);
  near(minutesBetween(new Date('2026-11-09T07:40:00-05:00'), night.fullAt!), 0, 1, 'Brightest from');
  near(sunAltitude(night.fullAt!, TORONTO.latitude, TORONTO.longitude), DAYLIGHT_FULL_DEGREES, 0.01, 'the 5° crossing');
  assert.equal(night.dimAt.toISOString(), '2026-11-10T04:00:00.000Z');
  // 10 AM: at Brightest since that same instant.
  const morning = at('2026-11-09T10:00:00-05:00');
  assert.deepEqual([morning.full, morning.brightness, morning.fullAt!.getTime(), morning.dimAt.getTime()], [true, 0.8, night.fullAt!.getTime(), night.dimAt.getTime()]);
  // 8 PM: tomorrow morning's arrival, tonight's dim time.
  const evening = at('2026-11-09T20:00:00-05:00');
  assert.deepEqual([evening.full, evening.brightness, evening.dimAt.getTime()], [false, 0.59, night.dimAt.getTime()]);
  near(minutesBetween(new Date('2026-11-10T07:41:00-05:00'), evening.fullAt!), 0, 1.5, 'tomorrow');
  // During the ramp the dim time is still tonight's; once at Dimmest it is the next one.
  assert.equal(at('2026-11-09T23:20:00-05:00').dimAt.getTime(), night.dimAt.getTime());
  const after = at('2026-11-09T23:45:00-05:00');
  assert.equal(after.dimAt.toISOString(), '2026-11-11T04:00:00.000Z');
  assert.equal(after.fullAt!.getTime(), evening.fullAt!.getTime());
  assert.equal(at('2026-11-10T03:00:00-05:00').dimAt.toISOString(), '2026-11-11T04:00:00.000Z');
  // A dim time after midnight is reported on its own date.
  assert.equal(daylightStatus({ ...RANGE, dimTime: '00:30' }, TORONTO, Date.parse('2026-11-09T20:00:00-05:00'), TORONTO.zone).dimAt.toISOString(), '2026-11-10T05:30:00.000Z');
});

test('the dim time is read in the location zone, else the forecast zone, else this computer’s', () => {
  assert.equal(daylightTimeZone('America/Toronto', 'Europe/Oslo'), 'America/Toronto');
  assert.equal(daylightTimeZone('auto', 'Europe/Oslo'), 'Europe/Oslo');
  const computer = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  for (const unresolved of ['auto', null, undefined, 'Not/A_Zone']) assert.equal(daylightTimeZone('auto', unresolved), computer);
});

test('the value changes at most once a minute: every reader in a minute agrees', () => {
  // 7:20 AM EST on 2026-11-09, in the middle of dawn.
  const start = Date.parse('2026-11-09T12:20:00Z');
  assert.equal(daylightStep(start + 59_999).getTime(), start);
  assert.equal(daylightStep(new Date(start)).getTime(), start);
  assert.equal(DAYLIGHT_STEP_MS, MINUTE);
  const first = effectiveBrightness(following, TORONTO, start, TORONTO.zone);
  for (const offset of [1, 15_000, 30_000, 59_999]) assert.equal(effectiveBrightness(following, TORONTO, start + offset, TORONTO.zone), first);
  assert.notEqual(effectiveBrightness(following, TORONTO, start + MINUTE, TORONTO.zone), first, 'the next minute of dawn differs');
  assert.equal(daylightStatus(RANGE, TORONTO, start + 42_000, TORONTO.zone).brightness, first, 'the editor reports the same value');
});

test('levels are rounded to 0.001 and stay inside the range', () => {
  assert.equal(daylightLevel({ dimmest: 0.2, brightest: 0.8 }, 1 / 3), 0.4);
  assert.equal(daylightLevel({ dimmest: 0.25, brightest: 0.25 }, 0.7), 0.25, 'an empty range is flat');
  for (const value of [0, 0.123456, 0.5, 0.999999, 1]) {
    const level = daylightLevel(RANGE, value);
    assert.ok(level >= 0.2 && level <= 0.8);
    assert.equal(Math.round(level * 1000) / 1000, level);
  }
  assert.deepEqual([daylightTerm(-90), daylightTerm(DAYLIGHT_DAWN_DEGREES), daylightTerm(-0.5), daylightTerm(DAYLIGHT_FULL_DEGREES), daylightTerm(60)], [0, 0, 0.5, 1, 1]);
});

test('Follow daylight starts from Night’s 28% to Phone’s 70%, widened to include the Fixed level, dimming at 11 PM', () => {
  assert.deepEqual(defaultDaylightRange(0.55), { dimmest: 0.28, brightest: 0.7, dimTime: '23:00' });
  assert.deepEqual(defaultDaylightRange(0.9), { dimmest: 0.28, brightest: 0.9, dimTime: '23:00' });
  assert.deepEqual(defaultDaylightRange(0.15), { dimmest: 0.15, brightest: 0.7, dimTime: '23:00' });
  // With that range the evening level is the Room look's 55%.
  assert.equal(daylightLevel(defaultDaylightRange(0.55), DAYLIGHT_EVENING_LEVEL), 0.553);
});
