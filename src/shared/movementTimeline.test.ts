import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from './defaults.ts';
import { composeWidgetGrid, getWidgetRect, gridProblem, WIDGET_IDS } from './widgets.ts';
import { clampFloatOffset, floatPath, stepPath, widgetTrack } from './float.ts';
import { compositionTimeline, glideKeyframes, movementFrame, movementWindow, previewTimeLabel } from './movementTimeline.ts';

const glide = { interval: 30, swaps: true, glide: true, fade: 2 };

test('#515 swap frames include the entire shared glide and preserve exact boundary semantics', () => {
  assert.equal(movementFrame(29.999, glide).cycle, 0);
  assert.deepEqual(movementFrame(30, glide), { cycle: 1, transition: 1, phase: 'glide', elapsed: 0, duration: 3 });
  assert.equal(movementFrame(31.5, glide).elapsed, 1.5);
  assert.equal(movementFrame(33, glide).phase, 'still');
  assert.equal(movementFrame(60, glide).cycle, 2);
  assert.equal(movementWindow(4, glide), 123);
  assert.equal(movementFrame(123, glide).phase, 'still');
  assert.equal(movementFrame(-5, glide).cycle, 0);
});

test('#515 dim swaps retain the source board until the midpoint and finish brightening', () => {
  const dim = { ...glide, glide: false };
  assert.equal(movementFrame(30, dim).cycle, 0);
  assert.equal(movementFrame(30.59, dim).cycle, 0);
  assert.equal(movementFrame(30.6, dim).cycle, 1);
  assert.equal(movementFrame(31.2, dim).phase, 'still');
  assert.equal(movementWindow(4, dim), 121.2);
  assert.equal(movementFrame(30, { ...dim, fade: 0 }).phase, 'still');
  assert.equal(movementFrame(30, { ...dim, fade: 0 }).cycle, 1);
  assert.equal(movementFrame(120, { ...glide, swaps: false }).cycle, 0);
  assert.equal(movementWindow(4, { ...glide, swaps: false }), 120);
});

test('#515 forward and backward seeks replay live composition history without mutating authored settings', () => {
  const settings = defaultSettings(), original = structuredClone(settings);
  const at = compositionTimeline(settings.widgetGrid, settings.widgets), sequential = [structuredClone(settings.widgetGrid)];
  for (let cycle = 1; cycle <= 24; cycle++) {
    sequential.push(composeWidgetGrid(settings.widgetGrid, settings.widgets, cycle, sequential[cycle - 1], [sequential[Math.max(0, cycle - 2)]!]));
  }
  for (const cycle of [24, 0, 12, 1, 4, 24, 8, 2]) {
    assert.deepEqual(at(cycle), sequential[cycle]);
    assert.equal(gridProblem(at(cycle), settings.widgets), null, `board ${cycle} stays collision free`);
    for (const id of WIDGET_IDS.filter(id => settings.widgets[id])) {
      const rect = getWidgetRect(at(cycle), id);
      assert.ok(rect.left >= 0 && rect.top >= 0 && rect.left + rect.width <= 100.001 && rect.top + rect.height <= 100.001);
    }
  }
  assert.deepEqual(settings, original);
  assert.notDeepEqual(at(4), at(0), 'four intervals do not imply a repeating arrangement cycle');
});

test('#515 a new layout/visibility sequence cannot reuse old preview history', () => {
  const settings = defaultSettings(), before = compositionTimeline(settings.widgetGrid, settings.widgets);
  before(12);
  const enabled = Object.fromEntries(WIDGET_IDS.map(id => [id, id === 'clock']));
  const after = compositionTimeline(settings.widgetGrid, enabled);
  assert.deepEqual(after(1), composeWidgetGrid(settings.widgetGrid, enabled, 1, settings.widgetGrid, [settings.widgetGrid]));
  assert.deepEqual(after(1), compositionTimeline(settings.widgetGrid, enabled)(1));
});

test('#515 sampled float tracks and shared glide keyframes are stable on repeated and backward seeks', () => {
  const samples = [0, 15, 30, 30.05, 75, 123];
  const frames = samples.map(seconds => ({ plane: floatPath(seconds, 30), widget: floatPath(seconds, 30, widgetTrack(2)), step: stepPath(seconds, 30) }));
  for (let index = samples.length - 1; index >= 0; index--) {
    const seconds = samples[index]!;
    assert.deepEqual({ plane: floatPath(seconds, 30), widget: floatPath(seconds, 30, widgetTrack(2)), step: stepPath(seconds, 30) }, frames[index]);
  }
  assert.notDeepEqual(floatPath(15, 30), floatPath(15, 30, widgetTrack(2)), 'widget phase differs from plane');
  const keys = glideKeyframes(-340, 120, 1, 3);
  assert.deepEqual(keys, [{ offset: 0, transform: 'translate(-340px, 120px)', opacity: 1 }, { offset: 0.5, opacity: 0.4 }, { offset: 1, transform: 'translate(0px, 0px)', opacity: 1 }]);
  const slack = { left: 0.3, right: 2.1, top: 3.2, bottom: 0.2 };
  for (const dpr of [1, 1.25, 2, 3]) {
    const offset = clampFloatOffset({ x: 999, y: -999 }, slack, dpr);
    assert.ok(offset.x <= slack.right && offset.y >= -slack.top, 'seek target clamps to current measured content slack');
  }
});

test('#515 elapsed labels expose seconds and longer windows without wrapping after an hour', () => {
  assert.equal(previewTimeLabel(0), '0:00.0');
  assert.equal(previewTimeLabel(30.05), '0:30.1');
  assert.equal(previewTimeLabel(3601.2), '1:00:01.2');
  assert.equal(previewTimeLabel(24 * 1800 + 6), '12:00:06.0');
});
