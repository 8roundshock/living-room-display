// Free-size Reminders (#73): catalog limits, shared geometry, validation, persistence and rollback
// containment. Synthetic data in temporary folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Settings, WidgetGrid, WidgetId } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import {
  ACTIVE_WIDGET_IDS, GRID_DENSITIES, WIDGET_IDS, composeWidgetGrid, familyForSpan, fitGridDensity, fitWidgetFamily, freeSpanLimits,
  getWidgetRect, gridProblem, intersects, isFreeSize, normalizePlacement, placementFits, placementLabel, placementSpan, reflowWidget,
  repackGrid, resizeWidgetSpan, switchGridDensity, type GridDensity,
} from '../shared/widgets.ts';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';
import { mergeSettings, settingsSchema } from './validation.ts';
import { PREVIOUS_RELEASE, persistableSettings } from './persistence.ts';
import { assertPreviousReaderAccepts, assertPreviousReaderRejects } from './compat/previous-reader.ts';
import { getVisual } from '../client/model.ts';

type Visibility = Partial<Record<WidgetId, boolean>>;
const only = (...ids: WidgetId[]): Visibility => Object.fromEntries(WIDGET_IDS.map(id => [id, ids.includes(id)]));
function disjoint(grid: WidgetGrid, enabled: Visibility) {
  const ids = WIDGET_IDS.filter(id => enabled[id]);
  for (const a of ids) for (const b of ids) {
    if (a >= b) continue;
    assert.equal(intersects(grid.placements[a], placementSpan(a, grid.placements[a]), grid.placements[b], placementSpan(b, grid.placements[b])), false, `${a} overlaps ${b}`);
  }
}
function stripSpans(settings: Settings): Settings {
  const result = structuredClone(settings);
  for (const grid of [result.widgetGrid, ...result.savedPresets.map(preset => preset.visual.widgetGrid)]) for (const id of WIDGET_IDS) delete grid.placements[id].span;
  return result;
}
function hasSpan(settings: Settings): boolean {
  return [settings.widgetGrid, ...settings.savedPresets.map(preset => preset.visual.widgetGrid)].some(grid => WIDGET_IDS.some(id => grid.placements[id].span));
}
function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}
/**
 * The default board with Last screen off and a medium Weather (for example a pre-#74 board whose
 * Rain was hidden). The post-#74 default large Weather leaves no room for a 2 × 8 column beside the
 * large Clock and Forecast (#183), so column fixtures start from this board.
 */
function roomyDefaults(): Settings {
  const settings = defaultSettings();
  settings.widgets.preview = false; settings.preview.enabled = false;
  settings.widgetGrid.placements.weather = { ...settings.widgetGrid.placements.weather, size: 'medium' };
  return settings;
}

