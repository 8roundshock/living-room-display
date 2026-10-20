// Follow daylight brightness (#439): fixed instants (fake time) at fixed places.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sunDay } from './astronomy.ts';
import {
  DAYLIGHT_LOW_SUN_DEGREES, DAYLIGHT_STEP_MS, daylightCurve, daylightLevel, daylightStatus, daylightStep, defaultDaylightRange, effectiveBrightness,
} from './daylight.ts';

const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
const TROMSO = { latitude: 69.6492, longitude: 18.9553 };
const SYDNEY = { latitude: -33.8688, longitude: 151.2093 };
const RANGE = { dimmest: 0.2, brightest: 0.8 };
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
const level = (place: { latitude: number; longitude: number }, at: Date) => daylightLevel(RANGE, daylightCurve(at, place.latitude, place.longitude).fraction);
const minutesApart = (a: Date, b: Date | string) => Math.abs(a.getTime() - new Date(b).getTime()) / MINUTE;

test('Fixed brightness is the saved level at every hour, exactly as before', () => {
  for (const at of instants(Date.parse('2026-10-20T00:00:00Z'), Date.parse('2026-10-21T00:00:00Z'), 60)) {
    assert.equal(effectiveBrightness(fixed, TORONTO, at), 0.55);
    assert.equal(effectiveBrightness(fixed, TROMSO, at), 0.55);
  }
});

test('Toronto in October: Dimmest through the night, Brightest at solar noon (13:02 EDT)', () => {
  const day = sunDay('2026-10-20', TORONTO.latitude, TORONTO.longitude);
  // Solar transit at 79.38° W with the October equation of time (+15.2 min): 17:02:20 UTC.
  assert.ok(minutesApart(day.solarNoon, '2026-10-20T17:02:20Z') <= 1, day.solarNoon.toISOString());
  const status = daylightStatus(RANGE, TORONTO, Date.parse('2026-10-20T14:00:00Z'));
  assert.equal(status.peak.getTime(), day.solarNoon.getTime(), 'the morning peaks at today’s solar noon');
  assert.equal(status.polar, null);
  assert.equal(daylightCurve(day.solarNoon, TORONTO.latitude, TORONTO.longitude).fraction, 1);
  assert.equal(level(TORONTO, day.solarNoon), 0.8, 'Brightest at the solar noon itself');
  assert.ok(effectiveBrightness(following, TORONTO, day.solarNoon) >= 0.799, 'and for the minute containing it');
  // Night: local midnight, 3 AM, just before sunrise, just after sunset and 11 PM.
  for (const at of [
    new Date('2026-10-20T04:00:00Z'), new Date('2026-10-20T07:00:00Z'), new Date(day.sunrise!.getTime() - MINUTE),
    new Date(day.sunset!.getTime() + MINUTE), new Date('2026-10-21T03:00:00Z'),
  ]) assert.equal(effectiveBrightness(following, TORONTO, at), 0.2, `Dimmest at ${at.toISOString()}`);
  // Mid-morning sits strictly between the two.
  const morning = effectiveBrightness(following, TORONTO, new Date('2026-10-20T14:00:00Z'));
  assert.ok(morning > 0.3 && morning < 0.75, `10 AM EDT: ${morning}`);
});

