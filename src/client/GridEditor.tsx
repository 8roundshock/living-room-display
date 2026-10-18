import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Settings, WidgetGrid, WidgetId, WidgetPlacement } from '../shared/contracts';
import { GRID_DENSITIES, WIDGET_CATALOG, WIDGET_IDS, familyForSpan, fitWidgetFamily, freeSpanLimits, getWidgetRect, isFreeSize, normalizePlacement, placementSpan, reflowWidget, resizeWidgetSpan, widgetSpan, widgetSizes, type WidgetSpan } from '../shared/widgets';
import { same } from './draft';

export interface GridGesture { id: WidgetId; x: number; y: number; width?: number; height?: number }
interface Drag {
  id: WidgetId; mode: 'move' | 'resize'; pointerId: number;
  startX: number; startY: number; gripX: number; gripY: number;
  grid: WidgetGrid; candidate: WidgetPlacement; valid: boolean; target: HTMLButtonElement;
}
interface Preview { grid: WidgetGrid; candidate: WidgetPlacement; gesture: GridGesture; valid: boolean }
/** Free-size widgets announce their cells; family widgets keep the short message. */
function resizedMessage(id: WidgetId, placement: WidgetPlacement): string {
  const name = WIDGET_CATALOG[id].name;
  if (!isFreeSize(id)) return `${name} resized`;
  const span = placementSpan(id, placement);
  return `${name} resized to ${span.columns} × ${span.rows}`;
}
export function GridEditor({ settings, selected, onSelect, onPreview, onCommit, onMessage }: {
  settings: Settings; selected: WidgetId | null; onSelect: (id: WidgetId) => void;
  onPreview: (grid: WidgetGrid | null, gesture?: GridGesture | null) => void;
  onCommit: (grid: WidgetGrid) => void; onMessage: (message: string) => void;
}) {
  const plane = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null), latest = useRef(settings), interaction = useRef<Preview | null>(null);
  latest.current = settings;
  const [preview, setPreview] = useState<Preview | null>(null);
  const dimensions = GRID_DENSITIES[settings.widgetGrid.density];
  function finish(commit: boolean) {
    const active = drag.current; drag.current = null;
    interaction.current = null; setPreview(null); onPreview(null, null);
    if (!active) return;
    if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
    const current = latest.current;
    const next = active.valid && current.widgets[active.id] && current.widgetGrid.density === active.grid.density
      ? reflowWidget(current.widgetGrid, active.id, active.candidate, current.widgets) : null;
    if (commit && next && !same(next, current.widgetGrid)) {
      onCommit(next);
      onMessage(active.mode === 'move' ? `${WIDGET_CATALOG[active.id].name} moved` : resizedMessage(active.id, next.placements[active.id]));
    } else if (commit && !next) onMessage(active.valid ? 'Layout changed. Try again.' : 'No room for that size');
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
      const next = reflowWidget(settings.widgetGrid, active.id, active.candidate, settings.widgets), grid = next ?? settings.widgetGrid;
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
      grid: structuredClone(settings.widgetGrid), candidate: { ...original }, valid: true, target: event.currentTarget };
    event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(id); onMessage('');
  }
  function move(event: React.PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId || !plane.current) return;
    const current = latest.current;
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
    const next = reflowWidget(current.widgetGrid, active.id, candidate, current.widgets), grid = next ?? current.widgetGrid;
    const snapped = grid.placements[active.id];
    const gesture: GridGesture = { id: active.id, x: left - snapped.column * cellWidth, y: top - snapped.row * cellHeight,
      ...(active.mode === 'resize' ? { width, height } : {}) };
    if (active.mode === 'resize' && active.valid !== !!next) onMessage(next ? '' : 'No room for that size');
    active.candidate = candidate; active.valid = !!next;
    interaction.current = { grid, candidate, gesture, valid: !!next }; setPreview(interaction.current); onPreview(grid, gesture);
  }
  function keyboard(event: React.KeyboardEvent<HTMLButtonElement>, id: WidgetId, resize = false) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); onSelect(id);
    const original = settings.widgetGrid.placements[id], candidate = { ...original };
    const limits = resize ? freeSpanLimits(id, settings.widgetGrid.density) : null;
    if (limits) {
      // Free size (#73): Right/Left change width by one column, Down/Up change height by one row.
      const span = placementSpan(id, original), name = WIDGET_CATALOG[id].name;
      const next = { columns: span.columns + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0), rows: span.rows + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0) };
      const limit = next.columns > limits.max.columns ? 'wider' : next.columns < limits.min.columns ? 'narrower' : next.rows > limits.max.rows ? 'taller' : next.rows < limits.min.rows ? 'shorter' : null;
      if (limit) { onMessage(`${name} cannot get any ${limit}`); return; }
      const grid = resizeWidgetSpan(settings.widgetGrid, id, next, settings.widgets);
      if (grid) { onCommit(grid); onMessage(resizedMessage(id, grid.placements[id])); }
      else onMessage('No room for that size');
      return;
    }
    if (resize) {
      const families = widgetSizes(id), direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
      candidate.size = families[Math.max(0, Math.min(families.length - 1, families.indexOf(original.size) + direction))]!;
    } else {
      candidate.column += event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      candidate.row += event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    }
    const next = resize ? fitWidgetFamily(settings.widgetGrid, id, candidate.size, settings.widgets) : reflowWidget(settings.widgetGrid, id, candidate, settings.widgets);
    if (next) { onCommit(next); onMessage(`${WIDGET_CATALOG[id].name} ${resize ? 'resized' : 'moved'}`); }
    else onMessage('No room there');
  }
  function rect(grid: WidgetGrid, id: WidgetId, placement = grid.placements[id]): CSSProperties {
    const r = getWidgetRect(grid, id, placement);
    return { left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%` };
  }
  const visibleGrid = preview?.grid ?? settings.widgetGrid;
  return <div ref={plane} className={`widget-grid-plane grid-editor ${preview ? 'dragging' : ''}`} aria-label="Editable widget grid"
    style={{ '--grid-columns': dimensions.columns, '--grid-rows': dimensions.rows } as CSSProperties}>
    <p className="sr-only" id="grid-keyboard-help">Use arrow keys to move a widget. Focus its resize handle and use arrow keys to resize; Reminders changes width with left and right and height with up and down. Escape cancels a drag.</p>
    {preview?.valid && <div className="grid-drop-placeholder" aria-hidden="true" style={rect(visibleGrid, preview.gesture.id)} />}
    {WIDGET_IDS.filter(id => settings.widgets[id]).map(id => {
      const active = preview?.gesture.id === id ? preview : null, style = rect(visibleGrid, id);
      if (active) Object.assign(style, { transform: `translate3d(${active.gesture.x}px, ${active.gesture.y}px, 0)`,
        ...(active.gesture.width !== undefined ? { width: active.gesture.width, height: active.gesture.height } : {}) });
      const handlers = { onPointerMove: move, onPointerUp: () => finish(true), onPointerCancel: () => finish(false), onLostPointerCapture: () => { if (drag.current) finish(false); } };
      const cells = placementSpan(id, visibleGrid.placements[id]);
      return <div key={id} className={`grid-widget-frame ${selected === id ? 'selected' : ''} ${active ? 'active-drag' : ''} ${active && !active.valid ? 'invalid' : ''} ${isFreeSize(id) ? 'free-size' : ''}`} style={style}
        data-frame-id={id} data-frame-span={`${cells.columns}x${cells.rows}`}>
        <button className="grid-drag-target" aria-label={`Move ${WIDGET_CATALOG[id].name}`} aria-describedby="grid-keyboard-help"
          onPointerDown={event => start(event, id, 'move')} {...handlers} onKeyDown={event => keyboard(event, id)} onFocus={() => onSelect(id)} onClick={() => onSelect(id)}>
          <span>{WIDGET_CATALOG[id].name}</span>
        </button>
        <button className="grid-resize-handle" aria-label={`Resize ${WIDGET_CATALOG[id].name}`} aria-describedby="grid-keyboard-help"
          onPointerDown={event => start(event, id, 'resize')} {...handlers} onKeyDown={event => keyboard(event, id, true)}>
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m5 13 8-8m-3 8 3-3" /></svg>
        </button>
      </div>;
    })}
  </div>;
}
