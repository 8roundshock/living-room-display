// Node runs each test file in its own process, so this zone applies to every Date below.
process.env.TZ = 'America/Toronto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BirthdayEntry } from '../shared/birthdays.ts';
import type { CountdownEvent } from '../shared/contracts.ts';
import { HOLIDAY_REGIONS, koreanCalendarAvailable, observancesForYear, type HolidayRegion } from '../shared/holidays.ts';
import { nextOccurrence, parseCivil, todayCivil, type CivilDate } from './calendar.ts';
import {
  UPCOMING_HORIZON_DAYS, UPCOMING_NAME_LENGTH, birthdayName, calendarDates, cleanCut, datedItems, markedDays, sourcesSignature, upcomingDates, type DateSources,
} from './calendar-dates.ts';

// Synthetic people and dates only: nothing here is anyone's real birthday or plan.
const civil = (value: string): CivilDate => { const parsed = parseCivil(value); assert.ok(parsed, value); return parsed; };
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
let next = 0;
const birthday = (name: string, date: string): BirthdayEntry => ({ id: uuid(++next), name, date, treatment: 'classic' });
const countdown = (title: string, date: string, repeatsYearly = false): CountdownEvent => ({ id: uuid(++next), title, date, repeatsYearly });
const sources = (calendars: readonly HolidayRegion[] = [], birthdays: BirthdayEntry[] = [], countdowns: CountdownEvent[] = []): DateSources => ({ calendars, birthdays, countdowns });
const lines = (items: readonly { iso: string; name: string }[]) => items.map(item => `${item.iso} ${item.name}`);
const upcoming = (from: DateSources, today: string) => lines(upcomingDates(from, civil(today)));

test('the next holidays of the chosen calendars, soonest first, each occasion once', () => {
  assert.ok(koreanCalendarAvailable(), 'this runtime has the Korean lunar calendar');
  // Christmas is in the Canadian and the Korean calendar, New Year in all three: one line each, under the first calendar's name.
  assert.deepEqual(upcoming(sources(HOLIDAY_REGIONS), '2026-11-22'), [
    '2026-12-25 Christmas', '2026-12-26 Boxing Day', '2027-01-01 New Year’s Day', '2027-01-07 Orthodox Christmas', '2027-01-14 Old New Year',
    '2027-02-07 Seollal', '2027-02-14 Valentine’s Day', '2027-02-15 Flag Day',
  ]);
  assert.deepEqual(upcoming(sources(['RU']), '2026-11-22'), ['2027-01-01 New Year holidays', '2027-01-07 Orthodox Christmas', '2027-01-14 Old New Year'], 'Russia alone keeps its own name for January 1');
  assert.deepEqual(upcoming(sources(['KR']), '2026-11-22'), ['2026-12-25 Christmas', '2027-01-01 New Year’s Day', '2027-02-07 Seollal']);
  assert.deepEqual(upcoming(sources(['CA']), '2026-10-18').slice(0, 3), ['2026-10-31 Halloween', '2026-11-11 Remembrance Day', '2026-12-25 Christmas']);
  assert.deepEqual(upcoming(sources([]), '2026-11-22'), [], 'no calendar chosen: no holiday');
  // The observance's short name, and its own date: Seollal's day, not the day before that its holiday starts on.
  assert.deepEqual(upcoming(sources(['CA']), '2026-09-20').slice(0, 2), ['2026-09-30 Truth and Reconciliation', '2026-10-12 Thanksgiving']);
  assert.deepEqual(upcoming(sources(['KR']), '2027-02-06').slice(0, 1), ['2027-02-07 Seollal']);
  assert.deepEqual(upcoming(sources(['KR']), '2027-02-08').slice(0, 1), ['2027-02-21 First Full Moon'], 'the day after Seollal it is gone, though its holiday still runs');
});

