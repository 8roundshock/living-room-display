/**
 * The Calendar's upcoming dates and grid marks (#716): the next holidays and important dates from data the
 * app already has, so there is nothing new to enter or save. Pure: no clock, no storage, no network.
 *
 * - Holidays: the observances of the holiday calendars chosen for themes (`src/shared/holidays.ts`), on each
 *   observance's own date under its short name.
 * - Birthdays: the saved month-day entries, on the exact day like the birthday scene (a February 29 birthday
 *   appears in leap years only).
 * - Countdown dates: `nextOccurrence`, as the Countdown widget counts them (a yearly February 29 date falls on
 *   February 28 in a common year; a one-time date that has passed is gone).
 * Reminders are not here: Reminders, Agenda and Week ahead show those.
 */
import { validBirthdayDate, type BirthdayEntry } from '../shared/birthdays.ts';
import type { CountdownEvent } from '../shared/contracts.ts';
import { observancesForYear, type HolidayRegion } from '../shared/holidays.ts';
import { addDays, compareCivil, daysBetween, daysInMonth, formatCivil, monthDay, nextOccurrence, type CivilDate } from './calendar.ts';

export interface DateSources {
  /** `appearance.theme.calendars`; an empty list means no holiday calendar. */
  calendars: readonly HolidayRegion[];
  birthdays: readonly BirthdayEntry[];
  countdowns: readonly CountdownEvent[];
}
export type DatedKind = 'birthday' | 'countdown' | 'holiday';
/** One dated item on its civil date. `name` is private content for a birthday or a countdown. */
export interface DatedItem { date: CivilDate; iso: string; name: string; kind: DatedKind }
export interface UpcomingDate extends DatedItem { /** Whole civil days from today; 0 is today. */ days: number }

/** How far ahead a date still counts as upcoming: about three months. Beyond it the Calendar shows no list. */
export const UPCOMING_HORIZON_DAYS = 90;
/** The longest name shown; a longer one is cut after a whole word (see `cleanCut`). */
export const UPCOMING_NAME_LENGTH = 32;

/** On one day: the user's own dates before public holidays, then by name. */
const KIND_ORDER: Record<DatedKind, number> = { birthday: 0, countdown: 1, holiday: 2 };
/** Observances that are one occasion under two ids: Russia's Spring and Labour Day is Korea's Labour Day (May 1). */
const SAME_OCCASION: Readonly<Record<string, string>> = { 'spring-labour': 'labour' };

/** How a saved birthday reads in the list: the name with “’s birthday”, unless the name already says so. */
export function birthdayName(name: string): string {
  const trimmed = name.trim();
  return /birthday/i.test(trimmed) ? trimmed : `${trimmed}’s birthday`;
}

/** Code-unit order, for ISO dates and observance ids. */
const byText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Names that differ only in case, spacing or the kind of apostrophe are the same name. */
function sameName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
}

interface Candidate extends DatedItem {
  /** Holidays keep the observance list's order on one day (Canada, Korea, Russia), so a shared occasion takes the first calendar's name. */
  order?: string;
  /** A second identity for holidays: the same observance in several calendars. */
  occasion?: string;
}

function holidays(calendars: readonly HolidayRegion[], from: CivilDate, to: CivilDate): Candidate[] {
  if (!calendars.length) return [];
  const first = formatCivil(from), last = formatCivil(to), items: Candidate[] = [];
  for (let year = from.year; year <= to.year; year++) for (const observance of observancesForYear(year, calendars)) {
    // ISO dates of one length sort as text.
    if (observance.date < first || observance.date > last) continue;
    const slug = observance.id.slice(observance.id.indexOf(':') + 1);
    items.push({ date: { year, month: Number(observance.date.slice(5, 7)), day: Number(observance.date.slice(8, 10)) }, iso: observance.date, name: observance.shortName, kind: 'holiday', order: observance.id, occasion: SAME_OCCASION[slug] ?? slug });
  }
  return items;
}

function birthdays(entries: readonly BirthdayEntry[], from: CivilDate, to: CivilDate): Candidate[] {
  const items: Candidate[] = [];
  for (const entry of entries) {
    // The editor's draft can hold a birthday with no name or date yet.
    if (!entry.name.trim() || !validBirthdayDate(entry.date)) continue;
    const month = Number(entry.date.slice(0, 2)), day = Number(entry.date.slice(3));
    for (let year = from.year; year <= to.year; year++) {
      // The exact civil day only, like the birthday scene: February 29 exists in leap years.
      if (day > daysInMonth(year, month)) continue;
      const date = { year, month, day };
      if (compareCivil(date, from) >= 0 && compareCivil(date, to) <= 0) items.push({ date, iso: formatCivil(date), name: birthdayName(entry.name), kind: 'birthday' });
    }
  }
  return items;
}

