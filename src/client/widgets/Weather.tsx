import { forecastDay, temperature } from '../format.ts';
import { conditions, SourceCredit, WeatherAge } from './common.tsx';
import { TransitionText } from './TransitionText.tsx';
import { WeatherGlyph } from './WeatherGlyph.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

function Weather({ state: { weather }, settings, now, size, disconnected }: WidgetContentProps) {
  const current = weather.current;
  const today = weather.daily.find(day => forecastDay(day.date, weather.location.timezone, now) === 'Today');
  // Stale, saved or offline conditions keep the glyph still (#76).
  const still = weather.status !== 'fresh' || disconnected;
  return <div className="widget-body weather-body"><div className="ambient-label weather-place">{weather.location.name}<span className="weather-unit"> · {weather.units.temperature}</span></div>
    {current ? <><div className="weather-overview"><div className="current-weather-main"><TransitionText className="current-temperature" value={temperature(current.temperature)} />{current.weatherCode !== null && <WeatherGlyph code={current.weatherCode} isDay={current.isDay} hero still={still} className="weather-symbol" />}</div><div className="weather-summary"><div className="weather-condition"><TransitionText value={current.weatherCode === null ? 'Conditions unavailable' : conditions[current.weatherCode] ?? 'Weather conditions'} /></div>{size !== 'small' && <div className="weather-details"><TransitionText value={`Feels like ${temperature(current.feelsLike)}`} /></div>}</div></div>{size === 'large' && <div className="weather-metrics"><div><span className="metric-label">Wind</span><TransitionText value={current.windSpeed === null ? 'Unavailable' : `${Math.round(current.windSpeed)} ${weather.units.windSpeed}`} /></div><div><span className="metric-label">High / low</span><TransitionText value={today ? `${temperature(today.temperatureMax)} / ${temperature(today.temperatureMin)}` : 'Unavailable'} /></div></div>}</> : <div className="ambient-title">Weather unavailable</div>}
    <div className="weather-footer"><WeatherAge weather={weather} disconnected={disconnected} now={now} /><SourceCredit id="weather" settings={settings} /></div></div>;
}

export const WeatherWidget: WidgetModule = { Renderer: Weather };