test('one occasion in two calendars shows once; different occasions on one day both show', () => {
  // May 1 is Labour Day in Korea and Spring and Labour Day in Russia.
  assert.deepEqual(upcoming(sources(['KR', 'RU']), '2027-04-28').slice(0, 2), ['2027-05-01 Labour Day', '2027-05-02 Orthodox Easter']);
  assert.deepEqual(upcoming(sources(['RU']), '2027-04-28').slice(0, 1), ['2027-05-01 Spring and Labour Day']);
  // In 2028 Easter and Orthodox Easter fall on the same Sunday, April 16.
  assert.deepEqual(upcoming(sources(['CA', 'RU']), '2028-04-15').slice(0, 2), ['2028-04-16 Easter', '2028-04-17 Easter Monday']);
  // In 2027 they are five weeks apart and both show.
  assert.deepEqual(lines(datedItems(sources(['CA', 'RU']), civil('2027-03-28'), civil('2027-05-02'))).filter(line => /Easter$/.test(line)), ['2027-03-28 Easter', '2027-05-02 Orthodox Easter']);
  // In 2025 Buddha's Birthday fell on Children's Day: two occasions, two lines.
  assert.deepEqual(upcoming(sources(['KR']), '2025-05-04').slice(0, 2), ['2025-05-05 Buddha’s Birthday', '2025-05-05 Children’s Day']);
});

test('birthdays: the exact day every year, today included, across the turn of the year', () => {
  const people = [birthday('Mina', '11-28'), birthday('Alex', '12-12'), birthday('Sam', '01-03'), birthday('Robin', '11-22'), birthday('Past', '11-21')];
  assert.deepEqual(upcoming(sources([], people), '2026-11-22'), ['2026-11-22 Robin’s birthday', '2026-11-28 Mina’s birthday', '2026-12-12 Alex’s birthday', '2027-01-03 Sam’s birthday'],
    'today counts; yesterday waits for next year, beyond the horizon');
  assert.equal(upcomingDates(sources([], people), civil('2026-11-22'))[0]!.days, 0);
  assert.deepEqual(upcoming(sources([], people), '2026-12-28'), ['2027-01-03 Sam’s birthday'], 'December sees January');
  assert.deepEqual(upcoming(sources([], people), '2026-12-31').map(line => line.slice(0, 10)), ['2027-01-03']);
  assert.deepEqual(upcoming(sources([], people), '2027-01-01').map(line => line.slice(0, 10)), ['2027-01-03']);
  // The editor's draft can hold an unfinished entry; it is skipped, never drawn as "’s birthday".
  assert.deepEqual(upcoming(sources([], [birthday('', '11-25'), birthday('   ', '11-26'), birthday('Draft', '-'), birthday('Draft', '02-30'), birthday('Whole', '11-27')]), '2026-11-22'), ['2026-11-27 Whole’s birthday']);
  assert.equal(birthdayName(' Mina '), 'Mina’s birthday');
  assert.equal(birthdayName('Chris'), 'Chris’s birthday');
  assert.equal(birthdayName('Mina’s Birthday'), 'Mina’s Birthday', 'a name that already says birthday is kept as written');
});

test('a February 29 birthday appears in leap years only, like the birthday scene', () => {
  const leap = sources([], [birthday('Leap', '02-29')]);
  assert.deepEqual(upcoming(leap, '2027-02-01'), [], 'no February 29 in 2027, and no stand-in day');
  assert.deepEqual([...markedDays(leap, 2027, 2).keys()], []);
  assert.deepEqual(upcoming(leap, '2028-02-01'), ['2028-02-29 Leap’s birthday']);
  assert.deepEqual(upcoming(leap, '2027-12-15'), ['2028-02-29 Leap’s birthday'], 'seen from the December before');
  assert.deepEqual(upcoming(leap, '2028-02-29'), ['2028-02-29 Leap’s birthday']);
  assert.deepEqual(upcoming(leap, '2028-03-01'), []);
  assert.deepEqual([...markedDays(leap, 2028, 2)], [[29, ['Leap’s birthday']]]);
});

