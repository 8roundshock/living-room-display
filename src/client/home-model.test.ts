process.env.TZ = 'America/Toronto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { CountdownEvent, Reminder } from '../shared/contracts.ts';
import {
  addMonths, dayName, defaultTime, dueAtFor, dueSummary, isPastDay, localDayKey, monthGrid, moveDay, namesList, quickDay, reminderMarks, relativeDay,
  remindersOn, shiftedMessage, todayGroups,
} from './home-model.ts';

// 6:42 PM on Tuesday, October 20, 2026 in Toronto (EDT, UTC-4).
const NOW = Date.parse('2026-10-20T22:42:00.000Z');
let sequence = 0;
function reminder(text: string, dueAt: string | null, fields: Partial<Reminder> = {}): Reminder {
  sequence++;
  return { id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`, text, dueAt, completed: false, createdAt: new Date(NOW - 86_400_000 + sequence * 1000).toISOString(), updatedAt: new Date(NOW).toISOString(), ...fields };
}
const countdown = (title: string, date: string, repeatsYearly = false): CountdownEvent => ({ id: `${title}-id`, title, date, repeatsYearly });

test('#438 Today groups: overdue then due today by time, three anytime with "+N more", and the next 7 days', () => {
  const items = [
    reminder('Later today', '2026-10-20T23:30:00.000Z'), reminder('Overdue yesterday', '2026-10-19T13:00:00.000Z'), reminder('Earlier today, overdue', '2026-10-20T14:00:00.000Z'),
    reminder('Tonight near midnight', '2026-10-21T03:59:00.000Z'), reminder('Tomorrow just after midnight', '2026-10-21T04:01:00.000Z'),
    reminder('Next week', '2026-10-27T13:00:00.000Z'), reminder('Too far', '2026-10-28T13:00:00.000Z'), reminder('Done', '2026-10-20T23:00:00.000Z', { completed: true }),
    reminder('Anytime 1', null), reminder('Anytime 2', null), reminder('Anytime 3', null), reminder('Anytime 4', null), reminder('Anytime 5', null),
  ];
  const groups = todayGroups(items, [countdown('Trip', '2026-10-23'), countdown('Far trip', '2026-12-01'), countdown('Birthday', '1990-10-20', true)], NOW);
  assert.deepEqual(groups.due.map(item => item.text), ['Overdue yesterday', 'Earlier today, overdue', 'Later today', 'Tonight near midnight'], 'local days cross UTC midnight correctly');
  assert.deepEqual(groups.anytime.map(item => item.text), ['Anytime 5', 'Anytime 4', 'Anytime 3']);
  assert.equal(groups.anytimeMore, 2);
  assert.deepEqual(groups.comingUp.map(item => item.title), ['Birthday', 'Tomorrow just after midnight', 'Trip', 'Next week']);
  assert.equal(groups.pending, 12);
  const many = Array.from({ length: 8 }, (_, index) => reminder(`Soon ${index}`, new Date(Date.parse('2026-10-21T13:00:00.000Z') + index * 3_600_000).toISOString()));
  assert.equal(todayGroups(many, [], NOW).comingUp.length, 5, 'at most five coming up');
  assert.deepEqual(todayGroups([], [], NOW), { due: [], anytime: [], anytimeMore: 0, comingUp: [], pending: 0 });
});

test('#438 calendar marks count pending dated reminders by local day, overdue in the caution tone', () => {
  const items = [
    reminder('a', '2026-10-21T03:30:00.000Z'), reminder('b', '2026-10-20T12:00:00.000Z'), reminder('c', '2026-10-21T04:30:00.000Z'),
    reminder('done', '2026-10-21T15:00:00.000Z', { completed: true }), reminder('undated', null),
  ];
  const marks = reminderMarks(items, NOW);
  assert.deepEqual(marks.get('2026-10-20'), { count: 2, overdue: true }, '11:30 PM local on the 20th is still the 20th');
  assert.deepEqual(marks.get('2026-10-21'), { count: 1, overdue: false });
  assert.equal(marks.size, 2);
  assert.equal(dayName({ year: 2026, month: 10, day: 30 }, { count: 2, overdue: false }), 'Friday, October 30, 2 reminders');
  assert.equal(dayName({ year: 2026, month: 10, day: 30 }, { count: 1, overdue: false }), 'Friday, October 30, 1 reminder');
  assert.equal(dayName({ year: 2026, month: 10, day: 30 }, undefined), 'Friday, October 30');
  assert.deepEqual(remindersOn(items, '2026-10-20').map(item => item.text), ['b', 'a']);
  assert.equal(localDayKey(Date.parse('2026-10-21T03:59:59.000Z')), '2026-10-20');
});

test('#438 quick due times: the next whole hour today (23:59 from 23:00), 9:00 AM otherwise, and past days', () => {
  assert.equal(defaultTime('today', NOW), '19:00');
  assert.equal(defaultTime('today', Date.parse('2026-10-21T03:05:00.000Z')), '23:59', '11:05 PM');
  assert.equal(defaultTime('today', Date.parse('2026-10-21T02:59:00.000Z')), '23:00', '10:59 PM');
  assert.equal(defaultTime('tomorrow', NOW), '09:00');
  assert.equal(defaultTime('date', NOW), '09:00');
  assert.equal(quickDay('today', NOW), '2026-10-20');
  assert.equal(quickDay('tomorrow', Date.parse('2026-10-21T03:59:00.000Z')), '2026-10-21', '11:59 PM on the 20th: tomorrow is the 21st');
  assert.equal(isPastDay('2026-10-19', NOW), true);
  assert.equal(isPastDay('2026-10-20', NOW), false);
  assert.equal(relativeDay('2026-10-21', NOW), 'Tomorrow');
  assert.equal(relativeDay('2026-10-30', NOW), 'Fri, Oct 30');
  assert.equal(dueSummary('2026-10-30T13:00:00.000Z', NOW, '12h'), 'Fri, Oct 30 at 9:00 AM');
  assert.equal(dueSummary('2026-10-21T13:00:00.000Z', NOW, '24h'), 'tomorrow at 09:00');
});

test('#438 dueAtFor names a spring-forward shift and keeps the first of a repeated autumn hour', () => {
  assert.deepEqual(dueAtFor('2026-10-30', '09:00'), { iso: '2026-10-30T13:00:00.000Z', shifted: false, saved: '09:00' });
  // Clocks spring forward at 2:00 AM on Sunday, March 14, 2027: 2:30 AM does not exist.
  const gap = dueAtFor('2027-03-14', '02:30');
  assert.deepEqual(gap, { iso: '2027-03-14T07:30:00.000Z', shifted: true, saved: '03:30' });
  assert.equal(shiftedMessage('2027-03-14', '02:30', gap!, '12h'), "2:30 AM doesn't exist on Sun, Mar 14 (clocks spring forward). Saved for 3:30 AM.");
  // Clocks fall back at 2:00 AM on Sunday, November 1, 2026: 1:30 AM happens twice; the first is EDT.
  assert.deepEqual(dueAtFor('2026-11-01', '01:30'), { iso: '2026-11-01T05:30:00.000Z', shifted: false, saved: '01:30' });
  assert.equal(dueAtFor('2026-02-30', '09:00'), null);
  assert.equal(dueAtFor('2026-10-30', '24:00'), null);
  assert.equal(dueAtFor('2026-10-30', '9:00'), null);
});

test('#438 the month grid follows the week start and fills neighbouring days', () => {
  const sunday = monthGrid(2026, 10, 0), monday = monthGrid(2026, 10, 1);
  // October 1, 2026 is a Thursday.
  assert.equal(sunday.length, 5);
  assert.deepEqual(sunday[0]!.map(cell => cell.key), ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual(sunday[0]!.map(cell => cell.inMonth), [false, false, false, false, true, true, true]);
  assert.deepEqual(sunday.at(-1)!.map(cell => cell.key).at(-1), '2026-10-31');
  assert.equal(monday[0]![0]!.key, '2026-09-28');
  assert.equal(monday.at(-1)!.at(-1)!.key, '2026-11-01');
  assert.equal(monthGrid(2026, 2, 0).length, 4, 'February 2026 starts on a Sunday and fills four weeks');
  assert.equal(monthGrid(2026, 8, 0).length, 6, 'August 2026 needs six weeks');
});

test('#438 grid keys move by day, week and month (clamped) and to the week edges', () => {
  const day = { year: 2026, month: 1, day: 31 };
  assert.deepEqual(moveDay(day, 'ArrowRight', 0), { year: 2026, month: 2, day: 1 });
  assert.deepEqual(moveDay(day, 'ArrowDown', 0), { year: 2026, month: 2, day: 7 });
  assert.deepEqual(moveDay({ year: 2026, month: 3, day: 1 }, 'ArrowLeft', 0), { year: 2026, month: 2, day: 28 });
  assert.deepEqual(moveDay(day, 'PageDown', 0), { year: 2026, month: 2, day: 28 });
  assert.deepEqual(moveDay({ year: 2028, month: 1, day: 31 }, 'PageDown', 0), { year: 2028, month: 2, day: 29 });
  assert.deepEqual(moveDay({ year: 2026, month: 3, day: 31 }, 'PageUp', 0), { year: 2026, month: 2, day: 28 });
  assert.deepEqual(addMonths({ year: 2026, month: 12, day: 15 }, 1), { year: 2027, month: 1, day: 15 });
  // Wednesday, October 21, 2026: the Sunday week runs Oct 18–24, the Monday week Oct 19–25.
  const wednesday = { year: 2026, month: 10, day: 21 };
  assert.deepEqual(moveDay(wednesday, 'Home', 0), { year: 2026, month: 10, day: 18 });
  assert.deepEqual(moveDay(wednesday, 'End', 0), { year: 2026, month: 10, day: 24 });
  assert.deepEqual(moveDay(wednesday, 'Home', 1), { year: 2026, month: 10, day: 19 });
  assert.deepEqual(moveDay(wednesday, 'End', 1), { year: 2026, month: 10, day: 25 });
  assert.equal(moveDay(wednesday, 'Enter', 0), null);
});

test('#438 Home model formatting builds no Intl formatter once warm', () => {
  const items = [reminder('a', '2026-10-21T13:00:00.000Z'), reminder('b', null)];
  const run = () => { todayGroups(items, [countdown('Trip', '2026-10-23')], NOW); dueSummary('2026-10-30T13:00:00.000Z', NOW, '12h'); dayName({ year: 2026, month: 10, day: 30 }, undefined); relativeDay('2026-10-30', NOW); };
  run();
  const original = Intl.DateTimeFormat;
  let constructed = 0;
  // @ts-expect-error a counting stand-in for the constructor
  Intl.DateTimeFormat = function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) { constructed++; return new original(...args); };
  try { for (let tick = 0; tick < 30; tick++) run(); } finally { Intl.DateTimeFormat = original; }
  assert.equal(constructed, 0);
  assert.equal(namesList(['calendar', 'clock', 'weather']), 'Calendar, Clock and Weather');
  assert.equal(namesList(['note']), 'Note');
});
