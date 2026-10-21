import type { AirQualityState } from '../shared/contracts.ts';

/**
 * AQI and UV category words, shared by Air quality and the Dynamic engine (#437), which cannot import a
 * .tsx module from plain TypeScript tests. Words carry the level; there are deliberately no
 * per-category colours.
 */
type Scale = AirQualityState['scale'];
export const SCALE_LABELS: Record<Scale, string> = { us: 'US AQI', european: 'European AQI' };
/** The short credit the footer row keeps (#221); the inspector hint names Copernicus CAMS in full. */
export const AIR_CREDIT = 'CAMS · Open-Meteo';
/** Upper bound (inclusive) of each category, its name and an optional compact name. */
export const AQI_CATEGORIES: Record<Scale, [number, string, string?][]> = {
  us: [[50, 'Good'], [100, 'Moderate'], [150, 'Unhealthy for sensitive groups', 'Sensitive groups'], [200, 'Unhealthy'], [300, 'Very unhealthy'], [Infinity, 'Hazardous']],
  european: [[20, 'Good'], [40, 'Fair'], [60, 'Moderate'], [80, 'Poor'], [100, 'Very poor'], [Infinity, 'Extremely poor']],
};
export function aqiCategory(aqi: number | null, scale: Scale, compact = false): string | null {
  if (aqi === null) return null;
  const [, name, short] = AQI_CATEGORIES[scale].find(([limit]) => Math.round(aqi) <= limit)!;
  return compact && short ? short : name;
}
/** WHO UV index categories. */
export function uvCategory(uv: number): string {
  const value = Math.round(uv);
  return value <= 2 ? 'Low' : value <= 5 ? 'Moderate' : value <= 7 ? 'High' : value <= 10 ? 'Very high' : 'Extreme';
}
