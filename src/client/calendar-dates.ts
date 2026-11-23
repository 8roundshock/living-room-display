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
/**
 * One dated item on its civil date. `name` is the whole name (private content for a birthday or a countdown);
 * `line` is the name as one line of the Calendar shows it, cut when it is too long.
 */
export interface DatedItem { date: CivilDate; iso: string; name: string; line: string; kind: DatedKind }
export interface UpcomingDate extends DatedItem { /** Whole civil days from today; 0 is today. */ days: number }

/** How far ahead a date still counts as upcoming: about three months. Beyond it the Calendar shows no list. */
export const UPCOMING_HORIZON_DAYS = 90;
/**
 * The room a name has on one line, counted in letters. A wide character (Hangul, kana, CJK ideographs, full-width
 * forms, emoji) counts as two, because it is about twice as wide as a Latin or Cyrillic letter.
 */
export const UPCOMING_NAME_LENGTH = 32;

/** On one day: the user's own dates before public holidays, then by name. */
const KIND_ORDER: Record<DatedKind, number> = { birthday: 0, countdown: 1, holiday: 2 };
/** Observances that are one occasion under two ids: Russia's Spring and Labour Day is Korea's Labour Day (May 1). */
const SAME_OCCASION: Readonly<Record<string, string>> = { 'spring-labour': 'labour' };

// One line of text ---------------------------------------------------------------------------------

let segmenter: Intl.Segmenter | null | undefined;
/** The characters as a reader sees them, so a cut never separates a combining mark or the parts of a joined emoji. */
function characters(text: string): string[] {
  if (segmenter === undefined) segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  return segmenter ? Array.from(segmenter.segment(text), part => part.segment) : [...text];
}
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u;
const width = (character: string) => WIDE.test(character) ? 2 : 1;
/** The room `text` takes on a line, in the units of UPCOMING_NAME_LENGTH. */
export function lineWidth(text: string): number {
  return characters(text).reduce((sum, character) => sum + width(character), 0);
}

/**
 * `name` as one line of at most `limit` units. A longer name ends in an ellipsis, which takes one unit. The cut
 * falls after the last whole word that fits when that keeps at least half the line; otherwise (one long word, or a
 * short word before a long one) it falls inside the word, so the line is never reduced to a stub. No space, full
 * stop, comma or dash is left before the ellipsis.
 */
export function cleanCut(name: string, limit = UPCOMING_NAME_LENGTH): string {
  const parts = characters(name.trim());
  if (parts.reduce((sum, part) => sum + width(part), 0) <= limit) return parts.join('');
  let used = 0, count = 0;
  while (used + width(parts[count]!) <= limit - 1) used += width(parts[count++]!);
  const head = parts.slice(0, count).join(''), tidy = (text: string) => text.replace(/[\s.,;:·–—-]+$/, '');
  // The character after the part that fits says whether its last word is whole.
  const words = tidy(/\s/.test(parts[count]!) ? head : head.replace(/\S+$/, ''));
  return `${lineWidth(words) * 2 >= limit ? words : tidy(head)}…`;
}

/** A saved birthday's whole name: the person's name with “’s birthday”, unless the name already says birthday. */
export function birthdayName(name: string): string {
  const trimmed = name.trim();
  return /birthday/i.test(trimmed) ? trimmed : `${trimmed}’s birthday`;
}

/**
 * A saved birthday as one line: “Mina’s birthday” when that fits. When it does not, the line is the person's name
 * alone, cut like any other name, so a possessive is never left without its word (“Alexandra’s…”).
 */
export function birthdayLine(name: string, limit = UPCOMING_NAME_LENGTH): string {
  const whole = birthdayName(name);
  return lineWidth(whole) <= limit ? whole : cleanCut(name, limit);
}

// Dated items --------------------------------------------------------------------------------------

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
    items.push({
      date: { year, month: Number(observance.date.slice(5, 7)), day: Number(observance.date.slice(8, 10)) }, iso: observance.date,
      name: observance.shortName, line: cleanCut(observance.shortName), kind: 'holiday', order: observance.id, occasion: SAME_OCCASION[slug] ?? slug,
    });
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
      if (compareCivil(date, from) >= 0 && compareCivil(date, to) <= 0) items.push({ date, iso: formatCivil(date), name: birthdayName(entry.name), line: birthdayLine(entry.name), kind: 'birthday' });
    }
  }
  return items;
}