test('countdown dates use the Countdown widget’s next occurrence', () => {
  const events = [
    countdown('Trip', '2026-12-05'), countdown('Passed', '2026-11-21'), countdown('Anniversary', '2001-11-30', true), countdown('Later this year', '2000-01-10', true),
    countdown('Leap yearly', '2024-02-29', true), countdown('Not yet started', '2030-12-01', true), countdown('Far', '2027-06-01'), countdown('  ', '2026-11-25'), countdown('Unreadable', '2026-02-30'),
  ];
  const today = civil('2026-11-22'), list = upcomingDates(sources([], [], events), today);
  assert.deepEqual(lines(list), ['2026-11-30 Anniversary', '2026-12-05 Trip', '2027-01-10 Later this year'],
    'a passed one-time date, a blank title, an unreadable date and dates beyond the horizon are left out');
  for (const item of list) {
    const event = events.find(candidate => candidate.title === item.name)!;
    assert.deepEqual(item.date, nextOccurrence(event, today), `${item.name} is on the date Countdown counts to`);
  }
  // A yearly February 29 date falls on February 28 in a common year (Countdown's rule) and on the 29th in a leap year.
  assert.deepEqual(upcoming(sources([], [], events), '2027-02-01').filter(line => /Leap/.test(line)), ['2027-02-28 Leap yearly']);
  assert.deepEqual(upcoming(sources([], [], events), '2028-02-01').filter(line => /Leap/.test(line)), ['2028-02-29 Leap yearly']);
  assert.deepEqual(upcoming(sources([], [], [countdown('Today', '2026-11-22')]), '2026-11-22'), ['2026-11-22 Today']);
});

test('the three sources merge: soonest first, your own dates before holidays on one day, the same name once', () => {
  const merged = sources(['CA'], [birthday('Mina', '12-25'), birthday('Alex', '12-12')], [
    countdown('christmas', '2026-12-25'), countdown('Alex\'s  Birthday', '2000-12-12', true), countdown('Gifts wrapped', '2026-12-25'), countdown('Boxing day', '2026-12-26'),
  ]);
  assert.deepEqual(upcomingDates(merged, civil('2026-12-01')).map(item => `${item.iso} ${item.name} (${item.kind})`), [
    '2026-12-12 Alex’s birthday (birthday)',
    '2026-12-25 Mina’s birthday (birthday)', '2026-12-25 christmas (countdown)', '2026-12-25 Gifts wrapped (countdown)',
    '2026-12-26 Boxing day (countdown)',
    '2027-01-01 New Year’s Day (holiday)', '2027-02-14 Valentine’s Day (holiday)', '2027-02-15 Flag Day (holiday)',
  ], 'a countdown named like the holiday or the birthday of the same day replaces nothing and adds nothing');
});

test('upcoming means today through the horizon', () => {
  assert.equal(UPCOMING_HORIZON_DAYS, 90);
  const at = (date: string) => sources([], [], [countdown('Edge', date)]);
  assert.deepEqual(upcomingDates(at('2027-02-20'), civil('2026-11-22')).map(item => item.days), [90], 'the last day in range');
  assert.deepEqual(upcomingDates(at('2027-02-21'), civil('2026-11-22')), [], 'one day beyond');
  assert.deepEqual(upcomingDates(at('2026-11-22'), civil('2026-11-22')).map(item => item.days), [0]);
  assert.deepEqual(upcomingDates(at('2026-11-21'), civil('2026-11-22')), []);
  // Russia's calendar has no observance between Russia Day and Unity Day: nothing is in range in July.
  assert.deepEqual(upcoming(sources(['RU']), '2026-07-01'), []);
  assert.deepEqual(upcoming(sources(['RU']), '2026-08-06'), ['2026-11-04 Unity Day'], '90 days before');
  // Every day of two years with all three calendars has something upcoming, and the list stays in date order.
  for (let day = civil('2026-01-01'), index = 0; index < 730; index++) {
    const list = upcomingDates(sources(HOLIDAY_REGIONS), day);
    assert.ok(list.length > 0, `${day.year}-${day.month}-${day.day} has an upcoming holiday`);
    assert.deepEqual(list.map(item => item.days), [...list].map(item => item.days).sort((a, b) => a - b));
    assert.ok(list.every(item => item.days >= 0 && item.days <= UPCOMING_HORIZON_DAYS));
    assert.equal(new Set(list.map(item => `${item.iso}|${item.name}`)).size, list.length, 'no line twice');
    const tomorrow = new Date(Date.UTC(day.year, day.month - 1, day.day + 1, 12));
    day = { year: tomorrow.getUTCFullYear(), month: tomorrow.getUTCMonth() + 1, day: tomorrow.getUTCDate() };
  }
});

