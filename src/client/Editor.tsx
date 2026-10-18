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
import { defaultSettings } from '../shared/defaults';
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
import { browserLocationPlatform, getDeviceLocation } from './location';
import { rebaseSettings, same, settingsChanges } from './draft';
import { CitySearch } from './CitySearch';

const widgets: { id: WidgetId; label: string; icon: IconName }[] = [
  { id: 'clock', label: 'Time & date', icon: 'moon' },
  { id: 'weather', label: 'Weather & rain', icon: 'cloud' },
  { id: 'forecast', label: 'Seven-day forecast', icon: 'sun' },
  { id: 'reminders', label: 'Reminders', icon: 'check' },
  { id: 'preview', label: 'Last screen', icon: 'monitor' },
];
const sections = ['Style', 'Widgets', 'Weather', 'Reminders'] as const;
type Section = (typeof sections)[number];
const colors = [
  { value: '#8aa8c2', name: 'Mist' },
  { value: '#aaa0ca', name: 'Lilac' },
  { value: '#8d9dcc', name: 'Dusk' },
  { value: '#b8a17a', name: 'Sand' },
  { value: '#88afa6', name: 'Sage' },
];

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input
        className="toggle"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
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
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  display?: string;
}) {
  return (
    <label className="control-block">
      <span className="control-label">
        <span>{label}</span>
        <output>{display ?? value}</output>
      </span>
      <input
        className="range-input"
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={
          {
            '--range-fill': `${((value - min) / (max - min)) * 100}%`,
          } as React.CSSProperties
        }
      />
    </label>
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
  const [saved, setSaved] = useState(() => structuredClone(state.settings));
  const [draft, setDraft] = useState(() => structuredClone(state.settings));
  const savedRef = useRef(saved),
    draftRef = useRef(draft);
  const [section, setSection] = useState<Section>('Style');
  const [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [composition, setComposition] = useState<number | undefined>();
  const [selectedWidget, setSelectedWidget] = useState<WidgetId | null>(null);
  const [presetName, setPresetName] = useState(''),
    [presetId, setPresetId] = useState('');
  const [locationQuery, setLocationQuery] = useState(''),
    [locationMessage, setLocationMessage] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const locationEpoch = useRef(0),
    mounted = useRef(true),
    automaticAttempted = useRef(false),
    automaticLocation = useRef(false);
  const [reminderForm, setReminderForm] = useState(false),
    [editingId, setEditingId] = useState<string | null>(null);
  const [reminderText, setReminderText] = useState(''),
    [reminderDue, setReminderDue] = useState('');
  const [reminderSaving, setReminderSaving] = useState(false),
    [reminderMessage, setReminderMessage] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  function updateDraft(next: Settings) {
    draftRef.current = next;
    setDraft(next);
  }
  function change(update: (settings: Settings) => Settings) {
    updateDraft(update(draftRef.current));
    setError(null);
  }
  useEffect(() => {
    const incoming = structuredClone(state.settings);
    updateDraft(rebaseSettings(savedRef.current, draftRef.current, incoming));
    savedRef.current = incoming;
    setSaved(incoming);
  }, [state.settings]);
  useEffect(() => {
    mounted.current = true;
    // Delay through StrictMode's mount/cleanup probe; only the live mount looks up.
    const timer = window.setTimeout(() => {
      if (
        !automaticAttempted.current &&
        state.settings.locationSource !== 'manual'
      ) {
        automaticAttempted.current = true;
        void deviceLocation(true);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      mounted.current = false;
      locationEpoch.current++;
    };
  }, []);
  const dirty = !same(saved, draft),
    canCancel =
      dirty ||
      locationBusy ||
      !!locationQuery ||
      presetName !==
        (saved.savedPresets.find((preset) => preset.id === presetId)?.name ??
          '');
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  function cancelChanges() {
    locationEpoch.current++;
    automaticLocation.current = false;
    setLocationBusy(false);
    updateDraft(structuredClone(savedRef.current));
    setLocationQuery('');
    setLocationMessage('');
    setPresetId('');
    setPresetName('');
    setError(null);
  }
  function appearance<K extends keyof Settings['appearance']>(
    key: K,
    value: Settings['appearance'][K],
  ) {
    change((previous) => ({
      ...previous,
      appearance: { ...previous.appearance, [key]: value, preset: 'custom' },
    }));
  }
  async function deviceLocation(automatic: boolean) {
    if (saving || locationBusy) return;
    const epoch = ++locationEpoch.current;
    setLocationBusy(true);
    if (!automatic) setLocationMessage('Finding your area…');
    const result = await getDeviceLocation(
      browserLocationPlatform(),
      !automatic,
    );
    if (!mounted.current || epoch !== locationEpoch.current) return;
    setLocationBusy(false);
    if (automatic && draftRef.current.locationSource === 'manual') return;
    if (result.status === 'success') {
      automaticLocation.current = automatic;
      change((previous) => ({
        ...previous,
        locationSource: 'device',
        location: {
          name: 'Device area',
          latitude: result.latitude,
          longitude: result.longitude,
          timezone: 'auto',
        },
      }));
      setLocationMessage('Area ready to save');
    } else {
      if (
        draftRef.current.locationSource !== 'manual' &&
        result.status !== 'permission-needed'
      ) {
        automaticLocation.current = automatic;
        change((previous) => ({
          ...previous,
          locationSource: 'fallback',
          location: defaultSettings().location,
        }));
      }
      if (!automatic)
        setLocationMessage(
          result.status === 'denied'
            ? 'Location blocked. Choose a city below.'
            : 'Location unavailable. Your city is kept.',
        );
    }
  }
  function selectCity(city: LocationResult) {
    locationEpoch.current++;
    setLocationBusy(false);
    automaticLocation.current = false;
    change((previous) => ({
      ...previous,
      locationSource: 'manual',
      location: {
        name: city.name,
        latitude: city.latitude,
        longitude: city.longitude,
        timezone: city.timezone,
      },
    }));
    setLocationQuery('');
    setLocationMessage('City ready to save');
  }
  async function saveSettings() {
    const submitted = structuredClone(draftRef.current),
      patch = settingsChanges(
        savedRef.current,
        draftRef.current,
        automaticLocation.current,
      );
    setSaving(true);
    setError(null);
    try {
      const received = await api<Settings>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!mounted.current) return;
      updateDraft(rebaseSettings(submitted, draftRef.current, received));
      savedRef.current = received;
      setSaved(received);
      setState((previous) =>
        previous ? { ...previous, settings: received } : previous,
      );
      automaticLocation.current = false;
      setLocationMessage('');
      void reload();
    } catch (caught) {
      if (mounted.current)
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not save. Try again.',
        );
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  function choosePreset(id: string) {
    setPresetId(id);
    const preset = draft.savedPresets.find((item) => item.id === id);
    if (preset) {
      change((previous) => ({
        ...previous,
        ...structuredClone(preset.visual),
      }));
      setPresetName(preset.name);
    }
  }
  function addPreset() {
    if (!presetName.trim()) return;
    const id = crypto.randomUUID();
    change((previous) => ({
      ...previous,
      savedPresets: [
        ...previous.savedPresets,
        { id, name: presetName.trim(), visual: getVisual(previous) },
      ],
    }));
    setPresetId(id);
  }
  function startReminder(reminder?: Reminder) {
    setEditingId(reminder?.id ?? null);
    setReminderText(reminder?.text ?? '');
    setReminderDue(localInputDate(reminder?.dueAt));
    setReminderForm(true);
    setError(null);
    setReminderMessage('');
  }
  async function submitReminder(event: React.FormEvent) {
    event.preventDefault();
    if (!reminderText.trim()) return;
    setReminderSaving(true);
    setError(null);
    try {
      const received = await api<Reminder>(
        editingId ? `/api/reminders/${editingId}` : '/api/reminders',
        {
          method: editingId ? 'PATCH' : 'POST',
          body: JSON.stringify({
            text: reminderText.trim(),
            dueAt: reminderDue ? new Date(reminderDue).toISOString() : null,
          }),
        },
      );
      setState((previous) =>
        previous
          ? {
              ...previous,
              reminders: editingId
                ? previous.reminders.map((item) =>
                    item.id === received.id ? received : item,
                  )
                : [...previous.reminders, received],
            }
          : previous,
      );
      setReminderForm(false);
      setReminderMessage('Reminder saved');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save reminder.',
      );
    } finally {
      setReminderSaving(false);
    }
  }
  async function completeReminder(reminder: Reminder) {
    try {
      const received = await api<Reminder>(`/api/reminders/${reminder.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: !reminder.completed }),
      });
      setState((previous) =>
        previous
          ? {
              ...previous,
              reminders: previous.reminders.map((item) =>
                item.id === received.id ? received : item,
              ),
            }
          : previous,
      );
      setReminderMessage(
        received.completed ? 'Completed' : 'Reminder restored',
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not update reminder.',
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
      setReminderMessage('Reminder deleted');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not delete reminder.',
      );
    }
  }
  const pendingCount = state.reminders.filter((item) => !item.completed).length,
    completedCount = state.reminders.length - pendingCount;
  const listedReminders = sortReminders(state.reminders).filter(
    (item) => showCompleted || !item.completed,
  );
  const weatherPending =
    !same(draft.location, state.settings.location) ||
    draft.locationSource !== state.settings.locationSource ||
    draft.units !== state.settings.units;
  const weatherRefreshing =
    saved.location.latitude !== state.weather.location.latitude ||
    saved.location.longitude !== state.weather.location.longitude ||
    (saved.units === 'metric' ? '°C' : '°F') !==
      state.weather.units.temperature;
  return (
    <div className="studio">
      <header className="studio-header">
        <a className="brand" href="/editor" aria-label="Still editor">
          <span className="brand-symbol">
            <Icon name="moon" size={20} />
          </span>
          still
        </a>
        <a
          className="button open-display"
          href="/display"
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="monitor" size={17} />
          Open display
          <Icon name="arrow" size={15} />
        </a>
      </header>
      <main className="studio-workspace">
        <section className="canvas-column" aria-label="Display preview">
          <div className="canvas-heading">
            <h1>Your display</h1>
            <span className="local-indicator">
              <span className="status-dot" />
              Local
            </span>
          </div>
          <div className="preview-frame">
            <div className="preview-screen">
              <AmbientDisplay
                state={state}
                settings={draft}
                embedded
                disconnected={connectionError !== null}
                compositionOverride={composition}
              />
            </div>
          </div>
          <div className="canvas-toolbar">
            <span>Preview</span>
            <div
              className="composition-picker"
              aria-label="Preview arrangement"
            >
              {[0, 1, 2, 3].map((index) => (
                <button
                  key={index}
                  aria-label={`Arrangement ${index + 1}`}
                  aria-pressed={composition === index}
                  onClick={() => setComposition(index)}
                >
                  {index + 1}
                </button>
              ))}
              <button
                className={
                  composition === undefined ? 'automatic active' : 'automatic'
                }
                aria-pressed={composition === undefined}
                onClick={() => setComposition(undefined)}
              >
                Automatic
              </button>
            </div>
            <button
              className="icon-button"
              aria-label="Next arrangement"
              onClick={() =>
                setComposition((previous) => nextComposition(previous ?? 0))
              }
            >
              <Icon name="refresh" size={16} />
            </button>
          </div>
          {weatherPending && (
            <p className="canvas-note" role="status">
              Weather updates after Save · preview still shows{' '}
              {state.weather.location.name}
            </p>
          )}
          {!weatherPending && weatherRefreshing && (
            <p className="canvas-note" role="status">
              Updating weather · preview still shows{' '}
              {state.weather.location.name}
            </p>
          )}
        </section>
        <aside className="inspector" aria-label="Display settings">
          <div
            className="inspector-tabs"
            role="tablist"
            aria-label="Settings section"
          >
            {sections.map((name, index) => (
              <button
                key={name}
                id={`tab-${name}`}
                role="tab"
                aria-selected={section === name}
                aria-controls={`panel-${name}`}
                tabIndex={section === name ? 0 : -1}
                onClick={() => setSection(name)}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % sections.length
                      : event.key === 'ArrowLeft'
                        ? (index + sections.length - 1) % sections.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? sections.length - 1
                            : -1;
                  if (next >= 0) {
                    event.preventDefault();
                    setSection(sections[next]);
                    document.getElementById(`tab-${sections[next]}`)?.focus();
                  }
                }}
              >
                {name}
                {name === 'Reminders' && pendingCount > 0 && (
                  <span className="tab-count">{pendingCount}</span>
                )}
              </button>
            ))}
          </div>
          <div
            key={section}
            className="inspector-panel"
            id={`panel-${section}`}
            role="tabpanel"
            aria-labelledby={`tab-${section}`}
            tabIndex={0}
          >
            {section === 'Style' && (
              <>
                <h2>Make it yours</h2>
                <div className="preset-list">
                  {(['phone', 'room', 'night'] as const).map((preset) => (
                    <button
                      key={preset}
                      className={`preset-button ${draft.appearance.preset === preset ? 'active' : ''}`}
                      aria-pressed={draft.appearance.preset === preset}
                      onClick={() => {
                        change((previous) =>
                          applyBuiltinPreset(previous, preset),
                        );
                        setPresetId('');
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className={`preset-miniature miniature-${preset}`}
                      >
                        <span>9:41</span>
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="preset-label">
                        {preset[0].toUpperCase() + preset.slice(1)}
                        {draft.appearance.preset === preset && (
                          <Icon name="check" size={13} />
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                <Range
                  label="Brightness"
                  min={10}
                  max={100}
                  value={Math.round(draft.appearance.brightness * 100)}
                  display={`${Math.round(draft.appearance.brightness * 100)}%`}
                  onChange={(value) => appearance('brightness', value / 100)}
                />
                <Range
                  label="Text size"
                  min={70}
                  max={150}
                  value={Math.round(draft.appearance.fontScale * 100)}
                  display={`${Math.round(draft.appearance.fontScale * 100)}%`}
                  onChange={(value) => appearance('fontScale', value / 100)}
                />
                <div className="inspector-group">
                  <h3>Accent</h3>
                  <div className="swatches">
                    {colors.map((color) => (
                      <button
                        key={color.value}
                        className={`swatch ${draft.appearance.accentColor.toLowerCase() === color.value ? 'active' : ''}`}
                        style={
                          { '--swatch': color.value } as React.CSSProperties
                        }
                        aria-label={color.name}
                        aria-pressed={
                          draft.appearance.accentColor.toLowerCase() ===
                          color.value
                        }
                        onClick={() => appearance('accentColor', color.value)}
                      >
                        <span>
                          {draft.appearance.accentColor.toLowerCase() ===
                            color.value && <Icon name="check" size={14} />}
                        </span>
                      </button>
                    ))}
                    <label className="custom-color" title="Custom accent">
                      <span className="sr-only">Custom accent color</span>
                      <input
                        type="color"
                        aria-label="Custom accent color"
                        value={draft.appearance.accentColor}
                        onChange={(event) =>
                          appearance('accentColor', event.target.value)
                        }
                      />
                      <Icon name="plus" size={15} />
                    </label>
                  </div>
                </div>
                <details className="disclosure">
                  <summary>
                    Movement
                    <span>{draft.appearance.motionEnabled ? 'On' : 'Off'}</span>
                  </summary>
                  <div className="disclosure-body">
                    <Toggle
                      label="Move & recompose"
                      checked={draft.appearance.motionEnabled}
                      onChange={(value) => appearance('motionEnabled', value)}
                    />
                    <Range
                      label="New arrangement"
                      min={30}
                      max={1800}
                      step={30}
                      value={draft.appearance.motionIntervalSeconds}
                      display={
                        draft.appearance.motionIntervalSeconds < 60
                          ? `${draft.appearance.motionIntervalSeconds}s`
                          : `${draft.appearance.motionIntervalSeconds / 60} min`
                      }
                      onChange={(value) =>
                        appearance('motionIntervalSeconds', value)
                      }
                    />
                    <Range
                      label="Fade duration"
                      min={0}
                      max={10}
                      value={draft.appearance.fadeSeconds}
                      display={`${draft.appearance.fadeSeconds}s`}
                      onChange={(value) => appearance('fadeSeconds', value)}
                    />
                    <p className="hint">
                      Follows your system’s reduced-motion setting.
                    </p>
                  </div>
                </details>
                <details className="disclosure">
                  <summary>Typography & layout</summary>
                  <div className="disclosure-body">
                    <div className="input-row">
                      <label>
                        <span className="field-label">Typeface</span>
                        <select
                          className="select-input"
                          value={draft.appearance.fontFamily}
                          onChange={(event) =>
                            appearance(
                              'fontFamily',
                              event.target
                                .value as Settings['appearance']['fontFamily'],
                            )
                          }
                        >
                          <option value="sans">System</option>
                          <option value="serif">Classic</option>
                          <option value="mono">Monospace</option>
                        </select>
                      </label>
                      <label>
                        <span className="field-label">Layout</span>
                        <select
                          className="select-input"
                          value={draft.appearance.layout}
                          onChange={(event) =>
                            appearance(
                              'layout',
                              event.target
                                .value as Settings['appearance']['layout'],
                            )
                          }
                        >
                          <option value="balanced">Balanced</option>
                          <option value="minimal">Airy</option>
                          <option value="weather-first">Weather first</option>
                        </select>
                      </label>
                    </div>
                    <label className="color-setting">
                      Text color
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
                  </div>
                </details>
                <details className="disclosure">
                  <summary>
                    Saved styles<span>{draft.savedPresets.length || ''}</span>
                  </summary>
                  <div className="disclosure-body">
                    <label>
                      <span className="field-label">Saved style</span>
                      <select
                        className="select-input"
                        value={presetId}
                        onChange={(event) => choosePreset(event.target.value)}
                      >
                        <option value="">Choose…</option>
                        {draft.savedPresets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="field-label">Style name</span>
                      <input
                        className="text-input"
                        maxLength={60}
                        value={presetName}
                        onChange={(event) => setPresetName(event.target.value)}
                        placeholder="Evening"
                      />
                    </label>
                    <div className="preset-actions">
                      <button
                        className="button small"
                        disabled={
                          !presetName.trim() || draft.savedPresets.length >= 12
                        }
                        onClick={addPreset}
                      >
                        <Icon name="plus" size={14} />
                        Add style
                      </button>
                      {presetId && (
                        <>
                          <button
                            className="button small"
                            disabled={!presetName.trim()}
                            onClick={() =>
                              change((previous) => ({
                                ...previous,
                                savedPresets: previous.savedPresets.map(
                                  (preset) =>
                                    preset.id === presetId
                                      ? {
                                          ...preset,
                                          name: presetName.trim(),
                                          visual: getVisual(previous),
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
                            aria-label="Delete selected style"
                            onClick={() => {
                              change((previous) => ({
                                ...previous,
                                savedPresets: previous.savedPresets.filter(
                                  (preset) => preset.id !== presetId,
                                ),
                              }));
                              setPresetId('');
                              setPresetName('');
                            }}
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </details>
                <details className="disclosure">
                  <summary>Data & recovery</summary>
                  <div className="disclosure-body">
                    <a
                      className="button small"
                      href="/api/export"
                      download="still-backup.json"
                    >
                      <Icon name="download" size={15} />
                      Export saved data
                    </a>
                    <button
                      className="text-button reset-appearance"
                      onClick={() => {
                        change((previous) =>
                          applyBuiltinPreset(previous, 'room'),
                        );
                        setPresetId('');
                      }}
                    >
                      Reset appearance
                    </button>
                    <p className="hint">
                      Includes saved settings and reminders. Windows idle
                      activation is managed by the installed helper.
                    </p>
                  </div>
                </details>
              </>
            )}
            {section === 'Widgets' && (
              <>
                <h2>On your display</h2>
                <div className="widget-list">
                  {widgets.map((widget) => (
                    <div
                      key={widget.id}
                      className={`widget-option ${selectedWidget === widget.id ? 'selected' : ''}`}
                    >
                      <div className="widget-row">
                        <button
                          className="widget-select"
                          aria-expanded={selectedWidget === widget.id}
                          aria-controls={`widget-${widget.id}-controls`}
                          onClick={() =>
                            setSelectedWidget((previous) =>
                              previous === widget.id ? null : widget.id,
                            )
                          }
                        >
                          <span className="widget-icon">
                            <Icon name={widget.icon} size={18} />
                          </span>
                          {widget.label}
                          <span aria-hidden="true" className="row-chevron">
                            ›
                          </span>
                        </button>
                        <input
                          className="toggle"
                          aria-label={`Show ${widget.label}`}
                          type="checkbox"
                          checked={
                            draft.widgets[widget.id] &&
                            (widget.id !== 'preview' || draft.preview.enabled)
                          }
                          onChange={(event) =>
                            change((previous) => ({
                              ...previous,
                              widgets: {
                                ...previous.widgets,
                                [widget.id]: event.target.checked,
                              },
                              preview:
                                widget.id === 'preview'
                                  ? {
                                      ...previous.preview,
                                      enabled: event.target.checked,
                                    }
                                  : previous.preview,
                            }))
                          }
                        />
                      </div>
                      {selectedWidget === widget.id && (
                        <div
                          className="widget-inspector"
                          id={`widget-${widget.id}-controls`}
                        >
                          {widget.id === 'reminders' && (
                            <Toggle
                              label="Hide when empty"
                              checked={
                                draft.widgetBehavior.reminders.hideWhenEmpty
                              }
                              onChange={(hideWhenEmpty) =>
                                change((previous) => ({
                                  ...previous,
                                  widgetBehavior: {
                                    reminders: { hideWhenEmpty },
                                  },
                                }))
                              }
                            />
                          )}
                          {widget.id === 'clock' && (
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
                          )}
                          {widget.id === 'preview' && (
                            <>
                              <Range
                                label="Snapshot opacity"
                                min={2}
                                max={30}
                                value={Math.round(draft.preview.opacity * 100)}
                                display={`${Math.round(draft.preview.opacity * 100)}%`}
                                onChange={(value) =>
                                  change((previous) => ({
                                    ...previous,
                                    preview: {
                                      ...previous.preview,
                                      opacity: value / 100,
                                    },
                                  }))
                                }
                              />
                              <Range
                                label="Snapshot width"
                                min={12}
                                max={35}
                                value={draft.preview.widthPercent}
                                display={`${draft.preview.widthPercent}%`}
                                onChange={(value) =>
                                  change((previous) => ({
                                    ...previous,
                                    preview: {
                                      ...previous.preview,
                                      widthPercent: value,
                                    },
                                  }))
                                }
                              />
                              <p className="hint">
                                {state.preview.available
                                  ? 'Last capture is available.'
                                  : 'Captured when the Windows screensaver starts.'}{' '}
                                Kept in memory only.
                              </p>
                            </>
                          )}
                          <details className="position-disclosure">
                            <summary>Size & position</summary>
                            {(['scale', 'offsetX', 'offsetY'] as const).map(
                              (key) => (
                                <Range
                                  key={key}
                                  label={
                                    key === 'scale'
                                      ? 'Widget size'
                                      : key === 'offsetX'
                                        ? 'Horizontal'
                                        : 'Vertical'
                                  }
                                  min={key === 'scale' ? 50 : -25}
                                  max={key === 'scale' ? 200 : 25}
                                  value={
                                    key === 'scale'
                                      ? Math.round(
                                          draft.widgetOverrides[widget.id][
                                            key
                                          ] * 100,
                                        )
                                      : draft.widgetOverrides[widget.id][key]
                                  }
                                  display={`${key === 'scale' ? Math.round(draft.widgetOverrides[widget.id][key] * 100) : draft.widgetOverrides[widget.id][key]}%`}
                                  onChange={(value) =>
                                    change((previous) => ({
                                      ...previous,
                                      widgetOverrides: {
                                        ...previous.widgetOverrides,
                                        [widget.id]: {
                                          ...previous.widgetOverrides[
                                            widget.id
                                          ],
                                          [key]:
                                            key === 'scale'
                                              ? value / 100
                                              : value,
                                        },
                                      },
                                    }))
                                  }
                                />
                              ),
                            )}
                            <button
                              className="text-button"
                              onClick={() =>
                                change((previous) => ({
                                  ...previous,
                                  widgetOverrides: {
                                    ...previous.widgetOverrides,
                                    [widget.id]: {
                                      scale: 1,
                                      offsetX: 0,
                                      offsetY: 0,
                                    },
                                  },
                                }))
                              }
                            >
                              Reset size & position
                            </button>
                            <p className="hint">
                              Large offsets can crop content. Check all four
                              arrangements.
                            </p>
                          </details>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            {section === 'Weather' && (
              <>
                <h2>Weather location</h2>
                <div className="current-location">
                  <span className="location-icon">
                    <Icon name="location" size={21} />
                  </span>
                  <div>
                    <strong>{draft.location.name}</strong>
                    <span>
                      {draft.locationSource === 'device'
                        ? 'Approximate device area'
                        : draft.locationSource === 'fallback'
                          ? 'Toronto fallback'
                          : 'Manual city'}
                    </span>
                  </div>
                  {!same(saved.location, draft.location) && (
                    <span className="draft-badge">Draft</span>
                  )}
                </div>
                <button
                  className="button device-button"
                  disabled={locationBusy || saving}
                  onClick={() => {
                    void deviceLocation(false);
                  }}
                >
                  <Icon name="location" size={16} />
                  {locationBusy ? 'Finding your area…' : 'Use device location'}
                </button>
                <div className="city-field">
                  <label className="field-label" htmlFor="city-search">
                    City
                  </label>
                  <CitySearch
                    value={locationQuery}
                    onChange={setLocationQuery}
                    onSelect={selectCity}
                    disabled={saving}
                  />
                </div>
                <p className="inline-message" role="status">
                  {locationMessage || '\u00a0'}
                </p>
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
                <div className={`weather-status-row ${state.weather.status}`}>
                  <span className="status-dot" />
                  {state.weather.status === 'fresh'
                    ? ageLabel(state.weather.updatedAt)
                    : state.weather.status === 'stale'
                      ? `Saved forecast · ${ageLabel(state.weather.updatedAt).toLowerCase()}`
                      : 'Forecast unavailable'}
                </div>
                <p className="weather-credit">
                  Forecast estimates by{' '}
                  <a
                    href={state.weather.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open-Meteo
                  </a>
                </p>
                <details className="disclosure">
                  <summary>Location & forecast details</summary>
                  <div className="disclosure-body">
                    <p className="hint">
                      Device location uses one browser lookup. Only a rounded
                      weather area is kept. A chosen city overrides automatic
                      location. Changes apply after Save.
                    </p>
                    <p className="hint">
                      Hourly precipitation chance includes snow. Rain timing and
                      amounts are estimates and may change.
                      {state.weather.error ? ` ${state.weather.error}` : ''}
                    </p>
                  </div>
                </details>
              </>
            )}
            {section === 'Reminders' && (
              <>
                <div className="panel-heading">
                  <h2>Reminders</h2>
                  <button
                    className="icon-button add-reminder"
                    aria-label="Add reminder"
                    onClick={() => startReminder()}
                  >
                    <Icon name="plus" size={20} />
                  </button>
                </div>
                <p className="panel-subtitle">
                  Saved immediately · always silent
                </p>
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
                          <span>
                            {reminder.completed && (
                              <Icon name="check" size={13} />
                            )}
                          </span>
                        </button>
                        <div
                          className={`reminder-copy ${reminder.completed ? 'done' : ''}`}
                        >
                          <p>{reminder.text}</p>
                          <span>
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
                            <Icon name="edit" size={15} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Delete: ${reminder.text}`}
                            onClick={() => {
                              void deleteReminder(reminder.id);
                            }}
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="empty-reminders">
                    <span>
                      <Icon name="check" size={24} />
                    </span>
                    <h3>
                      {connectionError ? 'Reminders unavailable' : 'All clear'}
                    </h3>
                    <button
                      className="text-button"
                      onClick={() => startReminder()}
                    >
                      Add a reminder
                    </button>
                  </div>
                )}
                {completedCount > 0 && (
                  <button
                    className="text-button completed-toggle"
                    onClick={() => setShowCompleted(!showCompleted)}
                  >
                    {showCompleted ? 'Hide' : 'Show'} completed (
                    {completedCount})
                  </button>
                )}
                {reminderForm && (
                  <form
                    className="reminder-form"
                    onSubmit={(event) => {
                      void submitReminder(event);
                    }}
                  >
                    <label>
                      <span className="field-label">Reminder</span>
                      <input
                        autoFocus
                        className="text-input"
                        required
                        maxLength={240}
                        value={reminderText}
                        placeholder="What’s on your mind?"
                        onChange={(event) =>
                          setReminderText(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      <span className="field-label">
                        When{' '}
                        <span className="muted">(optional · local time)</span>
                      </span>
                      <input
                        className="text-input"
                        type="datetime-local"
                        value={reminderDue}
                        onChange={(event) => setReminderDue(event.target.value)}
                      />
                    </label>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="button"
                        disabled={reminderSaving}
                        onClick={() => setReminderForm(false)}
                      >
                        Cancel reminder
                      </button>
                      <button
                        className="button primary"
                        disabled={reminderSaving || !reminderText.trim()}
                      >
                        {reminderSaving ? 'Saving…' : 'Save reminder'}
                      </button>
                    </div>
                  </form>
                )}
                <p className="inline-message" role="status">
                  {reminderMessage || '\u00a0'}
                </p>
              </>
            )}
          </div>
        </aside>
        {(error || connectionError || state.storageWarning) && (
          <div className="studio-error" role="alert">
            {error || connectionError || state.storageWarning}
            {connectionError && (
              <button
                className="text-button"
                onClick={() => {
                  void reload();
                }}
              >
                Retry
              </button>
            )}
          </div>
        )}
      </main>
      <footer className={`studio-savebar ${dirty ? 'has-changes' : ''}`}>
        <span className="save-status" role="status">
          {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}
        </span>
        <div>
          <button
            className="button cancel-settings"
            disabled={!canCancel || saving}
            onClick={cancelChanges}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!dirty || saving || locationBusy}
            onClick={() => {
              void saveSettings();
            }}
          >
            {saving ? 'Saving…' : 'Save changes'}
            <Icon name="check" size={15} />
          </button>
        </div>
      </footer>
    </div>
  );
}
