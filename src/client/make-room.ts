/**
 * Room guidance for the editor (#183, #238): when an add, a family change or a free-size span has
 * no room, say what takes the space and find the smallest draft edit that makes it fit. Every
 * answer comes from the shared collision helpers (`reflowWidget`, `fitWidgetFamily`,
 * `resizeWidgetSpan`, `fitGridDensity`), so guidance can never promise a board that validation
 * would reject. Pure; nothing here changes a board without an explicit user action.
 */
import type { WidgetGrid, WidgetId } from '../shared/contracts.ts';
import {
  GRID_DENSITIES,
  WIDGET_CATALOG,
  WIDGET_IDS,
  firstPlacement,
  fitGridDensity,
  fitWidgetFamily,
  freeSpanLimits,
  intersects,
  isActiveWidget,
  placementSpan,
  reflowWidget,
  resizeWidgetSpan,
  widgetSizes,
  type GridDensity,
  type WidgetSize,
  type WidgetSpan,
} from '../shared/widgets.ts';

type Visibility = Partial<Record<WidgetId, boolean>>;

/** What the user asked for: add a hidden widget, change a family, or set a free-size span. */
export type RoomRequest =
  | { kind: 'add'; id: WidgetId; size: WidgetSize }
  | { kind: 'family'; id: WidgetId; size: WidgetSize }
  | { kind: 'span'; id: WidgetId; span: WidgetSpan };

/** One draft edit that makes a request fit. */
export type RoomFix =
  /** Add at a smaller family of the same widget ("Try Small"). */
  | { kind: 'size'; size: WidgetSize }
  /** Switch to a finer grid without resizing anything, then retry ("Switch the grid to Fine"). */
  | { kind: 'density'; density: GridDensity }
  /** Make another widget one or more families smaller, then retry ("Make room"). */
  | { kind: 'shrink'; widget: WidgetId; size: WidgetSize };

export interface RoomDiagnosis {
  /** Widgets that take the requested space, in catalog order. */
  blockers: WidgetId[];
  /** Draft edits that would fit the request, best first (at most one of each kind). */
  fixes: RoomFix[];
}

const DENSITY_ORDER: GridDensity[] = ['spacious', 'balanced', 'fine'];

/** The editor's add rule: the first legal origin, else nearby origins through `fitWidgetFamily`. */
export function addToGrid(grid: WidgetGrid, id: WidgetId, size: WidgetSize, enabled: Visibility): WidgetGrid | null {
  const placement = firstPlacement(grid, id, size, enabled);
  return placement ? reflowWidget(grid, id, placement, enabled) : fitWidgetFamily(grid, id, size, enabled);
}

/** The plain attempt, exactly as the editor performs it. */
export function fulfilRequest(grid: WidgetGrid, request: RoomRequest, enabled: Visibility): WidgetGrid | null {
  if (request.kind === 'add') return addToGrid(grid, request.id, request.size, enabled);
  if (request.kind === 'family') return fitWidgetFamily(grid, request.id, request.size, enabled);
  return resizeWidgetSpan(grid, request.id, request.span, enabled);
}

/** The 2-wide, full-height span of a free-size widget in the grid's density, or null. */
export function columnSpan(id: WidgetId, density: GridDensity): WidgetSpan | null {
  const limits = freeSpanLimits(id, density);
  return limits ? { columns: limits.min.columns, rows: limits.max.rows } : null;
}
export function isColumnSpan(id: WidgetId, span: WidgetSpan, density: GridDensity): boolean {
  const column = columnSpan(id, density);
  return !!column && column.columns === span.columns && column.rows === span.rows;
}

function area(span: WidgetSpan): number { return span.columns * span.rows; }
function familyArea(id: WidgetId, size: WidgetSize): number { return area(placementSpan(id, { column: 0, row: 0, size })); }

/** Smaller families of a visible widget, one step down first. */
function smallerFamilies(grid: WidgetGrid, id: WidgetId): { size: WidgetSize; steps: number }[] {
  const sizes = widgetSizes(id), placement = grid.placements[id];
  // A custom span counts as one step above the family it contains (as in fitGridDensity).
  const current = sizes.indexOf(placement.size) + (placement.span ? 1 : 0);
  return sizes.slice(0, Math.max(0, current)).map((size) => ({ size, steps: current - sizes.indexOf(size) })).reverse();
}

/** The board with one widget made smaller, reflowed by the shared helper. */
function shrink(grid: WidgetGrid, widget: WidgetId, size: WidgetSize, enabled: Visibility): WidgetGrid | null {
  return fitWidgetFamily(grid, widget, size, enabled);
}

