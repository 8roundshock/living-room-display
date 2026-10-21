import type { CountdownEvent, Reminder, Settings, WidgetId } from '../shared/contracts.ts';
import { isOverdue } from '../shared/reminders.ts';
import { WIDGET_CATALOG } from '../shared/widgets.ts';
import { addDays, civilFromDate, civilWeekday, compareCivil, daysInMonth, formatCivil, parseCivil, upcomingCountdowns, utcNoon, type CivilDate, type Weekday } from './calendar.ts';
import { dateTimeFormat } from './format.ts';
import { timeOfDay } from './timer.ts';

/**
 * Home's day-to-day model (#438): the Today list, quick due times, the calendar month and its keyboard
 * moves. Every day here is a civil day in this computer's time zone, like the Clock and reminders, and
 * every formatter comes from a cache, so a render on the one-second tick constructs no Intl object.
 */

type ClockFormat = Settings['clockFormat'];
const DAY = 86_400_000;

function utcFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat { return dateTimeFormat('en', { ...options, timeZone: 'UTC' }); }
/** The local civil day of an instant, as `YYYY-MM-DD`. */
export function localDayKey(at: Date | number): string { return formatCivil(civilFromDate(new Date(at))); }

// Today -----------------------------------------------------------------------------------------

export interface ComingUpItem {
  kind: 'reminder' | 'countdown';
  id: string;
  title: string;
  /** The local civil day it falls on. */
  day: string;
  /** Sort key: the reminder's instant, or the countdown's day at local midnight. */
  at: number;
  reminder?: Reminder;
  countdown?: CountdownEvent;
}
export interface TodayGroups {
  /** Pending reminders that are overdue or due later today: overdue first, then by time. */
  due: Reminder[];
  /** Up to three undated reminders, newest first, and how many more there are. */
  anytime: Reminder[];
  anytimeMore: number;
  /** Dated reminders after today and countdowns, within the next 7 days; at most 5, soonest first. */
  comingUp: ComingUpItem[];
  pending: number;
}
export const ANYTIME_SHOWN = 3, COMING_UP_DAYS = 7, COMING_UP_SHOWN = 5;

export function todayGroups(reminders: readonly Reminder[], countdowns: readonly CountdownEvent[], now: number): TodayGroups {
  const today = civilFromDate(new Date(now)), todayKey = formatCivil(today);
  const horizon = formatCivil(addDays(today, COMING_UP_DAYS));
  const pending = reminders.filter(item => !item.completed);
  const dated = pending.filter(item => item.dueAt && Number.isFinite(Date.parse(item.dueAt)));
  const due = dated
    .filter(item => isOverdue(item, now) || localDayKey(Date.parse(item.dueAt!)) === todayKey)
    .sort((a, b) => Number(isOverdue(b, now)) - Number(isOverdue(a, now)) || Date.parse(a.dueAt!) - Date.parse(b.dueAt!) || a.createdAt.localeCompare(b.createdAt));
  const undated = pending.filter(item => !item.dueAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const later: ComingUpItem[] = dated
    .filter(item => !due.includes(item))
    .map(item => ({ kind: 'reminder' as const, id: item.id, title: item.text, day: localDayKey(Date.parse(item.dueAt!)), at: Date.parse(item.dueAt!), reminder: item }))
    .filter(item => item.day > todayKey && item.day <= horizon);
  const events: ComingUpItem[] = upcomingCountdowns(countdowns, today)
    .filter(item => item.days <= COMING_UP_DAYS)
    .map(item => ({ kind: 'countdown' as const, id: item.event.id, title: item.event.title, day: formatCivil(item.date), at: new Date(item.date.year, item.date.month - 1, item.date.day).getTime(), countdown: item.event }));
  const comingUp = [...later, ...events].sort((a, b) => a.at - b.at || a.title.localeCompare(b.title, 'en')).slice(0, COMING_UP_SHOWN);
  return { due, anytime: undated.slice(0, ANYTIME_SHOWN), anytimeMore: Math.max(0, undated.length - ANYTIME_SHOWN), comingUp, pending: pending.length };
}

/** "Today", "Tomorrow" or "Fri, Oct 30" for a local civil day, relative to `now`. */
export function relativeDay(day: string, now: number): string {
  const date = parseCivil(day);
  if (!date) return day;
  const offset = Math.round((utcNoon(date) - utcNoon(civilFromDate(new Date(now)))) / DAY);
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  return shortDay(date);
}
/** "Fri, Oct 30" (with the year when it is not this year's, given `now`). */
export function shortDay(date: CivilDate, now?: number): string {
  const sameYear = now === undefined || date.year === new Date(now).getFullYear();
  return utcFormat({ weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(new Date(utcNoon(date)));
}
/** "Friday, October 30". */
export function longDay(date: CivilDate): string { return utcFormat({ weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(utcNoon(date))); }
/** "October 2026". */
export function monthTitle(year: number, month: number): string { return utcFormat({ month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1, 12))); }

// Quick due times -------------------------------------------------------------------------------

export type QuickWhen = 'anytime' | 'today' | 'tomorrow' | 'date';
const pad = (value: number) => String(value).padStart(2, '0');

/** The time field's default: the next whole hour for today (23:59 from 23:00 on), 9:00 AM for any other day. */
export function defaultTime(when: QuickWhen, now: number): string {
  if (when !== 'today') return '09:00';
  const hour = new Date(now).getHours();
  return hour >= 23 ? '23:59' : `${pad(hour + 1)}:00`;
}
/** The local civil day a quick choice means. */
export function quickDay(when: Exclude<QuickWhen, 'anytime' | 'date'>, now: number): string {
  const today = civilFromDate(new Date(now));
  return formatCivil(when === 'today' ? today : addDays(today, 1));
}

export interface DueAt {
  iso: string;
  /** The wall time actually saved differs from the one entered (a spring-forward gap). */
  shifted: boolean;
  /** The local wall time saved, as `HH:MM`. */
  saved: string;
}
/**
 * The instant for a local day and `HH:MM` wall time, in this computer's time zone. A time inside a
 * spring-forward gap does not exist: it is saved one hour later (2:30 → 3:30), and `shifted` says so.
 * The repeated autumn hour uses its first occurrence. Null for an unreadable day or time.
 */
export function dueAtFor(day: string, time: string): DueAt | null {
  const date = parseCivil(day), match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!date || !match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  // Date's local constructor moves a gap time forward by the gap and picks the earlier of a repeated hour.
  const at = new Date(date.year, date.month - 1, date.day, hours, minutes);
  const saved = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return { iso: at.toISOString(), shifted: saved !== time || localDayKey(at) !== day, saved };
}

/** "2:30 AM doesn't exist on Sun, Mar 8 (clocks spring forward). Saved for 3:30 AM." */
export function shiftedMessage(day: string, entered: string, due: DueAt, format: ClockFormat): string {
  const date = parseCivil(day)!;
  const [hours, minutes] = entered.split(':').map(Number) as [number, number];
  // The entered wall time on a day without a clock change, only to print it.
  const wall = timeOfDay(new Date(2000, 0, 1, hours, minutes), format);
  return `${wall} doesn't exist on ${shortDay(date)} (clocks spring forward). Saved for ${timeOfDay(new Date(due.iso), format)}.`;
}

/** "Fri, Oct 30 at 9:00 AM", or "today at 9:00 AM" / "tomorrow at 9:00 AM". */
export function dueSummary(iso: string, now: number, format: ClockFormat): string {
  const at = new Date(iso), day = relativeDay(localDayKey(at), now);
  return `${day === 'Today' || day === 'Tomorrow' ? day.toLowerCase() : day} at ${timeOfDay(at, format)}`;
}

// Calendar ----------------------------------------------------------------------------------------

export interface CalendarCell extends CivilDate { key: string; inMonth: boolean }
/**
 * The weeks a month needs (4–6), starting on `weekStart`, each with all seven real dates: days of the
 * neighbouring months fill the first and last weeks (Home shows them dim and clickable).
 */
export function monthGrid(year: number, month: number, weekStart: Weekday): CalendarCell[][] {
  const first = { year, month, day: 1 };
  const lead = (civilWeekday(first) - weekStart + 7) % 7;
  const start = addDays(first, -lead), weeks: CalendarCell[][] = [];
  for (let offset = 0; ; offset += 7) {
    const week = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, offset + index);
      return { ...date, key: formatCivil(date), inMonth: date.month === month && date.year === year };
    });
    if (!week.some(cell => cell.inMonth)) break;
    weeks.push(week);
  }
  return weeks;
}