test('the month’s marked days agree with the list and include the days already past', () => {
  const december = sources(HOLIDAY_REGIONS, [birthday('Mina', '12-03'), birthday('Sam', '01-03')], [countdown('Trip', '2026-12-05'), countdown('Yearly', '2010-12-09', true), countdown('Passed', '2026-12-01'), countdown('Next year', '2027-12-20')]);
  assert.deepEqual([...markedDays(december, 2026, 12)], [
    [1, ['Passed']], [3, ['Mina’s birthday']], [5, ['Trip']], [9, ['Yearly']], [25, ['Christmas']], [26, ['Boxing Day']],
  ], 'whatever today is: a passed one-time date keeps its (dimmer) mark for the month');
  assert.deepEqual([...markedDays(december, 2027, 1).keys()], [1, 3, 7, 14], 'January 2027: New Year, a birthday, Orthodox Christmas, Old New Year');
  assert.deepEqual(markedDays(december, 2027, 1).get(1), ['New Year’s Day']);
  assert.deepEqual([...markedDays(december, 2027, 12).keys()], [3, 9, 20, 25, 26], 'the one-time dates of 2026 are gone a year later; the 2027 one has arrived');
  assert.deepEqual([...markedDays(sources(), 2026, 12)], []);
  // Every upcoming date inside today's month has its mark.
  const today = civil('2026-12-02'), marks = markedDays(december, 2026, 12);
  for (const item of upcomingDates(december, today)) if (item.date.month === 12 && item.date.year === 2026) assert.ok(marks.get(item.date.day)?.includes(item.name), `${item.iso} ${item.name} is marked`);
  // Two items on one day: one mark, both names.
  assert.deepEqual(markedDays(sources(['KR']), 2025, 5).get(5), ['Buddha’s Birthday', 'Children’s Day']);
});

test('a long name is cut after a whole word, never inside one', () => {
  assert.equal(UPCOMING_NAME_LENGTH, 32);
  assert.equal(cleanCut('Christmas'), 'Christmas');
  assert.equal(cleanCut('Truth and Reconciliation'), 'Truth and Reconciliation', 'the longest holiday short names fit');
  assert.equal(cleanCut('Exactly thirty-two characters ok'), 'Exactly thirty-two characters ok');
  assert.equal(cleanCut('A deliberately long synthetic countdown title that goes on'), 'A deliberately long synthetic…');
  assert.equal(cleanCut('Exactly thirty-two characters okk'), 'Exactly thirty-two characters…');
  assert.equal(cleanCut('Dinner with the neighbours, then the late film'), 'Dinner with the neighbours…', 'no dangling comma before the ellipsis');
  assert.equal(cleanCut('Thirty-one characters then a word'), 'Thirty-one characters then a…', 'the cut falls on a space: the word before it is whole');
  assert.equal(cleanCut('Supercalifragilisticexpialidociousandmorelettershere'), 'Supercalifragilisticexpialidoci…', 'only a single word longer than the limit is cut inside');
  assert.equal(cleanCut('  padded  '), 'padded');
  assert.equal(cleanCut('Twelve chars and more', 12), 'Twelve…');
  for (const name of ['A deliberately long synthetic countdown title that goes on', 'Supercalifragilisticexpialidociousandmorelettershere', '가'.repeat(40), '🎂'.repeat(40)]) {
    assert.ok([...cleanCut(name)].length <= UPCOMING_NAME_LENGTH, `${name} stays within the limit`);
  }
  assert.equal(cleanCut('🎂'.repeat(40)), `${'🎂'.repeat(31)}…`, 'counted by character, so an emoji is never halved');
});

