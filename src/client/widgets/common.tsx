import type { AppState } from '../../shared/contracts.ts';
import { ageIsKnown, ageLabel, NBSP, shortAge, weatherStatus } from '../format.ts';
import { WeatherGlyph } from './WeatherGlyph.tsx';

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

/**
 * The status of a forecast that is not fresh, in the right slot of a forecast strip's heading (#715): Forecast
 * and Hourly forecast (#714) say it with the same words, in the same tone and from the same `weatherStatus`,
 * so two strips stacked one above the other always agree, also while a refresh is merely slow
 * (`presentedStatus`). “Saved forecast · 5 hr ago”; “Offline · Updated 5 hr ago”, where “Updated” stays
 * because a bare age could read as the outage's. The whole line is the shared status cue at full opacity
 * (#223), and its phrases never break inside, so a narrow slot wraps between them (#221). `compact` (small
 * Forecast, whose slot is a short second line) drops an age that tells no elapsed time (“Saved forecast”,
 * not “Saved forecast · Update time unknown”).
 */
export function ForecastStatusLine({ status, compact = false }: { status: NonNullable<ReturnType<typeof weatherStatus>>; compact?: boolean }) {
  const age = compact && status.label && !ageIsKnown(status.age) ? null : status.label === 'Saved forecast' ? shortAge(status.age) : status.age;
  return <div className="weather-context forecast-status-line status-caution">
    {status.label && <span className="forecast-status">{status.label}</span>}
    {status.label && age && <span className="forecast-separator">{NBSP}· </span>}
    {age && <span className="forecast-age">{age}</span>}
  </div>;
}

/**
 * A forecast strip with nothing to show (#362), as Weather shows it: a dim, still cloud and placeholder, one
 * status-tone line at the label size (“Forecast unavailable · retrying”, “· offline” while the display cannot
 * reach the computer), and the age only when an update time is known (a saved forecast whose days or hours have
 * all passed), in the status tone too (#715). Shared by Forecast and Hourly forecast.
 */
export function ForecastUnavailable({ what, weather, disconnected, now }: { what: string; weather: AppState['weather']; disconnected: boolean; now: Date }) {
  const reason = disconnected ? 'offline' : weather.status === 'fresh' ? null : 'retrying';
  return <>
    <div className="forecast-unavailable">
      <div className="forecast-placeholder"><WeatherGlyph code={3} still size={null} className="forecast-unavailable-glyph" /><span className="forecast-placeholder-value" aria-hidden="true"><span className="weather-placeholder-dash">—</span>°</span></div>
      <div className="forecast-unavailable-line status-caution">{reason ? `${what} unavailable${NBSP}·${NBSP}${reason}` : `${what} unavailable`}</div>
    </div>
    {weather.updatedAt && <div className="forecast-unavailable-age status-caution"><span className="forecast-age">{ageLabel(weather.updatedAt, now.getTime())}</span></div>}
  </>;
}
