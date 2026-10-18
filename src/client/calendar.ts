import type { CountdownEvent, WidgetDataSettings } from '../shared/contracts.ts';

/** 0 = Sunday … 6 = Saturday, like `Date#getDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type WeekStartSetting = WidgetDataSettings['calendar']['weekStart'];
/** A civil (wall-calendar) date with a 1-based month. */
export interface CivilDate { year: number; month: number; day: number }
export interface StripDay extends CivilDate { weekday: Weekday; today: boolean; past: boolean }

const DAY = 86_400_000;
const MONDAY: Weekday = 1;

/**
 * Reads the first day of the week from an `Intl.Locale` with feature detection: `getWeekInfo()`
 * (current engines) or the older `weekInfo` accessor. Both report 1 = Monday … 7 = Sunday.
 * Returns null when neither is available or the value is unusable.
 */
export function localeFirstDay(locale: unknown): Weekday | null {
  if (!locale || typeof locale !== 'object') return null;
  const source = locale as { getWeekInfo?: () => unknown; weekInfo?: unknown };
  let info: unknown;
  try { info = typeof source.getWeekInfo === 'function' ? source.getWeekInfo() : source.weekInfo; } catch { return null; }
  const firstDay = (info as { firstDay?: unknown } | undefined)?.firstDay;
  return typeof firstDay === 'number' && Number.isInteger(firstDay) && firstDay >= 1 && firstDay <= 7 ? (firstDay % 7) as Weekday : null;
}

/** The computer's preferred locale tag; English when the environment exposes none. */
export function preferredLocale(): string {
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.find(Boolean) ?? new Intl.DateTimeFormat().resolvedOptions().locale ?? 'en';
}

/** The locale's week start, falling back to Monday (ISO 8601) when the engine cannot say. */
export function localeWeekStart(tag: string = preferredLocale()): Weekday {
  try { return localeFirstDay(new Intl.Locale(tag)) ?? MONDAY; } catch { return MONDAY; }
}

/** Resolves the Calendar setting to a weekday; Automatic follows the computer's locale. */
export function weekStartDay(setting: WeekStartSetting, tag?: string): Weekday {
  return setting === 'sunday' ? 0 : setting === 'monday' ? 1 : localeWeekStart(tag);
}

export function weekdayName(day: Weekday, style: 'long' | 'short' | 'narrow' = 'long'): string {
  // 2023-01-01 was a Sunday; noon UTC is the same civil day in every zone.
  return new Intl.DateTimeFormat('en', { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + day, 12)));
}

/** Weekday labels in display order for a given week start. */
export function weekdayLabels(weekStart: Weekday, style: 'short' | 'narrow' = 'narrow'): string[] {
  return Array.from({ length: 7 }, (_, index) => weekdayName(((weekStart + index) % 7) as Weekday, style));
}

// Civil dates ---------------------------------------------------------------------------------

