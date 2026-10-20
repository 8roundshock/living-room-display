import type { AppState, Settings } from '../../shared/contracts.ts';
import { ageLabel } from '../format.ts';
import { weatherAttributionWidget } from '../model.ts';

export { conditionLabel, conditions } from '../weather-conditions.ts';
/** Forecast carries its own credit line; Weather shows it only when Forecast is off, and Dynamic only when both are (#437). */
export function SourceCredit({ id, settings }: { id: 'weather' | 'dynamic'; settings: Settings }) {
  return weatherAttributionWidget(settings) === id ? <div className="weather-credit">Forecast by Open-Meteo</div> : null;
}
/** The update age; “Updated 5 hr ago” never wraps inside, so “5” and “hr ago” stay together (#221). */
export function WeatherAge({ weather, disconnected, now }: { weather: AppState['weather']; disconnected: boolean; now: Date }) {
  return <div className={`weather-age ${weather.status !== 'fresh' || disconnected ? 'stale' : ''}`}>{disconnected ? 'Offline · ' : weather.status === 'stale' ? 'Saved forecast · ' : ''}<span className="weather-age-value">{ageLabel(weather.updatedAt, now.getTime())}</span></div>;
}
