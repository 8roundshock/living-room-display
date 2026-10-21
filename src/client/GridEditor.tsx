import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Settings, WidgetGrid, WidgetId, WidgetPlacement } from '../shared/contracts';
import { ACTIVE_WIDGET_IDS, GRID_DENSITIES, WIDGET_CATALOG, WIDGET_IDS, familyForSpan, fitWidgetFamily, freeSpanLimits, getWidgetRect, isFreeSize, normalizePlacement, placementSpan, reflowWidget, resizeWidgetSpan, widgetSpan, widgetSizes, type WidgetSpan } from '../shared/widgets';
import { same } from './draft';
import { placementDescription, refusedMove, type MoveDirection, type RoomRequest } from './make-room';

export interface GridGesture { id: WidgetId; x: number; y: number; width?: number; height?: number }
/** A committed canvas edit; the editor words the result (#341) and tracks resize explorations (#340). */
export interface LayoutEdit { kind: 'move' | 'resize'; id: WidgetId }
interface Drag {
  id: WidgetId; mode: 'move' | 'resize'; pointerId: number;
  startX: number; startY: number; gripX: number; gripY: number;
  grid: WidgetGrid; candidate: WidgetPlacement; valid: boolean; target: HTMLButtonElement;
  /** The pointer travelled far enough to be a drag rather than a tap. */
  moved: boolean;
}
interface Preview { grid: WidgetGrid; candidate: WidgetPlacement; gesture: GridGesture; valid: boolean }
const ARROWS: Record<string, MoveDirection> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
/** Keyboard help names the free-size widgets from the catalog (#73, #89). */
const FREE_SIZE_NAMES = ACTIVE_WIDGET_IDS.filter(isFreeSize).map(id => WIDGET_CATALOG[id].name);
const FREE_SIZE_HELP = FREE_SIZE_NAMES.length
  ? `; ${new Intl.ListFormat('en', { type: 'conjunction' }).format(FREE_SIZE_NAMES)} ${FREE_SIZE_NAMES.length === 1 ? 'changes' : 'change'} width with left and right and height with up and down`
  : '';
