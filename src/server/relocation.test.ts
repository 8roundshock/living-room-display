// Dense-board relocation (#93): when the bounded search cannot move every widget, a whole-board
// reflection keeps the composition moving. Geometry is status-agnostic, so every #78 widget (shipped, like
// Calendar, Countdown and Note, or still planned) is enabled here to model the fuller boards they make common.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { WidgetGrid, WidgetId } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import {
  GRID_DENSITIES, WIDGET_IDS, WIDGET_SIZES, composeWidgetGrid, displayPlacement, firstPlacement, freeSpanLimits, gridProblem,
  placementSpan, reflectedComposition, reflowWidget, resizeWidgetSpan, widgetSizes, type GridDensity,
} from '../shared/widgets.ts';

/**
 * The six ids #78 appended after the foundation ones, whatever their current status. Written out, not
 * derived from PREVIOUS_RELEASE: every baseline since 3fee844 (#263; 3446400 since #367) knows them
 * all, and a derived list would have gone silently empty.
 */
const CATALOG_78: WidgetId[] = ['worldClocks', 'calendar', 'countdown', 'note', 'airQuality', 'sunMoon'];

test('the explicit #78 list names catalog ids', () => {
  assert.deepEqual(CATALOG_78.filter(id => !WIDGET_IDS.includes(id)), []);
});

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

const positions = (board: WidgetGrid, ids: WidgetId[]) => ids.map(id => `${board.placements[id].column},${board.placements[id].row}`).join('|');
/** The arrangements a board's whole-board reflections reach, itself included: 1, 2 or 4. */
function reflectedArrangements(board: WidgetGrid, ids: WidgetId[]): Set<string> {
  return new Set([0, 1, 2, 3].map(variant => ids.map(id => { const point = displayPlacement(board, id, variant); return `${point.column},${point.row}`; }).join('|')));
}
/** Compositions equal to the one two cycles earlier: how many, and the longest run of consecutive ones. */
function twoCycleRepeats(keys: string[]): { total: number; longest: number } {
  let total = 0, run = 0, longest = 0;
  for (let cycle = 2; cycle < keys.length; cycle++) { if (keys[cycle] === keys[cycle - 2]) { total++; longest = Math.max(longest, ++run); } else run = 0; }
  return { total, longest };
}
interface DenseRun { grid: WidgetGrid; enabled: Visibility; ids: WidgetId[]; boards: WidgetGrid[]; keys: string[] }
/** A board's compositions over `cycles` cycles, the authored board first, each checked collision-free and in bounds. */
function compositionRun(grid: WidgetGrid, enabled: Visibility, cycles: number): DenseRun {
  const ids = WIDGET_IDS.filter(id => enabled[id]); const boards = [grid]; let previous = grid;
  for (let cycle = 1; cycle <= cycles; cycle++) {
    const next = composeWidgetGrid(grid, enabled, cycle, previous);
    assert.equal(gridProblem(next, enabled), null, `cycle ${cycle} is collision-free and in bounds`);
    boards.push(next); previous = next;
  }
  return { grid, enabled, ids, boards, keys: boards.map(board => positions(board, ids)) };
}
/** 24-cycle runs of the 12 generated dense boards per density, computed once for the #182 tests. */
const denseRuns = new Map<GridDensity, DenseRun[]>();
function denseRunsFor(density: GridDensity): DenseRun[] {
  if (!denseRuns.has(density)) {
    const boards = denseBoards(density, 12);
    assert.ok(boards.length >= 10, `${density}: generated ${boards.length} boards at 90–100% fill`);
    denseRuns.set(density, boards.map(({ grid, enabled }) => compositionRun(grid, enabled, 24)));
  }
  return denseRuns.get(density)!;
}

