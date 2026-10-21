import type { Settings, WidgetGrid, WidgetId } from '../shared/contracts';
import { useEffect, useRef } from 'react';
import {
  WIDGET_CATALOG,
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
import { withAppearance } from './model';
import { WidgetPicker, pickerGroups } from './WidgetPicker';
import { WIDGET_MODULES } from './widgets/registry';

/**
 * The Widgets list order (#365): the picker's groups (Time, Weather & sky, Personal, Pictures) with
 * catalog order inside each, so related widgets sit together. Removal focus follows the same order.
 */
export function widgetListOrder(widgets: Partial<Record<WidgetId, boolean>>): WidgetId[] {
  return pickerGroups().flatMap((group) => group.ids).filter((id) => isActiveWidget(id) && widgets[id]);
}

/** What the inspector scrolls into view after a selection or a no-room explanation (#339, #285). */
export interface InspectorReveal {
  id: WidgetId;
  /** The selected widget's whole settings, or its no-room explanation. */
  target: 'option' | 'room';
  /**
   * Whether a stacked layout (≤700 px) may scroll the page: after a list row click, an add or a canvas
   * tap, not for a canvas drag or a canvas widget focused from the keyboard.
   */
  page: boolean;
}

// Reveals already used (#339): each one scrolls at most once, so closing the picker or coming back
// to the Widgets tab (which remounts this inspector) never replays an old selection's scroll and
// pushes the focused control out of view. Every request is a new object, so a set of them is enough.
const handledReveals = new WeakSet<InspectorReveal>();

// Pointers held down in the editor: a canvas press selects at pointerdown, and the inspector waits for
// the release before it scrolls, so a stacked page never moves under a drag (#339). It then also waits
// for the click that release sends: a touch tap's click is hit-tested where the finger was after the
// release, so a page scrolled (instantly) before it sends that click to whatever list control moved
// under the finger: another widget's row, a Remove button or a tab (#339 review).
const heldPointers = new Set<number>();
/** A timer while the last release's click may still come; 0 once it came or cannot come any more. */
let clickPending = 0;
/** How long a release's click may take before waiting reveals run anyway (a touch drag or long press sends none). */
const CLICK_WAIT_MS = 400;
const waiters = new Set<() => void>();
function settle(): void {
  if (heldPointers.size || clickPending) return;
  for (const waiter of [...waiters]) waiter();
}
function endClickWait(): void {
  window.clearTimeout(clickPending);
  clickPending = 0;
}
/** Tracks held pointers and their clicks for as long as the editor is mounted (it mounts before any press it cares about). */
export function useHeldPointers(): void {
  useEffect(() => {
    const press = (event: PointerEvent) => {
      endClickWait();
      heldPointers.add(event.pointerId);
    };
    const release = (event: PointerEvent) => {
      heldPointers.delete(event.pointerId);
      if (heldPointers.size) return;
      endClickWait();
      clickPending = window.setTimeout(() => {
        clickPending = 0;
        settle();
      }, CLICK_WAIT_MS);
    };
    const cancel = (event: PointerEvent) => {
      heldPointers.delete(event.pointerId);
      settle();
    };
    // The click was hit-tested before it is dispatched, so waiting reveals may scroll now (capture phase).
    const click = () => {
      if (!clickPending) return;
      endClickWait();
      settle();
    };
    const clear = () => {
      heldPointers.clear();
      endClickWait();
      settle();
    };
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('click', click, true);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('blur', clear);
      heldPointers.clear();
      endClickWait();
    };
  }, []);
}
/** Runs `action` now, or once no pointer is held and the last release's click has been hit-tested; returns a cleanup. */
function afterPointerRelease(action: () => void): () => void {
  if (!heldPointers.size && !clickPending) {
    action();
    return () => {};
  }
  const waiter = () => {
    waiters.delete(waiter);
    action();
  };
  waiters.add(waiter);
  return () => void waiters.delete(waiter);
}