test('catalog limits, families and labels for free-size widgets', () => {
  assert.equal(isFreeSize('reminders'), true);
  for (const id of WIDGET_IDS.filter(id => id !== 'reminders')) { assert.equal(isFreeSize(id), false); assert.equal(freeSpanLimits(id, 'balanced'), null); }
  assert.deepEqual(freeSpanLimits('reminders', 'spacious'), { min: { columns: 2, rows: 2 }, max: { columns: 5, rows: 6 } });
  assert.deepEqual(freeSpanLimits('reminders', 'balanced'), { min: { columns: 2, rows: 2 }, max: { columns: 8, rows: 8 } });
  assert.deepEqual(freeSpanLimits('reminders', 'fine'), { min: { columns: 2, rows: 2 }, max: { columns: 10, rows: 10 } });
  assert.deepEqual(placementSpan('reminders', { column: 0, row: 0, size: 'medium' }), { columns: 4, rows: 2 });
  assert.deepEqual(placementSpan('reminders', { column: 0, row: 0, size: 'small', span: { columns: 2, rows: 8 } }), { columns: 2, rows: 8 });
  assert.deepEqual(placementSpan('clock', { column: 0, row: 0, size: 'large' }, 1), { columns: 6, rows: 2 });
  assert.equal(familyForSpan('reminders', { columns: 3, rows: 3 }), 'small');
  assert.equal(familyForSpan('reminders', { columns: 4, rows: 3 }), 'medium');
  assert.equal(familyForSpan('reminders', { columns: 5, rows: 6 }), 'large');
  assert.equal(familyForSpan('reminders', { columns: 8, rows: 2 }), 'medium');
  assert.deepEqual(normalizePlacement('reminders', { column: 1, row: 2, size: 'small', span: { columns: 4, rows: 4 } }), { column: 1, row: 2, size: 'large' });
  assert.deepEqual(normalizePlacement('reminders', { column: 1, row: 2, size: 'large', span: { columns: 3, rows: 7 } }), { column: 1, row: 2, size: 'small', span: { columns: 3, rows: 7 } });
  assert.equal(Object.hasOwn(normalizePlacement('reminders', { column: 0, row: 0, size: 'small' }), 'span'), false, 'no undefined span key');
  assert.deepEqual(normalizePlacement('weather', { column: 0, row: 0, size: 'small', span: { columns: 2, rows: 2 } }).span, { columns: 2, rows: 2 }, 'other widgets keep the span so validation rejects it');
  assert.equal(placementLabel('reminders', { column: 0, row: 0, size: 'medium' }, 'balanced'), 'Medium');
  assert.equal(placementLabel('reminders', { column: 0, row: 0, size: 'small', span: { columns: 2, rows: 8 } }, 'balanced'), 'Column');
  assert.equal(placementLabel('reminders', { column: 0, row: 0, size: 'small', span: { columns: 2, rows: 8 } }, 'fine'), '2 × 8');
  assert.equal(placementLabel('reminders', { column: 0, row: 0, size: 'small', span: { columns: 3, rows: 5 } }, 'balanced'), '3 × 5');
});

test('placementFits and gridProblem validate custom spans with the shared rule', () => {
  const settings = defaultSettings(), grid = settings.widgetGrid, enabled = only('reminders');
  const check = (id: WidgetId, placement: WidgetGrid['placements'][WidgetId], target = grid) => {
    const next = { ...target, placements: { ...target.placements, [id]: placement } };
    return { fits: placementFits(next, id, placement, enabled), problem: gridProblem(next, { ...enabled, [id]: true }) };
  };
  assert.deepEqual(check('reminders', { column: 0, row: 0, size: 'small', span: { columns: 2, rows: 8 } }), { fits: true, problem: null });
  assert.deepEqual(check('weather', { column: 4, row: 0, size: 'small', span: { columns: 3, rows: 3 } }), { fits: false, problem: 'Weather does not support custom sizes' });
  assert.deepEqual(check('reminders', { column: 0, row: 0, size: 'small', span: { columns: 1, rows: 4 } }), { fits: false, problem: 'Reminders is smaller than its minimum size' });
  assert.deepEqual(check('reminders', { column: 0, row: 0, size: 'large', span: { columns: 9, rows: 4 } }), { fits: false, problem: 'Reminders is wider than two-thirds of the grid' });
  assert.deepEqual(check('reminders', { column: 0, row: 4, size: 'small', span: { columns: 2, rows: 8 } }), { fits: false, problem: 'Reminders is outside the grid' });
  assert.deepEqual(check('reminders', { column: 0, row: 0, size: 'large', span: { columns: 2, rows: 8 } }), { fits: false, problem: 'Reminders does not support this size' }, 'size must be the contained family');
  assert.deepEqual(check('reminders', { column: 0, row: 0, size: 'small', span: { columns: 2, rows: 6 } }, { ...grid, revision: 1 }), { fits: false, problem: 'Reminders does not support custom sizes' });
  assert.deepEqual(check('reminders', { column: 0, row: 0, size: 'small', span: { columns: 2, rows: 2.5 } }), { fits: false, problem: 'Reminders is smaller than its minimum size' });
  // Collision uses the span, not the family.
  const column = { ...grid, placements: { ...grid.placements, reminders: { column: 0, row: 0, size: 'small' as const, span: { columns: 2, rows: 8 } } } };
  assert.equal(placementFits(column, 'weather', { column: 1, row: 6, size: 'small' }, { reminders: true }), false);
  assert.equal(placementFits(column, 'weather', { column: 2, row: 6, size: 'small' }, { reminders: true }), true);
  assert.deepEqual(getWidgetRect(column, 'reminders'), { left: 0, top: 0, width: 2 / 12 * 100, height: 100 });
});

