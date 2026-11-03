import type { Reminder, WeatherDetailReading, WeatherState, WorldClockCity } from '../shared/contracts.ts';
import { addDays, civilFromDate, daysBetween, formatCivil, todayCivil } from './calendar.ts';
import { dateTimeFormat } from './format.ts';

export const COLLECTION_WIDGET_IDS = ['timers', 'agenda', 'weekAhead', 'dayProgress', 'yearProgress', 'timeOverlap', 'weatherAlerts', 'hourlyTemperature', 'wind', 'humidity', 'pressure', 'visibility', 'cloudCover', 'precipitation', 'quietScene'] as const;
export function datedReminders(reminders: readonly Reminder[]): Reminder[] {
  return reminders.filter(item => !item.completed && item.dueAt && Number.isFinite(Date.parse(item.dueAt))).sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!) || a.id.localeCompare(b.id));
}
/** Civil dates, not 24-hour buckets, so reminders stay on the right day across DST. */
export function reminderWeek(reminders: readonly Reminder[], now: Date) {
  const dated = datedReminders(reminders), today = civilFromDate(now);
  return Array.from({ length: 7 }, (_, index) => {
    const civil = addDays(today, index), key = formatCivil(civil);
    return { key, label: dateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`)), day: civil.day, items: dated.filter(item => todayCivil(new Date(item.dueAt!)) === key) };
  });
}
export function dayProgress(now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return { elapsed: now.getTime() - start, remaining: end - now.getTime(), length: end - start, fraction: (now.getTime() - start) / (end - start) };
}
export function yearProgress(now: Date) {
  const today = civilFromDate(now), start = { year: today.year, month: 1, day: 1 }, next = { year: today.year + 1, month: 1, day: 1 };
  const elapsed = daysBetween(start, today), total = daysBetween(start, next);
  return { year: today.year, day: elapsed + 1, elapsed, total, remaining: total - elapsed - 1, fraction: (elapsed + dayProgress(now).fraction) / total };
}
/** A reference 09:00–17:00 weekday window; never a claim about a person's availability. */
export function timeOverlap(cities: readonly Pick<WorldClockCity, 'label' | 'timezone'>[], now: number, localZone: string) {
  const places = [{ label: 'Here', timezone: localZone }, ...cities];
  const inWindow = (at: number, timezone: string) => {
    const parts = dateTimeFormat('en', { timeZone: timezone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(at);
    const part = (name: string) => parts.find(item => item.type === name)!.value;
    return !['Sat', 'Sun'].includes(part('weekday')) && Number(part('hour')) >= 9 && Number(part('hour')) < 17;
  };
  // Every IANA UTC offset is on a 15-minute boundary. Ceil avoids suggesting a past start.
  const step = 15 * 60_000, first = Math.ceil(now / step) * step, limit = first + 48 * 3600_000;
  let start: number | null = null, end: number | null = null;
  for (let at = first; at <= limit; at += step) {
    const shared = at < limit && places.every(place => inWindow(at, place.timezone));
    if (shared && start === null) start = at;
    if (!shared && start !== null) { end = at; break; }
  }
  return { places, start, end };
}
/** Latest hourly instant no later than now; never relabel a future forecast as current. */
export function currentDetail(weather: WeatherState, now: number): WeatherDetailReading | null {
  return [...(weather.details ?? [])].filter(item => Date.parse(item.time) <= now).sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0] ?? null;
}
export function upcomingDetails(weather: WeatherState, now: number, count = 6): WeatherDetailReading[] {
  return (weather.details ?? []).filter(item => Date.parse(item.time) >= now && Date.parse(item.time) <= now + 24 * 3600_000).slice(0, count);
}
export function compass(degrees: number | null): string {
  if (degrees === null || !Number.isFinite(degrees)) return '—';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((degrees % 360 + 360) % 360) / 45) % 8]!;
}
export function distance(metres: number | null, imperial: boolean): string {
  if (metres === null) return '—';
  const value = metres / (imperial ? 1609.344 : 1000);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${imperial ? 'mi' : 'km'}`;
}
export function alertStartLabel(instant: string, timeZone: string, format: '12h' | '24h'): string {
  return dateTimeFormat('en', { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle: format === '12h' ? 'h12' : 'h23' }).format(new Date(instant));
}
