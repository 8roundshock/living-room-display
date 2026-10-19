import type { CSSProperties } from 'react';
import type { RainInterval } from '../../shared/contracts.ts';
import { compactWeatherTime, forecastDay, temperature } from '../format.ts';
import { rainOutlook, rainOutlookCopy } from '../weather-outlook.ts';
import { conditionLabel, SourceCredit, WeatherAge } from './common.tsx';
import { TransitionText } from './TransitionText.tsx';
import { WeatherGlyph } from './WeatherGlyph.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

/**
 * One adaptive Weather widget (#74). Calm shows conditions; a hint line replaces feels-like when
 * rain is later, possible or unknown; elevated (rain now or within six hours) leads with rain
 * timing. The footprint never changes. Hooks for #75/#76: data-weather-mode, data-rain-kind,
 * --weather-rain and the .rain-bar classes.
 */
function Weather({ state: { weather }, settings, now, size, disconnected }: WidgetContentProps) {
  const current = weather.current;
  const timeZone = weather.location.timezone;
  const today = weather.daily.find(day => forecastDay(day.date, timeZone, now) === 'Today');
  const outlook = rainOutlook(weather, now);
  const mode = outlook.emphasis;
  const copy = rainOutlookCopy(outlook, timeZone, settings.clockFormat, now, size === 'small' ? 'compact' : 'full');
  const condition = conditionLabel(current?.weatherCode ?? null);
  // Retained or unavailable forecasts never animate their glyph (#76).
  const still = disconnected || weather.status !== 'fresh';
  const showConfidence = current !== null && mode !== 'calm' && copy.confidence !== '' && (size !== 'small' || copy.confidence !== 'Forecast estimate');
  const highLow = today ? <><TransitionText value={temperature(today.temperatureMax)} /> / <TransitionText value={temperature(today.temperatureMin)} /></> : 'Unavailable';
  const hidden = <span className="sr-only">{condition}</span>;
  let summary;
  if (size === 'small') summary = mode === 'calm' ? <div className="weather-condition"><TransitionText value={condition} /></div>
    : <>{hidden}<div className={mode === 'elevated' ? 'rain-timing' : 'weather-hint'}>{copy.headline}</div></>;
  else if (mode === 'elevated' && size === 'medium') summary = <>{hidden}<div className="weather-rain"><div className="rain-timing">{copy.headline}</div><div className="rain-detail">{copy.detail}</div></div></>;
  else {
    const second = mode === 'elevated' ? <div className="weather-details weather-high-low">{today ? <>High <TransitionText value={temperature(today.temperatureMax)} /> · Low <TransitionText value={temperature(today.temperatureMin)} /></> : 'High / low unavailable'}</div>
      : mode === 'hint' ? <div className="weather-hint">{copy.headline}</div>
        : <div className="weather-details">Feels like <TransitionText value={temperature(current?.feelsLike ?? null)} /></div>;
    summary = <><div className="weather-condition"><TransitionText value={condition} /></div>{second}</>;
  }
  return <div className="widget-body weather-body" data-weather-mode={mode} data-rain-kind={outlook.kind}>
    <div className="ambient-label weather-place">{weather.location.name}<span className="weather-unit"> · {weather.units.temperature}</span></div>
    {current ? <>
      <div className="weather-overview">
        <div className="current-weather-main"><TransitionText className="current-temperature" value={temperature(current.temperature)} />{current.weatherCode !== null && <WeatherGlyph code={current.weatherCode} isDay={current.isDay} hero still={still} size={null} className="weather-symbol" />}</div>
        <div className="weather-summary">{summary}</div>
      </div>
      {size === 'large' && mode !== 'elevated' && <div className="weather-metrics"><div><span className="metric-label">Wind</span><TransitionText value={current.windSpeed === null ? 'Unavailable' : `${Math.round(current.windSpeed)} ${weather.units.windSpeed}`} /></div><div><span className="metric-label">High / low</span><span>{highLow}</span></div></div>}
      {size === 'large' && mode === 'elevated' && <div className="weather-rain">
        <div className="rain-timing">{copy.headline}</div>
        <div className="rain-detail">{copy.detail}</div>
        <div className="rain-bars" role="img" aria-label="Hourly precipitation chance">{outlook.hours.map(hour => <span
          key={hour.start}
          className={['rain-bar', hour.inSpell ? 'rain-bar-spell' : '', hour.chance === null ? 'rain-bar-unknown' : ''].filter(Boolean).join(' ')}
          style={{ height: `${hour.chance === null ? 8 : Math.max(hour.chance, 2)}%` } as CSSProperties}
          title={`${compactWeatherTime(hour.start, timeZone, settings.clockFormat)}: ${hour.chance === null ? 'unknown' : `${hour.chance}%`}`}
        />)}</div>
        <div className="rain-hours"><span>{compactWeatherTime(outlook.hours[0]!.start, timeZone, settings.clockFormat)}</span><span>{compactWeatherTime(outlook.hours.at(-1)!.end, timeZone, settings.clockFormat)}</span></div>
      </div>}
    </> : <div className="ambient-title">Weather unavailable</div>}
    <div className="weather-footer">{showConfidence && <div className="rain-confidence">{copy.confidence}</div>}<WeatherAge weather={weather} disconnected={disconnected} now={now} /><SourceCredit id="weather" settings={settings} /></div>
  </div>;
}

function WeatherSettings() {
  return <p className="hint">Rain timing appears automatically when rain is near. It's a forecast estimate.</p>;
}

const HOUR = 3_600_000;
/** Hour-aligned synthetic rain starting within two hours, so the picker shows the elevated family. */
const SAMPLE_CHANCE = [10, 15, 40, 65, 70, 50, 25, 10, 5, 5, 0, 0, 0];
const SAMPLE_RAIN = [0, 0, 0.6, 1.4, 1.2, 0.4, 0, 0, 0, 0, 0, 0, 0];

export const WeatherWidget: WidgetModule = {
  Renderer: Weather,
  Settings: WeatherSettings,
  sample: ({ state, settings }) => {
    const reference = Date.parse(state.weather.updatedAt ?? '');
    if (!Number.isFinite(reference)) return { state, settings };
    const start = Math.floor(reference / HOUR) * HOUR;
    const hourly: RainInterval[] = SAMPLE_CHANCE.map((chance, index) => ({
      intervalStart: new Date(start + index * HOUR).toISOString(), intervalEnd: new Date(start + (index + 1) * HOUR).toISOString(),
      precipitationProbability: chance, precipitationAmount: SAMPLE_RAIN[index]!, rainAmount: SAMPLE_RAIN[index]!,
    }));
    return { state: { ...state, weather: { ...state.weather, hourly } }, settings };
  },
};