function countdowns(events: readonly CountdownEvent[], from: CivilDate, to: CivilDate): Candidate[] {
  const items: Candidate[] = [];
  for (const event of events) {
    const title = event.title.trim(), date = title ? nextOccurrence(event, from) : null;
    // A one-time date before `from` stays where it was, so it is out of range.
    if (date && compareCivil(date, from) >= 0 && compareCivil(date, to) <= 0) items.push({ date, iso: formatCivil(date), name: title, kind: 'countdown' });
  }
  return items;
}

/**
 * Every dated item from `from` to `to` inclusive (a span of up to a year), soonest first, each shown once:
 * the same observance in several calendars, and the same name on the same day from two sources, are one item.
 */
export function datedItems(sources: DateSources, from: CivilDate, to: CivilDate): DatedItem[] {
  if (compareCivil(from, to) > 0) return [];
  const candidates = [...birthdays(sources.birthdays, from, to), ...countdowns(sources.countdowns, from, to), ...holidays(sources.calendars, from, to)]
    .sort((a, b) => byText(a.iso, b.iso) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || byText(a.order ?? '', b.order ?? '') || a.name.localeCompare(b.name, 'en'));
  const seen = new Set<string>(), items: DatedItem[] = [];
  for (const { occasion, order: _order, ...item } of candidates) {
    const keys = [`${item.iso}|name|${sameName(item.name)}`, ...(occasion ? [`${item.iso}|occasion|${occasion}`] : [])];
    if (keys.some(key => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    items.push(item);
  }
  return items;
}

/** The dated items from today (included) through the horizon, soonest first, with their distance in days. */
export function upcomingDates(sources: DateSources, today: CivilDate, horizonDays = UPCOMING_HORIZON_DAYS): UpcomingDate[] {
  return datedItems(sources, today, addDays(today, horizonDays)).map(item => ({ ...item, days: daysBetween(today, item.date) }));
}

/** The days of one month that carry a dated item, with the names on each (past days of the month included). */
export function markedDays(sources: DateSources, year: number, month: number): Map<number, string[]> {
  const marks = new Map<number, string[]>();
  for (const item of datedItems(sources, { year, month, day: 1 }, { year, month, day: daysInMonth(year, month) })) {
    const names = marks.get(item.date.day);
    if (names) names.push(item.name); else marks.set(item.date.day, [item.name]);
  }
  return marks;
}

/**
 * A name of at most `limit` characters. A longer one is cut after the last whole word that fits and ends in
 * an ellipsis, never in the middle of a word; only a single word longer than the limit is cut inside.
 */
export function cleanCut(name: string, limit = UPCOMING_NAME_LENGTH): string {
  const characters = [...name.trim()];
  if (characters.length <= limit) return characters.join('');
  // The ellipsis takes one character; the character after the kept part decides whether its last word is whole.
  const room = limit - 1, head = characters.slice(0, room).join('');
  const whole = /\s/.test(characters[room]!) ? head : head.replace(/\S+$/, '');
  const kept = whole.replace(/[\s,;:·–—-]+$/, '');
  return `${kept || head}…`;
}

/** One line of the Calendar's list: the date as shown (“Today”, “Dec 25”) and the name as shown. */
export interface UpcomingRow { key: string; when: string; name: string; days: number }

/** What the Calendar shows for one civil day and one set of sources. */
export interface CalendarDates { upcoming: UpcomingRow[]; marks: Map<number, string[]> }

/** The upcoming rows with their display strings, and the marks of today's month. Build once per civil day. */
export function calendarDates(sources: DateSources, today: CivilDate): CalendarDates {
  const upcoming = upcomingDates(sources, today).map((item, index) => ({
    key: `${item.iso}:${item.kind}:${index}`, when: item.days === 0 ? 'Today' : monthDay(item.date), name: cleanCut(item.name), days: item.days,
  }));
  return { upcoming, marks: markedDays(sources, today.year, today.month) };
}

/** A text signature of the sources: equal signatures give equal `calendarDates`, whatever the array identities. */
export function sourcesSignature(sources: DateSources): string {
  return JSON.stringify([sources.calendars, sources.birthdays.map(entry => [entry.name, entry.date]), sources.countdowns.map(event => [event.title, event.date, event.repeatsYearly])]);
}
