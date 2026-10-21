// Node runs each test file in its own process, so this zone applies to every Date below.
process.env.TZ = 'America/Toronto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { CountdownEvent } from '../shared/contracts.ts';
import {
  calendarView, countdownDate, countdownLabel, countdownPassed, countdownRows, daysBetween, daysInMonth, daysUntil, localeFirstDay, localeWeekStart,
  monthMatrix, monthName, nextOccurrence, parseCivil, todayCivil, upcomingCountdowns, weekStartDay, weekStrip, weekdayLabels, weekdayName, type CivilDate,
} from './calendar.ts';

type IntlName = 'DateTimeFormat' | 'NumberFormat' | 'Locale' | 'PluralRules' | 'RelativeTimeFormat';
/** Counts every Intl constructor call (with or without `new`) while `run` executes. */
function intlConstructions(run: () => void): Record<IntlName, number> {
  const names: IntlName[] = ['DateTimeFormat', 'NumberFormat', 'Locale', 'PluralRules', 'RelativeTimeFormat'];
  const counts = Object.fromEntries(names.map(name => [name, 0])) as Record<IntlName, number>;
  const intl = Intl as unknown as Record<IntlName, new (...args: unknown[]) => object>;
  const originals = Object.fromEntries(names.map(name => [name, intl[name]])) as Record<IntlName, new (...args: unknown[]) => object>;
  for (const name of names) {
    intl[name] = new Proxy(originals[name], {
      construct(target, args) { counts[name]++; return Reflect.construct(target, args); },
      apply(target, self, args) { counts[name]++; return Reflect.apply(target as unknown as (...values: unknown[]) => unknown, self, args); },
    });
  }
  try { run(); } finally { for (const name of names) intl[name] = originals[name]; }
  return counts;
}
const none = { DateTimeFormat: 0, NumberFormat: 0, Locale: 0, PluralRules: 0, RelativeTimeFormat: 0 };

const civil = (value: string): CivilDate => { const parsed = parseCivil(value); assert.ok(parsed, value); return parsed; };
const event = (title: string, date: string, repeatsYearly = false, id = `00000000-0000-4000-8000-${title.length.toString().padStart(12, '0')}`): CountdownEvent => ({ id, title, date, repeatsYearly });
const _ = null;

test('February 2026 and February 2028 with both week starts', () => {
  // 1 Feb 2026 is a Sunday and the month has 28 days: exactly four Sunday-start rows.
  assert.deepEqual(monthMatrix(2026, 2, 0), [
    [1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14], [15, 16, 17, 18, 19, 20, 21], [22, 23, 24, 25, 26, 27, 28],
  ]);
  assert.deepEqual(monthMatrix(2026, 2, 1), [
    [_, _, _, _, _, _, 1], [2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15], [16, 17, 18, 19, 20, 21, 22], [23, 24, 25, 26, 27, 28, _],
  ]);
  // 2028 is a leap year; 1 Feb 2028 is a Tuesday.
  assert.equal(daysInMonth(2028, 2), 29);
  assert.deepEqual(monthMatrix(2028, 2, 0), [
    [_, _, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11, 12], [13, 14, 15, 16, 17, 18, 19], [20, 21, 22, 23, 24, 25, 26], [27, 28, 29, _, _, _, _],
  ]);
  assert.deepEqual(monthMatrix(2028, 2, 1), [
    [_, 1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12, 13], [14, 15, 16, 17, 18, 19, 20], [21, 22, 23, 24, 25, 26, 27], [28, 29, _, _, _, _, _],
  ]);
});

test('months take only the 4, 5 or 6 rows they need', () => {
  assert.equal(monthMatrix(2026, 2, 0).length, 4);
  assert.equal(monthMatrix(2026, 10, 0).length, 5, 'October 2026 starts on a Thursday');
  assert.equal(monthMatrix(2026, 8, 0).length, 6, 'August 2026 starts on a Saturday and has 31 days');
  assert.equal(monthMatrix(2026, 3, 1).length, 6, 'March 2026 starts on a Sunday, the last Monday-start column');
  for (let month = 1; month <= 12; month++) for (const start of [0, 1, 6] as const) {
    const weeks = monthMatrix(2026, month, start), days = weeks.flat().filter(day => day !== null);
    assert.deepEqual(days, Array.from({ length: daysInMonth(2026, month) }, (_, index) => index + 1), `${month}/${start} lists every day once`);
    assert.ok(weeks[0]!.some(day => day !== null) && weeks.at(-1)!.some(day => day !== null), 'no empty leading or trailing week');
  }
});

