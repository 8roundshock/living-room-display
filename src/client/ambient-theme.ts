import type { Settings, WeatherState } from '../shared/contracts.ts';
import { holidayWindow, seasonForDate } from '../shared/holidays.ts';
import { defaultTheme } from '../shared/themes.ts';
import { birthdayTreatmentForDate } from '../shared/birthdays.ts';
import { BIRTHDAY_SCENES, QUIET_PALETTE, QUIET_THEME, THEME_MOTIONS, THEME_SCENES, THEME_CLEARANCE_SECONDS, type ThemeSceneId, type ThemeMotionFrame } from '../shared/theme-registry.ts';
import { DYNAMIC_THRESHOLDS } from './dynamic.ts';
import { gustForecastSpells } from './weather-hazards.ts';

export type WeatherMotif = 'rain' | 'snow' | 'storm' | 'fog' | 'wind';
export type ThemeMotif = ThemeSceneId;
/** `motif` is what the scene is about. With weather in Combined mode it is the weather kind and `habitat`
 * is the season, holiday or birthday scene that stays on screen under it; in Weather mode there is no habitat. */
export interface ThemeScene { motif: ThemeMotif; habitat?: ThemeMotif; tint: string; companion: string; accent: string; label: string; source: 'weather' | 'season' | 'holiday' | 'birthday'; holiday: string | null; forecast: boolean; quiet: boolean }
const HOUR = 3_600_000;
export const THEME_WEATHER_HORIZON = 3 * HOUR;
export { THEME_ACTIVE_MS, THEME_PARTICLES_MAX } from '../shared/theme-registry.ts';
export function themeCadence(motif: ThemeMotif, quiet = false) {
  const { slots, interval } = quiet ? QUIET_THEME : THEME_SCENES[motif];
  return { slots, interval };
}
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
  const quiet = holiday?.policy.role === 'quiet';
  const birthday = seasonal && !quiet ? birthdayTreatmentForDate(settings.birthdays, civilDate) : null;
  const motif = birthday ? BIRTHDAY_SCENES[birthday] : holiday?.policy.role === 'major' ? holiday.policy.scene : season;
  const palette = quiet ? QUIET_PALETTE : THEME_SCENES[motif].palette;
  const baseline: ThemeScene = { motif, tint: palette[0], companion: palette[1], accent: palette[2],
    label: birthday ? THEME_SCENES[motif].label : holiday ? `${holiday.observance.shortName}${quiet ? ' · quiet season' : holiday.phase === 'approaching' ? ' season' : ''}` : THEME_SCENES[season].label,
    source: birthday ? 'birthday' : holiday ? 'holiday' : 'season', holiday: birthday ? null : holiday?.observance.name ?? null, forecast: false, quiet };
  const weatherEffect = theme.mode === 'weather' || theme.mode === 'combined' ? weatherScene(weather, settings, now.getTime(), disconnected) : null;
  if (!weatherEffect) return seasonal ? baseline : null;
  // Colours: over a holiday or birthday the weather takes that scene's palette, so the day keeps its colours;
  // over a plain season it brings its own; on a selected quiet date everything is the quiet grey.
  const weatherPalette = quiet ? QUIET_PALETTE : theme.mode === 'combined' && (holiday || birthday) ? palette : THEME_SCENES[weatherEffect.motif].palette;
  // Combined (#655, owner direction 2026-11-10: "the weather sync should be always"): the season, holiday or
  // birthday scene always stays and every weather kind is drawn over it. A weather scene on its own is Weather mode only.
  const habitat = seasonal ? motif : undefined;
  return { motif: weatherEffect.motif, ...(habitat ? { habitat } : {}), tint: weatherPalette[0], companion: weatherPalette[1], accent: weatherPalette[2], quiet,
    label: `${WEATHER_LABEL[weatherEffect.motif]}${weatherEffect.forecast ? ' expected soon' : ' now'}${birthday ? ' · Birthday' : holiday ? ` · ${holiday.observance.shortName}` : seasonal ? ` · ${THEME_SCENES[season].label}` : ''}`,
    source: 'weather', holiday: birthday ? null : holiday?.observance.name ?? null, forecast: weatherEffect.forecast };
}

