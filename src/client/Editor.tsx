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
  DaylightBrightness,
  LocationResult,
  Settings,
  WidgetGrid,
  WidgetId,
} from '../shared/contracts';
import { defaultSettings } from '../shared/defaults';
import { ACCENT_SWATCHES, NATIVE_PALETTE, accentSwatch } from '../shared/palette';
import { NETWORK_ERROR_MESSAGE, api, isNetworkError } from './api';
import {
  BACKUP_MAX_BYTES,
  BackupError,
  backupContents,
  backupDate,
  parseBackup,
  type BackupFile,
} from './backup';
import { AmbientDisplay } from './Display';
import {
  ageLabel,
  nextComposition,
} from './format';
import { Icon } from './icons';
import {
  BUILTIN_PRESETS,
  applyBuiltinPreset,
  builtinLook,
  getVisual,
  matchingBuiltinPreset,
  reminderPresentation,
  resetAppearance,
} from './model';
import { browserLocationPlatform, getDeviceLocation } from './location';
import { defaultDaylightRange } from './daylight';
import { DaylightStatus } from './DaylightStatus';
import {
  rebaseSettings,
  same,
  sameEffectiveSettings,
  settingsChanges,
} from './draft';
import { CitySearch } from './CitySearch';
import { useAirQualityPreview } from './airPreview';
import {
  GRID_DENSITIES,
  WIDGET_CATALOG,
  WIDGET_IDS,
  fitWidgetFamily,
  isActiveWidget,
  isFreeSize,
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
import { ANIMATION_LABELS, ANIMATION_LEVELS, usePrefersReducedMotion } from './useMotion';
import { WIDGET_MODULES } from './widgets/registry';
import { preparePhoto, type PhotoDraft } from './photo';
import { RemindersPanel } from './RemindersPanel';
import { FirstRunCard, readFirstRunDismissed, rememberFirstRunDismissed } from './FirstRunCard';
import {
  addToGrid,
  applyRoomFix,
  fulfilRequest,
  roomFixResult,
  roomProblem as diagnoseRoomProblem,
  type RoomFix,
  type RoomProblem,
  type RoomRequest,
} from './make-room';
const sections = ['Style', 'Widgets', 'Weather', 'Reminders'] as const;
/** A check mark colour that stays visible on any custom accent swatch. */
function readableMark(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.18 ? '#24222d' : '#ece8f4';
}
type Section = (typeof sections)[number];
/** Feedback for one action (Save, a photo, a reminder): the next successful action clears it. */
interface ActionError {
  text: string;
  /** Caused by a lost connection: a later successful state request clears it (#232). */
  network: boolean;
  /** `performance.now()` when it failed, compared with `serverReachedAt`. */
  at: number;
}
interface StudioAlert {
  key: string;
  text: string;
  kind: 'action' | 'connection' | 'storage';
}

const ACTIVE_TAB = '.inspector-tabs [role="tab"][aria-selected="true"]';

/** Focus the first selector that matches a connected, enabled, rendered element. */
function focusFirst(candidates: (string | HTMLElement | null | undefined)[]): boolean {
  for (const candidate of candidates) {
    const element =
      typeof candidate === 'string'
        ? document.querySelector<HTMLElement>(candidate)
        : candidate;
    if (
      element?.isConnected &&
      !element.matches(':disabled') &&
      element.getClientRects().length
    ) {
      element.focus();
      return true;
    }
  }
  return false;
}

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
  extra,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  display?: string;
  /** A control on the label line, before the value (Brightness's mode, #439). */
  extra?: React.ReactNode;
}) {
  // A label names its first labelable descendant, so a block with its own control on the label line
  // is a div; the slider keeps its aria-label name (#466 review).
  const Block = extra ? 'div' : 'label';
  return (
    <Block className="control-block">
      <span className="control-label">
        <span>{label}</span>
        {extra}
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
    </Block>
  );
}