test('week strips use real dates across month and year boundaries', () => {
  const strip = weekStrip(civil('2026-10-18'), 0);
  assert.deepEqual(strip.map(day => day.day), [18, 19, 20, 21, 22, 23, 24]);
  assert.deepEqual(strip.map(day => day.today), [true, false, false, false, false, false, false]);
  assert.deepEqual(weekStrip(civil('2026-10-18'), 1).map(day => day.day), [12, 13, 14, 15, 16, 17, 18]);
  assert.deepEqual(weekStrip(civil('2026-10-18'), 1).map(day => day.past), [true, true, true, true, true, true, false]);
  assert.deepEqual(weekStrip(civil('2026-12-31'), 1).map(day => `${day.month}/${day.day}`), ['12/28', '12/29', '12/30', '12/31', '1/1', '1/2', '1/3']);
  assert.deepEqual(weekdayLabels(1), ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  assert.deepEqual(weekdayLabels(0, 'short'), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
});

test('the locale week start uses getWeekInfo or weekInfo, falling back to Monday', () => {
  assert.equal(localeFirstDay({ getWeekInfo: () => ({ firstDay: 7 }) }), 0, 'getWeekInfo reports Sunday as 7');
  assert.equal(localeFirstDay({ getWeekInfo: () => ({ firstDay: 1 }) }), 1);
  assert.equal(localeFirstDay({ getWeekInfo: () => ({ firstDay: 6 }) }), 6);
  assert.equal(localeFirstDay({ weekInfo: { firstDay: 7 } }), 0, 'older engines expose the weekInfo accessor');
  assert.equal(localeFirstDay({}), null, 'no week information');
  assert.equal(localeFirstDay({ getWeekInfo: () => { throw new Error('unsupported'); } }), null);
  assert.equal(localeFirstDay({ getWeekInfo: () => ({ firstDay: 9 }) }), null);
  assert.equal(localeFirstDay(null), null);
  const original = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, 'getWeekInfo');
  const accessor = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, 'weekInfo');
  try {
    if (original) delete (Intl.Locale.prototype as { getWeekInfo?: unknown }).getWeekInfo;
    if (accessor) delete (Intl.Locale.prototype as { weekInfo?: unknown }).weekInfo;
    assert.equal(localeWeekStart('en-US'), 1, 'Monday fallback when the engine has no week information');
    assert.equal(weekStartDay('locale', 'en-US'), 1);
  } finally {
    if (original) Object.defineProperty(Intl.Locale.prototype, 'getWeekInfo', original);
    if (accessor) Object.defineProperty(Intl.Locale.prototype, 'weekInfo', accessor);
  }
  assert.equal(localeWeekStart('not a locale!'), 1, 'an invalid tag falls back to Monday');
  assert.equal(weekStartDay('sunday', 'en-GB'), 0);
  assert.equal(weekStartDay('monday', 'en-US'), 1);
  if (original || accessor) {
    assert.equal(weekStartDay('locale', 'en-US'), 0, 'the United States starts on Sunday');
    assert.equal(weekStartDay('locale', 'en-GB'), 1, 'the United Kingdom starts on Monday');
  }
});

