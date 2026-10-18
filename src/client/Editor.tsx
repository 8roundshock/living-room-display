import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  AppState,
  LocationResult,
  Reminder,
  Settings,
  WidgetId,
} from '../shared/contracts';
import { api } from './api';
import { AmbientDisplay } from './Display';
import {
  ageLabel,
  localInputDate,
  nextComposition,
  reminderDate,
} from './format';
import { Icon, type IconName } from './icons';
import { applyBuiltinPreset, getVisual, sortReminders } from './model';

const widgetLabels: Record<WidgetId, string> = {
  clock: 'Time & date',
  weather: 'Weather & rain',
  forecast: 'Seven-day forecast',
  reminders: 'Reminders',
  preview: 'Last screen',
};
const widgetIcons: Record<WidgetId, IconName> = {
  clock: 'moon',
  weather: 'cloud',
  forecast: 'sun',
  reminders: 'check',
  preview: 'monitor',
};
const widgetIds = Object.keys(widgetLabels) as WidgetId[];
const colors = ['#8aa8c2', '#aaa0ca', '#8d9dcc', '#b8a17a', '#88afa6'];

function Toggle({
  children,
  checked,
  onChange,
  description,
  icon,
}: {
  children: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  icon?: IconName;
}) {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-text">
          {icon && <Icon name={icon} size={15} />}
          {children}
        </span>
        {description && (
          <span className="toggle-description">{description}</span>
        )}
      </span>
      <input
        className="toggle"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  display,
  low,
  high,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  display?: string;
  low?: string;
  high?: string;
}) {
  return (
    <div className="control-block">
      <div className="control-label">
        <span>{label}</span>
        <output>{display ?? value}</output>
      </div>
      <input
        className="range-input"
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {(low || high) && (
        <div className="range-ends">
          <span>{low}</span>
          <span>{high}</span>
        </div>
      )}
    </div>
  );
}