/** The size a resize asked for, as the room guidance describes it (#285). */
function resizeRequest(id: WidgetId, placement: WidgetPlacement): RoomRequest {
  return isFreeSize(id) ? { kind: 'span', id, span: placementSpan(id, placement) } : { kind: 'family', id, size: placement.size };
}
export function GridEditor({ settings, selected, onSelect, onPreview, onCommit, onNoRoom, onMessage, resizeBase }: {
  settings: Settings; selected: WidgetId | null;
  /**
   * `tapped` is true for a press released without dragging: only then may a stacked page scroll to
   * the widget's settings (#339). Presses that drag, focus and arrow keys keep the canvas in place.
   */
  onSelect: (id: WidgetId, tapped: boolean) => void;
  onPreview: (grid: WidgetGrid | null, gesture?: GridGesture | null) => void;
  onCommit: (grid: WidgetGrid, edit: LayoutEdit) => void;
  /** A resize ended without room; the editor explains it once, with its fix (#285). */
  onNoRoom: (request: RoomRequest, via: 'pointer' | 'keyboard') => void;
  /** Live feedback during a drag and refusals that need no explanation. */
  onMessage: (message: string) => void;
  /** The board a resize of this widget starts from: the exploration's base, else the draft (#340). */
  resizeBase: (id: WidgetId) => WidgetGrid;
}) {
  const plane = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null), latest = useRef(settings), interaction = useRef<Preview | null>(null);
  latest.current = settings;
  const [preview, setPreview] = useState<Preview | null>(null);
  // Frames inserted after the first render (a newly added widget) may drop in (#76 editor polish).
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);
  const dimensions = GRID_DENSITIES[settings.widgetGrid.density];
  /** Moves reflow the current draft; resizes start from the exploration's base (#340). */
  function board(active: Drag, current: Settings): WidgetGrid {
    return active.mode === 'resize' ? resizeBase(active.id) : current.widgetGrid;
  }
  function finish(commit: boolean) {
    const active = drag.current; drag.current = null;
    interaction.current = null; setPreview(null); onPreview(null, null);
    if (!active) return;
    if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
    if (!commit) return;
    if (!active.moved) onSelect(active.id, true);
    const current = latest.current;
    const unchanged = !!current.widgets[active.id] && current.widgetGrid.density === active.grid.density;
    const next = active.valid && unchanged ? reflowWidget(board(active, current), active.id, active.candidate, current.widgets) : null;
    if (next) { if (!same(next, current.widgetGrid)) onCommit(next, { kind: active.mode, id: active.id }); }
    else if (active.valid || !unchanged) onMessage('Layout changed. Try again.');
    else if (active.mode === 'resize') onNoRoom(resizeRequest(active.id, active.candidate), 'pointer');
    else onMessage(`No room for ${WIDGET_CATALOG[active.id].name} there`);
  }
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); finish(false); } };
    window.addEventListener('keydown', cancel);
    return () => { window.removeEventListener('keydown', cancel); if (drag.current) onPreview(null, null); };
  }, []);
  useEffect(() => {
    if (drag.current && (!settings.widgets[drag.current.id] || settings.widgetGrid.density !== drag.current.grid.density)) finish(false);
    else if (drag.current && interaction.current) {
      const active = drag.current, prior = interaction.current;
      const next = reflowWidget(board(active, settings), active.id, active.candidate, settings.widgets), grid = next ?? settings.widgetGrid;
      const rect = plane.current!.getBoundingClientRect();
      const old = prior.grid.placements[active.id], point = grid.placements[active.id];
      const gesture = { ...prior.gesture, x: prior.gesture.x + (old.column - point.column) * rect.width / dimensions.columns,
        y: prior.gesture.y + (old.row - point.row) * rect.height / dimensions.rows };
      active.valid = !!next; interaction.current = { ...prior, grid, gesture, valid: !!next };
      setPreview(interaction.current); onPreview(grid, gesture);
    }
  }, [settings.widgets, settings.widgetGrid]);
  function start(event: React.PointerEvent<HTMLButtonElement>, id: WidgetId, mode: Drag['mode']) {
    if (event.button !== 0 || !plane.current || drag.current) return;
    event.preventDefault(); event.stopPropagation();
    const rect = plane.current.getBoundingClientRect(), original = settings.widgetGrid.placements[id], span = placementSpan(id, original);
    const width = rect.width / dimensions.columns, height = rect.height / dimensions.rows;
    drag.current = { id, mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      gripX: (event.clientX - rect.left - original.column * width) / (span.columns * width),
      gripY: (event.clientY - rect.top - original.row * height) / (span.rows * height),
      grid: structuredClone(settings.widgetGrid), candidate: { ...original }, valid: true, target: event.currentTarget, moved: false };
    onSelect(id, false);
    event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
    onMessage('');
  }
  function move(event: React.PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId || !plane.current) return;
    const current = latest.current;
    if (Math.abs(event.clientX - active.startX) + Math.abs(event.clientY - active.startY) > 4) active.moved = true;
    if (current.widgetGrid.density !== active.grid.density) { finish(false); onMessage('Layout changed. Try again.'); return; }
    const rect = plane.current.getBoundingClientRect(), original = active.grid.placements[active.id], span = placementSpan(active.id, original);
    const cellWidth = rect.width / dimensions.columns, cellHeight = rect.height / dimensions.rows;
    let left = original.column * cellWidth, top = original.row * cellHeight;
    let width = span.columns * cellWidth, height = span.rows * cellHeight;
    let candidate: WidgetPlacement;
    const limits = freeSpanLimits(active.id, active.grid.density);
    if (active.mode === 'move') {
      left = Math.max(0, Math.min(rect.width - width, event.clientX - rect.left - active.gripX * width));
      top = Math.max(0, Math.min(rect.height - height, event.clientY - rect.top - active.gripY * height));
      candidate = { ...original, column: Math.round(left / cellWidth), row: Math.round(top / cellHeight) };
    } else if (limits) {
      // Free size (#73): follow the pointer within the widget's limits and the board edge, snapping to whole cells.
      const maxColumns = Math.min(limits.max.columns, dimensions.columns - original.column), maxRows = Math.min(limits.max.rows, dimensions.rows - original.row);
      width = Math.max(cellWidth * limits.min.columns, Math.min(cellWidth * maxColumns, width + event.clientX - active.startX));
      height = Math.max(cellHeight * limits.min.rows, Math.min(cellHeight * maxRows, height + event.clientY - active.startY));
      const next: WidgetSpan = { columns: Math.round(width / cellWidth), rows: Math.round(height / cellHeight) };
      const { span: _previous, ...base } = original;
      candidate = normalizePlacement(active.id, { ...base, size: familyForSpan(active.id, next), span: next });
    } else {
      width = Math.max(cellWidth * 2, Math.min(rect.width - left, width + event.clientX - active.startX));
      height = Math.max(cellHeight * 2, Math.min(rect.height - top, height + event.clientY - active.startY));
      const distance = (size: typeof original.size) => { const shape = widgetSpan(active.id, size); return (shape.columns * cellWidth - width) ** 2 + (shape.rows * cellHeight - height) ** 2; };
      const size = widgetSizes(active.id).sort((a, b) => distance(a) - distance(b))[0]!;
      candidate = { column: original.column, row: original.row, size };
    }
    const next = reflowWidget(board(active, current), active.id, candidate, current.widgets), grid = next ?? current.widgetGrid;
    const snapped = grid.placements[active.id];
    const gesture: GridGesture = { id: active.id, x: left - snapped.column * cellWidth, y: top - snapped.row * cellHeight,
      ...(active.mode === 'resize' ? { width, height } : {}) };
    // Live feedback only; the explanation and its fix are worked out once, when the drag ends (#285).
    if (active.mode === 'resize' && active.valid !== !!next) onMessage(next ? '' : 'No room for that size');
    active.candidate = candidate; active.valid = !!next;
    interaction.current = { grid, candidate, gesture, valid: !!next }; setPreview(interaction.current); onPreview(grid, gesture);
  }
  function keyboard(event: React.KeyboardEvent<HTMLButtonElement>, id: WidgetId, resize = false) {
    const direction = ARROWS[event.key];
    if (!direction) return;
    event.preventDefault(); onSelect(id, false);
    const original = settings.widgetGrid.placements[id], widgets = settings.widgets, name = WIDGET_CATALOG[id].name;
    const dx = direction === 'right' ? 1 : direction === 'left' ? -1 : 0, dy = direction === 'down' ? 1 : direction === 'up' ? -1 : 0;
    if (!resize) {
      const next = reflowWidget(settings.widgetGrid, id, { ...original, column: original.column + dx, row: original.row + dy }, widgets);
      if (next) onCommit(next, { kind: 'move', id });
      else onMessage(refusedMove(direction));
      return;
    }
    const limits = freeSpanLimits(id, settings.widgetGrid.density);
    if (limits) {
      // Free size (#73): Right/Left change width by one column, Down/Up change height by one row.
      const span = placementSpan(id, original), next = { columns: span.columns + dx, rows: span.rows + dy };
      const limit = next.columns > limits.max.columns ? 'wider' : next.columns < limits.min.columns ? 'narrower' : next.rows > limits.max.rows ? 'taller' : next.rows < limits.min.rows ? 'shorter' : null;
      if (limit) { onMessage(`${name} cannot get any ${limit}`); return; }
      const grid = resizeWidgetSpan(resizeBase(id), id, next, widgets);
      if (grid) onCommit(grid, { kind: 'resize', id });
      else onNoRoom({ kind: 'span', id, span: next }, 'keyboard');
      return;
    }
    // Families: Right and Down one larger, Left and Up one smaller.
    const families = widgetSizes(id), step = dx + dy > 0 ? 1 : -1, size = families[families.indexOf(original.size) + step];
    if (!size) { onMessage(`${name} cannot get any ${step > 0 ? 'larger' : 'smaller'}`); return; }
    const grid = fitWidgetFamily(resizeBase(id), id, size, widgets);
    if (grid) onCommit(grid, { kind: 'resize', id });
    else onNoRoom({ kind: 'family', id, size }, 'keyboard');
  }
  function rect(grid: WidgetGrid, id: WidgetId, placement = grid.placements[id]): CSSProperties {
    const r = getWidgetRect(grid, id, placement);
    return { left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%` };
  }
  const visibleGrid = preview?.grid ?? settings.widgetGrid;
  return <div ref={plane} className={`widget-grid-plane grid-editor ${preview ? 'dragging' : ''}`} aria-label="Editable widget grid" data-settled={settled ? 'true' : undefined}
    style={{ '--grid-columns': dimensions.columns, '--grid-rows': dimensions.rows } as CSSProperties}>
    <p className="sr-only" id="grid-keyboard-help">Use arrow keys to move a widget. Focus its resize handle and use arrow keys to resize{FREE_SIZE_HELP}. Escape cancels a drag.</p>
    {preview?.valid && <div className="grid-drop-placeholder" aria-hidden="true" style={rect(visibleGrid, preview.gesture.id)} />}
    {WIDGET_IDS.filter(id => settings.widgets[id]).map(id => {
      const active = preview?.gesture.id === id ? preview : null, style = rect(visibleGrid, id);
      if (active) Object.assign(style, { transform: `translate3d(${active.gesture.x}px, ${active.gesture.y}px, 0)`,
        ...(active.gesture.width !== undefined ? { width: active.gesture.width, height: active.gesture.height } : {}) });
      const handlers = { onPointerMove: move, onPointerUp: () => finish(true), onPointerCancel: () => finish(false), onLostPointerCapture: () => { if (drag.current) finish(false); } };
      const placement = visibleGrid.placements[id], cells = placementSpan(id, placement), name = WIDGET_CATALOG[id].name;
      // Each target is described by its place and size ("Column 9, row 5 · Medium") before the keyboard help (#341).
      const describedBy = `grid-position-${id} grid-keyboard-help`;
      // A frame on the canvas's right or bottom edge keeps its handle's hit area inside the canvas (#349).
      const edge = [placement.column + cells.columns >= dimensions.columns ? 'right' : '', placement.row + cells.rows >= dimensions.rows ? 'bottom' : ''].filter(Boolean).join(' ');
      return <div key={id} className={`grid-widget-frame ${selected === id ? 'selected' : ''} ${active ? 'active-drag' : ''} ${active && !active.valid ? 'invalid' : ''} ${isFreeSize(id) ? 'free-size' : ''}`} style={style}
        data-frame-id={id} data-frame-span={`${cells.columns}x${cells.rows}`} data-edge={edge || undefined}>
        <span hidden id={`grid-position-${id}`}>{placementDescription(id, placement)}</span>
        <button className="grid-drag-target" aria-label={`Move ${name}`} aria-describedby={describedBy}
          onPointerDown={event => start(event, id, 'move')} {...handlers} onKeyDown={event => keyboard(event, id)} onFocus={() => onSelect(id, false)}
          onClick={() => onSelect(id, false)}>
          <span>{name}</span>
        </button>
        <button className="grid-resize-handle" aria-label={`Resize ${name}`} aria-describedby={describedBy}
          onPointerDown={event => start(event, id, 'resize')} {...handlers} onKeyDown={event => keyboard(event, id, true)}>
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m5 13 8-8m-3 8 3-3" /></svg>
        </button>
      </div>;
    })}
  </div>;
}