test('every bundled holiday short name shows whole', () => {
  for (const year of [2026, 2027, 2028]) for (const observance of observancesForYear(year)) {
    assert.ok([...observance.shortName].length <= UPCOMING_NAME_LENGTH, `${observance.id} “${observance.shortName}” fits the Calendar’s line`);
    assert.equal(cleanCut(observance.shortName), observance.shortName);
  }
});

test('the Calendar’s rows: Today, short dates with no year, cut names, and marks for today’s month', () => {
  const dates = calendarDates(sources(HOLIDAY_REGIONS, [birthday('Mina', '12-28')], [countdown('A deliberately long synthetic countdown title that goes on', '2026-12-30')]), civil('2026-12-25'));
  assert.deepEqual(dates.upcoming.slice(0, 5).map(row => [row.when, row.name, row.days]), [
    ['Today', 'Christmas', 0], ['Dec 26', 'Boxing Day', 1], ['Dec 28', 'Mina’s birthday', 3], ['Dec 30', 'A deliberately long synthetic…', 5], ['Jan 1', 'New Year’s Day', 7],
  ]);
  assert.equal(new Set(dates.upcoming.map(row => row.key)).size, dates.upcoming.length, 'row keys are unique');
  assert.deepEqual([...dates.marks.keys()], [25, 26, 28, 30], 'December only: January 1 is in the list, not on this month’s grid');
  assert.deepEqual(calendarDates(sources(), civil('2026-12-25')), { upcoming: [], marks: new Map() }, 'nothing in range: no list and no marks');
});

test('the signature follows the content of the sources, not the identity of their arrays', () => {
  const people = [birthday('Mina', '12-28')], events = [countdown('Trip', '2026-12-05')];
  const first = sourcesSignature(sources(['CA', 'KR'], people, events));
  assert.equal(sourcesSignature(sources(['CA', 'KR'], structuredClone(people), structuredClone(events))), first, 'a state refresh with the same content');
  assert.equal(sourcesSignature(sources(['CA', 'KR'], [{ ...people[0]!, treatment: 'korean' }], events)), first, 'the scene treatment does not change the Calendar');
  assert.notEqual(sourcesSignature(sources(['CA'], people, events)), first);
  assert.notEqual(sourcesSignature(sources(['CA', 'KR'], [{ ...people[0]!, name: 'Sam' }], events)), first);
  assert.notEqual(sourcesSignature(sources(['CA', 'KR'], people, [{ ...events[0]!, repeatsYearly: true }])), first);
});

test('civil dates follow this computer’s local zone: the list changes at local midnight', () => {
  // 04:30 UTC on December 26 is still 23:30 on Christmas Day in Toronto.
  const evening = todayCivil(new Date('2026-12-26T04:30:00Z')), morning = todayCivil(new Date('2026-12-26T05:30:00Z'));
  assert.deepEqual([evening, morning], ['2026-12-25', '2026-12-26']);
  const canada = sources(['CA']);
  assert.deepEqual(calendarDates(canada, civil(evening)).upcoming.slice(0, 2).map(row => `${row.when} ${row.name}`), ['Today Christmas', 'Dec 26 Boxing Day']);
  assert.deepEqual(calendarDates(canada, civil(morning)).upcoming.slice(0, 2).map(row => `${row.when} ${row.name}`), ['Today Boxing Day', 'Jan 1 New Year’s Day']);
});