/** The rectangle a request asks for at its preferred origin (used to name blockers when nothing helps). */
function requestedRect(grid: WidgetGrid, request: RoomRequest): { column: number; row: number; span: WidgetSpan } | null {
  if (request.kind === 'add') return null;
  const dimensions = GRID_DENSITIES[grid.density], origin = grid.placements[request.id];
  const span = request.kind === 'span' ? request.span : placementSpan(request.id, { column: 0, row: 0, size: request.size });
  return { span, column: Math.max(0, Math.min(origin.column, dimensions.columns - span.columns)), row: Math.max(0, Math.min(origin.row, dimensions.rows - span.rows)) };
}

/**
 * Why a request has no room and up to two draft edits that would fit it, or null when it already
 * fits. Adding a widget prefers a smaller family of the same widget, then a finer grid, then
 * shrinking a neighbour; a resize can only shrink a neighbour. `options` turns alternatives off.
 */
export function diagnoseRoom(grid: WidgetGrid, request: RoomRequest, enabled: Visibility, options: { size?: boolean; density?: boolean; shrink?: boolean } = {}): RoomDiagnosis | null {
  if (fulfilRequest(grid, request, enabled)) return null;
  const { size: trySize = request.kind === 'add', density: tryDensity = request.kind === 'add', shrink: tryShrink = true } = options;
  const fixes: RoomFix[] = [];
  if (trySize && request.kind !== 'span') {
    const sizes = widgetSizes(request.id), index = sizes.indexOf(request.size);
    const smaller = sizes.slice(0, Math.max(0, index)).reverse().find((size) => fulfilRequest(grid, { ...request, size }, enabled));
    if (smaller) fixes.push({ kind: 'size', size: smaller });
  }
  if (tryDensity && request.kind !== 'span') {
    const finer = DENSITY_ORDER.slice(DENSITY_ORDER.indexOf(grid.density) + 1).find((density) => applyRoomFix(grid, request, { kind: 'density', density }, enabled));
    if (finer) fixes.push({ kind: 'density', density: finer });
  }
  // Shrinking a neighbour is the last resort for an add; for a resize it is the only alternative.
  const shrinks: { fix: RoomFix & { kind: 'shrink' }; steps: number; loss: number }[] = [];
  if (tryShrink && fixes.length < 2) {
    for (const widget of WIDGET_IDS) {
      if (widget === request.id || !enabled[widget] || !isActiveWidget(widget)) continue;
      const before = area(placementSpan(widget, grid.placements[widget]));
      for (const { size, steps } of smallerFamilies(grid, widget)) {
        const reduced = shrink(grid, widget, size, enabled);
        if (!reduced || !fulfilRequest(reduced, request, enabled)) continue;
        shrinks.push({ fix: { kind: 'shrink', widget, size }, steps, loss: before - familyArea(widget, size) });
        break; // The first (largest) family that fits is this widget's smallest reduction.
      }
    }
    shrinks.sort((a, b) => a.steps - b.steps || a.loss - b.loss || WIDGET_IDS.indexOf(a.fix.widget) - WIDGET_IDS.indexOf(b.fix.widget));
    if (shrinks[0]) fixes.push(shrinks[0].fix);
  }
  let blockers = shrinks.map((item) => item.fix.widget);
  if (!blockers.length) {
    const rect = requestedRect(grid, request);
    blockers = rect ? WIDGET_IDS.filter((other) => other !== request.id && enabled[other] && isActiveWidget(other)
      && intersects({ column: rect.column, row: rect.row, size: 'small' }, rect.span, grid.placements[other], placementSpan(other, grid.placements[other]))) : [];
  }
  return { blockers: WIDGET_IDS.filter((id) => blockers.includes(id)), fixes };
}

/** Applies one fix and the request together; null when the board no longer allows it. */
/** A no-room explanation as the editor shows it: the request, the board it was computed for and its fixes. */
export interface RoomProblem extends RoomDiagnosis {
  request: RoomRequest;
  grid: WidgetGrid;
  enabled: Visibility;
  message: string;
}
export function roomProblem(grid: WidgetGrid, request: RoomRequest, enabled: Visibility): RoomProblem | null {
  const diagnosis = diagnoseRoom(grid, request, enabled);
  return diagnosis && { ...diagnosis, request, grid, enabled: { ...enabled }, message: describeRoomProblem(request, diagnosis, grid.density) };
}

export function applyRoomFix(grid: WidgetGrid, request: RoomRequest, fix: RoomFix, enabled: Visibility): WidgetGrid | null {
  if (fix.kind === 'size') return request.kind === 'span' ? null : fulfilRequest(grid, { ...request, size: fix.size }, enabled);
  if (fix.kind === 'density') {
    if (request.kind === 'span') return null;
    const fit = fitGridDensity(grid, fix.density, enabled);
    // A finer grid is offered only when it changes no widget's family.
    return fit && !fit.resized.length ? fulfilRequest(fit.grid, request, enabled) : null;
  }
  if (fix.widget === request.id || !enabled[fix.widget]) return null;
  const reduced = shrink(grid, fix.widget, fix.size, enabled);
  return reduced && fulfilRequest(reduced, request, enabled);
}

