import test from 'node:test';
import assert from 'node:assert/strict';
import { localInputDate } from './format.ts';
import { reminderDuePatch } from './reminder.ts';

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
