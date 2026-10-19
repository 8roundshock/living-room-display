// Dense-board relocation (#93): when the bounded search cannot move every widget, a whole-board
// reflection keeps the composition moving. Geometry is status-agnostic, so every #78 widget (shipped, like
// Calendar, Countdown and Note, or still planned) is enabled here to model the fuller boards they make common.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { WidgetGrid, WidgetId } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import {
  GRID_DENSITIES, WIDGET_IDS, WIDGET_SIZES, composeWidgetGrid, displayPlacement, firstPlacement, freeSpanLimits, gridProblem,
  placementSpan, reflowWidget, resizeWidgetSpan, widgetSizes, type GridDensity,
} from '../shared/widgets.ts';
import { PREVIOUS_RELEASE } from './persistence.ts';

/** The ids #78 appended after the previous release's ones, whatever their current status. */
const CATALOG_78: WidgetId[] = WIDGET_IDS.filter(id => !(PREVIOUS_RELEASE.widgetIds as readonly string[]).includes(id));

type Visibility = Partial<Record<WidgetId, boolean>>;
function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}
function fill(grid: WidgetGrid, enabled: Visibility): number {
  const { columns, rows } = GRID_DENSITIES[grid.density];
  return WIDGET_IDS.filter(id => enabled[id]).reduce((sum, id) => { const span = placementSpan(id, grid.placements[id]); return sum + span.columns * span.rows; }, 0) / (columns * rows);
}
function samePositions(a: WidgetGrid, b: WidgetGrid, ids: WidgetId[]): boolean {
  return ids.every(id => a.placements[id].column === b.placements[id].column && a.placements[id].row === b.placements[id].row);
}
/** True only when every whole-board reflection maps the board onto itself: no legal reflected alternative. */
function symmetric(grid: WidgetGrid, ids: WidgetId[]): boolean {
  return [1, 2, 3].every(variant => ids.every(id => {
    const point = displayPlacement(grid, id, variant);
    return point.column === grid.placements[id].column && point.row === grid.placements[id].row;
  }));
}
/** Random dense boards from every catalog id, with a free-size Reminders span grown into leftover cells. */
function denseBoards(density: GridDensity, count: number): { grid: WidgetGrid; enabled: Visibility }[] {
  const boards: { grid: WidgetGrid; enabled: Visibility }[] = [];
  for (let seed = 1; boards.length < count && seed < 4_000; seed++) {
    const next = random(seed * 977 + density.length);
    let grid: WidgetGrid = { ...defaultSettings().widgetGrid, density };
    const enabled: Visibility = Object.fromEntries(WIDGET_IDS.map(id => [id, false]));
    // Hidden placements must still be in bounds for the chosen density.
    for (const id of WIDGET_IDS) grid.placements[id] = firstPlacement(grid, id, 'small', {})!;
    const order = [...WIDGET_IDS].sort(() => next() - 0.5);
    for (const id of order) {
      const sizes = [...widgetSizes(id)].sort(() => next() - 0.5);
      for (const size of sizes) {
        const placement = firstPlacement(grid, id, size, enabled);
        if (!placement) continue;
        const placed = reflowWidget(grid, id, placement, enabled);
        if (placed) { grid = placed; enabled[id] = true; break; }
      }
    }
    if (enabled.reminders) {
      const limits = freeSpanLimits('reminders', density)!;
      const columns = limits.min.columns + Math.floor(next() * (limits.max.columns - limits.min.columns + 1));
      for (let rows = limits.max.rows; rows >= limits.min.rows; rows--) {
        const grown = resizeWidgetSpan(grid, 'reminders', { columns, rows }, enabled);
        if (grown && fill(grown, enabled) > fill(grid, enabled)) { grid = grown; break; }
      }
    }
    const ratio = fill(grid, enabled);
    if (ratio >= 0.9 && ratio <= 1 && gridProblem(grid, enabled) === null) boards.push({ grid, enabled });
  }
  return boards;
}

test('dense boards in every density keep moving unless no reflected alternative exists', () => {
  for (const density of Object.keys(GRID_DENSITIES) as GridDensity[]) {
    const boards = denseBoards(density, 6);
    assert.ok(boards.length >= 4, `${density}: generated ${boards.length} boards at 90–100% fill`);
    assert.ok(boards.some(board => CATALOG_78.some(id => board.enabled[id])), `${density}: #78 widgets take part`);
    for (const [index, { grid, enabled }] of boards.entries()) {
      const ids = WIDGET_IDS.filter(id => enabled[id]); let previous = grid; const started = performance.now();
      for (let cycle = 1; cycle <= 24; cycle++) {
        const next = composeWidgetGrid(grid, enabled, cycle, previous);
        assert.equal(gridProblem(next, enabled), null, `${density} board ${index} cycle ${cycle}`);
        for (const id of ids) assert.deepEqual(placementSpan(id, next.placements[id]), placementSpan(id, grid.placements[id]), 'whole groups keep their size');
        if (samePositions(next, previous, ids)) assert.ok(symmetric(previous, ids), `${density} board ${index} cycle ${cycle} repeated a board that a reflection could move`);
        previous = next;
      }
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 4_000, `${density} board ${index}: 24 compositions took ${Math.round(elapsed)} ms`);
    }
  }
});