test('Toronto rises monotonically through the morning and falls through the afternoon, all year', () => {
  for (const date of ['2026-03-20', '2026-06-21', '2026-10-20', '2026-12-21']) {
    const day = sunDay(date, TORONTO.latitude, TORONTO.longitude);
    const morning = instants(day.sunrise!, day.solarNoon).map(at => level(TORONTO, at));
    const afternoon = instants(day.solarNoon, day.sunset!).map(at => level(TORONTO, at));
    morning.slice(1).forEach((value, index) => assert.ok(value >= morning[index]!, `${date} morning dips at minute ${index + 1}: ${morning[index]} → ${value}`));
    afternoon.slice(1).forEach((value, index) => assert.ok(value <= afternoon[index]!, `${date} afternoon rises at minute ${index + 1}: ${afternoon[index]} → ${value}`));
    assert.equal(morning[0], 0.2, `${date} starts at Dimmest at sunrise`);
    assert.ok(morning.at(-1)! >= 0.799 && afternoon[0]! >= 0.799, `${date} reaches Brightest at noon`);
    assert.equal(afternoon.at(-1), 0.2, `${date} is back at Dimmest at sunset`);
    // A real rise, not a flat line: halfway through the morning it is well above Dimmest.
    assert.ok(morning[Math.floor(morning.length / 2)]! > 0.45, `${date} mid-morning ${morning[Math.floor(morning.length / 2)]}`);
  }
  // It follows the seasons: 9 AM EDT is brighter in June than in October.
  assert.ok(level(TORONTO, new Date('2026-06-21T13:00:00Z')) > level(TORONTO, new Date('2026-10-20T13:00:00Z')));
});

test('a minute never changes the value by more than about 1% of the range, so the glide hides every step', () => {
  const full = { dimmest: 0.1, brightest: 1 };
  for (const [place, dates, limit] of [
    [TORONTO, ['2026-03-20', '2026-06-21', '2026-12-13', '2026-12-21'], 0.0075],
    [TROMSO, ['2026-01-19', '2026-02-10', '2026-06-21', '2026-11-25'], 0.012],
  ] as const) {
    for (const date of dates) {
      const start = Date.parse(`${date}T00:00:00Z`);
      let previous = daylightLevel(full, daylightCurve(new Date(start), place.latitude, place.longitude).fraction);
      for (const at of instants(start + MINUTE, start + 24 * HOUR)) {
        const value = daylightLevel(full, daylightCurve(at, place.latitude, place.longitude).fraction);
        assert.ok(Math.abs(value - previous) <= limit + 1e-9, `${date} at ${at.toISOString()}: ${previous} → ${value}`);
        previous = value;
      }
    }
  }
});

test('Tromsø polar day in June: never down to Dimmest, still Brightest at solar noon', () => {
  const day = sunDay('2026-06-21', TROMSO.latitude, TROMSO.longitude);
  assert.equal(day.polar, 'day');
  const values = instants(day.solarNoon.getTime() - 12 * HOUR, day.solarNoon.getTime() + 12 * HOUR, 10).map(at => level(TROMSO, at));
  assert.ok(Math.min(...values) > 0.2, `lowest ${Math.min(...values)}`);
  assert.equal(level(TROMSO, day.solarNoon), 0.8);
  assert.equal(daylightStatus(RANGE, TROMSO, day.solarNoon).polar, 'day');
  // The lowest point is around solar midnight, and crossing it is not a visible step.
  const midnight = day.solarNoon.getTime() + 12 * HOUR;
  const before = level(TROMSO, new Date(midnight - MINUTE)), after = level(TROMSO, new Date(midnight + MINUTE));
  assert.ok(before < 0.35 && Math.abs(after - before) < 0.005, `around solar midnight ${before} → ${after}`);
});

test('Tromsø polar night in December: Dimmest all day', () => {
  const day = sunDay('2026-12-21', TROMSO.latitude, TROMSO.longitude);
  assert.equal(day.polar, 'night');
  for (const at of instants(Date.parse('2026-12-21T00:00:00Z'), Date.parse('2026-12-22T00:00:00Z'), 10)) {
    assert.equal(effectiveBrightness(following, TROMSO, at), 0.2, at.toISOString());
  }
  assert.equal(daylightStatus(RANGE, TROMSO, Date.parse('2026-12-21T10:45:00Z')).polar, 'night');
});

