import test from 'node:test';
import assert from 'node:assert/strict';
import type { Timer } from './contracts.ts';
import { DISPLAY_DONE_MS, KEEP_DONE_MS, durationName, orderTimers, timerDoneAt, timerName, timerPhase, timerRemaining, visibleTimers } from './timers.ts';

const NOW = Date.parse('2026-10-20T22:42:00.000Z');
function timer(id: string, fields: Partial<Timer>): Timer {
  return { id, label: '', durationMs: 600_000, endsAt: null, remainingMs: null, createdAt: new Date(NOW - 60_000).toISOString(), updatedAt: new Date(NOW - 60_000).toISOString(), ...fields };
}
const at = (offset: number) => new Date(NOW + offset).toISOString();

test('#438 a timer is paused while it holds a remainder, done once its end has passed, else running', () => {
  assert.equal(timerPhase(timer('a', { endsAt: at(1) }), NOW), 'running');
  assert.equal(timerPhase(timer('a', { endsAt: at(0) }), NOW), 'done', 'the end instant itself is done');
  assert.equal(timerPhase(timer('a', { endsAt: at(-5000) }), NOW), 'done');
  assert.equal(timerPhase(timer('a', { remainingMs: 30_000 }), NOW), 'paused');
  assert.equal(timerRemaining(timer('a', { endsAt: at(90_500) }), NOW), 90_500);
  assert.equal(timerRemaining(timer('a', { endsAt: at(-1) }), NOW), 0);
  assert.equal(timerRemaining(timer('a', { remainingMs: 30_000 }), NOW + 3_600_000), 30_000, 'a paused remainder does not age');
  assert.equal(timerDoneAt(timer('a', { endsAt: at(-120_000) }), NOW), NOW - 120_000);
  assert.equal(timerDoneAt(timer('a', { endsAt: at(1000) }), NOW), null);
});

test('#438 the display shows a finished timer for 10 minutes and Home for 60', () => {
  const timers = [
    timer('running', { endsAt: at(60_000) }), timer('paused', { remainingMs: 5000 }),
    timer('just-done', { endsAt: at(-DISPLAY_DONE_MS + 1) }), timer('display-gone', { endsAt: at(-DISPLAY_DONE_MS) }),
    timer('home-gone', { endsAt: at(-KEEP_DONE_MS) }),
  ];
  assert.deepEqual(visibleTimers(timers, NOW, true).map(item => item.id), ['running', 'paused', 'just-done']);
  assert.deepEqual(visibleTimers(timers, NOW, false).map(item => item.id), ['running', 'paused', 'just-done', 'display-gone']);
});

test('#438 timers order done (newest first), then running (soonest end), then paused (least left)', () => {
  const timers = [
    timer('paused-long', { remainingMs: 90_000 }), timer('running-late', { endsAt: at(500_000) }), timer('done-old', { endsAt: at(-300_000) }),
    timer('paused-short', { remainingMs: 10_000 }), timer('running-soon', { endsAt: at(5000) }), timer('done-new', { endsAt: at(-1000) }),
  ];
  assert.deepEqual(orderTimers(timers, NOW).map(item => item.id), ['done-new', 'done-old', 'running-soon', 'running-late', 'paused-short', 'paused-long']);
});

test('#438 a timer is named by its label, else by the length it started with', () => {
  assert.equal(timerName(timer('a', { label: 'Pasta', durationMs: 300_000 })), 'Pasta');
  assert.equal(timerName(timer('a', { label: '  ', durationMs: 300_000 })), '5 min timer');
  assert.equal(timerName(timer('a', { durationMs: 5_400_000 })), '1 h 30 min timer');
  assert.equal(timerName(timer('a', { durationMs: 45_000 })), '45 s timer');
  assert.equal(timerName(timer('a', { durationMs: 3_600_000 })), '1 h timer');
  assert.equal(durationName(90_000), '1 min 30 s');
  assert.equal(durationName(86_400_000), '24 h');
});