/** The board's compositions as position strings, one per cycle (the authored board first). */
function compositions(grid: WidgetGrid, enabled: Visibility, cycles: number): { keys: string[]; last: WidgetGrid } {
  const ids = WIDGET_IDS.filter(id => enabled[id]); const key = (board: WidgetGrid) => ids.map(id => `${board.placements[id].column},${board.placements[id].row}`).join('|');
  const keys = [key(grid)]; let previous = grid;
  for (let cycle = 1; cycle <= cycles; cycle++) {
    const next = composeWidgetGrid(grid, enabled, cycle, previous);
    assert.equal(gridProblem(next, enabled), null, `cycle ${cycle} is collision-free and in bounds`);
    keys.push(key(next)); previous = next;
  }
  return { keys, last: previous };
}

test('dense boards vary their reflections instead of alternating between two arrangements (#182)', () => {
  // Measured on 2026-10-19 with these 36 boards × 24 cycles: before #182 the fallback always chose the
  // reflection moving the most widgets (ties: most travel), and 470 of 864 compositions repeated the one
  // from two cycles earlier (31 boards; 3 boards showed only two arrangements). Rotating the choice
  // gives 33 repeats on 9 boards, and every board reaches more than two arrangements.
  let total = 0, repeats = 0;
  for (const density of Object.keys(GRID_DENSITIES) as GridDensity[]) {
    const boards = denseBoards(density, 12);
    assert.ok(boards.length >= 10, `${density}: generated ${boards.length} boards at 90–100% fill`);
    for (const [index, { grid, enabled }] of boards.entries()) {
      const ids = WIDGET_IDS.filter(id => enabled[id]);
      const { keys, last } = compositions(grid, enabled, 24);
      for (let cycle = 2; cycle < keys.length; cycle++) { total++; if (keys[cycle] === keys[cycle - 2]) repeats++; }
      // A third legal arrangement exists when the whole-board reflections of a composition differ.
      const orbit = new Set([0, 1, 2, 3].map(variant => ids.map(id => { const point = displayPlacement(last, id, variant); return `${point.column},${point.row}`; }).join('|')));
      if (orbit.size > 2) assert.ok(new Set(keys.slice(1)).size > 2, `${density} board ${index}: more than two arrangements in 24 cycles`);
    }
  }
  assert.ok(repeats <= total * 0.1, `two-cycle repeats ${repeats} of ${total}`);
});

test('the #93 probe board (default plus a medium Photo) never stalls', () => {
  const settings = defaultSettings(); const enabled: Visibility = { ...settings.widgets, photo: true };
  const placed = reflowWidget(settings.widgetGrid, 'photo', firstPlacement(settings.widgetGrid, 'photo', 'medium', enabled)!, enabled);
  assert.ok(placed); assert.equal(fill(placed, enabled), 84 / 96);
  const ids = WIDGET_IDS.filter(id => enabled[id]); let previous = placed, stalls = 0;
  for (let cycle = 1; cycle <= 40; cycle++) {
    const next = composeWidgetGrid(placed, enabled, cycle, previous);
    assert.equal(gridProblem(next, enabled), null);
    if (samePositions(next, previous, ids)) stalls++;
    previous = next;
  }
  assert.equal(stalls, 0);
});

test('a 100% full board relocates, and a two-thirds-wide full-height span always has room to travel', () => {
  // Spacious 8 × 6: the 8 × 4 large clock plus four small widgets fill every cell.
  const grid: WidgetGrid = { ...defaultSettings().widgetGrid, density: 'spacious' };
  for (const id of WIDGET_IDS) grid.placements[id] = firstPlacement(grid, id, 'small', {})!;
  const enabled: Visibility = Object.fromEntries(WIDGET_IDS.map(id => [id, false]));
  const tiles: [WidgetId, number, number, typeof WIDGET_SIZES[number]][] = [['clock', 0, 0, 'large'], ['weather', 0, 4, 'small'], ['rain', 2, 4, 'small'], ['note', 4, 4, 'small'], ['reminders', 6, 4, 'small']];
  for (const [id, column, row, size] of tiles) { grid.placements[id] = { column, row, size }; enabled[id] = true; }
  assert.equal(gridProblem(grid, enabled), null); assert.equal(fill(grid, enabled), 1);
  const ids = WIDGET_IDS.filter(id => enabled[id]); let previous = grid;
  for (let cycle = 1; cycle <= 8; cycle++) {
    const next = composeWidgetGrid(grid, enabled, cycle, previous);
    assert.equal(gridProblem(next, enabled), null);
    assert.equal(samePositions(next, previous, ids), false, `cycle ${cycle} relocates the full board`);
    previous = next;
  }
  for (const density of Object.keys(GRID_DENSITIES) as GridDensity[]) {
    const lone: WidgetGrid = { ...defaultSettings().widgetGrid, density };
    for (const id of WIDGET_IDS) lone.placements[id] = firstPlacement(lone, id, 'small', {})!;
    const limits = freeSpanLimits('reminders', density)!;
    const placed = resizeWidgetSpan(lone, 'reminders', limits.max, { reminders: true }); assert.ok(placed);
    const alone: Visibility = { reminders: true }; let last = placed;
    for (let cycle = 1; cycle <= 6; cycle++) {
      const next = composeWidgetGrid(placed, alone, cycle, last);
      assert.equal(gridProblem(next, alone), null);
      assert.notEqual(next.placements.reminders.column, last.placements.reminders.column, `${density}: the widest full-height span moves sideways`);
      assert.equal(next.placements.reminders.row, 0);
      last = next;
    }
  }
});