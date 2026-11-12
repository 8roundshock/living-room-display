import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { floatPath, PLANE_TRACK, SCENE_TRACK, stepPath, trackPosition, widgetTrack } from '../../shared/float.ts';
import { WIDGET_IDS } from '../../shared/widgets.ts';
import { floatOffset, SCENE_FLOAT } from './settings.ts';
// @ts-expect-error -- a plain JavaScript test tool without type declarations
import { ASPECTS, crops, exposed, floatExtremes, measure, measureAll, RESTING_SHARE, TOUCH } from '../../../tests/scene3d/edge-check.mjs';

// #675: the 3D scene layer floats like the board, on its own track, zoomed just enough that nothing
// anchored at an edge shows its end at the far ends of the travel.
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test('The scene track is its own: other waypoints than the board and every widget, even on the same clock', () => {
  // At runtime the scene runs on time since the epoch and the board on time since the display opened, so
  // their phase is arbitrary; on one shared clock the tracks must still part, which is what is checked here.
  const widgets = WIDGET_IDS.map((_, index) => widgetTrack(index));
  assert.equal(SCENE_TRACK.phase, .5); assert.notEqual(SCENE_TRACK.lead, PLANE_TRACK.lead);
  assert.ok(widgets.every(track => track.lead !== SCENE_TRACK.lead), 'no widget follows the scene’s waypoints');
  for (const [label, track] of [['the board', PLANE_TRACK], ...widgets.map((track, index) => [`widget ${index}`, track] as const)] as const) {
    let apart = 0;
    for (let i = 0; i < 400; i++) { const seconds = i * 37.3; if (distance(floatPath(seconds, 180, SCENE_TRACK), floatPath(seconds, 180, track)) > .1) apart++; }
    assert.ok(apart > 320, `the scene moves separately from ${label}: apart at ${apart} of 400 instants`);
  }
});

test('The scene stays within its travel and uses most of it; Float gently eases, otherwise it steps once per interval', () => {
  let most = { x: 0, y: 0 };
  for (let i = 0; i < 2000; i++) {
    const offset = floatOffset(trackPosition(i * 41.7, 180, true, SCENE_TRACK));
    assert.ok(Math.abs(offset.x) <= 2 * SCENE_FLOAT.travelX + 1e-12 && Math.abs(offset.y) <= 2 * SCENE_FLOAT.travelY + 1e-12, JSON.stringify(offset));
    most = { x: Math.max(most.x, Math.abs(offset.x)), y: Math.max(most.y, Math.abs(offset.y)) };
  }
  assert.ok(most.x > 1.9 * SCENE_FLOAT.travelX && most.y > 1.9 * SCENE_FLOAT.travelY, `reaches the ends of its travel: ${JSON.stringify(most)}`);
  // Eased: a small time step moves it a little; stepping: nothing moves inside an interval, then it jumps.
  const interval = 120, boundary = (3 - SCENE_TRACK.phase) * interval;
  assert.ok(distance(trackPosition(boundary + 30, interval, true, SCENE_TRACK), trackPosition(boundary + 31, interval, true, SCENE_TRACK)) < .02);
  assert.deepEqual(trackPosition(boundary + 1, interval, false, SCENE_TRACK), trackPosition(boundary + interval - 1, interval, false, SCENE_TRACK), 'still within one interval');
  assert.notDeepEqual(trackPosition(boundary - 1, interval, false, SCENE_TRACK), trackPosition(boundary + 1, interval, false, SCENE_TRACK), 'a step at the scene’s own boundary');
  assert.deepEqual(trackPosition(boundary + 1, interval, false, SCENE_TRACK), stepPath(boundary + 1 + SCENE_TRACK.phase * interval, interval, SCENE_TRACK));
  // The motion interval sets the pace: twice the interval reaches the same waypoint in twice the time.
  assert.deepEqual(trackPosition(500, 100, true, SCENE_TRACK), trackPosition(1000, 200, true, SCENE_TRACK));
});

test('The zoom covers the travel: a side edge element keeps crossing its edge, a standing one keeps standing on it', () => {
  const { zoom, x, y } = floatExtremes();
  assert.deepEqual(SCENE_FLOAT, { travelX: .02, travelY: .02, zoom: 1.043 });
  assert.ok(zoom * 1 - x - 1 >= -1e-12, 'anything that crosses a side edge, however little, still crosses it at the far end of the travel');
  assert.ok(zoom * (1 - TOUCH) - y - 1 > 0, 'anything standing on the bottom edge (or hanging from the top) still reaches it');
  assert.ok(SCENE_FLOAT.travelX >= .02 && SCENE_FLOAT.travelY >= .02, 'at least ±2% of the display on each axis');
});

