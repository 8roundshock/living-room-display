import type { WidgetGrid, WidgetPlacement, WidgetId } from './contracts.ts';
import type { PaletteRole } from './palette.ts';

export type WidgetSize = 'small' | 'medium' | 'large';
export type GridDensity = 'spacious' | 'balanced' | 'fine';
export interface WidgetSpan { columns: number; rows: number }
export type WidgetCategory = 'time' | 'weather' | 'personal' | 'pictures';
export const WIDGET_CATEGORIES: Record<WidgetCategory, string> = { time: 'Time', weather: 'Weather & sky', personal: 'Personal', pictures: 'Pictures' };
export type WidgetStatus = 'active' | 'planned' | 'retired';
export interface WidgetDefinition {
  name: string; description: string;
  icon: 'clock' | 'cloud' | 'rain' | 'calendar' | 'check' | 'monitor' | 'photo' | 'globe' | 'hourglass' | 'note' | 'air' | 'sunrise' | 'forecast';
  category: WidgetCategory;
  /** Palette role used by native accent colours (#75). */
  tone: PaletteRole;
  /**
   * Omitted means active. `planned` reserves an id whose renderer has not shipped; `retired` is kept
   * only so the previous release can read data. Both are hidden from the picker and inspector and
   * never rendered.
   */
  status?: WidgetStatus;
  /** Retired only: the active id that absorbs an enabled retired placement (migrated by the retiring change). */
  mergedInto?: string;
  sizes: Partial<Record<WidgetSize, WidgetSpan>>; defaultSize: WidgetSize;
  defaultEnabled: boolean; defaultPlacement: { column: number; row: number };
  /** Revision-one backfill must use the geometry that originally accepted it. */
  legacyPlacement?: { column: number; row: number };
  /** Legacy versions coupled this module's visibility to another widget. */
  legacyEnabledFrom?: string;
}
const standard = { small: { columns: 2, rows: 2 }, medium: { columns: 4, rows: 2 }, large: { columns: 4, rows: 4 } };

/** The authority for picker labels, supported families, validation and rendering. */
export const WIDGET_CATALOG = {
  clock: { name: 'Clock', description: 'Time and date', icon: 'clock', category: 'time', tone: 'time', sizes: { ...standard, large: { columns: 8, rows: 4 } }, defaultSize: 'large', defaultEnabled: true, defaultPlacement: { column: 0, row: 0 } },
  weather: { name: 'Weather', description: 'Current conditions', icon: 'cloud', category: 'weather', tone: 'sky', sizes: standard, defaultSize: 'medium', defaultEnabled: true, defaultPlacement: { column: 8, row: 0 } },
  rain: { name: 'Rain', description: 'Rain timing and probability', icon: 'rain', category: 'weather', tone: 'water', sizes: standard, defaultSize: 'medium', defaultEnabled: true, defaultPlacement: { column: 8, row: 2 }, legacyPlacement: { column: 0, row: 3 }, legacyEnabledFrom: 'weather' },
  forecast: { name: 'Forecast', description: 'The days ahead', icon: 'calendar', category: 'weather', tone: 'sky', sizes: { ...standard, large: { columns: 8, rows: 2 } }, defaultSize: 'large', defaultEnabled: true, defaultPlacement: { column: 0, row: 6 }, legacyPlacement: { column: 2, row: 6 } },
  reminders: { name: 'Reminders', description: 'What is coming up', icon: 'check', category: 'personal', tone: 'personal', sizes: standard, defaultSize: 'small', defaultEnabled: true, defaultPlacement: { column: 0, row: 4 }, legacyPlacement: { column: 5, row: 3 } },
  preview: { name: 'Last screen', description: 'A dim snapshot on activation', icon: 'monitor', category: 'pictures', tone: 'stone', sizes: standard, defaultSize: 'medium', defaultEnabled: true, defaultPlacement: { column: 8, row: 4 }, legacyPlacement: { column: 8, row: 3 } },
  photo: { name: 'Photo', description: 'One picture from this device', icon: 'photo', category: 'pictures', tone: 'stone', sizes: standard, defaultSize: 'small', defaultEnabled: false, defaultPlacement: { column: 2, row: 4 }, legacyPlacement: { column: 4, row: 3 } },
  // Planned (#78): reserved ids, always disabled and never rendered until their unit deletes `status`.
  worldClocks: { name: 'World clocks', description: 'Time in other cities', icon: 'globe', category: 'time', tone: 'time', sizes: standard, defaultSize: 'small', defaultEnabled: false, defaultPlacement: { column: 4, row: 4 } },
  calendar: { name: 'Calendar', description: 'This month at a glance', icon: 'calendar', category: 'time', tone: 'time', status: 'planned', sizes: standard, defaultSize: 'medium', defaultEnabled: false, defaultPlacement: { column: 8, row: 6 } },
  countdown: { name: 'Countdown', description: 'Days until dates you choose', icon: 'hourglass', category: 'personal', tone: 'personal', status: 'planned', sizes: standard, defaultSize: 'small', defaultEnabled: false, defaultPlacement: { column: 6, row: 4 } },
  note: { name: 'Note', description: 'A short message on screen', icon: 'note', category: 'personal', tone: 'personal', status: 'planned', sizes: standard, defaultSize: 'small', defaultEnabled: false, defaultPlacement: { column: 2, row: 4 } },
  airQuality: { name: 'Air quality', description: 'Air quality and UV index', icon: 'air', category: 'weather', tone: 'sky', sizes: standard, defaultSize: 'small', defaultEnabled: false, defaultPlacement: { column: 10, row: 6 } },
  sunMoon: { name: 'Sun & moon', description: 'Daylight and moon phase', icon: 'sunrise', category: 'weather', tone: 'sun', sizes: standard, defaultSize: 'small', defaultEnabled: false, defaultPlacement: { column: 8, row: 6 } },
} satisfies Record<string, WidgetDefinition>;
export type WidgetKind = keyof typeof WIDGET_CATALOG;
/** Every id, including planned and retired ones: schemas and geometry need them all. */
export const WIDGET_IDS = Object.keys(WIDGET_CATALOG) as WidgetId[];
function widgetStatus(id: WidgetId): WidgetStatus { return (WIDGET_CATALOG[id] as WidgetDefinition).status ?? 'active'; }
/** Reads the catalog live; use in validation and rendering. */
export function isActiveWidget(id: WidgetId): boolean { return widgetStatus(id) === 'active'; }
export function isPlannedWidget(id: WidgetId): boolean { return widgetStatus(id) === 'planned'; }
/** Load-time constant of shipped ids, for UI lists and test iteration. */
export const ACTIVE_WIDGET_IDS: WidgetId[] = WIDGET_IDS.filter(isActiveWidget);
export const WIDGET_SIZES: WidgetSize[] = ['small', 'medium', 'large'];
export const GRID_DENSITIES = {
  spacious: { name: 'Spacious · 8 × 6', columns: 8, rows: 6 },
  balanced: { name: 'Balanced · 12 × 8', columns: 12, rows: 8 },
  fine: { name: 'Fine · 16 × 10', columns: 16, rows: 10 },
} satisfies Record<GridDensity, WidgetSpan & { name: string }>;

