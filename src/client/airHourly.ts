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
  const hour = zoneFormatter(timeZone, clockFormat === '12h' ? { hour: 'numeric', hour12: true } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
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