/** A local illustration only: never invent a date or modify forecast/settings to demonstrate art. */
export function previewTheme(motif: ThemeSceneId): ThemeScene {
  const definition = THEME_SCENES[motif];
  return { motif, tint: definition.palette[0], companion: definition.palette[1], accent: definition.palette[2], label: definition.label,
    source: definition.group === 'Weather' ? 'weather' : definition.group === 'Seasons' ? 'season' : definition.group === 'Birthdays' ? 'birthday' : 'holiday',
    holiday: null, forecast: false, quiet: false };
}

/** Stable nonrandom coordinates avoid hydration/layout jitter and vary each minute. */
export function themeParticle(index: number, cycle: number) {
  const seed = (index * 97 + ((cycle % 997) + 997) % 997 * 31) % 997;
  return { x: 3 + (seed * 73 % 997) / 997 * 91, y: 3 + (seed * 137 % 997) / 997 * 82,
    scale: 0.6 + (seed % 7) / 10, travel: 1.5 + (index % 5) * 0.7 };
}

export interface ThemeRect { left: number; top: number; right: number; bottom: number }
/** A path is monotone between its waypoint boundaries. Sampling both sides also
 * bounds step motion without reading layout on animation frames. */
export function themeMotionTimes(seconds: number, interval: number, phase = 0, horizon = THEME_CLEARANCE_SECONDS): number[] {
  const end = seconds + horizon, values = [seconds, end];
  let boundary = (Math.floor(seconds / interval + phase) + 1 - phase) * interval;
  for (; boundary <= end; boundary += interval) values.push(Math.max(seconds, boundary - .001), boundary);
  return values;
}
/** Search bounded negative space, including a mark's motion envelope. A crowded layout
 * may omit a mark; it never paints over a reading area to meet a decorative count. */
export function placeThemeMark(index: number, cycle: number, width: number, height: number, size: number, exclusions: readonly ThemeRect[], motion: readonly ThemeMotionFrame[] = THEME_MOTIONS.drift) {
  const inset = Math.min(width, height) * .012;
  const x = motion.map(frame => frame.x * width / 100), y = motion.map(frame => frame.y * height / 100);
  const minX = Math.min(0, ...x), maxX = Math.max(0, ...x), minY = Math.min(0, ...y), maxY = Math.max(0, ...y);
  // Motion interpolates monotonically between waypoints; the square's largest
  // rotated extent is at the greatest angle (all profiles stay below 45 degrees).
  const angle = Math.max(...motion.map(frame => Math.abs(frame.turn))) * Math.PI / 180;
  for (const factor of [1, .78, .6]) {
    const extent = size * factor, padding = extent * (Math.cos(angle) + Math.sin(angle) - 1) / 2 + 4;
    const envelopeWidth = extent + padding * 2 + maxX - minX, envelopeHeight = extent + padding * 2 + maxY - minY;
    for (let candidate = 0; candidate < 54; candidate++) {
      const point = themeParticle(index + candidate * 3, cycle + candidate * 17);
      const left = inset + padding - minX + point.x / 100 * Math.max(0, width - envelopeWidth - inset * 2);
      const top = inset + padding - minY + point.y / 100 * Math.max(0, height - envelopeHeight - inset * 2);
      const box = { left: left - padding + minX, top: top - padding + minY, right: left + extent + padding + maxX, bottom: top + extent + padding + maxY };
      if (box.left < 0 || box.top < 0 || box.right > width || box.bottom > height) continue;
      if (exclusions.some(rect => box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top)) continue;
      return { left, top, size: extent, box };
    }
  }
  return null;
}
