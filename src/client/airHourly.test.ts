import test from 'node:test';
import assert from 'node:assert/strict';
import type { AirQualityReading } from '../shared/contracts.ts';
import { airHourly, upcomingAirHours, uvPeakLabel } from './airHourly.ts';

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
  assert.equal(model.start, '10:00 PM', 'starts at the current hour, not at the fetch hour');
  assert.equal(model.end, '8:00 AM');
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
  assert.equal(model.start, '09:00'); assert.equal(model.end, '08:00');
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
