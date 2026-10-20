import type { VisualSettings, WidgetGrid, WidgetPlacement, WidgetId } from './contracts.ts';
import type { PaletteRole } from './palette.ts';

export type WidgetSize = 'small' | 'medium' | 'large';
export type GridDensity = 'spacious' | 'balanced' | 'fine';
export interface WidgetSpan { columns: number; rows: number }
export type WidgetCategory = 'time' | 'weather' | 'personal' | 'pictures';
export const WIDGET_CATEGORIES: Record<WidgetCategory, string> = { time: 'Time', weather: 'Weather & sky', personal: 'Personal', pictures: 'Pictures' };
export type WidgetStatus = 'active' | 'planned' | 'retired';
export interface WidgetDefinition {
  name: string; description: string;
  icon: 'clock' | 'cloud' | 'rain' | 'calendar' | 'check' | 'monitor' | 'photo' | 'globe' | 'hourglass' | 'note' | 'air' | 'sunrise' | 'forecast' | 'sparkles';
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
  /**
   * Free-size widgets (#73) also accept any whole-cell span from `min` up to the full grid height and
   * `maxColumnsFraction` of its width, so a full-height widget always leaves room to relocate.
   */
  freeSize?: { min: WidgetSpan; maxColumnsFraction: number };
}
const standard = { small: { columns: 2, rows: 2 }, medium: { columns: 4, rows: 2 }, large: { columns: 4, rows: 4 } };

