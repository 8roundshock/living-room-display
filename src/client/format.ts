import type { WeatherState } from '../shared/contracts.ts';

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

export function temperature(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}°`;
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
  const today = civilDate(now, timeZone);
  return daily.find(day => day.date.slice(0, 10) === today);
}

/** A saved current reading older than this, while stale or offline, is qualified as last known (#243). */
export const LAST_KNOWN_AFTER_MS = 3 * 3_600_000;

/**
 * When a saved current reading more than three hours old was last known, while the forecast is stale
 * or the display is offline: “9 AM”, with the weekday when not today (“Thu 9 AM”); null otherwise.
 * Weather shows it as “Last known · Thu 9 AM”. The time is the last successful update, the same
 * instant the age line counts from.
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
  const date = civilDate(reading, timeZone);
  const day = date === civilDate(time, timeZone) ? '' : `${weekday(date)}${NBSP}`;
  return `${day}${compactWeatherTime(new Date(reading).toISOString(), timeZone, clockFormat)}`;
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
