/**
 * Condition wording for WMO weather codes (Open-Meteo), shared by every weather renderer and by the
 * Dynamic engine (#437), which cannot import a .tsx module from plain TypeScript tests.
 */
export const conditions: Record<number, string> = { 0: 'Clear skies', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms with hail', 99: 'Thunderstorms with hail' };

export function conditionLabel(code: number | null): string {
  return code === null ? 'Conditions unavailable' : conditions[code] ?? 'Weather conditions';
}
