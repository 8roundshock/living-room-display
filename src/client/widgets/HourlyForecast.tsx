import { useMemo, type CSSProperties } from 'react';
import { sunIsUp } from '../astronomy.ts';
import { NBSP, temperature, weatherStatus, weatherTimeZone } from '../format.ts';
import { HOURLY_CHANCE_MIN, SUN_WORD, hourlyForecastSlots, hourlyForecastView } from '../hourly-forecast.ts';
import { Icon } from '../icons.tsx';
import { ForecastStatusLine, ForecastUnavailable } from './common.tsx';
import { TransitionText } from './TransitionText.tsx';
import { WeatherGlyph } from './WeatherGlyph.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './hourly-forecast.css';

/**
 * Hourly forecast (#714; the stored id stays `hourlyTemperature`): Forecast's strip with one column per
 * hour, so the two sit one above the other. An hour has its time, a day- or night-aware glyph, the
 * temperature riding a thin trend line, and the precipitation chance only from 10%. The first column
 * reads “Now” and shows the current reading, as Weather does. A sunrise or sunset is a column of its own
 * between the hours it falls between: its exact time, a sun symbol and the word, with no temperature or
 * chance. The strip always has the family's number of columns, so nothing reflows when a sun column
 * enters or leaves. The heading's right side holds at most two calm facts (the next sunrise or sunset
 * when the strip does not show it, and notable gusts) or, while the forecast is not fresh, the status,
 * which is Forecast's own (ForecastStatusLine, from the shared `weatherStatus`): the two strips stacked
 * one above the other say the same thing, also while a refresh is merely slow. No place, provider or
 * update time is shown for fresh data (#715). The slot is always there, a no-break space when empty, so
 * the heading has Forecast's height in every state. The view is recomputed once a minute (#99), not on
 * the one-second tick.
 */