export function Editor({
  state,
  setState,
  connectionError,
  reload,
}: {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState | null>>;
  connectionError: string | null;
  reload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Settings>(() =>
    structuredClone(state.settings),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('All changes saved');
  const [error, setError] = useState<string | null>(null);
  const [composition, setComposition] = useState<number | undefined>();
  const [geometryWidget, setGeometryWidget] = useState<WidgetId>('clock');
  const [presetName, setPresetName] = useState('');
  const [savedPresetId, setSavedPresetId] = useState('');
  const [locationQuery, setLocationQuery] = useState('');
  const [locations, setLocations] = useState<LocationResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [reminderForm, setReminderForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reminderText, setReminderText] = useState('');
  const [reminderDue, setReminderDue] = useState('');
  const [reminderSaving, setReminderSaving] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const draftRevision = useRef(0);
  useEffect(() => {
    if (!dirty && !saving) setDraft(structuredClone(state.settings));
  }, [state.settings, dirty, saving]);

  function change(update: (settings: Settings) => Settings) {
    draftRevision.current++;
    setDraft((previous) => update(previous));
    setDirty(true);
    setSaveMessage('Previewing unsaved changes');
    setError(null);
  }
  function appearance(
    key: keyof Settings['appearance'],
    value: Settings['appearance'][keyof Settings['appearance']],
  ) {
    change((previous) => ({
      ...previous,
      appearance: { ...previous.appearance, [key]: value, preset: 'custom' },
    }));
  }
  async function saveSettings() {
    const submittedRevision = draftRevision.current;
    setSaving(true);
    setError(null);
    try {
      const { version: _version, ...patch } = draft;
      const saved = await api<Settings>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setState((previous) =>
        previous ? { ...previous, settings: saved } : previous,
      );
      if (submittedRevision === draftRevision.current) {
        setDraft(saved);
        setDirty(false);
        setSaveMessage('All changes saved');
      } else setSaveMessage('New changes are waiting to be saved');
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save settings.',
      );
      setSaveMessage('Changes are still in this preview');
    } finally {
      setSaving(false);
    }
  }
  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const visual = getVisual(draft);
    visual.appearance.preset = 'custom';
    const id = crypto.randomUUID();
    change((previous) => ({
      ...previous,
      savedPresets: [...previous.savedPresets, { id, name, visual }],
    }));
    setSavedPresetId(id);
    setPresetName(name);
  }
  function selectSavedPreset(id: string) {
    setSavedPresetId(id);
    const preset = draft.savedPresets.find((item) => item.id === id);
    if (preset) {
      change((previous) => ({
        ...previous,
        ...structuredClone(preset.visual),
      }));
      setPresetName(preset.name);
    }
  }
  async function searchLocations(event: React.FormEvent) {
    event.preventDefault();
    if (locationQuery.trim().length < 2) return;
    setSearching(true);
    setLocationMessage('');
    try {
      const found = await api<LocationResult[]>(
        `/api/locations?q=${encodeURIComponent(locationQuery.trim())}`,
      );
      setLocations(found);
      setLocationMessage(
        found.length
          ? 'Choose your city, then save changes.'
          : 'No cities found. Try a nearby city or a longer name.',
      );
    } catch (caught) {
      setLocationMessage(
        caught instanceof Error
          ? caught.message
          : 'Location search is unavailable.',
      );
    } finally {
      setSearching(false);
    }
  }
  function startReminder(reminder?: Reminder) {
    setEditingId(reminder?.id ?? null);
    setReminderText(reminder?.text ?? '');
    setReminderDue(localInputDate(reminder?.dueAt));
    setReminderForm(true);
    setError(null);
  }
  async function submitReminder(event: React.FormEvent) {
    event.preventDefault();
    const text = reminderText.trim();
    if (!text) return;
    setReminderSaving(true);
    setError(null);
    try {
      const dueAt = reminderDue ? new Date(reminderDue).toISOString() : null;
      const saved = await api<Reminder>(
        editingId ? `/api/reminders/${editingId}` : '/api/reminders',
        {
          method: editingId ? 'PATCH' : 'POST',
          body: JSON.stringify({ text, dueAt }),
        },
      );
      setState((previous) =>
        previous
          ? {
              ...previous,
              reminders: editingId
                ? previous.reminders.map((item) =>
                    item.id === saved.id ? saved : item,
                  )
                : [...previous.reminders, saved],
            }
          : previous,
      );
      setReminderForm(false);
      setReminderText('');
      setEditingId(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not save the reminder.',
      );
    } finally {
      setReminderSaving(false);
    }
  }
  async function completeReminder(reminder: Reminder) {
    try {
      const saved = await api<Reminder>(`/api/reminders/${reminder.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: !reminder.completed }),
      });
      setState((previous) =>
        previous
          ? {
              ...previous,
              reminders: previous.reminders.map((item) =>
                item.id === saved.id ? saved : item,
              ),
            }
          : previous,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not update the reminder.',
      );
    }
  }
  async function deleteReminder(id: string) {
    try {
      await api<void>(`/api/reminders/${id}`, { method: 'DELETE' });
      setState((previous) =>
        previous
          ? {
              ...previous,
              reminders: previous.reminders.filter((item) => item.id !== id),
            }
          : previous,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not delete the reminder.',
      );
    }
  }

  const pending = state.reminders.filter((item) => !item.completed);
  const completed = state.reminders.filter((item) => item.completed);
  const listedReminders = sortReminders(state.reminders).filter(
    (item) => showCompleted || !item.completed,
  );
  const transform = draft.widgetOverrides[geometryWidget];

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <a className="brand" href="/editor" aria-label="Still home">
          <span className="brand-mark">
            <Icon name="moon" size={17} />
          </span>
          <span className="brand-word">still</span>
          <span className="brand-divider" />
          <span className="brand-caption">A little space to slow down.</span>
        </a>
        <div className="topbar-actions">
          <span className="local-pill">
            <span className="status-dot" />
            Running locally
          </span>
          <a
            className="button"
            href="/display"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="monitor" size={17} />
            Open display
            <Icon name="arrow" size={15} />
          </a>
        </div>
      </header>
      <main>
        <div className="editor-intro">
          <div>
            <h1>Your room, at a glance.</h1>
            <p>Make a quiet space for the things you want to see.</p>
          </div>
          {state.storageWarning && (
            <div role="alert" className="error-box editor-error">
              {state.storageWarning}
            </div>
          )}
          <span className="intro-tag">
            <Icon name="sparkles" size={13} />
            Made for the moments between
          </span>
        </div>
        {(error || connectionError) && (
          <div role="alert" className="error-box editor-error">
            {error || connectionError}
            {connectionError &&
              ' Your changes remain in this preview until the server reconnects.'}
          </div>
        )}
        <div className="editor-grid">
          <div className="preview-section">
            <div className="preview-frame">
              <div className="preview-screen">
                <AmbientDisplay
                  state={state}
                  settings={draft}
                  embedded
                  compositionOverride={composition}
                />
              </div>
              <div className="preview-toolbar">
                <span className="preview-title">
                  <span className="status-dot" />
                  Live appearance preview
                </span>
                <span className="muted">16:9 · true black</span>
                <button
                  className="button"
                  onClick={() =>
                    setComposition((previous) => nextComposition(previous ?? 0))
                  }
                >
                  Next arrangement
                  <Icon name="arrow" size={13} />
                </button>
              </div>
            </div>
            <p className="preview-caption-editor">
              <Icon name="eye" size={14} />
              <span>
                Brightness is shown as it will appear on your display. Whole
                widgets drift and change places.{' '}
                {composition !== undefined && (
                  <button
                    className="text-button"
                    onClick={() => setComposition(undefined)}
                  >
                    Resume automatic preview.
                  </button>
                )}
              </span>
            </p>
            <section
              className="section-card reminder-card"
              aria-labelledby="reminder-heading"
            >
              <div className="section-heading">
                <div>
                  <h2 id="reminder-heading">
                    A few things for later{' '}
                    <span className="count-badge">{pending.length}</span>
                  </h2>
                  <p>Small reminders. No sounds, no interruptions.</p>
                </div>
                <button
                  className="button small ghost"
                  onClick={() => startReminder()}
                >
                  <Icon name="plus" size={14} />
                  Add
                </button>
              </div>
              <div className="section-body">
                {listedReminders.length ? (
                  <ul className="reminder-list">
                    {listedReminders.map((reminder) => (
                      <li className="editor-reminder" key={reminder.id}>
                        <button
                          className={`complete-button ${reminder.completed ? 'done' : ''}`}
                          aria-label={`${reminder.completed ? 'Mark incomplete' : 'Complete'}: ${reminder.text}`}
                          onClick={() => {
                            void completeReminder(reminder);
                          }}
                        >
                          {reminder.completed && (
                            <Icon name="check" size={12} />
                          )}
                        </button>
                        <div
                          className={`reminder-copy ${reminder.completed ? 'done' : ''}`}
                        >
                          <p>{reminder.text}</p>
                          <span
                            className={
                              !reminder.completed &&
                              reminder.dueAt &&
                              new Date(reminder.dueAt).getTime() < Date.now()
                                ? 'overdue'
                                : ''
                            }
                          >
                            {reminder.completed
                              ? 'Completed'
                              : reminderDate(reminder.dueAt)}
                          </span>
                        </div>
                        <div className="reminder-actions">
                          <button
                            className="icon-button"
                            aria-label={`Edit: ${reminder.text}`}
                            onClick={() => startReminder(reminder)}
                          >
                            <Icon name="edit" size={14} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Delete: ${reminder.text}`}
                            onClick={() => {
                              void deleteReminder(reminder.id);
                            }}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="empty-reminders">
                    <Icon name="check" size={25} />
                    <div>
                      <h3>Nothing waiting on you.</h3>
                      <p>Add a reminder when something comes to mind.</p>
                    </div>
                  </div>
                )}
                {completed.length > 0 && (
                  <button
                    className="text-button completed-toggle"
                    onClick={() => setShowCompleted(!showCompleted)}
                  >
                    {showCompleted ? 'Hide' : 'Show'} {completed.length}{' '}
                    completed
                  </button>
                )}
                {reminderForm && (
                  <form
                    className="reminder-form"
                    onSubmit={(event) => {
                      void submitReminder(event);
                    }}
                  >
                    <div className="input-row">
                      <label>
                        <span className="field-label">Reminder</span>
                        <input
                          className="text-input"
                          autoFocus
                          required
                          maxLength={240}
                          placeholder="Something to remember…"
                          value={reminderText}
                          onChange={(event) =>
                            setReminderText(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span className="field-label">When · optional</span>
                        <input
                          className="text-input"
                          type="datetime-local"
                          value={reminderDue}
                          onChange={(event) =>
                            setReminderDue(event.target.value)
                          }
                        />
                      </label>
                    </div>
                    <p className="hint">
                      One-time reminders use this computer's local time. Undated
                      items stay until completed.
                    </p>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="button small ghost"
                        onClick={() => setReminderForm(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="button small primary"
                        disabled={reminderSaving}
                      >
                        {editingId ? 'Save reminder' : 'Add reminder'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </section>
            <div className="editor-lower">
              <section
                className="section-card"
                aria-labelledby="weather-heading"
              >
                <div className="section-heading">
                  <div>
                    <h2 id="weather-heading">Weather, where you are</h2>
                    <p>A city is enough. No home address needed.</p>
                  </div>
                  <Icon name="cloud" size={20} className="heading-icon" />
                </div>
                <div className="section-body">
                  <div className="location-current">
                    <Icon name="location" size={18} />
                    <div>
                      <strong>{draft.location.name}</strong>
                      <span>
                        {draft.location.timezone.replaceAll('_', ' ')}
                      </span>
                    </div>
                  </div>
                  <form
                    className="location-search"
                    onSubmit={(event) => {
                      void searchLocations(event);
                    }}
                  >
                    <label className="sr-only" htmlFor="location-search">
                      Search for a city
                    </label>
                    <input
                      id="location-search"
                      className="text-input"
                      minLength={2}
                      maxLength={100}
                      value={locationQuery}
                      placeholder="Search for a city"
                      onChange={(event) => setLocationQuery(event.target.value)}
                    />
                    <button
                      className="button"
                      aria-label="Search cities"
                      disabled={searching}
                    >
                      <Icon name={searching ? 'refresh' : 'arrow'} size={16} />
                    </button>
                  </form>
                  {locations.length > 0 && (
                    <ul className="location-results">
                      {locations.map((location) => (
                        <li key={location.id}>
                          <button
                            type="button"
                            onClick={() => {
                              change((previous) => ({
                                ...previous,
                                location: {
                                  name: location.name,
                                  latitude: location.latitude,
                                  longitude: location.longitude,
                                  timezone: location.timezone,
                                },
                              }));
                              setLocations([]);
                              setLocationMessage(
                                'City selected. Save changes to load its forecast.',
                              );
                            }}
                          >
                            <span>{location.name}</span>
                            <small>
                              {[location.admin1, location.country]
                                .filter(Boolean)
                                .join(', ')}
                            </small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {locationMessage && (
                    <p className="inline-message" role="status">
                      {locationMessage}
                    </p>
                  )}
                  <div className="input-row" style={{ marginTop: 18 }}>
                    <label>
                      <span className="field-label">Units</span>
                      <select
                        className="select-input"
                        value={draft.units}
                        onChange={(event) =>
                          change((previous) => ({
                            ...previous,
                            units: event.target.value as Settings['units'],
                          }))
                        }
                      >
                        <option value="metric">Celsius · metric</option>
                        <option value="imperial">Fahrenheit · imperial</option>
                      </select>
                    </label>
                    <label>
                      <span className="field-label">Clock</span>
                      <select
                        className="select-input"
                        value={draft.clockFormat}
                        onChange={(event) =>
                          change((previous) => ({
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
                  </div>
                  <p className={`weather-status-row ${state.weather.status}`}>
                    <span className="status-dot" />
                    {state.weather.status === 'fresh'
                      ? ageLabel(state.weather.updatedAt)
                      : state.weather.status === 'stale'
                        ? `Saved forecast · ${ageLabel(state.weather.updatedAt).toLowerCase()}`
                        : 'Forecast currently unavailable'}
                  </p>
                  <p className="hint">
                    Hourly precipitation chance and forecast estimates from{' '}
                    <a
                      href={state.weather.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open-Meteo
                    </a>
                    . Timing can change.
                    {state.weather.error ? ` ${state.weather.error}` : ''}
                  </p>
                </div>
              </section>
              <section
                className="section-card"
                aria-labelledby="screen-heading"
              >
                <div className="section-heading">
                  <div>
                    <h2 id="screen-heading">A glimpse of your last screen</h2>
                    <p>A faint reminder of where you left off.</p>
                  </div>
                  <Icon name="monitor" size={19} className="heading-icon" />
                </div>
                <div className="section-body">
                  <Toggle
                    checked={draft.preview.enabled && draft.widgets.preview}
                    onChange={(enabled) =>
                      change((previous) => ({
                        ...previous,
                        widgets: { ...previous.widgets, preview: enabled },
                        preview: { ...previous.preview, enabled },
                      }))
                    }
                  >
                    Show last-screen snapshot
                  </Toggle>
                  <div style={{ marginTop: 20 }}>
                    <Range
                      label="Snapshot opacity"
                      min={2}
                      max={30}
                      value={Math.round(draft.preview.opacity * 100)}
                      onChange={(value) =>
                        change((previous) => ({
                          ...previous,
                          preview: {
                            ...previous.preview,
                            opacity: value / 100,
                          },
                        }))
                      }
                      display={`${Math.round(draft.preview.opacity * 100)}%`}
                      low="Barely there"
                      high="More visible"
                    />
                    <Range
                      label="Snapshot size"
                      min={12}
                      max={35}
                      value={draft.preview.widthPercent}
                      onChange={(value) =>
                        change((previous) => ({
                          ...previous,
                          preview: { ...previous.preview, widthPercent: value },
                        }))
                      }
                      display={`${draft.preview.widthPercent}%`}
                    />
                  </div>
                  <p className="hint">
                    {state.preview.available
                      ? 'A last-screen snapshot is available. Its capture time appears beside it.'
                      : 'No snapshot yet. The Windows helper captures the desktop just before opening the display.'}{' '}
                    Images stay in memory and disappear when the server stops.
                  </p>
                </div>
              </section>
            </div>
          </div>
          <section
            className="section-card settings-panel"
            aria-labelledby="appearance-heading"
          >
            <div className="section-heading">
              <div>
                <h2 id="appearance-heading">Set the mood</h2>
                <p>Your display, your pace.</p>
              </div>
              <Icon name="settings" size={19} className="heading-icon" />
            </div>
            <div className="section-body">
              <div className="settings-group">
                <h3 className="settings-heading">Start with a feeling</h3>
                <div className="preset-list">
                  {(['phone', 'room', 'night'] as const).map(
                    (preset, index) => (
                      <button
                        type="button"
                        key={preset}
                        className={`preset-button ${draft.appearance.preset === preset ? 'active' : ''}`}
                        aria-pressed={draft.appearance.preset === preset}
                        onClick={() => {
                          change((previous) =>
                            applyBuiltinPreset(previous, preset),
                          );
                          setSavedPresetId('');
                        }}
                      >
                        <Icon
                          name={(['monitor', 'sun', 'moon'] as const)[index]}
                          size={19}
                        />
                        <span>{preset[0].toUpperCase() + preset.slice(1)}</span>
                        <span className="preset-note">
                          {
                            [
                              'A little brighter',
                              'Easy to read',
                              'Soft & quiet',
                            ][index]
                          }
                        </span>
                      </button>
                    ),
                  )}
                </div>
                <div style={{ marginTop: 22 }}>
                  <Range
                    label="Brightness"
                    min={10}
                    max={100}
                    value={Math.round(draft.appearance.brightness * 100)}
                    onChange={(value) => appearance('brightness', value / 100)}
                    display={`${Math.round(draft.appearance.brightness * 100)}%`}
                    low="Dim"
                    high="Bright"
                  />
                  <Range
                    label="Text size"
                    min={70}
                    max={150}
                    value={Math.round(draft.appearance.fontScale * 100)}
                    onChange={(value) => appearance('fontScale', value / 100)}
                    display={`${Math.round(draft.appearance.fontScale * 100)}%`}
                    low="Smaller"
                    high="Larger"
                  />
                </div>
                <div className="control-block">
                  <span className="control-label">Accent color</span>
                  <div className="swatches">
                    {colors.map((color) => (
                      <button
                        type="button"
                        key={color}
                        className={`swatch ${draft.appearance.accentColor.toLowerCase() === color ? 'active' : ''}`}
                        style={{ '--swatch': color } as React.CSSProperties}
                        aria-label={`Accent ${color}`}
                        aria-pressed={
                          draft.appearance.accentColor.toLowerCase() === color
                        }
                        onClick={() => appearance('accentColor', color)}
                      />
                    ))}
                    <label title="Choose a custom accent">
                      <span className="sr-only">Custom accent color</span>
                      <input
                        className="color-input"
                        aria-label="Custom accent color"
                        type="color"
                        value={draft.appearance.accentColor}
                        onChange={(event) =>
                          appearance('accentColor', event.target.value)
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>
              <div className="settings-group">
                <h3 className="settings-heading">On your display</h3>
                {widgetIds.map((id) => (
                  <Toggle
                    key={id}
                    icon={widgetIcons[id]}
                    checked={
                      draft.widgets[id] &&
                      (id !== 'preview' || draft.preview.enabled)
                    }
                    onChange={(checked) =>
                      change((previous) => ({
                        ...previous,
                        widgets: { ...previous.widgets, [id]: checked },
                        preview:
                          id === 'preview'
                            ? { ...previous.preview, enabled: checked }
                            : previous.preview,
                      }))
                    }
                  >
                    {widgetLabels[id]}
                  </Toggle>
                ))}
              </div>
              <div className="settings-group">
                <h3 className="settings-heading">Room to move</h3>
                <Toggle
                  checked={draft.appearance.motionEnabled}
                  onChange={(value) => appearance('motionEnabled', value)}
                  description="Gentle drift, new positions, and soft fades."
                >
                  Move & recompose widgets
                </Toggle>
                <div style={{ marginTop: 18 }}>
                  <Range
                    label="Change arrangement every"
                    min={30}
                    max={1800}
                    step={30}
                    value={draft.appearance.motionIntervalSeconds}
                    onChange={(value) =>
                      appearance('motionIntervalSeconds', value)
                    }
                    display={
                      draft.appearance.motionIntervalSeconds < 60
                        ? `${draft.appearance.motionIntervalSeconds} sec`
                        : `${draft.appearance.motionIntervalSeconds / 60} min`
                    }
                  />
                </div>
                <details className="advanced-settings">
                  <summary>Typography & layout</summary>
                  <div className="input-row">
                    <label>
                      <span className="field-label">Typeface</span>
                      <select
                        className="select-input"
                        value={draft.appearance.fontFamily}
                        onChange={(event) =>
                          appearance('fontFamily', event.target.value)
                        }
                      >
                        <option value="sans">Simple</option>
                        <option value="serif">Classic</option>
                        <option value="mono">Monospace</option>
                      </select>
                    </label>
                    <label>
                      <span className="field-label">Spacing</span>
                      <select
                        className="select-input"
                        value={draft.appearance.layout}
                        onChange={(event) =>
                          appearance('layout', event.target.value)
                        }
                      >
                        <option value="balanced">Balanced</option>
                        <option value="minimal">Airy</option>
                        <option value="weather-first">Weather first</option>
                      </select>
                    </label>
                  </div>
                  <div style={{ marginTop: 18 }}>
                    <Range
                      label="Fade duration"
                      min={0}
                      max={10}
                      value={draft.appearance.fadeSeconds}
                      onChange={(value) => appearance('fadeSeconds', value)}
                      display={`${draft.appearance.fadeSeconds} sec`}
                    />
                  </div>
                  <label className="field-label" style={{ marginTop: 14 }}>
                    Text color{' '}
                    <input
                      className="color-input"
                      aria-label="Text color"
                      type="color"
                      value={draft.appearance.textColor}
                      onChange={(event) =>
                        appearance('textColor', event.target.value)
                      }
                    />
                  </label>
                  <p className="settings-helper">
                    Your system's reduced-motion preference pauses drift and
                    automatic rearrangement.
                  </p>
                </details>
                <details className="advanced-settings">
                  <summary>Widget size & position</summary>
                  <label>
                    <span className="field-label">Widget</span>
                    <select
                      className="select-input"
                      value={geometryWidget}
                      onChange={(event) =>
                        setGeometryWidget(event.target.value as WidgetId)
                      }
                    >
                      {widgetIds.map((id) => (
                        <option key={id} value={id}>
                          {widgetLabels[id]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(['scale', 'offsetX', 'offsetY'] as const).map((key) => (
                    <div key={key} style={{ marginTop: 15 }}>
                      <Range
                        label={
                          key === 'scale'
                            ? 'Widget scale'
                            : key === 'offsetX'
                              ? 'Horizontal position'
                              : 'Vertical position'
                        }
                        min={key === 'scale' ? 50 : -25}
                        max={key === 'scale' ? 200 : 25}
                        value={
                          key === 'scale'
                            ? Math.round(transform[key] * 100)
                            : transform[key]
                        }
                        display={`${key === 'scale' ? Math.round(transform[key] * 100) : transform[key]}%`}
                        onChange={(value) =>
                          change((previous) => ({
                            ...previous,
                            widgetOverrides: {
                              ...previous.widgetOverrides,
                              [geometryWidget]: {
                                ...previous.widgetOverrides[geometryWidget],
                                [key]: key === 'scale' ? value / 100 : value,
                              },
                            },
                          }))
                        }
                      />
                    </div>
                  ))}
                  <p className="settings-helper">
                    Widgets stay inside their own regions to avoid overlap.
                    Large scales and offsets can crop content; check each
                    arrangement in the preview.
                  </p>
                  <button
                    className="text-button"
                    onClick={() =>
                      change((previous) => ({
                        ...previous,
                        widgetOverrides: {
                          ...previous.widgetOverrides,
                          [geometryWidget]: {
                            scale: 1,
                            offsetX: 0,
                            offsetY: 0,
                          },
                        },
                      }))
                    }
                  >
                    Reset this widget
                  </button>
                </details>
                <details className="advanced-settings">
                  <summary>Your saved presets</summary>
                  <label>
                    <span className="field-label">Choose a preset</span>
                    <select
                      className="select-input"
                      value={savedPresetId}
                      onChange={(event) =>
                        selectSavedPreset(event.target.value)
                      }
                    >
                      <option value="">Select saved appearance…</option>
                      {draft.savedPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'block', marginTop: 12 }}>
                    <span className="field-label">Preset name</span>
                    <input
                      className="text-input"
                      maxLength={60}
                      value={presetName}
                      onChange={(event) => setPresetName(event.target.value)}
                      placeholder="My evening room"
                    />
                  </label>
                  <div className="preset-actions">
                    <button
                      className="button small ghost"
                      disabled={
                        !presetName.trim() || draft.savedPresets.length >= 12
                      }
                      onClick={savePreset}
                    >
                      <Icon name="plus" size={13} />
                      Save new
                    </button>
                    {savedPresetId && (
                      <>
                        <button
                          className="button small ghost"
                          disabled={!presetName.trim()}
                          onClick={() =>
                            change((previous) => ({
                              ...previous,
                              savedPresets: previous.savedPresets.map(
                                (preset) =>
                                  preset.id === savedPresetId
                                    ? {
                                        ...preset,
                                        name: presetName.trim(),
                                        visual: getVisual(draft),
                                      }
                                    : preset,
                              ),
                            }))
                          }
                        >
                          Update
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Delete selected preset"
                          onClick={() => {
                            change((previous) => ({
                              ...previous,
                              savedPresets: previous.savedPresets.filter(
                                (preset) => preset.id !== savedPresetId,
                              ),
                            }));
                            setSavedPresetId('');
                            setPresetName('');
                          }}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </>
                    )}
                  </div>
                  <p className="settings-helper">
                    Presets include appearance, widget positions, and snapshot
                    settings. Save changes below to keep them.
                  </p>
                </details>
                <details className="advanced-settings">
                  <summary>Local data & recovery</summary>
                  <p className="settings-helper">
                    Settings and reminders live on this computer. Export before
                    an update or reset.
                  </p>
                  <a
                    className="button small ghost"
                    style={{ marginTop: 12 }}
                    href="/api/export"
                    download="still-backup.json"
                  >
                    <Icon name="download" size={14} />
                    Export backup
                  </a>
                  <button
                    className="text-button reset-appearance"
                    onClick={() => {
                      change((previous) =>
                        applyBuiltinPreset(previous, 'room'),
                      );
                      setSavedPresetId('');
                    }}
                  >
                    Reset appearance to Room
                  </button>
                  <p className="settings-helper">
                    Automatic idle activation is managed by the Windows helper.
                    Opening the display here is manual.
                  </p>
                </details>
              </div>
            </div>
            <div className="save-bar">
              <span
                className={`save-status ${!dirty ? 'saved' : ''}`}
                role="status"
              >
                {saveMessage}
              </span>
              <button
                className="button primary"
                disabled={!dirty || saving}
                onClick={() => {
                  void saveSettings();
                }}
              >
                {saving ? 'Saving…' : 'Save changes'}
                <Icon name="check" size={14} />
              </button>
            </div>
          </section>
        </div>
      </main>
      <footer className="editor-footer">
        <p>Quiet by design. Local by default. Your TV stays on.</p>
        <p>
          Dimness and movement do not guarantee protection from image retention.
        </p>
      </footer>
    </div>
  );
}
