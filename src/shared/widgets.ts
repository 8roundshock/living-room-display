import type { WidgetGrid, WidgetPlacement, WidgetId } from './contracts.ts';

export type WidgetSize = 'small' | 'medium' | 'large';
export type GridDensity = 'spacious' | 'balanced' | 'fine';
export interface WidgetSpan { columns: number; rows: number }
export interface WidgetDefinition {
  name: string; description: string; icon: 'clock' | 'cloud' | 'rain' | 'calendar' | 'check' | 'monitor' | 'photo';
  sizes: Partial<Record<WidgetSize, WidgetSpan>>; defaultSize: WidgetSize;
  defaultEnabled: boolean; defaultPlacement: { column: number; row: number };
  /** Legacy versions coupled this module's visibility to another widget. */
  legacyEnabledFrom?: string;
}
const standard = { small: { columns: 2, rows: 2 }, medium: { columns: 4, rows: 2 }, large: { columns: 4, rows: 4 } };

/** The authority for picker labels, supported families, validation and rendering. */
export const WIDGET_CATALOG = {
  clock: { name: 'Clock', description: 'Time and date', icon: 'clock', sizes: { ...standard, large: { columns: 6, rows: 2 } }, defaultSize: 'large', defaultEnabled: true, defaultPlacement: { column: 0, row: 0 } },
  weather: { name: 'Weather', description: 'Current conditions', icon: 'cloud', sizes: standard, defaultSize: 'medium', defaultEnabled: true, defaultPlacement: { column: 8, row: 0 } },
  rain: { name: 'Rain', description: 'Rain timing and probability', icon: 'rain', sizes: standard, defaultSize: 'medium', defaultEnabled: true, defaultPlacement: { column: 0, row: 3 }, legacyEnabledFrom: 'weather' },
  forecast: { name: 'Forecast', description: 'The days ahead', icon: 'calendar', sizes: { ...standard, large: { columns: 8, rows: 2 } }, defaultSize: 'large', defaultEnabled: true, defaultPlacement: { column: 2, row: 6 } },
  reminders: { name: 'Reminders', description: 'What is coming up', icon: 'check', sizes: standard, defaultSize: 'small', defaultEnabled: true, defaultPlacement: { column: 5, row: 3 } },
  preview: { name: 'Last screen', description: 'A dim snapshot on activation', icon: 'monitor', sizes: standard, defaultSize: 'medium', defaultEnabled: true, defaultPlacement: { column: 8, row: 3 } },
  photo: { name: 'Photo', description: 'One picture from this device', icon: 'photo', sizes: standard, defaultSize: 'small', defaultEnabled: false, defaultPlacement: { column: 4, row: 3 } },
} satisfies Record<string, WidgetDefinition>;
export type WidgetKind = keyof typeof WIDGET_CATALOG;
export const WIDGET_IDS = Object.keys(WIDGET_CATALOG) as WidgetId[];
export const WIDGET_SIZES: WidgetSize[] = ['small', 'medium', 'large'];
export const GRID_DENSITIES = {
  spacious: { name: 'Spacious · 8 × 6', columns: 8, rows: 6 },
  balanced: { name: 'Balanced · 12 × 8', columns: 12, rows: 8 },
  fine: { name: 'Fine · 16 × 10', columns: 16, rows: 10 },
} satisfies Record<GridDensity, WidgetSpan & { name: string }>;

