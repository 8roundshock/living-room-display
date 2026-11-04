import type { WeatherDetailReading, WeatherState } from '../shared/contracts.ts';

const HOUR = 3600_000;
/** WMO families used by Dynamic and weather themes; these are forecast conditions, not official alerts. */
export const HAZARD_FAMILIES = {
  hail: [96, 99], storm: [95], freezing: [56, 57, 66, 67], heavySnow: [75, 86], heavyRain: [65, 82],
} as const satisfies Record<string, readonly number[]>;
export type WeatherHazardFamily = keyof typeof HAZARD_FAMILIES;
export function hazardFamily(code: number | null | undefined): WeatherHazardFamily | null {
  return code == null ? null : (Object.keys(HAZARD_FAMILIES) as WeatherHazardFamily[])
    .find(family => (HAZARD_FAMILIES[family] as readonly number[]).includes(code)) ?? null;
}
export interface WeatherHazardSpell {
  family: WeatherHazardFamily; code: number;
  /** First and last matching forecast instants, inclusive. One sample has start === end. */
  start: number; end: number;
}
/** Optional weatherCode also permits older API data with no hourly codes. */
type Reading = WeatherDetailReading & { weatherCode?: number | null };
function readings(weather: Pick<WeatherState, 'details'>): Array<{ reading: Reading; time: number }> {
  const seen = new Set<number>();
  return (weather.details ?? []).map(reading => ({ reading, time: Date.parse(reading.time) }))
    .filter(({ time }) => Number.isFinite(time) && !seen.has(time) && !!seen.add(time))
    .sort((a, b) => a.time - b.time);
}
/**
 * Upcoming hourly condition samples, never today's worst daily code. A condition is valid at its
 * timestamp: do not turn a past storm into a current one, or invent an extra hour after the final
 * sample. Gaps and unknown/nonhazard codes break a spell. Callers retain forecast age/offline wording;
 * a decorative theme should additionally require fresh, connected weather.
 */
export function weatherHazardSpells(weather: Pick<WeatherState, 'details'>, now: number): WeatherHazardSpell[] {
  const spells: WeatherHazardSpell[] = [];
  for (const { reading, time } of readings(weather)) {
    if (time < now || time > now + 24 * HOUR) continue;
    const family = hazardFamily(reading.weatherCode);
    if (!family) continue;
    const last = spells.at(-1);
    if (last?.family === family && last.end + HOUR === time) last.end = time;
    else spells.push({ family, code: reading.weatherCode!, start: time, end: time });
  }
  return spells;
}
export interface GustForecastSpell {
  /** Real preceding-hour interval boundaries: start inclusive, end exclusive. */
  start: number; end: number; peak: number;
}
/** Gusts are a maximum over the preceding hour, unlike instantaneous condition codes. */
export function gustForecastSpells(weather: Pick<WeatherState, 'details'>, now: number, threshold: number): GustForecastSpell[] {
  const spells: GustForecastSpell[] = [];
  for (const { reading, time } of readings(weather)) {
    if (time <= now || time - HOUR > now + 24 * HOUR || reading.windGust == null || !Number.isFinite(reading.windGust) || reading.windGust < threshold) continue;
    const last = spells.at(-1);
    if (last?.end === time - HOUR) { last.end = time; last.peak = Math.max(last.peak, reading.windGust); }
    else spells.push({ start: time - HOUR, end: time, peak: reading.windGust });
  }
  return spells;
}