test(`a low sun (under ${DAYLIGHT_LOW_SUN_DEGREES}° at noon) peaks lower instead of flashing to Brightest`, () => {
  // Tromsø a few days after the polar night: the sun clears the horizon for about an hour.
  const day = sunDay('2026-01-19', TROMSO.latitude, TROMSO.longitude);
  assert.equal(day.polar, null);
  const peak = level(TROMSO, day.solarNoon);
  assert.ok(peak > 0.2 && peak < 0.5, `peak ${peak}`);
  // The noon is still the brightest moment of that day.
  for (const at of instants(day.solarNoon.getTime() - 6 * HOUR, day.solarNoon.getTime() + 6 * HOUR, 5)) assert.ok(level(TROMSO, at) <= peak);
});

test('Sydney peaks at its own solar noon in the southern spring', () => {
  const day = sunDay('2026-10-18', SYDNEY.latitude, SYDNEY.longitude);
  // 151.21° E with the October equation of time: 01:40 UTC (12:40 AEDT).
  assert.ok(minutesApart(day.solarNoon, '2026-10-18T01:40:00Z') <= 2, day.solarNoon.toISOString());
  assert.equal(daylightStatus(RANGE, SYDNEY, Date.parse('2026-10-17T22:00:00Z')).peak.getTime(), day.solarNoon.getTime());
  assert.equal(level(SYDNEY, day.solarNoon), 0.8);
  assert.equal(effectiveBrightness(following, SYDNEY, new Date('2026-10-18T12:00:00Z')), 0.2, '11 PM AEDT');
});

test('the peak is the current solar day’s noon, within about 12 hours, across the date line too', () => {
  for (const place of [TORONTO, SYDNEY, TROMSO, { latitude: -13.83, longitude: -171.76 }, { latitude: 1.87, longitude: -157.36 }, { latitude: 51.5, longitude: 179.9 }]) {
    for (const at of instants(Date.parse('2026-10-18T00:00:00Z'), Date.parse('2026-10-19T00:00:00Z'), 30)) {
      const { peak } = daylightCurve(at, place.latitude, place.longitude);
      assert.ok(Math.abs(peak.getTime() - at.getTime()) <= 12 * HOUR + 20 * MINUTE, `${JSON.stringify(place)} at ${at.toISOString()}: peak ${peak.toISOString()}`);
    }
  }
});

test('the value changes at most once a minute: every reader in a minute agrees', () => {
  const start = Date.parse('2026-10-20T14:30:00Z');
  assert.equal(daylightStep(start + 59_999).getTime(), start);
  assert.equal(daylightStep(new Date(start)).getTime(), start);
  assert.equal(DAYLIGHT_STEP_MS, MINUTE);
  const first = effectiveBrightness(following, TORONTO, start);
  for (const offset of [1, 15_000, 30_000, 59_999]) assert.equal(effectiveBrightness(following, TORONTO, start + offset), first);
  assert.notEqual(effectiveBrightness(following, TORONTO, start + MINUTE), first, 'the next minute in the morning differs');
  assert.equal(daylightStatus(RANGE, TORONTO, start + 42_000).brightness, first, 'the editor reports the same value');
});

test('levels are rounded to 0.001 and stay inside the range', () => {
  assert.equal(daylightLevel({ dimmest: 0.2, brightest: 0.8 }, 1 / 3), 0.4);
  assert.equal(daylightLevel({ dimmest: 0.25, brightest: 0.25 }, 0.7), 0.25, 'an empty range is flat');
  for (const fraction of [0, 0.123456, 0.5, 0.999999, 1]) {
    const value = daylightLevel(RANGE, fraction);
    assert.ok(value >= 0.2 && value <= 0.8);
    assert.equal(Math.round(value * 1000) / 1000, value);
  }
});

test('Follow daylight starts from Night’s 28% to Phone’s 70%, widened to include the Fixed level', () => {
  assert.deepEqual(defaultDaylightRange(0.55), { dimmest: 0.28, brightest: 0.7 });
  assert.deepEqual(defaultDaylightRange(0.9), { dimmest: 0.28, brightest: 0.9 });
  assert.deepEqual(defaultDaylightRange(0.15), { dimmest: 0.15, brightest: 0.7 });
});