/** The authority for picker labels, supported families, validation and rendering. */
export const WIDGET_CATALOG = {
  clock: { name: 'Clock', description: 'Time and date', icon: 'clock', category: 'time', tone: 'time', sizes: { ...standard, large: { columns: 8, rows: 4 } }, defaultSize: 'large', defaultEnabled: true, defaultPlacement: { column: 0, row: 0 } },
  weather: { name: 'Weather', description: 'Conditions now, with rain timing when rain is near', icon: 'cloud', category: 'weather', tone: 'sky', sizes: standard, defaultSize: 'large', defaultEnabled: true, defaultPlacement: { column: 8, row: 0 } },
  rain: { name: 'Rain', description: 'Now part of Weather', icon: 'rain', category: 'weather', tone: 'water', status: 'retired', mergedInto: 'weather', sizes: standard, defaultSize: 'medium', defaultEnabled: false, defaultPlacement: { column: 8, row: 2 }, legacyPlacement: { column: 0, row: 3 }, legacyEnabledFrom: 'weather' },
  forecast: { name: 'Forecast', description: 'The days ahead', icon: 'forecast', category: 'weather', tone: 'sky', sizes: { ...standard, large: { columns: 8, rows: 2 } }, defaultSize: 'large', defaultEnabled: true, defaultPlacement: { column: 0, row: 6 }, legacyPlacement: { column: 2, row: 6 } },
  reminders: { name: 'Reminders', description: 'What is coming up', icon: 'check', category: 'personal', tone: 'personal', sizes: standard, defaultSize: 'small', defaultEnabled: true, defaultPlacement: { column: 0, row: 4 }, legacyPlacement: { column: 5, row: 3 }, freeSize: { min: { columns: 2, rows: 2 }, maxColumnsFraction: 2 / 3 } },
  preview: { name: 'Last screen', description: 'A dim snapshot on activation', icon: 'monitor', category: 'pictures', tone: 'stone', sizes: standard, defaultSize: 'medium', defaultEnabled: true, defaultPlacement: { column: 8, row: 4 }, legacyPlacement: { column: 8, row: 3 } },
  photo: { name: 'Photo', description: 'One picture from this device', icon: 'photo', category: 'pictures', tone: 'stone', sizes: standard, defaultSize: 'small', defaultEnabled: false, defaultPlacement: { column: 2, row: 4 }, legacyPlacement: { column: 4, row: 3 } },
  // #78 additions (docs/widgets.md "Catalog decisions (#78)"): optional and off by default.
  worldClocks: { name: 'World clocks', description: 'Time in other cities', icon: 'globe', category: 'time', tone: 'time', sizes: standard, defaultSize: 'small', defaultEnabled: false, defaultPlacement: { column: 4, row: 4 } },
  calendar: { name: 'Calendar', description: 'This month at a glance', icon: 'calendar', category: 'time', tone: 'time', sizes: standard, defaultSize: 'medium', defaultEnabled: false, defaultPlacement: { column: 8, row: 6 } },
  countdown: { name: 'Countdown', description: 'Days until dates you choose', icon: 'hourglass', category: 'personal', tone: 'personal', sizes: standard, defaultSize: 'small', defaultEnabled: false, defaultPlacement: { column: 6, row: 4 } },
  note: { name: 'Note', description: 'A short message on screen', icon: 'note', category: 'personal', tone: 'personal', sizes: standard, defaultSize: 'small', defaultEnabled: false, defaultPlacement: { column: 2, row: 4 } },
  airQuality: { name: 'Air quality', description: 'Air quality and UV index', icon: 'air', category: 'weather', tone: 'sky', sizes: standard, defaultSize: 'small', defaultEnabled: false, defaultPlacement: { column: 10, row: 6 } },
  sunMoon: { name: 'Sun & moon', description: 'Daylight and moon phase', icon: 'sunrise', category: 'weather', tone: 'sun', sizes: standard, defaultSize: 'small', defaultEnabled: false, defaultPlacement: { column: 8, row: 6 } },
  // #437 (docs/widgets.md "Dynamic (#437)"): optional and off by default.
  dynamic: { name: 'Dynamic', description: 'What matters now, or a calm rotation', icon: 'sparkles', category: 'weather', tone: 'sky', sizes: standard, defaultSize: 'medium', defaultEnabled: false, defaultPlacement: { column: 2, row: 4 } },
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
function retiredTarget(id: WidgetId): WidgetId | null {
  const definition: WidgetDefinition = WIDGET_CATALOG[id];
  return definition.status === 'retired' && definition.mergedInto && Object.hasOwn(WIDGET_CATALOG, definition.mergedInto) ? definition.mergedInto as WidgetId : null;
}
/** The target family whose span is exactly the edge-sharing union of two rectangles, if any. */
function unionPlacement(grid: WidgetGrid, target: WidgetId, a: WidgetPlacement, aSpan: WidgetSpan, b: WidgetPlacement, bSpan: WidgetSpan): WidgetPlacement | null {
  const stacked = a.column === b.column && aSpan.columns === bSpan.columns && (a.row + aSpan.rows === b.row || b.row + bSpan.rows === a.row);
  const beside = a.row === b.row && aSpan.rows === bSpan.rows && (a.column + aSpan.columns === b.column || b.column + bSpan.columns === a.column);
  if (!stacked && !beside) return null;
  const span = stacked ? { columns: aSpan.columns, rows: aSpan.rows + bSpan.rows } : { columns: aSpan.columns + bSpan.columns, rows: aSpan.rows };
  const size = widgetSizes(target).find(family => { const candidate = widgetSpan(target, family, grid.revision); return candidate.columns === span.columns && candidate.rows === span.rows; });
  return size ? { column: Math.min(a.column, b.column), row: Math.min(a.row, b.row), size } : null;
}
/**
 * Merges every enabled retired widget into its `mergedInto` target (#74), keeping placement intent:
 * a hidden target takes the retired cells and family; when both are visible and their edge-sharing
 * union is a supported target family, the target takes the union; otherwise it takes the larger
 * rectangle, keeping its own on a tie. The retired id is then hidden and its hidden placement kept.
 * Pure and idempotent; never returns an invalid board (it falls back to the target's own rectangle).
 */
export function absorbRetiredWidgets<T extends Pick<VisualSettings, 'widgets' | 'widgetGrid'>>(value: T): T {
  let result = value;
  for (const id of WIDGET_IDS) {
    const target = retiredTarget(id);
    if (!target || !result.widgets[id]) continue;
    const grid = result.widgetGrid, retired = grid.placements[id], own = grid.placements[target];
    const retiredSpan = widgetSpan(id, retired.size, grid.revision), ownSpan = widgetSpan(target, own.size, grid.revision);
    const supportsRetired = widgetSizes(target).includes(retired.size);
    let placement = own;
    if (!result.widgets[target]) { if (supportsRetired) placement = retired; }
    else placement = unionPlacement(grid, target, own, ownSpan, retired, retiredSpan)
      ?? (supportsRetired && retiredSpan.columns * retiredSpan.rows > ownSpan.columns * ownSpan.rows ? retired : own);
    const widgets = { ...result.widgets, [target]: true, [id]: false };
    const candidates = [placement, own].map(choice => ({ ...grid, placements: { ...grid.placements, [target]: { ...choice } } }));
    const widgetGrid = candidates.find(candidate => !gridProblem(candidate, widgets));
    if (!widgetGrid) continue;
    result = { ...result, widgets, widgetGrid };
  }
  return result;
}
/**
 * gridProblem for input that absorbRetiredWidgets will merge: an enabled retired widget may overlap
 * its own visible target (for example a pre-grid board, or a stale editor still sending Rain), but
 * nothing else. Every other bound and overlap rule stays strict.
 */
export function absorbableGridProblem(grid: WidgetGrid, enabled: Partial<Record<WidgetId, boolean>>): string | null {
  const problem = gridProblem(grid, enabled);
  if (!problem) return null;
  const merging = WIDGET_IDS.filter(id => { const target = retiredTarget(id); return enabled[id] && target && enabled[target]; });
  if (!merging.length) return problem;
  const rest = { ...enabled }; for (const id of merging) rest[id] = false;
  if (gridProblem(grid, rest)) return problem;
  return merging.every(id => placementFits(grid, id, grid.placements[id], { ...rest, [retiredTarget(id)!]: false })) ? null : problem;
}
export function widgetSizes(id: WidgetId): WidgetSize[] { return WIDGET_SIZES.filter(size => Boolean((WIDGET_CATALOG[id].sizes as Partial<Record<WidgetSize, WidgetSpan>>)[size])); }
export function widgetSpan(id: WidgetId, size: WidgetSize, revision: 1 | 2 = 2): WidgetSpan {
  if (revision === 1 && id === 'clock' && size === 'large') return { columns: 6, rows: 2 };
  const span = (WIDGET_CATALOG[id].sizes as Partial<Record<WidgetSize, WidgetSpan>>)[size];
  if (!span) throw new RangeError(`${WIDGET_CATALOG[id].name} does not support ${size}`);
  return span;
}
function freeSizeRule(id: WidgetId): WidgetDefinition['freeSize'] { return (WIDGET_CATALOG[id] as WidgetDefinition).freeSize; }
/** Free-size widgets accept a custom whole-cell `span` in addition to their families (#73). */
export function isFreeSize(id: WidgetId): boolean { return !!freeSizeRule(id); }
/** The smallest and largest custom span in a density, or null when the widget has no free size. */
export function freeSpanLimits(id: WidgetId, density: GridDensity): { min: WidgetSpan; max: WidgetSpan } | null {
  const rule = freeSizeRule(id); if (!rule) return null;
  const grid = GRID_DENSITIES[density];
  // The epsilon keeps an exact product such as 12 × 2/3 from flooring to 7.
  return { min: { ...rule.min }, max: { columns: Math.max(rule.min.columns, Math.floor(grid.columns * rule.maxColumnsFraction + 1e-9)), rows: grid.rows } };
}
/** The largest supported family whose span fits inside `span` (the smallest family when none does). */
export function familyForSpan(id: WidgetId, span: WidgetSpan): WidgetSize {
  const sizes = widgetSizes(id);
  return [...sizes].reverse().find(size => { const family = widgetSpan(id, size); return family.columns <= span.columns && family.rows <= span.rows; }) ?? sizes[0]!;
}
/** The cells a placement occupies: its custom span, or its family's span. */
export function placementSpan(id: WidgetId, placement: WidgetPlacement, revision: 1 | 2 = 2): WidgetSpan {
  return placement.span ?? widgetSpan(id, placement.size, revision);
}
function sameSpan(a: WidgetSpan | undefined, b: WidgetSpan | undefined): boolean {
  return a === b || (!!a && !!b && a.columns === b.columns && a.rows === b.rows);
}
/**
 * Canonical free-size placement: `size` is the largest family inside the span, and a span equal to
 * that family's span is dropped. Other widgets are returned unchanged, so validation still rejects a
 * span they do not support.
 */
export function normalizePlacement(id: WidgetId, placement: WidgetPlacement): WidgetPlacement {
  const { span, ...rest } = placement;
  if (!span || !isFreeSize(id)) return { ...placement };
  const size = familyForSpan(id, span);
  return sameSpan(span, widgetSpan(id, size)) ? { ...rest, size } : { ...rest, size, span: { columns: span.columns, rows: span.rows } };
}
/** Free-size counterpart of fitWidgetFamily: keep the requested origin where it fits and reflow neighbours. */
export function resizeWidgetSpan(grid: WidgetGrid, id: WidgetId, span: WidgetSpan, enabled: Partial<Record<WidgetId, boolean>>): WidgetGrid | null {
  const limits = freeSpanLimits(id, grid.density); if (!limits || grid.revision === 1) return null;
  if (!Number.isInteger(span.columns) || !Number.isInteger(span.rows) || span.columns < limits.min.columns || span.rows < limits.min.rows || span.columns > limits.max.columns || span.rows > limits.max.rows) return null;
  const dimensions = GRID_DENSITIES[grid.density], origin = grid.placements[id];
  const preferred = normalizePlacement(id, { column: Math.min(origin.column, dimensions.columns - span.columns), row: Math.min(origin.row, dimensions.rows - span.rows), size: familyForSpan(id, span), span });
  const result = reflowWidget(grid, id, preferred, enabled);
  if (result || enabled[id]) return result;
  // Like fitWidgetFamily, a hidden widget's old origin may partition the board; try nearby origins.
  const requested = { ...grid, placements: { ...grid.placements, [id]: preferred } };
  for (const candidate of nearbyPlacements(requested, id)) {
    const next = reflowWidget(grid, id, candidate, enabled);
    if (next) return next;
  }
  return null;
}
/** Inspector label: a family name, Column (2 × full height) or `C × R`. */
export function placementLabel(id: WidgetId, placement: WidgetPlacement, density: GridDensity): string {
  if (!placement.span || !isFreeSize(id)) return placement.size[0]!.toUpperCase() + placement.size.slice(1);
  const { columns, rows } = placement.span;
  return columns === 2 && rows === GRID_DENSITIES[density].rows ? 'Column' : `${columns} × ${rows}`;
}
/** Why a custom span is not allowed, or null when the placement has none or it is valid. */
function spanProblem(grid: WidgetGrid, id: WidgetId, placement: WidgetPlacement): string | null {
  const span = placement.span; if (!span) return null;
  const name = WIDGET_CATALOG[id].name, limits = freeSpanLimits(id, grid.density);
  if (!limits || grid.revision === 1) return `${name} does not support custom sizes`;
  if (!Number.isInteger(span.columns) || !Number.isInteger(span.rows) || span.columns < limits.min.columns || span.rows < limits.min.rows) return `${name} is smaller than its minimum size`;
  if (span.columns > limits.max.columns) return `${name} is wider than two-thirds of the grid`;
  // Rollback containment: deleting the span must leave a family inside the same cells.
  if (placement.size !== familyForSpan(id, span)) return `${name} does not support this size`;
  return null;
}
export function getWidgetRect(grid: WidgetGrid, id: WidgetId, placement = grid.placements[id]): { left: number; top: number; width: number; height: number } {
  const limits = GRID_DENSITIES[grid.density]; const span = placementSpan(id, placement, grid.revision);
  return { left: placement.column / limits.columns * 100, top: placement.row / limits.rows * 100, width: span.columns / limits.columns * 100, height: span.rows / limits.rows * 100 };
}
/** Reminders measure how many rows fit their actual box, so only the forecast has a per-family count. */
export function widgetContentLimits(size: WidgetSize): { forecastDays: number } {
  return { forecastDays: size === 'small' ? 3 : size === 'medium' ? 5 : 7 };
}
export function intersects(a: WidgetPlacement, aSpan: WidgetSpan, b: WidgetPlacement, bSpan: WidgetSpan): boolean {
  return a.column < b.column + bSpan.columns && b.column < a.column + aSpan.columns && a.row < b.row + bSpan.rows && b.row < a.row + aSpan.rows;
}
export function placementFits(grid: WidgetGrid, id: WidgetId, placement: WidgetPlacement, enabled: Partial<Record<WidgetId, boolean>>): boolean {
  if (!widgetSizes(id).includes(placement.size) || spanProblem(grid, id, placement)) return false;
  const limits = GRID_DENSITIES[grid.density]; const span = placementSpan(id, placement, grid.revision);
  if (!Number.isInteger(placement.column) || !Number.isInteger(placement.row) || placement.column < 0 || placement.row < 0 || placement.column + span.columns > limits.columns || placement.row + span.rows > limits.rows) return false;
  return WIDGET_IDS.every(other => other === id || !enabled[other] || !intersects(placement, span, grid.placements[other], placementSpan(other, grid.placements[other], grid.revision)));
}
export function gridProblem(grid: WidgetGrid, enabled: Partial<Record<WidgetId, boolean>>): string | null {
  for (const id of WIDGET_IDS) {
    if (!widgetSizes(id).includes(grid.placements[id].size)) return `${WIDGET_CATALOG[id].name} does not support this size`;
    const placement = grid.placements[id]; const spanIssue = spanProblem(grid, id, placement); if (spanIssue) return spanIssue;
    const limits = GRID_DENSITIES[grid.density]; const span = placementSpan(id, placement, grid.revision);
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
  const span = placementSpan(id, grid.placements[id]); return span.columns * span.rows;
}
function nearbyPlacements(grid: WidgetGrid, id: WidgetId): WidgetPlacement[] {
  const { columns, rows } = GRID_DENSITIES[grid.density], origin = grid.placements[id], span = placementSpan(id, origin);
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
  const unaffected = WIDGET_IDS.filter(other => enabled[other] && other !== id && !intersects(placement, placementSpan(id, placement), grid.placements[other], placementSpan(other, grid.placements[other])));
  return packGrid(result, { ...enabled, [id]: true }, [id, ...unaffected]) ?? packGrid(result, { ...enabled, [id]: true }, [id]);
}
/** Family changes keep their requested origin and drop a custom span; additions can seek nearby legal space. */
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
    const original = grid.placements[id], before = placementSpan(id, original), limits = original.span ? freeSpanLimits(id, density) : null;
    let placement: WidgetPlacement = { ...original };
    if (original.span && limits) {
      // Scale a custom span before its origin, clamped to the new limits. Full height stays full height
      // and an axis at its minimum stays at the minimum, so a Column stays a Column (#152).
      const scale = (value: number, ratio: number, min: number, max: number) => value <= min ? min : Math.max(min, Math.min(max, Math.round(value * ratio)));
      const span = { columns: scale(original.span.columns, to.columns / from.columns, limits.min.columns, limits.max.columns), rows: scale(original.span.rows, to.rows / from.rows, limits.min.rows, limits.max.rows) };
      placement = normalizePlacement(id, { ...original, size: familyForSpan(id, span), span });
    }
    const after = placementSpan(id, placement);
    result.placements[id] = { ...placement,
      column: Math.round(original.column / Math.max(1, from.columns - before.columns) * Math.max(0, to.columns - after.columns)),
      row: Math.round(original.row / Math.max(1, from.rows - before.rows) * Math.max(0, to.rows - after.rows)) };
  }
  return packGrid(result, enabled);
}
/** `span` names a custom size that had to be dropped to fit, so the editor can say what changed. */
export interface DensityFit { grid: WidgetGrid; resized: { id: WidgetId; from: WidgetSize; to: WidgetSize; span?: WidgetSpan }[] }
/** Fit all enabled widgets, preferring the fewest family steps and the least lost area. */
export function fitGridDensity(grid: WidgetGrid, density: GridDensity, enabled: Visibility): DensityFit | null {
  const direct = repackGrid(grid, density, enabled); if (direct) return { grid: direct, resized: [] };
  const ids = WIDGET_IDS.filter(id => enabled[id]), variants: { grid: WidgetGrid; cost: number; loss: number }[] = [];
  function choose(index: number, candidate: WidgetGrid, cost: number, loss: number) {
    if (index === ids.length) { if (cost) variants.push({ grid: candidate, cost, loss }); return; }
    const id = ids[index]!, current = grid.placements[id];
    // Span-less families, with a custom span as a pseudo-family just above the family it contains.
    const ladder: WidgetPlacement[] = widgetSizes(id).map(size => ({ column: current.column, row: current.row, size }));
    let original = ladder.findIndex(placement => placement.size === current.size);
    if (current.span) ladder.splice(++original, 0, structuredClone(current));
    for (let family = original; family >= 0; family--) {
      const next = structuredClone(candidate); next.placements[id] = { ...ladder[family]! };
      choose(index + 1, next, cost + (original - family) ** 2, loss + area(id, grid) - area(id, next));
    }
  }
  choose(0, grid, 0, 0);
  variants.sort((a, b) => a.cost - b.cost || a.loss - b.loss);
  for (const candidate of variants) {
    const packed = repackGrid(candidate.grid, density, enabled); if (!packed) continue;
    const dropped = (id: WidgetId) => grid.placements[id].span && !packed.placements[id].span ? grid.placements[id].span : undefined;
    return { grid: packed, resized: ids.filter(id => packed.placements[id].size !== grid.placements[id].size || dropped(id)).map(id => {
      const span = dropped(id);
      return { id, from: grid.placements[id].size, to: packed.placements[id].size, ...(span ? { span: { columns: span.columns, rows: span.rows } } : {}) };
    }) };
  }
  return null;
}
export interface GridDensityHistory { current: WidgetGrid; enabled: Visibility; layouts: Partial<Record<GridDensity, WidgetGrid>> }
function sameGrid(a: WidgetGrid, b: WidgetGrid): boolean {
  return a.revision === b.revision && a.density === b.density && WIDGET_IDS.every(id => { const x = a.placements[id], y = b.placements[id]; return x.column === y.column && x.row === y.row && x.size === y.size && sameSpan(x.span, y.span); });
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
  const original = grid.placements[id]; const span = placementSpan(id, original, grid.revision); const limits = GRID_DENSITIES[grid.density];
  return { ...original, column: cycle % 2 ? limits.columns - original.column - span.columns : original.column,
    row: Math.floor(cycle / 2) % 2 ? limits.rows - original.row - span.rows : original.row };
}
export function motionOffset(cycle: number): { x: number; y: number } {
  if (cycle === 0) return { x: 0, y: 0 };
  return { x: ((cycle * 0.61803398875) % 1 - 0.5) * 4, y: ((cycle * 0.41421356237) % 1 - 0.5) * 4 };
}
/** Reveal choreography order (#76): visible widgets in reading order (row, then column); ties keep catalog order. */
export function widgetRevealOrder(grid: WidgetGrid, ids: readonly WidgetId[]): WidgetId[] {
  const visible = new Set(ids);
  // Array#sort is stable, so equal positions keep the catalog order of WIDGET_IDS.
  return WIDGET_IDS.filter(id => visible.has(id) && grid.placements[id]).sort((a, b) => {
    const first = grid.placements[a], second = grid.placements[b];
    return first.row - second.row || first.column - second.column;
  });
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) { result ^= value.charCodeAt(index); result = Math.imul(result, 16777619); }
  return result >>> 0;
}
/** The moving whole-board reflections of the previous composition (horizontal, vertical or both), with how many widgets each moves. */
function reflectionOptions(grid: WidgetGrid, ids: WidgetId[], previous: WidgetGrid): { grid: WidgetGrid; moved: number }[] {
  // A stale previous composition (another density or other spans) cannot be reflected; use the authored board.
  const compatible = previous.density === grid.density && ids.every(id => sameSpan(placementSpan(id, previous.placements[id]), placementSpan(id, grid.placements[id])));
  const base = compatible ? previous : grid;
  const options: { grid: WidgetGrid; moved: number }[] = [];
  for (const variant of [1, 2, 3]) {
    const result = structuredClone(grid);
    for (const id of ids) { const point = displayPlacement(base, id, variant); result.placements[id] = { ...grid.placements[id], column: point.column, row: point.row }; }
    const placed: Partial<Record<WidgetId, boolean>> = Object.fromEntries(ids.map(id => [id, true]));
    if (!ids.every(id => placementFits(result, id, result.placements[id], placed))) continue;
    const moved = ids.filter(id => previous.placements[id].column !== result.placements[id].column || previous.placements[id].row !== result.placements[id].row).length;
    if (moved) options.push({ grid: result, moved });
  }
  return options;
}
/** The #182 choice among moving reflections; see reflectedComposition. */
function chooseReflection(options: { grid: WidgetGrid; moved: number }[], cycle: number): WidgetGrid | null {
  // A reflection leaves the same widgets in place (those centred on its axes) in every reflected
  // arrangement of a board, so this ranking holds from one fallback to the next.
  const most = Math.max(0, ...options.map(option => option.moved));
  const best = options.filter(option => option.moved === most);
  if (!best.length) return null;
  // Reflections that tie for the most widgets moved rotate with the cycle.
  if (best.length > 1) return best[cycle % best.length]!.grid;
  // A unique best (typically both reflections at once, when a widget is centred on one axis) alternates
  // on odd cycles with the best of the other moving reflections, however many fewer widgets that one
  // moves. With a single moving reflection it repeats; that board has only two arrangements.
  const rest = options.filter(option => option !== best[0]);
  const fewer = Math.max(0, ...rest.map(option => option.moved));
  const second = rest.filter(option => option.moved === fewer);
  return second.length && cycle % 2 ? second[Math.floor(cycle / 2) % second.length]!.grid : best[0]!.grid;
}
/**
 * #93: when the bounded search cannot move every widget on a dense board, a whole-board reflection of
 * the previous composition A (horizontal hA, vertical vA or both hvA) is always collision-free and in
 * bounds. Returns a reflection that moves widgets, or null when every reflection maps the board onto
 * itself. #182: whenever another reflection also moves widgets, consecutive fallbacks apply different
 * reflections. Reflections commute, so a board's reflected arrangements are A, hA, vA and hvA (one,
 * two or four of them distinct), and a run of fallbacks on a board with four visits all four (for
 * example A, vA, hA, hvA) instead of returning to the arrangement from two cycles earlier.
 * Exported for the relocation tests; the display reaches it only through composeWidgetGrid, which may
 * also exchange same-size widgets between a reflection's cells (#338, #317).
 */
