import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, civilDateKey, formatDuration, moonPhase, nextMoonEvent, sunDay, sunIsUp, timeParts, zoneOffsetMinutes } from './astronomy.ts';

// Reference values pinned 2026-10-18 from the U.S. Naval Observatory API
// (aa.usno.navy.mil/api/rstt/oneday and /api/moon/phases/year?year=2026). USNO and the NOAA
// calculator agree to within a minute at these latitudes.
const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
const minutesApart = (actual: Date | null, expected: string) => Math.abs((actual?.getTime() ?? NaN) - Date.parse(expected)) / 60_000;

test('Toronto sunrise and sunset match the reference values within two minutes', () => {
  const june = sunDay('2026-06-21', TORONTO.latitude, TORONTO.longitude);
  assert.ok(minutesApart(june.sunrise, '2026-06-21T09:36:00Z') <= 2, `June sunrise ${june.sunrise?.toISOString()}`); // 05:36 EDT
  assert.ok(minutesApart(june.sunset, '2026-06-22T01:03:00Z') <= 2, `June sunset ${june.sunset?.toISOString()}`); // 21:03 EDT, next UTC day
  const december = sunDay('2026-12-21', TORONTO.latitude, TORONTO.longitude);
  assert.ok(minutesApart(december.sunrise, '2026-12-21T12:48:00Z') <= 2); // 07:48 EST
  assert.ok(minutesApart(december.sunset, '2026-12-21T21:44:00Z') <= 2); // 16:44 EST
  assert.equal(june.polar, null);
  assert.ok(Math.abs(june.daylightMinutes - (15 * 60 + 27)) <= 3, `June daylight ${june.daylightMinutes}`);
  assert.ok(Math.abs(december.daylightMinutes - (8 * 60 + 56)) <= 3, `December daylight ${december.daylightMinutes}`);
  // The civil date's events stay on that local date.
  assert.equal(civilDateKey(june.sunset!, 'America/Toronto'), '2026-06-21');
});

test('southern hemisphere: Sydney in spring', () => {
  const day = sunDay('2026-10-18', -33.8688, 151.2093);
  assert.ok(minutesApart(day.sunrise, '2026-10-17T19:11:00Z') <= 2, `sunrise ${day.sunrise?.toISOString()}`); // 06:11 AEDT
  assert.ok(minutesApart(day.sunset, '2026-10-18T08:11:00Z') <= 2, `sunset ${day.sunset?.toISOString()}`); // 19:11 AEDT
  assert.equal(civilDateKey(day.sunrise!, 'Australia/Sydney'), '2026-10-18');
  // Days lengthen in the southern spring.
  assert.ok(day.daylightMinutes > sunDay(addDays('2026-10-18', -1), -33.8688, 151.2093).daylightMinutes);
});

test('Tromsø has a polar day in June and a polar night in December with no invented times', () => {
  const june = sunDay('2026-06-21', 69.6492, 18.9553);
  assert.equal(june.polar, 'day'); assert.equal(june.sunrise, null); assert.equal(june.sunset, null); assert.equal(june.daylightMinutes, 1440);
  const december = sunDay('2026-12-21', 69.6492, 18.9553);
  assert.equal(december.polar, 'night'); assert.equal(december.sunrise, null); assert.equal(december.sunset, null); assert.equal(december.daylightMinutes, 0);
  assert.equal(sunIsUp(new Date('2026-06-21T23:00:00Z'), 69.6492, 18.9553), true, 'midnight sun');
  assert.equal(sunIsUp(new Date('2026-12-21T11:00:00Z'), 69.6492, 18.9553), false, 'noon in the polar night');
});

test('sun up/down follows the computed sunrise and sunset', () => {
  const day = sunDay('2026-10-18', TORONTO.latitude, TORONTO.longitude);
  const at = (offset: number, from: Date) => new Date(from.getTime() + offset * 60_000);
  assert.equal(sunIsUp(at(-5, day.sunrise!), TORONTO.latitude, TORONTO.longitude), false);
  assert.equal(sunIsUp(at(5, day.sunrise!), TORONTO.latitude, TORONTO.longitude), true);
  assert.equal(sunIsUp(at(-5, day.sunset!), TORONTO.latitude, TORONTO.longitude), true);
  assert.equal(sunIsUp(at(5, day.sunset!), TORONTO.latitude, TORONTO.longitude), false);
});

