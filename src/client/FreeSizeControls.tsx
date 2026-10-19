import { useId, useMemo } from 'react';
import type { Settings, WidgetId } from '../shared/contracts';
import {
  GRID_DENSITIES,
  WIDGET_CATALOG,
  freeSpanLimits,
  placementSpan,
  widgetSizes,
  type WidgetSize,
  type WidgetSpan,
} from '../shared/widgets';
import { fulfilRequest, roomFixLabel, type RoomFix, type RoomProblem, type RoomRequest } from './make-room';
import { WIDGET_MODULES } from './widgets/registry';

/**
 * The single live region for a size with no room (#183, #238): what takes the space and, when one
 * exists, a draft fix such as “Make room: Weather medium”. Always mounted so its text is announced.
 */
export function RoomNotice({ problem, onFix }: { problem: RoomProblem | null; onFix: (problem: RoomProblem, fix: RoomFix) => void }) {
  return (
    <div className="room-notice" data-empty={problem ? undefined : ''}>
      <p className="room-message" role="status">{problem?.message ?? ''}</p>
      {problem && problem.fixes.length > 0 && (
        <div className="room-fixes">
          {problem.fixes.map((fix) => (
            <button key={roomFixLabel(fix)} type="button" className="button small room-fix" onClick={() => onFix(problem, fix)}>
              {roomFixLabel(fix)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Size control for a free-size widget (#73): family presets plus Column, then whole-cell Width and
 * Height steppers. Every change goes through the editor's draft handlers. A preset the current board
 * cannot fit stays focusable but is `aria-disabled` with the reason (#183); choosing it explains what
 * takes the space and offers a draft fix.
 */
export function FreeSizeControls({
  id,
  settings,
  onResize,
  onResizeSpan,
  problem,
  onFix,
}: {
  id: WidgetId;
  settings: Settings;
  onResize: (id: WidgetId, size: WidgetSize) => void;
  onResizeSpan: (id: WidgetId, span: WidgetSpan) => void;
  /** The current no-room explanation for this widget, if any. */
  problem: RoomProblem | null;
  onFix: (problem: RoomProblem, fix: RoomFix) => void;
}) {
  const reasonId = useId();
  const { density } = settings.widgetGrid,
    limits = freeSpanLimits(id, density);
  const grid = settings.widgetGrid, enabled = settings.widgets;
  const name = WIDGET_CATALOG[id].name,
    hint = WIDGET_MODULES[id].sizeHint,
    placement = grid.placements[id],
    rows = GRID_DENSITIES[density].rows,
    column = !!placement.span && placement.span.columns === 2 && placement.span.rows === rows;
  const presets: { key: string; label: string; pressed: boolean; request: RoomRequest; choose: () => void }[] = [
    ...widgetSizes(id).map((size) => ({
      key: size,
      label: size[0]!.toUpperCase() + size.slice(1),
      pressed: !placement.span && placement.size === size,
      request: { kind: 'family', id, size } as RoomRequest,
      choose: () => onResize(id, size),
    })),
    { key: 'column', label: 'Column', pressed: column, request: { kind: 'span', id, span: { columns: 2, rows } }, choose: () => onResizeSpan(id, { columns: 2, rows }) },
  ];
  // Which presets fit this board right now; the shared helpers decide, so the answer matches a click.
  const fits = useMemo(
    () => presets.map((preset) => preset.pressed || !!fulfilRequest(grid, preset.request, enabled)),
    [grid, enabled, id],
  );
  if (!limits) return null;
  const span = placementSpan(id, placement);
  const unavailable = presets.filter((_, index) => !fits[index]).map((preset) => preset.label);
  const step = (columns: number, rows: number) => onResizeSpan(id, { columns: span.columns + columns, rows: span.rows + rows });
  // aria-disabled keeps focus on a stepper that reaches its limit, so repeated presses stay put.
  const guard = (atLimit: boolean, action: () => void) => ({ 'aria-disabled': atLimit, onClick: () => { if (!atLimit) action(); } });
  return (
    <div className="free-size-controls">
      <div className="size-options free-size-presets">
        {presets.map((preset, index) => (
          <button
            key={preset.key}
            className="button small"
            aria-label={`${name} size ${preset.key}`}
            aria-pressed={preset.pressed}
            aria-disabled={fits[index] ? undefined : true}
            aria-describedby={fits[index] ? undefined : reasonId}
            onClick={preset.choose}
          >
            {preset.label}
          </button>
        ))}
      </div>
      {unavailable.length > 0 && (
        <p className="free-size-unavailable" id={reasonId} hidden={!!problem}>
          {unavailable.length > 1 ? `${unavailable.slice(0, -1).join(', ')} and ${unavailable.at(-1)} need` : `${unavailable[0]} needs`} more room on this board.
        </p>
      )}
      <RoomNotice problem={problem} onFix={onFix} />
      <span className="field-label free-size-heading">Custom size</span>
      <div className="free-size-steppers">
        <div className="free-size-stepper" role="group" aria-label={`${name} width`}>
          <span className="free-size-axis">Width</span>
          <button className="icon-button free-size-step" aria-label="Narrower" {...guard(span.columns <= limits.min.columns, () => step(-1, 0))}>
            <span aria-hidden="true">−</span>
          </button>
          <output aria-live="polite">{span.columns} columns</output>
          <button className="icon-button free-size-step" aria-label="Wider" {...guard(span.columns >= limits.max.columns, () => step(1, 0))}>
            <span aria-hidden="true">+</span>
          </button>
        </div>
        <div className="free-size-stepper" role="group" aria-label={`${name} height`}>
          <span className="free-size-axis">Height</span>
          <button className="icon-button free-size-step" aria-label="Shorter" {...guard(span.rows <= limits.min.rows, () => step(0, -1))}>
            <span aria-hidden="true">−</span>
          </button>
          <output aria-live="polite">{span.rows} rows</output>
          <button className="icon-button free-size-step" aria-label="Taller" {...guard(span.rows >= limits.max.rows, () => step(0, 1))}>
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </div>
      {hint && <p className="hint free-size-hint">{hint}</p>}
    </div>
  );
}
