import type { Settings, WeatherState } from '../shared/contracts.ts';
import { holidayWindow, seasonForDate, type HolidayThemeKey, type Season } from '../shared/holidays.ts';
import { defaultTheme } from '../shared/themes.ts';
import { DYNAMIC_THRESHOLDS } from './dynamic.ts';
import { gustForecastSpells } from './weather-hazards.ts';

export type WeatherMotif = 'rain' | 'snow' | 'storm' | 'fog' | 'wind';
export type ThemeMotif = WeatherMotif | HolidayThemeKey | Season;
export interface ThemeScene { motif: ThemeMotif; tint: string; label: string; source: 'weather' | 'season' | 'holiday'; holiday: string | null; forecast: boolean }
const HOUR = 3_600_000;
export const THEME_WEATHER_HORIZON = 3 * HOUR;
export const THEME_ACTIVE_MS = 12_000;
export const THEME_PARTICLES_MAX = 8;
export function themeCadence(motif: ThemeMotif) {
  if (motif === 'fog' || motif === 'remembrance') return { slots: 5, interval: 4000 };
  if (['rain', 'snow', 'storm', 'wind'].includes(motif)) return { slots: 8, interval: 2000 };
  return { slots: 6, interval: 3000 };
}
const SEASON_TINT = { spring: '#718b7a', summer: '#8e875e', autumn: '#9a7459', winter: '#788b9f' };
const HOLIDAY_TINT: Record<HolidayThemeKey, string> = { 'new-year': '#9a8a67', christmas: '#829780', halloween: '#a1744b', spring: '#9b7e91', harvest: '#aa8959', lanterns: '#a2836a', celebration: '#9299a5', remembrance: '#767f87' };
const WEATHER_TINT: Record<WeatherMotif, string> = { rain: '#788ea3', snow: '#94a0ae', storm: '#7e829c', fog: '#78848b', wind: '#80958e' };
const RANK: Record<WeatherMotif, number> = { storm: 5, snow: 4, rain: 3, wind: 2, fog: 1 };
const WEATHER_LABEL: Record<WeatherMotif, string> = { rain: 'Rain', snow: 'Snow', storm: 'Storms', fog: 'Fog', wind: 'Wind' };

export function themeWeatherKind(code: number | null | undefined, wind: number | null, units: WeatherState['units']['windSpeed']): WeatherMotif | null {
  if (code != null && [95, 96, 99].includes(code)) return 'storm';
  if (code != null && [71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if (code != null && [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if (wind != null && Number.isFinite(wind) && wind >= DYNAMIC_THRESHOLDS[units === 'mph' ? 'imperial' : 'metric'].WIND_BREEZY) return 'wind';
  return code === 45 || code === 48 ? 'fog' : null;
}

/** Civil date in the computer's zone; never derived by slicing UTC. */
export function themeLocalDate(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

function weatherScene(weather: WeatherState, settings: Settings, now: number, disconnected: boolean): { motif: WeatherMotif; forecast: boolean } | null {
  const updated = Date.parse(weather.updatedAt ?? '');
  if (disconnected || weather.status !== 'fresh' || !Number.isFinite(updated) || now - updated > 2 * HOUR || updated > now + 300_000) return null;
  if (Math.abs(weather.location.latitude - settings.location.latitude) > 0.11 || Math.abs(weather.location.longitude - settings.location.longitude) > 0.11) return null;
  const candidates: { motif: WeatherMotif; forecast: boolean; at: number }[] = [];
  const currentAt = Date.parse(weather.current?.time ?? '');
  if (weather.current && Number.isFinite(currentAt) && currentAt <= now + 900_000 && now - currentAt <= 90 * 60_000) {
    const motif = themeWeatherKind(weather.current.weatherCode, weather.current.windSpeed, weather.units.windSpeed);
    if (motif) candidates.push({ motif, forecast: false, at: now });
  }
  for (const reading of weather.details ?? []) {
    const at = Date.parse(reading.time);
    if (!Number.isFinite(at) || at <= now || at - now > THEME_WEATHER_HORIZON) continue;
    const motif = themeWeatherKind(reading.weatherCode, reading.windSpeed, weather.units.windSpeed);
    if (motif) candidates.push({ motif, forecast: true, at });
  }
  // Gusts describe the preceding hour. Do not imply an ongoing interval's maximum is still ahead.
  const future = { details: weather.details?.filter(reading => Date.parse(reading.time) - HOUR >= now) };
  const gustThreshold = DYNAMIC_THRESHOLDS[weather.units.windSpeed === 'mph' ? 'imperial' : 'metric'].GUST_BREEZY;
  for (const spell of gustForecastSpells(future, now, gustThreshold)) if (spell.start <= now + THEME_WEATHER_HORIZON)
    candidates.push({ motif: 'wind', forecast: true, at: spell.start });
  candidates.sort((a, b) => RANK[b.motif] - RANK[a.motif] || a.at - b.at);
  return candidates[0] ?? null;
}

/** Resolve once a minute. This is decoration, never an alert or a claim of certainty. */
export function resolveTheme(settings: Settings, weather: WeatherState, now: Date, disconnected = false, civilDate = themeLocalDate(now)): ThemeScene | null {
  const theme = settings.appearance.theme ?? defaultTheme();
  if (theme.mode === 'off') return null;
  const seasonal = theme.mode === 'seasonal' || theme.mode === 'combined';
  const holiday = seasonal ? holidayWindow(civilDate, theme.calendars) : null;
  const season = seasonForDate(civilDate, settings.location.latitude < 0 ? 'south' : 'north');
  const baseline: ThemeScene = holiday ? {
    motif: holiday.observance.themeKey, tint: HOLIDAY_TINT[holiday.observance.themeKey],
    label: `${holiday.observance.shortName}${holiday.phase === 'approaching' ? ' season' : ''}`,
    source: 'holiday', holiday: holiday.observance.name, forecast: false,
  } : { motif: season, tint: SEASON_TINT[season], label: `${season[0]!.toUpperCase()}${season.slice(1)}`, source: 'season', holiday: null, forecast: false };
  const weatherEffect = theme.mode === 'weather' || theme.mode === 'combined' ? weatherScene(weather, settings, now.getTime(), disconnected) : null;
  if (!weatherEffect) return seasonal ? baseline : null;
  return { motif: weatherEffect.motif, tint: theme.mode === 'combined' && holiday ? baseline.tint : WEATHER_TINT[weatherEffect.motif],
    label: `${WEATHER_LABEL[weatherEffect.motif]}${weatherEffect.forecast ? ' expected soon' : ' now'}${holiday ? ` · ${holiday.observance.shortName}` : ''}`,
    source: 'weather', holiday: holiday?.observance.name ?? null, forecast: weatherEffect.forecast };
}

/** Stable nonrandom coordinates avoid hydration/layout jitter and vary each minute. */
export function themeParticle(index: number, cycle: number) {
  const seed = (index * 97 + ((cycle % 997) + 997) % 997 * 31) % 997;
  return { x: 3 + (seed * 73 % 997) / 997 * 91, y: 3 + (seed * 137 % 997) / 997 * 82,
    scale: 0.6 + (seed % 7) / 10, travel: 1.5 + (index % 5) * 0.7 };
}