function countdowns(events: readonly CountdownEvent[], from: CivilDate, to: CivilDate): Candidate[] {
  const items: Candidate[] = [];
  for (const event of events) {
    const title = event.title.trim(), date = title ? nextOccurrence(event, from) : null;
    // A one-time date before `from` stays where it was, so it is out of range.
    if (date && compareCivil(date, from) >= 0 && compareCivil(date, to) <= 0) items.push({ date, iso: formatCivil(date), name: title, line: cleanCut(title), kind: 'countdown' });
  }
  return items;
}

/**
 * Every dated item from `from` to `to` inclusive (a span of up to a year), soonest first, each shown once.
 * Candidates of one day that share a name or an occasion, directly or through another candidate, are one item:
 * the first in order is shown and stands for the others. So one observance in several calendars is one item, the
 * same name from two sources is one item, and a countdown called “New Year’s Day” also stands for Russia's
 * “New Year holidays”, which is the same occasion as the Canadian day of that name.
 */
export function datedItems(sources: DateSources, from: CivilDate, to: CivilDate): DatedItem[] {
  if (compareCivil(from, to) > 0) return [];
  const candidates = [...birthdays(sources.birthdays, from, to), ...countdowns(sources.countdowns, from, to), ...holidays(sources.calendars, from, to)]
    .sort((a, b) => byText(a.iso, b.iso) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || byText(a.order ?? '', b.order ?? '') || a.name.localeCompare(b.name, 'en'));
  const groups: { item: DatedItem; keys: Set<string> }[] = [];
  for (const { occasion, order: _order, ...item } of candidates) {
    const keys = [`${item.iso}|name|${sameName(item.name)}`, ...(occasion ? [`${item.iso}|occasion|${occasion}`] : [])];
    const [first, ...others] = groups.filter(group => keys.some(key => group.keys.has(key)));
    if (!first) { groups.push({ item, keys: new Set(keys) }); continue; }
    // The candidate joins the first group it matches; groups it links to that one are the same item too.
    for (const key of keys) first.keys.add(key);
    for (const other of others) { for (const key of other.keys) first.keys.add(key); groups.splice(groups.indexOf(other), 1); }
  }
  return groups.map(group => group.item);
}

/** The dated items from today (included) through the horizon, soonest first, with their distance in days. */
export function upcomingDates(sources: DateSources, today: CivilDate, horizonDays = UPCOMING_HORIZON_DAYS): UpcomingDate[] {
  return datedItems(sources, today, addDays(today, horizonDays)).map(item => ({ ...item, days: daysBetween(today, item.date) }));
}

/** The days of one month that carry a dated item, with the whole names on each (past days of the month included). */
export function markedDays(sources: DateSources, year: number, month: number): Map<number, string[]> {
  const marks = new Map<number, string[]>();
  for (const item of datedItems(sources, { year, month, day: 1 }, { year, month, day: daysInMonth(year, month) })) {
    const names = marks.get(item.date.day);
    if (names) names.push(item.name); else marks.set(item.date.day, [item.name]);
  }
  return marks;
}

/** One line of the Calendar's list: the date as shown (“Today”, “Dec 25”) and the name as shown. */
export interface UpcomingRow { key: string; when: string; name: string; days: number }

/** What the Calendar shows for one civil day and one set of sources. */
export interface CalendarDates { upcoming: UpcomingRow[]; marks: Map<number, string[]> }

/** The upcoming rows with their display strings, and the marks of today's month. Build once per civil day. */
export function calendarDates(sources: DateSources, today: CivilDate): CalendarDates {
  // A day holds one item per name, so date, kind and name identify a row from one day to the next.
  const upcoming = upcomingDates(sources, today).map(item => ({
    key: `${item.iso}:${item.kind}:${item.name}`, when: item.days === 0 ? 'Today' : monthDay(item.date), name: item.line, days: item.days,
  }));
  return { upcoming, marks: markedDays(sources, today.year, today.month) };
}

/** A text signature of the sources: equal signatures give equal `calendarDates`, whatever the array identities. */
export function sourcesSignature(sources: DateSources): string {
  return JSON.stringify([sources.calendars, sources.birthdays.map(entry => [entry.name, entry.date]), sources.countdowns.map(event => [event.title, event.date, event.repeatsYearly])]);
}
