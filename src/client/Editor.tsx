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
  Settings,
  SavedPreset,
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
  reminderPresentation,
  resetAppearance,
  resetLayout,
  spokenInterval,
  spokenSeconds,
  withAppearance,
} from './model';
import { defaultDaylightRange } from './daylight';
import { DaylightStatus } from './DaylightStatus';
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
import { useAirQualityPreview } from './airPreview';
import {
  ACTIVE_WIDGET_IDS,
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
import { MotionSentence } from './ScreenSettings';
import { InfoTip } from './InfoTip';
import { prepareStyleSave, restoredStyleId, sameVisual, type StyleSaveIntent } from './style-workflow';
import { WIDGET_MODULES } from './widgets/registry';
import { preparePhoto, type PhotoDraft } from './photo';
import { StudioHeader } from './StudioHeader';
import { useDisplayWindow } from './displayWindow';
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
const sections = ['Style', 'Widgets'] as const;
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
const STYLE_SELECTION_KEY = 'still-editor-style';
function rememberedStyle(settings: Settings): string {
  try { return restoredStyleId(settings, localStorage.getItem(STYLE_SELECTION_KEY)); } catch { return ''; }
}

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

/**
 * Home's deep links into Edit display (#438), read once when the editor opens: `?add=<id>` opens the
 * Widgets tab with Edit layout on and the picker on that widget (with its Make-room fixes), for an active
 * widget that is off; `?focus=city` opens the Weather tab with City focused.
 */
function readDeepLink(widgets: Settings['widgets']): { add: WidgetId | null; focusCity: boolean; present: boolean } {
  const params = new URLSearchParams(window.location.search);
  const add = params.get('add') as WidgetId | null;
  return {
    add: add && (ACTIVE_WIDGET_IDS as readonly string[]).includes(add) && !widgets[add] ? add : null,
    focusCity: params.get('focus') === 'city',
    present: params.has('add') || params.has('focus'),
  };
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
  extra,
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
  // The revision of the saved settings this draft is based on, sent as If-Match (#287).
  const savedRevision = useRef(revisionOf(state.settings));
  // Guards Save against a second activation before the first one's state has rendered (#289).
  const savingNow = useRef(false);
  const [deepLink] = useState(() => readDeepLink(state.settings.widgets));
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
  const [layoutEditing, setLayoutEditing] = useState(deepLink.add !== null),
    [pickerOpen, setPickerOpen] = useState(deepLink.add !== null);
  const pickerOpener = useRef<HTMLElement | null>(null);
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
  const densityHistory = useRef<GridDensityHistory | undefined>(undefined);
  const [gridGesture, setGridGesture] = useState<{ id: WidgetId; x: number; y: number; width?: number; height?: number } | null>(null);
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft | null | undefined>(),
    [photoBusy, setPhotoBusy] = useState(false);
  const photoDraftRef = useRef(photoDraft),
    photoEpoch = useRef(0),
    photoId = useRef(state.photo?.id ?? null);
  const [presetName, setPresetName] = useState(''),
    [presetId, setPresetId] = useState(() => rememberedStyle(state.settings));
  const [presetOriginal, setPresetOriginal] = useState<SavedPreset | null>(() =>
    structuredClone(state.settings.savedPresets.find(item => item.id === rememberedStyle(state.settings)) ?? null));
  const [styleMode, setStyleMode] = useState<'update' | 'new' | 'rename'>('update');
  const newStyleId = useRef<string | null>(null);
  const [builtinSelection, setBuiltinSelection] = useState('');
  const [pendingStyle, setPendingStyle] = useState<string | null>(null);
  const [styleNotice, setStyleNotice] = useState('');
  const [confirmStyleDelete, setConfirmStyleDelete] = useState(false);
  const styleManagement = useRef<HTMLDetailsElement>(null);
  function closeStyleManagement(returnFocus = false) {
    const panel = styleManagement.current;
    if (!panel?.open) return;
    panel.open = false;
    if (returnFocus) panel.querySelector('summary')?.focus({ preventScroll: true });
  }
  useEffect(() => {
    const outside = (event: Event) => {
      const panel = styleManagement.current;
      if (!panel?.open || panel.contains(event.target as Node)) return;
      // Restore a hidden action's focus before pointer defaults run; a clicked
      // control still receives its normal focus, and keyboard focus is never stolen.
      closeStyleManagement(panel.contains(document.activeElement));
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('click', outside, true);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('click', outside, true);
      document.removeEventListener('focusin', outside);
    };
  }, []);
  // Style → Data & recovery (#234): a checked backup awaiting confirmation, the section's status
  // line, an import in flight and the inline Reset appearance and Reset layout (#435) questions.
  const [dataMessage, setDataMessage] = useState<{
      text: string;
      error?: boolean;
      /** The server's own text for a refused backup, behind a disclosure (#302). */
      detail?: string | null;
    } | null>(null),
    [confirmReset, setConfirmReset] = useState(false),
    [confirmLayoutReset, setConfirmLayoutReset] = useState(false);
  const mounted = useRef(true);
  const savebar = useRef<HTMLDivElement>(null);
  // #76: the editor's own reduced-motion preference turns its animation off; the canvas replays
  // the entrance once after a level is chosen.
  const editorReducedMotion = usePrefersReducedMotion();
  const displayControls = useDisplayWindow();
  const [revealNonce, setRevealNonce] = useState(0);
  // Style > Motion reads the Windows power status only once opened (#436).
  const [motionOpened, setMotionOpened] = useState(false);
  const photoChanged =
    photoDraft !== undefined &&
    (photoDraft?.id ?? null) !== (state.photo?.id ?? null);
  const settingsDirty = !sameEffectiveSettings(saved, draft) || photoChanged;
  const dirty = settingsDirty || styleMode !== 'update';
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
      active.closest('.studio-workspace, .editor-style-bar')
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
    // Short windows keep the announced, dismissible message in its normal row:
    // there is too little room below the Style toolbar for a safe floating alert.
    const narrow = window.matchMedia('(max-width: 700px) and (min-height: 361px)');
    let frame = 0;
    const update = () => {
      frame = 0;
      // The message line directly above the alert row marks where the row starts; the row needs
      // about 64 px of view below the sticky Style toolbar.
      const anchor = document.querySelector('.canvas-messages');
      if (!anchor) return;
      const bottom = anchor.getBoundingClientRect().bottom;
      const clearance =
        Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--studio-footer-clearance')) || 24;
      const toolbarBottom = document.querySelector('.editor-style-bar')?.getBoundingClientRect().bottom ?? 0;
      const inView = bottom >= toolbarBottom && bottom + 64 <= window.innerHeight - clearance + 24;
      // The toolbar now occupies the top edge. Place a floating message in the next free
      // vertical gap, so scrolling a canvas action into view never puts it under the alert.
      const alertHeight = alertBox.current?.getBoundingClientRect().height ?? 64;
      const protectedControls = [...document.querySelectorAll<HTMLElement>('.canvas-heading-actions button, .canvas-toolbar button, .canvas-toolbar select')];
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !active.closest('.studio-error, .editor-style-bar')) protectedControls.push(active);
      const occupied = protectedControls.map(control => control.getBoundingClientRect())
        .filter(box => box.width > 0 && box.height > 0 && box.bottom > toolbarBottom && box.top < window.innerHeight)
        .sort((a, b) => a.top - b.top);
      const alertWidth = Math.min(420, window.innerWidth - 24);
      let position: { top: number; left: number } | null = null;
      for (const left of [12, window.innerWidth - alertWidth - 12]) {
        let top = toolbarBottom + 8;
        for (const box of occupied.filter(box => box.right > left && box.left < left + alertWidth)) {
          if (top + alertHeight + 8 <= box.top) break;
          if (top < box.bottom + 8) top = box.bottom + 8;
        }
        if (top + alertHeight <= window.innerHeight - 12) { position = { top, left }; break; }
      }
      document.documentElement.style.setProperty('--studio-alert-top', `${position?.top ?? toolbarBottom + 8}px`);
      document.documentElement.style.setProperty('--studio-alert-left', `${position?.left ?? 12}px`);
      // In a viewport with no free region, keep the message in its ordinary row instead
      // of forcing it over a control. Wide, short windows can use either side of the canvas.
      setAlertFloating(narrow.matches && !inView && position !== null);
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
      document.documentElement.style.removeProperty('--studio-alert-top');
      document.documentElement.style.removeProperty('--studio-alert-left');
    };
  }, [floatingKey, alertFloating]);
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
      const toolbar = document.querySelector('.editor-style-bar')?.getBoundingClientRect();
      root.style.setProperty('--studio-footer-clearance', '24px');
      root.style.setProperty('--studio-toolbar-height', `${toolbar?.height ?? 0}px`);
      root.style.setProperty('--studio-toolbar-bottom', `${Math.max(0, toolbar?.bottom ?? 0)}px`);
    };
    const observer = new ResizeObserver(measure);
    const toolbar = document.querySelector('.editor-style-bar');
    if (toolbar) observer.observe(toolbar);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
      root.classList.remove('studio-editor');
      root.style.removeProperty('--studio-footer-clearance');
      root.style.removeProperty('--studio-toolbar-height');
      root.style.removeProperty('--studio-toolbar-bottom');
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
    // Keep the captured selected record as the conflict baseline, but never resurrect its stale
    // draft metadata after another editor changes/deletes it. The local visual draft survives.
    if (presetOriginal && !same(presetOriginal, incoming.savedPresets.find(item => item.id === presetOriginal.id))) {
      const current = incoming.savedPresets.find(item => item.id === presetOriginal.id);
      rebased.settings.savedPresets = rebased.settings.savedPresets.flatMap(item => item.id === presetOriginal.id ? current ? [structuredClone(current)] : [] : [item]);
    }
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
    needsForecast(draft) && !needsForecast(saved);
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
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    // Unsaved settings, or an open reminder form with typed text it has not saved (#274), ask first.
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
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
    updateDraft(structuredClone(savedRef.current));
    const selected = rememberedStyle(savedRef.current);
    setPresetId(selected);
    setPresetOriginal(structuredClone(savedRef.current.savedPresets.find(item => item.id === selected) ?? null));
    setStyleMode('update'); newStyleId.current = null; setBuiltinSelection('');
    setPendingStyle(null); setStyleNotice(''); setConfirmStyleDelete(false);
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
  function styleSaveIntent(): StyleSaveIntent {
    if (styleMode === 'new') return { kind: 'new', id: newStyleId.current ??= crypto.randomUUID(), name: presetName };
    const visualEdited = !sameVisual(getVisual(savedRef.current), getVisual(draftRef.current));
    if (presetId && presetOriginal && (styleMode === 'rename' || (visualEdited && !sameVisual(presetOriginal.visual, getVisual(draftRef.current)))))
      return { kind: 'update', id: presetId, original: structuredClone(presetOriginal), ...(styleMode === 'rename' ? { name: presetName } : {}) };
    return { kind: 'current' };
  }
  async function saveSettings(): Promise<boolean> {
    if (savingNow.current) return false;
    savingNow.current = true;
    const intent = styleSaveIntent();
    let base = savedRef.current,
      revision = savedRevision.current,
      submitted = structuredClone(draftRef.current);
    const automaticLocation = false;
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
        // Saved-style snapshots are request metadata, not independent draft edits. Keeping the
        // captured draft raw lets failures/cancellation leave no hidden list mutation, and lets
        // acknowledgement adopt the server's snapshot while preserving genuinely later edits.
        const prepared = prepareStyleSave(base, submitted, intent);
        const patch = settingsChanges(base, prepared, automaticLocation);
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
          let styleFailure: unknown, preparedMerged = merged.settings;
          try { preparedMerged = prepareStyleSave(current, merged.settings, intent); }
          catch (caughtStyle) {
            styleFailure = caughtStyle;
            if (intent.kind === 'update') {
              const changed = current.savedPresets.find(item => item.id === intent.id);
              live.settings.savedPresets = live.settings.savedPresets.flatMap(item => item.id === intent.id ? changed ? [structuredClone(changed)] : [] : [item]);
            }
          }
          updateDraft(live.settings);
          savedRef.current = current;
          savedRevision.current = conflict.etag;
          setSaved(current);
          setState((previous) => (previous ? { ...previous, settings: current } : previous));
          if (live.crowdedOut.length) setGridMessage(crowdedOutMessage(live.crowdedOut));
          if (styleFailure) throw styleFailure;
          const clean =
            attempt === 0 &&
            !merged.crowdedOut.length &&
            keepsSavedChanges(base, current, preparedMerged) &&
            saveProblem(preparedMerged) === null;
          if (!clean) throw caught;
          base = current;
          revision = conflict.etag;
          submitted = merged.settings;
        }
      }
      if (!mounted.current) return false;
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
      const selected = intent.kind === 'current' ? presetId : intent.id;
      const selectedRecord = received.savedPresets.find(item => item.id === selected);
      setPresetId(selectedRecord ? selected : '');
      setPresetOriginal(structuredClone(selectedRecord ?? null));
      setStyleMode('update'); setPresetName(''); newStyleId.current = null;
      setStyleNotice(''); setConfirmStyleDelete(false);
      try {
        if (selectedRecord && sameVisual(selectedRecord.visual, getVisual(received))) localStorage.setItem(STYLE_SELECTION_KEY, selectedRecord.id);
        else localStorage.removeItem(STYLE_SELECTION_KEY);
      } catch { /* Browser storage is optional; saved styles remain on the server. */ }
          setAnnouncement(
        announcement === 'Changes saved' ? 'Changes saved ' : 'Changes saved',
      );
      restoreFocusAfterSaveBar();
      if (intent.kind === 'new' || styleMode === 'rename') setStyleFocus({ target: '#saved-style-select' });
      void reload();
      return true;
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
      return false;
    } finally {
      savingNow.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  /** A selection changes the visual draft; only the top Save action persists it. */
  function applyStyleChoice(choice: string, discard = false) {
    let next = structuredClone(draftRef.current);
    if (discard) next = { ...next, ...getVisual(savedRef.current), savedPresets: structuredClone(savedRef.current.savedPresets) };
    let selected: SavedPreset | null = null;
    if (choice.startsWith('saved:')) {
      selected = next.savedPresets.find(item => item.id === choice.slice(6)) ?? null;
      if (!selected) { setStyleNotice('This style is no longer available. Your changes are still here.'); setPendingStyle(null); return; }
      next = { ...next, ...structuredClone(selected.visual), appearance: labelLook(selected.visual.appearance) };
    } else if (choice.startsWith('builtin:')) {
      const preset = choice.slice(8);
      if (!BUILTIN_PRESETS.includes(preset as typeof BUILTIN_PRESETS[number])) return;
      next = applyBuiltinPreset(next, preset as typeof BUILTIN_PRESETS[number]);
    }
    change(() => next);
    setPresetId(selected?.id ?? ''); setPresetOriginal(structuredClone(selected));
    setBuiltinSelection(choice.startsWith('builtin:') ? choice.slice(8) : '');
    setPresetName(''); setStyleMode('update'); newStyleId.current = null;
    setPendingStyle(null); setConfirmStyleDelete(false); setStyleNotice('');
  }
  function chooseStyle(choice: string) {
    if (!sameVisual(getVisual(savedRef.current), getVisual(draftRef.current)) || styleMode !== 'update' || !same(savedRef.current.savedPresets, draftRef.current.savedPresets)) {
      setPendingStyle(choice); setStyleNotice(''); return;
    }
    applyStyleChoice(choice);
  }
  function beginNewStyle() {
    if (styleMode !== 'new') { newStyleId.current = crypto.randomUUID(); setPresetName(''); }
    setStyleMode('new'); setPendingStyle(null); setConfirmStyleDelete(false); setStyleNotice('');
    setStyleFocus({ target: '#style-name', edit: true });
  }
  function renameStyle() {
    if (!presetOriginal) return;
    closeStyleManagement();
    setPresetName(presetOriginal.name); setStyleMode('rename'); setConfirmStyleDelete(false);
    setStyleFocus({ target: '#style-name', edit: true });
  }
  function keepEditingStyle() {
    setStyleMode('update'); setPresetName(''); newStyleId.current = null;
    setStyleFocus({ target: '#saved-style-select' });
  }
  function deletePreset() {
    change(previous => ({ ...previous, savedPresets: previous.savedPresets.filter(item => item.id !== presetId) }));
    setPresetId(''); setPresetOriginal(null); setPresetName(''); setStyleMode('update');
    setConfirmStyleDelete(false); setStyleNotice('Style will be deleted when you save.');
    setStyleFocus({ target: '#saved-style-select', edit: true });
  }
  async function saveAndSwitch() {
    const requested = pendingStyle;
    if (requested === null || !await saveSettings()) return;
    if (sameEffectiveSettings(savedRef.current, draftRef.current) && (photoDraftRef.current === undefined || (photoDraftRef.current?.id ?? null) === photoId.current)) applyStyleChoice(requested);
    else setStyleNotice('New edits are still unsaved. Keep editing or discard them to switch.');
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
  // #435, #474: Reset layout's line follows the same rule for the board it put on the canvas (the
  // widgets shown, the grid, where they sit and Last screen's capture). Each reset button ends the
  // other reset's tracking.
  const [resetBoard, setResetBoard] = useState<Settings | null>(null);
  const boardOf = (settings: Settings) => ({
    widgets: settings.widgets,
    density: settings.widgetGrid.density,
    placements: WIDGET_IDS.filter((id) => settings.widgets[id]).map((id) => settings.widgetGrid.placements[id]),
    preview: !!settings.widgets.preview && settings.preview.enabled,
  });
  const layoutResetOutcome = !resetBoard
    ? null
    : same(boardOf(saved), boardOf(resetBoard))
      ? 'saved'
      : same(boardOf(draft), boardOf(resetBoard))
        ? 'unsaved'
        : 'undone';
  // #499: the line shown follows the outcome in the same render, like a room notice (#310). An
  // effect's update renders a task later, so after Cancel the save bar had gone while the line still
  // asked to save, for a painted frame. The effects only record the outcomes.
  const shownDataMessage: typeof dataMessage =
    resetOutcome === 'saved'
      ? { text: 'Appearance reset and saved.' }
      : layoutResetOutcome === 'saved'
        ? { text: 'Layout reset and saved.' }
        : resetOutcome === 'undone' || layoutResetOutcome === 'undone'
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
  useEffect(() => {
    if (layoutResetOutcome === 'saved') {
      setResetBoard(null);
      setDataMessage({ text: 'Layout reset and saved.' });
    } else if (layoutResetOutcome === 'undone') {
      setResetBoard(null);
      setDataMessage(null);
    }
  }, [layoutResetOutcome]);
  // Data & recovery questions belong to the Style tab; leaving it drops them.
  useEffect(() => {
    if (section === 'Style') return;
    setConfirmReset(false);
    setConfirmLayoutReset(false);
    setDataMessage(null);
    setResetLook(null);
    setResetBoard(null);
  }, [section]);
  function confirmResetAppearance() {
    const after = resetAppearance(draftRef.current);
    const unchanged = sameEffectiveSettings(savedRef.current, after);
    setConfirmReset(false);
    // Reset is a visual draft edit of the selected style (or new-style intent).
    // Keep its save target/name, but stop claiming a starter look is selected.
    setBuiltinSelection('');
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
    const unchanged = same(boardOf(savedRef.current), boardOf(after));
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
    setResetBoard(unchanged ? null : after);
    setDataMessage({
      text: unchanged ? 'Layout is back to the default.' : 'Layout reset. Save changes to keep it.',
    });
    setStyleFocus({ target: '.reset-layout', edit: true });
  }
  const pendingCount = state.reminders.filter((item) => !item.completed).length;
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
  const presetConflict = styleMode === 'update' ? null : duplicateStyleName(draft.savedPresets, presetName, styleMode === 'new' ? newStyleId.current ?? undefined : presetId);
  const selectedStyle = draft.savedPresets.find(item => item.id === presetId);
  const styleModified = !!presetId && !!presetOriginal && !sameVisual(presetOriginal.visual, getVisual(draft));
  let styleProblem: string | null = null;
  try { prepareStyleSave(savedRef.current, draftRef.current, styleSaveIntent()); }
  catch (caught) { styleProblem = caught instanceof Error ? caught.message : 'Check the selected style.'; }
  const meaningfulStyleAction = styleMode === 'new' || (styleMode === 'rename' && presetName.trim() !== presetOriginal?.name);
  const customActive =
    customAccent !== null &&
    draft.appearance.accentMode === 'color' &&
    draft.appearance.accentColor.toLowerCase() === customAccent.toLowerCase();
  const saveBlocked =
    !dirty || (!settingsDirty && !meaningfulStyleAction) || saving || photoBusy || !!draftProblem || !!styleProblem;
  const weatherPending =
    !same(draft.location, state.settings.location) ||
    draft.locationSource !== state.settings.locationSource ||
    draft.units !== state.settings.units;
  const otherPending = Object.keys(settingsChanges(saved, draft)).some(key =>
    !['appearance', 'widgets', 'widgetOverrides', 'widgetBehavior', 'widgetGrid', 'preview', 'savedPresets', 'location', 'locationSource', 'units'].includes(key));
  const saveScope = [weatherPending ? 'weather' : '', photoChanged ? 'photo' : '', otherPending ? 'other settings' : ''].filter(Boolean).join(', ');
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
      className="studio editor-with-styles"
      data-animation={editorReducedMotion ? 'off' : draft.appearance.animation}
    >
      <StudioHeader page="edit" displayControls={displayControls} />
      <section className="editor-style-bar" aria-label="Style and save">
        <div className="style-choice-row">
          <label className="style-choice-label" htmlFor="saved-style-select">Style</label>
          <select id="saved-style-select" className="select-input style-choice" disabled={saving}
            value={presetId ? `saved:${presetId}` : builtinSelection ? `builtin:${builtinSelection}` : ''}
            onChange={event => chooseStyle(event.target.value)}>
            <option value="">Current display</option>
            {!!presetId && !selectedStyle && <option value={`saved:${presetId}`} disabled>Deleted style</option>}
            {!!draft.savedPresets.length && <optgroup label="Saved styles">
              {draft.savedPresets.map((preset, index) => <option key={preset.id} value={`saved:${preset.id}`}>
                {preset.name}{duplicateStyleName(draft.savedPresets, preset.name, preset.id) ? ` (${index + 1})` : ''}
              </option>)}
            </optgroup>}
            <optgroup label="Starter looks">
              {BUILTIN_PRESETS.map(preset => <option key={preset} value={`builtin:${preset}`}>{preset[0].toUpperCase() + preset.slice(1)}</option>)}
            </optgroup>
          </select>
          {styleModified && styleMode === 'update' && <span className="style-modified">Modified</span>}
          <InfoTip label="About styles">Saved styles include your look and layout. Starter looks change appearance and keep widgets, motion and Follow daylight.</InfoTip>
          {styleMode !== 'new' && <button className="button small" disabled={saving || draft.savedPresets.length >= MAX_SAVED_STYLES} onClick={beginNewStyle}>Save as new…</button>}
          {presetId && styleMode === 'update' && <details ref={styleManagement} className="style-management"
            onKeyDown={event => {
              if (event.key !== 'Escape' || event.defaultPrevented || !event.currentTarget.open) return;
              event.preventDefault(); event.stopPropagation(); closeStyleManagement(true);
            }}>
            <summary id="manage-style-trigger" className="button small">Manage style</summary>
            <div><button className="button small" disabled={saving} onClick={renameStyle}>Rename</button>
              <button className="button small" disabled={saving} onClick={() => { closeStyleManagement(); setConfirmStyleDelete(true); setStyleFocus({ target: '#keep-style' }); }}>Delete style…</button></div>
          </details>}
        </div>
        {styleMode !== 'update' && <div className="style-name-row">
          <label htmlFor="style-name">{styleMode === 'new' ? 'New style' : 'Style name'}</label>
          <input id="style-name" className="text-input" maxLength={60} required disabled={saving} value={presetName}
            onChange={event => setPresetName(event.target.value)} placeholder="Name" aria-invalid={!!presetConflict}
            aria-describedby={presetConflict ? 'preset-name-error' : undefined} />
          <button className="text-button" disabled={saving} onClick={keepEditingStyle}>Keep editing</button>
        </div>}
        {draft.savedPresets.length >= MAX_SAVED_STYLES && <p className="style-limit">Up to {MAX_SAVED_STYLES} styles.</p>}
        {styleProblem && (styleMode === 'update' || presetName.trim()) && <p className="inline-message error preset-name-error" id="preset-name-error" role="alert">{styleProblem}</p>}
        {presetOriginal && selectedStyle && !same(presetOriginal, selectedStyle) &&
          <button className="button small" disabled={saving} onClick={() => chooseStyle(`saved:${selectedStyle.id}`)}>Reload style</button>}
        {confirmStyleDelete && <div className="style-question" role="group" aria-label="Delete style"
          onKeyDown={event => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault(); event.stopPropagation(); setConfirmStyleDelete(false);
            setStyleFocus({ target: '#manage-style-trigger' });
          }}>
          <span>Delete {selectedStyle?.name}? Your current display stays.</span>
            <button id="keep-style" className="button small" disabled={saving} onClick={() => {
              setConfirmStyleDelete(false); setStyleFocus({ target: '#manage-style-trigger' });
            }}>Keep style</button>
            <button className="button small" disabled={saving} onClick={deletePreset}>Delete from styles</button>
        </div>}
        {pendingStyle !== null && <div className="style-question" role="group" aria-label="Switch style">
          <span>Keep your unsaved style changes?</span>
          <button className="button small" disabled={saving} onClick={() => setPendingStyle(null)}>Keep editing</button>
          <button className="button small" disabled={saving} onClick={() => applyStyleChoice(pendingStyle, true)}>Discard and switch</button>
          <button className="button small primary" aria-disabled={saveBlocked} onClick={() => { if (!saveBlocked) void saveAndSwitch(); }}>Save and switch</button>
        </div>}
        {styleNotice && <p className="style-notice" role="status">{styleNotice}</p>}
        {dirty && <div ref={savebar} className="studio-savebar has-changes">
          <span className="save-status" role="status">{saving ? 'Saving…' : draftProblem ?? (styleMode === 'new' ? 'New style' : styleMode === 'rename' ? 'Rename style' : styleSaveIntent().kind === 'update' ? `Updates ${presetOriginal?.name}` : 'Unsaved changes')}</span>
          {saveScope && <span className="style-save-scope">Also saves {saveScope} changes</span>}
          <div><button className="button cancel-settings" disabled={saving} onClick={cancelChanges}>Cancel</button>
            {pendingStyle === null && <button className="button primary" aria-disabled={saveBlocked} onClick={() => { if (!saveBlocked) void saveSettings(); }}>
              {saving ? 'Saving…' : styleMode === 'new' ? 'Save new style' : 'Save changes'}<Icon name="check" size={15} />
            </button>}
          </div>
        </div>}
      </section>
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
            <button className="icon-button canvas-add" aria-label="Add widget to display" title="Add widget" onClick={event => {
              pickerOpener.current = event.currentTarget;
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
            {!layoutEditing && <span>Layout preview</span>}
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
                {movementPreview && draft.appearance.rearrange && <>
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
            {layoutEditing && <InfoTip label="About editing the layout">Drag a widget to move it or its corner to resize. Arrow keys work too; Escape cancels a drag.</InfoTip>}
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
                <details
                  className="disclosure motion-disclosure"
                  onToggle={(event) => {
                    if (event.currentTarget.open) setMotionOpened(true);
                  }}
                >
                  <summary>
                    Motion
                    <span>{ANIMATION_LABELS[draft.appearance.animation]}</span>
                  </summary>
                  <div className="disclosure-body">
                    <div className="animation-setting">
                      <div className="field-label-with-help"><span className="field-label">Animation</span><InfoTip label="About animation">Off keeps content still. Subtle animates changes; Lively adds weather motion. Floating is controlled separately. Reduced motion follows this screen's system setting.</InfoTip></div>
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
                      {editorReducedMotion && (
                        <p className="animation-hint">
                          This screen asks for reduced motion, so animation stays off
                          here. The display follows its own system setting.
                        </p>
                      )}
                    </div>
                    {/* #240, #436: plain names for motionEnabled, motionIntervalSeconds, rearrange and fadeSeconds. */}
                    <Toggle
                      label="Float gently"
                      checked={draft.appearance.motionEnabled}
                      onChange={(value) => appearance('motionEnabled', value)}
                    />
                    <Range
                      label="Move every"
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
                    <MotionSentence appearance={draft.appearance} />
                    <Toggle
                      label="Swap places"
                      checked={draft.appearance.rearrange}
                      onChange={(value) =>
                        // A motion preference, not a look: the style preset stays as it is.
                        change((previous) => ({
                          ...previous,
                          appearance: { ...previous.appearance, rearrange: value },
                        }))
                      }
                    />
                    <p className="hint swap-hint">
                      Your saved layout stays unchanged.
                    </p>
                    {draft.appearance.rearrange && (
                      <Range
                        label="Swap glide"
                        min={0}
                        max={10}
                        value={draft.appearance.fadeSeconds}
                        display={`${draft.appearance.fadeSeconds}s`}
                        spoken={spokenSeconds(draft.appearance.fadeSeconds)}
                        onChange={(value) => appearance('fadeSeconds', value)}
                      />
                    )}
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
                <details className="disclosure data-disclosure">
                  <summary>Reset appearance &amp; layout</summary>
                  <div className="disclosure-body">
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
                                                    setDataMessage(null);
                            setResetLook(null);
                            setResetBoard(null);
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
                                                    setDataMessage(null);
                            setResetLook(null);
                            setResetBoard(null);
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
                appState={state}
                saved={saved}
                selected={selectedWidget}
                onSelect={(id) => selectWidget(id, true)}
                reveal={reveal}
                pickerOpen={pickerOpen}
                pickerInitial={deepLink.add}
                pickerOpener={pickerOpener.current}
                onPicker={open => { if (open) pickerOpener.current = document.activeElement as HTMLElement | null; setPickerOpen(open); }}
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

          </div>
        </aside>
      </main>
      <p className="sr-only save-announcer" role="status">
        {announcement}
      </p>

    </div>
  );
}