export function defaultWidgetGrid(revision: 1 | 2 = 2): WidgetGrid {
  return { revision, density: 'balanced', placements: Object.fromEntries(WIDGET_IDS.map(id => {
    const definition: WidgetDefinition = WIDGET_CATALOG[id];
    return [id, { ...(revision === 1 ? definition.legacyPlacement ?? definition.defaultPlacement : definition.defaultPlacement), size: definition.defaultSize }];
  })) as Record<WidgetId, WidgetPlacement> };
}
export function defaultWidgetVisibility(): Record<WidgetId, boolean> { return Object.fromEntries(WIDGET_IDS.map(id => [id, WIDGET_CATALOG[id].defaultEnabled])) as Record<WidgetId, boolean>; }
export function widgetSizes(id: WidgetId): WidgetSize[] { return WIDGET_SIZES.filter(size => Boolean((WIDGET_CATALOG[id].sizes as Partial<Record<WidgetSize, WidgetSpan>>)[size])); }
export function widgetSpan(id: WidgetId, size: WidgetSize, revision: 1 | 2 = 2): WidgetSpan {
  if (revision === 1 && id === 'clock' && size === 'large') return { columns: 6, rows: 2 };
  const span = (WIDGET_CATALOG[id].sizes as Partial<Record<WidgetSize, WidgetSpan>>)[size];
  if (!span) throw new RangeError(`${WIDGET_CATALOG[id].name} does not support ${size}`);
  return span;
}
export function getWidgetRect(grid: WidgetGrid, id: WidgetId, placement = grid.placements[id]): { left: number; top: number; width: number; height: number } {
  const limits = GRID_DENSITIES[grid.density]; const span = widgetSpan(id, placement.size, grid.revision);
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
  const limits = GRID_DENSITIES[grid.density]; const span = widgetSpan(id, placement.size, grid.revision);
  if (!Number.isInteger(placement.column) || !Number.isInteger(placement.row) || placement.column < 0 || placement.row < 0 || placement.column + span.columns > limits.columns || placement.row + span.rows > limits.rows) return false;
  return WIDGET_IDS.every(other => other === id || !enabled[other] || !intersects(placement, span, grid.placements[other], widgetSpan(other, grid.placements[other].size, grid.revision)));
}
export function gridProblem(grid: WidgetGrid, enabled: Partial<Record<WidgetId, boolean>>): string | null {
  for (const id of WIDGET_IDS) {
    if (!widgetSizes(id).includes(grid.placements[id].size)) return `${WIDGET_CATALOG[id].name} does not support this size`;
    const placement = grid.placements[id]; const limits = GRID_DENSITIES[grid.density]; const span = widgetSpan(id, placement.size, grid.revision);
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
type Visibility = Partial<Record<WidgetId, boolean>>;
function area(id: WidgetId, grid: WidgetGrid): number {
  const span = widgetSpan(id, grid.placements[id].size); return span.columns * span.rows;
}
function nearbyPlacements(grid: WidgetGrid, id: WidgetId): WidgetPlacement[] {
  const { columns, rows } = GRID_DENSITIES[grid.density], origin = grid.placements[id], span = widgetSpan(id, origin.size);
  const values: WidgetPlacement[] = [];
  for (let row = 0; row + span.rows <= rows; row++) for (let column = 0; column + span.columns <= columns; column++) values.push({ ...origin, column, row });
  const distance = (p: WidgetPlacement) => (p.column - origin.column) ** 2 + (p.row - origin.row) ** 2;
  return values.sort((a, b) => distance(a) - distance(b) || a.row - b.row || a.column - b.column);
}
/** Bounded, deterministic packing shared by density fitting and direct manipulation. */
function packGrid(grid: WidgetGrid, enabled: Visibility, fixed: WidgetId[] = []): WidgetGrid | null {
  const limits = GRID_DENSITIES[grid.density];
  if (WIDGET_IDS.filter(id => enabled[id]).reduce((sum, id) => sum + area(id, grid), 0) > limits.columns * limits.rows) return null;
  const result = structuredClone(grid), placed: Visibility = Object.fromEntries(fixed.map(id => [id, true]));
  for (const id of fixed) if (!placementFits(result, id, result.placements[id], placed)) return null;
  const ids = WIDGET_IDS.filter(id => enabled[id] && !fixed.includes(id)).sort((a, b) => area(b, grid) - area(a, grid));
  const candidates = Object.fromEntries(ids.map(id => [id, nearbyPlacements(grid, id)])) as Record<WidgetId, WidgetPlacement[]>;
  let attempts = 0;
  function search(index: number): boolean {
    if (index === ids.length) return true;
    const id = ids[index]!;
    for (const candidate of candidates[id]) {
      if (++attempts > 30_000) return false;
      if (!placementFits(result, id, candidate, placed)) continue;
      result.placements[id] = candidate; placed[id] = true;
      if (search(index + 1)) return true;
      delete placed[id];
    }
    return false;
  }
  if (!search(0)) return null;
  // Hidden placements still have valid bounds, but never consume visible capacity.
  for (const id of WIDGET_IDS.filter(id => !enabled[id])) {
    const candidate = nearbyPlacements(result, id)[0]; if (!candidate) return null; result.placements[id] = candidate;
  }
  return result;
}
/** Pin the requested widget and move neighbors only when the requested space needs them. */
export function reflowWidget(grid: WidgetGrid, id: WidgetId, placement: WidgetPlacement, enabled: Visibility): WidgetGrid | null {
  if (!placementFits(grid, id, placement, {})) return null;
  const result = { ...grid, placements: { ...grid.placements, [id]: { ...placement } } };
  const unaffected = WIDGET_IDS.filter(other => enabled[other] && other !== id && !intersects(placement, widgetSpan(id, placement.size), grid.placements[other], widgetSpan(other, grid.placements[other].size)));
  return packGrid(result, { ...enabled, [id]: true }, [id, ...unaffected]) ?? packGrid(result, { ...enabled, [id]: true }, [id]);
}
/** Family changes keep their requested origin; additions can seek nearby legal space. */
export function fitWidgetFamily(grid: WidgetGrid, id: WidgetId, size: WidgetSize, enabled: Visibility): WidgetGrid | null {
  if (!widgetSizes(id).includes(size)) return null;
  const span = widgetSpan(id, size), limits = GRID_DENSITIES[grid.density], origin = grid.placements[id];
  if (span.columns > limits.columns || span.rows > limits.rows) return null;
  const preferred = { size, column: Math.min(origin.column, limits.columns - span.columns), row: Math.min(origin.row, limits.rows - span.rows) };
  const result = reflowWidget(grid, id, preferred, enabled);
  if (result || enabled[id]) return result;
  // A hidden widget's old origin can partition an otherwise usable board.
  // Search the same deterministic nearby candidates used by shared packing;
  // never change families, drop content or relax collision validation to add it.
  const requested = { ...grid, placements: { ...grid.placements, [id]: preferred } };
  for (const candidate of nearbyPlacements(requested, id)) {
    if (candidate.column === preferred.column && candidate.row === preferred.row) continue;
    const next = reflowWidget(grid, id, candidate, enabled);
    if (next) return next;
  }
  return null;
}
/** Preserve families and relative origins; never return a partially packed board. */
export function repackGrid(grid: WidgetGrid, density: GridDensity, enabled: Visibility): WidgetGrid | null {
  const result = structuredClone(grid); result.density = density;
  const from = GRID_DENSITIES[grid.density], to = GRID_DENSITIES[density];
  for (const id of WIDGET_IDS) {
    const original = grid.placements[id], span = widgetSpan(id, original.size);
    result.placements[id] = { ...original,
      column: Math.round(original.column / Math.max(1, from.columns - span.columns) * Math.max(0, to.columns - span.columns)),
      row: Math.round(original.row / Math.max(1, from.rows - span.rows) * Math.max(0, to.rows - span.rows)) };
  }
  return packGrid(result, enabled);
}
export interface DensityFit { grid: WidgetGrid; resized: { id: WidgetId; from: WidgetSize; to: WidgetSize }[] }
/** Fit all enabled widgets, preferring the fewest family steps and the least lost area. */
export function fitGridDensity(grid: WidgetGrid, density: GridDensity, enabled: Visibility): DensityFit | null {
  const direct = repackGrid(grid, density, enabled); if (direct) return { grid: direct, resized: [] };
  const ids = WIDGET_IDS.filter(id => enabled[id]), variants: { grid: WidgetGrid; cost: number; loss: number }[] = [];
  function choose(index: number, candidate: WidgetGrid, cost: number, loss: number) {
    if (index === ids.length) { if (cost) variants.push({ grid: candidate, cost, loss }); return; }
    const id = ids[index]!, sizes = widgetSizes(id), original = sizes.indexOf(grid.placements[id].size);
    for (let family = original; family >= 0; family--) {
      const next = structuredClone(candidate); next.placements[id].size = sizes[family]!;
      choose(index + 1, next, cost + (original - family) ** 2, loss + area(id, grid) - area(id, next));
    }
  }
  choose(0, grid, 0, 0);
  variants.sort((a, b) => a.cost - b.cost || a.loss - b.loss);
  for (const candidate of variants) {
    const packed = repackGrid(candidate.grid, density, enabled); if (!packed) continue;
    return { grid: packed, resized: ids.filter(id => packed.placements[id].size !== grid.placements[id].size).map(id => ({ id, from: grid.placements[id].size, to: packed.placements[id].size })) };
  }
  return null;
}
export interface GridDensityHistory { current: WidgetGrid; enabled: Visibility; layouts: Partial<Record<GridDensity, WidgetGrid>> }
function sameGrid(a: WidgetGrid, b: WidgetGrid): boolean {
  return a.revision === b.revision && a.density === b.density && WIDGET_IDS.every(id => { const x = a.placements[id], y = b.placements[id]; return x.column === y.column && x.row === y.row && x.size === y.size; });
}
/** Density exploration is reversible until a meaningful widget/visibility edit changes its source. */
export function switchGridDensity(grid: WidgetGrid, density: GridDensity, enabled: Visibility, history?: GridDensityHistory): (DensityFit & { history: GridDensityHistory }) | null {
  const prior = history && sameGrid(history.current, grid) && WIDGET_IDS.every(id => !!history.enabled[id] === !!enabled[id]) ? history.layouts : {};
  const known = prior[density], fit = known ? { grid: structuredClone(known), resized: [] } : fitGridDensity(grid, density, enabled);
  if (!fit) return null;
  return { ...fit, history: { current: structuredClone(fit.grid), enabled: { ...enabled }, layouts: { ...prior, [grid.density]: structuredClone(grid), [density]: structuredClone(fit.grid) } } };
}

/** Reflections plus a non-repeating low-discrepancy offset keep successive cycles varied. */
export function displayPlacement(grid: WidgetGrid, id: WidgetId, cycle: number): WidgetPlacement {
  const original = grid.placements[id]; const span = widgetSpan(id, original.size); const limits = GRID_DENSITIES[grid.density];
  return { ...original, column: cycle % 2 ? limits.columns - original.column - span.columns : original.column,
    row: Math.floor(cycle / 2) % 2 ? limits.rows - original.row - span.rows : original.row };
}
export function motionOffset(cycle: number): { x: number; y: number } {
  if (cycle === 0) return { x: 0, y: 0 };
  return { x: ((cycle * 0.61803398875) % 1 - 0.5) * 4, y: ((cycle * 0.41421356237) % 1 - 0.5) * 4 };
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

