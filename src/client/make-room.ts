/**
 * Room guidance for the editor (#183, #238, #346): when an add, a family change, a free-size span or
 * a grid density has no room, say what takes the space and find the smallest draft edit that makes it
 * fit. Every answer comes from the shared collision helpers (`reflowWidget`, `fitWidgetFamily`,
 * `resizeWidgetSpan`, `fitGridDensity`), so guidance can never promise a board that validation
 * would reject. It also words the result of each layout edit for the editor's status line (#341).
 * Pure; nothing here changes a board without an explicit user action.
 */
import type { WidgetGrid, WidgetId, WidgetPlacement } from '../shared/contracts.ts';
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
  isFreeSize,
  placementSpan,
  reflowWidget,
  repackGrid,
  resizeWidgetSpan,
  widgetSizes,
  type DensityFit,
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
  /** Add at a smaller family of the same widget ("Try small"). */
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

/** Applies one fix and the request together; null when the board no longer allows it. */
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

/** "a full-height Reminders column", "a 3 × 8 Reminders", "an 8 × 4 Reminders", "Large Reminders". */
export function requestTarget(request: RoomRequest, density: GridDensity): string {
  const name = WIDGET_CATALOG[request.id].name;
  if (request.kind !== 'span') return `${familyName(request.size)} ${name}`;
  if (isColumnSpan(request.id, request.span, density)) return `a full-height ${name} column`;
  // Eight, eleven and eighteen are said with a vowel sound.
  const article = /^(8|11|18)/.test(String(request.span.columns)) ? 'an' : 'a';
  return `${article} ${request.span.columns} × ${request.span.rows} ${name}`;
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

/**
 * Button text for a fix. Fix labels share one style (#310): sentence case, widget and grid names
 * capitalised, families in lower case as in the sentences around them ("Try small", "Switch the grid
 * to Fine", "Make room: Weather medium", "Make room: remove Photo").
 */
export function roomFixLabel(fix: RoomFix): string {
  if (fix.kind === 'size') return `Try ${fix.size}`;
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

/**
 * Why a grid density cannot hold the board (#346), and one draft fix when the helpers find it. Call
 * it only after `switchGridDensity` refused the density. Making one widget smaller never helps:
 * `fitGridDensity` has already tried every family reduction. Hiding one widget can, so the smallest
 * widget whose removal lets the density fit is offered ("Make room: remove Photo"); Cancel restores
 * it. Each candidate is first packed with every widget at its smallest family, the cheapest variant
 * `fitGridDensity` tries: when that packs, the full fit succeeds, so a board with no fix costs one
 * bounded packing attempt per widget rather than a full density search each.
 */
export interface DensityRefusal {
  density: GridDensity;
  /** Visible widgets on the refused board. */
  count: number;
  /** The widget whose removal lets the density fit, or null when no single removal does. */
  remove: WidgetId | null;
  message: string;
}
export function densityRefusal(grid: WidgetGrid, density: GridDensity, enabled: Visibility): DensityRefusal {
  const visible = WIDGET_IDS.filter((id) => enabled[id] && isActiveWidget(id));
  const smallest: WidgetGrid = { ...grid, placements: { ...grid.placements } };
  for (const id of visible) {
    const { span: _span, ...placement } = grid.placements[id];
    smallest.placements[id] = { ...placement, size: widgetSizes(id)[0]! };
  }
  const candidates = [...visible].sort((a, b) => area(placementSpan(a, grid.placements[a])) - area(placementSpan(b, grid.placements[b])) || WIDGET_IDS.indexOf(a) - WIDGET_IDS.indexOf(b));
  const remove = candidates.find((id) => !!repackGrid(smallest, density, { ...enabled, [id]: false })) ?? null;
  const { columns, rows } = GRID_DENSITIES[density];
  const lead = `${densityName(density)} (${columns} × ${rows}) can't fit ${visible.length === 1 ? 'this widget' : `these ${visible.length} widgets`}.`;
  return { density, count: visible.length, remove, message: remove ? lead : `${lead} Make some smaller or remove one, then try again.` };
}
export function densityFixLabel(refusal: DensityRefusal): string {
  return refusal.remove ? `Make room: remove ${WIDGET_CATALOG[refusal.remove].name}` : '';
}
/** "Clock medium · Reminders 2 × 8 → small": the families a density fit reduced (#152). */
export function densityResized(resized: DensityFit['resized']): string {
  return resized.map(({ id, to, span }) => `${WIDGET_CATALOG[id].name} ${span ? `${span.columns} × ${span.rows} → ` : ''}${to}`).join(' · ');
}
/** What a density fix changed, for the status line. */
export function densityFixResult(remove: WidgetId, density: GridDensity, resized: DensityFit['resized']): string {
  const changed = densityResized(resized);
  return `${WIDGET_CATALOG[remove].name} removed and the grid switched to ${densityName(density)}.${changed ? ` ${changed} to fit.` : ''}`;
}

/** "column 7, row 5": a widget's top-left cell, counted from 1 (#341). */
export function cellPosition(placement: Pick<WidgetPlacement, 'column' | 'row'>): string {
  return `column ${placement.column + 1}, row ${placement.row + 1}`;
}
/** The size as the inspector names it: a family ("Small") or a free-size widget's cells ("2 × 3"). */
export function sizeLabel(id: WidgetId, placement: WidgetPlacement): string {
  if (!isFreeSize(id)) return familyName(placement.size);
  const span = placementSpan(id, placement);
  return `${span.columns} × ${span.rows}`;
}
/** A canvas widget's description for assistive technology: "Column 9, row 5 · Medium". */
export function placementDescription(id: WidgetId, placement: WidgetPlacement): string {
  const position = cellPosition(placement);
  return `${position[0]!.toUpperCase()}${position.slice(1)} · ${sizeLabel(id, placement)}`;
}
export type MoveDirection = 'left' | 'right' | 'up' | 'down';
/** A refused keyboard move: "No room to the left", "No room above". */
export function refusedMove(direction: MoveDirection): string {
  return direction === 'up' ? 'No room above' : direction === 'down' ? 'No room below' : `No room to the ${direction}`;
}
function joinList(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
function direction(dx: number, dy: number): string {
  const vertical = dy > 0 ? 'down' : dy < 0 ? 'up' : '', horizontal = dx > 0 ? 'right' : dx < 0 ? 'left' : '';
  return vertical && horizontal ? `${vertical} and ${horizontal}` : vertical || horizontal;
}
/**
 * The neighbours a layout edit of `id` moved (#340): "Forecast moved right to make room". With the
 * board a resize exploration started from, a neighbour that returns to its place there reads
 * "Forecast moved back". Empty when no other visible widget moved.
 */
export function displacedNeighbours(before: WidgetGrid, after: WidgetGrid, id: WidgetId, enabled: Visibility, base?: WidgetGrid): string {
  const pushed: string[] = [], returned: WidgetId[] = [];
  for (const other of WIDGET_IDS) {
    if (other === id || !enabled[other] || !isActiveWidget(other)) continue;
    const from = before.placements[other], to = after.placements[other], home = base?.placements[other];
    if (from.column === to.column && from.row === to.row) continue;
    if (home && home.column === to.column && home.row === to.row) returned.push(other);
    else pushed.push(`${WIDGET_CATALOG[other].name} moved ${direction(to.column - from.column, to.row - from.row)}`);
  }
  return [pushed.length ? `${joinList(pushed)} to make room` : '', returned.length ? `${listNames(returned)} moved back` : ''].filter(Boolean).join(' · ');
}
/** "Last screen moved to column 7, row 5", plus any neighbour it moved (#341). */
export function movedMessage(before: WidgetGrid, after: WidgetGrid, id: WidgetId, enabled: Visibility): string {
  const displaced = displacedNeighbours(before, after, id, enabled);
  return `${WIDGET_CATALOG[id].name} moved to ${cellPosition(after.placements[id])}${displaced ? ` · ${displaced}` : ''}`;
}
/** "Last screen resized to Small" or "Reminders resized to 2 × 3", plus any neighbour it moved (#340, #341). */
export function resizedMessage(before: WidgetGrid, after: WidgetGrid, id: WidgetId, enabled: Visibility, base?: WidgetGrid): string {
  const displaced = displacedNeighbours(before, after, id, enabled, base);
  return `${WIDGET_CATALOG[id].name} resized to ${sizeLabel(id, after.placements[id])}${displaced ? ` · ${displaced}` : ''}`;
}
