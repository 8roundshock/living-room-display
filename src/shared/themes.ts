/** Whole-screen atmosphere is an optional part of a saved visual style. */
export const THEME_MODES = ['off', 'weather', 'seasonal', 'combined'] as const;
export type ThemeMode = typeof THEME_MODES[number];
export const HOLIDAY_CALENDARS = ['CA', 'KR', 'RU'] as const;
export type ThemeCalendar = typeof HOLIDAY_CALENDARS[number];
/** `transparency` (#670, Style > Transparency): how see-through the 3D scenes are, a whole number
 * from 0 (solid) to 100 (the most see-through). Absent means TRANSPARENCY.standard, the look the
 * owner picked; only another value is stored. The flat fallback renderer ignores it. */
export interface ThemeSettings { mode: ThemeMode; calendars: ThemeCalendar[]; foreground?: boolean; transparency?: number }
export const TRANSPARENCY = { min: 0, max: 100, standard: 50 } as const;
/** The Transparency in effect: the saved value, or the standard look when none is saved. */
export function themeTransparency(theme: Pick<ThemeSettings, 'transparency'>): number { return theme.transparency ?? TRANSPARENCY.standard; }
/** `theme` with `transparency` set; the standard value is stored as no key at all. */
export function withTransparency<Theme extends ThemeSettings>(theme: Theme, transparency: number): Theme {
  const { transparency: _previous, ...rest } = theme;
  return (transparency === TRANSPARENCY.standard ? rest : { ...rest, transparency }) as Theme;
}
export const THEME_LABELS: Record<ThemeMode, string> = {
  off: 'Off', weather: 'Weather', seasonal: 'Seasonal & holidays', combined: 'Combined',
};
export const CALENDAR_LABELS: Record<ThemeCalendar, string> = { CA: 'Canada', KR: 'Korea', RU: 'Russia' };
export function defaultTheme(): ThemeSettings { return { mode: 'off', calendars: [...HOLIDAY_CALENDARS] }; }
