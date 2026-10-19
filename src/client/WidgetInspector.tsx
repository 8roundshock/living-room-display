import type { Settings, WidgetId } from '../shared/contracts';
import { useEffect, useRef } from 'react';
import {
  WIDGET_CATALOG,
  WIDGET_IDS,
  isActiveWidget,
  widgetSizes,
  type WidgetSize,
} from '../shared/widgets';
import { Icon } from './icons';
import { WidgetPicker } from './WidgetPicker';
import { WIDGET_MODULES } from './widgets/registry';

export function WidgetInspector({
  settings,
  selected,
  onSelect,
  pickerOpen,
  onPicker,
  onAdd,
  onRemove,
  onResize,
  onChange,
  photoAvailable,
  photoBusy,
  onPhotoFile,
  onPhotoClear,
  onPhotoCancel,
  saving,
  message,
}: {
  settings: Settings;
  selected: WidgetId | null;
  onSelect: (id: WidgetId | null) => void;
  pickerOpen: boolean;
  onPicker: (open: boolean) => void;
  onAdd: (id: WidgetId, size: WidgetSize) => void;
  onRemove: (id: WidgetId) => void;
  onResize: (id: WidgetId, size: WidgetSize) => void;
  onMove: (id: WidgetId, dx: number, dy: number) => void;
  onChange: (update: (settings: Settings) => Settings) => void;
  photoAvailable: boolean;
  photoBusy: boolean;
  onPhotoFile: (file: File) => void;
  onPhotoClear: () => void;
  onPhotoCancel: () => void;
  saving: boolean;
  message: string;
}) {
  const addButton = useRef<HTMLButtonElement>(null),
    wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !pickerOpen) addButton.current?.focus();
    wasOpen.current = pickerOpen;
  }, [pickerOpen]);
  if (pickerOpen)
    return (
      <WidgetPicker
        settings={settings}
        onAdd={onAdd}
        onClose={() => onPicker(false)}
        message={message}
      />
    );
  return (
    <>
      <div className="panel-heading">
        <h2>Widgets</h2>
        <button
          ref={addButton}
          className="icon-button add-widget"
          aria-label="Add widget"
          title="Add widget"
          onClick={() => onPicker(true)}
        >
          <Icon name="plus" size={20} />
        </button>
      </div>
      {!WIDGET_IDS.some((id) => isActiveWidget(id) && settings.widgets[id]) && (
        <div className="empty-reminders">
          <span>
            <Icon name="plus" size={24} />
          </span>
          <h3>A blank canvas</h3>
          <button className="text-button" onClick={() => onPicker(true)}>
            Choose a widget
          </button>
        </div>
      )}
      <div className="widget-list">
        {message && (
          <p className="inline-message" role="status">
            {message}
          </p>
        )}
        {WIDGET_IDS.filter((id) => isActiveWidget(id) && settings.widgets[id]).map((id) => {
          const widget = WIDGET_CATALOG[id],
            placement = settings.widgetGrid.placements[id],
            ModuleSettings = WIDGET_MODULES[id].Settings;
          return (
            <div
              key={id}
              className={`widget-option ${selected === id ? 'selected' : ''}`}
            >
              <div className="widget-row">
                <button
                  className="widget-select"
                  aria-label={widget.name}
                  aria-expanded={selected === id}
                  onClick={() => onSelect(selected === id ? null : id)}
                >
                  <span className="widget-icon">
                    <Icon name={widget.icon} size={18} />
                  </span>
                  <span className="widget-row-copy"><span>{widget.name}</span><small>{placement.size[0].toUpperCase() + placement.size.slice(1)}</small></span>
                  <span aria-hidden="true" className="row-chevron">
                    ›
                  </span>
                </button>
                <button
                  className="icon-button widget-remove"
                  aria-label={`Remove ${widget.name}`}
                  onClick={() => onRemove(id)}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
              {selected === id && (
                <div className="widget-inspector">
                  <span className="field-label">Size</span>
                  <div className="size-options">
                    {widgetSizes(id).map((size) => (
                      <button
                        key={size}
                        className="button small"
                        aria-label={`${widget.name} size ${size}`}
                        aria-pressed={placement.size === size}
                        onClick={() => onResize(id, size)}
                      >
                        {size[0].toUpperCase() + size.slice(1)}
                      </button>
                    ))}
                  </div>
                  {id === 'clock' && (
                    <>
                      <span className="field-label">Clock style</span>
                      <div className="clock-style-options">
                        {(['outline', 'digital', 'analog'] as const).map(
                          (style) => (
                            <button
                              key={style}
                              className={`clock-style-card ${style}`}
                              aria-pressed={
                                settings.appearance.clockStyle === style
                              }
                              aria-label={
                                style[0].toUpperCase() + style.slice(1)
                              }
                              onClick={() =>
                                onChange((previous) => ({
                                  ...previous,
                                  appearance: {
                                    ...previous.appearance,
                                    clockStyle: style,
                                    preset: 'custom',
                                  },
                                }))
                              }
                            >
                              <span
                                aria-hidden="true"
                                className="clock-style-example"
                              >
                                {style === 'analog' ? (
                                  <svg viewBox="0 0 40 40">
                                    <path d="M20 7v13l10 5" />
                                    <circle cx="20" cy="20" r="1.5" />
                                  </svg>
                                ) : (
                                  '9:41'
                                )}
                              </span>
                              <span>
                                {style[0].toUpperCase() + style.slice(1)}
                              </span>
                            </button>
                          ),
                        )}
                      </div>
                      <label>
                        <span className="field-label">Time format</span>
                        <select
                          className="select-input"
                          value={settings.clockFormat}
                          onChange={(event) =>
                            onChange((previous) => ({
                              ...previous,
                              clockFormat: event.target
                                .value as Settings['clockFormat'],
                            }))
                          }
                        >
                          <option value="12h">12-hour</option>
                          <option value="24h">24-hour</option>
                        </select>
                      </label>
                    </>
                  )}
                  {id === 'reminders' && (
                    <label className="toggle-row">
                      <span>Hide when empty</span>
                      <input
                        className="toggle"
                        type="checkbox"
                        checked={
                          settings.widgetBehavior.reminders.hideWhenEmpty
                        }
                        onChange={(event) =>
                          onChange((previous) => ({
                            ...previous,
                            widgetBehavior: {
                              reminders: {
                                hideWhenEmpty: event.target.checked,
                              },
                            },
                          }))
                        }
                      />
                    </label>
                  )}
                  {id === 'preview' && (
                    <label className="control-block">
                      <span className="control-label">
                        Snapshot opacity
                        <output>
                          {Math.round(settings.preview.opacity * 100)}%
                        </output>
                      </span>
                      <input
                        className="range-input"
                        type="range"
                        aria-label="Snapshot opacity"
                        min={2}
                        max={30}
                        value={Math.round(settings.preview.opacity * 100)}
                        onChange={(event) =>
                          onChange((previous) => ({
                            ...previous,
                            preview: {
                              ...previous.preview,
                              opacity: Number(event.target.value) / 100,
                            },
                          }))
                        }
                      />
                    </label>
                  )}
                  {id === 'photo' && (
                    <div className="photo-controls">
                      <label
                        className={`button photo-upload-control ${saving || photoBusy ? 'disabled' : ''}`}
                      >
                        <Icon name="photo" size={16} />
                        {photoBusy
                          ? 'Preparing…'
                          : photoAvailable
                            ? 'Replace photo'
                            : 'Choose photo'}
                        <input
                          className="sr-only"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          aria-label="Choose local photo"
                          disabled={saving || photoBusy}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file) onPhotoFile(file);
                          }}
                        />
                      </label>
                      {photoBusy && (
                        <button className="text-button" onClick={onPhotoCancel}>
                          Cancel photo
                        </button>
                      )}
                      {photoAvailable && (
                        <button
                          className="text-button"
                          disabled={saving || photoBusy}
                          onClick={onPhotoClear}
                        >
                          Clear photo
                        </button>
                      )}
                      <p className="hint">
                        Stored on this device. Excluded from exports.
                      </p>
                    </div>
                  )}
                  {ModuleSettings && (
                    <ModuleSettings
                      id={id}
                      settings={settings}
                      onChange={onChange}
                      saving={saving}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
