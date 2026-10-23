import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOAT_TRAVEL, MAX_STEPS_PER_SECOND, PLANE_TRACK, clampFloatOffset, devicePosition, easedProgress, floatOffset, floatPath, nextBoundaryDelay,
  nextStepDelay, stepPath, waypoint, waypointUnit, widgetPhase, widgetTrack,
} from './float.ts';

const DAY = 24 * 3600;
const RANGE = 2 * FLOAT_TRAVEL;

test('#479 growing content clamps a floating offset inside all four new edges at once', () => {
  // The reported Sun & moon failure: 13 CSS px right, only 2.2 CSS px of room after growth.
  assert.deepEqual(clampFloatOffset({ x: 13, y: -6 }, { left: 0, right: 2.2, top: 1.1, bottom: 0 }, 3), { x: 2, y: -1 });
  for (const dpr of [1, 1.25, 2, 3]) {
    const slack = { left: 2.1, right: 3.1, top: 1.1, bottom: 4.1 };
    for (const x of [-77, 77]) for (const y of [-77, 77]) {
      const clamped = clampFloatOffset({ x, y }, slack, dpr);
      assert.ok(clamped.x >= -slack.left && clamped.x <= slack.right);
      assert.ok(clamped.y >= -slack.top && clamped.y <= slack.bottom);
      assert.ok(Math.abs(clamped.x * dpr - Math.round(clamped.x * dpr)) < 1e-9);
      assert.ok(Math.abs(clamped.y * dpr - Math.round(clamped.y * dpr)) < 1e-9);
    }
  }
  assert.deepEqual(clampFloatOffset({ x: 13, y: -6 }, { left: 0, right: 0, top: 0, bottom: 0 }, 3), { x: 0, y: 0 });
});

test('#479 a valid offset is unchanged when content shrinks or its slack stays the same', () => {
  const offset = { x: 8 / 3, y: -4 / 3 };
  for (const available of [10, 50, 100])
    assert.deepEqual(clampFloatOffset(offset, { left: available, right: available, top: available, bottom: available }, 3), offset);
});

test('#436 the board starts where the user put it, and 24 hours of samples stay within ±3.5% of the display', () => {
  assert.deepEqual(floatOffset(0, 30), { x: 0, y: 0 }, 'waypoint 0 is the authored arrangement');
  for (const interval of [30, 180, 1800]) {
    let maxX = 0, maxY = 0;
    for (let seconds = 0; seconds <= DAY; seconds += 7.3) {
      const { x, y } = floatOffset(seconds, interval);
      assert.ok(Math.abs(x) <= FLOAT_TRAVEL && Math.abs(y) <= FLOAT_TRAVEL, `${interval} s at ${seconds}: ${x}, ${y}`);
      maxX = Math.max(maxX, Math.abs(x)); maxY = Math.max(maxY, Math.abs(y));
    }
    // Not vacuous: the board really uses most of its travel.
    assert.ok(maxX > 0.9 * FLOAT_TRAVEL && maxY > 0.9 * FLOAT_TRAVEL, `${interval} s covers the travel: ${maxX}, ${maxY}`);
  }
  for (let index = 0; index < 12; index++) for (let seconds = 0; seconds <= DAY; seconds += 61.7) {
    const { x, y } = widgetPhase(seconds, 30, index);
    assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1, `widget ${index} at ${seconds}`);
  }
});

test('#436 consecutive waypoints are far apart and none returns within the next eight', () => {
  for (let k = 0; k < 5000; k++) {
    const a = waypoint(k), b = waypoint(k + 1);
    const apart = Math.hypot(a.x - b.x, a.y - b.y);
    assert.ok(apart >= 0.4 * RANGE, `waypoints ${k} and ${k + 1} are ${(apart / RANGE * 100).toFixed(1)}% of the range apart`);
    assert.ok(Math.abs(a.x - b.x) >= 0.38 * RANGE && Math.abs(a.y - b.y) >= 0.41 * RANGE, `both axes move between ${k} and ${k + 1}`);
    for (let back = 1; back <= 8 && back <= k; back++) {
      const earlier = waypoint(k - back);
      assert.ok(Math.hypot(a.x - earlier.x, a.y - earlier.y) > 0.005, `waypoint ${k} is more than 0.5% of the display from waypoint ${k - back}`);
    }
  }
  assert.deepEqual(waypointUnit(0), { x: 0, y: 0 });
});