test('daysUntil counts civil days across the March and November DST changes', () => {
  // Toronto springs forward on 8 March 2026 (a 23-hour day) and falls back on 1 November 2026 (25 hours).
  assert.deepEqual([new Date(2026, 2, 7, 12).getTimezoneOffset(), new Date(2026, 2, 9, 12).getTimezoneOffset()], [300, 240], 'the zone applies');
  assert.notEqual((new Date(2026, 2, 9).getTime() - new Date(2026, 2, 7).getTime()) / 86_400_000, 2, 'naive millisecond arithmetic would be wrong here');
  assert.equal(daysUntil(civil('2026-03-09'), new Date(2026, 2, 7, 23, 30)), 2);
  assert.equal(daysUntil(civil('2026-03-08'), new Date(2026, 2, 7, 0, 5)), 1);
  assert.equal(daysUntil(civil('2026-11-02'), new Date(2026, 9, 31, 0, 30)), 2);
  assert.equal(daysUntil(civil('2026-11-01'), new Date(2026, 9, 31, 23, 59)), 1);
  assert.equal(daysUntil(civil('2026-10-18'), new Date(2026, 9, 18, 23, 59, 59)), 0);
  assert.equal(daysUntil(civil('2026-10-19'), new Date(2026, 9, 18, 0, 0, 0)), 1);
  assert.equal(daysBetween(civil('2026-01-01'), civil('2027-01-01')), 365);
  assert.equal(daysBetween(civil('2028-01-01'), civil('2029-01-01')), 366);
  assert.equal(todayCivil(new Date(2026, 9, 18, 0, 0, 1)), '2026-10-18', 'the local date, like the Clock');
});

test('yearly events roll forward; February 29 becomes February 28 in common years', () => {
  const leap = { date: '2024-02-29', repeatsYearly: true };
  assert.deepEqual(nextOccurrence(leap, civil('2026-10-18')), civil('2027-02-28'));
  assert.deepEqual(nextOccurrence(leap, civil('2027-03-01')), civil('2028-02-29'));
  assert.deepEqual(nextOccurrence(leap, civil('2028-02-29')), civil('2028-02-29'), 'today counts as the occurrence');
  assert.deepEqual(nextOccurrence({ date: '2000-10-31', repeatsYearly: true }, civil('2026-10-18')), civil('2026-10-31'));
  assert.deepEqual(nextOccurrence({ date: '2000-10-01', repeatsYearly: true }, civil('2026-10-18')), civil('2027-10-01'));
  assert.deepEqual(nextOccurrence({ date: '2030-05-01', repeatsYearly: true }, civil('2026-10-18')), civil('2030-05-01'), 'a future first date is kept until it arrives');
  assert.deepEqual(nextOccurrence({ date: '2026-01-01', repeatsYearly: false }, civil('2026-10-18')), civil('2026-01-01'), 'one-time dates never roll');
  assert.equal(nextOccurrence({ date: '2026-02-30', repeatsYearly: false }, civil('2026-10-18')), null);
});

test('Today and Tomorrow labels, numbers with units and short dates', () => {
  assert.deepEqual(countdownLabel(0), { value: 'Today', unit: null, text: 'Today' });
  assert.deepEqual(countdownLabel(1), { value: 'Tomorrow', unit: null, text: 'Tomorrow' });
  assert.deepEqual(countdownLabel(12), { value: '12', unit: 'days', text: '12 days' });
  assert.equal(countdownLabel(1200).text, '1,200 days');
  assert.equal(countdownDate(civil('2026-10-31'), civil('2026-10-18')), 'Sat, Oct 31');
  assert.equal(countdownDate(civil('2027-01-02'), civil('2026-10-18')), 'Sat, Jan 2, 2027');
});

test('upcoming countdowns exclude past one-time events and sort soonest first', () => {
  const today = civil('2026-10-18');
  const events = [
    event('Holiday', '2026-12-24'),
    event('Passed trip', '2026-10-17'),
    event('Birthday', '1990-11-03', true),
    event('Weekend trip', '2026-10-30'),
    event('Anniversary', '2001-10-18', true),
    event('Tomorrow plan', '2026-10-19'),
    event('Also today', '2026-10-18'),
  ];
  const upcoming = upcomingCountdowns(events, today);
  assert.deepEqual(upcoming.map(item => [item.event.title, item.days]), [
    ['Also today', 0], ['Anniversary', 0], ['Tomorrow plan', 1], ['Weekend trip', 12], ['Birthday', 16], ['Holiday', 67],
  ]);
  assert.equal(countdownPassed(events[1]!, today), true);
  assert.equal(countdownPassed(events[2]!, today), false, 'a yearly event never passes');
  assert.equal(countdownPassed(events[6]!, today), false, 'today is not passed');
  assert.deepEqual(upcomingCountdowns([], today), []);
});

