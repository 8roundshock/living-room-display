import type { GridDensity, WidgetKind, WidgetSize, WidgetSpan } from './widgets.ts';
import type { AccentMode } from './palette.ts';
import type { AnimationLevel } from './motion.ts';
export type WidgetId = WidgetKind;
/**
 * `span` is a custom whole-cell size, only for free-size widgets (#73) and only when it differs from
 * the family span; `size` is then always the largest family inside the span.
 */
export interface WidgetPlacement { column: number; row: number; size: WidgetSize; span?: WidgetSpan }
export interface WidgetGrid { revision?: 1 | 2; density: GridDensity; placements: Record<WidgetId, WidgetPlacement> }
export type Units = 'metric' | 'imperial';
export interface LocationSettings { name: string; latitude: number; longitude: number; timezone: string }
/** Follow daylight (#439): the display's brightness range, 0.1–1 like `brightness`, with dimmest ≤ brightest. */
export interface DaylightBrightness { dimmest: number; brightest: number }
export interface AppearanceSettings {
  preset: 'phone' | 'room' | 'night' | 'custom';
  accentColor: string; textColor: string; brightness: number; fontScale: number;
  fontFamily: 'sans' | 'serif' | 'mono';
  layout: 'balanced' | 'minimal' | 'weather-first';
  /** Float gently (#436): the board and each widget's text drift continuously; off (or reduced motion) steps once each interval. */
  motionEnabled: boolean;
  /** How often the board reaches a new spot (and, with `rearrange`, how often widgets swap places). */
  motionIntervalSeconds: number;
  /** Times only the Swap places glide (#436); the screen never fades out. */
  fadeSeconds: number;
  clockStyle: 'outline' | 'digital' | 'analog';
  /** `color` tints every widget's accent group with accentColor; `native` uses each widget's palette tone. Rendering arrives with #75. */
  accentMode: AccentMode;
  /** Motion inside widgets and the editor (#76); movement of the board is set by the keys above. */
  animation: AnimationLevel;
  /**
   * Brightness mode (#439): null is Fixed (`brightness` applies, the default); a range is Follow
   * daylight, peaking at local solar noon. `brightness` stays the Fixed level in both modes.
   */
  daylightBrightness: DaylightBrightness | null;
  /** Swap places (#436): widgets trade cells every interval, gliding without going dark. Off by default; omitted at rest while off. */
  rearrange: boolean;
}
export interface WidgetTransform { offsetX: number; offsetY: number; scale: number }
export interface WidgetBehavior { reminders: { hideWhenEmpty: boolean } }
export interface PreviewSettings { enabled: boolean; opacity: number; widthPercent: number }
export interface IdleSettings { enabled: boolean; idleMinutes: number }
/** This computer's screen (#436): not part of saved styles; omitted at rest while it equals the default. */
export interface ScreenSettings {
  /** Hold a screen wake lock while the display is full screen or the native screensaver shows it. */
  keepAwake: boolean;
}
export interface VisualSettings {
  appearance: AppearanceSettings;
  widgets: Record<WidgetId, boolean>;
  widgetOverrides: Record<WidgetId, WidgetTransform>;
  widgetBehavior: WidgetBehavior;
  widgetGrid: WidgetGrid;
  preview: PreviewSettings;
}
export interface SavedPreset { id: string; name: string; visual: VisualSettings }
/** Private user content (labels, titles and note text): included in exports, never in Git, diagnostics or picker samples. */
export interface WorldClockCity { id: string; label: string; timezone: string; latitude: number; longitude: number }
/** `date` is a civil YYYY-MM-DD date. */
export interface CountdownEvent { id: string; title: string; date: string; repeatsYearly: boolean }
/** What the Dynamic widget may show (#437); at least one is on. All on is the default, omitted at rest. */
export interface DynamicSources { weather: boolean; alerts: boolean; air: boolean; sky: boolean; personal: boolean }
/** Per-widget content for #78 and #437; not part of saved styles. */
export interface WidgetDataSettings {
  worldClocks: WorldClockCity[];
  calendar: { weekStart: 'locale' | 'sunday' | 'monday' };
  countdowns: CountdownEvent[];
  note: { text: string };
  airQuality: { scale: 'us' | 'european' };
  dynamic: DynamicSources;
}
export interface Settings extends VisualSettings {
  version: 1; location: LocationSettings; locationSource: 'device' | 'manual' | 'fallback'; units: Units; clockFormat: '12h' | '24h';
  idle: IdleSettings; savedPresets: SavedPreset[];
  widgetData: WidgetDataSettings;
  screen: ScreenSettings;
}
export interface SettingsPatch {
  /** Request intent only; automatic/failure-fallback selection must preserve a saved manual city. */
  automaticLocation?: boolean;
  location?: Partial<LocationSettings>; locationSource?: Settings['locationSource']; units?: Units; clockFormat?: Settings['clockFormat'];
  appearance?: Partial<AppearanceSettings>; widgets?: Partial<Record<WidgetId, boolean>>;
  widgetOverrides?: Partial<Record<WidgetId, Partial<WidgetTransform>>>;
  widgetBehavior?: { reminders?: Partial<WidgetBehavior['reminders']> };
  /** A placement `span: null` (or a `size` without `span`) clears a custom size. */
  widgetGrid?: { revision?: 2; density?: GridDensity; placements?: Partial<Record<WidgetId, Partial<Omit<WidgetPlacement, 'span'>> & { span?: WidgetSpan | null }>> };
  /** Request-only local photo mutation; never stored in settings or included in exports. */
  photoChange?: { pngBase64: string } | null;
  preview?: Partial<PreviewSettings>; idle?: Partial<IdleSettings>; savedPresets?: SavedPreset[];
  screen?: Partial<ScreenSettings>;
  /** Arrays replace whole; nested objects merge. */
  widgetData?: {
    worldClocks?: WorldClockCity[]; calendar?: Partial<WidgetDataSettings['calendar']>; countdowns?: CountdownEvent[];
    note?: Partial<WidgetDataSettings['note']>; airQuality?: Partial<WidgetDataSettings['airQuality']>;
    dynamic?: Partial<DynamicSources>;
  };
}
export type AutomaticLocationSelection = { source: 'device'; latitude: number; longitude: number; automatic: boolean } | { source: 'fallback'; automatic: boolean };
/**
 * While `completed` is true, `updatedAt` is the completion time. Completed reminders are immutable
 * except restore (`completed: false`, optionally with `text`/`dueAt` in the same patch) and delete.
 */
