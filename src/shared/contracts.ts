import type { GridDensity, WidgetKind, WidgetSize } from './widgets.ts';
import type { AccentMode } from './palette.ts';
import type { AnimationLevel } from './motion.ts';
export type WidgetId = WidgetKind;
export interface WidgetPlacement { column: number; row: number; size: WidgetSize }
export interface WidgetGrid { revision?: 1 | 2; density: GridDensity; placements: Record<WidgetId, WidgetPlacement> }
export type Units = 'metric' | 'imperial';
export interface LocationSettings { name: string; latitude: number; longitude: number; timezone: string }
export interface AppearanceSettings {
  preset: 'phone' | 'room' | 'night' | 'custom';
  accentColor: string; textColor: string; brightness: number; fontScale: number;
  fontFamily: 'sans' | 'serif' | 'mono';
  layout: 'balanced' | 'minimal' | 'weather-first';
  motionEnabled: boolean; motionIntervalSeconds: number; fadeSeconds: number;
  clockStyle: 'outline' | 'digital' | 'analog';
  /** `color` tints every widget's accent group with accentColor; `native` uses each widget's palette tone. Rendering arrives with #75. */
  accentMode: AccentMode;
  /** Motion inside widgets and the editor; relocation through black is unaffected. Arrives with #76. */
  animation: AnimationLevel;
}
export interface WidgetTransform { offsetX: number; offsetY: number; scale: number }
export interface WidgetBehavior { reminders: { hideWhenEmpty: boolean } }
export interface PreviewSettings { enabled: boolean; opacity: number; widthPercent: number }
export interface IdleSettings { enabled: boolean; idleMinutes: number }
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
/** Per-widget content for #78; not part of saved styles. */
export interface WidgetDataSettings {
  worldClocks: WorldClockCity[];
  calendar: { weekStart: 'locale' | 'sunday' | 'monday' };
  countdowns: CountdownEvent[];
  note: { text: string };
  airQuality: { scale: 'us' | 'european' };
}
export interface Settings extends VisualSettings {
  version: 1; location: LocationSettings; locationSource: 'device' | 'manual' | 'fallback'; units: Units; clockFormat: '12h' | '24h';
  idle: IdleSettings; savedPresets: SavedPreset[];
  widgetData: WidgetDataSettings;
}
export interface SettingsPatch {
  /** Request intent only; automatic/failure-fallback selection must preserve a saved manual city. */
  automaticLocation?: boolean;
  location?: Partial<LocationSettings>; locationSource?: Settings['locationSource']; units?: Units; clockFormat?: Settings['clockFormat'];
  appearance?: Partial<AppearanceSettings>; widgets?: Partial<Record<WidgetId, boolean>>;
  widgetOverrides?: Partial<Record<WidgetId, Partial<WidgetTransform>>>;
  widgetBehavior?: { reminders?: Partial<WidgetBehavior['reminders']> };
  widgetGrid?: { revision?: 2; density?: GridDensity; placements?: Partial<Record<WidgetId, Partial<WidgetPlacement>>> };
  /** Request-only local photo mutation; never stored in settings or included in exports. */
  photoChange?: { pngBase64: string } | null;
  preview?: Partial<PreviewSettings>; idle?: Partial<IdleSettings>; savedPresets?: SavedPreset[];
  /** Arrays replace whole; nested objects merge. */
  widgetData?: {
    worldClocks?: WorldClockCity[]; calendar?: Partial<WidgetDataSettings['calendar']>; countdowns?: CountdownEvent[];
    note?: Partial<WidgetDataSettings['note']>; airQuality?: Partial<WidgetDataSettings['airQuality']>;
  };
}
export type AutomaticLocationSelection = { source: 'device'; latitude: number; longitude: number; automatic: boolean } | { source: 'fallback'; automatic: boolean };
export interface Reminder {
  id: string; text: string; completed: boolean; dueAt: string | null;
  createdAt: string; updatedAt: string;
}
export interface ReminderInput { text: string; dueAt?: string | null }
export interface ReminderPatch { text?: string; completed?: boolean; dueAt?: string | null }
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
}
export interface PreviewState {
  available: boolean; capturedAt: string | null; width: number | null; height: number | null;
}
export interface PhotoState { available: boolean; id: string | null; width: number | null; height: number | null; updatedAt: string | null }
export interface AppState { settings: Settings; reminders: Reminder[]; weather: WeatherState; preview: PreviewState; photo?: PhotoState; storageWarning?: string | null }
export interface LocationResult extends LocationSettings { id: number; country: string; admin1: string }
export interface ApiError { error: string }
export interface HostSession { token: string; settings: Settings; displayUrl: string }
export interface DataExport { version: 1; exportedAt: string; settings: Settings; reminders: Reminder[] }
