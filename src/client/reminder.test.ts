import test from 'node:test';
import assert from 'node:assert/strict';
import { localInputDate } from './format.ts';
import { historyDayHeading, historyDayKey, reminderCompletedLabel, reminderDue, reminderDueLabel, reminderDuePatch, reminderTime } from './reminder.ts';

function inToronto(check: () => void) {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Toronto';
  try { check(); }
  finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('title-only edits preserve both instants in a repeated local hour', () => {
  inToronto(() => {
    const first = '2026-11-01T05:30:00.000Z';
    const second = '2026-11-01T06:30:00.000Z';
    assert.equal(localInputDate(first), localInputDate(second));
    assert.notEqual(new Date(localInputDate(second)).toISOString(), second,
      'reparsing the repeated local input would move the second occurrence');
    for (const dueAt of [first, second]) {
      const input = localInputDate(dueAt);
      const afterEdit = { dueAt, ...reminderDuePatch(input, input) };
      assert.equal(afterEdit.dueAt, dueAt);
    }
  });
});

test('unchanged inputs preserve imported seconds, offsets and concurrent dates', () => {
  inToronto(() => {
    for (const dueAt of [
      '2026-11-01T01:30:27.123-05:00',
      '2026-10-19T18:45:39.876+05:45',
      null,
    ]) {
      const initial = localInputDate(dueAt);
      const afterEdit = { dueAt, ...reminderDuePatch(initial, initial) };
      assert.equal(afterEdit.dueAt, dueAt);
    }
    const opened = localInputDate('2026-11-01T06:30:00Z');
    const concurrent = '2026-11-02T18:45:00Z';
    assert.equal({ dueAt: concurrent, ...reminderDuePatch(opened, opened) }.dueAt, concurrent);
  });
});

test('explicit date edits, clearing and creation still provide the requested date', () => {
  inToronto(() => {
    assert.deepEqual(reminderDuePatch('2026-11-02T13:45', '2026-11-01T01:30'),
      { dueAt: '2026-11-02T18:45:00.000Z' });
    assert.deepEqual(reminderDuePatch('', '2026-11-01T01:30'), { dueAt: null });
    assert.deepEqual(reminderDuePatch('2026-11-02T13:45', undefined),
      { dueAt: '2026-11-02T18:45:00.000Z' });
    assert.deepEqual(reminderDuePatch('', undefined), { dueAt: null });
    assert.deepEqual(reminderDuePatch('', ''), {});
  });
});

function item(dueAt: string | null, completed = false, updatedAt = '2026-10-01T12:00:00.000Z') {
  return { id: '00000000-0000-4000-8000-000000000000', text: 'Synthetic', dueAt, completed, createdAt: '2026-10-01T12:00:00.000Z', updatedAt };
}

test('due labels say Overdue, Yesterday, Today, Tomorrow or a date, in 12- and 24-hour time (#129)', () => {
  inToronto(() => {
    const now = new Date('2026-11-01T16:00:00Z'); // 11:00 EST, the day daylight saving ends
    const cases: [string | null, string, string][] = [
      ['2026-10-31T19:00:00Z', 'Overdue · Yesterday · 3:00 PM', 'Overdue · Yesterday · 15:00'],
      ['2026-10-28T13:05:00Z', 'Overdue · Oct 28 · 9:05 AM', 'Overdue · Oct 28 · 09:05'],
      ['2026-11-01T16:00:00Z', 'Today · 11:00 AM', 'Today · 11:00'],
      ['2026-11-01T23:00:00Z', 'Today · 6:00 PM', 'Today · 18:00'],
      ['2026-11-02T14:00:00Z', 'Tomorrow · 9:00 AM', 'Tomorrow · 09:00'],
      ['2026-11-24T20:00:00Z', 'Nov 24 · 3:00 PM', 'Nov 24 · 15:00'],
      ['2027-01-05T05:00:00Z', 'Jan 5, 2027 · 12:00 AM', 'Jan 5, 2027 · 00:00'],
      [null, 'Anytime', 'Anytime'],
    ];
    for (const [dueAt, twelve, twentyFour] of cases) {
      assert.equal(reminderDueLabel(item(dueAt), now, '12h'), twelve);
      assert.equal(reminderDueLabel(item(dueAt), now, '24h'), twentyFour);
    }
    assert.deepEqual(reminderDue(item('2026-10-31T19:00:00Z'), now, '12h'), { overdue: true, when: 'Yesterday · 3:00 PM' });
    assert.equal(reminderDue(item(null), now, '12h'), null);
    assert.equal(reminderTime(new Date('2026-11-01T04:00:00Z'), '24h'), '00:00', 'midnight is never 24:00');
  });
});

test('calendar days count across the daylight-saving change rather than 24-hour steps', () => {
  inToronto(() => {
    const now = new Date('2026-11-01T04:30:00Z'); // 00:30 EDT; this day is 25 hours long
    assert.equal(reminderDueLabel(item('2026-11-02T04:30:00Z'), now, '12h'), 'Today · 11:30 PM');
    assert.equal(reminderDueLabel(item('2026-11-02T05:30:00Z'), now, '24h'), 'Tomorrow · 00:30');
    assert.equal(reminderDueLabel(item('2026-11-01T03:59:00Z'), now, '24h'), 'Overdue · Yesterday · 23:59');
  });
});

test('history rows show the completion time and the earlier due date', () => {
  inToronto(() => {
    const now = new Date('2026-11-01T22:00:00Z');
    assert.equal(reminderCompletedLabel(item(null, true, '2026-11-01T20:42:00.000Z'), now, '12h'), 'Completed 3:42 PM');
    assert.equal(reminderCompletedLabel(item(null, true, '2026-11-01T20:42:00.000Z'), now, '24h'), 'Completed 15:42');
    assert.equal(reminderCompletedLabel(item('2026-10-31T19:00:00Z', true, '2026-11-01T20:42:00.000Z'), now, '12h'), 'Completed 3:42 PM · was due Yesterday · 3:00 PM');
    assert.equal(reminderCompletedLabel(item('2026-10-31T19:00:00Z', true, '2026-11-01T20:42:00.000Z'), now, '24h'), 'Completed 15:42 · was due Yesterday · 15:00');
  });
});

test('history day headings use the computer timezone across the daylight-saving change', () => {
  inToronto(() => {
    const now = new Date('2026-11-01T22:00:00Z');
    assert.equal(historyDayHeading('2026-11-01T05:30:00.000Z', now), 'TODAY', '01:30 EDT, before the change');
    assert.equal(historyDayHeading('2026-11-01T06:30:00.000Z', now), 'TODAY', '01:30 EST, after the change');
    assert.equal(historyDayKey('2026-11-01T05:30:00.000Z'), historyDayKey('2026-11-01T06:30:00.000Z'));
    assert.equal(historyDayHeading('2026-11-01T03:59:00.000Z', now), 'YESTERDAY', '23:59 EDT on Oct 31');
    assert.notEqual(historyDayKey('2026-11-01T03:59:00.000Z'), historyDayKey('2026-11-01T04:00:00.000Z'));
    assert.equal(historyDayHeading('2026-10-12T16:00:00.000Z', now), 'Mon, Oct 12');
    assert.equal(historyDayHeading('2025-10-12T16:00:00.000Z', now), 'Oct 12, 2025');
  });
});