/** A month later or earlier, with the day clamped to that month's length (January 31 → February 28). */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12), month = index - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** Where a grid key moves the focused day: a day or a week (crossing months), a month (clamped) or the week's edges. */
export function moveDay(date: CivilDate, key: string, weekStart: Weekday): CivilDate | null {
  switch (key) {
    case 'ArrowLeft': return addDays(date, -1);
    case 'ArrowRight': return addDays(date, 1);
    case 'ArrowUp': return addDays(date, -7);
    case 'ArrowDown': return addDays(date, 7);
    case 'PageUp': return addMonths(date, -1);
    case 'PageDown': return addMonths(date, 1);
    case 'Home': return addDays(date, -((civilWeekday(date) - weekStart + 7) % 7));
    case 'End': return addDays(date, 6 - ((civilWeekday(date) - weekStart + 7) % 7));
    default: return null;
  }
}

export interface DayMarks { count: number; overdue: boolean }
/** Pending dated reminders by the local day they fall on, with whether any of that day's are overdue. */
export function reminderMarks(reminders: readonly Reminder[], now: number): Map<string, DayMarks> {
  const marks = new Map<string, DayMarks>();
  for (const item of reminders) {
    if (item.completed || !item.dueAt || !Number.isFinite(Date.parse(item.dueAt))) continue;
    const key = localDayKey(Date.parse(item.dueAt)), mark = marks.get(key) ?? { count: 0, overdue: false };
    mark.count++; mark.overdue ||= isOverdue(item, now);
    marks.set(key, mark);
  }
  return marks;
}
/** A day cell's name: "Friday, October 30, 2 reminders". */
export function dayName(date: CivilDate, marks: DayMarks | undefined): string {
  const count = marks?.count ?? 0;
  return `${longDay(date)}${count ? `, ${count} reminder${count === 1 ? '' : 's'}` : ''}`;
}
/** Pending reminders due on a local day, by time. */
export function remindersOn(reminders: readonly Reminder[], day: string): Reminder[] {
  return reminders.filter(item => !item.completed && item.dueAt && localDayKey(Date.parse(item.dueAt)) === day).sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!));
}
/** True when a local day is before today. */
export function isPastDay(day: string, now: number): boolean {
  const date = parseCivil(day);
  return !!date && compareCivil(date, civilFromDate(new Date(now))) < 0;
}

// Display card ----------------------------------------------------------------------------------

/** Widgets Home's actions feed, in the order Home names them. */
export const HOME_WIDGETS: readonly WidgetId[] = ['clock', 'calendar', 'reminders', 'worldClocks', 'countdown', 'note'];
/** "Calendar, Clock and Weather": catalog names joined for a sentence. */
export function namesList(ids: readonly WidgetId[]): string {
  const names = ids.map(id => WIDGET_CATALOG[id].name);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
