import type { Settings, WidgetId, WidgetTransform } from './contracts.ts';

export const WIDGET_IDS: WidgetId[] = ['clock', 'weather', 'forecast', 'reminders', 'preview'];
export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  location: { name: 'Toronto', latitude: 43.6532, longitude: -79.3832, timezone: 'America/Toronto' },
  locationSource: 'fallback',
  units: 'metric', clockFormat: '12h',
  appearance: {
    preset: 'room', accentColor: '#8aa8c2', textColor: '#b8c1ca', brightness: 0.55,
    fontScale: 1, fontFamily: 'sans', layout: 'balanced',
    motionEnabled: true, motionIntervalSeconds: 180, fadeSeconds: 2,
  },
  widgets: { clock: true, weather: true, forecast: true, reminders: true, preview: true },
  widgetBehavior: { reminders: { hideWhenEmpty: true } },
  widgetOverrides: Object.fromEntries(WIDGET_IDS.map(id => [id, { offsetX: 0, offsetY: 0, scale: 1 }])) as Record<WidgetId, WidgetTransform>,
  preview: { enabled: true, opacity: 0.08, widthPercent: 20 },
  idle: { enabled: false, idleMinutes: 10 }, savedPresets: [],
};

export function defaultSettings(): Settings { return structuredClone(DEFAULT_SETTINGS); }
