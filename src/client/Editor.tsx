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
  WeatherState,
  WidgetGrid,
  WidgetId,
} from '../shared/contracts';
import { defaultSettings } from '../shared/defaults';
import { ACCENT_SWATCHES, NATIVE_PALETTE, accentSwatch } from '../shared/palette';
import {
  NETWORK_ERROR_MESSAGE,
  api,
  apiTagged,
  isNetworkError,
  rememberRevision,
  revisionOf,
  settingsConflict,
} from './api';
import {
  BACKUP_MAX_BYTES,
  BackupError,
  backupContents,
  backupDate,
  parseBackup,
  restoreFailure,
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
  MAX_SAVED_STYLES,
  applyBuiltinPreset,
  builtinLook,
  duplicateStyleName,
  getVisual,
  labelLook,
  matchingBuiltinPreset,
  reminderPresentation,
  resetAppearance,
  resetLayout,
  spokenInterval,
  spokenSeconds,
  withAppearance,
} from './model';
import { browserLocationPlatform, getDeviceLocation } from './location';
import {
  crowdedOutMessage,
  keepsSavedChanges,
  listLimitProblem,
  rebaseSettings,
  rebaseSettingsReport,
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
  isFreeSize,
  needsForecast,
  placementSpan,
  resizeWidgetSpan as resizeSpanGrid,
  switchGridDensity,
  type GridDensityHistory,
  type GridDensity,
  type WidgetSize,
  type WidgetSpan,
} from '../shared/widgets';
import { GridEditor, type LayoutEdit } from './GridEditor';
import { WidgetInspector, useHeldPointers, widgetListOrder, type InspectorReveal } from './WidgetInspector';
import { ANIMATION_LABELS, ANIMATION_LEVELS, usePrefersReducedMotion } from './useMotion';
import { WIDGET_MODULES } from './widgets/registry';
import { preparePhoto, type PhotoDraft } from './photo';
import { RemindersPanel, reminderFormPending } from './RemindersPanel';
import { FirstRunCard, readFirstRunDismissed, rememberFirstRunDismissed } from './FirstRunCard';
import {
  addToGrid,
  applyRoomFix,
  densityFixLabel,
  densityFixResult,
  densityRefusal,
  densityResized,
  displacedNeighbours,
  fulfilRequest,
  isColumnSpan,
  movedMessage,
  resizedMessage,
  roomFixResult,
  roomProblem as diagnoseRoomProblem,
  type DensityRefusal,
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

/** Why these settings cannot be saved: a widget module's reason, else a list over its limit (#288). */
function saveProblem(settings: Settings): string | null {
  return (
    WIDGET_IDS.map((id) => WIDGET_MODULES[id].draftProblem?.(settings) ?? null).find(
      (problem) => problem !== null,
    ) ??
    listLimitProblem(settings) ??
    null
  );
}

/** Whether a forecast reply is for these settings' location and units. */
function forecastMatches(settings: Settings, weather: WeatherState): boolean {
  return (
    weather.location.latitude === settings.location.latitude &&
    weather.location.longitude === settings.location.longitude &&
    weather.units.temperature === (settings.units === 'imperial' ? '°F' : '°C')
  );
}

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
  spoken,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  display?: string;
  /** The value in words with its unit (#342); defaults to the visible text. */
  spoken?: string;
}) {
  return (
    <label className="control-block">
      <span className="control-label">
        <span>{label}</span>
        {/* The slider speaks its own value (aria-valuetext); the visible copy is not announced again. */}
        <output aria-hidden="true">{display ?? value}</output>
      </span>
      <input
        className="range-input"
        type="range"
        aria-label={label}
        aria-valuetext={spoken ?? display ?? String(value)}
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
  // The revision of the saved settings this draft is based on, sent as If-Match (#287).
  const savedRevision = useRef(revisionOf(state.settings));
  // Guards Save against a second activation before the first one's state has rendered (#289).
  const savingNow = useRef(false);
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
  const selectedRef = useRef<WidgetId | null>(null);
  useHeldPointers();
  // #339: what the Widgets tab scrolls into view after a selection, an add or a no-room explanation.
  const [reveal, setReveal] = useState<InspectorReveal | null>(null);
  const [layoutEditing, setLayoutEditing] = useState(false),
    [pickerOpen, setPickerOpen] = useState(false);
  const [gridPreview, setGridPreview] = useState<WidgetGrid | null>(null);
  // Layout messages (#311, #341): one visible copy (the canvas line, or the Widgets list for an edit
  // made there) and one always-mounted announcer. Each message gets a new id, so the announcer
  // replaces its node and an identical result ("No room to the left" twice) is announced again.
  const [layoutMessage, setLayoutMessage] = useState<{ text: string; id: number; where: 'canvas' | 'list' } | null>(null);
  const messageId = useRef(0);
  const [gridEpoch, setGridEpoch] = useState(0);
  // A resize with no room explains itself beside that widget's size controls (#183, #285), and a
  // refused grid density in the canvas line (#346). Each belongs to the board it was shown on: any
  // later layout change, density change or Cancel clears it for good, so it never re-shows (#310).
  // The density fix also belongs to its refusal message: any later layout message replaces both.
  const [roomNotice, setRoomNotice] = useState<{ problem: RoomProblem; board: WidgetGrid; widgets: Settings['widgets'] } | null>(null);
  const [densityNotice, setDensityNotice] = useState<{ refusal: DensityRefusal; board: WidgetGrid; widgets: Settings['widgets']; message: number } | null>(null);
  // #340: consecutive resize steps of one widget are one exploration, each computed from the board
  // before it began, so a neighbour pushed aside returns once the widget is smaller again. It ends
  // with any other layout edit: a move, another widget's resize, an add or removal, or a density change.
  const resizeExploration = useRef<{ id: WidgetId; base: WidgetGrid; widgets: Settings['widgets']; result: WidgetGrid } | null>(null);
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
  // line, an import in flight and the inline Reset appearance and Reset layout (#435) questions.
  const [backup, setBackup] = useState<BackupFile | null>(null),
    [dataMessage, setDataMessage] = useState<{
      text: string;
      error?: boolean;
      /** The server's own text for a refused backup, behind a disclosure (#302). */
      detail?: string | null;
    } | null>(null),
    [restoring, setRestoring] = useState(false),
    [confirmReset, setConfirmReset] = useState(false),
    [confirmLayoutReset, setConfirmLayoutReset] = useState(false);
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
  // A widget module, or a merged list over its limit (#288), can block Save with a reason shown in the save bar.
  const draftProblem = saveProblem(draft);
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
  // #312: on narrow layouts (<= 700 px) the canvas column sits above the inspector, so an action
  // deep in the inspector (Save reminder, Save changes, a photo) can fail while its row is far from
  // the part of the page in view. While that row has no room in view (above the Save bar) the same
  // alert, with its dismiss control, floats at the top of the viewport; scrolled back to the canvas
  // it returns to its row. Focus stays where it was. Connection and storage alerts keep their row.
  const alertBox = useRef<HTMLDivElement>(null);
  const [alertFloating, setAlertFloating] = useState(false);
  const floatingKey = alert?.kind === 'action' ? alert.key : null;
  useLayoutEffect(() => {
    if (!floatingKey) {
      setAlertFloating(false);
      return;
    }
    const narrow = window.matchMedia('(max-width: 700px)');
    let frame = 0;
    const update = () => {
      frame = 0;
      // The message line directly above the alert row marks where the row starts; the row needs
      // about 64 px of view above the Save bar's reserved space.
      const anchor = document.querySelector('.canvas-messages');
      if (!anchor) return;
      const bottom = anchor.getBoundingClientRect().bottom;
      const clearance =
        Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--studio-footer-clearance')) || 24;
      const inView = bottom >= 0 && bottom + 64 <= window.innerHeight - clearance + 24;
      setAlertFloating(narrow.matches && !inView);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    narrow.addEventListener('change', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      narrow.removeEventListener('change', schedule);
    };
  }, [floatingKey]);
  // A floating alert never covers the control that was used: the page scrolls just enough.
  useLayoutEffect(() => {
    if (!alertFloating) return;
    const box = alertBox.current?.getBoundingClientRect(),
      active = document.activeElement;
    if (!box || !(active instanceof HTMLElement) || active === document.body || savebar.current?.contains(active))
      return;
    const used = active.getBoundingClientRect();
    if (used.top < box.bottom + 8 && used.bottom > box.top)
      window.scrollBy({ top: used.top - box.bottom - 12, behavior: 'instant' });
  }, [alertFloating, floatingKey]);
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
    const rebased = rebaseSettingsReport(savedRef.current, draftRef.current, incoming);
    updateDraft(rebased.settings);
    savedRef.current = incoming;
    savedRevision.current = revisionOf(state.settings);
    setSaved(incoming);
    // A widget another window added that this layout draft has no room for is named (#350).
    if (rebased.crowdedOut.length) setGridMessage(crowdedOutMessage(rebased.crowdedOut));
  }, [state.settings]);
  // #352: /api/state refreshes the forecast only while a saved widget needs it. The Weather tab,
  // and a draft showing such a widget before it is saved, ask for it themselves.
  const forecastWanted =
    section === 'Weather' || (needsForecast(draft) && !needsForecast(saved));
  useEffect(() => {
    if (!forecastWanted) return;
    let active = true,
      timer: number | undefined,
      early = 0;
    const load = async () => {
      let next = 60_000;
      try {
        const weather = await api<WeatherState>('/api/weather');
        if (!active) return;
        // A reply for settings that were replaced meanwhile is dropped.
        setState((previous) =>
          previous && forecastMatches(previous.settings, weather)
            ? { ...previous, weather }
            : previous,
        );
        // While the server is still fetching it (#351), ask again soon, a few times at most.
        if (weather.refreshing && early < 5) {
          early++;
          next = 2_000;
        }
      } catch {
        // The canvas keeps the state it has; the next attempt or poll tries again.
      }
      if (active) timer = window.setTimeout(() => void load(), next);
    };
    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [forecastWanted, setState]);
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
    // Unsaved settings, or an open reminder form with typed text it has not saved (#274), ask first.
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty || reminderFormPending()) event.preventDefault();
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
    resizeExploration.current = null;
    setRoomNotice(null);
    setDensityNotice(null);
    say('');
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
  /** Shows a layout message once: in the canvas line, or in the Widgets list for an edit made there. Returns its id. */
  function say(text: string, where: 'canvas' | 'list' = 'canvas'): number {
    const id = ++messageId.current;
    setLayoutMessage(text ? { text, id, where } : null);
    return id;
  }
  /** A canvas-line message (density results, crowded-out widgets after a poll). */
  function setGridMessage(text: string) {
    say(text, 'canvas');
  }
  /** Selects a widget; `page` lets a stacked layout scroll the page to its settings (#339). */
  function selectWidget(id: WidgetId | null, page = false) {
    const changed = id !== selectedRef.current;
    selectedRef.current = id;
    setSelectedWidget(id);
    if (changed && roomNotice && roomNotice.problem.request.id !== id) setRoomNotice(null);
    if (!id) return;
    if (changed) setReveal({ id, target: 'option', page });
    // A canvas press selects at pointerdown; releasing it without a drag (a tap) may then scroll a stacked page.
    else if (page) setReveal((current) => (current?.id === id && !current.page ? { ...current, page } : current));
  }
  /** The board a resize of `id` starts from: its exploration's base while the draft still shows that exploration (#340). */
  function resizeBase(id: WidgetId): WidgetGrid {
    const current = draftRef.current, exploration = resizeExploration.current;
    return exploration && exploration.id === id && same(exploration.result, current.widgetGrid) && same(exploration.widgets, current.widgets)
      ? exploration.base
      : current.widgetGrid;
  }
  function commitGrid(grid: WidgetGrid) {
    resizeExploration.current = null;
    say('');
    change((previous) => ({ ...previous, widgetGrid: grid }));
  }
  /** Commits one resize step (#340): the whole result for the status line and the neighbours it moved. */
  function commitResize(id: WidgetId, grid: WidgetGrid): { message: string; displaced: string } {
    const before = draftRef.current.widgetGrid, widgets = draftRef.current.widgets, base = resizeBase(id);
    commitGrid(grid);
    resizeExploration.current = { id, base, widgets: { ...widgets }, result: grid };
    setRoomNotice(null);
    return { message: resizedMessage(before, grid, id, widgets, base), displaced: displacedNeighbours(before, grid, id, widgets, base) };
  }
  // A notice belongs to the board it was shown on; once the board changes it is gone for good (#310).
  const currentRoomNotice =
    roomNotice && same(roomNotice.board, draft.widgetGrid) && same(roomNotice.widgets, draft.widgets) ? roomNotice : null;
  // The density fix shows only beside its own refusal: a refused move, a drag's "No room for that
  // size" or any other later message on the same board ends it too (#346).
  const currentDensityNotice =
    densityNotice && densityNotice.message === layoutMessage?.id && same(densityNotice.board, draft.widgetGrid) && same(densityNotice.widgets, draft.widgets)
      ? densityNotice
      : null;
  useEffect(() => {
    if (roomNotice && !currentRoomNotice) setRoomNotice(null);
    if (densityNotice && !currentDensityNotice) setDensityNotice(null);
  }, [draft.widgetGrid, draft.widgets, layoutMessage]);
  /** The no-room explanation for a request (#183, #238), on the board the request was tried against. */
  function explainNoRoom(request: RoomRequest): RoomProblem {
    const grid = request.kind === 'add' ? draftRef.current.widgetGrid : resizeBase(request.id), enabled = draftRef.current.widgets;
    return diagnoseRoomProblem(grid, request, enabled)
      ?? { request, grid, enabled: { ...enabled }, blockers: [], fixes: [], message: 'Layout changed. Try again.' };
  }
  function finishAdd(id: WidgetId, grid: WidgetGrid, message: string) {
    resizeExploration.current = null;
    change((previous) => ({
      ...previous,
      widgetGrid: grid,
      widgets: { ...previous.widgets, [id]: true },
      preview:
        id === 'preview'
          ? { ...previous.preview, enabled: true }
          : previous.preview,
    }));
    selectWidget(id, true);
    setPickerOpen(false);
    setLayoutEditing(true);
    setRoomNotice(null);
    setDensityNotice(null);
    say(message, 'list');
  }
  /** Adds a widget as a draft; the picker shows the returned explanation when it has no room. */
  function addWidget(id: WidgetId, size: WidgetSize): RoomProblem | null {
    const next = addToGrid(draftRef.current.widgetGrid, id, size, draftRef.current.widgets);
    if (!next) return explainNoRoom({ kind: 'add', id, size });
    finishAdd(id, next, `${WIDGET_CATALOG[id].name} added`);
    return null;
  }
  /** The inspector's size control that shows a resize request once it applies (#310). */
  function sizeControl(request: RoomRequest, before: WidgetGrid['placements'][WidgetId]): string[] {
    const name = CSS.escape(WIDGET_CATALOG[request.id].name), option = `.widget-option[data-widget-option="${request.id}"]`;
    if (request.kind === 'family') return [`${option} [aria-label="${name} size ${request.size}"]`];
    const column = `${option} [aria-label="${name} size column"]`;
    if (request.kind !== 'span' || isColumnSpan(request.id, request.span, draftRef.current.widgetGrid.density)) return [column];
    const span = placementSpan(request.id, before);
    const [axis, step] = request.span.rows !== span.rows
      ? ['height', request.span.rows > span.rows ? 'Taller' : 'Shorter']
      : ['width', request.span.columns > span.columns ? 'Wider' : 'Narrower'];
    return [`${option} [role="group"][aria-label="${name} ${axis}"] [aria-label="${step}"]`, column];
  }
  /** Applies a no-room fix and its request as one draft edit; Cancel restores the board. */
  function applyFix(problem: RoomProblem, fix: RoomFix): RoomProblem | null {
    const { request } = problem, enabled = draftRef.current.widgets;
    const grid = request.kind === 'add' ? draftRef.current.widgetGrid : resizeBase(request.id);
    const fixed = applyRoomFix(grid, request, fix, enabled);
    // The draft may have changed since the explanation; a request that now fits needs no fix.
    const next = fixed ?? fulfilRequest(grid, request, enabled);
    if (!next) {
      const fresh = explainNoRoom(request);
      if (request.kind !== 'add') setRoomNotice({ problem: fresh, board: draftRef.current.widgetGrid, widgets: draftRef.current.widgets });
      return fresh;
    }
    const message = fixed ? roomFixResult(request, fix, next) : `${WIDGET_CATALOG[request.id].name} ${request.kind === 'add' ? 'added' : 'resized'}`;
    if (request.kind === 'add') finishAdd(request.id, next, message);
    else {
      const before = draftRef.current.widgetGrid.placements[request.id];
      commitGrid(next);
      setRoomNotice(null);
      say(message, 'list');
      // The fix button unmounts with the explanation; focus moves to the size control that now
      // shows the change (the pressed preset or the stepper used), never to the page (#310).
      setFocusRequest({ candidates: sizeControl(request, before), onlyIfLost: true });
    }
    return null;
  }
  /**
   * Explains a resize with no room beside the widget's size controls, in that one live region
   * (#183, #285). `page` lets a stacked layout scroll to it; a keyboard resize on the canvas keeps
   * its focused handle in view instead.
   */
  function reportNoRoom(request: RoomRequest, page = true) {
    setRoomNotice({ problem: explainNoRoom(request), board: draftRef.current.widgetGrid, widgets: draftRef.current.widgets });
    say('');
    setReveal({ id: request.id, target: 'room', page });
  }
  /** Settings without one widget; Last screen also turns its snapshot off. */
  function withoutWidget(previous: Settings, id: WidgetId): Settings {
    return {
      ...previous,
      widgets: { ...previous.widgets, [id]: false },
      preview: id === 'preview' ? { ...previous.preview, enabled: false } : previous.preview,
    };
  }
  /** An unsaved photo goes with its widget. */
  function forgetUnsavedPhoto(id: WidgetId) {
    if (id === 'photo' && !savedRef.current.widgets.photo) {
      cancelPhoto();
      updatePhoto(undefined);
    }
  }
  function removeWidget(id: WidgetId) {
    // #229: the removed row's buttons unmount; keyboard focus moves to the next row (else the
    // previous one), or to Add widget when none remains. Rows follow the list's grouped order (#365).
    const rows = widgetListOrder(draftRef.current.widgets);
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
    forgetUnsavedPhoto(id);
    resizeExploration.current = null;
    change((previous) => withoutWidget(previous, id));
    selectWidget(null);
    say(`${WIDGET_CATALOG[id].name} removed`, 'list');
  }
  // Inspector resizes: the pressed preset and the steppers' own outputs show the size, so only the
  // neighbours a step moved are named, in the canvas line beside the canvas they changed (#340).
  function resizeWidget(id: WidgetId, size: WidgetSize) {
    const next = fitWidgetFamily(resizeBase(id), id, size, draftRef.current.widgets);
    if (next) say(commitResize(id, next).displaced);
    else reportNoRoom({ kind: 'family', id, size });
  }
  function resizeWidgetSpan(id: WidgetId, span: WidgetSpan) {
    const next = resizeSpanGrid(resizeBase(id), id, span, draftRef.current.widgets);
    if (next) say(commitResize(id, next).displaced);
    else if (isFreeSize(id)) reportNoRoom({ kind: 'span', id, span });
    else say('No room for that size');
  }
  /** A move or resize committed on the canvas, worded with where it went or what size it became (#341). */
  function canvasEdit(grid: WidgetGrid, edit: LayoutEdit) {
    if (edit.kind === 'resize') {
      say(commitResize(edit.id, grid).message);
      return;
    }
    const before = draftRef.current.widgetGrid, widgets = draftRef.current.widgets;
    commitGrid(grid);
    say(movedMessage(before, grid, edit.id, widgets));
  }
  function density(value: GridDensity) {
    const current = draftRef.current;
    const next = switchGridDensity(current.widgetGrid, value, current.widgets, densityHistory.current);
    if (next) {
      densityHistory.current = next.history;
      commitGrid(next.grid);
      setDensityNotice(null);
      // A dropped custom size is named, e.g. "Reminders 2 × 8 → small" (#152).
      if (next.resized.length) say(`${densityResized(next.resized)} to fit. Switch back to restore.`);
      return;
    }
    // #346: name the density and what it cannot hold, with a draft fix when hiding one widget helps.
    const refusal = densityRefusal(current.widgetGrid, value, current.widgets);
    setDensityNotice({ refusal, board: current.widgetGrid, widgets: current.widgets, message: say(refusal.message) });
  }
  /** The refused density with its widget removed, as one draft edit that Cancel restores (#346). */
  function applyDensityFix(refusal: DensityRefusal) {
    const remove = refusal.remove, current = draftRef.current;
    if (!remove) return;
    // The button unmounts with the notice; focus returns to the density control.
    setFocusRequest({ candidates: ['.grid-density-control select', ACTIVE_TAB], onlyIfLost: true });
    const next = switchGridDensity(current.widgetGrid, refusal.density, { ...current.widgets, [remove]: false });
    if (!next) {
      density(refusal.density);
      return;
    }
    forgetUnsavedPhoto(remove);
    resizeExploration.current = null;
    densityHistory.current = next.history;
    change((previous) => ({ ...withoutWidget(previous, remove), widgetGrid: next.grid }));
    if (selectedRef.current === remove) selectWidget(null);
    setDensityNotice(null);
    say(densityFixResult(remove, refusal.density, next.resized));
  }
  /** A Style tab edit; the stored style label follows the look (#277). */
  function appearance<K extends keyof Settings['appearance']>(
    key: K,
    value: Settings['appearance'][K],
  ) {
    change((previous) => withAppearance(previous, { [key]: value }));
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
    if (savingNow.current) return;
    savingNow.current = true;
    let base = savedRef.current,
      revision = savedRevision.current,
      submitted = structuredClone(draftRef.current);
    const automaticLocation = guardLocation.current;
    const submittedPhoto = photoDraftRef.current,
      submittedPhotoEpoch = photoEpoch.current;
    const includesPhoto =
      submittedPhoto !== undefined &&
      (submittedPhoto?.id ?? null) !== photoId.current;
    setSaving(true);
    setError(null);
    try {
      let received: Settings, etag: string | null;
      for (let attempt = 0; ; attempt++) {
        const patch = settingsChanges(base, submitted, automaticLocation);
        if (includesPhoto)
          patch.photoChange = submittedPhoto
            ? { pngBase64: submittedPhoto.pngBase64 }
            : null;
        try {
          ({ body: received, etag } = await apiTagged<Settings>('/api/settings', {
            method: 'PATCH',
            body: JSON.stringify(patch),
            ...(revision ? { headers: { 'If-Match': revision } } : {}),
          }));
          break;
        } catch (caught) {
          // #287: another window saved settings after this draft's last poll. Merge them as a poll
          // would, then save once more by itself only when that keeps everything the other window
          // saved; otherwise keep the merged draft and ask for a review.
          const conflict = settingsConflict(caught);
          if (!conflict || !mounted.current) throw caught;
          const current = conflict.settings;
          rememberRevision(current, conflict.etag);
          // An automatic location result yields to a manual city saved elsewhere, as the server would.
          const merged = rebaseSettingsReport(base, submitted, current, { automaticLocation }),
            live = rebaseSettingsReport(base, draftRef.current, current, { automaticLocation });
          updateDraft(live.settings);
          savedRef.current = current;
          savedRevision.current = conflict.etag;
          setSaved(current);
          setState((previous) => (previous ? { ...previous, settings: current } : previous));
          if (live.crowdedOut.length) setGridMessage(crowdedOutMessage(live.crowdedOut));
          const clean =
            attempt === 0 &&
            !merged.crowdedOut.length &&
            keepsSavedChanges(base, current, merged.settings) &&
            saveProblem(merged.settings) === null;
          if (!clean) throw caught;
          base = current;
          revision = conflict.etag;
          submitted = merged.settings;
        }
      }
      if (!mounted.current) return;
      rememberRevision(received, etag);
      updateDraft(rebaseSettings(submitted, draftRef.current, received));
      savedRef.current = received;
      savedRevision.current = etag;
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
        // Save keeps focus while saving (#289); if focus was lost meanwhile, it returns there for a retry.
        setFocusRequest({
          candidates: ['.studio-savebar .button.primary', lastEdited.current, ACTIVE_TAB],
          onlyIfLost: true,
        });
      }
    } finally {
      savingNow.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  /**
   * Saved styles (#344). The name field is only for a new name: choosing a style leaves it empty, an
   * add clears it, and Update keeps the style's name unless another one is typed. A name another
   * style already uses is refused inline.
   */
  function choosePreset(id: string) {
    setPresetId(id);
    setPresetName('');
    const preset = draft.savedPresets.find((item) => item.id === id);
    if (preset) {
      const visual = structuredClone(preset.visual);
      change((previous) => ({
        ...previous,
        ...visual,
        appearance: labelLook(visual.appearance),
      }));
    }
  }
  function addPreset() {
    const name = presetName.trim();
    if (
      !name ||
      duplicateStyleName(draftRef.current.savedPresets, name) ||
      draftRef.current.savedPresets.length >= MAX_SAVED_STYLES
    )
      return;
    const id = crypto.randomUUID();
    change((previous) => ({
      ...previous,
      savedPresets: [
        ...previous.savedPresets,
        { id, name, visual: getVisual(previous) },
      ],
    }));
    setPresetId(id);
    setPresetName('');
    // Add style is disabled once the name clears; the select now shows the new style.
    setStyleFocus({ target: '#saved-style-select', edit: true });
  }
  function updatePreset() {
    const name = presetName.trim();
    if (name && duplicateStyleName(draftRef.current.savedPresets, name, presetId)) return;
    change((previous) => ({
      ...previous,
      savedPresets: previous.savedPresets.map((preset) =>
        preset.id === presetId
          ? { ...preset, name: name || preset.name, visual: getVisual(previous) }
          : preset,
      ),
    }));
    setPresetName('');
  }
  function deletePreset() {
    change((previous) => ({
      ...previous,
      savedPresets: previous.savedPresets.filter((preset) => preset.id !== presetId),
    }));
    setPresetId('');
    setPresetName('');
    // The delete button unmounts with the selection (#343).
    setStyleFocus({ target: '#saved-style-select', edit: true });
  }
  // Style tab focus moves (#343, #302, #344): the control that was used unmounts or turns disabled,
  // so focus goes to the control that now holds the result. An edit records it, so Save and Cancel
  // return focus there (#229).
  const [styleFocus, setStyleFocus] = useState<{ target: string; edit?: boolean } | null>(null);
  useEffect(() => {
    if (!styleFocus) return;
    setStyleFocus(null);
    const element = document.querySelector<HTMLElement>(styleFocus.target);
    if (!element?.isConnected || element.matches(':disabled')) return;
    element.focus();
    if (styleFocus.edit) lastEdited.current = element;
  }, [styleFocus]);
  // #300: the reset's status line asks to save only while the reset is the unsaved change. Cancel (or
  // a further Style edit) clears it; once the reset look is saved it says so.
  const [resetLook, setResetLook] = useState<Settings['appearance'] | null>(null);
  const lookOf = ({ preset: _label, layout: _legacy, ...rest }: Settings['appearance']) => rest;
  const resetOutcome = !resetLook
    ? null
    : same(lookOf(saved.appearance), lookOf(resetLook))
      ? 'saved'
      : same(lookOf(draft.appearance), lookOf(resetLook))
        ? 'unsaved'
        : 'undone';
  // #499: the line shown follows the outcome in the same render, like a room notice (#310). An
  // effect's update renders a task later, so after Cancel the save bar had gone while the line still
  // asked to save, for a painted frame. The effect only records the outcome.
  const shownDataMessage: typeof dataMessage =
    resetOutcome === 'saved'
      ? { text: 'Appearance reset and saved.' }
      : resetOutcome === 'undone'
        ? null
        : dataMessage;
  useEffect(() => {
    if (resetOutcome === 'saved') {
      setResetLook(null);
      setDataMessage({ text: 'Appearance reset and saved.' });
    } else if (resetOutcome === 'undone') {
      setResetLook(null);
      setDataMessage(null);
    }
  }, [resetOutcome]);
  // Data & recovery questions belong to the Style tab; leaving it drops them.
  useEffect(() => {
    if (section === 'Style') return;
    setBackup(null);
    setConfirmReset(false);
    setConfirmLayoutReset(false);
    setDataMessage(null);
    setResetLook(null);
  }, [section]);
  const unsavedBeforeRestore = 'Save or cancel your changes before restoring a backup.';
  /** Restore from backup (#234): refused while edits are unsaved, which a restore would otherwise mix in. */
  function chooseBackup() {
    setConfirmReset(false);
    setConfirmLayoutReset(false);
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
      // #302: the question appears below the buttons; focus its title so it is read out.
      setStyleFocus({ target: '.restore-confirm .data-confirm-title' });
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
    // Restore turns disabled while it runs, then the question closes or stays for a retry (#302).
    let focusAfter = '.restore-backup';
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
      if (mounted.current) {
        // A refused file stays refused, so the question closes; no answer leaves it open to try again.
        const failure = restoreFailure(caught);
        if (isNetworkError(caught)) focusAfter = '.restore-confirm .button.primary';
        else setBackup(null);
        setDataMessage({ text: failure.text, detail: failure.detail, error: true });
      }
    } finally {
      if (mounted.current) {
        setRestoring(false);
        setStyleFocus({ target: focusAfter });
      }
    }
  }
  function confirmResetAppearance() {
    const after = resetAppearance(draftRef.current);
    const unchanged = sameEffectiveSettings(savedRef.current, after);
    setConfirmReset(false);
    setPresetId('');
    change(() => after);
    setResetLook(unchanged ? null : after.appearance);
    setDataMessage({
      text: unchanged
        ? 'Appearance is back to the defaults.'
        : 'Appearance reset. Save changes to keep it.',
    });
    setStyleFocus({ target: '.reset-appearance', edit: true });
  }
  /** Reset layout (#435): the default board as an ordinary draft change; Save keeps it, Cancel restores the saved board. */
  function confirmResetLayout() {
    const after = resetLayout(draftRef.current);
    setConfirmLayoutReset(false);
    // As when Photo is removed: a photo chosen in this draft for an unsaved Photo widget is dropped.
    if (draftRef.current.widgets.photo && !after.widgets.photo) forgetUnsavedPhoto('photo');
    densityHistory.current = undefined;
    resizeExploration.current = null;
    selectWidget(null);
    setRoomNotice(null);
    setDensityNotice(null);
    say('');
    change(() => after);
    setDataMessage({
      text: sameEffectiveSettings(savedRef.current, after)
        ? 'Layout is back to the default.'
        : 'Layout reset. Save changes to keep it.',
    });
    setStyleFocus({ target: '.reset-layout', edit: true });
  }
  const pendingCount = state.reminders.filter((item) => !item.completed).length;
  // The built-in style whose look is showing (#153): pressed whenever applying it changes nothing.
  const lookPreset = matchingBuiltinPreset(draft.appearance);
  // #151: the kept custom colour (the draft's, else the saved one), selectable again after Native.
  // A built-in style's own single colour (Phone's or Night's) is one the user never chose, so it is
  // offered only while it is the accent: in the draft, or in saved data (#303: older colour-mode data
  // that applied Night or Phone before Native colours), where it stays one activation away until
  // another colour is saved, like any other kept colour.
  const builtinColour = (color: string) =>
    BUILTIN_PRESETS.some((preset) => builtinLook(preset).accentColor === color.toLowerCase());
  const customAccent =
    draft.appearance.accentMode === 'color' && !accentSwatch(draft.appearance.accentColor)
      ? draft.appearance.accentColor
      : ([
          [draft.appearance.accentColor, false],
          [saved.appearance.accentColor, saved.appearance.accentMode === 'color'],
        ] as const).find(
          ([color, wasAccent]) => !accentSwatch(color) && (wasAccent || !builtinColour(color)),
        )?.[0] ?? null;
  // #344: a typed name another saved style already uses (without case or surrounding spaces).
  const presetConflict = duplicateStyleName(draft.savedPresets, presetName);
  const customActive =
    customAccent !== null &&
    draft.appearance.accentMode === 'color' &&
    draft.appearance.accentColor.toLowerCase() === customAccent.toLowerCase();
  const saveBlocked =
    !dirty || saving || locationBusy || photoBusy || !!draftProblem;
  const weatherPending =
    !same(draft.location, state.settings.location) ||
    draft.locationSource !== state.settings.locationSource ||
    draft.units !== state.settings.units;
  const weatherRefreshing =
    saved.location.latitude !== state.weather.location.latitude ||
    saved.location.longitude !== state.weather.location.longitude ||
    (saved.units === 'metric' ? '°C' : '°F') !==
      state.weather.units.temperature;
  const weatherNote = weatherPending
    ? `Weather updates after Save · preview still shows ${state.weather.location.name}`
    : weatherRefreshing
      ? `Updating weather · preview still shows ${state.weather.location.name}`
      : '';
  // A message from an edit in the Widgets list shows there while the list is on screen; every other
  // layout message shows in the canvas line. The announcer speaks each one once either way (#311).
  const listShown = section === 'Widgets' && !pickerOpen;
  const canvasMessage = layoutMessage && (layoutMessage.where === 'canvas' || !listShown) ? layoutMessage.text : '';
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
        {/* #360: Open display is an ordinary browser tab; say where the full-screen display is. */}
        <div className="open-display-group">
          <p className="open-display-hint" id="open-display-hint">
            For full screen on this PC: Start › Living Room Display - Show display, or press F
            on the display
          </p>
          <a
            className="button open-display"
            href="/display"
            target="_blank"
            rel="noreferrer"
            aria-describedby="open-display-hint"
          >
            <Icon name="monitor" size={17} />
            Open display
            <Icon name="arrow" size={15} />
          </a>
        </div>
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
                say('');
                setDensityNotice(null);
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
                  onSelect={(id, tapped) => {
                    selectWidget(id, tapped);
                    setSection('Widgets');
                    setPickerOpen(false);
                  }}
                  onPreview={(grid, gesture) => { setGridPreview(grid); setGridGesture(gesture ?? null); }}
                  onCommit={canvasEdit}
                  onNoRoom={(request, via) => reportNoRoom(request, via === 'pointer')}
                  onMessage={setGridMessage}
                  resizeBase={resizeBase}
                />
              )}
            </div>
          </div>
          </div>
          <div className="canvas-toolbar">
            {!layoutEditing && <span>Your saved arrangement</span>}
            {layoutEditing ? (
              <label className="grid-density-control">
                {/* #345: a short visible label; the select keeps its full accessible name. */}
                <span className="grid-density-label">Grid</span>
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
            {/* The one live region for layout messages, mounted before any text arrives (#311, #341). */}
            <p className="sr-only layout-announcer" role="status">
              {layoutMessage && <span key={layoutMessage.id}>{layoutMessage.text}</span>}
            </p>
            <p className="grid-status">
              {canvasMessage}
              {canvasMessage && currentDensityNotice?.refusal.remove && (
                <button type="button" className="text-button density-fix" onClick={() => applyDensityFix(currentDensityNotice.refusal)}>
                  {densityFixLabel(currentDensityNotice.refusal)}
                </button>
              )}
            </p>
            {/* #345: how to edit, in the reserved line while nothing else needs it. */}
            {layoutEditing && !canvasMessage && !weatherNote && (
              <p className="canvas-hint">
                Drag a widget to move it · drag its corner to resize<span className="canvas-hint-keys"> · arrow keys work too</span>
              </p>
            )}
            {/* Always mounted, so a screen reader announces the note when it appears. */}
            <p className="canvas-note" role="status">
              {weatherNote}
            </p>
          </div>
          {/* #227: the alert has its own row below the canvas actions and never covers them. */}
          {alert && (
            <div
              ref={alertBox}
              className={`studio-error studio-error-${alert.kind}${alertFloating && alert.kind === 'action' ? ' studio-error-floating' : ''}`}
            >
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
                    {/* #303: one spelling, and a name distinct from the kept colour's swatch. */}
                    <label className="custom-color" title="Choose a custom colour">
                      <input
                        type="color"
                        aria-label="Choose a custom colour"
                        value={draft.appearance.accentColor}
                        onChange={(event) => {
                          const accentColor = event.target.value;
                          change((previous) =>
                            withAppearance(previous, { accentMode: 'color', accentColor }),
                          );
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
                        change((previous) =>
                          withAppearance(previous, { accentMode: 'native' }),
                        );
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
                            change((previous) =>
                              withAppearance(previous, {
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
                              }),
                            );
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
                        aria-label={`Custom colour ${customAccent.toLowerCase()}`}
                        title={`Custom colour ${customAccent.toLowerCase()}`}
                        aria-pressed={customActive}
                        onClick={() => {
                          if (customActive) return;
                          change((previous) =>
                            withAppearance(previous, { accentMode: 'color', accentColor: customAccent }),
                          );
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
                              // A motion preference, not a look: the style label stays the look's (#277).
                              change((previous) => withAppearance(previous, { animation: level }));
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
                      spoken={spokenInterval(draft.appearance.motionIntervalSeconds)}
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
                      spoken={spokenSeconds(draft.appearance.fadeSeconds)}
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
                      Text colour
                      <input
                        className="color-input"
                        aria-label="Text colour"
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
                    {/* #344: what a saved style is, and the limit once it is reached. */}
                    <p className="hint preset-hint" id="preset-hint">
                      {draft.savedPresets.length >= MAX_SAVED_STYLES ? `Up to ${MAX_SAVED_STYLES} styles. ` : ''}
                      Saves the current look and widgets so you can switch back later.
                    </p>
                    <label>
                      <span className="field-label">Saved style</span>
                      <select
                        id="saved-style-select"
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
                        aria-invalid={presetConflict ? true : undefined}
                        aria-describedby={presetConflict ? 'preset-name-error' : undefined}
                      />
                    </label>
                    {presetConflict && (
                      <p className="inline-message error preset-name-error" id="preset-name-error">
                        A style named {presetConflict} already exists
                      </p>
                    )}
                    <div className="preset-actions">
                      <button
                        className="button small add-style"
                        disabled={
                          !presetName.trim() ||
                          !!presetConflict ||
                          draft.savedPresets.length >= MAX_SAVED_STYLES
                        }
                        aria-describedby="preset-hint"
                        onClick={addPreset}
                      >
                        <Icon name="plus" size={14} />
                        Add style
                      </button>
                      {presetId && (
                        <>
                          <button
                            className="button small"
                            disabled={!!duplicateStyleName(draft.savedPresets, presetName, presetId)}
                            onClick={updatePreset}
                          >
                            Update
                          </button>
                          <button
                            className="icon-button"
                            aria-label="Delete selected style"
                            onClick={deletePreset}
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
                        {/* Focused when the question appears, so it is read out (#302). */}
                        <p className="data-confirm-title" tabIndex={-1}>
                          Restore the backup from{' '}
                          {backupDate(backup, draft.clockFormat)}?
                        </p>
                        <p>
                          It replaces your saved settings, styles and reminders
                          with the backup's: {backupContents(backup)}. Your
                          photo stays as it is.
                        </p>
                        {/* #301: state.backup.json is rewritten by every change, including any
                            reminder change, and is read only by automatic recovery. */}
                        <p className="hint">
                          What's saved now stays on this computer only until the
                          next change (a settings save or any reminder change),
                          and only for automatic recovery if the saved data can't
                          be read. Export it first to keep a copy you can restore.
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
                              setStyleFocus({ target: '.restore-backup' });
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
                            className="button small keep-appearance"
                            onClick={() => {
                              setConfirmReset(false);
                              setStyleFocus({ target: '.reset-appearance' });
                            }}
                          >
                            Keep my appearance
                          </button>
                        </div>
                      </div>
                    ) : confirmLayoutReset ? (
                      <div
                        className="data-confirm reset-layout-confirm"
                        role="group"
                        aria-label="Reset layout"
                      >
                        <p>
                          Reset the layout to Calendar, Clock, Weather,
                          Forecast, Last screen and Reminders on the Balanced
                          grid? Other widgets leave the display. Widget
                          settings, the clock style, appearance and reminders
                          stay.
                        </p>
                        <div className="data-confirm-actions">
                          <button
                            className="button small primary"
                            onClick={confirmResetLayout}
                          >
                            Reset
                          </button>
                          <button
                            className="button small reset-layout-keep"
                            onClick={() => {
                              setConfirmLayoutReset(false);
                              setStyleFocus({ target: '.reset-layout' });
                            }}
                          >
                            Keep my layout
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="reset-actions">
                        <button
                          className="text-button reset-appearance"
                          onClick={() => {
                            setBackup(null);
                            setDataMessage(null);
                            setResetLook(null);
                            setConfirmReset(true);
                            // #343: the question replaces this button; the safe answer takes focus.
                            setStyleFocus({ target: '.reset-confirm .keep-appearance' });
                          }}
                        >
                          Reset appearance…
                        </button>
                        <button
                          className="text-button reset-layout"
                          onClick={() => {
                            setBackup(null);
                            setDataMessage(null);
                            setResetLook(null);
                            setConfirmLayoutReset(true);
                            // As for Reset appearance (#343): the safe answer takes focus.
                            setStyleFocus({ target: '.reset-layout-confirm .reset-layout-keep' });
                          }}
                        >
                          Reset layout…
                        </button>
                      </div>
                    )}
                    <p
                      className={`inline-message data-status ${shownDataMessage?.error ? 'error' : ''}`}
                      role="status"
                    >
                      {shownDataMessage?.text ?? ''}
                    </p>
                    {/* #302: the server's own reason for a refused backup, for whoever needs it. */}
                    {shownDataMessage?.detail && (
                      <details className="data-detail">
                        <summary>Technical details</summary>
                        <p>{shownDataMessage.detail}</p>
                      </details>
                    )}
                  </div>
                </details>
              </>
            )}
            {section === 'Widgets' && (
              <WidgetInspector
                message={layoutMessage?.where === 'list' ? layoutMessage.text : ''}
                settings={draft}
                selected={selectedWidget}
                onSelect={(id) => selectWidget(id, true)}
                reveal={reveal}
                pickerOpen={pickerOpen}
                onPicker={setPickerOpen}
                onAdd={addWidget}
                onFix={applyFix}
                roomProblem={currentRoomNotice?.problem ?? null}
                remindersHidden={reminderPresentation(draft, state.reminders, connectionError !== null) === 'hidden'}
                onRemove={removeWidget}
                onResize={resizeWidget}
                onResizeSpan={resizeWidgetSpan}
                resizeBase={resizeBase}
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
                {/* #347: the server's reason for a failed or stale forecast is on the visible line. */}
                <div className={`weather-status-row ${state.weather.status}`}>
                  <span className="status-dot" />
                  <span className="weather-status-text">
                    <span>
                      {state.weather.status === 'fresh'
                        ? ageLabel(state.weather.updatedAt)
                        : state.weather.status === 'stale'
                          ? `Saved forecast · ${ageLabel(state.weather.updatedAt).toLowerCase()}`
                          : 'Forecast unavailable'}
                    </span>
                    {state.weather.error && (
                      <span className="weather-status-error">{state.weather.error}</span>
                    )}
                  </span>
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
            {/* aria-disabled rather than disabled, so keyboard focus stays on Save while saving (#289). */}
            <button
              className="button primary"
              aria-disabled={saveBlocked}
              onClick={() => {
                if (!saveBlocked) void saveSettings();
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