export function WidgetInspector({
  settings,
  selected,
  onSelect,
  reveal,
  pickerOpen,
  onPicker,
  onAdd,
  onFix,
  roomProblem,
  remindersHidden,
  onRemove,
  onResize,
  onResizeSpan,
  resizeBase,
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
  /** Scroll this into view once it renders (a new object per request). */
  reveal: InspectorReveal | null;
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
  /** The board a resize of this widget starts from (#340). */
  resizeBase: (id: WidgetId) => WidgetGrid;
  onChange: (update: (settings: Settings) => Settings) => void;
  photoAvailable: boolean;
  photoBusy: boolean;
  onPhotoFile: (file: File) => void;
  onPhotoClear: () => void;
  onPhotoCancel: () => void;
  saving: boolean;
  /**
   * A layout message from an edit made in this list ("Clock removed"). Shown here only: the editor's
   * always-mounted layout announcer speaks it, so this copy is not a live region (#311).
   */
  message: string;
}) {
  const addButton = useRef<HTMLButtonElement>(null),
    wasOpen = useRef(false),
    added = useRef<WidgetId | null>(null),
    list = useRef<HTMLDivElement>(null);
  // Closing the picker moves focus only when focus went with it (Escape, Close, Add or a Make room
  // add); a canvas widget focused while it was open keeps focus. After an add focus lands on the new
  // widget's row, which the reveal below keeps in view with its settings; otherwise on Add widget,
  // and a reveal still waiting is dropped so no scroll pushes that button out of view (#339).
  useEffect(() => {
    const closed = wasOpen.current && !pickerOpen, id = added.current;
    wasOpen.current = pickerOpen;
    added.current = null;
    if (!closed) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const row = id && list.current?.querySelector<HTMLElement>(`[data-widget-option="${id}"] .widget-select`);
    if (row) return row.focus();
    if (reveal) handledReveals.add(reveal);
    addButton.current?.focus();
  }, [pickerOpen]);
  // #339: bring the selected widget's settings (or its no-room explanation) into view without moving
  // focus: inside the inspector panel on desktop, the page on stacked layouts. `block: 'nearest'`
  // shows the whole option when it fits and its top when it does not; the root's scroll padding
  // reserves the measured Save bar height. Instant when motion is reduced or animation is Off.
  // Each reveal is used once; a stacked layout uses up one that may not scroll the page.
  useEffect(() => {
    if (!reveal || handledReveals.has(reveal) || reveal.id !== selected || pickerOpen) return;
    if (!reveal.page && window.matchMedia('(max-width: 700px)').matches) return void handledReveals.add(reveal);
    return afterPointerRelease(() => {
      handledReveals.add(reveal);
      const option = list.current?.querySelector<HTMLElement>(`[data-widget-option="${reveal.id}"]`);
      const target = reveal.target === 'room' ? option?.querySelector<HTMLElement>('.room-notice:not([data-empty])') : option;
      if (!target?.isConnected) return;
      const still =
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        target.closest('.studio')?.getAttribute('data-animation') === 'off';
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: still ? 'instant' : 'smooth' });
    });
  }, [reveal, pickerOpen]);
  const rows = widgetListOrder(settings.widgets);
  if (pickerOpen)
    return (
      <WidgetPicker
        settings={settings}
        onAdd={(id, size) => {
          const problem = onAdd(id, size);
          if (!problem) added.current = id;
          return problem;
        }}
        onFix={(current, fix) => {
          const problem = onFix(current, fix);
          if (!problem && current.request.kind === 'add') added.current = current.request.id;
          return problem;
        }}
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
      {!rows.length && (
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
      <div className="widget-list" ref={list}>
        {message && <p className="inline-message">{message}</p>}
        {rows.map((id) => {
          const widget = WIDGET_CATALOG[id],
            placement = settings.widgetGrid.placements[id],
            ModuleSettings = WIDGET_MODULES[id].Settings,
            problem = roomProblem && roomProblem.request.kind !== 'add' && roomProblem.request.id === id ? roomProblem : null;
          return (
            <div
              key={id}
              className={`widget-option ${selected === id ? 'selected' : ''}`}
              data-widget-option={id}
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
                    <FreeSizeControls id={id} settings={settings} board={resizeBase(id)} onResize={onResize} onResizeSpan={onResizeSpan} problem={problem} onFix={onFix} />
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
                                onChange((previous) =>
                                  withAppearance(previous, { clockStyle: style }),
                                )
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
