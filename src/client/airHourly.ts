import type { AirQualityReading, AirQualityState, Settings } from '../shared/contracts.ts';
import { civilDateKey, formatTime, zoneFormatter } from './astronomy.ts';

const HOUR = 3600_000;
/** With fewer upcoming hours than this the large family says the hourly estimate is unavailable. */
export const MIN_AIR_HOURS = 2;

/**
 * Hourly readings that still describe the current or a later hour, at most 24. This is the
 * server's normalizer rule applied again at render time: a cached or saved (stale) reading keeps
 * the series it was fetched with while the clock moves on, so past hours must not read as upcoming.
 */
export function upcomingAirHours(hourly: readonly AirQualityReading[], now: number): AirQualityReading[] {
  return hourly.filter(reading => Date.parse(reading.time) > now - HOUR).slice(0, 24);
}

export interface AirHourBar { time: string; height: string; unknown: boolean; title: string }
export interface AirHourly {
  bars: AirHourBar[];
  start: string;
  end: string;
  /** Accessible name of the bar chart. */
  summary: string;
  uvPeak: string;
}

/** "1 PM", or "13:00" with the 24-hour setting: model readings fall on the hour. */
function hourFormatter(timeZone: string, clockFormat: Settings['clockFormat']): Intl.DateTimeFormat {
  return zoneFormatter(timeZone, clockFormat === '12h' ? { hour: 'numeric', hour12: true } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/**
 * Today's UV peak (or tomorrow's once today's daylight has passed) from upcoming readings only.
 * A maximum on the series' final hour may still be rising beyond what the forecast covers, so it
 * is reported as "reaches … by", not as a peak.
 */
export function uvPeakLabel(upcoming: readonly AirQualityReading[], now: number, timeZone: string, clockFormat: Settings['clockFormat']): string {
  const known = upcoming.filter(reading => reading.uvIndex !== null);
  if (!known.length) return 'UV forecast unavailable';
  const today = civilDateKey(new Date(now), timeZone);
  const last = upcoming[upcoming.length - 1];
  const hour = hourFormatter(timeZone, clockFormat);
  const days = known.map(reading => ({ reading, today: civilDateKey(new Date(reading.time), timeZone) === today }));
  for (const tomorrow of [false, true]) {
    const peak = days.filter(day => day.today !== tomorrow).reduce<AirQualityReading | null>((best, { reading }) => !best || reading.uvIndex! > best.uvIndex! ? reading : best, null);
    if (!peak || Math.round(peak.uvIndex!) < 1) continue;
    const value = Math.round(peak.uvIndex!), day = tomorrow ? ' tomorrow' : '', at = hour.format(new Date(peak.time));
    return peak === last ? `UV reaches ${value}${day} by ${at}` : `UV peaks ${value}${day} at ${at}`;
  }
  return `UV low for the next ${upcoming.length} h`;
}

/**
 * The large family's bars, hour labels, chart summary and UV peak, built from upcoming readings
 * only. Callers memoize it per minute; null when fewer than MIN_AIR_HOURS readings remain.
 */
export function airHourly(hourly: readonly AirQualityReading[], now: number, scale: AirQualityState['scale'], scaleLabel: string, timeZone: string, clockFormat: Settings['clockFormat']): AirHourly | null {
  const upcoming = upcomingAirHours(hourly, now);
  if (upcoming.length < MIN_AIR_HOURS) return null;
  const time = (iso: string) => formatTime(new Date(iso), timeZone, clockFormat);
  const known = upcoming.flatMap(reading => reading.aqi === null ? [] : [Math.round(reading.aqi)]);
  // Bars are relative to the top of the "Moderate" band, or to the highest hour when worse.
  const top = Math.max(scale === 'us' ? 100 : 60, ...known);
  const bars = upcoming.map(reading => ({
    time: reading.time, unknown: reading.aqi === null,
    height: reading.aqi === null ? '8%' : `${Math.max(3, Math.min(100, reading.aqi / top * 100))}%`,
    title: `${time(reading.time)}: ${reading.aqi === null ? 'unknown' : Math.round(reading.aqi)}`,
  }));
  const low = Math.min(...known), high = Math.max(...known), unknown = upcoming.length - known.length;
  const range = !known.length ? 'unknown' : low === high ? String(low) : `${low} to ${high}`;
  const summary = `${scaleLabel} estimate for the next ${upcoming.length} hours: ${range}${known.length && unknown ? `, ${unknown} unknown` : ''}`;
  return { bars, start: time(upcoming[0]!.time), end: time(upcoming[upcoming.length - 1]!.time), summary, uvPeak: uvPeakLabel(upcoming, now, timeZone, clockFormat) };
}

/**
 * Saved current values older than this stop reading as current (#188). Weather qualifies an old
 * temperature after the same 3 hours (#243), so both widgets age alike.
 */
export const AIR_CURRENT_MAX_AGE = 3 * HOUR;

type AirCurrent = NonNullable<AirQualityState['current']>;
export interface AirReadingView {
  /**
   * `current`: the values as fetched. `estimate`: the reading is over 3 hours old, so the AQI and UV
   * come from its saved hourly estimate for the current hour. `lastKnown`: no such estimate, so the
   * old AQI stays, qualified with its time.
   */
  kind: 'current' | 'estimate' | 'lastKnown';
  aqi: number | null;
  /** Null while hidden (`lastKnown`) as well as when unknown; see `showUv`. */
  uvIndex: number | null;
  showUv: boolean;
  /** The main pollutant exists only for the fetch-time values, which are not shown once old. */
  showPollutant: boolean;
  /** "Saved estimate" or "Last known · 9 AM" (with the weekday when not today), in the status tone. */
  qualifier: string | null;
}

function instant(value: string | null | undefined): number | null {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** The hourly reading whose hour contains `now`, if the saved series has one. */
export function currentHourReading(hourly: readonly AirQualityReading[], now: number): AirQualityReading | null {
  let match: AirQualityReading | null = null, start = -Infinity;
  for (const reading of hourly) {
    const time = instant(reading.time);
    if (time !== null && time <= now && time > now - HOUR && time > start) { match = reading; start = time; }
  }
  return match;
}

/**
 * What the reading row shows (#188). Within 3 hours of the update the fetched values stand. Older
 * values never read as current: the saved hourly estimate for this hour replaces the AQI and UV
 * ("Saved estimate"), or, without one, the old AQI reads "Last known · <time>" and UV is hidden; the
 * time is the hour the AQI describes ("9 AM", or "Sat 9 AM" when not today).
 * Nothing is invented; an age that cannot be read keeps the fetched values (the footer then says
 * the update time is unknown).
 */
export function airReadingView(air: Pick<AirQualityState, 'updatedAt' | 'hourly'>, current: AirCurrent, now: number, timeZone: string, clockFormat: Settings['clockFormat']): AirReadingView {
  const updated = instant(air.updatedAt) ?? instant(current.time);
  if (updated === null || now - updated <= AIR_CURRENT_MAX_AGE) return { kind: 'current', aqi: current.aqi, uvIndex: current.uvIndex, showUv: true, showPollutant: true, qualifier: null };
  const hour = currentHourReading(air.hourly, now);
  if (hour && hour.aqi !== null) return { kind: 'estimate', aqi: hour.aqi, uvIndex: hour.uvIndex, showUv: true, showPollutant: false, qualifier: 'Saved estimate' };
  const at = new Date(instant(current.time) ?? updated);
  const day = civilDateKey(at, timeZone) === civilDateKey(new Date(now), timeZone) ? '' : `${zoneFormatter(timeZone, { weekday: 'short' }).format(at)} `;
  // Model hours fall on the local hour: "9 AM" rather than "9:00 AM" (the 24-hour "09:00" stays).
  const time = formatTime(at, timeZone, clockFormat).replace(/:00(?= )/, '');
  return { kind: 'lastKnown', aqi: current.aqi, uvIndex: null, showUv: false, showPollutant: false, qualifier: `Last known · ${day}${time}` };
}

/**
 * The footer's age as short phrases that never break inside (#221): "Model est." with a reading,
 * "Saved reading" when stale, "Offline" first while the display cannot reach the computer, then the
 * age without "Updated" ("12 min ago"). Without a reading only the age shows ("Not updated yet").
 */
export function airAgeSegments({ age, stale, reading, disconnected }: { age: string; stale: boolean; reading: boolean; disconnected: boolean }): string[] {
  const kind = stale && reading ? 'Saved reading' : reading ? 'Model est.' : null;
  const when = kind && age.startsWith('Updated ') ? age.slice('Updated '.length) : age;
  return [...(disconnected ? ['Offline'] : []), ...(kind ? [kind] : []), when];
}