test('reflow and resize move neighbours for a full-height column or keep the board when impossible', () => {
  const settings = roomyDefaults(), enabled = { ...settings.widgets };
  const column = { column: 0, row: 0, size: 'small' as const, span: { columns: 2, rows: 8 } };
  const reflowed = reflowWidget(settings.widgetGrid, 'reminders', column, enabled); assert.ok(reflowed);
  assert.equal(gridProblem(reflowed, enabled), null); disjoint(reflowed, enabled);
  assert.deepEqual(reflowed.placements.reminders, column);
  assert.ok(WIDGET_IDS.some(id => enabled[id] && id !== 'reminders' && reflowed.placements[id].column !== settings.widgetGrid.placements[id].column), 'neighbours moved aside');

  const resized = resizeWidgetSpan(settings.widgetGrid, 'reminders', { columns: 2, rows: 8 }, enabled); assert.ok(resized);
  assert.deepEqual(placementSpan('reminders', resized.placements.reminders), { columns: 2, rows: 8 });
  assert.equal(resized.placements.reminders.row, 0, 'origin clamps so the span stays inside the board');
  assert.equal(gridProblem(resized, enabled), null);
  const back = resizeWidgetSpan(resized, 'reminders', { columns: 2, rows: 2 }, enabled); assert.ok(back);
  assert.equal(Object.hasOwn(back.placements.reminders, 'span'), false, 'a family-equal span is dropped');
  assert.equal(back.placements.reminders.size, 'small');

  // Every default widget plus a 5 × 8 Reminders cannot fit in Balanced: no partial board.
  const defaults = defaultSettings();
  assert.equal(resizeWidgetSpan(defaults.widgetGrid, 'reminders', { columns: 8, rows: 8 }, defaults.widgets), null);
  // After #74 the default large Weather leaves no room for a column even without Last screen (#183).
  assert.equal(resizeWidgetSpan(defaults.widgetGrid, 'reminders', { columns: 2, rows: 8 }, { ...defaults.widgets, preview: false }), null);
  assert.equal(resizeWidgetSpan(defaults.widgetGrid, 'reminders', { columns: 9, rows: 2 }, defaults.widgets), null, 'beyond the width limit');
  assert.equal(resizeWidgetSpan(defaults.widgetGrid, 'reminders', { columns: 1, rows: 2 }, defaults.widgets), null, 'below the minimum');
  assert.equal(resizeWidgetSpan(defaults.widgetGrid, 'weather', { columns: 3, rows: 3 }, defaults.widgets), null, 'not free-size');

  const family = fitWidgetFamily(resized, 'reminders', 'medium', enabled); assert.ok(family);
  assert.equal(Object.hasOwn(family.placements.reminders, 'span'), false, 'choosing a family drops the span');
  assert.equal(family.placements.reminders.size, 'medium');
});

