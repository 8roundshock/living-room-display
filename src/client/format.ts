import type { WeatherState } from '../shared/contracts.ts';
import { isValidTimeZone, localTimeZone } from './astronomy.ts';

/** No-break space: joins a time to its AM/PM and a “·” to the value after it, so neither wraps alone (#197). */
export const NBSP = '\u00a0';
/** Word joiner: stops a line break after the en dash of a time range (“3–6 PM”) without a visible mark. */
export const WORD_JOINER = '\u2060';

const formatters = new Map<string, Intl.DateTimeFormat>();
/**
 * One cached Intl formatter per locale, option set and time zone (#99). Constructing a formatter
 * costs about 100 µs and the display re-renders every second, so renderers never construct one per
 * render. The cache is bounded; options are plain objects, so their JSON is a complete key.
 */
export function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    if (formatters.size >= 200) formatters.clear();
    formatters.set(key, formatter);
  }
  return formatter;
}

/** The true minus sign (U+2212): at couch distance the ASCII hyphen is a 6 × 2 px dash beside 10 px digits (#335). */
export const MINUS = '−';

/**
 * A rounded temperature: “14°”, “−7°”. Negative values use the true minus sign (#335), and a value
 * that rounds to zero prints “0°”, never “−0°”. Unknown values are a dash.
 */
export function temperature(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  return rounded < 0 ? `${MINUS}${-rounded}°` : `${rounded === 0 ? 0 : rounded}°`;
}

export function precipitation(value: number, unit: 'mm' | 'in'): string {
  if (unit === 'in') return `${value.toFixed(2)} in`;
  return `${value < 1 ? value.toFixed(1) : Math.round(value)} mm`;
}

/** A timestamp more than this far ahead of the clock cannot be aged honestly (#244); the server refreshes such data (FUTURE_TOLERANCE in src/server/weather.ts). */
export const FUTURE_TIMESTAMP_TOLERANCE_MS = 2 * 60_000;

export function ageLabel(
  timestamp: string | null | undefined,
  now = Date.now(),
): string {
  if (!timestamp) return 'Not updated yet';
  const elapsed = now - new Date(timestamp).getTime();
  // A clock set back after a fetch makes the update look like it happens later; never call that “just now”.
  if (!Number.isFinite(elapsed) || elapsed < -FUTURE_TIMESTAMP_TOLERANCE_MS) return 'Update time unknown';
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  if (minutes < 24 * 60) return `Updated ${Math.floor(minutes / 60)} hr ago`;
  const days = Math.floor(minutes / 1440);
  return `Updated ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/**
 * The zone weather dates and times are formatted in: the weather city's IANA zone once the provider
 * resolved it, otherwise this computer's. A saved device location stores `auto` until its first
 * forecast arrives, and the server reports that `auto` while the forecast is unavailable (PC offline
 * at start, provider down). Intl throws a RangeError for it, and a render that throws blanks the
 * display and editor (#318). Sun & moon uses this too; Air quality applies the same rule to its own
 * location. The fallback constructs a formatter, so renderers memoize the result.
 */
export function weatherTimeZone(timeZone: string | null | undefined): string {
  return isValidTimeZone(timeZone) ? timeZone : localTimeZone();
}

/** The civil date (YYYY-MM-DD) of an instant in a time zone. */
export function civilDate(date: Date | number, timeZone: string): string {
  const parts = dateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(typeof date === 'number' ? date : date.getTime());
  const part = (type: string) =>
    parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Adds whole civil days to a YYYY-MM-DD date (calendar arithmetic, not 24-hour steps across DST). */
function addCivilDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** A provider date-only value's weekday; UTC noon preserves the calendar day. */
function weekday(date: string): string {
  return dateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date.slice(0, 10)}T12:00:00Z`),
  );
}

/**
 * “Today”, “Tomorrow” or the weekday of a forecast date in the weather city's calendar. `compact`
 * (the forecast strip) names tomorrow by its weekday too (#256); “Tomorrow” stays in assistive text.
 */
export function forecastDay(
  date: string,
  timeZone: string,
  now: Date | number,
  compact = false,
): string {
  const today = civilDate(now, timeZone);
  if (date === today) return 'Today';
  if (!compact && date === addCivilDays(today, 1)) return 'Tomorrow';
  return weekday(date);
}

/** Saved daily entries from the weather city's civil today onward: a retained forecast never fills an upcoming strip with past days (#243). */
export function upcomingDays<Day extends { date: string }>(daily: Day[], today: string): Day[] {
  return daily.filter(day => day.date.slice(0, 10) >= today);
}

/** Today's saved daily entry in the weather city's calendar, or undefined when the forecast no longer has it. */
export function todayForecast<Day extends { date: string }>(daily: Day[], timeZone: string, now: Date | number): Day | undefined {
  // No saved day: nothing to look up, so no date is formatted (the zone may not be resolved yet).
  if (!daily.length) return undefined;
  const today = civilDate(now, timeZone);
  return daily.find(day => day.date.slice(0, 10) === today);
}

/**
 * The one “last known” rule (#243, #188, #329): saved current values more than this old no longer read
 * as current. Three hours matches the hourly models: after that a saved temperature or AQI describes
 * a different part of the day. Weather and Air quality each decide when the rule applies (see
 * `lastKnownTime` and `airReadingView`); both use this threshold and `lastKnownLabel`.
 */
export const LAST_KNOWN_AFTER_MS = 3 * 3_600_000;

