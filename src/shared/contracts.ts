export type WidgetId = 'clock' | 'weather' | 'forecast' | 'reminders' | 'preview';
export type Units = 'metric' | 'imperial';
export interface LocationSettings { name: string; latitude: number; longitude: number; timezone: string }
export interface AppearanceSettings {
  preset: 'phone' | 'room' | 'night' | 'custom';
  accentColor: string; textColor: string; brightness: number; fontScale: number;
  fontFamily: 'sans' | 'serif' | 'mono';
  layout: 'balanced' | 'minimal' | 'weather-first';
  motionEnabled: boolean; motionIntervalSeconds: number; fadeSeconds: number;
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
  preview: PreviewSettings;
}
export interface SavedPreset { id: string; name: string; visual: VisualSettings }
export interface Settings extends VisualSettings {
  version: 1; location: LocationSettings; locationSource: 'device' | 'manual' | 'fallback'; units: Units; clockFormat: '12h' | '24h';
  idle: IdleSettings; savedPresets: SavedPreset[];
}
export interface SettingsPatch {
  /** Request intent only; automatic/failure-fallback selection must preserve a saved manual city. */
  automaticLocation?: boolean;
  location?: Partial<LocationSettings>; locationSource?: Settings['locationSource']; units?: Units; clockFormat?: Settings['clockFormat'];
  appearance?: Partial<AppearanceSettings>; widgets?: Partial<Record<WidgetId, boolean>>;
  widgetOverrides?: Partial<Record<WidgetId, Partial<WidgetTransform>>>;
  widgetBehavior?: { reminders?: Partial<WidgetBehavior['reminders']> };
  preview?: Partial<PreviewSettings>; idle?: Partial<IdleSettings>; savedPresets?: SavedPreset[];
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
export interface AppState { settings: Settings; reminders: Reminder[]; weather: WeatherState; preview: PreviewState; storageWarning?: string | null }
export interface LocationResult extends LocationSettings { id: number; country: string; admin1: string }
export interface ApiError { error: string }
export interface HostSession { token: string; settings: Settings; displayUrl: string }
export interface DataExport { version: 1; exportedAt: string; settings: Settings; reminders: Reminder[] }