test('density changes scale spans, keep full height, clamp width and fall back to a family', () => {
  const enabled = only('reminders', 'clock');
  const grid = defaultSettings().widgetGrid;
  grid.placements.clock = { column: 0, row: 0, size: 'small' };
  grid.placements.reminders = { column: 4, row: 0, size: 'large', span: { columns: 8, rows: 8 } };
  assert.equal(gridProblem(grid, enabled), null);
  const fine = repackGrid(grid, 'fine', enabled); assert.ok(fine);
  assert.deepEqual(fine.placements.reminders.span, { columns: 10, rows: 10 }, 'width 8 × 16/12 rounds to 11 and clamps to two-thirds');
  assert.equal(gridProblem(fine, enabled), null);
  const spacious = repackGrid(grid, 'spacious', enabled); assert.ok(spacious);
  assert.deepEqual(spacious.placements.reminders.span, { columns: 5, rows: 6 }, 'full height stays full height');

  const column = defaultSettings().widgetGrid;
  column.placements.reminders = { column: 0, row: 0, size: 'small', span: { columns: 2, rows: 8 } };
  column.placements.clock = { column: 2, row: 0, size: 'large' };
  assert.equal(gridProblem(column, enabled), null);
  assert.equal(repackGrid(column, 'spacious', enabled), null, 'a 2 × 6 column and an 8 × 4 clock cannot share Spacious');
  const fit = fitGridDensity(column, 'spacious', enabled); assert.ok(fit);
  assert.equal(Object.hasOwn(fit.grid.placements.reminders, 'span'), false, 'the column falls back to its family');
  assert.equal(fit.grid.placements.reminders.size, 'small');
  assert.equal(fit.grid.placements.clock.size, 'large', 'the smaller area loss is preferred');
  assert.deepEqual(fit.resized, [{ id: 'reminders', from: 'small', to: 'small', span: { columns: 2, rows: 8 } }], 'the dropped custom size is named (#152)');
  assert.equal(gridProblem(fit.grid, enabled), null);

  const there = switchGridDensity(column, 'spacious', enabled); assert.ok(there);
  const home = switchGridDensity(there.grid, 'balanced', enabled, there.history); assert.ok(home);
  assert.deepEqual(home.grid, column, 'a density round trip restores the exact span');
  const fineTrip = switchGridDensity(grid, 'fine', enabled); assert.ok(fineTrip);
  const restored = switchGridDensity(fineTrip.grid, 'balanced', enabled, fineTrip.history); assert.ok(restored);
  assert.deepEqual(restored.grid.placements.reminders.span, { columns: 8, rows: 8 });
  // A widget edit in the other density invalidates history; the span is then rescaled, never stale.
  const edited = structuredClone(fineTrip.grid); edited.placements.clock = { ...edited.placements.clock, column: 1 };
  const rescaled = switchGridDensity(edited, 'balanced', enabled, fineTrip.history); assert.ok(rescaled);
  assert.equal(rescaled.grid.placements.reminders.span?.rows, 8);
  assert.equal(gridProblem(rescaled.grid, enabled), null);
});

test('a minimum-width Column stays a Column in every density where it fits (#152)', () => {
  const enabled = only('reminders', 'clock');
  for (const from of Object.keys(GRID_DENSITIES) as GridDensity[]) {
    const grid = structuredClone(fitGridDensity(defaultSettings().widgetGrid, from, enabled)!.grid);
    grid.placements = { ...grid.placements, clock: { column: 4, row: 0, size: 'small' }, reminders: { column: 0, row: 0, size: 'small', span: { columns: 2, rows: GRID_DENSITIES[from].rows } } };
    assert.equal(gridProblem(grid, enabled), null, from);
    for (const to of Object.keys(GRID_DENSITIES) as GridDensity[]) {
      if (to === from) continue;
      const fit = fitGridDensity(grid, to, enabled); assert.ok(fit, `${from} → ${to}`);
      assert.deepEqual(fit.grid.placements.reminders.span, { columns: 2, rows: GRID_DENSITIES[to].rows }, `${from} → ${to} keeps the minimum width at full height`);
      assert.equal(placementLabel('reminders', fit.grid.placements.reminders, to), 'Column');
      assert.deepEqual(fit.resized, []);
    }
  }
  // A minimum-height span keeps its two rows too, while other axes still scale physically.
  const wide = defaultSettings().widgetGrid;
  wide.placements = { ...wide.placements, clock: { column: 0, row: 4, size: 'small' }, reminders: { column: 0, row: 0, size: 'medium', span: { columns: 6, rows: 2 } } };
  const fine = repackGrid(wide, 'fine', enabled); assert.ok(fine);
  assert.deepEqual(fine.placements.reminders.span, { columns: 8, rows: 2 }, '6 × 16/12 = 8 columns, rows stay at the minimum');
});