test('dense boards vary their reflections instead of alternating between two arrangements (#182)', () => {
  // Measured on 2026-10-19 with these 36 boards × 24 cycles (828 compositions from cycle 2 on): before #182
  // the fallback always chose the reflection moving the most widgets (ties: most travel), and 470 repeated the
  // composition from two cycles earlier (31 boards; 3 boards showed only two arrangements). At 1e3566d, which
  // alternated a unique best reflection only with one moving exactly one widget fewer, 33 did (9 boards). Now
  // 10 do (5 boards), none of them from two consecutive fallbacks (next test), and every board reaches more
  // than two arrangements.
  let total = 0, repeats = 0;
  for (const density of Object.keys(GRID_DENSITIES) as GridDensity[]) {
    for (const [index, { ids, boards, keys }] of denseRunsFor(density).entries()) {
      total += keys.length - 2; repeats += twoCycleRepeats(keys).total;
      // A third legal arrangement exists when the whole-board reflections of a composition differ.
      if (reflectedArrangements(boards.at(-1)!, ids).size > 2) assert.ok(new Set(keys.slice(1)).size > 2, `${density} board ${index}: more than two arrangements in 24 cycles`);
    }
  }
  assert.equal(total, 828);
  assert.ok(repeats <= total * 0.03, `two-cycle repeats ${repeats} of ${total}`);
});

test('consecutive reflection fallbacks differ whenever another reflection moves widgets, over 200 cycles (#182)', () => {
  // Counted on 2026-10-19 with an instrumented copy over 200 composeWidgetGrid cycles on these 36 boards:
  // before #182 all 3,902 consecutive fallback pairs applied the same reflection; at 1e3566d 267 of 3,861 still
  // did, and Fine board 4 alternated between two arrangements for cycles 100–192 (next test); now 0 of 3,868.
  // Here the fallback runs on its own, as on a board where the search never succeeds: for 200 cycles from each
  // authored board, and for two cycles from every composition of its 24-cycle run (other centred widgets, both
  // parities). The same reflection twice in a row would return to the arrangement from two cycles earlier.
  let chains = 0, checked = 0;
  for (const density of Object.keys(GRID_DENSITIES) as GridDensity[]) {
    for (const [index, { grid, enabled, ids, boards }] of denseRunsFor(density).entries()) {
      const chain = (start: WidgetGrid, first: number, cycles: number, label: string) => {
        const reachable = reflectedArrangements(start, ids); const seen = new Set([positions(start, ids)]);
        let previous = start, twoBack: WidgetGrid | null = null; chains++;
        for (let cycle = first; cycle < first + cycles; cycle++) {
          const next = reflectedComposition(grid, ids, previous, cycle);
          if (reachable.size === 1) { assert.equal(next, null, `${label}: a board every reflection maps onto itself has no fallback`); return seen; }
          assert.ok(next, `${label} cycle ${cycle}: a reflection moves widgets`);
          assert.equal(gridProblem(next, enabled), null, `${label} cycle ${cycle} is collision-free and in bounds`);
          for (const id of ids) assert.deepEqual(placementSpan(id, next.placements[id]), placementSpan(id, grid.placements[id]), 'whole groups keep their size');
          const key = positions(next, ids);
          assert.ok(reachable.has(key) && key !== positions(previous, ids), `${label} cycle ${cycle}: a whole-board reflection that moves widgets`);
          if (twoBack && reachable.size === 4) { checked++; assert.notEqual(key, positions(twoBack, ids), `${label} cycle ${cycle}: the same reflection twice in a row`); }
          seen.add(key); twoBack = previous; previous = next;
        }
        return seen;
      };
      const seen = chain(grid, 1, 200, `${density} board ${index}`);
      if (reflectedArrangements(grid, ids).size === 4) assert.ok(seen.size > 2, `${density} board ${index}: the fallback alone reaches more than two arrangements`);
      for (const [cycle, board] of boards.entries()) if (cycle) chain(board, cycle + 1, 2, `${density} board ${index} from cycle ${cycle}`);
    }
  }
  assert.ok(chains >= 30 * 25 && checked > 6_000, `${chains} fallback chains, ${checked} consecutive pairs with a third arrangement`);
});

test('the Fine board that settled into a two-arrangement loop keeps varying over 200 cycles (#182)', () => {
  // At 1e3566d this board (13 widgets) repeated the composition from two cycles earlier on cycles 14–20 and on
  // every cycle from 102 to 192: one reflection moved all 13 widgets and no other moved 12 (they moved 11 and 10).
  const { grid, enabled } = denseBoards('fine', 12)[4]!;
  const { keys } = compositionRun(grid, enabled, 200); const repeats = twoCycleRepeats(keys);
  assert.ok(repeats.longest <= 2, `longest run of two-cycle repeats ${repeats.longest}`);
  const late = new Set(keys.slice(101)).size;
  assert.ok(late >= 4, `${late} arrangements in cycles 101–200`);
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