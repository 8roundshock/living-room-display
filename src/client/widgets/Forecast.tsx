import { useMemo, type CSSProperties } from 'react';
import { widgetContentLimits } from '../../shared/widgets.ts';
import { ageLabel, civilDate, forecastDay, NBSP, shortAge, temperature, upcomingDays, weatherStatus, weatherTimeZone } from '../format.ts';
import { Icon } from '../icons.tsx';
import { TransitionText } from './TransitionText.tsx';
import { WeatherGlyph } from './WeatherGlyph.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

/**
 * The next days from the weather city's civil today: days before it never fill the strip, however
 * old the saved forecast (#243). Labels read Today, then weekdays (#256); assistive text and the
 * hover title keep “Tomorrow, 2026-10-20”. Day labels are memoized per civil date (#99).
 *
 * A forecast is the heading and the strip, nothing else: no provider name and no update age while it
 * is fresh (owner decision, 2026-11-22, #715), so nothing sits under the strip and the strip takes the
 * room the old footer held. A saved or offline forecast says so in the heading's right slot, in place
 * of the place and unit and in the status tone: “Saved forecast · 5 hr ago”, “Offline · Updated 5 hr
 * ago”, as the Hourly forecast does (#714). The slot keeps its typography, so the strip has one size
 * and one position in every state and nothing resizes when the status comes or goes; small uses the
 * same slot (its heading's second line). A forecast whose refresh is still running is fresh
 * (`presentedStatus`).
 */
function Forecast({ state: { weather }, size, now, disconnected }: WidgetContentProps) {
  const count = widgetContentLimits(size).forecastDays;
  // The city's zone, or this computer's while a device location is still `auto` (no forecast yet).
  const timeZone = useMemo(() => weatherTimeZone(weather.location.timezone), [weather.location.timezone]);
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  const today = useMemo(() => civilDate(minute, timeZone), [minute, timeZone]);
  // Recomputed when the civil date, the saved days or the family change, not every tick; `minute`
  // is always an instant on `today` when this runs.
  const days = useMemo(() => upcomingDays(weather.daily, today).slice(0, count).map(day => ({
    day, label: forecastDay(day.date, timeZone, minute, true), full: `${forecastDay(day.date, timeZone, minute)}, ${day.date}`,
  })), [weather.daily, today, timeZone, count]);
  // The heading counts the days actually shown: a saved forecast with four days left reads “Next 4 days”.
  const shown = days.length || count;
  const heading = shown === 7 ? 'The week' : shown === 1 ? 'Today' : `Next ${shown} days`;
  const status = weatherStatus(weather, disconnected, now.getTime());
  const place = <div className="weather-context">{weather.location.name} · {weather.units.temperature}</div>;
  if (!days.length) {
    // Unavailable (#362), as in Weather: a dim, still cloud and placeholder, one status-tone line at the
    // label size, and the age only when an update time is known (a saved forecast whose days have all
    // passed), in the status tone too (#715).
    const reason = disconnected ? 'offline' : weather.status === 'fresh' ? null : 'retrying';
    return <div className="widget-body forecast-body" data-forecast-unavailable="">
      <div className="forecast-heading"><div className="ambient-label">{heading}</div>{place}</div>
      <div className="forecast-unavailable">
        <div className="forecast-placeholder"><WeatherGlyph code={3} still size={null} className="forecast-unavailable-glyph" /><span className="forecast-placeholder-value" aria-hidden="true"><span className="weather-placeholder-dash">—</span>°</span></div>
        <div className="forecast-unavailable-line status-caution">{reason ? `Forecast unavailable${NBSP}·${NBSP}${reason}` : 'Forecast unavailable'}</div>
      </div>
      {weather.updatedAt && <div className="forecast-unavailable-age status-caution"><span className="forecast-age">{ageLabel(weather.updatedAt, now.getTime())}</span></div>}
    </div>;
  }
  return <div className="widget-body forecast-body">
    {/* The right slot: the place and unit, or the status of a forecast that is not fresh (#715), the whole of it in
        the shared status tone at full opacity (#223). “Updated” stays after “Offline”, where a bare age could read as
        the outage's. The phrases never break inside, so a narrow slot wraps between them (#221). */}
    <div className="forecast-heading">
      <div className="ambient-label">{heading}</div>
      {status
        ? <div className="weather-context forecast-status-line status-caution">{status.label && <><span className="forecast-status">{status.label}</span><span className="forecast-separator">{NBSP}· </span></>}<span className="forecast-age">{status.label === 'Saved forecast' ? shortAge(status.age) : status.age}</span></div>
        : place}
    </div>
    <div className="forecast-strip" style={{ '--forecast-days': days.length } as CSSProperties}>{days.map(({ day, label, full }) => <div className="forecast-day" key={day.date}>
      <span className="forecast-day-label" aria-label={full} title={full}>{label}</span>
      {day.weatherCode === null ? <span className="forecast-unknown" aria-label="Conditions unavailable">—</span> : <WeatherGlyph code={day.weatherCode} size={null} />}
      <div className="forecast-temperatures"><TransitionText value={temperature(day.temperatureMax)} /><TransitionText className="forecast-low" value={temperature(day.temperatureMin)} /></div>
      {/* A small droplet marks the precipitation chance (#251), so it no longer repeats the condition glyph above. */}
      <span className="forecast-rain"><Icon name="droplet" size={null} /><TransitionText value={day.precipitationProbability === null ? '—' : `${day.precipitationProbability}%`} /></span>
    </div>)}</div>
  </div>;
}

export const ForecastWidget: WidgetModule = { Renderer: Forecast };