/**
 * When a saved value was last known, in the place's zone: “9 AM”, with the weekday when not today
 * (“Thu 9 AM”), or “Thu 09:00” on the 24-hour clock. Compact 12-hour times drop “:00”; no-break
 * spaces keep the weekday, the time and AM/PM together (#197). Widgets show it as “Last known · …”.
 */
export function lastKnownLabel(at: number, now: Date | number, timeZone: string, clockFormat: '12h' | '24h'): string {
  const date = civilDate(at, timeZone);
  const day = date === civilDate(now, timeZone) ? '' : `${weekday(date)}${NBSP}`;
  return `${day}${compactWeatherTime(new Date(at).toISOString(), timeZone, clockFormat)}`;
}

/**
 * When a saved current reading more than three hours old was last known, while the forecast is stale
 * or the display is offline: “9 AM”, with the weekday when not today (“Thu 9 AM”); null otherwise.
 * Weather shows it as “Last known · Thu 9 AM”. The time is the last successful update, the same
 * instant the age line counts from. A fresh reading on a connected display is never qualified:
 * the server refreshes it on its own schedule (Air quality differs, see `airReadingView`).
 */
export function lastKnownTime(
  weather: Pick<WeatherState, 'current' | 'status' | 'updatedAt'>,
  disconnected: boolean,
  timeZone: string,
  clockFormat: '12h' | '24h',
  now: Date | number,
): string | null {
  if (!weather.current || (!disconnected && weather.status === 'fresh')) return null;
  const time = typeof now === 'number' ? now : now.getTime();
  const reading = Date.parse(weather.updatedAt ?? '');
  if (!Number.isFinite(reading) || time - reading <= LAST_KNOWN_AFTER_MS) return null;
  return lastKnownLabel(reading, time, timeZone, clockFormat);
}

export function forecastPeriod(
  start: string,
  end: string,
  timeZone: string,
  format: '12h' | '24h',
  now: Date | number,
): string {
  const today = civilDate(now, timeZone);
  const startDate = civilDate(new Date(start), timeZone);
  const endDate = civilDate(new Date(end), timeZone);
  const startDay =
    startDate === today ? '' : `${forecastDay(startDate, timeZone, now)} `;
  const endDay =
    endDate === startDate ? '' : `${forecastDay(endDate, timeZone, now)} `;
  return `${startDay}${weatherTime(start, timeZone, format)}–${endDay}${weatherTime(end, timeZone, format)}`;
}

export function weatherTime(
  timestamp: string,
  timeZone: string,
  format: '12h' | '24h',
): string {
  return dateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: format === '12h',
    timeZone,
  }).format(new Date(timestamp));
}

function clockParts(timestamp: string, timeZone: string) {
  const parts = dateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).formatToParts(new Date(timestamp));
  const part = (type: string) =>
    parts.find((value) => value.type === type)?.value ?? '';
  const minute = part('minute');
  return {
    time: minute === '00' ? part('hour') : `${part('hour')}:${minute}`,
    period: part('dayPeriod'),
  };
}

/**
 * A glanceable time: 12-hour times drop “:00” (“3 PM”, “3:30 PM”); 24-hour times stay whole. The
 * hour and AM/PM are joined by a no-break space, so a line never starts with AM/PM (#197).
 */
export function compactWeatherTime(
  timestamp: string,
  timeZone: string,
  format: '12h' | '24h',
): string {
  if (format === '24h') return weatherTime(timestamp, timeZone, format);
  const { time, period } = clockParts(timestamp, timeZone);
  return `${time}${NBSP}${period}`;
}

/** The hour a chart bar draws: an instant interval, as ISO strings. */
export interface ChartHour { start: string; end: string }

/**
 * The two axis labels under an hourly bar chart (#261), shared by Weather's rain chart and Air
 * quality's AQI chart: the left edge is the first bar's start, read “Now” when that bar's hour
 * contains `now`, and the right edge is the last bar's end. Compact hours in the place's zone, as in
 * the headlines (“3 PM”, “15:00”). Null without bars.
 */
export function chartAxisLabels(
  hours: readonly ChartHour[],
  now: Date | number,
  timeZone: string,
  format: '12h' | '24h',
): { start: string; end: string } | null {
  const first = hours[0], last = hours.at(-1);
  if (!first || !last) return null;
  const time = typeof now === 'number' ? now : now.getTime();
  const current = Date.parse(first.start) <= time && time < Date.parse(first.end);
  return {
    start: current ? 'Now' : compactWeatherTime(first.start, timeZone, format),
    end: compactWeatherTime(last.end, timeZone, format),
  };
}

/**
 * A glanceable range sharing AM/PM when both ends agree: “3–6 PM”, “11 AM–2 PM”, “15:00–18:00”.
 * Each end keeps its AM/PM, and a word joiner after the dash keeps the range on one line (#197).
 */
export function compactWeatherRange(
  start: string,
  end: string,
  timeZone: string,
  format: '12h' | '24h',
): string {
  const dash = `–${WORD_JOINER}`;
  if (format === '24h')
    return `${weatherTime(start, timeZone, format)}${dash}${weatherTime(end, timeZone, format)}`;
  const from = clockParts(start, timeZone);
  const to = clockParts(end, timeZone);
  return from.period === to.period
    ? `${from.time}${dash}${to.time}${NBSP}${to.period}`
    : `${from.time}${NBSP}${from.period}${dash}${to.time}${NBSP}${to.period}`;
}

export function nextComposition(current: number): number {
  return (current + 1) % 4;
}

export function localInputDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
