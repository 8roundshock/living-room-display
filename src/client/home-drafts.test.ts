import test from 'node:test';
import assert from 'node:assert/strict';
import { hasHomeDrafts } from './home-drafts.ts';

test('unchanged/initialized Home form choices and normalized defaults do not warn on leaving', () => {
  assert.equal(hasHomeDrafts({}, {}, ''), false);
  const bases = { 'reminder.text': '', 'reminder.when': 'today', 'reminder.time': '09:00', 'world.query': '', 'world.city': null, 'countdown.title': '', 'countdown.date': '2026-10-29', 'timer.minutes': '5', 'timer.label': '' };
  assert.equal(hasHomeDrafts({ ...bases }, bases, ''), false);
  assert.equal(hasHomeDrafts({ 'timer.minutes': '05', 'timer.label': '  ' }, bases, ''), false);
});
test('each meaningful Home draft warns and reverting it to the actual original choice clears that warning', () => {
  for (const [key, initial, edited] of [
    ['reminder.text', '', 'Remember this'], ['reminder.when', 'today', 'tomorrow'],
    ['world.query', '', 'Lon'], ['world.city', null, { name: 'London' }], ['world.label', '', 'Work'],
    ['countdown.title', '', 'A trip'], ['countdown.date', '2026-10-29', '2027-01-01'],
    ['timer.minutes', '5', '12'], ['timer.label', '', 'Cooking'],
  ] as const) {
    assert.equal(hasHomeDrafts({ [key]: edited }, { [key]: initial }, ''), true, key);
    assert.equal(hasHomeDrafts({ [key]: initial }, { [key]: initial }, ''), false, key);
  }
});
test('dormant reminder date/time choices do not dirty Anytime, but active choices and typed text do', () => {
  const bases = { 'reminder.when': 'anytime', 'reminder.day': '2026-10-29', 'reminder.time': '09:00', 'reminder.text': '' };
  const values = { 'reminder.when': 'anytime', 'reminder.day': '2027-01-01', 'reminder.time': '12:00' };
  assert.equal(hasHomeDrafts(values, bases, ''), false);
  assert.equal(hasHomeDrafts({ ...values, 'reminder.text': 'A note' }, bases, ''), true);
  assert.equal(hasHomeDrafts({ ...values, 'reminder.when': 'date' }, bases, ''), true);
});
test('saving/discarding one cached form preserves another pending form; Note compares with current saved text', () => {
  const values: Record<string, unknown> = { 'reminder.text': 'A reminder', 'note.text': 'A note' };
  const bases: Record<string, unknown> = { 'reminder.text': '', 'note.text': '' };
  delete values['reminder.text']; delete bases['reminder.text'];
  assert.equal(hasHomeDrafts(values, bases, ''), true);
  assert.equal(hasHomeDrafts(values, bases, 'A note'), false);
  assert.equal(hasHomeDrafts({ 'note.text': ' A note ' }, bases, 'A note'), false);
  assert.equal(hasHomeDrafts({ 'timer.minutes': '' }, { 'timer.minutes': '5' }, ''), true);
  assert.equal(hasHomeDrafts({ 'calendar.selected': '2027-01-01' }, { 'calendar.selected': '2026-10-29' }, ''), false);
  assert.equal(hasHomeDrafts({ 'calendar.text': 'Remember a day', 'calendar.selected': '2027-01-01' }, { 'calendar.text': '', 'calendar.selected': '2026-10-29' }, ''), true);
});

test('Calendar browsing is clean but an explicit time choice is pending until reverted', () => {
  const bases = { 'calendar.text': '', 'calendar.selected': '2026-10-29', 'calendar.time': '14:00' };
  assert.equal(hasHomeDrafts({ 'calendar.selected': '2027-01-01', 'calendar.time': '14:00' }, bases, ''), false);
  assert.equal(hasHomeDrafts({ 'calendar.selected': '2027-01-01', 'calendar.time': '15:00' }, bases, ''), true);
  assert.equal(hasHomeDrafts({ 'calendar.selected': '2027-01-01', 'calendar.time': '14:00' }, bases, ''), false);
});
