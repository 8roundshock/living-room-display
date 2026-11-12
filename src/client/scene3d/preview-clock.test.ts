import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { floatPath, SCENE_TRACK, trackPosition } from '../../shared/float.ts';
import { stageClock } from './engine.js';
import { SCENE_CLOCK } from './settings.ts';

// #678: the editor's movement preview drives the 3D scene's float and its own clock, as it drives the board.
// Outside the preview both stay on real time, exactly as before.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const running = () => stageClock({ frozen: false, start: SCENE_CLOCK.start, still: SCENE_CLOCK.still, timeScale: 1 / 8 });
const REAL = 1_800_000_000, ORIGIN = 0;
const near = (actual: number, expected: number, message: string) => assert.ok(Math.abs(actual - expected) < 1e-12, `${message}: ${actual} and ${expected}`);

test('On real time the float reads epoch seconds less its origin and the scene clock runs at its time scale', () => {
  const clock = running();
  assert.equal(clock.preview, null); assert.equal(clock.time, SCENE_CLOCK.start);
  assert.equal(clock.track(REAL, ORIGIN), REAL); assert.equal(clock.track(REAL, 600), REAL - 600);
  clock.advance(.05); near(clock.time, SCENE_CLOCK.start + .05 / 8, 'an eighth of real time');
  clock.advance(5); near(clock.time, SCENE_CLOCK.start + .15 / 8, 'a late frame counts at most 0.1 s');
  for (const value of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) { clock.follow(value); assert.equal(clock.preview, null, String(value)); }
  assert.equal(clock.track(REAL, ORIGIN), REAL, 'anything but a finite number is real time');
});

test('Under a preview the float reads the preview time and the scene clock is that time mapped like real time', () => {
  const clock = running();
  clock.follow(30);
  assert.equal(clock.preview, 30); assert.equal(clock.track(REAL, ORIGIN), 30); assert.equal(clock.track(REAL + 999, 600), 30, 'real time no longer moves it');
  assert.equal(clock.time, SCENE_CLOCK.start + 30 / 8);
  clock.advance(.05); clock.advance(.05); assert.equal(clock.time, SCENE_CLOCK.start + 30 / 8, 'a held preview holds the scene clock');
  clock.follow(3600); assert.equal(clock.time, SCENE_CLOCK.start + 450, 'a seek to the end of the hour');
  clock.follow(12); assert.equal(clock.time, SCENE_CLOCK.start + 1.5, 'and back again: the same moment gives the same scene time');
  clock.follow(-5); assert.equal(clock.preview, 0); assert.equal(clock.time, SCENE_CLOCK.start, 'before the start is the start');
});

test('When the preview ends the float is on real time at once and the scene clock carries on from the preview', () => {
  const clock = running();
  clock.follow(90); const left = clock.time;
  clock.follow(null);
  assert.equal(clock.preview, null); assert.equal(clock.track(REAL, ORIGIN), REAL, 'the float returns to real time immediately, as the board does');
  assert.equal(clock.time, left, 'the scene’s life does not jump');
  clock.advance(.05); near(clock.time, left + .05 / 8, 'and runs on from there');
});

test('A frozen clock (a quiet date, a still preview) never moves; under a preview only the float follows it', () => {
  const quiet = stageClock({ frozen: true, start: SCENE_CLOCK.start, still: SCENE_CLOCK.still, timeScale: 0 });
  assert.equal(quiet.time, SCENE_CLOCK.still);
  quiet.follow(300); quiet.advance(.05);
  assert.equal(quiet.time, SCENE_CLOCK.still, 'the frozen scene clock stays'); assert.equal(quiet.track(REAL, ORIGIN), 300, 'the float follows the preview');
  quiet.follow(null); assert.equal(quiet.time, SCENE_CLOCK.still); assert.equal(quiet.track(REAL, ORIGIN), REAL);
});

test('A preview shows the scene and the board on the same clock: an interval apart, both have moved', () => {
  // The positions the stage draws at preview times t and t + interval, against the board's at the same times.
  const interval = 180, clock = running(), at = (seconds: number) => { clock.follow(seconds); return trackPosition(clock.track(REAL, ORIGIN), interval, true, SCENE_TRACK); };
  for (const t of [0, 400, 1234, 3420]) {
    const scene = [at(t), at(t + interval)], board = [floatPath(t, interval), floatPath(t + interval, interval)];
    assert.ok(Math.hypot(scene[1].x - scene[0].x, scene[1].y - scene[0].y) > .05, `the scene moved over an interval from ${t} s`);
    assert.ok(Math.hypot(board[1].x - board[0].x, board[1].y - board[0].y) > .05, `the board moved over an interval from ${t} s`);
    assert.deepEqual(at(t), scene[0], 'seeking back shows the same position');
  }
});

test('The preview reaches the live stage without a new stage: Display passes the preview time, Scene3D sets it in place', () => {
  const display = read('../Display.tsx'), scene = read('./Scene3D.tsx'), engine = read('./engine.js');
  assert.match(display, /const scenePreview = controlled \? previewTime : null;/, 'only the controlled (movement preview) canvas follows a preview; everything else is on real time');
  assert.match(display, /preview: scenePreview \}\), \[[^\]]*scenePreview\]/);
  assert.match(scene, /useEffect\(\(\) => \{ live\.current\?\.setPreview\(floatPreview\); \}, \[floatPreview\]\);/);
  const mount = scene.match(/return \(\) => \{ cancelled = true;[^\n]*\n\s*\}, \[([^\]]*)\]\);/);
  assert.ok(mount, 'the effect that makes the stage'); assert.doesNotMatch(mount[1], /preview|float/i, 'a preview step never remounts the stage or makes a WebGL context');
  assert.match(scene, /preview: previewNow\.current,/, 'a stage made during a preview starts at its time'); assert.match(engine, /preview: initialPreview = null/);
  assert.match(engine, /if \(clock\.preview !== null && clock\.preview === drawnPreview\) return;/, 'a held preview draws nothing new');
  assert.match(engine, /if \(!still\) clock\.follow\(initialPreview\);/, 'a still preview ignores it');
});
