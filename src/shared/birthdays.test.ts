import test from 'node:test';
import assert from 'node:assert/strict';
import { BIRTHDAY_LIMIT, birthdayProblem, birthdayTreatmentForDate, validBirthdayDate, type BirthdayEntry } from './birthdays.ts';

const first: BirthdayEntry = { id: '00000000-0000-4000-8000-000000000001', name: 'Birthday A', date: '01-10', treatment: 'classic' };
const second: BirthdayEntry = { id: '00000000-0000-4000-8000-000000000002', name: 'Birthday B', date: '06-12', treatment: 'korean' };

test('annual birthday dates accept each month boundary and February29 without storing a year', () => {
  const ends = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  ends.forEach((last, index) => {
    const month = String(index + 1).padStart(2, '0');
    assert.equal(validBirthdayDate(`${month}-01`), true);
    assert.equal(validBirthdayDate(`${month}-${last}`), true);
    assert.equal(validBirthdayDate(`${month}-${last + 1}`), false);
  });
  for (const invalid of ['', '-', '1-10', '01-1', '00-10', '13-10', '01-00', '2026-01-10', '01-10\n', '01-10 ', ' 01-10', '01/10']) {
    assert.equal(validBirthdayDate(invalid), false, JSON.stringify(invalid));
  }
});

test('birthday scenes match only a real exact civil day and never move February29 to another date', () => {
  assert.equal(birthdayTreatmentForDate([first, second], '2026-01-09'), null);
  assert.equal(birthdayTreatmentForDate([first, second], '2026-01-10'), 'classic');
  assert.equal(birthdayTreatmentForDate([first, second], '2026-01-11'), null);
  assert.equal(birthdayTreatmentForDate([first, second], '2027-06-12'), 'korean');
  const leap = { ...first, date: '02-29', treatment: 'russian' as const };
  assert.equal(birthdayTreatmentForDate([leap], '2028-02-29'), 'russian');
  assert.equal(birthdayTreatmentForDate([leap], '2000-02-29'), 'russian');
  for (const day of ['2027-02-28', '2027-03-01', '2027-02-29', '2100-02-29', 'xxxxx02-29', '2028-02-29\n', '2028-02-29T00:00:00Z']) {
    assert.equal(birthdayTreatmentForDate([leap], day), null, day);
  }
  assert.equal(birthdayTreatmentForDate([], '2028-02-29'), null);
});

test('same-day birthdays share one treatment with a deterministic Classic fallback for mixed choices', () => {
  const russian = { ...first, treatment: 'russian' as const };
  const same = { ...second, date: first.date, treatment: 'russian' as const };
  assert.equal(birthdayTreatmentForDate([russian, same], '2026-01-10'), 'russian');
  const mixed = { ...same, treatment: 'korean' as const };
  assert.equal(birthdayTreatmentForDate([russian, mixed], '2026-01-10'), 'classic');
  assert.equal(birthdayTreatmentForDate([mixed, russian], '2026-01-10'), 'classic');
  assert.equal(birthdayTreatmentForDate([russian, second], '2026-01-10'), 'russian', 'another date never changes today’s treatment');
});

test('birthday draft feedback bounds names and count without mutating entries', () => {
  const entries = [first, second], before = structuredClone(entries);
  assert.equal(birthdayProblem(entries), null);
  assert.equal(birthdayProblem([]), null);
  assert.equal(birthdayProblem([{ ...first, name: `  ${'A'.repeat(60)}  ` }]), null);
  assert.match(birthdayProblem([{ ...first, name: '  ' }])!, /name/);
  assert.match(birthdayProblem([{ ...first, name: 'A'.repeat(61) }])!, /name/);
  assert.match(birthdayProblem([{ ...first, date: '04-31' }])!, /month and day/);
  const many = Array.from({ length: BIRTHDAY_LIMIT + 1 }, (_, index) => ({ ...first, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }));
  assert.equal(birthdayProblem(many.slice(0, BIRTHDAY_LIMIT)), null);
  assert.match(birthdayProblem(many)!, /24 birthdays/);
  assert.deepEqual(entries, before);
});