export interface Reminder {
  id: string; text: string; completed: boolean; dueAt: string | null;
  createdAt: string; updatedAt: string;
}
export interface ReminderInput { text: string; dueAt?: string | null }
export interface ReminderPatch { text?: string; completed?: boolean; dueAt?: string | null }
export interface ClearCompletedResult { deleted: number }
/**
 * A silent countdown timer started from Home (#438), stored only in the `timers.json` sidecar: never in
 * `state.json`, `state.backup.json` or exports. Exactly one of `endsAt` (running, or done once it has
 * passed) and `remainingMs` (paused) is set; done is derived from `endsAt`, never written. The label is
 * private user content: never logged or put in diagnostics.
 */
export interface Timer {
  id: string;
  /** 0–40 characters, trimmed; empty shows a duration name such as "5 min timer". */
  label: string;
  /** The length it was started with, 1 s to 24 h, in whole milliseconds. */
  durationMs: number;
  /** ISO UTC instant it ends while running (or ended, once done); null while paused. */
  endsAt: string | null;
  /** What was left when it was paused; null while running or done. */
  remainingMs: number | null;
  createdAt: string; updatedAt: string;
}
/** `endsAt` or `remainingMs` only for Undo, which re-creates a cancelled timer as it was. */
export interface TimerInput { label?: string; durationMs: number; endsAt?: string; remainingMs?: number }
/** Exactly one action per request. */
export type TimerPatch = { paused: boolean } | { addMs: number } | { restart: true };
export interface TimersResult { timers: Timer[]; warning: string | null }
/** `GET /api/changes`: an opaque marker that changes after every saved change (#438). */
export interface ChangeMarker { change: string }
export interface WeatherCurrent {
  time: string; temperature: number | null; feelsLike: number | null;
  weatherCode: number | null; isDay: boolean; windSpeed: number | null;
}
export interface WeatherDay {
  date: string; weatherCode: number | null; temperatureMax: number | null;
  temperatureMin: number | null; precipitationProbability: number | null;
  precipitationAmount: number | null;
}
export interface RainInterval {
  intervalStart: string; intervalEnd: string;
  precipitationProbability: number | null; precipitationAmount: number | null;
  /** Rain plus showers; probability above includes snow and other precipitation. */
  rainAmount: number | null;
}
export interface WeatherState {
  status: 'fresh' | 'stale' | 'unavailable'; updatedAt: string | null; error: string | null;
  source: 'Open-Meteo'; sourceUrl: string; location: LocationSettings;
  units: { temperature: '°C' | '°F'; windSpeed: 'km/h' | 'mph'; precipitation: 'mm' | 'in' };
  current: WeatherCurrent | null; daily: WeatherDay[]; hourly: RainInterval[];
  /** API-only, never persisted (#351): a provider request for this state is still in flight, so ask again soon. */
  refreshing?: boolean;
}
export interface PreviewState {
  available: boolean; capturedAt: string | null; width: number | null; height: number | null;
}
export interface PhotoState { available: boolean; id: string | null; width: number | null; height: number | null; updatedAt: string | null }
export type AirPollutant = 'pm2_5' | 'pm10' | 'ozone' | 'nitrogen_dioxide' | 'sulphur_dioxide' | 'carbon_monoxide';
/** One hourly model value at an instant (not an interval). */
export interface AirQualityReading { time: string; aqi: number | null; uvIndex: number | null }
/** CAMS model estimate via Open-Meteo for the saved weather location; `off` means no request was made. */
export interface AirQualityState {
  status: 'fresh' | 'stale' | 'unavailable' | 'off'; updatedAt: string | null; error: string | null;
  source: 'CAMS via Open-Meteo'; sourceUrl: string; location: LocationSettings; scale: 'us' | 'european';
  /** pm2_5/pm10 in µg/m³; `dominant` is the pollutant with the highest sub-index. */
  current: { time: string; aqi: number | null; dominant: AirPollutant | null; pm2_5: number | null; pm10: number | null; uvIndex: number | null } | null;
  /** At most 24 upcoming instants, starting with the current hour. */
  hourly: AirQualityReading[];
  /** API-only, never persisted (#351): a provider request for this state is still in flight, so ask again soon. */
  refreshing?: boolean;
}
/**
 * One official alert in effect (#437). `name` is the provider's own wording (ECCC's has only its first
 * letter capitalised), never rewritten. Instants are ISO timestamps.
 */
