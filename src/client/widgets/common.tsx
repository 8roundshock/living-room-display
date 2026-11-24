import type { AppState } from '../../shared/contracts.ts';
import { weatherStatus } from '../format.ts';

export { conditionLabel, conditions } from '../weather-conditions.ts';
/**
 * The line a forecast that is not fresh keeps (#715): “Saved forecast · Updated 5 hr ago” or “Offline ·
 * Updated 5 hr ago” in the status tone. Fresh weather renders nothing here: no update age and no provider
 * name on the display (owner decision, 2026-11-22; the credit lives in Settings). “Updated 5 hr ago” never
 * wraps inside, so “5” and “hr ago” stay together (#221).
 */
export function WeatherAge({ weather, disconnected, now }: { weather: AppState['weather']; disconnected: boolean; now: Date }) {
  const status = weatherStatus(weather, disconnected, now.getTime());
  if (!status) return null;
  return <div className="weather-age stale status-caution">{status.label && `${status.label} · `}<span className="weather-age-value">{status.age}</span></div>;
}