test('#436 the path reaches a new waypoint at every interval boundary and eases at both ends', () => {
  for (const k of [0, 1, 2, 17, 400]) {
    const at = floatPath(k * 30, 30);
    const expected = waypointUnit(k);
    assert.ok(Math.abs(at.x - expected.x) < 1e-9 && Math.abs(at.y - expected.y) < 1e-9, `boundary ${k}`);
  }
  assert.equal(easedProgress(0), 0); assert.equal(easedProgress(1), 1); assert.equal(easedProgress(0.5), 0.5);
  // Continuous and monotonic, with constant speed in the middle.
  let previous = 0;
  for (let u = 0.001; u <= 1; u += 0.001) { const p = easedProgress(u); assert.ok(p >= previous && p - previous < 0.0013, `u ${u}`); previous = p; }
  assert.ok(Math.abs((easedProgress(0.6) - easedProgress(0.4)) - (easedProgress(0.8) - easedProgress(0.6))) < 1e-9, 'linear in the middle');
  assert.ok(easedProgress(0.05) < 0.05 && easedProgress(0.95) > 0.95, 'eased at the ends');
});

test('#436 a step never moves more than one device pixel on either axis at dpr 1, 2 and 3 for 1280 × 720', () => {
  for (const dpr of [1, 2, 3]) for (const interval of [30, 180]) {
    const scale = { x: FLOAT_TRAVEL * 1280 * dpr, y: FLOAT_TRAVEL * 720 * dpr };
    let seconds = 0, last = devicePosition(floatPath(0, interval), scale), steps = 0, changes = 0;
    while (seconds < 2 * 3600) {
      const delay = nextStepDelay(seconds, interval, scale);
      assert.ok(delay >= 1 / MAX_STEPS_PER_SECOND - 1e-12, `at most ${MAX_STEPS_PER_SECOND} steps a second (${delay})`);
      seconds += delay; steps++;
      const next = devicePosition(floatPath(seconds, interval), scale);
      assert.ok(Math.abs(next.x - last.x) <= 1 && Math.abs(next.y - last.y) <= 1, `dpr ${dpr}, ${interval} s: ${JSON.stringify(last)} → ${JSON.stringify(next)} at ${seconds}`);
      if (next.x !== last.x || next.y !== last.y) changes++;
      last = next;
    }
    // The timer wakes only when a pixel changes (a few wake-ups land between a segment's last change and its end).
    assert.ok(changes >= steps * 0.95, `dpr ${dpr}, ${interval} s: ${changes} changes in ${steps} wake-ups`);
  }
});

test('#436 a widget track inside its slack also steps one device pixel at a time, out of step with the board', () => {
  const scale = { x: 30, y: 12, originX: 30, originY: 0 };
  let seconds = 0, last = devicePosition(widgetPhase(0, 30, 2), scale);
  while (seconds < 1800) {
    seconds += nextStepDelay(seconds, 30, scale, widgetTrack(2));
    const next = devicePosition(widgetPhase(seconds, 30, 2), scale);
    assert.ok(Math.abs(next.x - last.x) <= 1 && Math.abs(next.y - last.y) <= 1, `${JSON.stringify(last)} → ${JSON.stringify(next)}`);
    assert.ok(next.x >= 0 && next.x <= 60 && Math.abs(next.y) <= 12, 'inside its slack');
    last = next;
  }
  const phases = Array.from({ length: 6 }, (_, index) => widgetTrack(index).phase);
  assert.equal(new Set(phases.map(phase => phase.toFixed(3))).size, 6, 'no two widgets move in lockstep');
  assert.notDeepEqual(widgetPhase(100, 30, 0), widgetPhase(100, 30, 1));
  // A range under one pixel never wakes the timer more often than every few intervals.
  assert.ok(nextStepDelay(0, 30, { x: 0.2, y: 0.2 }) > 30);
});

test('#436 stepping (Float gently off or reduced motion) jumps only at interval boundaries', () => {
  for (let seconds = 0; seconds < 300; seconds += 0.25) {
    const k = Math.floor(seconds / 30);
    assert.deepEqual(stepPath(seconds, 30), waypointUnit(k));
    assert.deepEqual(stepPath(seconds, 30, widgetTrack(1)), waypointUnit(k + widgetTrack(1).lead));
  }
  assert.ok(Math.abs(nextBoundaryDelay(0, 30) - 30.001) < 1e-9);
  assert.ok(Math.abs(nextBoundaryDelay(29.5, 30) - 0.501) < 1e-9);
  assert.ok(Math.abs(nextBoundaryDelay(30.001, 30) - 30) < 1e-6);
});

test('#436 float is deterministic', () => {
  for (const seconds of [0, 1.5, 29.99, 30, 1234.5, DAY]) {
    assert.deepEqual(floatPath(seconds, 30), floatPath(seconds, 30));
    assert.deepEqual(floatPath(seconds, 30, PLANE_TRACK), floatPath(seconds, 30));
    assert.equal(nextStepDelay(seconds, 30, { x: 134, y: 76 }), nextStepDelay(seconds, 30, { x: 134, y: 76 }));
  }
});