function familyName(size: WidgetSize): string { return size[0]!.toUpperCase() + size.slice(1); }
export function densityName(density: GridDensity): string { return GRID_DENSITIES[density].name.split(' · ')[0]!; }
/** "Clock", "Clock and Weather", "Clock, Weather and Forecast" (or "or"). */
export function listNames(ids: WidgetId[], conjunction: 'and' | 'or' = 'and'): string {
  const names = ids.map((id) => WIDGET_CATALOG[id].name);
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${conjunction} ${names.at(-1)}`;
}

/** "a full-height Reminders column", "a 3 × 8 Reminders", "Large Reminders". */
export function requestTarget(request: RoomRequest, density: GridDensity): string {
  const name = WIDGET_CATALOG[request.id].name;
  if (request.kind === 'span') return isColumnSpan(request.id, request.span, density) ? `a full-height ${name} column` : `a ${request.span.columns} × ${request.span.rows} ${name}`;
  return `${familyName(request.size)} ${name}`;
}

/** The sentence a live region reads for a request with no room. */
export function describeRoomProblem(request: RoomRequest, diagnosis: RoomDiagnosis, density: GridDensity): string {
  const name = WIDGET_CATALOG[request.id].name;
  if (request.kind === 'add') {
    const lead = `No room for ${name} at ${request.size} size.`;
    return diagnosis.fixes.length ? lead : `${lead} Remove a widget or make one smaller first.`;
  }
  const beside = diagnosis.blockers.length ? ` beside ${listNames(diagnosis.blockers)}` : '';
  const lead = `No room for ${requestTarget(request, density)}${beside}.`;
  if (diagnosis.fixes.length) return lead;
  return `${lead} ${diagnosis.blockers.length > 1 ? 'Make one of them smaller' : diagnosis.blockers.length ? `Make ${WIDGET_CATALOG[diagnosis.blockers[0]!].name} smaller` : 'Make another widget smaller'} or remove a widget.`;
}

/** Button text for a fix. */
export function roomFixLabel(fix: RoomFix): string {
  if (fix.kind === 'size') return `Try ${familyName(fix.size)}`;
  if (fix.kind === 'density') return `Switch the grid to ${densityName(fix.density)}`;
  return `Make room: ${WIDGET_CATALOG[fix.widget].name} ${fix.size}`;
}

/** What changed after a fix, for the editor's status line. */
export function roomFixResult(request: RoomRequest, fix: RoomFix, grid: WidgetGrid): string {
  const name = WIDGET_CATALOG[request.id].name;
  const placement = grid.placements[request.id], span = placementSpan(request.id, placement);
  const shape = request.kind === 'span'
    ? (isColumnSpan(request.id, span, grid.density) ? 'a full-height column' : `${span.columns} × ${span.rows}`)
    : placement.size;
  const outcome = request.kind === 'add' ? `${name} added${fix.kind === 'size' ? ` at ${fix.size} size` : ''}` : `${name} is now ${shape}`;
  if (fix.kind === 'density') return `Grid switched to ${densityName(fix.density)}. ${outcome}.`;
  if (fix.kind === 'shrink') return `${WIDGET_CATALOG[fix.widget].name} is now ${fix.size}. ${outcome}.`;
  return `${outcome}.`;
}

/**
 * Whether a free-size widget could become a full-height column on this board (after it is added,
 * when it is hidden), and if not, which widgets a single reduction would free the room from.
 */
export function columnOutlook(grid: WidgetGrid, id: WidgetId, enabled: Visibility, addSize?: WidgetSize): { fits: boolean; blockers: WidgetId[] } | null {
  const span = columnSpan(id, grid.density);
  if (!span) return null;
  let board = grid, visible = enabled;
  if (!enabled[id]) {
    const added = addToGrid(grid, id, addSize ?? WIDGET_CATALOG[id].defaultSize, enabled);
    if (!added) return { fits: false, blockers: [] };
    board = added; visible = { ...enabled, [id]: true };
  }
  if (board.placements[id].span && isColumnSpan(id, board.placements[id].span!, board.density)) return { fits: true, blockers: [] };
  const diagnosis = diagnoseRoom(board, { kind: 'span', id, span }, visible, { size: false, density: false });
  return diagnosis ? { fits: false, blockers: diagnosis.fixes.length ? diagnosis.blockers : [] } : { fits: true, blockers: [] };
}
