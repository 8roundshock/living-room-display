import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REMINDER_HISTORY_LIMIT, REMINDER_LIMIT, UPCOMING_HORIZON_MS,
  historyReminders, isOverdue, pendingReminders, pruneHistory, reminderCompletedAt,
} from './reminders.ts';

const now = Date.parse('2026-10-18T13:00:00Z');
const iso = (offset: number) => new Date(now + offset).toISOString();
interface Item { name: string; completed: boolean; dueAt: string | null; createdAt: string; updatedAt: string }
function item(name: string, dueAt: string | null, createdAt = iso(-86_400_000), completed = false, updatedAt = createdAt): Item {
  return { name, completed, dueAt, createdAt, updatedAt };
}

test('limits stay rollback-safe', () => {
  assert.equal(REMINDER_LIMIT, 1000, 'the previous release rejects more than 1000 reminders');
  assert.equal(REMINDER_HISTORY_LIMIT, 500);
  assert.equal(UPCOMING_HORIZON_MS, 7 * 86_400_000);
});

test('pending order: soon dated, then undated newest first, then later dated; completed never appear', () => {
  const values = [
    item('undated old', null, iso(-5 * 86_400_000)),
    item('later', iso(9 * 86_400_000)),
    item('done', iso(-3_600_000), iso(-86_400_000), true),
    item('tomorrow', iso(86_400_000)),
    item('undated new', null, iso(-60_000)),
    item('overdue', iso(-3 * 86_400_000)),
    item('much later', iso(30 * 86_400_000)),
    item('undated middle', null, iso(-2 * 86_400_000)),
  ];
  const snapshot = structuredClone(values);
  assert.deepEqual(pendingReminders(values, now).map(value => value.name),
    ['overdue', 'tomorrow', 'undated new', 'undated middle', 'undated old', 'later', 'much later']);
  assert.deepEqual(values, snapshot, 'the input is never mutated or reordered');
});

test('the seven-day horizon boundary is inclusive, one millisecond later is the later tier', () => {
  const values = [
    item('undated', null),
    item('just after', iso(UPCOMING_HORIZON_MS + 1)),
    item('exactly seven days', iso(UPCOMING_HORIZON_MS)),
  ];
  assert.deepEqual(pendingReminders(values, now).map(value => value.name), ['exactly seven days', 'undated', 'just after']);
});

test('ties in due time fall back to creation time', () => {
  const due = iso(3_600_000);
  const values = [item('second', due, iso(-1000)), item('first', due, iso(-2000))];
  assert.deepEqual(pendingReminders(values, now).map(value => value.name), ['first', 'second']);
  const undated = [item('older', null, iso(-2000)), item('newer', null, iso(-1000))];
  assert.deepEqual(pendingReminders(undated, now).map(value => value.name), ['newer', 'older']);
});

test('history lists completed reminders by completion time, newest first', () => {
  const values = [
    item('pending', null),
    item('completed first', null, iso(-9e6), true, iso(-3e6)),
    item('completed last', null, iso(-8e6), true, iso(-1e6)),
    item('completed middle', iso(-5e6), iso(-7e6), true, iso(-2e6)),
  ];
  const snapshot = structuredClone(values);
  assert.deepEqual(historyReminders(values).map(value => value.name), ['completed last', 'completed middle', 'completed first']);
  assert.deepEqual(values, snapshot);
});

test('completion time is updatedAt only while completed', () => {
  assert.equal(reminderCompletedAt(item('done', null, iso(-2000), true, iso(-1000))), iso(-1000));
  assert.equal(reminderCompletedAt(item('open', null, iso(-2000), false, iso(-1000))), null);
});

test('overdue means pending and due strictly before now', () => {
  assert.equal(isOverdue(item('at now', iso(0)), now), false, 'due exactly now is not overdue yet');
  assert.equal(isOverdue(item('just before', iso(-1)), now), true);
  assert.equal(isOverdue(item('undated', null), now), false);
  assert.equal(isOverdue(item('completed', iso(-1), iso(-2), true), now), false);
});

test('pruning keeps the newest 500 completed reminders and every pending one', () => {
  const values: Item[] = [];
  for (let index = 0; index < 520; index++) values.push(item(`done ${index}`, null, iso(-1e9 + index), true, iso(-1e8 + index * 1000)));
  for (let index = 0; index < 30; index++) values.push(item(`pending ${index}`, null, iso(-1e9 + index)));
  const pruned = pruneHistory(values, REMINDER_HISTORY_LIMIT);
  assert.equal(pruned.filter(value => value.completed).length, 500);
  assert.equal(pruned.filter(value => !value.completed).length, 30);
  assert.equal(pruned.some(value => value.name === 'done 19'), false, 'the oldest completed are removed');
  assert.equal(pruned.some(value => value.name === 'done 20'), true);
  assert.equal(pruned.some(value => value.name === 'done 519'), true);
  assert.equal(values.length, 550, 'the input is unchanged');
  assert.deepEqual(pruneHistory(values.slice(0, 10), REMINDER_HISTORY_LIMIT), values.slice(0, 10));
  assert.deepEqual(pruneHistory(values, 0).map(value => value.name), values.filter(value => !value.completed).map(value => value.name));
});