/** The computer's local civil date, like the Clock. */
export function civilFromDate(date: Date): CivilDate { return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }; }
export function formatCivil({ year, month, day }: CivilDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
/** Parses a strict YYYY-MM-DD civil date; null for anything else, including impossible days. */
export function parseCivil(value: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const civil = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return civil.month >= 1 && civil.month <= 12 && civil.day >= 1 && civil.day <= daysInMonth(civil.year, civil.month) ? civil : null;
}
export function todayCivil(now: Date): string { return formatCivil(civilFromDate(now)); }
export function isLeapYear(year: number): boolean { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
export function daysInMonth(year: number, month: number): number { return new Date(Date.UTC(year, month, 0, 12)).getUTCDate(); }
/** Noon UTC of a civil date: whole-day arithmetic on it can never be shifted by a DST change. */
export function utcNoon({ year, month, day }: CivilDate): number { return Date.UTC(year, month - 1, day, 12); }
export function civilWeekday(date: CivilDate): Weekday { return new Date(utcNoon(date)).getUTCDay() as Weekday; }
export function addDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(utcNoon(date) + days * DAY);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}
export function compareCivil(a: CivilDate, b: CivilDate): number { return utcNoon(a) - utcNoon(b); }
/** Whole civil days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: CivilDate, to: CivilDate): number { return Math.round((utcNoon(to) - utcNoon(from)) / DAY); }

// Calendar layout -----------------------------------------------------------------------------

/**
 * The month as weeks of day numbers, starting on `weekStart`. Days from neighbouring months are
 * null, and only the weeks the month needs are returned (4–6 rows).
 */
export function monthMatrix(year: number, month: number, weekStart: Weekday): (number | null)[][] {
  const lead = (civilWeekday({ year, month, day: 1 }) - weekStart + 7) % 7;
  const total = daysInMonth(year, month), weeks: (number | null)[][] = [];
  for (let start = 1 - lead; start <= total; start += 7) {
    weeks.push(Array.from({ length: 7 }, (_, index) => { const day = start + index; return day >= 1 && day <= total ? day : null; }));
  }
  return weeks;
}

/** The seven days of the week containing `today`, with real dates even across a month boundary. */
export function weekStrip(today: CivilDate, weekStart: Weekday): StripDay[] {
  const first = addDays(today, -((civilWeekday(today) - weekStart + 7) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(first, index), offset = daysBetween(today, date);
    return { ...date, weekday: civilWeekday(date), today: offset === 0, past: offset < 0 };
  });
}

// Countdowns ----------------------------------------------------------------------------------

/** A yearly date in `year`; February 29 becomes February 28 in a common year. */
export function anniversary(date: CivilDate, year: number): CivilDate {
  return { year, month: date.month, day: Math.min(date.day, daysInMonth(year, date.month)) };
}

/**
 * The date an event next falls on, on or after `today`. A one-time event keeps its date (which
 * may be past). A yearly event keeps its first date until it arrives, then rolls to the next
 * anniversary. Returns null for an unreadable date.
 */
export function nextOccurrence(event: Pick<CountdownEvent, 'date' | 'repeatsYearly'>, today: CivilDate): CivilDate | null {
  const date = parseCivil(event.date);
  if (!date) return null;
  if (!event.repeatsYearly || compareCivil(date, today) >= 0) return date;
  const thisYear = anniversary(date, today.year);
  return compareCivil(thisYear, today) >= 0 ? thisYear : anniversary(date, today.year + 1);
}

/** Whole days from today's civil date to `date` on this computer's calendar. */
export function daysUntil(date: CivilDate, now: Date): number { return daysBetween(civilFromDate(now), date); }

export interface UpcomingCountdown { event: CountdownEvent; date: CivilDate; days: number }

/** Upcoming events, soonest first (then title and id); past one-time events are excluded. */
export function upcomingCountdowns(events: readonly CountdownEvent[], today: CivilDate): UpcomingCountdown[] {
  return events.flatMap(event => {
    const date = nextOccurrence(event, today);
    if (!date) return [];
    const days = daysBetween(today, date);
    return days < 0 ? [] : [{ event, date, days }];
  }).sort((a, b) => a.days - b.days || a.event.title.localeCompare(b.event.title, 'en') || a.event.id.localeCompare(b.event.id));
}

/** True when a one-time event's date is before today (the editor labels it Passed). */
export function countdownPassed(event: Pick<CountdownEvent, 'date' | 'repeatsYearly'>, today: CivilDate): boolean {
  const date = nextOccurrence(event, today);
  return date !== null && compareCivil(date, today) < 0;
}

/** The count as shown: “Today”, “Tomorrow”, or a number with its unit. */
export function countdownLabel(days: number): { value: string; unit: string | null; text: string } {
  if (days === 0) return { value: 'Today', unit: null, text: 'Today' };
  if (days === 1) return { value: 'Tomorrow', unit: null, text: 'Tomorrow' };
  const value = new Intl.NumberFormat('en').format(days), unit = days === 1 ? 'day' : 'days';
  return { value, unit, text: `${value} ${unit}` };
}

/** “Sat, Oct 31”, with the year only when it is not the current one. */
export function countdownDate(date: CivilDate, today: CivilDate): string {
  return new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', ...(date.year === today.year ? {} : { year: 'numeric' }), timeZone: 'UTC' }).format(new Date(utcNoon(date)));
}

export function monthName(date: CivilDate, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat('en', { month: style, timeZone: 'UTC' }).format(new Date(utcNoon(date)));
}
