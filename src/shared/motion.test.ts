import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaultSettings } from './defaults.ts';
import {
  ANIMATION_LEVELS,
  HOUR_HAND_MAX_STEP,
  MAX_REVEAL_STEPS,
  advanceAngle,
  advanceClockHands,
  effectiveAnimationLevel,
  motionPlan,
  revealTiming,
  type MotionSurface,
} from './motion.ts';
import { WIDGET_IDS, widgetRevealOrder } from './widgets.ts';

const SURFACES: MotionSurface[] = ['display', 'canvas', 'canvas-editing', 'sample'];

test('#76 motionPlan matrix: reduced motion is always Off and only Lively loops, on display and canvas', () => {
  for (const level of ANIMATION_LEVELS) for (const reducedMotion of [false, true]) for (const softMotion of [true, false]) for (const fadeSeconds of [0, 2]) for (const surface of SURFACES) for (const replay of [false, true]) {
    const label = JSON.stringify({ level, reducedMotion, softMotion, fadeSeconds, surface, replay });
    const plan = motionPlan({ level, reducedMotion, softMotion, fadeSeconds, surface, replay });
    if (reducedMotion) {
      assert.equal(plan.level, 'off', label);
      assert.deepEqual([plan.valueTransitions, plan.glyphOneShot, plan.glyphLoops, plan.entrance, plan.choreography, plan.editorPolish], [false, false, false, 'none', false, false], label);
      continue;
    }
    if (level !== 'lively') assert.equal(plan.glyphLoops, false, `${label}: Subtle and Off never loop`);
    if (plan.glyphLoops) assert.ok(surface === 'display' || surface === 'canvas', `${label}: loops only on display and canvas`);
    if (surface === 'sample') {
      assert.equal(plan.level, 'off', label);
      assert.deepEqual([plan.valueTransitions, plan.glyphOneShot, plan.glyphLoops, plan.entrance, plan.editorPolish], [false, false, false, 'none', false], label);
    }
    if (surface === 'canvas-editing') {
      assert.deepEqual([plan.valueTransitions, plan.glyphOneShot, plan.glyphLoops, plan.entrance, plan.choreography], [false, false, false, 'none', false], label);
      assert.equal(plan.editorPolish, level !== 'off', `${label}: Edit layout keeps editor polish only`);
    }
    if (surface === 'canvas' || surface === 'display') {
      assert.equal(plan.valueTransitions, level !== 'off', label);
      assert.equal(plan.glyphOneShot, level !== 'off', label);
      assert.equal(plan.glyphLoops, level === 'lively', label);
    }
    // The entrance needs a non-Off level and either the display with Drift and fade between moves and a fade, or a replay.
    const entranceExpected = level !== 'off' && (surface === 'display' || surface === 'canvas') && (replay || (surface === 'display' && softMotion && fadeSeconds > 0));
    assert.equal(plan.entrance, entranceExpected ? level : 'none', label);
    assert.equal(plan.choreography, plan.entrance === 'lively', label);
    if (surface === 'display') assert.equal(plan.editorPolish, false, label);
    if (level === 'off') assert.deepEqual([plan.valueTransitions, plan.glyphLoops, plan.entrance], [false, false, 'none'], label);
  }
});

test('#76 the effective level falls back to the default for unknown data and to Off for reduced motion', () => {
  assert.equal(effectiveAnimationLevel(undefined, false), 'subtle');
  assert.equal(effectiveAnimationLevel('lively', true), 'off');
  assert.equal(effectiveAnimationLevel('off', false), 'off');
  assert.equal(defaultSettings().appearance.animation, 'subtle');
});

test('#76 revealTiming caps the stagger at six steps and stays within the fade plus 1660 ms', () => {
  const none = revealTiming({ entrance: 'none' }, 2, 7);
  assert.deepEqual(none, { staggerMs: 0, enterMs: 0, totalMs: 0 });
  for (const entrance of ['subtle', 'lively'] as const) for (const fadeSeconds of [0, 0.2, 2, 10]) for (let count = 0; count <= 13; count++) {
    const timing = revealTiming({ entrance }, fadeSeconds, count);
    assert.ok(timing.totalMs <= fadeSeconds * 1000 + 1660, `${entrance} fade ${fadeSeconds} count ${count}: ${timing.totalMs}`);
    assert.ok(timing.totalMs >= fadeSeconds * 1000, 'covers the arrangement fade');
    assert.ok(timing.totalMs >= Math.min(Math.max(count - 1, 0), MAX_REVEAL_STEPS) * timing.staggerMs + timing.enterMs, 'covers the last widget');
    assert.ok(timing.enterMs <= 2000, 'no animation over 2 s');
  }
  assert.equal(revealTiming({ entrance: 'lively' }, 0, 13).totalMs, revealTiming({ entrance: 'lively' }, 0, MAX_REVEAL_STEPS + 1).totalMs, 'steps beyond six are capped');
  assert.deepEqual(revealTiming({ entrance: 'subtle' }, 0, 3), { staggerMs: 70, enterMs: 700, totalMs: 2 * 70 + 900 });
  assert.equal(revealTiming({ entrance: 'lively' }, 0, 20).totalMs, 1660);
});

