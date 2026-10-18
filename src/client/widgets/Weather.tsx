import { forecastDay, temperature } from '../format.ts';
import { conditions, SourceCredit, WeatherAge } from './common.tsx';
import { WeatherGlyph } from './WeatherGlyph.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

function Weather({ state: { weather }, settings, now, size, disconnected }: WidgetContentProps) {
  const current = weather.current;
  const today = weather.daily.find(day => forecastDay(day.date, weather.location.timezone, now) === 'Today');
  return <div className="widget-body weather-body"><div className="ambient-label weather-place">{weather.location.name}<span className="weather-unit"> · {weather.units.temperature}</span></div>
    {current ? <><div className="weather-overview"><div className="current-weather-main"><span className="current-temperature">{temperature(current.temperature)}</span>{current.weatherCode !== null && <WeatherGlyph code={current.weatherCode} isDay={current.isDay} hero className="weather-symbol" />}</div><div className="weather-summary"><div className="weather-condition">{current.weatherCode === null ? 'Conditions unavailable' : conditions[current.weatherCode] ?? 'Weather conditions'}</div>{size !== 'small' && <div className="weather-details">Feels like {temperature(current.feelsLike)}</div>}</div></div>{size === 'large' && <div className="weather-metrics"><div><span className="metric-label">Wind</span><span>{current.windSpeed === null ? 'Unavailable' : `${Math.round(current.windSpeed)} ${weather.units.windSpeed}`}</span></div><div><span className="metric-label">High / low</span><span>{today ? `${temperature(today.temperatureMax)} / ${temperature(today.temperatureMin)}` : 'Unavailable'}</span></div></div>}</> : <div className="ambient-title">Weather unavailable</div>}
    <div className="weather-footer"><WeatherAge weather={weather} disconnected={disconnected} now={now} /><SourceCredit id="weather" settings={settings} /></div></div>;
}

export const WeatherWidget: WidgetModule = { Renderer: Weather };