type Row = { case: string; aspect: string; day: number; edges: Record<string, any> };
test('Every scene and weather overlay, at 16:9 and 21:9: no edge element shows its end and no whole piece is cut by the float', async () => {
  const rows: Row[] = await measureAll();
  assert.ok(rows.length >= 2 * (26 + 10), `${rows.length} cases`);
  const failures = rows.flatMap(row => exposed(row.edges).map((item: { edge: string; name: string; reach: number; clearance: number }) =>
    `${row.case} ${row.aspect} day ${row.day}: ${item.edge} ${item.name} reaches ${item.reach.toFixed(4)} beyond the edge, ${(-item.clearance).toFixed(4)} short`));
  assert.deepEqual(failures, [], 'an edge element would show its cut end or lift off the bottom edge; extend it past the edge (view.halfWAt(z) or a wider margin)');
  const anchored = rows.reduce((sum, row) => sum + ['left', 'right', 'bottom', 'top'].reduce((count, edge) => count + row.edges[edge].length, 0), 0);
  assert.ok(anchored > 200, `the check found edge elements to measure: ${anchored}`);
  // The crop rule (review of #676): a piece that was whole in the frame before the float stays whole at every
  // position; one resting near the bottom edge is whole at the centre and keeps RESTING_SHARE of itself in view.
  const cropped = rows.flatMap(row => crops(row.edges.pieces).map((item: { name: string; box: number[]; resting: boolean; centre: boolean; least: number; wholeShare: number }) =>
    `${row.case} ${row.aspect} day ${row.day}: ${item.resting ? 'resting' : 'free'} ${item.name} at (${((item.box[0] + item.box[1]) / 2).toFixed(2)}, ${((item.box[2] + item.box[3]) / 2).toFixed(2)}): whole ${Math.round(item.wholeShare * 100)}% of the time, at least ${Math.round(item.least * 100)}% in view${item.resting && !item.centre ? ', cut at the centre' : ''}`));
  assert.deepEqual(cropped, [], `a whole piece would be cut by the float; move it inward (resting pieces keep ${RESTING_SHARE * 100}% in view)`);
  const pieces = rows.reduce((sum, row) => sum + row.edges.pieces.length, 0);
  assert.ok(pieces > 300, `the check found whole pieces to measure: ${pieces}`);
});

test('The crop check can fail: with the first candidate (±3% × ±2.5% at a 6% zoom) Pascha’s eggs and kulich are cut', async () => {
  const edges = await measure('pascha', { aspect: ASPECTS['16:9'] }), wider = floatExtremes({ travelX: .03, travelY: .025, zoom: 1.06 });
  assert.deepEqual(crops(edges.pieces), []);
  assert.ok(crops(edges.pieces, wider).some((item: { resting: boolean }) => item.resting), 'a resting piece is cut at the wider float');
});

test('The edge check can fail: Autumn’s twig that barely crosses the left edge would show its end with less zoom', async () => {
  const edges = await measure('autumn', { aspect: ASPECTS['16:9'] });
  assert.ok(edges.left.length > 0 && edges.left[0].reach < .01, 'Autumn has a left-edge element that reaches less than 0.01 beyond the edge');
  assert.deepEqual(exposed(edges), []);
  assert.ok(exposed(edges, { zoom: 1, x: .06, y: .05 }).some((item: { edge: string }) => item.edge === 'left'), 'without the zoom its end would show');
});

test('The engine floats the picture in the projection and has no scene-clock drift left', () => {
  const engine = readFileSync(new URL('./engine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(engine, /DRIFT/);
  assert.match(engine, /camera\.projectionMatrix\.premultiply\(zoomMatrix\)/);
  assert.match(engine, /seconds = real - floatOriginFor\(float\.interval\);/);
  assert.match(engine, /floatOffset\(trackPosition\(seconds, float\.interval, float\.gentle, SCENE_TRACK\)\)/);
  assert.match(engine, /^const floatOrigin = \{ interval: 0, at: 0 \};$/m, 'the float origin is shared by every stage on the page, so a new stage does not jump');
  assert.match(engine, /let float = still \? null : initialFloat/, 'a still preview does not float');
});