export function reflectedComposition(grid: WidgetGrid, ids: WidgetId[], previous: WidgetGrid, cycle: number): WidgetGrid | null {
  return chooseReflection(reflectionOptions(grid, ids, previous), cycle);
}
/** #338: the share of a widget's previous cells that a placement of the same span covers again. */
function keptShare(span: WidgetSpan, from: { column: number; row: number }, to: { column: number; row: number }): number {
  const columns = Math.max(0, Math.min(from.column, to.column) + span.columns - Math.max(from.column, to.column));
  const rows = Math.max(0, Math.min(from.row, to.row) + span.rows - Math.max(from.row, to.row));
  return columns * rows / (span.columns * span.rows);
}
/** #338: a widget that covers more than half of its previous cells again has stayed in place. */
export const RELOCATION_KEEP_LIMIT = 0.5;
const SEARCH_ATTEMPTS = 20_000, TILE_ATTEMPTS = 5_000, EXCHANGE_ATTEMPTS = 4_000;
/**
 * Keep the edited layout at rest, then choose distant legal cells during a black interval.
 * `earlier` holds the compositions before `previous`, most recent first (the display passes the one
 * from two cycles back, #317). A widget "stays" when it covers more than half of its previous cells
 * again, or more than the least that any legal origin of its span allows (#338). In order of preference:
 * 1. a searched composition in which no widget stays and that recreates no earlier composition: first
 *    widget by widget with distant cells first, then cell by cell for boards with few spare cells;
 * 2. a whole-board reflection of the previous composition (#93; the #182 choice first) in which no widget
 *    stays: a widget that stays trades places with a same-size clean region elsewhere (its own cells or
 *    its row or column band), and widgets of the same span may exchange cells. A reflection alone cannot
 *    move a widget centred on its axis, and the whole-plane offset (motionOffset, at most 2% of the plane
 *    each way) cannot move one by a large share of its size. An earlier composition may return only when
 *    no such reflection avoids it;
 * 3. a searched composition that moves every widget to other cells and recreates no earlier one,
 *    improved the same way where it can be;
 * 4. the reflection or search result that leaves the fewest widgets staying, preferring one that
 *    recreates no earlier composition;
 * 5. a search that lets widgets stay (only a board every reflection maps onto itself gets here), and
 *    finally the authored board.
 * Every step is bounded. Every result is collision-free and in bounds, keeps every span and relocates
 * the whole group at once.
 */
