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
import { WIDGET_MODULES } from './widgets/registry';

/**
 * Size control for a free-size widget (#73): family presets plus Column, then whole-cell Width and
 * Height steppers. Every change goes through the editor's draft handlers.
 */
export function FreeSizeControls({
  id,
  settings,
  onResize,
  onResizeSpan,
}: {
  id: WidgetId;
  settings: Settings;
  onResize: (id: WidgetId, size: WidgetSize) => void;
  onResizeSpan: (id: WidgetId, span: WidgetSpan) => void;
}) {
  const { density } = settings.widgetGrid,
    limits = freeSpanLimits(id, density);
  if (!limits) return null;
  const name = WIDGET_CATALOG[id].name,
    hint = WIDGET_MODULES[id].sizeHint,
    placement = settings.widgetGrid.placements[id],
    span = placementSpan(id, placement),
    rows = GRID_DENSITIES[density].rows,
    column = !!placement.span && placement.span.columns === 2 && placement.span.rows === rows;
  const presets: { key: string; label: string; pressed: boolean; choose: () => void }[] = [
    ...widgetSizes(id).map((size) => ({
      key: size,
      label: size[0]!.toUpperCase() + size.slice(1),
      pressed: !placement.span && placement.size === size,
      choose: () => onResize(id, size),
    })),
    { key: 'column', label: 'Column', pressed: column, choose: () => onResizeSpan(id, { columns: 2, rows }) },
  ];
  const step = (columns: number, rows: number) => onResizeSpan(id, { columns: span.columns + columns, rows: span.rows + rows });
  // aria-disabled keeps focus on a stepper that reaches its limit, so repeated presses stay put.
  const guard = (atLimit: boolean, action: () => void) => ({ 'aria-disabled': atLimit, onClick: () => { if (!atLimit) action(); } });
  return (
    <div className="free-size-controls">
      <div className="size-options free-size-presets">
        {presets.map((preset) => (
          <button
            key={preset.key}
            className="button small"
            aria-label={`${name} size ${preset.key}`}
            aria-pressed={preset.pressed}
            onClick={preset.choose}
          >
            {preset.label}
          </button>
        ))}
      </div>
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