test('#76 advanceAngle accumulates small forward steps and snaps everything else', () => {
  assert.deepEqual(advanceAngle(null, 42), { angle: 42, animate: false }, 'first render does not animate');
  assert.deepEqual(advanceAngle(354, 0), { angle: 360, animate: true }, '59 → 00 moves forward');
  assert.deepEqual(advanceAngle(354, 360), { angle: 360, animate: true });
  assert.deepEqual(advanceAngle(720 + 6, 12), { angle: 732, animate: true }, 'keeps accumulating past several turns');
  assert.deepEqual(advanceAngle(30, 30), { angle: 30, animate: false }, 'no change');
  assert.deepEqual(advanceAngle(390, 30), { angle: 390, animate: false }, 'same orientation keeps the accumulated angle');
  assert.deepEqual(advanceAngle(30, 24), { angle: 24, animate: false }, 'backwards snaps');
  assert.deepEqual(advanceAngle(0, 90), { angle: 90, animate: false }, 'a step of the limit or more snaps');
  assert.deepEqual(advanceAngle(0, 89), { angle: 89, animate: true });
  assert.deepEqual(advanceAngle(10, 12, 1), { angle: 12, animate: false }, 'custom step limit');
});

test('#76 analog hands: 10:59 → 11:00, 11:59 → 12:00 and midnight move forward; jumps snap; rebase stays bounded', () => {
  const at = (hours: number, minutes: number, previous: ReturnType<typeof advanceClockHands> | null = null) => advanceClockHands(previous, hours, minutes);
  const first = at(10, 59);
  assert.equal(first.animate, false, 'first render never animates');
  const eleven = at(11, 0, first);
  assert.equal(eleven.animate, true); assert.ok(eleven.minute > first.minute && eleven.hour > first.hour, 'both hands move clockwise');
  const noon = at(12, 0, at(11, 59));
  assert.equal(noon.animate, true); assert.equal(noon.minute, 360); assert.equal(noon.hour, 360, '12 o’clock is reached clockwise');
  let one = noon;
  for (let minute = 1; minute <= 60; minute++) { one = at(12 + Math.floor(minute / 60), minute % 60, one); assert.equal(one.animate, true); }
  assert.ok(one.hour > 360 && one.minute === 720, 'the 12 → 1 wrap keeps moving forward');
  const midnight = at(0, 0, at(23, 59));
  assert.equal(midnight.animate, true); assert.equal(midnight.hour, 360); assert.equal(midnight.minute, 360);
  // DST fall-back: 1:59 → 1:00. The minute hand alone could step forward, but both hands snap together.
  const fallBack = at(1, 0, at(1, 59));
  assert.deepEqual(fallBack, { hour: 30, minute: 0, animate: false });
  // Sleep/resume: a jump of three hours or more snaps (the hour hand's limit is 15 minutes of travel).
  const resumed = at(13, 30, at(10, 30));
  assert.deepEqual(resumed, { hour: 45, minute: 180, animate: false });
  assert.equal(at(10, 46, at(10, 30)).animate, false, 'more than 15 minutes is a jump');
  assert.equal(at(10, 44, at(10, 30)).animate, true, 'a short catch-up still eases');
  assert.ok(HOUR_HAND_MAX_STEP === 7.5);
  // #436: a long run accumulates and never re-bases (the display never goes black), so every minute
  // turns both hands forward by exactly one step, never backwards, across every 59 → 00 and 12:59 → 1:00.
  let hands = at(0, 0);
  for (let minute = 1; minute <= 60 * 30; minute++) {
    const next = at(Math.floor(minute / 60) % 24, minute % 60, hands);
    assert.ok(next.animate, `minute ${minute} eases`);
    assert.ok(Math.abs(next.minute - hands.minute - 6) < 1e-9, `minute ${minute}: the minute hand turns forward 6°`);
    assert.ok(Math.abs(next.hour - hands.hour - 0.5) < 1e-9, `minute ${minute}: the hour hand turns forward 0.5°`);
    hands = next;
  }
  assert.ok(hands.minute > 360 * 10, 'accumulated over many turns');
  // 12:59 → 1:00 rotates forward once: the minute hand from 354° (mod 360) to the next 360° multiple.
  const before = at(12, 59, at(12, 58)), oneOClock = at(13, 0, before);
  assert.equal(oneOClock.animate, true);
  assert.equal(oneOClock.minute - before.minute, 6, 'the minute hand moves forward once');
  assert.equal(oneOClock.minute % 360, 0);
  assert.ok(oneOClock.hour > before.hour && Math.abs(oneOClock.hour % 360 - 30) < 1e-9, 'the hour hand reaches 1 forward');
});

test('#76 widgetRevealOrder is row-major, deterministic, visible-only with catalog-order ties', () => {
  const grid = structuredClone(defaultSettings().widgetGrid);
  const ids = [...WIDGET_IDS];
  for (const id of ids) grid.placements[id] = { ...grid.placements[id], column: 0, row: 0 };
  grid.placements.reminders = { ...grid.placements.reminders, row: 0, column: 5 };
  grid.placements.clock = { ...grid.placements.clock, row: 2, column: 0 };
  grid.placements.weather = { ...grid.placements.weather, row: 0, column: 2 };
  grid.placements.forecast = { ...grid.placements.forecast, row: 1, column: 0 };
  grid.placements.rain = { ...grid.placements.rain, row: 0, column: 2 };
  const visible = ['clock', 'weather', 'rain', 'forecast', 'reminders'] as const;
  const order = widgetRevealOrder(grid, [...visible].reverse());
  assert.deepEqual(order, ['weather', 'rain', 'reminders', 'forecast', 'clock'], 'row, then column, then catalog order');
  assert.deepEqual(widgetRevealOrder(grid, [...visible]), order, 'input order does not matter');
  assert.deepEqual(widgetRevealOrder(grid, ['clock']), ['clock'], 'only the visible ids passed in');
  assert.deepEqual(widgetRevealOrder(grid, []), []);
});