export function composeWidgetGrid(grid: WidgetGrid, enabled: Partial<Record<WidgetId, boolean>>, cycle: number, previous = grid, earlier: readonly WidgetGrid[] = []): WidgetGrid {
  if (cycle === 0) return structuredClone(grid);
  const limits = GRID_DENSITIES[grid.density];
  const ids = WIDGET_IDS.filter(id => enabled[id]).sort((a, b) => {
    const as = placementSpan(a, grid.placements[a]); const bs = placementSpan(b, grid.placements[b]);
    return bs.columns * bs.rows - as.columns * as.rows || hash(`${cycle}:${a}`) - hash(`${cycle}:${b}`);
  });
  const spans = Object.fromEntries(ids.map(id => [id, placementSpan(id, grid.placements[id])])) as Record<WidgetId, WidgetSpan>;
  const candidates = Object.fromEntries(ids.map(id => {
    const span = spans[id]; const origin = previous.placements[id];
    const values: WidgetPlacement[] = [];
    for (let row = 0; row + span.rows <= limits.rows; row++) for (let column = 0; column + span.columns <= limits.columns; column++) values.push({ ...grid.placements[id], column, row });
    // Alternate the farthest half of legal origins so motion is substantial without a four-position loop.
    const distance = (point: WidgetPlacement) => Math.hypot((point.column - origin.column) / limits.columns, (point.row - origin.row) / limits.rows);
    values.sort((a, b) => {
      const ad = distance(a); const bd = distance(b);
      const aFar = ad >= 0.28; const bFar = bd >= 0.28;
      return Number(bFar) - Number(aFar) || hash(`${cycle}:${id}:${a.column}:${a.row}`) - hash(`${cycle}:${id}:${b.column}:${b.row}`);
    });
    return [id, values];
  })) as Record<WidgetId, WidgetPlacement[]>;
  // Boards in another density or with other spans (a stale composition after an edit) are not compared.
  const comparable = (board: WidgetGrid) => board.density === grid.density && ids.every(id => sameSpan(placementSpan(id, board.placements[id]), spans[id]));
  const tracked = comparable(previous);
  // The most of its previous cells each widget may keep: half, or the least that any legal origin keeps.
  const keepLimit = Object.fromEntries(ids.map(id => [id, tracked ? Math.max(RELOCATION_KEEP_LIMIT, Math.min(...candidates[id].map(point => keptShare(spans[id], previous.placements[id], point)))) : 1])) as Record<WidgetId, number>;
  const key = (board: WidgetGrid) => ids.map(id => `${board.placements[id].column},${board.placements[id].row}`).join('|');
  const recent = new Set(earlier.filter(comparable).map(key));
  const staying = (board: WidgetGrid) => ids.filter(id => keptShare(spans[id], previous.placements[id], board.placements[id]) > keepLimit[id]).length;

  /** Bounded depth-first search: `apart` keeps every widget within its limit, `moved` only changes its cells, `any` lets it stay. */
  function search(rule: 'apart' | 'moved' | 'any', avoidRecent: boolean): WidgetGrid | null {
    const result = structuredClone(grid); const occupied = new Uint8Array(limits.columns * limits.rows); let attempts = 0;
    // Only placed widgets occupy cells, exactly as placementFits counts them (hidden widgets never do).
    const free = (point: WidgetPlacement, span: WidgetSpan) => {
      for (let row = point.row; row < point.row + span.rows; row++) for (let column = point.column; column < point.column + span.columns; column++) if (occupied[row * limits.columns + column]) return false;
      return true;
    };
    const mark = (point: WidgetPlacement, span: WidgetSpan, value: number) => {
      for (let row = point.row; row < point.row + span.rows; row++) occupied.fill(value, row * limits.columns + point.column, row * limits.columns + point.column + span.columns);
    };
    function step(index: number): boolean {
      if (index === ids.length) return !(avoidRecent && recent.has(key(result)));
      const id = ids[index]!, span = spans[id], prior = previous.placements[id];
      for (const candidate of candidates[id]) {
        if (++attempts > SEARCH_ATTEMPTS) return false;
        if (rule !== 'any' && candidate.column === prior.column && candidate.row === prior.row && candidates[id].length > 1) continue;
        if (rule === 'apart' && keptShare(span, prior, candidate) > keepLimit[id]) continue;
        if (!free(candidate, span)) continue;
        result.placements[id] = candidate; mark(candidate, span, 1);
        if (step(index + 1)) return true;
        mark(candidate, span, 0);
      }
      return false;
    }
    return step(0) ? result : null;
  }
  /**
   * #338: the reflection `base` with widgets of the same span exchanging cells, so that every widget keeps
   * within its limit (and, with `avoidRecent`, no earlier composition returns). The cells are exactly the
   * reflection's, so the result stays collision-free and in bounds. Each widget tries its own reflected
   * cell first, so a reflection that already qualifies comes back unchanged.
   */
  function exchange(base: WidgetGrid, avoidRecent: boolean): WidgetGrid | null {
    if (!tracked) return null;
    const order = ids.map(id => {
      const own = base.placements[id];
      const cells = ids.filter(other => sameSpan(spans[other], spans[id])).map(other => base.placements[other])
        .filter(cell => keptShare(spans[id], previous.placements[id], cell) <= keepLimit[id])
        .sort((a, b) => Number(b === own) - Number(a === own) || hash(`${cycle}:${id}:${a.column}:${a.row}`) - hash(`${cycle}:${id}:${b.column}:${b.row}`));
      return { id, cells };
    }).sort((a, b) => a.cells.length - b.cells.length);
    if (order.some(entry => !entry.cells.length)) return null;
    const result = structuredClone(base); const taken = new Set<string>(); let attempts = 0;
    function step(index: number): boolean {
      if (index === order.length) return !(avoidRecent && recent.has(key(result)));
      const { id, cells } = order[index]!;
      for (const cell of cells) {
        if (++attempts > EXCHANGE_ATTEMPTS) return false;
        const slot = `${spans[id].columns}x${spans[id].rows}@${cell.column},${cell.row}`;
        if (taken.has(slot)) continue;
        taken.add(slot); result.placements[id] = { ...grid.placements[id], column: cell.column, row: cell.row };
        if (step(index + 1)) return true;
        taken.delete(slot);
      }
      return false;
    }
    return step(0) ? result : null;
  }
  /**
   * #338: a widget that keeps more than its limit moves with a clean region around it (its own cells, or
   * the row or column band it sits in), which trades places with a same-size clean region elsewhere. A
   * region is clean when every widget touching it lies entirely inside it, so translating the contents of
   * two disjoint clean regions into each other keeps the board collision-free and in bounds. A swap is
   * kept only when every widget it moves stays within its own limit. Unlike an exchange, this also moves
   * a widget that no other widget shares a span with.
   */
  function settle(base: WidgetGrid): WidgetGrid {
    if (!tracked) return base;
    const inRect = (point: WidgetPlacement, size: WidgetSpan, rect: WidgetPlacement, area: WidgetSpan) => point.column >= rect.column && point.row >= rect.row && point.column + size.columns <= rect.column + area.columns && point.row + size.rows <= rect.row + area.rows;
    let board = base;
    const touching = (rect: WidgetPlacement, area: WidgetSpan) => ids.filter(other => intersects(board.placements[other], spans[other], rect, area));
    const clean = (rect: WidgetPlacement, area: WidgetSpan) => touching(rect, area).every(other => inRect(board.placements[other], spans[other], rect, area));
    /** The smallest band of whole rows (or columns) around a widget that no other widget crosses. */
    const band = (id: WidgetId, rows: boolean): { rect: WidgetPlacement; area: WidgetSpan } | null => {
      const point = board.placements[id];
      let start = rows ? point.row : point.column, end = start + (rows ? spans[id].rows : spans[id].columns);
      for (let grown = true; grown;) {
        grown = false;
        for (const other of ids) {
          const from = rows ? board.placements[other].row : board.placements[other].column, to = from + (rows ? spans[other].rows : spans[other].columns);
          if (from < end && to > start && (from < start || to > end)) { start = Math.min(start, from); end = Math.max(end, to); grown = true; }
        }
      }
      // A band wider than half the board has no disjoint band of its size to trade with.
      if ((end - start) * 2 > (rows ? limits.rows : limits.columns)) return null;
      return rows ? { rect: { ...point, column: 0, row: start }, area: { columns: limits.columns, rows: end - start } } : { rect: { ...point, column: start, row: 0 }, area: { columns: end - start, rows: limits.rows } };
    };
    for (const id of ids) {
      if (keptShare(spans[id], previous.placements[id], board.placements[id]) <= keepLimit[id]) continue;
      const regions = [{ rect: board.placements[id], area: spans[id] }, band(id, true), band(id, false)].filter(region => region !== null);
      found: for (const { rect: from, area } of regions) {
        const targets: WidgetPlacement[] = [];
        for (let row = 0; row + area.rows <= limits.rows; row++) for (let column = 0; column + area.columns <= limits.columns; column++) if (!intersects(from, area, { ...from, column, row }, area)) targets.push({ ...from, column, row });
        targets.sort((a, b) => hash(`${cycle}:${id}:${a.column}:${a.row}`) - hash(`${cycle}:${id}:${b.column}:${b.row}`));
        for (const to of targets) {
          const { column, row } = to;
          if (!clean(to, area)) continue;
          const moving = [...touching(from, area).map(other => ({ other, by: { column: column - from.column, row: row - from.row } })), ...touching(to, area).map(other => ({ other, by: { column: from.column - column, row: from.row - row } }))];
          const shifted = (other: WidgetId, by: { column: number; row: number }) => ({ column: board.placements[other].column + by.column, row: board.placements[other].row + by.row });
          if (moving.some(({ other, by }) => keptShare(spans[other], previous.placements[other], shifted(other, by)) > keepLimit[other])) continue;
          const next = structuredClone(board);
          for (const { other, by } of moving) next.placements[other] = { ...grid.placements[other], ...shifted(other, by) };
          board = next; break found;
        }
      }
    }
    return board;
  }

  /**
   * #338: the same rule as `search('apart')`, packed cell by cell: the first free cell (in reading order)
   * either takes the top-left corner of a widget that fits there or stays empty while the board has spare
   * cells. A widget-by-widget search rarely completes a board with few or no spare cells within its
   * budget; this order never leaves an unfillable hole, so it finds such boards' arrangements quickly.
   * Widgets are tried in an order that changes with the cycle.
   */
  function tile(avoidRecent: boolean): WidgetGrid | null {
    const result = structuredClone(grid); const occupied = new Uint8Array(limits.columns * limits.rows); let attempts = 0;
    let spare = limits.columns * limits.rows - ids.reduce((sum, id) => sum + spans[id].columns * spans[id].rows, 0);
    const order = [...ids].sort((a, b) => hash(`${cycle}:tile:${a}`) - hash(`${cycle}:tile:${b}`)); const placed = new Set<WidgetId>();
    const fits = (id: WidgetId, column: number, row: number) => {
      const span = spans[id];
      if (column + span.columns > limits.columns || row + span.rows > limits.rows) return false;
      for (let y = row; y < row + span.rows; y++) for (let x = column; x < column + span.columns; x++) if (occupied[y * limits.columns + x]) return false;
      return true;
    };
    const mark = (id: WidgetId, column: number, row: number, value: number) => {
      for (let y = row; y < row + spans[id].rows; y++) occupied.fill(value, y * limits.columns + column, y * limits.columns + column + spans[id].columns);
    };
    function step(from: number): boolean {
      if (placed.size === ids.length) return !(avoidRecent && recent.has(key(result)));
      let cell = from; while (occupied[cell]) cell++;
      if (cell >= occupied.length) return false;
      const column = cell % limits.columns, row = Math.floor(cell / limits.columns);
      for (const id of order) {
        if (placed.has(id)) continue;
        if (++attempts > TILE_ATTEMPTS) return false;
        const prior = previous.placements[id];
        if (candidates[id].length > 1 && column === prior.column && row === prior.row) continue;
        if (keptShare(spans[id], prior, { column, row }) > keepLimit[id] || !fits(id, column, row)) continue;
        mark(id, column, row, 1); placed.add(id); result.placements[id] = { ...grid.placements[id], column, row };
        if (step(cell + 1)) return true;
        mark(id, column, row, 0); placed.delete(id);
      }
      // Leave this cell empty (only a board with spare cells may).
      if (spare <= 0 || ++attempts > TILE_ATTEMPTS) return false;
      spare--; occupied[cell] = 2;
      const done = step(cell + 1);
      occupied[cell] = 0; spare++;
      return done;
    }
    return step(0) ? result : null;
  }

  const apart = search('apart', true) ?? tile(true); if (apart) return apart;
  const options = reflectionOptions(grid, ids, previous), chosen = chooseReflection(options, cycle);
  const reflections = (chosen ? [chosen, ...options.map(option => option.grid).filter(option => option !== chosen)] : []).map(settle);
  for (const avoidRecent of [true, false]) for (const base of reflections) { const exchanged = exchange(base, avoidRecent); if (exchanged) return exchanged; }
  const moved = search('moved', true);
  if (moved) { const settled = settle(moved); return exchange(settled, true) ?? (recent.has(key(settled)) ? moved : settled); }
  if (reflections.length) {
    const fallbacks = [...reflections]; const searched = search('moved', false); if (searched) fallbacks.push(settle(searched));
    // Array#sort is stable, so the #182 choice wins a tie.
    return fallbacks.sort((a, b) => staying(a) - staying(b) || Number(recent.has(key(a))) - Number(recent.has(key(b))))[0]!;
  }
  const any = search('any', false); if (any) return any;
  // An authored valid board is always a safe fallback when bounded search is exhausted.
  return structuredClone(grid);
}