test('ambient composition keeps spans, stays disjoint and moves a full-height column sideways', () => {
  const settings = roomyDefaults(), enabled = { ...settings.widgets };
  const grid = resizeWidgetSpan(settings.widgetGrid, 'reminders', { columns: 2, rows: 8 }, enabled); assert.ok(grid);
  let previous = grid; const columns = new Set<number>();
  for (let cycle = 1; cycle <= 12; cycle++) {
    const next = composeWidgetGrid(grid, enabled, cycle, previous);
    assert.equal(gridProblem(next, enabled), null, `cycle ${cycle}`); disjoint(next, enabled);
    assert.deepEqual(next.placements.reminders.span, { columns: 2, rows: 8 });
    assert.equal(next.placements.reminders.row, 0, 'a full-height column can only move horizontally');
    columns.add(next.placements.reminders.column); previous = next;
  }
  assert.ok(columns.size >= 3, `the column visits several columns (${[...columns].join(', ')})`);

  const lone = defaultSettings().widgetGrid, solo = only('reminders', 'clock');
  lone.placements.reminders = { column: 0, row: 0, size: 'small', span: { columns: 2, rows: 8 } };
  lone.placements.clock = { column: 4, row: 0, size: 'small' };
  const moved = composeWidgetGrid(lone, solo, 1, lone);
  assert.notEqual(moved.placements.reminders.column, 0, 'a full-height column changes column when room exists');
  assert.equal(gridProblem(moved, solo), null);
});

test('custom spans compose with the #74 Rain merge and the #93 reflection fallback', () => {
  const samePositions = (a: WidgetGrid, b: WidgetGrid, ids: WidgetId[]) => ids.every(id => a.placements[id].column === b.placements[id].column && a.placements[id].row === b.placements[id].row);
  // Visible Weather and Rain stacked beside a Column: Weather takes their union, the span is untouched.
  const stacked = defaultSettings();
  stacked.widgets = { ...stacked.widgets, rain: true, preview: false }; stacked.preview.enabled = false;
  Object.assign(stacked.widgetGrid.placements, {
    reminders: { column: 0, row: 0, size: 'small', span: { columns: 2, rows: 8 } }, clock: { column: 2, row: 0, size: 'medium' },
    weather: { column: 8, row: 0, size: 'medium' }, rain: { column: 8, row: 2, size: 'medium' }, forecast: { column: 2, row: 6, size: 'large' },
  });
  stacked.savedPresets = [{ id: 'legacy-column', name: 'Legacy column', visual: getVisual(stacked) }];
  const merged = settingsSchema.parse(stacked);
  for (const [label, visual] of [['settings', merged], ['saved style', merged.savedPresets[0]!.visual]] as const) {
    assert.deepEqual(visual.widgetGrid.placements.weather, { column: 8, row: 0, size: 'large' }, `${label}: Weather takes the union`);
    assert.equal(visual.widgets.rain, false, label);
    assert.deepEqual(visual.widgetGrid.placements.rain, { column: 8, row: 2, size: 'medium' }, `${label}: Rain keeps its hidden placement`);
    assert.deepEqual(visual.widgetGrid.placements.reminders, { column: 0, row: 0, size: 'small', span: { columns: 2, rows: 8 } }, `${label}: the span is untouched`);
    assert.equal(gridProblem(visual.widgetGrid, visual.widgets), null, label);
  }
  // A stale editor re-enabling Rain over the saved Column board merges back to the same settings.
  assert.deepEqual(mergeSettings(merged, { widgets: { rain: true } }), merged);
  // Rollback: the span is the documented exception; stripping it leaves a board the previous release reads.
  assertPreviousReaderRejects('data', { version: 1, settings: persistableSettings(merged), reminders: [], photoAsset: null }, 'merged board with a span');
  const stripped = stripSpans(merged);
  assert.equal(gridProblem(stripped.widgetGrid, stripped.widgets), null);
  assertPreviousReaderAccepts('data', { version: 1, settings: persistableSettings(stripped), reminders: [], photoAsset: null }, 'merged board without spans');

  // A hidden Weather takes an enabled Rain's cells on a 100% full board with a 4 × 8 span, which then keeps
  // relocating through the reflection fallback without losing the span or overlapping.
  const full = defaultSettings();
  full.widgets = { ...full.widgets, weather: false, rain: true, preview: true, photo: false }; full.preview.enabled = true;
  Object.assign(full.widgetGrid.placements, {
    reminders: { column: 0, row: 0, size: 'large', span: { columns: 4, rows: 8 } }, clock: { column: 4, row: 0, size: 'large' },
    rain: { column: 4, row: 4, size: 'medium' }, preview: { column: 8, row: 4, size: 'medium' }, forecast: { column: 4, row: 6, size: 'large' },
  });
  const board = settingsSchema.parse(full), enabled = { ...board.widgets };
  assert.equal(enabled.weather, true); assert.equal(enabled.rain, false);
  assert.deepEqual(board.widgetGrid.placements.weather, { column: 4, row: 4, size: 'medium' }, 'Weather takes Rain’s cells');
  const ids = WIDGET_IDS.filter(id => enabled[id]);
  assert.equal(ids.reduce((sum, id) => { const span = placementSpan(id, board.widgetGrid.placements[id]); return sum + span.columns * span.rows; }, 0), 96, 'every Balanced cell is used');
  let previous = board.widgetGrid;
  for (let cycle = 1; cycle <= 12; cycle++) {
    const next = composeWidgetGrid(board.widgetGrid, enabled, cycle, previous);
    assert.equal(gridProblem(next, enabled), null, `cycle ${cycle}`); disjoint(next, enabled);
    assert.deepEqual(next.placements.reminders.span, { columns: 4, rows: 8 }, `cycle ${cycle} keeps the span`);
    assert.equal(samePositions(next, previous, ids), false, `cycle ${cycle} relocates the full board`);
    previous = next;
  }
});

