import type { Settings, WidgetId, WidgetTransform } from './contracts.ts';
import { WIDGET_IDS, defaultBoardGrid, defaultBoardVisibility } from './widgets.ts';

export { WIDGET_IDS } from './widgets.ts';
export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  location: { name: 'Toronto', latitude: 43.6532, longitude: -79.3832, timezone: 'America/Toronto' },
  locationSource: 'fallback',
  units: 'metric', clockFormat: '12h',
  appearance: {
    preset: 'room', accentColor: '#8aa8c2', textColor: '#b8c1ca', brightness: 0.55,
    fontScale: 1, fontFamily: 'sans', layout: 'balanced',
    motionEnabled: true, motionIntervalSeconds: 180, fadeSeconds: 2,
    clockStyle: 'outline',
    // New installs and built-in styles use native colours (#75); data without the key reads as color.
    accentMode: 'native', animation: 'subtle',
    // Fixed brightness (#439); Follow daylight stores its range here.
    daylightBrightness: null,
    // #436: widgets keep their places and float; swapping is opt-in.
    rearrange: false,
  },
  // The default board (#435). Older saved data backfills from the catalog instead (validation.ts).
  widgets: defaultBoardVisibility(),
  widgetGrid: defaultBoardGrid(),
  widgetBehavior: { reminders: { hideWhenEmpty: true } },
  widgetOverrides: Object.fromEntries(WIDGET_IDS.map(id => [id, { offsetX: 0, offsetY: 0, scale: 1 }])) as Record<WidgetId, WidgetTransform>,
  preview: { enabled: true, opacity: 0.24, widthPercent: 20 },
  idle: { enabled: false, idleMinutes: 10 }, savedPresets: [],
  widgetData: {
    worldClocks: [], calendar: { weekStart: 'locale' }, countdowns: [], note: { text: '' }, airQuality: { scale: 'us' },
    // #437: everything Dynamic may show is on by default; this default section is omitted at rest.
    dynamic: { weather: true, alerts: true, air: true, sky: true, personal: true },
  },
  screen: { keepAwake: true },
};

export function defaultSettings(): Settings { return structuredClone(DEFAULT_SETTINGS); }
