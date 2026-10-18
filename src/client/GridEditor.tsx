import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type {
  Settings,
  WidgetGrid,
  WidgetId,
  WidgetPlacement,
} from '../shared/contracts';
import {
  GRID_DENSITIES,
  WIDGET_CATALOG,
  WIDGET_IDS,
  placeWidget,
  widgetSpan,
  widgetSizes,
} from '../shared/widgets';
import { same } from './draft';

interface Drag {
  id: WidgetId;
  mode: 'move' | 'resize';
  pointerId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  grid: WidgetGrid;
  candidate: WidgetPlacement;
  valid: boolean;
  target: HTMLElement;
}
export function GridEditor({
  settings,
  selected,
  onSelect,
  onPreview,
  onCommit,
  onMessage,
}: {
  settings: Settings;
  selected: WidgetId | null;
  onSelect: (id: WidgetId) => void;
  onPreview: (grid: WidgetGrid | null) => void;
  onCommit: (grid: WidgetGrid) => void;
  onMessage: (message: string) => void;
}) {
  const plane = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null);
  const latest = useRef(settings);
  latest.current = settings;
  const [ghost, setGhost] = useState<{
    id: WidgetId;
    placement: WidgetPlacement;
    valid: boolean;
  } | null>(null);
  const dimensions = GRID_DENSITIES[settings.widgetGrid.density];
  function finish(commit: boolean) {
    const active = drag.current;
    drag.current = null;
    setGhost(null);
    onPreview(null);
    if (!active) return;
    if (active.target.hasPointerCapture(active.pointerId))
      active.target.releasePointerCapture(active.pointerId);
    const current = latest.current;
    const next =
      active.valid &&
      current.widgets[active.id] &&
      current.widgetGrid.density === active.grid.density
        ? placeWidget(
            current.widgetGrid,
            active.id,
            active.candidate,
            current.widgets,
          )
        : null;
    if (commit && next && !same(next, current.widgetGrid)) {
      onCommit(next);
      onMessage(
        `${WIDGET_CATALOG[active.id].name} ${active.mode === 'move' ? 'moved' : 'resized'}`,
      );
    } else if (commit && !next)
      onMessage(active.valid ? 'Layout changed. Try again.' : 'No room there');
  }
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault();
        finish(false);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('keydown', cancel);
      if (drag.current) onPreview(null);
    };
  }, []);
  function start(
    event: React.PointerEvent<HTMLButtonElement>,
    id: WidgetId,
    mode: Drag['mode'],
  ) {
    if (event.button !== 0 || !plane.current) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(id);
    onMessage('');
    event.currentTarget.focus();
    const rect = plane.current.getBoundingClientRect();
    drag.current = {
      id,
      mode,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      grid: structuredClone(settings.widgetGrid),
      candidate: { ...settings.widgetGrid.placements[id] },
      valid: true,
      target: event.currentTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: React.PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (latest.current.widgetGrid.density !== active.grid.density) {
      finish(false);
      onMessage('Layout changed. Try again.');
      return;
    }
    const original = active.grid.placements[active.id];
    const dx = Math.round(
        ((event.clientX - active.x) / active.width) * dimensions.columns,
      ),
      dy = Math.round(
        ((event.clientY - active.y) / active.height) * dimensions.rows,
      );
    let candidate: WidgetPlacement = {
      ...original,
      column: original.column + dx,
      row: original.row + dy,
    };
    if (active.mode === 'resize') {
      const span = widgetSpan(active.id, original.size),
        width = span.columns + dx,
        height = span.rows + dy;
      const size = widgetSizes(active.id).sort((a, b) => {
        const x = widgetSpan(active.id, a),
          y = widgetSpan(active.id, b);
        return (
          (x.columns - width) ** 2 +
          (x.rows - height) ** 2 -
          ((y.columns - width) ** 2 + (y.rows - height) ** 2)
        );
      })[0];
      candidate = { ...original, size };
    }
    const next = placeWidget(
      latest.current.widgetGrid,
      active.id,
      candidate,
      latest.current.widgets,
    );
    active.candidate = candidate;
    active.valid = !!next;
    setGhost({ id: active.id, placement: candidate, valid: !!next });
    onPreview(next ?? latest.current.widgetGrid);
  }
  function keyboard(
    event: React.KeyboardEvent<HTMLButtonElement>,
    id: WidgetId,
    resize = false,
  ) {
    if (
      !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
    )
      return;
    event.preventDefault();
    onSelect(id);
    const original = settings.widgetGrid.placements[id];
    let candidate = { ...original };
    if (resize) {
      const families = widgetSizes(id),
        index = families.indexOf(original.size),
        direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
      candidate.size =
        families[Math.max(0, Math.min(families.length - 1, index + direction))];
    } else {
      candidate.column +=
        event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      candidate.row +=
        event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    }
    const next = placeWidget(
      settings.widgetGrid,
      id,
      candidate,
      settings.widgets,
    );
    if (next) {
      onCommit(next);
      onMessage(`${WIDGET_CATALOG[id].name} ${resize ? 'resized' : 'moved'}`);
    } else onMessage('No room there');
  }
  function rect(id: WidgetId, placement: WidgetPlacement): CSSProperties {
    const span = widgetSpan(id, placement.size);
    return {
      left: `${(placement.column / dimensions.columns) * 100}%`,
      top: `${(placement.row / dimensions.rows) * 100}%`,
      width: `${(span.columns / dimensions.columns) * 100}%`,
      height: `${(span.rows / dimensions.rows) * 100}%`,
    };
  }
  return (
    <div
      ref={plane}
      className="widget-grid-plane grid-editor"
      aria-label="Editable widget grid"
      style={
        {
          '--grid-columns': dimensions.columns,
          '--grid-rows': dimensions.rows,
        } as CSSProperties
      }
    >
      <p className="sr-only" id="grid-keyboard-help">
        Use arrow keys to move a widget. Use its resize handle or size buttons
        to resize. Escape cancels a drag.
      </p>
      {WIDGET_IDS.filter((id) => settings.widgets[id]).map((id) => {
        const placement =
          ghost?.id === id
            ? ghost.placement
            : settings.widgetGrid.placements[id];
        return (
          <div
            key={id}
            className={`grid-widget-frame ${selected === id ? 'selected' : ''} ${ghost?.id === id && !ghost.valid ? 'invalid' : ''}`}
            style={rect(id, placement)}
          >
            <button
              className="grid-drag-target"
              aria-label={`Move ${WIDGET_CATALOG[id].name}`}
              aria-describedby="grid-keyboard-help"
              onPointerDown={(event) => start(event, id, 'move')}
              onPointerMove={move}
              onPointerUp={() => finish(true)}
              onPointerCancel={() => finish(false)}
              onLostPointerCapture={() => {
                if (drag.current) finish(false);
              }}
              onKeyDown={(event) => keyboard(event, id)}
              onClick={() => onSelect(id)}
            >
              <span>{WIDGET_CATALOG[id].name}</span>
            </button>
            <button
              className="grid-resize-handle"
              aria-label={`Resize ${WIDGET_CATALOG[id].name}`}
              aria-describedby="grid-keyboard-help"
              onPointerDown={(event) => start(event, id, 'resize')}
              onPointerMove={move}
              onPointerUp={() => finish(true)}
              onPointerCancel={() => finish(false)}
              onLostPointerCapture={() => {
                if (drag.current) finish(false);
              }}
              onKeyDown={(event) => keyboard(event, id, true)}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="m5 13 8-8m-3 8 3-3" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