test('containment: deleting every span keeps a valid layout that the previous release reads', () => {
  const next = random(73); let withSpans = 0, withNewWidgets = 0;
  for (let iteration = 0; iteration < 60; iteration++) {
    const settings = defaultSettings(), density = (['spacious', 'balanced', 'fine'] as GridDensity[])[Math.floor(next() * 3)]!;
    for (const id of ACTIVE_WIDGET_IDS) settings.widgets[id] = id === 'reminders' || next() < 0.6;
    settings.preview.enabled = settings.widgets.preview;
    const fitted = fitGridDensity(settings.widgetGrid, density, settings.widgets); if (!fitted) continue;
    settings.widgetGrid = fitted.grid;
    const limits = freeSpanLimits('reminders', density)!;
    const span = { columns: limits.min.columns + Math.floor(next() * (limits.max.columns - limits.min.columns + 1)), rows: limits.min.rows + Math.floor(next() * (limits.max.rows - limits.min.rows + 1)) };
    const resized = resizeWidgetSpan(settings.widgetGrid, 'reminders', span, settings.widgets); if (!resized) continue;
    settings.widgetGrid = resized;
    settings.savedPresets = [{ id: `style-${iteration}`, name: 'Synthetic style', visual: getVisual(settings) }];
    const parsed = settingsSchema.parse(settings);
    const stripped = stripSpans(parsed);
    assert.equal(gridProblem(stripped.widgetGrid, stripped.widgets), null, `iteration ${iteration} settings`);
    assert.equal(gridProblem(stripped.savedPresets[0]!.visual.widgetGrid, stripped.widgets), null, `iteration ${iteration} saved style`);
    // An enabled widget the previous release does not know (Calendar, Countdown, Note since #78) is its own
    // documented exception; turning it off in the settings and the saved style is the recovery step.
    const unknown = ACTIVE_WIDGET_IDS.filter(id => stripped.widgets[id] && !(PREVIOUS_RELEASE.widgetIds as readonly string[]).includes(id));
    if (unknown.length) {
      withNewWidgets++;
      assertPreviousReaderRejects('data', { version: 1, settings: persistableSettings(stripped), reminders: [], photoAsset: null }, `iteration ${iteration} stripped with ${unknown.join(', ')} on`);
      for (const visual of [stripped, stripped.savedPresets[0]!.visual]) for (const id of unknown) visual.widgets[id] = false;
      assert.equal(gridProblem(stripped.widgetGrid, stripped.widgets), null, `iteration ${iteration} settings without ${unknown.join(', ')}`);
    }
    assertPreviousReaderAccepts('data', { version: 1, settings: persistableSettings(stripped), reminders: [], photoAsset: null }, `iteration ${iteration} stripped`);
    if (hasSpan(parsed)) {
      withSpans++;
      assertPreviousReaderRejects('data', { version: 1, settings: persistableSettings(parsed), reminders: [], photoAsset: null }, `iteration ${iteration} with spans`);
    }
  }
  assert.ok(withSpans >= 20, `enough generated boards keep a custom span (${withSpans})`);
  const shipped = ACTIVE_WIDGET_IDS.some(id => !(PREVIOUS_RELEASE.widgetIds as readonly string[]).includes(id));
  assert.ok(!shipped || withNewWidgets >= 10, `enough generated boards place a span beside the #78 widgets (${withNewWidgets})`);
});