export function defaultWidgetGrid(): WidgetGrid {
  return { density: 'balanced', placements: Object.fromEntries(WIDGET_IDS.map(id => [id, { ...WIDGET_CATALOG[id].defaultPlacement, size: WIDGET_CATALOG[id].defaultSize }])) as Record<WidgetId, WidgetPlacement> };
}
export function defaultWidgetVisibility(): Record<WidgetId, boolean> { return Object.fromEntries(WIDGET_IDS.map(id => [id, WIDGET_CATALOG[id].defaultEnabled])) as Record<WidgetId, boolean>; }
export function widgetSizes(id: WidgetId): WidgetSize[] { return WIDGET_SIZES.filter(size => Boolean((WIDGET_CATALOG[id].sizes as Partial<Record<WidgetSize, WidgetSpan>>)[size])); }
export function widgetSpan(id: WidgetId, size: WidgetSize): WidgetSpan {
  const span = (WIDGET_CATALOG[id].sizes as Partial<Record<WidgetSize, WidgetSpan>>)[size];
  if (!span) throw new RangeError(`${WIDGET_CATALOG[id].name} does not support ${size}`);
  return span;
}
export function getWidgetRect(grid: WidgetGrid, id: WidgetId, placement = grid.placements[id]): { left: number; top: number; width: number; height: number } {
  const limits = GRID_DENSITIES[grid.density]; const span = widgetSpan(id, placement.size);
  return { left: placement.column / limits.columns * 100, top: placement.row / limits.rows * 100, width: span.columns / limits.columns * 100, height: span.rows / limits.rows * 100 };
}
export function widgetContentLimits(size: WidgetSize): { forecastDays: number; reminders: number } {
  return size === 'small' ? { forecastDays: 3, reminders: 1 } : size === 'medium' ? { forecastDays: 5, reminders: 2 } : { forecastDays: 7, reminders: 4 };
}
export function intersects(a: WidgetPlacement, aSpan: WidgetSpan, b: WidgetPlacement, bSpan: WidgetSpan): boolean {
  return a.column < b.column + bSpan.columns && b.column < a.column + aSpan.columns && a.row < b.row + bSpan.rows && b.row < a.row + aSpan.rows;
}
export function placementFits(grid: WidgetGrid, id: WidgetId, placement: WidgetPlacement, enabled: Partial<Record<WidgetId, boolean>>): boolean {
  if (!widgetSizes(id).includes(placement.size)) return false;
  const limits = GRID_DENSITIES[grid.density]; const span = widgetSpan(id, placement.size);
  if (!Number.isInteger(placement.column) || !Number.isInteger(placement.row) || placement.column < 0 || placement.row < 0 || placement.column + span.columns > limits.columns || placement.row + span.rows > limits.rows) return false;
  return WIDGET_IDS.every(other => other === id || !enabled[other] || !intersects(placement, span, grid.placements[other], widgetSpan(other, grid.placements[other].size)));
}
export function gridProblem(grid: WidgetGrid, enabled: Partial<Record<WidgetId, boolean>>): string | null {
  for (const id of WIDGET_IDS) {
    if (!widgetSizes(id).includes(grid.placements[id].size)) return `${WIDGET_CATALOG[id].name} does not support this size`;
    const placement = grid.placements[id]; const limits = GRID_DENSITIES[grid.density]; const span = widgetSpan(id, placement.size);
    if (placement.column < 0 || placement.row < 0 || placement.column + span.columns > limits.columns || placement.row + span.rows > limits.rows) return `${WIDGET_CATALOG[id].name} is outside the grid`;
    if (enabled[id] && !placementFits(grid, id, placement, enabled)) return `${WIDGET_CATALOG[id].name} overlaps another widget`;
  }
  return null;
}
/** Invalid drops stay at their previous cells; no other widget is silently displaced. */
export function placeWidget(grid: WidgetGrid, id: WidgetId, placement: WidgetPlacement, enabled: Partial<Record<WidgetId, boolean>>): WidgetGrid | null {
  if (!placementFits(grid, id, placement, enabled)) return null;
  return { ...grid, placements: { ...grid.placements, [id]: { ...placement } } };
}
export function firstPlacement(grid: WidgetGrid, id: WidgetId, size: WidgetSize, enabled: Partial<Record<WidgetId, boolean>>): WidgetPlacement | null {
  if (!widgetSizes(id).includes(size)) return null;
  const limits = GRID_DENSITIES[grid.density];
  for (let row = 0; row < limits.rows; row++) for (let column = 0; column < limits.columns; column++) {
    const placement = { column, row, size }; if (placementFits(grid, id, placement, enabled)) return placement;
  }
  return null;
}
/** Changing density preserves every family and enabled widget or rejects the change. */
export function repackGrid(grid: WidgetGrid, density: GridDensity, enabled: Partial<Record<WidgetId, boolean>>): WidgetGrid | null {
  const result = structuredClone(grid); result.density = density;
  const placed: Partial<Record<WidgetId, boolean>> = {};
  const ordered = [...WIDGET_IDS].sort((a, b) => Number(Boolean(enabled[b])) - Number(Boolean(enabled[a])) || widgetSpan(b, grid.placements[b].size).columns * widgetSpan(b, grid.placements[b].size).rows - widgetSpan(a, grid.placements[a].size).columns * widgetSpan(a, grid.placements[a].size).rows);
  for (const id of ordered) {
    const original = grid.placements[id];
    const occupancy = enabled[id] ? placed : {};
    const candidate = placementFits(result, id, original, occupancy) ? original : firstPlacement(result, id, original.size, occupancy);
    if (!candidate) return null;
    result.placements[id] = { ...candidate }; if (enabled[id]) placed[id] = true;
  }
  return result;
}

