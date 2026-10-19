import test from 'node:test';
import assert from 'node:assert/strict';
import type { AirQualityReading } from '../shared/contracts.ts';
import { airAgeSegments, airHourly, airReadingView, currentHourReading, upcomingAirHours, uvPeakLabel } from './airHourly.ts';
import { LAST_KNOWN_AFTER_MS, lastKnownLabel } from './format.ts';

const HOUR = 3600_000;
const ZONE = 'America/Toronto';
// Synthetic: a reading fetched at 09:00 Toronto (13:00 UTC) whose 24 hours run 09:00 to 08:00.
const FETCHED = Date.parse('2026-10-18T13:00:00Z');
const UV = [3, 4, 5, 4, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
function series(start = FETCHED, length = 24): AirQualityReading[] {
  return Array.from({ length }, (_, index) => ({ time: new Date(start + index * HOUR).toISOString(), aqi: index === 15 ? null : 40 + index % 6, uvIndex: UV[index] ?? 0 }));
}

test('only the current and later hours remain, as the server normalizer keeps them', () => {
  const now = Date.parse('2026-10-19T02:30:00Z'); // 22:30 Toronto
  const upcoming = upcomingAirHours(series(), now);
  assert.equal(upcoming[0]!.time, '2026-10-19T02:00:00.000Z', 'the in-progress hour stays');
  assert.equal(upcoming.length, 11);
  assert.ok(upcoming.every(reading => Date.parse(reading.time) > now - HOUR));
  assert.deepEqual(upcomingAirHours([{ time: 'invalid', aqi: 1, uvIndex: 1 }, ...series(now, 30)], now).length, 24, 'invalid instants dropped, at most 24');
});

test('a saved reading at night shows no past hour and no past UV peak', () => {
  const now = Date.parse('2026-10-19T02:30:00Z'); // 22:30 Toronto, 13.5 h after the fetch
  const model = airHourly(series(), now, 'us', 'US AQI', ZONE, '12h')!;
  assert.equal(model.bars.length, 11);
  assert.equal(model.bars[0]!.time, '2026-10-19T02:00:00.000Z', 'starts at the current hour, not at the fetch hour');
  // The shared axis (#261): “Now” under the bar covering now, and the end of the last hour.
  assert.equal(model.start, 'Now');
  assert.equal(model.end, '9 AM', 'the 08:00 reading draws 8–9 AM');
  assert.ok(model.bars.every(bar => Date.parse(bar.time) > now - HOUR));
  assert.doesNotMatch(model.uvPeak, /11 AM|peaks 5/, 'the morning peak has already happened');
  // The series ends at 08:00 while UV is still rising, so it is not called a peak.
  assert.equal(model.uvPeak, 'UV reaches 1 tomorrow by 8 AM');
  assert.equal(model.summary, 'US AQI estimate for the next 11 hours: 40 to 45, 1 unknown');
});

test('the fresh series keeps today\'s peak, 24-hour labels and the dotted unknown hour', () => {
  const now = FETCHED + 5 * 60_000;
  const model = airHourly(series(), now, 'us', 'US AQI', ZONE, '24h')!;
  assert.equal(model.bars.length, 24);
  assert.equal(model.start, 'Now'); assert.equal(model.end, '09:00');
  assert.equal(model.bars[0]!.title, '09:00: 40', 'bar titles use the same compact hours');
  assert.equal(model.uvPeak, 'UV peaks 5 at 11:00');
  assert.equal(model.bars.filter(bar => bar.unknown).length, 1);
  assert.equal(model.bars[15]!.height, '8%'); assert.match(model.bars[15]!.title, /unknown$/);
  assert.equal(model.bars[0]!.height, '40%', 'relative to the top of the Moderate band');
  assert.equal(model.summary, 'US AQI estimate for the next 24 hours: 40 to 45, 1 unknown');
  assert.equal(airHourly(series(), now, 'european', 'European AQI', ZONE, '12h')!.bars[0]!.height, `${40 / 60 * 100}%`);
});

test('after today\'s daylight the next day\'s peak is named; a dark series reads low for its own length', () => {
  const evening = Date.parse('2026-10-18T23:10:00Z'); // 19:10 Toronto
  const fresh = series(Date.parse('2026-10-18T23:00:00Z')).map((reading, index) => ({ ...reading, uvIndex: index === 18 ? 4 : 0 })); // 13:00 tomorrow
  assert.equal(uvPeakLabel(upcomingAirHours(fresh, evening), evening, ZONE, '12h'), 'UV peaks 4 tomorrow at 1 PM');
  const dark = fresh.slice(0, 6).map(reading => ({ ...reading, uvIndex: 0.2 }));
  assert.equal(uvPeakLabel(dark, evening, ZONE, '12h'), 'UV low for the next 6 h');
  assert.equal(uvPeakLabel(dark.map(reading => ({ ...reading, uvIndex: null })), evening, ZONE, '12h'), 'UV forecast unavailable');
});

test('fewer than two upcoming hours means no hourly estimate, never a stretched past series', () => {
  assert.equal(airHourly(series(), FETCHED + 23 * HOUR + 30 * 60_000, 'us', 'US AQI', ZONE, '12h'), null);
  assert.equal(airHourly(series(), FETCHED + 30 * HOUR, 'us', 'US AQI', ZONE, '12h'), null);
  assert.equal(airHourly([], FETCHED, 'us', 'US AQI', ZONE, '12h'), null);
  const unknown = airHourly(series().map(reading => ({ ...reading, aqi: null })), FETCHED, 'us', 'US AQI', ZONE, '12h')!;
  assert.equal(unknown.summary, 'US AQI estimate for the next 24 hours: unknown');
  assert.ok(unknown.bars.every(bar => bar.unknown));
});

// #188: values fetched at 09:05 Toronto with a series from 09:00; current values describe 09:00.
const CURRENT = { time: new Date(FETCHED).toISOString(), aqi: 42, dominant: 'pm2_5' as const, pm2_5: 12, pm10: 18, uvIndex: 3 };
const SAVED = { updatedAt: new Date(FETCHED + 5 * 60_000).toISOString(), hourly: series() };

test('saved current values stand for 3 hours after the update', () => {
  for (const age of [0, 2 * HOUR, LAST_KNOWN_AFTER_MS]) {
    const view = airReadingView(SAVED, CURRENT, FETCHED + 5 * 60_000 + age, ZONE, '12h');
    assert.deepEqual(view, { kind: 'current', aqi: 42, uvIndex: 3, showUv: true, showPollutant: true, qualifier: null }, `${age / HOUR} h`);
  }
});

test('older values read the saved estimate for the current hour, never daytime UV at night', () => {
  const night = Date.parse('2026-10-19T02:30:00Z'); // 22:30 Toronto, 13.5 h after the fetch
  const view = airReadingView(SAVED, CURRENT, night, ZONE, '12h');
  assert.equal(view.kind, 'estimate'); assert.equal(view.qualifier, 'Saved estimate');
  assert.equal(view.aqi, 40 + 13 % 6, 'the 22:00 estimate, not the 09:00 value');
  assert.equal(view.uvIndex, 0, 'the 22:00 UV estimate'); assert.equal(view.showUv, true);
  assert.equal(view.showPollutant, false, 'the main pollutant has no hourly estimate');
  // The estimate for the current hour starts at its hour, not at the next one.
  assert.equal(currentHourReading(SAVED.hourly, Date.parse('2026-10-19T02:00:00Z'))!.time, '2026-10-19T02:00:00.000Z');
  assert.equal(currentHourReading(SAVED.hourly, FETCHED - 1), null, 'a series that starts later has no current hour');
});

test('without an estimate for this hour the old AQI is qualified with its time and UV is hidden', () => {
  // The series ends at 08:00 the next morning; at 10:30 the hour has no estimate.
  const later = Date.parse('2026-10-19T14:30:00Z');
  const view = airReadingView(SAVED, CURRENT, later, ZONE, '12h');
  // The time is the shared last-known label (#329): no-break spaces keep “Sun 9 AM” whole.
  assert.deepEqual(view, { kind: 'lastKnown', aqi: 42, uvIndex: null, showUv: false, showPollutant: false, qualifier: 'Last known · Sun 9 AM' });
  assert.equal(view.qualifier, `Last known · ${lastKnownLabel(FETCHED, later, ZONE, '12h')}`);
  assert.equal(airReadingView(SAVED, CURRENT, later, ZONE, '24h').qualifier, 'Last known · Sun 09:00');
  // The same evening, with the estimate for this hour unknown, no weekday is needed.
  const evening = Date.parse('2026-10-18T22:30:00Z'); // 18:30 Toronto
  const gap = { ...SAVED, hourly: SAVED.hourly.map(reading => reading.time === '2026-10-18T22:00:00.000Z' ? { ...reading, aqi: null } : reading) };
  assert.equal(airReadingView(gap, CURRENT, evening, ZONE, '12h').qualifier, 'Last known · 9 AM');
  // Nothing is invented: an unknown AQI stays unknown.
  assert.equal(airReadingView(gap, { ...CURRENT, aqi: null }, evening, ZONE, '12h').aqi, null);
  // An unreadable update time falls back to the reading's own time, then keeps the values.
  assert.equal(airReadingView({ ...SAVED, updatedAt: null }, CURRENT, later, ZONE, '12h').kind, 'lastKnown');
  assert.equal(airReadingView({ ...SAVED, updatedAt: 'invalid' }, { ...CURRENT, time: 'invalid' }, later, ZONE, '12h').kind, 'current');
});

test('the footer age is short phrases: model estimate, saved, offline, or the age alone', () => {
  const base = { age: 'Updated 12 min ago', stale: false, reading: true, disconnected: false };
  assert.deepEqual(airAgeSegments(base), ['Model est.', '12 min ago']);
  assert.deepEqual(airAgeSegments({ ...base, stale: true, age: 'Updated 2 hr ago' }), ['Saved reading', '2 hr ago']);
  assert.deepEqual(airAgeSegments({ ...base, disconnected: true }), ['Offline', 'Model est.', '12 min ago']);
  assert.deepEqual(airAgeSegments({ ...base, age: 'Updated just now' }), ['Model est.', 'just now']);
  assert.deepEqual(airAgeSegments({ ...base, reading: false, age: 'Not updated yet' }), ['Not updated yet'], 'no estimate label without a reading');
  assert.deepEqual(airAgeSegments({ ...base, reading: false, age: 'Updated 5 min ago' }), ['Updated 5 min ago']);
  assert.deepEqual(airAgeSegments({ ...base, reading: false, stale: true, disconnected: true, age: 'Not updated yet' }), ['Offline', 'Not updated yet']);
});