// USNO 2026 principal phases (UT).
const FULL_MOONS = ['2026-01-03T10:03:00Z', '2026-02-01T22:09:00Z', '2026-03-03T11:38:00Z', '2026-10-26T04:12:00Z'];
const NEW_MOONS = ['2026-01-18T19:52:00Z', '2026-02-17T12:01:00Z', '2026-11-09T07:02:00Z'];
const hours = (iso: string, offset: number) => new Date(Date.parse(iso) + offset * 3600_000);

test('phase names around the 2026 full moons', () => {
  for (const full of FULL_MOONS.slice(0, 3)) {
    for (const offset of [-12, 0, 12]) assert.equal(moonPhase(hours(full, offset)).name, 'Full moon', `${full} ${offset} h`);
    assert.equal(moonPhase(hours(full, -48)).name, 'Waxing gibbous', `${full} two days before`);
    assert.equal(moonPhase(hours(full, 48)).name, 'Waning gibbous', `${full} two days after`);
    assert.ok(moonPhase(hours(full, 0)).illumination > 0.99);
  }
  assert.equal(moonPhase(new Date('2026-01-10T15:48:00Z')).name, 'Last quarter');
  assert.equal(moonPhase(new Date('2026-01-18T19:52:00Z')).name, 'New moon');
  assert.equal(moonPhase(new Date('2026-01-26T04:47:00Z')).name, 'First quarter');
  assert.equal(moonPhase(new Date('2026-01-14T00:00:00Z')).name, 'Waning crescent');
  assert.equal(moonPhase(new Date('2026-01-22T00:00:00Z')).name, 'Waxing crescent');
  const quarter = moonPhase(new Date('2026-01-26T04:47:00Z'));
  assert.ok(Math.abs(quarter.illumination - 0.5) < 0.02); assert.equal(quarter.waxing, true);
});

test('nextMoonEvent finds the next full and new moon within an hour', () => {
  for (const full of FULL_MOONS) {
    const found = nextMoonEvent(hours(full, -5 * 24), 'full');
    assert.ok(minutesApart(found, full) <= 60, `${full}: ${found.toISOString()}`);
  }
  for (const value of NEW_MOONS) assert.ok(minutesApart(nextMoonEvent(hours(value, -24), 'new'), value) <= 60);
  // Strictly after: just past a full moon the next one is a cycle later.
  assert.ok(minutesApart(nextMoonEvent(hours(FULL_MOONS[0]!, 1), 'full'), FULL_MOONS[1]!) <= 60);
  assert.ok(minutesApart(nextMoonEvent(new Date('2026-10-18T13:00:00Z'), 'full'), '2026-10-26T04:12:00Z') <= 60);
});

test('illumination rises from new to full and falls from full to new', () => {
  const series = (from: string, to: string) => {
    const values: number[] = [];
    for (let ms = Date.parse(from); ms <= Date.parse(to); ms += 6 * 3600_000) values.push(moonPhase(new Date(ms)).illumination);
    return values;
  };
  const waxing = series('2026-01-18T20:00:00Z', '2026-02-01T22:00:00Z');
  waxing.slice(1).forEach((value, index) => assert.ok(value >= waxing[index]!, `waxing step ${index}`));
  const waning = series('2026-02-01T22:30:00Z', '2026-02-17T12:00:00Z');
  waning.slice(1).forEach((value, index) => assert.ok(value <= waning[index]!, `waning step ${index}`));
});

test('civil time helpers are DST-correct and follow the 12/24-hour setting', () => {
  assert.equal(zoneOffsetMinutes(new Date('2026-10-18T13:00:00Z'), 'America/Toronto'), -240);
  assert.equal(zoneOffsetMinutes(new Date('2026-12-18T13:00:00Z'), 'America/Toronto'), -300);
  assert.equal(zoneOffsetMinutes(new Date('2026-10-18T13:00:00Z'), 'Asia/Kolkata'), 330);
  assert.equal(zoneOffsetMinutes(new Date('2026-10-18T13:00:00Z'), 'UTC'), 0);
  assert.deepEqual(timeParts(new Date('2026-10-18T00:05:00Z'), 'UTC', '24h'), { time: '00:05', period: null });
  assert.deepEqual(timeParts(new Date('2026-10-18T13:05:00Z'), 'UTC', '12h'), { time: '1:05', period: 'PM' });
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(formatDuration(654), '10 h 54 min'); assert.equal(formatDuration(45), '45 min'); assert.equal(formatDuration(120), '2 h');
});