export function Editor({
  state,
  setState,
  connectionError,
  serverReachedAt,
  reload,
}: {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState | null>>;
  connectionError: string | null;
  /** `performance.now()` when the latest state request that reached the server was sent. */
  serverReachedAt: number;
  reload: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(() => structuredClone(state.settings));
  const [draft, setDraft] = useState(() => structuredClone(state.settings));
  const savedRef = useRef(saved),
    draftRef = useRef(draft);
  const [section, setSection] = useState<Section>('Widgets');
  const [saving, setSaving] = useState(false),
    [error, setErrorState] = useState<ActionError | null>(null);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  // #229: an always-mounted live region reports Save/Cancel after the Save bar unmounts.
  const [announcement, setAnnouncement] = useState('');
  const lastEdited = useRef<HTMLElement | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    candidates: (string | HTMLElement | null)[];
    /** Only move focus when it was lost (to the page) or is still in the Save bar. */
    onlyIfLost: boolean;
  } | null>(null);
  function setError(message: string | null, network = message === NETWORK_ERROR_MESSAGE) {
    setErrorState(
      message === null ? null : { text: message, network, at: performance.now() },
    );
  }
  const [composition, setComposition] = useState<number | undefined>(0);
  const [movementPreview, setMovementPreview] = useState(false);
  const [selectedWidget, setSelectedWidget] = useState<WidgetId | null>(null);
  const [layoutEditing, setLayoutEditing] = useState(false),
    [pickerOpen, setPickerOpen] = useState(false);
  const [gridPreview, setGridPreview] = useState<WidgetGrid | null>(null),
    [gridMessage, setGridMessage] = useState('');
  const [gridEpoch, setGridEpoch] = useState(0);
  // A resize with no room explains itself beside that widget's size controls (#183).
  const [roomProblem, setRoomProblem] = useState<RoomProblem | null>(null);
  // #252: the first-run location card; dismissal lives in this browser only.
  const [firstRunDismissed, setFirstRunDismissed] = useState(readFirstRunDismissed);
  const [cityFocus, setCityFocus] = useState(0);
  useEffect(() => {
    // "Choose a city" opens the Weather tab with the city field focused.
    if (cityFocus) document.getElementById('city-search')?.focus();
  }, [cityFocus]);
  const densityHistory = useRef<GridDensityHistory | undefined>(undefined);
  const [gridGesture, setGridGesture] = useState<{ id: WidgetId; x: number; y: number; width?: number; height?: number } | null>(null);
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft | null | undefined>(),
    [photoBusy, setPhotoBusy] = useState(false);
  const photoDraftRef = useRef(photoDraft),
    photoEpoch = useRef(0),
    photoId = useRef(state.photo?.id ?? null);
  const [presetName, setPresetName] = useState(''),
    [presetId, setPresetId] = useState('');
  // Style → Data & recovery (#234): a checked backup awaiting confirmation, the section's status
  // line, an import in flight and the inline Reset appearance question.
  const [backup, setBackup] = useState<BackupFile | null>(null),
    [dataMessage, setDataMessage] = useState<{ text: string; error?: boolean } | null>(null),
    [restoring, setRestoring] = useState(false),
    [confirmReset, setConfirmReset] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);
  const [locationQuery, setLocationQuery] = useState(''),
    [locationMessage, setLocationMessage] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const locationEpoch = useRef(0),
    mounted = useRef(true),
    automaticAttempted = useRef(false),
    guardLocation = useRef(false);
  const savebar = useRef<HTMLElement>(null);
  // #76: the editor's own reduced-motion preference turns its animation off; the canvas replays
  // the entrance once after a level is chosen.
  const editorReducedMotion = usePrefersReducedMotion();
  const [revealNonce, setRevealNonce] = useState(0);
  const photoChanged =
    photoDraft !== undefined &&
    (photoDraft?.id ?? null) !== (state.photo?.id ?? null);
  const dirty = !sameEffectiveSettings(saved, draft) || photoChanged;
  const airPreview = useAirQualityPreview(draft, state.airQuality);
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
    setAnnouncement('');
    // Save and Cancel return focus here (#229) while it is still on screen.
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      active.closest('.studio-workspace')
    )
      lastEdited.current = active;
  }
  // Save/Cancel/Remove unmount the control that had focus; move it after the DOM commits.
  useEffect(() => {
    if (!focusRequest) return;
    setFocusRequest(null);
    const active = document.activeElement;
    if (
      focusRequest.onlyIfLost &&
      active &&
      active !== document.body &&
      active.isConnected &&
      !savebar.current?.contains(active)
    )
      return;
    focusFirst(focusRequest.candidates);
  }, [focusRequest]);
  // A failure caused by a lost connection clears once a later state request reaches the server.
  useEffect(() => {
    setErrorState((current) =>
      current?.network && serverReachedAt > current.at ? null : current,
    );
  }, [serverReachedAt]);
  // A lost connection's Retry offer replaces a network failure saying the same thing.
  const alerts: StudioAlert[] = [];
  if (error && !(error.network && connectionError))
    alerts.push({ key: `action:${error.text}`, text: error.text, kind: 'action' });
  if (connectionError)
    alerts.push({ key: `connection:${connectionError}`, text: connectionError, kind: 'connection' });
  if (state.storageWarning)
    alerts.push({ key: `storage:${state.storageWarning}`, text: state.storageWarning, kind: 'storage' });
  const alertKeys = alerts.map((item) => item.key).join('\n');
  // A dismissed connection or storage alert shows again once it has gone away and come back.
  useEffect(() => {
    const present = alertKeys.split('\n');
    setDismissedAlerts((keys) =>
      keys.every((key) => present.includes(key))
        ? keys
        : keys.filter((key) => present.includes(key)),
    );
  }, [alertKeys]);
  const alert = alerts.find((item) => !dismissedAlerts.includes(item.key));
  function dismissAlert(item: StudioAlert) {
    if (item.kind === 'action') setError(null);
    else setDismissedAlerts((keys) => [...keys, item.key]);
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
  /** Puts the draft and its local editing state back to the saved settings. */
  function resetDraft() {
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
  function cancelChanges() {
    resetDraft();
    setAnnouncement(
      announcement === 'Changes discarded' ? 'Changes discarded ' : 'Changes discarded',
    );
    restoreFocusAfterSaveBar();
  }
  /** After Save or Cancel: the last edited control while it is still shown, else the active tab. */
  function restoreFocusAfterSaveBar() {
    setFocusRequest({
      candidates: [lastEdited.current, ACTIVE_TAB],
      onlyIfLost: true,
    });
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
  /** The no-room explanation for a request on the current draft (#183, #238). */
  function explainNoRoom(request: RoomRequest): RoomProblem {
    const grid = draftRef.current.widgetGrid, enabled = draftRef.current.widgets;
    return diagnoseRoomProblem(grid, request, enabled)
      ?? { request, grid, enabled: { ...enabled }, blockers: [], fixes: [], message: 'Layout changed. Try again.' };
  }
  function finishAdd(id: WidgetId, grid: WidgetGrid, message: string) {
    change((previous) => ({
      ...previous,
      widgetGrid: grid,
      widgets: { ...previous.widgets, [id]: true },
      preview:
        id === 'preview'
          ? { ...previous.preview, enabled: true }
          : previous.preview,
    }));
    setSelectedWidget(id);
    setPickerOpen(false);
    setLayoutEditing(true);
    setRoomProblem(null);
    setGridMessage(message);
  }
  /** Adds a widget as a draft; the picker shows the returned explanation when it has no room. */
  function addWidget(id: WidgetId, size: WidgetSize): RoomProblem | null {
    const next = addToGrid(draftRef.current.widgetGrid, id, size, draftRef.current.widgets);
    if (!next) return explainNoRoom({ kind: 'add', id, size });
    finishAdd(id, next, `${WIDGET_CATALOG[id].name} added`);
    return null;
  }
  /** Applies a no-room fix and its request as one draft edit; Cancel restores the board. */
  function applyFix(problem: RoomProblem, fix: RoomFix): RoomProblem | null {
    const { request } = problem, enabled = draftRef.current.widgets;
    const grid = draftRef.current.widgetGrid;
    const fixed = applyRoomFix(grid, request, fix, enabled);
    // The draft may have changed since the explanation; a request that now fits needs no fix.
    const next = fixed ?? fulfilRequest(grid, request, enabled);
    if (!next) {
      const fresh = explainNoRoom(request);
      if (request.kind !== 'add') setRoomProblem(fresh);
      return fresh;
    }
    const message = fixed ? roomFixResult(request, fix, next) : `${WIDGET_CATALOG[request.id].name} ${request.kind === 'add' ? 'added' : 'resized'}`;
    if (request.kind === 'add') finishAdd(request.id, next, message);
    else {
      commitGrid(next);
      setRoomProblem(null);
      setGridMessage(message);
    }
    return null;
  }
  function reportNoRoom(request: RoomRequest) {
    setRoomProblem(explainNoRoom(request));
    setGridMessage('');
  }
  function removeWidget(id: WidgetId) {
    // #229: the removed row's buttons unmount; keyboard focus moves to the next row (else the
    // previous one), or to Add widget when none remains. Rows follow the inspector's list order.
    const rows = WIDGET_IDS.filter(
      (item) => isActiveWidget(item) && draftRef.current.widgets[item],
    );
    const index = rows.indexOf(id);
    const neighbour = index < 0 ? undefined : (rows[index + 1] ?? rows[index - 1]);
    setFocusRequest({
      candidates: [
        neighbour
          ? `.widget-list .widget-select[aria-label="${CSS.escape(WIDGET_CATALOG[neighbour].name)}"]`
          : null,
        '.panel-heading .add-widget',
        ACTIVE_TAB,
      ],
      onlyIfLost: true,
    });
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
    setGridMessage(`${WIDGET_CATALOG[id].name} removed`);
  }
  function resizeWidget(id: WidgetId, size: WidgetSize) {
    const next = fitWidgetFamily(
      draftRef.current.widgetGrid,
      id,
      size,
      draftRef.current.widgets,
    );
    if (next) { commitGrid(next); setRoomProblem(null); }
    else reportNoRoom({ kind: 'family', id, size });
  }
  function resizeWidgetSpan(id: WidgetId, span: WidgetSpan) {
    const next = resizeSpanGrid(
      draftRef.current.widgetGrid,
      id,
      span,
      draftRef.current.widgets,
    );
    if (next) { commitGrid(next); setRoomProblem(null); }
    else if (isFreeSize(id)) reportNoRoom({ kind: 'span', id, span });
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
      // A dropped custom size is named, e.g. "Reminders 2 × 8 → small" (#152).
      if (next.resized.length) setGridMessage(`${next.resized.map(({ id, to, span }) => `${WIDGET_CATALOG[id].name} ${span ? `${span.columns} × ${span.rows} → ` : ''}${to}`).join(' · ')} to fit. Switch back to restore.`);
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
  // Brightness mode (#439). Like Animation it is not part of a look, so the style label stays.
  // Fixed ↔ Follow daylight in one session returns to the last range chosen here.
  const lastDaylight = useRef<DaylightBrightness | null>(
    state.settings.appearance.daylightBrightness,
  );
  const brightnessModeFocus = useRef(false);
  function setDaylightBrightness(range: DaylightBrightness | null) {
    change((previous) => ({
      ...previous,
      appearance: { ...previous.appearance, daylightBrightness: range },
    }));
  }
  function brightnessMode(daylight: boolean) {
    const current = draftRef.current.appearance.daylightBrightness;
    if (daylight === !!current) return;
    if (current) lastDaylight.current = current;
    brightnessModeFocus.current = true;
    setDaylightBrightness(
      daylight
        ? (lastDaylight.current ??
            defaultDaylightRange(draftRef.current.appearance.brightness))
        : null,
    );
  }
  /** Moving one end past the other carries the other along, so Dimmest never exceeds Brightest. */
  function daylightEnd(end: keyof DaylightBrightness, value: number) {
    const range = draftRef.current.appearance.daylightBrightness;
    if (!range) return;
    setDaylightBrightness(
      end === 'dimmest'
        ? { dimmest: value, brightest: Math.max(value, range.brightest) }
        : { dimmest: Math.min(value, range.dimmest), brightest: value },
    );
  }
  const followDaylight = draft.appearance.daylightBrightness !== null;
  // The mode buttons move between the Fixed slider's label line and the daylight group; keep focus
  // on the pressed one, and let Save or Cancel return to it (#229).
  useLayoutEffect(() => {
    if (!brightnessModeFocus.current) return;
    brightnessModeFocus.current = false;
    const pressed = document.getElementById(
      followDaylight ? 'brightness-mode-daylight' : 'brightness-mode-fixed',
    );
    if (pressed) {
      pressed.focus();
      lastEdited.current = pressed;
    }
  }, [followDaylight]);
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
      setAnnouncement(
        announcement === 'Changes saved' ? 'Changes saved ' : 'Changes saved',
      );
      restoreFocusAfterSaveBar();
      void reload();
    } catch (caught) {
      if (mounted.current) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not save. Try again.',
          isNetworkError(caught),
        );
        // The Save button was disabled while saving; give focus back to it for a retry.
        setFocusRequest({
          candidates: ['.studio-savebar .button.primary', lastEdited.current, ACTIVE_TAB],
          onlyIfLost: true,
        });
      }
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
  // Data & recovery questions belong to the Style tab; leaving it drops them.
  useEffect(() => {
    if (section === 'Style') return;
    setBackup(null);
    setConfirmReset(false);
    setDataMessage(null);
  }, [section]);
  const unsavedBeforeRestore = 'Save or cancel your changes before restoring a backup.';
  /** Restore from backup (#234): refused while edits are unsaved, which a restore would otherwise mix in. */
  function chooseBackup() {
    setConfirmReset(false);
    setBackup(null);
    if (dirty || saving) {
      setDataMessage({ text: unsavedBeforeRestore, error: true });
      return;
    }
    setDataMessage(null);
    backupInput.current?.click();
  }
  async function readBackup(file: File) {
    try {
      if (file.size > BACKUP_MAX_BYTES)
        throw new BackupError(
          'That file is too large to be a backup. Choose one made with Export saved data.',
        );
      const parsed = parseBackup(await file.text());
      if (!mounted.current) return;
      setBackup(parsed);
      setDataMessage(null);
    } catch (caught) {
      if (!mounted.current) return;
      setBackup(null);
      setDataMessage({
        text: caught instanceof BackupError ? caught.message : 'Could not read that file.',
        error: true,
      });
    }
  }
  async function restoreBackup() {
    const chosen = backup;
    if (!chosen || restoring) return;
    if (dirty || saving) {
      setDataMessage({ text: unsavedBeforeRestore, error: true });
      return;
    }
    setRestoring(true);
    setDataMessage({ text: 'Restoring…' });
    try {
      // The server validates it again and keeps the replaced state as state.backup.json.
      await api('/api/import', { method: 'POST', body: JSON.stringify(chosen) });
      if (!mounted.current) return;
      setBackup(null);
      // The draft is clean, so the refreshed state replaces it; local photo, grid and style form state go too.
      // Not cancelChanges(): nothing was discarded, so there is no "Changes discarded" announcement.
      resetDraft();
      setDataMessage({ text: `Backup restored: ${backupContents(chosen)}.` });
      await reload();
    } catch (caught) {
      if (mounted.current)
        setDataMessage({
          text: `Could not restore the backup. ${caught instanceof Error ? caught.message : ''}`.trim(),
          error: true,
        });
    } finally {
      if (mounted.current) setRestoring(false);
    }
  }
  function confirmResetAppearance() {
    const after = resetAppearance(draftRef.current);
    setConfirmReset(false);
    setPresetId('');
    change(() => after);
    setDataMessage({
      text: sameEffectiveSettings(savedRef.current, after)
        ? 'Appearance is back to the defaults.'
        : 'Appearance reset. Save changes to keep it.',
    });
  }
  const pendingCount = state.reminders.filter((item) => !item.completed).length;
  // The built-in style whose look is showing (#153): pressed whenever applying it changes nothing.
  const lookPreset = matchingBuiltinPreset(draft.appearance);
  // #151: the kept custom colour (the draft's, else the saved one), selectable again after Native.
  // A built-in style's own single colour is not one the user chose, so it is offered only while it
  // is the accent (for example older data that applied Night before Native colours).
  const customAccent =
    draft.appearance.accentMode === 'color' && !accentSwatch(draft.appearance.accentColor)
      ? draft.appearance.accentColor
      : ([draft.appearance.accentColor, saved.appearance.accentColor].find(
          (color) =>
            !accentSwatch(color) &&
            !BUILTIN_PRESETS.some(
              (preset) => builtinLook(preset).accentColor === color.toLowerCase(),
            ),
        ) ?? null);
  const customActive =
    customAccent !== null &&
    draft.appearance.accentMode === 'color' &&
    draft.appearance.accentColor.toLowerCase() === customAccent.toLowerCase();
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
    <div
      className="studio"
      data-animation={editorReducedMotion ? 'off' : draft.appearance.animation}
    >
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
                setError(null);
                if (!layoutEditing) setSection('Widgets');
              }}
            >
              <Icon name={layoutEditing ? 'check' : 'edit'} size={15} />
              {layoutEditing ? 'Done' : 'Edit layout'}
            </button>
            <button className="icon-button canvas-add" aria-label="Add widget to display" title="Add widget" onClick={() => {
              setSection('Widgets'); setPickerOpen(true); setLayoutEditing(true); setMovementPreview(false); setError(null);
            }}><Icon name="plus" size={20} /></button>
            </div>
          </div>
          <div className="canvas-stage">
          <div className="preview-frame">
            <div className="preview-screen">
              <AmbientDisplay
                state={{ ...state, airQuality: airPreview ?? state.airQuality }}
                settings={
                  gridPreview ? { ...draft, widgetGrid: gridPreview } : draft
                }
                embedded
                disconnected={connectionError !== null}
                compositionOverride={composition}
                layoutEditing={layoutEditing || !movementPreview}
                gesture={gridGesture}
                motionSurface={layoutEditing ? 'editing' : 'preview'}
                revealNonce={revealNonce}
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
                <button className={`button small movement-preview ${movementPreview ? 'active' : ''}`} aria-pressed={movementPreview} onClick={() => { setMovementPreview(value => !value); setError(null); }}>
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
          {/* One reserved line for layout messages and the weather note (#231). */}
          <div className="canvas-messages">
            <p
              className="grid-status"
              role={section === 'Widgets' ? undefined : 'status'}
            >
              {gridMessage}
            </p>
            {/* Always mounted, so a screen reader announces the note when it appears. */}
            <p className="canvas-note" role="status">
              {weatherPending
                ? `Weather updates after Save · preview still shows ${state.weather.location.name}`
                : weatherRefreshing
                  ? `Updating weather · preview still shows ${state.weather.location.name}`
                  : ''}
            </p>
          </div>
          {/* #227: the alert has its own row below the canvas actions and never covers them. */}
          {alert && (
            <div className={`studio-error studio-error-${alert.kind}`}>
              <p role="alert">{alert.text}</p>
              <div className="studio-error-actions">
                {alert.kind === 'connection' && (
                  <button
                    className="text-button"
                    onClick={() => {
                      void reload();
                    }}
                  >
                    Retry
                  </button>
                )}
                <button
                  className="icon-button studio-error-dismiss"
                  aria-label="Dismiss message"
                  title="Dismiss"
                  onClick={() => {
                    dismissAlert(alert);
                    setFocusRequest({
                      candidates: ['.studio-error-dismiss', '.canvas-toolbar button', ACTIVE_TAB],
                      onlyIfLost: true,
                    });
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            </div>
          )}
        </section>
        <aside className="inspector" aria-label="Display settings">
          {/* Shown with the default Widgets tab only: Style has no spare height at 1280×720, Weather
              holds the same actions, and the picker is a focused mode. */}
          {saved.locationSource === 'fallback' && !firstRunDismissed && section === 'Widgets' && !pickerOpen && (
            <FirstRunCard
              place={saved.location.name}
              draft={draft.locationSource === 'fallback' ? null : draft.locationSource === 'device' ? 'Your area' : draft.location.name}
              busy={locationBusy}
              saving={saving}
              message={locationMessage}
              onUseLocation={() => {
                void deviceLocation(false);
              }}
              onChooseCity={() => {
                setSection('Weather');
                setCityFocus((value) => value + 1);
              }}
              onDismiss={() => {
                rememberFirstRunDismissed();
                setFirstRunDismissed(true);
              }}
            />
          )}
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
                // The count is named, “Reminders, 8 pending” (#241); the visible count stays compact.
                aria-label={name === 'Reminders' && pendingCount > 0 ? `Reminders, ${pendingCount} pending` : undefined}
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
                  <span className="tab-count" aria-hidden="true">{pendingCount}</span>
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
                  {BUILTIN_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      className={`preset-button ${lookPreset === preset ? 'active' : ''}`}
                      aria-pressed={lookPreset === preset}
                      title="Sets brightness, colours and typeface; widgets, Text size and motion stay"
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
                        {(['time', 'sky', 'personal'] as const).map((role) => (
                          <i
                            key={role}
                            style={
                              { '--bar': NATIVE_PALETTE[role].hex } as React.CSSProperties
                            }
                          />
                        ))}
                      </span>
                      <span className="preset-label">
                        {preset[0].toUpperCase() + preset.slice(1)}
                        {lookPreset === preset && (
                          <Icon name="check" size={13} />
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                {/* #439: Fixed (one level) or Follow daylight (Dimmest to Brightest, peaking at
                    solar noon). The mode sits on the label line, so the default Fixed tab keeps
                    its height at 1280×720. */}
                {(() => {
                  const modes = (
                    <span
                      className="brightness-mode"
                      role="group"
                      aria-label="Brightness mode"
                    >
                      <button
                        type="button"
                        id="brightness-mode-fixed"
                        aria-pressed={!followDaylight}
                        onClick={() => brightnessMode(false)}
                      >
                        Fixed
                      </button>
                      <button
                        type="button"
                        id="brightness-mode-daylight"
                        aria-pressed={followDaylight}
                        onClick={() => brightnessMode(true)}
                      >
                        Follow daylight
                      </button>
                    </span>
                  );
                  const range = draft.appearance.daylightBrightness;
                  if (!range)
                    return (
                      <Range
                        label="Brightness"
                        min={10}
                        max={100}
                        value={Math.round(draft.appearance.brightness * 100)}
                        display={`${Math.round(draft.appearance.brightness * 100)}%`}
                        onChange={(value) => appearance('brightness', value / 100)}
                        extra={modes}
                      />
                    );
                  const dimmest = Math.round(range.dimmest * 100),
                    brightest = Math.round(range.brightest * 100);
                  return (
                    <div
                      className="control-block brightness-daylight"
                      role="group"
                      aria-labelledby="brightness-daylight-label"
                    >
                      <span className="control-label">
                        <span id="brightness-daylight-label">Brightness</span>
                        {modes}
                        <output>
                          {dimmest === brightest ? `${dimmest}%` : `${dimmest}–${brightest}%`}
                        </output>
                      </span>
                      <Range
                        label="Dimmest"
                        min={10}
                        max={100}
                        value={dimmest}
                        display={`${dimmest}%`}
                        onChange={(value) => daylightEnd('dimmest', value / 100)}
                      />
                      <Range
                        label="Brightest"
                        min={10}
                        max={100}
                        value={brightest}
                        display={`${brightest}%`}
                        onChange={(value) => daylightEnd('brightest', value / 100)}
                      />
                      <DaylightStatus
                        range={range}
                        settings={draft}
                        weatherZone={state.weather.location.timezone}
                      />
                    </div>
                  );
                })()}
                <Range
                  label="Text size"
                  min={70}
                  max={150}
                  value={Math.round(draft.appearance.fontScale * 100)}
                  display={`${Math.round(draft.appearance.fontScale * 100)}%`}
                  onChange={(value) => appearance('fontScale', value / 100)}
                />
                <div className="inspector-group">
                  {/* #137: the custom colour picker rides on the heading line, so the row keeps
                      44 px targets on one line at 1280×720 even with a kept custom colour. */}
                  <div className="accent-heading">
                    <h3>
                      Accent{' '}
                      <span className="accent-current">
                        {draft.appearance.accentMode === 'native'
                          ? 'Native'
                          : (accentSwatch(draft.appearance.accentColor)?.name ?? 'Custom')}
                      </span>
                    </h3>
                    <label className="custom-color" title="Choose a custom colour">
                      <input
                        type="color"
                        aria-label="Custom accent color"
                        value={draft.appearance.accentColor}
                        onChange={(event) => {
                          const accentColor = event.target.value;
                          change((previous) => ({
                            ...previous,
                            appearance: {
                              ...previous.appearance,
                              accentMode: 'color',
                              accentColor,
                              preset: 'custom',
                            },
                          }));
                        }}
                      />
                      <Icon name="plus" size={15} />
                    </label>
                  </div>
                  <div className="swatches">
                    <button
                      className={`swatch swatch-native ${draft.appearance.accentMode === 'native' ? 'active' : ''}`}
                      style={
                        {
                          '--swatch': `conic-gradient(${(['time', 'sky', 'water', 'sun', 'personal'] as const).map((role, index) => `${NATIVE_PALETTE[role].hex} ${index * 20}% ${(index + 1) * 20}%`).join(', ')})`,
                        } as React.CSSProperties
                      }
                      aria-label="Native colours"
                      title="Each widget uses its own colour"
                      aria-pressed={draft.appearance.accentMode === 'native'}
                      onClick={() => {
                        if (draft.appearance.accentMode === 'native') return;
                        change((previous) => ({
                          ...previous,
                          appearance: {
                            ...previous.appearance,
                            accentMode: 'native',
                            preset: 'custom',
                          },
                        }));
                      }}
                    >
                      <span>
                        {draft.appearance.accentMode === 'native' && (
                          <Icon name="check" size={14} />
                        )}
                      </span>
                    </button>
                    {ACCENT_SWATCHES.map((color) => {
                      const active =
                        draft.appearance.accentMode !== 'native' &&
                        accentSwatch(draft.appearance.accentColor)?.value ===
                          color.value;
                      return (
                        <button
                          key={color.value}
                          className={`swatch ${active ? 'active' : ''}`}
                          style={
                            { '--swatch': color.value } as React.CSSProperties
                          }
                          aria-label={color.name}
                          aria-pressed={active}
                          onClick={() => {
                            if (active) return;
                            change((previous) => ({
                              ...previous,
                              appearance: {
                                ...previous.appearance,
                                accentMode: 'color',
                                // A kept value of this swatch, including a retired one (#224),
                                // stays as stored, so returning to it is not an edit.
                                accentColor:
                                  [
                                    previous.appearance.accentColor,
                                    savedRef.current.appearance.accentColor,
                                  ].find(
                                    (value) =>
                                      accentSwatch(value)?.value === color.value,
                                  ) ?? color.value,
                                preset: 'custom',
                              },
                            }));
                          }}
                        >
                          <span>
                            {active && <Icon name="check" size={14} />}
                          </span>
                        </button>
                      );
                    })}
                    {customAccent && (
                      // #151: a kept custom colour is one activation away, also after Native.
                      <button
                        className={`swatch swatch-custom ${customActive ? 'active' : ''}`}
                        style={
                          {
                            '--swatch': customAccent,
                            '--swatch-mark': readableMark(customAccent),
                          } as React.CSSProperties
                        }
                        aria-label="Custom colour"
                        title={`Custom colour ${customAccent}`}
                        aria-pressed={customActive}
                        onClick={() => {
                          if (customActive) return;
                          change((previous) => ({
                            ...previous,
                            appearance: {
                              ...previous.appearance,
                              accentMode: 'color',
                              accentColor: customAccent,
                              preset: 'custom',
                            },
                          }));
                        }}
                      >
                        <span>
                          {customActive && <Icon name="check" size={14} />}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
                <details className="disclosure motion-disclosure">
                  <summary>
                    Motion
                    <span>{ANIMATION_LABELS[draft.appearance.animation]}</span>
                  </summary>
                  <div className="disclosure-body">
                    <div className="animation-setting">
                      <span className="field-label">Animation</span>
                      <div
                        className="animation-options"
                        role="group"
                        aria-label="Animation"
                      >
                        {ANIMATION_LEVELS.map((level) => (
                          <button
                            key={level}
                            className="button small"
                            aria-pressed={draft.appearance.animation === level}
                            onClick={() => {
                              // A motion preference, not a look: the style preset stays as it is.
                              change((previous) => ({
                                ...previous,
                                appearance: { ...previous.appearance, animation: level },
                              }));
                              setRevealNonce((value) => value + 1);
                            }}
                          >
                            {ANIMATION_LABELS[level]}
                          </button>
                        ))}
                      </div>
                      <p className="animation-hint">
                        Off keeps widgets still. Subtle animates changes. Lively adds
                        gentle weather motion.
                      </p>
                      {editorReducedMotion && (
                        <p className="animation-hint">
                          This screen asks for reduced motion, so animation stays off
                          here. The display follows its own system setting.
                        </p>
                      )}
                    </div>
                    {/* #240: plain names for motionEnabled and motionIntervalSeconds. */}
                    <Toggle
                      label="Drift and fade between moves"
                      checked={draft.appearance.motionEnabled}
                      onChange={(value) => appearance('motionEnabled', value)}
                    />
                    <Range
                      label="Move widgets every"
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
                    <p className="hint motion-hint">
                      Widgets always move to a new place through black. With
                      Drift and fade off, or with Animation effects off in
                      Windows Settings › Accessibility › Visual effects on the
                      display PC, they appear without a fade and nothing drifts.
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
                <details className="disclosure data-disclosure">
                  <summary>Data & recovery</summary>
                  <div className="disclosure-body">
                    <p className="hint data-hint">
                      A backup holds your saved settings, styles and reminders.
                      Your photo isn't included.
                    </p>
                    <div className="data-actions">
                      <a
                        className="button small"
                        href="/api/export"
                        download="still-backup.json"
                      >
                        <Icon name="download" size={15} />
                        Export saved data
                      </a>
                      <button
                        className="button small restore-backup"
                        disabled={restoring}
                        onClick={chooseBackup}
                      >
                        <Icon name="undo" size={15} />
                        Restore from backup…
                      </button>
                      <input
                        ref={backupInput}
                        className="backup-file"
                        type="file"
                        accept="application/json,.json"
                        aria-label="Backup file"
                        tabIndex={-1}
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          // Clear it, so choosing the same file again is a new choice.
                          event.target.value = '';
                          if (file) void readBackup(file);
                        }}
                      />
                    </div>
                    {backup && (
                      <div
                        className="data-confirm restore-confirm"
                        role="group"
                        aria-label="Restore backup"
                      >
                        <p className="data-confirm-title">
                          Restore the backup from{' '}
                          {backupDate(backup, draft.clockFormat)}?
                        </p>
                        <p>
                          It replaces your saved settings, styles and reminders
                          with the backup's: {backupContents(backup)}. Your
                          photo stays as it is.
                        </p>
                        <p className="hint">
                          What's saved now is kept as this computer's recovery
                          backup until your next save. To keep it longer,
                          export it first.
                        </p>
                        <div className="data-confirm-actions">
                          <button
                            className="button small primary"
                            disabled={restoring}
                            onClick={() => {
                              void restoreBackup();
                            }}
                          >
                            {restoring ? 'Restoring…' : 'Restore'}
                          </button>
                          <button
                            className="button small"
                            disabled={restoring}
                            onClick={() => {
                              setBackup(null);
                              setDataMessage({ text: 'Nothing was restored.' });
                            }}
                          >
                            Don't restore
                          </button>
                        </div>
                      </div>
                    )}
                    {confirmReset ? (
                      <div
                        className="data-confirm reset-confirm"
                        role="group"
                        aria-label="Reset appearance"
                      >
                        <p>
                          Reset brightness, colours, typeface, Text size and
                          motion to the defaults? Widgets, their layout, the
                          clock style and saved styles stay.
                        </p>
                        <div className="data-confirm-actions">
                          <button
                            className="button small primary"
                            onClick={confirmResetAppearance}
                          >
                            Reset
                          </button>
                          <button
                            className="button small"
                            onClick={() => setConfirmReset(false)}
                          >
                            Keep my appearance
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="text-button reset-appearance"
                        onClick={() => {
                          setBackup(null);
                          setDataMessage(null);
                          setConfirmReset(true);
                        }}
                      >
                        Reset appearance…
                      </button>
                    )}
                    <p
                      className={`inline-message data-status ${dataMessage?.error ? 'error' : ''}`}
                      role="status"
                    >
                      {dataMessage?.text ?? ''}
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
                onSelect={(id) => {
                  setSelectedWidget(id);
                  setRoomProblem(null);
                }}
                pickerOpen={pickerOpen}
                onPicker={setPickerOpen}
                onAdd={addWidget}
                onFix={applyFix}
                roomProblem={
                  roomProblem && same(roomProblem.grid, draft.widgetGrid) && same(roomProblem.enabled, draft.widgets)
                    ? roomProblem
                    : null
                }
                remindersHidden={reminderPresentation(draft, state.reminders, connectionError !== null) === 'hidden'}
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
                  {/* The visible label is the accessible name (#241); the search hint is a description. */}
                  <CitySearch
                    value={locationQuery}
                    onChange={setLocationQuery}
                    onSelect={selectCity}
                    disabled={saving}
                    label="City"
                    description="Type two or more letters to search for a city"
                  />
                </div>
                <p className="inline-message" role="status">
                  {locationMessage || '\u00a0'}
                </p>
                {/* #235: Time format applies to every widget, so it sits beside Units, outside any widget. */}
                <div className="inspector-group time-units" role="group" aria-labelledby="time-units-heading">
                  <h3 id="time-units-heading">Time &amp; units</h3>
                  <div className="input-row">
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
                        <option value="metric">°C · metric</option>
                        <option value="imperial">°F · imperial</option>
                      </select>
                    </label>
                    <label>
                      <span className="field-label">Time format</span>
                      <select
                        className="select-input"
                        value={draft.clockFormat}
                        onChange={(event) =>
                          change((previous) => ({
                            ...previous,
                            clockFormat: event.target.value as Settings['clockFormat'],
                          }))
                        }
                      >
                        <option value="12h">12-hour</option>
                        <option value="24h">24-hour</option>
                      </select>
                    </label>
                  </div>
                </div>
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
                      Weather adds rain timing automatically when rain is near
                      (within 12 hours). Hourly chance includes snow; rain
                      timing and amounts are forecast estimates and may change.
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
      </main>
      <p className="sr-only save-announcer" role="status">
        {announcement}
      </p>
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
