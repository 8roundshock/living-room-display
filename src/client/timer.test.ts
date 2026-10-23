process.env.TZ = 'America/Toronto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Timer } from '../shared/contracts.ts';
import { clockTimer, doneAgo, spokenTimeLeft, timeLeft, timerDigits, timerEnds } from './timer.ts';

// 6:42 PM on Tuesday, October 20, 2026 in Toronto (EDT).
const NOW = Date.parse('2026-10-20T22:42:00.000Z');
function timer(id: string, fields: Partial<Timer>): Timer {
  return { id, label: '', durationMs: 600_000, endsAt: null, remainingMs: null, createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(), ...fields };
}
const at = (offset: number) => new Date(NOW + offset).toISOString();

test('#438 time left rounds whole minutes up above a minute, then counts seconds', () => {
  assert.equal(timeLeft(61_000), '2 min');
  assert.equal(timeLeft(60_000), '60 s');
  assert.equal(timeLeft(44_200), '45 s');
  assert.equal(timeLeft(480_000), '8 min');
  assert.equal(timeLeft(3_600_000), '1 h');
  assert.equal(timeLeft(3_600_001), '1 h 1 min');
  assert.equal(timeLeft(3_900_000), '1 h 5 min');
  assert.equal(timeLeft(7_200_000 + 60_000 * 59 + 1), '3 h');
  assert.equal(timeLeft(86_400_000 - 30_000), '24 h');
  assert.equal(timeLeft(0), '0 s');
  assert.equal(doneAgo(30_000), 'just now');
  assert.equal(doneAgo(125_000), '2 min ago');
  assert.equal(doneAgo(3_900_000), '1 h 5 min ago');
});

test('#438 "ends" uses the 12/24-hour setting and names another day, across a daylight-saving change', () => {
  assert.equal(timerEnds(NOW + 9 * 60_000, NOW, '12h'), 'ends 6:51 PM');
  assert.equal(timerEnds(NOW + 9 * 60_000, NOW, '24h'), 'ends 18:51');
  assert.equal(timerEnds(Date.parse('2026-10-21T05:10:00.000Z'), NOW, '12h'), 'ends tomorrow 1:10 AM');
  // Clocks fall back at 2 AM on Sunday, November 1, 2026: a 3-hour timer from 11 PM ends at 1 AM EST.
  const evening = Date.parse('2026-11-01T03:00:00.000Z');
  assert.equal(timerEnds(evening + 3 * 3_600_000, evening, '12h'), 'ends tomorrow 1:00 AM');
  assert.equal(timerEnds(evening + 3 * 3_600_000, evening, '24h'), 'ends tomorrow 01:00');
  assert.equal(timerEnds(NOW + 2 * 86_400_000, NOW, '12h'), 'ends Thu 6:42 PM');
});

test('#438 the Clock slot shows each phase by family, with " +N" and the offline suffix', () => {
  const running = [timer('a', { label: 'Pasta', endsAt: at(8 * 60_000) })];
  assert.deepEqual(clockTimer(running, NOW, '12h', 'small', false), { label: 'Pasta', more: 0, value: '8 min', phase: 'running', ticking: false });
  assert.equal(clockTimer(running, NOW, '12h', 'medium', false)?.value, '8 min');
  assert.equal(clockTimer(running, NOW, '12h', 'large', false)?.value, '8 min left · ends 6:50 PM');
  assert.equal(clockTimer(running, NOW, '24h', 'large', true)?.value, '8 min left · ends 18:50 · offline');
  const hour = [timer('a', { endsAt: at(65 * 60_000), durationMs: 3_900_000 })];
  assert.deepEqual(clockTimer(hour, NOW, '12h', 'small', false)?.value, '1 h 5 min');
  assert.equal(clockTimer(hour, NOW, '12h', 'small', false)?.label, '1 h 5 min timer');
  const last = [timer('a', { endsAt: at(45_000) })];
  assert.deepEqual([clockTimer(last, NOW, '12h', 'small', false)?.value, clockTimer(last, NOW, '12h', 'small', false)?.ticking], ['45 s', true]);
  assert.equal(clockTimer(last, NOW, '12h', 'large', false)?.value, '45 s left');
  const paused = [timer('a', { remainingMs: 480_000 })];
  assert.deepEqual([clockTimer(paused, NOW, '12h', 'medium', false)?.value, clockTimer(paused, NOW, '12h', 'medium', false)?.phase], ['8 min', 'paused']);
  assert.equal(clockTimer(paused, NOW, '12h', 'large', false)?.value, '8 min left · paused');
  const done = [timer('a', { endsAt: at(-125_000) })];
  assert.equal(clockTimer(done, NOW, '12h', 'small', false)?.value, 'Done');
  assert.equal(clockTimer(done, NOW, '12h', 'medium', false)?.value, 'Done · 2 min ago');
  assert.equal(clockTimer(done, NOW, '12h', 'large', false)?.value, 'Done · 2 min ago');
  assert.equal(clockTimer([timer('a', { endsAt: at(-10 * 60_000) })], NOW, '12h', 'large', false), null, 'the display stops showing Done after 10 minutes');
  assert.equal(clockTimer([], NOW, '12h', 'large', false), null);
  assert.equal(clockTimer(undefined, NOW, '12h', 'large', false), null);
  // Several timers: the first in order leads and the rest count as " +N".
  const several = [timer('late', { endsAt: at(30 * 60_000) }), timer('soon', { label: 'Tea', endsAt: at(3 * 60_000) }), timer('p', { remainingMs: 1000 })];
  assert.deepEqual([clockTimer(several, NOW, '12h', 'small', false)?.label, clockTimer(several, NOW, '12h', 'small', false)?.more], ['Tea', 2]);
  // A display that lost the computer keeps counting from endsAt.
  assert.equal(clockTimer(running, NOW + 5 * 60_000, '12h', 'small', true)?.value, '3 min');
});

test('#438 Home digits and their per-minute spoken text', () => {
  assert.equal(timerDigits(600_000), '10:00');
  assert.equal(timerDigits(599_001), '10:00');
  assert.equal(timerDigits(59_000), '0:59');
  assert.equal(timerDigits(3_900_000), '1:05:00');
  assert.equal(timerDigits(-5), '0:00');
  assert.equal(spokenTimeLeft(480_000), 'about 8 minutes left');
  assert.equal(spokenTimeLeft(61_000), 'about 2 minutes left');
  assert.equal(spokenTimeLeft(30_000), 'less than a minute left');
  assert.equal(spokenTimeLeft(3_660_000), 'about 1 hour 1 minute left');
});

test('#438 the Clock slot builds no Intl formatter on the tick', () => {
  const running = [timer('a', { label: 'Pasta', endsAt: at(30 * 60_000) })];
  clockTimer(running, NOW, '12h', 'large', false);
  const original = Intl.DateTimeFormat;
  let constructed = 0;
  // @ts-expect-error a counting stand-in for the constructor
  Intl.DateTimeFormat = function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) { constructed++; return new original(...args); };
  try {
    for (let second = 0; second < 120; second++) for (const size of ['small', 'medium', 'large'] as const) clockTimer(running, NOW + second * 1000, '12h', size, second % 2 === 0);
  } finally { Intl.DateTimeFormat = original; }
  assert.equal(constructed, 0);
});