export interface WeatherAlert {
  id: string; level: 'warning' | 'watch' | 'advisory' | 'statement'; name: string; area: string | null;
  issuedAt: string; startsAt: string | null; endsAt: string | null; expiresAt: string | null;
}
export type AlertsProvider = 'eccc' | 'nws';
export type AlertsSource = 'Environment and Climate Change Canada' | 'US National Weather Service';
/**
 * Official weather alerts for the saved weather location (#437). API-only: never persisted, exported or
 * logged. `off` means no request was made (Dynamic or its alerts are off); `unsupported` means neither
 * provider covers the place, which never reads as "no alerts".
 */
export interface AlertsState {
  status: 'off' | 'fresh' | 'stale' | 'unavailable' | 'unsupported';
  provider: AlertsProvider | null; source: AlertsSource | null; sourceUrl: string | null;
  /** The covering forecast zone (ECCC), or the first area an alert names (NWS). */
  area: string | null;
  /** The last successful check. */
  checkedAt: string | null; error: string | null;
  /** At most 10, warnings first. */
  alerts: WeatherAlert[];
  /** API-only: a provider request for this state is still in flight, so ask again soon. */
  refreshing?: boolean;
}
export interface AppState {
  /** Effective scheduled visuals are API-only; settings remains the manual editor source. */
  schedule?: import('./schedule.ts').ScheduleSnapshot;
  settings: Settings; reminders: Reminder[]; weather: WeatherState; preview: PreviewState; photo?: PhotoState; airQuality?: AirQualityState; alerts?: AlertsState; storageWarning?: string | null;
  /** API-only (#438): the timers from `timers.json`, and why they were cleared after a restart, if they were. */
  timers?: Timer[]; timersWarning?: string | null;
}
export interface LocationResult extends LocationSettings { id: number; country: string; admin1: string }
export interface ApiError { error: string }
export interface HostSession { token: string; settings: Settings; displayUrl: string }
export interface DataExport { version: 1; exportedAt: string; settings: Settings; reminders: Reminder[] }
/** Seconds on plugged-in (AC) and battery (DC) power; 0 means Never. */
export interface PowerTimeouts { ac: number; dc: number }
/**
 * The active power plan's display-off and sleep timeouts (#436), read with `powercfg /query`: read-only
 * and without administrator rights. `available` is false off Windows; a value Windows would not report
 * is null, with `error` saying so.
 */
export interface PowerStatus {
  available: boolean; scheme: string | null;
  displayOffSeconds: PowerTimeouts | null; sleepSeconds: PowerTimeouts | null; error?: string;
}
/** `GET /api/windows/status`: the screensaver registry values and (#436) the power plan, never changed. */
export interface WindowsStatus {
  available: boolean; selectedScreenSaver: string | null; active: boolean | null;
  timeoutSeconds: number | null; secure: boolean | null; isLivingRoomDisplay: boolean; error?: string;
  power: PowerStatus;
}
