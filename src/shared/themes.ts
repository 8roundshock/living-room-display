/** Whole-screen atmosphere is an optional part of a saved visual style. */
export const THEME_MODES = ['off', 'weather', 'seasonal', 'combined'] as const;
export type ThemeMode = typeof THEME_MODES[number];
export const HOLIDAY_CALENDARS = ['CA', 'KR', 'RU'] as const;
export type ThemeCalendar = typeof HOLIDAY_CALENDARS[number];
export interface ThemeSettings { mode: ThemeMode; calendars: ThemeCalendar[]; foreground?: boolean }
export const THEME_LABELS: Record<ThemeMode, string> = {
  off: 'Off', weather: 'Weather', seasonal: 'Seasonal & holidays', combined: 'Combined',
};
export const CALENDAR_LABELS: Record<ThemeCalendar, string> = { CA: 'Canada', KR: 'Korea', RU: 'Russia' };
export function defaultTheme(): ThemeSettings { return { mode: 'off', calendars: [...HOLIDAY_CALENDARS] }; }
