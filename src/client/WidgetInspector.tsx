import type { Settings, WidgetId } from '../shared/contracts';
import { useEffect, useRef } from 'react';
import {
  WIDGET_CATALOG,
  WIDGET_IDS,
  isActiveWidget,
  isFreeSize,
  placementLabel,
  widgetSizes,
  type WidgetSize,
  type WidgetSpan,
} from '../shared/widgets';
import { FreeSizeControls, RoomNotice } from './FreeSizeControls';
import { Icon } from './icons';
import type { RoomFix, RoomProblem } from './make-room';
import { WidgetPicker } from './WidgetPicker';
import { WIDGET_MODULES } from './widgets/registry';

export function WidgetInspector({
  settings,
  selected,
  onSelect,
  pickerOpen,
  onPicker,
  onAdd,
  onFix,
  roomProblem,
  remindersHidden,
  onRemove,
  onResize,
  onResizeSpan,
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
  /** Adds a widget as a draft; returns the no-room explanation when it does not fit. */
  onAdd: (id: WidgetId, size: WidgetSize) => RoomProblem | null;
  /** Applies a no-room fix (an add or a resize); returns a fresh explanation if it no longer fits. */
  onFix: (problem: RoomProblem, fix: RoomFix) => RoomProblem | null;
  /** The current no-room explanation for a resize, shown with that widget's size controls. */
  roomProblem: RoomProblem | null;
  /** The display would hide Reminders right now (#233): enabled, Hide when empty and nothing pending. */
  remindersHidden: boolean;
  onRemove: (id: WidgetId) => void;
  onResize: (id: WidgetId, size: WidgetSize) => void;
  onResizeSpan: (id: WidgetId, span: WidgetSpan) => void;
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
        onFix={onFix}
        onClose={() => onPicker(false)}
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
            ModuleSettings = WIDGET_MODULES[id].Settings,
            problem = roomProblem && roomProblem.request.kind !== 'add' && roomProblem.request.id === id ? roomProblem : null;
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
                  <span className="widget-row-copy"><span>{widget.name}</span><small>{placementLabel(id, placement, settings.widgetGrid.density)}{id === 'reminders' && remindersHidden ? ' · Hidden when empty' : ''}</small></span>
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
                  {isFreeSize(id) ? (
                    <FreeSizeControls id={id} settings={settings} onResize={onResize} onResizeSpan={onResizeSpan} problem={problem} onFix={onFix} />
                  ) : <><div className="size-options">
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
                  </div><RoomNotice problem={problem} onFix={onFix} /></>}
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
                        <output aria-hidden="true">
                          {Math.round(settings.preview.opacity * 100)}%
                        </output>
                      </span>
                      <input
                        className="range-input"
                        type="range"
                        aria-label="Snapshot opacity"
                        aria-valuetext={`${Math.round(settings.preview.opacity * 100)}%`}
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
