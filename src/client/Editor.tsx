import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  AppState,
  LocationResult,
  Settings,
  WidgetGrid,
  WidgetId,
} from '../shared/contracts';
import { defaultSettings } from '../shared/defaults';
import { api } from './api';
import { AmbientDisplay } from './Display';
import {
  ageLabel,
  nextComposition,
} from './format';
import { Icon } from './icons';
import { applyBuiltinPreset, getVisual } from './model';
import { browserLocationPlatform, getDeviceLocation } from './location';
import {
  rebaseSettings,
  same,
  sameEffectiveSettings,
  settingsChanges,
} from './draft';
import { CitySearch } from './CitySearch';
import {
  GRID_DENSITIES,
  WIDGET_CATALOG,
  WIDGET_IDS,
  firstPlacement,
  fitWidgetFamily,
  reflowWidget,
  resizeWidgetSpan as resizeSpanGrid,
  switchGridDensity,
  type GridDensityHistory,
  type GridDensity,
  type WidgetSize,
  type WidgetSpan,
} from '../shared/widgets';
import { GridEditor } from './GridEditor';
import { WidgetInspector } from './WidgetInspector';
import { WIDGET_MODULES } from './widgets/registry';
import { preparePhoto, type PhotoDraft } from './photo';
import { RemindersPanel } from './RemindersPanel';
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
  const [section, setSection] = useState<Section>('Widgets');
  const [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [composition, setComposition] = useState<number | undefined>(0);
  const [movementPreview, setMovementPreview] = useState(false);
  const [selectedWidget, setSelectedWidget] = useState<WidgetId | null>(null);
  const [layoutEditing, setLayoutEditing] = useState(false),
    [pickerOpen, setPickerOpen] = useState(false);
  const [gridPreview, setGridPreview] = useState<WidgetGrid | null>(null),
    [gridMessage, setGridMessage] = useState('');
  const [gridEpoch, setGridEpoch] = useState(0);
  const densityHistory = useRef<GridDensityHistory | undefined>(undefined);
  const [gridGesture, setGridGesture] = useState<{ id: WidgetId; x: number; y: number; width?: number; height?: number } | null>(null);
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft | null | undefined>(),
    [photoBusy, setPhotoBusy] = useState(false);
  const photoDraftRef = useRef(photoDraft),
    photoEpoch = useRef(0),
    photoId = useRef(state.photo?.id ?? null);
  const [presetName, setPresetName] = useState(''),
    [presetId, setPresetId] = useState('');
  const [locationQuery, setLocationQuery] = useState(''),
    [locationMessage, setLocationMessage] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const locationEpoch = useRef(0),
    mounted = useRef(true),
    automaticAttempted = useRef(false),
    guardLocation = useRef(false);
  const savebar = useRef<HTMLElement>(null);
  const photoChanged =
    photoDraft !== undefined &&
    (photoDraft?.id ?? null) !== (state.photo?.id ?? null);
  const dirty = !sameEffectiveSettings(saved, draft) || photoChanged;
  // A widget module can block Save with a reason shown in the save bar.
  const draftProblem =
    WIDGET_IDS.map((id) => WIDGET_MODULES[id].draftProblem?.(draft) ?? null).find(
      (problem) => problem !== null,
    ) ?? null;
  function updateDraft(next: Settings) {
    draftRef.current = next;
    setDraft(next);
  }
  function change(update: (settings: Settings) => Settings) {
    updateDraft(update(draftRef.current));
    setError(null);
  }
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add('studio-editor');
    const measure = () => {
      if (!savebar.current) {
        root.style.setProperty('--studio-footer-clearance', '24px');
        return;
      }
      const bottom =
        Number.parseFloat(getComputedStyle(savebar.current).bottom) || 0;
      root.style.setProperty(
        '--studio-footer-clearance',
        `${savebar.current.getBoundingClientRect().height + bottom + 24}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    if (savebar.current) observer.observe(savebar.current);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      root.classList.remove('studio-editor');
      root.style.removeProperty('--studio-footer-clearance');
    };
  }, [dirty]);
  useEffect(() => {
    photoId.current = state.photo?.id ?? null;
  }, [state.photo?.id]);
  useEffect(
    () => () => {
      photoEpoch.current++;
    },
    [],
  );
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
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  function cancelChanges() {
    cancelPhoto();
    updatePhoto(undefined);
    setGridPreview(null);
    setGridEpoch(value => value + 1);
    setGridGesture(null);
    densityHistory.current = undefined;
    setGridMessage('');
    locationEpoch.current++;
    guardLocation.current = false;
    setLocationBusy(false);
    updateDraft(structuredClone(savedRef.current));
    setLocationQuery('');
    setLocationMessage('');
    setPresetId('');
    setPresetName('');
    setError(null);
  }
  function updatePhoto(value: PhotoDraft | null | undefined) {
    photoDraftRef.current = value;
    setPhotoDraft(value);
  }
  function cancelPhoto() {
    photoEpoch.current++;
    setPhotoBusy(false);
  }
  async function choosePhoto(file: File) {
    const epoch = ++photoEpoch.current;
    setPhotoBusy(true);
    setError(null);
    try {
      const photo = await preparePhoto(file);
      if (!mounted.current || epoch !== photoEpoch.current) {
        return;
      }
      if (photo.id === photoId.current) {
        updatePhoto(undefined);
      } else updatePhoto(photo);
    } catch (caught) {
      if (mounted.current && epoch === photoEpoch.current)
        setError(
          caught instanceof Error ? caught.message : 'Could not read photo',
        );
    } finally {
      if (mounted.current && epoch === photoEpoch.current) setPhotoBusy(false);
    }
  }
  function clearPhoto() {
    cancelPhoto();
    updatePhoto(state.photo?.available ? null : undefined);
  }
  function commitGrid(grid: WidgetGrid) {
    setGridMessage('');
    change((previous) => ({ ...previous, widgetGrid: grid }));
  }
  function addWidget(id: WidgetId, size: WidgetSize) {
    const placement = firstPlacement(
      draftRef.current.widgetGrid,
      id,
      size,
      draftRef.current.widgets,
    );
    const next = placement ? reflowWidget(
      draftRef.current.widgetGrid,
      id,
      placement,
      draftRef.current.widgets,
    ) : fitWidgetFamily(draftRef.current.widgetGrid, id, size, draftRef.current.widgets);
    if (!next) { setGridMessage('No room. Try a smaller size or finer grid.'); return; }
    change((previous) => ({
      ...previous,
      widgetGrid: next,
      widgets: { ...previous.widgets, [id]: true },
      preview:
        id === 'preview'
          ? { ...previous.preview, enabled: true }
          : previous.preview,
    }));
    setSelectedWidget(id);
    setPickerOpen(false);
    setLayoutEditing(true);
    setGridMessage(`${WIDGET_CATALOG[id].name} added`);
  }
  function removeWidget(id: WidgetId) {
    if (id === 'photo' && !savedRef.current.widgets.photo) {
      cancelPhoto();
      updatePhoto(undefined);
    }
    change((previous) => ({
      ...previous,
      widgets: { ...previous.widgets, [id]: false },
      preview:
        id === 'preview'
          ? { ...previous.preview, enabled: false }
          : previous.preview,
    }));
    setSelectedWidget(null);
    setGridMessage('');
  }
  function resizeWidget(id: WidgetId, size: WidgetSize) {
    const next = fitWidgetFamily(
      draftRef.current.widgetGrid,
      id,
      size,
      draftRef.current.widgets,
    );
    if (next) commitGrid(next);
    else setGridMessage('No room for that size');
  }
  function resizeWidgetSpan(id: WidgetId, span: WidgetSpan) {
    const next = resizeSpanGrid(
      draftRef.current.widgetGrid,
      id,
      span,
      draftRef.current.widgets,
    );
    if (next) commitGrid(next);
    else setGridMessage('No room for that size');
  }
  function moveWidget(id: WidgetId, dx: number, dy: number) {
    const original = draftRef.current.widgetGrid.placements[id];
    const next = reflowWidget(
      draftRef.current.widgetGrid,
      id,
      { ...original, column: original.column + dx, row: original.row + dy },
      draftRef.current.widgets,
    );
    if (next) commitGrid(next);
    else setGridMessage('No room there');
  }
  function density(value: GridDensity) {
    const next = switchGridDensity(
      draftRef.current.widgetGrid,
      value,
      draftRef.current.widgets,
      densityHistory.current,
    );
    if (next) {
      densityHistory.current = next.history;
      commitGrid(next.grid);
      if (next.resized.length) setGridMessage(`${next.resized.map(({ id, to }) => `${WIDGET_CATALOG[id].name} ${to}`).join(' · ')} to fit. Switch back to restore.`);
    }
    else
      setGridMessage('Not enough room. Keep this grid or use smaller widgets.');
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
      guardLocation.current = automatic;
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
        // Every failed-lookup fallback is guarded, even after an explicit action.
        guardLocation.current = true;
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
  function cancelLocation() {
    locationEpoch.current++;
    setLocationBusy(false);
    setLocationMessage('');
  }
  function selectCity(city: LocationResult) {
    locationEpoch.current++;
    setLocationBusy(false);
    guardLocation.current = false;
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
        guardLocation.current,
      );
    const submittedPhoto = photoDraftRef.current,
      submittedPhotoEpoch = photoEpoch.current;
    const includesPhoto =
      submittedPhoto !== undefined &&
      (submittedPhoto?.id ?? null) !== photoId.current;
    if (includesPhoto)
      patch.photoChange = submittedPhoto
        ? { pngBase64: submittedPhoto.pngBase64 }
        : null;
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
        previous
          ? {
              ...previous,
              settings: received,
              ...(includesPhoto
                ? {
                    photo: submittedPhoto
                      ? {
                          available: true,
                          id: submittedPhoto.id,
                          width: submittedPhoto.width,
                          height: submittedPhoto.height,
                          updatedAt: new Date().toISOString(),
                        }
                      : {
                          available: false,
                          id: null,
                          width: null,
                          height: null,
                          updatedAt: null,
                        },
                  }
                : {}),
            }
          : previous,
      );
      if (includesPhoto && submittedPhotoEpoch === photoEpoch.current) {
        photoId.current = submittedPhoto?.id ?? null;
        updatePhoto(undefined);
      }
      guardLocation.current = false;
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
  const pendingCount = state.reminders.filter((item) => !item.completed).length;
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
            <div className="canvas-heading-actions">
            <button
              className={`button small edit-layout ${layoutEditing ? 'active' : ''}`}
              aria-pressed={layoutEditing}
              onClick={() => {
                setLayoutEditing((value) => !value);
                setGridPreview(null);
                setGridGesture(null);
                setMovementPreview(false);
                setGridMessage('');
                if (!layoutEditing) setSection('Widgets');
              }}
            >
              <Icon name={layoutEditing ? 'check' : 'edit'} size={15} />
              {layoutEditing ? 'Done' : 'Edit layout'}
            </button>
            <button className="icon-button canvas-add" aria-label="Add widget to display" title="Add widget" onClick={() => {
              setSection('Widgets'); setPickerOpen(true); setLayoutEditing(true); setMovementPreview(false);
            }}><Icon name="plus" size={20} /></button>
            </div>
          </div>
          <div className="preview-frame">
            <div className="preview-screen">
              <AmbientDisplay
                state={state}
                settings={
                  gridPreview ? { ...draft, widgetGrid: gridPreview } : draft
                }
                embedded
                disconnected={connectionError !== null}
                compositionOverride={composition}
                layoutEditing={layoutEditing || !movementPreview}
                gesture={gridGesture}
                photoPreview={
                  photoDraft === undefined
                    ? undefined
                    : (photoDraft?.url ?? null)
                }
              />
              {layoutEditing && (
                <GridEditor
                  key={gridEpoch}
                  settings={draft}
                  selected={selectedWidget}
                  onSelect={(id) => {
                    setSelectedWidget(id);
                    setSection('Widgets');
                    setPickerOpen(false);
                  }}
                  onPreview={(grid, gesture) => { setGridPreview(grid); setGridGesture(gesture ?? null); }}
                  onCommit={commitGrid}
                  onMessage={setGridMessage}
                />
              )}
            </div>
          </div>
          <div className="canvas-toolbar">
            <span>{layoutEditing ? 'Drag to move · pull corner to resize' : 'Your saved arrangement'}</span>
            {layoutEditing ? (
              <label className="grid-density-control">
                <span className="sr-only">Grid density</span>
                <select
                  className="select-input"
                  aria-label="Grid density"
                  value={draft.widgetGrid.density}
                  onChange={(event) =>
                    density(event.target.value as GridDensity)
                  }
                >
                  {Object.entries(GRID_DENSITIES).map(([id, grid]) => (
                    <option key={id} value={id}>
                      {grid.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <button className={`button small movement-preview ${movementPreview ? 'active' : ''}`} aria-pressed={movementPreview} onClick={() => setMovementPreview(value => !value)}>
                  <Icon name={movementPreview ? 'check' : 'refresh'} size={15} />{movementPreview ? 'Back to layout' : 'Preview movement'}
                </button>
                {movementPreview && <>
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
                      composition === undefined
                        ? 'automatic active'
                        : 'automatic'
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
                </>}
              </>
            )}
          </div>
          <p
            className="grid-status"
            role={section === 'Widgets' ? undefined : 'status'}
          >
            {gridMessage}
          </p>
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
                    Soft motion
                    <span>{draft.appearance.motionEnabled ? 'On' : 'Off'}</span>
                  </summary>
                  <div className="disclosure-body">
                    <Toggle
                      label="Soft motion"
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
                      Reduced motion removes drift. Widgets still change places
                      through black.
                    </p>
                  </div>
                </details>
                <details className="disclosure">
                  <summary>Typography</summary>
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
              <WidgetInspector
                message={gridMessage}
                settings={draft}
                selected={selectedWidget}
                onSelect={setSelectedWidget}
                pickerOpen={pickerOpen}
                onPicker={setPickerOpen}
                onAdd={addWidget}
                onRemove={removeWidget}
                onResize={resizeWidget}
                onResizeSpan={resizeWidgetSpan}
                onMove={moveWidget}
                onChange={change}
                saving={saving}
                photoAvailable={
                  photoDraft === undefined
                    ? !!state.photo?.available
                    : !!photoDraft
                }
                photoBusy={photoBusy}
                onPhotoFile={(file) => {
                  void choosePhoto(file);
                }}
                onPhotoClear={clearPhoto}
                onPhotoCancel={cancelPhoto}
              />
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
                          ? 'Default location'
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
                {locationBusy && (
                  <button className="text-button" onClick={cancelLocation}>
                    Cancel lookup
                  </button>
                )}
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
              <RemindersPanel
                state={state}
                setState={setState}
                connectionError={connectionError}
                clockFormat={draft.clockFormat}
                onError={setError}
              />
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
      {dirty && (
        <footer
          ref={savebar}
          className={`studio-savebar ${dirty ? 'has-changes' : ''}`}
        >
          <span className="save-status" role="status">
            {saving
              ? 'Saving…'
              : (draftProblem ?? (dirty ? 'Unsaved changes' : 'Saved'))}
          </span>
          <div>
            <button
              className="button cancel-settings"
              disabled={saving}
              onClick={cancelChanges}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={
                !dirty || saving || locationBusy || photoBusy || !!draftProblem
              }
              onClick={() => {
                void saveSettings();
              }}
            >
              {saving ? 'Saving…' : 'Save changes'}
              <Icon name="check" size={15} />
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