async function application() {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-freesize-'));
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const send = (method: string, path: string, value?: unknown) => fetch(`${url}${path}`, value === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const raw = async () => readFile(join(directory, 'state.json'), 'utf8');
  return { ...app, directory, send, raw, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); } };
}

test('settings PATCH saves, normalizes and clears spans atomically', async () => {
  const app = await application();
  try {
    const patch = async (value: unknown) => app.send('PATCH', '/api/settings', value);
    // Unrelated saves on span-less data never write a span key.
    assert.equal((await patch({ units: 'imperial' })).status, 200);
    assert.equal((await patch({ widgetGrid: { placements: { reminders: { column: 2, row: 4, size: 'small', span: null } } } })).status, 200);
    assert.equal((await app.raw()).includes('"span"'), false);
    assertPreviousReaderAccepts('data', JSON.parse(await app.raw()), 'span-less saves');

    let response = await patch({ widgetGrid: { placements: { reminders: { span: { columns: 4, rows: 2 } } } } });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(app.store.snapshot().settings.widgetGrid.placements.reminders, { column: 2, row: 4, size: 'medium' }, 'a family-equal span normalizes to its family');
    response = await patch({ widgetGrid: { placements: { reminders: { span: { columns: 5, rows: 2 } } } } });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(app.store.snapshot().settings.widgetGrid.placements.reminders, { column: 2, row: 4, size: 'medium', span: { columns: 5, rows: 2 } }, 'a span-only patch derives its family');

    const before = structuredClone(app.store.snapshot().settings);
    for (const invalid of [
      { reminders: { span: { columns: 9, rows: 2 } } },
      { reminders: { span: { columns: 1, rows: 2 } } },
      { reminders: { span: { columns: 2, rows: 0 } } },
      { reminders: { span: { columns: 2, rows: 3, depth: 1 } } },
      { weather: { span: { columns: 3, rows: 3 } } },
      { reminders: { row: 6, span: { columns: 2, rows: 4 } } },
    ]) {
      response = await patch({ units: 'metric', widgetGrid: { placements: invalid } });
      assert.equal(response.status, 400, JSON.stringify(invalid));
      assert.deepEqual(app.store.snapshot().settings, before, 'a rejected span changes nothing');
    }

    // A medium Weather makes room for the column beside the large Clock and Forecast (#74, #183).
    const free = { ...before.widgets, preview: false, rain: false };
    const settings = mergeSettings(before, { widgets: free, widgetGrid: { placements: { weather: { size: 'medium' } } } });
    const column = resizeWidgetSpan(settings.widgetGrid, 'reminders', { columns: 2, rows: 8 }, free); assert.ok(column);
    response = await patch({ widgets: free, widgetGrid: { placements: column.placements } });
    assert.equal(response.status, 200, await response.clone().text());
    const saved = app.store.snapshot().settings.widgetGrid.placements.reminders;
    assert.deepEqual(saved.span, { columns: 2, rows: 8 });
    assert.equal(saved.size, 'small');
    assert.match(await app.raw(), /"span"/);
    assertPreviousReaderRejects('data', JSON.parse(await app.raw()), 'a saved custom size is the documented exception');

    // A move keeps the span; a size-only patch is a family selection and clears it.
    const moved = await patch({ widgetGrid: { placements: { reminders: { column: saved.column } } } });
    assert.equal(moved.status, 200);
    assert.deepEqual(app.store.snapshot().settings.widgetGrid.placements.reminders.span, { columns: 2, rows: 8 });
    assert.equal((await patch({ widgetGrid: { placements: { reminders: { size: 'small' } } } })).status, 200);
    assert.equal(Object.hasOwn(app.store.snapshot().settings.widgetGrid.placements.reminders, 'span'), false);

    assert.equal((await patch({ widgetGrid: { placements: column.placements } })).status, 200);
    assert.equal((await patch({ widgetGrid: { placements: { reminders: { ...saved, span: null } } } })).status, 200);
    assert.equal(Object.hasOwn(app.store.snapshot().settings.widgetGrid.placements.reminders, 'span'), false, 'span: null clears');

    // Saved styles store spans and validate them like settings.
    assert.equal((await patch({ widgetGrid: { placements: column.placements } })).status, 200);
    const current = app.store.snapshot().settings;
    assert.equal((await patch({ savedPresets: [{ id: 'tall', name: 'Tall list', visual: getVisual(current) }] })).status, 200);
    assert.deepEqual(app.store.snapshot().settings.savedPresets[0]!.visual.widgetGrid.placements.reminders.span, { columns: 2, rows: 8 });
    const bad = getVisual(current); bad.widgetGrid.placements.reminders.span = { columns: 11, rows: 8 };
    assert.equal((await patch({ savedPresets: [{ id: 'bad', name: 'Too wide', visual: bad }] })).status, 400);

    // Export/import round trip keeps spans.
    const exported = await (await app.send('GET', '/api/export')).json();
    assert.deepEqual(exported.settings.widgetGrid.placements.reminders.span, { columns: 2, rows: 8 });
    assert.equal((await patch({ widgetGrid: { placements: { reminders: { size: 'small' } } } })).status, 200);
    assert.equal((await app.send('POST', '/api/import', exported)).status, 200);
    assert.deepEqual(app.store.snapshot().settings.widgetGrid.placements.reminders.span, { columns: 2, rows: 8 });
    assert.deepEqual(app.store.snapshot().settings.savedPresets[0]!.visual.widgetGrid.placements.reminders.span, { columns: 2, rows: 8 });
    // A stripped export imports into the previous release.
    const strippedExport = structuredClone(exported);
    for (const grid of [strippedExport.settings.widgetGrid, ...strippedExport.settings.savedPresets.map((preset: { visual: Settings }) => preset.visual.widgetGrid)]) for (const id of Object.keys(grid.placements)) delete grid.placements[id].span;
    assertPreviousReaderAccepts('import', strippedExport, 'stripped export');
    assertPreviousReaderRejects('import', exported, 'export with spans');
  } finally { await app.close(); }
});

test('composition stays fast on the densest free-size boards', () => {
  for (const density of Object.keys(GRID_DENSITIES) as GridDensity[]) {
    const settings = defaultSettings(); const enabled: Visibility = { ...settings.widgets, photo: true };
    const fitted = fitGridDensity(settings.widgetGrid, density, enabled); assert.ok(fitted);
    const limits = freeSpanLimits('reminders', density)!;
    // The tallest column that still fits beside every other enabled widget.
    let grid = fitted.grid;
    for (let rows = limits.max.rows; rows >= limits.min.rows; rows--) { const tall = resizeWidgetSpan(fitted.grid, 'reminders', { columns: 2, rows }, enabled); if (tall) { grid = tall; break; } }
    let previous = grid; const started = performance.now();
    for (let cycle = 1; cycle <= 12; cycle++) { previous = composeWidgetGrid(grid, enabled, cycle, previous); assert.equal(gridProblem(previous, enabled), null); }
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 3_000, `${density}: 12 compositions took ${Math.round(elapsed)} ms`);
  }
});