function HourlyForecast({ state: { weather }, settings: { clockFormat }, size, now, disconnected }: WidgetContentProps) {
  const slots = hourlyForecastSlots(size);
  // The city's zone, or this computer's while a device location is still `auto` (no forecast yet).
  const timeZone = useMemo(() => weatherTimeZone(weather.location.timezone), [weather.location.timezone]);
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  const view = useMemo(() => hourlyForecastView(weather, { now: minute, slots, clockFormat, timeZone, disconnected }), [weather, minute, slots, clockFormat, timeZone, disconnected]);
  const status = weatherStatus(weather, disconnected, now.getTime());
  if (!view.columns.length) {
    // Unavailable, as Forecast shows it (#362).
    return <div className="widget-body forecast-body hourly-body" data-hourly-unavailable="">
      <div className="forecast-heading hourly-heading"><div className="ambient-label">Hourly</div><div className="weather-context hourly-facts">{NBSP}</div></div>
      <ForecastUnavailable what="Hourly forecast" weather={weather} disconnected={disconnected} now={now} />
    </div>;
  }
  return <div className="widget-body forecast-body hourly-body">
    <div className="forecast-heading hourly-heading">
      <div className="ambient-label">Hourly</div>
      {status
        ? <ForecastStatusLine status={status} />
        : <div className="weather-context hourly-facts">{view.facts.length ? view.facts.map((fact, index) => <span className="hourly-fact" key={index}>{index > 0 && ' · '}<TransitionText value={fact} /></span>) : NBSP}</div>}
    </div>
    <div className="forecast-strip hourly-strip" style={{ '--forecast-days': view.columns.length } as CSSProperties}>
      {/* Keyed by position: when the hour turns, each column's values change in place (TransitionText) instead of the columns moving. */}
      {view.columns.map((column, index) => column.kind === 'hour'
        ? <div className="forecast-day hourly-hour" key={index} data-hourly-column={column.now ? 'now' : 'hour'}>
          <span className="forecast-day-label"><TransitionText value={column.label} /></span>
          {column.weatherCode === null ? <span className="forecast-unknown" aria-label="Conditions unavailable">—</span> : <WeatherGlyph code={column.weatherCode} isDay={column.isDay} size={null} />}
          {/* The value sits just above its point on the trend; an unknown value is a dash at mid height, where no line passes. */}
          <div className="forecast-temperatures hourly-temperature" style={{ '--hourly-level': column.level ?? 0.5 } as CSSProperties}><TransitionText value={temperature(column.temperature)} /></div>
          {/* The droplet and chance show only from 10%, so a dry stretch stays clean; the row keeps its height. Unknown is a dash, never a dry hour. */}
          <span className="forecast-rain hourly-rain">{column.chance === null
            ? <span className="hourly-unknown" aria-label="Chance of precipitation unavailable">—</span>
            : column.chance >= HOURLY_CHANCE_MIN && <><Icon name="droplet" size={null} /><TransitionText value={`${column.chance}%`} /></>}</span>
        </div>
        // A sunrise or sunset: its exact time, the sun symbol (the sun's own sub-tone) and the word where the trend passes.
        : <div className="forecast-day hourly-hour hourly-sun" key={index} data-hourly-column={column.kind}>
          <span className="forecast-day-label"><TransitionText value={column.label} /></span>
          <Icon name={column.kind} size={null} className="hourly-sun-glyph" data-glyph="sun" />
          <div className="hourly-temperature hourly-sun-word" style={{ '--hourly-level': column.level ?? 0.5 } as CSSProperties}><TransitionText value={SUN_WORD[column.kind]} /></div>
          <span className="forecast-rain hourly-rain" />
        </div>)}
      {/* Decorative: the values above already say what the line shows. One path per unbroken run of known temperatures. */}
      {view.trend.length > 0 && <svg className="hourly-trend" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">{view.trend.map((path, index) => <path key={index} d={path} />)}</svg>}
    </div>
  </div>;
}

const HOUR = 3_600_000;
/** Synthetic hours for the picker: a mild spell clouding over, with showers later. Only the clock (and so the sun) is real. */
const SAMPLE_HOURS: readonly { code: number; temperature: number; chance: number }[] = [
  { code: 1, temperature: 14.2, chance: 0 }, { code: 1, temperature: 15.1, chance: 0 }, { code: 0, temperature: 15.8, chance: 0 }, { code: 0, temperature: 16.1, chance: 0 },
  { code: 2, temperature: 15.4, chance: 5 }, { code: 2, temperature: 14.3, chance: 10 }, { code: 3, temperature: 13.1, chance: 20 }, { code: 3, temperature: 12.2, chance: 35 },
  { code: 61, temperature: 11.4, chance: 60 }, { code: 61, temperature: 10.9, chance: 70 }, { code: 80, temperature: 10.3, chance: 45 }, { code: 3, temperature: 9.8, chance: 20 },
  { code: 2, temperature: 9.4, chance: 10 }, { code: 2, temperature: 9.1, chance: 5 },
];
const sample: NonNullable<WidgetModule['sample']> = ({ state, settings }) => {
  const anchor = Date.parse(state.weather.updatedAt ?? '') || Date.now(), hour = Math.floor(anchor / HOUR) * HOUR;
  const at = (index: number) => new Date(hour + index * HOUR).toISOString();
  const { latitude, longitude } = state.weather.location;
  return {
    settings,
    state: {
      ...state,
      weather: {
        ...state.weather,
        current: state.weather.current && { ...state.weather.current, temperature: SAMPLE_HOURS[0]!.temperature, weatherCode: SAMPLE_HOURS[0]!.code, isDay: sunIsUp(new Date(anchor), latitude, longitude) },
        hourly: SAMPLE_HOURS.map((item, index) => ({ intervalStart: at(index), intervalEnd: at(index + 1), precipitationProbability: item.chance, precipitationAmount: item.chance >= 45 ? 0.6 : 0, rainAmount: item.chance >= 45 ? 0.6 : 0 })),
        details: SAMPLE_HOURS.map((item, index) => ({
          time: at(index), weatherCode: item.code, temperature: item.temperature, humidity: 62, dewPoint: 8, pressure: 1012, visibility: 18_000,
          cloudCover: 40, windSpeed: 12, windDirection: 225, windGust: 24,
        })),
      },
    },
  };
};

export const HourlyForecastWidget: WidgetModule = {
  Renderer: HourlyForecast,
  sample,
  Settings: () => (
    <p className="hint">
      One column per hour in the weather city’s time: conditions, temperature and the chance of rain or snow
      when it is 10% or more. The line follows the temperature. A sunrise or sunset gets its own column at
      its exact time. Medium has 6 columns and large 12. Hourly estimates by Open-Meteo; sun times are
      calculated on this computer.
    </p>
  ),
};