/**
 * Whether a board needs the forecast (#352): Weather or Forecast, or Sun & moon or Air quality while
 * the weather location's timezone is still `auto`, which only the forecast resolves. The server
 * refreshes the forecast for /api/state only then; the editor asks for it itself otherwise. Dynamic
 * (#437) always needs it: its weather cards, and the place and zone its sun and moon use.
 */
export function needsForecast(settings: Pick<VisualSettings, 'widgets'> & { location: { timezone: string } }): boolean {
  const on = (id: WidgetId) => !!settings.widgets[id] && isActiveWidget(id);
  return on('weather') || on('forecast') || on('dynamic') || (settings.location.timezone === 'auto' && (on('sunMoon') || on('airQuality')));
}

/**
 * Whether a board needs air quality (#437): the Air quality widget, or Dynamic with its Air & UV source.
 * The server requests the CAMS reading for /api/state only then; the editor previews it for a draft.
 */
export function needsAirQuality(settings: Pick<VisualSettings, 'widgets'> & { widgetData: { dynamic: { air: boolean } } }): boolean {
  const on = (id: WidgetId) => !!settings.widgets[id] && isActiveWidget(id);
  return on('airQuality') || (on('dynamic') && settings.widgetData.dynamic.air);
}
/** Whether a board needs official weather alerts (#437): Dynamic with its alerts source, as saved. */
export function needsAlerts(settings: Pick<VisualSettings, 'widgets'> & { widgetData: { dynamic: { alerts: boolean } } }): boolean {
  return !!settings.widgets.dynamic && isActiveWidget('dynamic') && settings.widgetData.dynamic.alerts;
}
