import { useEffect, useRef, useState } from 'react';
import type { Settings, WidgetId } from '../shared/contracts';
import {
  WIDGET_CATALOG,
  WIDGET_IDS,
  widgetSizes,
  widgetSpan,
  widgetContentLimits,
  type WidgetSize,
} from '../shared/widgets';
import { Icon } from './icons';

/** Synthetic gallery examples, never the user's reminders, photo or location. */
function FamilyPreview({ id, size }: { id: WidgetId; size: WidgetSize }) {
  const count = widgetContentLimits(size);
  return (
    <span className={`family-example family-example-${id}`} aria-hidden="true">
      {id === 'clock' ? (
        <>
          <small>MONDAY</small>
          <strong>9:41</strong>
          {size !== 'small' && <small>October 18</small>}
        </>
      ) : id === 'weather' ? (
        <>
          <Icon name="sun" size={15} />
          <strong>14°</strong>
          {size !== 'small' && <small>Clear skies</small>}
        </>
      ) : id === 'rain' ? (
        <>
          <small>RAIN</small>
          <strong>30%</strong>
          {size !== 'small' && (
            <span className="mini-rain">
              {[2, 4, 7, 5, 3, 1].map((h, i) => (
                <i key={i} style={{ height: `${h + 2}px` }} />
              ))}
            </span>
          )}
        </>
      ) : id === 'forecast' ? (
        <span className="mini-forecast">
          {Array.from({ length: count.forecastDays }, (_, i) => (
            <span key={i}>
              <small>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</small>
              <Icon name={i % 2 ? 'cloud' : 'sun'} size={10} />
              <small>{17 + i}°</small>
            </span>
          ))}
        </span>
      ) : id === 'reminders' ? (
        <>
          <small>REMINDERS</small>
          {Array.from({ length: count.reminders }, (_, i) => (
            <span className="mini-reminder" key={i}>
              <i />
              <b style={{ width: `${26 + (i % 2) * 11}px` }} />
            </span>
          ))}
        </>
      ) : id === 'photo' ? (
        <span className="mini-landscape">
          <Icon name="photo" size={22} />
        </span>
      ) : id === 'preview' ? (
        <span className="mini-desktop">
          <i />
          <i />
          <i />
        </span>
      ) : (
        <Icon name="plus" size={20} />
      )}
    </span>
  );
}

export function WidgetPicker({
  settings,
  onAdd,
  onClose,
  message,
}: {
  settings: Settings;
  onAdd: (id: WidgetId, size: WidgetSize) => void;
  onClose: () => void;
  message: string;
}) {
  const [sizes, setSizes] = useState<Partial<Record<WidgetId, WidgetSize>>>({});
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);
  return (
    <div className="widget-picker">
      <div className="panel-heading">
        <h2>Add a widget</h2>
        <button
          className="icon-button"
          aria-label="Close widget picker"
          ref={close}
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      {message && (
        <p className="inline-message" role="status">
          {message}
        </p>
      )}
      {WIDGET_IDS.map((id) => {
        const widget = WIDGET_CATALOG[id],
          size = sizes[id] ?? widget.defaultSize;
        return (
          <section key={id} className="picker-card">
            <div className="picker-card-heading">
              <span className="widget-icon">
                <Icon name={widget.icon} size={20} />
              </span>
              <div>
                <h3>{widget.name}</h3>
                <p>{widget.description}</p>
              </div>
              <button
                className="button small"
                disabled={settings.widgets[id]}
                aria-label={`Add ${widget.name}`}
                onClick={() => onAdd(id, size)}
              >
                {settings.widgets[id] ? 'Added' : 'Add'}
              </button>
            </div>
            <div className="family-previews" aria-label={`${widget.name} size`}>
              {widgetSizes(id).map((family) => {
                const span = widgetSpan(id, family);
                return (
                  <button
                    key={family}
                    aria-label={`${widget.name} ${family}`}
                    aria-pressed={size === family}
                    onClick={() =>
                      setSizes((previous) => ({ ...previous, [id]: family }))
                    }
                  >
                    <span
                      className="family-preview-surface"
                      style={{ aspectRatio: `${span.columns}/${span.rows}` }}
                    >
                      <FamilyPreview id={id} size={family} />
                    </span>
                    <span>{family[0].toUpperCase() + family.slice(1)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