test('the calendar view carries its weekday labels in display order and is built once per day (#193)', () => {
  const monday = calendarView('2026-10-18', 'monday');
  assert.deepEqual(monday.labels.narrow, ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  assert.deepEqual(monday.labels.short, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(monday.labels.long, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  assert.deepEqual(monday.strip.map(day => weekdayName(day.weekday)), monday.labels.long, 'the week strip shares the header order');
  assert.deepEqual([monday.weekday, monday.month, monday.weekStart], ['Sunday', 'October', 1]);
  assert.deepEqual(monday.weeks, monthMatrix(2026, 10, 1));
  assert.equal(calendarView('2026-10-18', 'monday'), monday, 'the same day and week start reuse the view');
  assert.deepEqual(calendarView('2026-10-18', 'sunday').labels.short, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  assert.notEqual(calendarView('2026-10-19', 'monday'), monday, 'a new day builds a new view');
  assert.equal(calendarView('2026-10-19', 'monday').weekday, 'Monday');
});

const SYNTHETIC = [
  event('Holiday', '2026-12-24'), event('Weekend trip', '2026-10-30'), event('Synthetic today', '2026-10-18'),
  event('Next spring', '2027-03-01'), event('Passed one-time', '2026-10-01'), event('Birthday', '1990-11-03', true),
];

test('countdown rows carry their display strings and are rebuilt only for a new day or list (#193)', () => {
  const rows = countdownRows(SYNTHETIC, '2026-10-18');
  assert.deepEqual(rows.map(row => [row.event.title, row.label.text, row.dateText]), [
    ['Synthetic today', 'Today', 'Sun, Oct 18'], ['Weekend trip', '12 days', 'Fri, Oct 30'], ['Birthday', '16 days', 'Tue, Nov 3'],
    ['Holiday', '67 days', 'Thu, Dec 24'], ['Next spring', '134 days', 'Mon, Mar 1, 2027'],
  ]);
  assert.deepEqual(rows.map(row => row.days), upcomingCountdowns(SYNTHETIC, civil('2026-10-18')).map(item => item.days), 'the same order and counts as upcomingCountdowns');
  assert.equal(countdownRows(SYNTHETIC, '2026-10-18'), rows, 'the same list on the same day reuses the rows');
  const tomorrow = countdownRows(SYNTHETIC, '2026-10-19');
  assert.notEqual(tomorrow, rows, 'a new day rebuilds them');
  assert.deepEqual(tomorrow.slice(0, 2).map(row => [row.event.title, row.label.text]), [['Weekend trip', '11 days'], ['Birthday', '15 days']]);
  assert.notEqual(countdownRows([...SYNTHETIC], '2026-10-19'), tomorrow, 'a new list rebuilds them');
  assert.deepEqual(countdownRows([], '2026-10-18'), []);
  assert.deepEqual(countdownRows(SYNTHETIC, 'not a date'), []);
});

test('a one-second tick with the same civil date and settings constructs no Intl formatter (#193)', () => {
  const settings = ['locale', 'sunday', 'monday'] as const;
  // The first render of a day builds its strings, creating the page's shared formatters once.
  for (const setting of settings) calendarView('2026-10-18', setting);
  countdownRows(SYNTHETIC, '2026-10-18');
  const ticks = intlConstructions(() => {
    for (let tick = 0; tick < 60; tick++) {
      for (const setting of settings) calendarView('2026-10-18', setting);
      countdownRows(SYNTHETIC, '2026-10-18');
    }
  });
  assert.deepEqual(ticks, none, 'sixty ticks of every Calendar setting and the countdown list');
  // A new civil day rebuilds its strings with the same shared formatters.
  assert.deepEqual(intlConstructions(() => { calendarView('2026-10-20', 'monday'); calendarView('2026-10-20', 'sunday'); countdownRows(SYNTHETIC, '2026-10-20'); }), none, 'a new day reuses the formatters');
  // The formatting helpers reuse one formatter per format, editor rows included.
  assert.deepEqual(intlConstructions(() => {
    for (let index = 0; index < 10; index++) {
      countdownDate(civil('2027-01-02'), civil('2026-10-18')); countdownDate(civil('2026-10-31'), civil('2026-10-18'));
      countdownLabel(1200); monthName(civil('2026-10-18')); weekdayName(3, 'short'); weekdayLabels(0, 'narrow');
    }
  }), none);
});