/** Reflections plus a non-repeating low-discrepancy offset keep successive cycles varied. */
export function displayPlacement(grid: WidgetGrid, id: WidgetId, cycle: number): WidgetPlacement {
  const original = grid.placements[id]; const span = widgetSpan(id, original.size); const limits = GRID_DENSITIES[grid.density];
  return { ...original, column: cycle % 2 ? limits.columns - original.column - span.columns : original.column,
    row: Math.floor(cycle / 2) % 2 ? limits.rows - original.row - span.rows : original.row };
}
export function motionOffset(cycle: number): { x: number; y: number } {
  if (cycle === 0) return { x: 0, y: 0 };
  return { x: ((cycle * 0.61803398875) % 1 - 0.5) * 16, y: ((cycle * 0.41421356237) % 1 - 0.5) * 16 };
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) { result ^= value.charCodeAt(index); result = Math.imul(result, 16777619); }
  return result >>> 0;
}
/** Keep the edited layout at rest, then choose distant legal cells during a black interval. */
export function composeWidgetGrid(grid: WidgetGrid, enabled: Partial<Record<WidgetId, boolean>>, cycle: number, previous = grid): WidgetGrid {
  if (cycle === 0) return structuredClone(grid);
  const limits = GRID_DENSITIES[grid.density];
  const ids = WIDGET_IDS.filter(id => enabled[id]).sort((a, b) => {
    const as = widgetSpan(a, grid.placements[a].size); const bs = widgetSpan(b, grid.placements[b].size);
    return bs.columns * bs.rows - as.columns * as.rows || hash(`${cycle}:${a}`) - hash(`${cycle}:${b}`);
  });
  const candidates = Object.fromEntries(ids.map(id => {
    const size = grid.placements[id].size; const span = widgetSpan(id, size); const origin = previous.placements[id];
    const values: WidgetPlacement[] = [];
    for (let row = 0; row + span.rows <= limits.rows; row++) for (let column = 0; column + span.columns <= limits.columns; column++) values.push({ column, row, size });
    // Alternate the farthest half of legal origins so motion is substantial without a four-position loop.
    const distance = (point: WidgetPlacement) => Math.hypot((point.column - origin.column) / limits.columns, (point.row - origin.row) / limits.rows);
    values.sort((a, b) => {
      const ad = distance(a); const bd = distance(b);
      const aFar = ad >= 0.28; const bFar = bd >= 0.28;
      return Number(bFar) - Number(aFar) || hash(`${cycle}:${id}:${a.column}:${a.row}`) - hash(`${cycle}:${id}:${b.column}:${b.row}`);
    });
    return [id, values];
  })) as Record<WidgetId, WidgetPlacement[]>;
  for (const requireMovement of [true, false]) {
    const result = structuredClone(grid); const placed: Partial<Record<WidgetId, boolean>> = {}; let attempts = 0;
    function search(index: number): boolean {
      if (index === ids.length) return true;
      const id = ids[index]!;
      for (const candidate of candidates[id]) {
        if (++attempts > 20_000) return false;
        const prior = previous.placements[id];
        if (requireMovement && candidate.column === prior.column && candidate.row === prior.row && candidates[id].length > 1) continue;
        if (!placementFits(result, id, candidate, placed)) continue;
        result.placements[id] = candidate; placed[id] = true;
        if (search(index + 1)) return true;
        delete placed[id];
      }
      return false;
    }
    if (search(0)) return result;
  }
  // An authored valid board is always a safe fallback when bounded search is exhausted.
  return structuredClone(grid);
}

