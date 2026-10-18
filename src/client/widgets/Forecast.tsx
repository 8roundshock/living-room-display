import type { CSSProperties } from 'react';
import { widgetContentLimits } from '../../shared/widgets.ts';
import { ageLabel, forecastDay, temperature } from '../format.ts';
import { Icon } from '../icons.tsx';
import { TransitionText } from './TransitionText.tsx';
import { WeatherGlyph } from './WeatherGlyph.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

function Forecast({ state: { weather }, size, now, disconnected }: WidgetContentProps) {
  const count = widgetContentLimits(size).forecastDays;
  return <div className="widget-body forecast-body"><div className="forecast-heading"><div className="ambient-label">{count === 7 ? 'The week' : `Next ${count} days`}</div><div className="weather-context">{weather.location.name} · {weather.units.temperature}</div></div>{weather.daily.length ? <div className="forecast-strip" style={{ '--forecast-days': Math.min(count, weather.daily.length) } as CSSProperties}>{weather.daily.slice(0, count).map(day => <div className="forecast-day" key={day.date}><span className="forecast-day-label" aria-label={`${forecastDay(day.date, weather.location.timezone, now)}, ${day.date}`} title={`${forecastDay(day.date, weather.location.timezone, now)}, ${day.date}`}>{forecastDay(day.date, weather.location.timezone, now, true)}</span>{day.weatherCode === null ? <span className="forecast-unknown" aria-label="Conditions unavailable">—</span> : <WeatherGlyph code={day.weatherCode} />}<div className="forecast-temperatures"><TransitionText value={temperature(day.temperatureMax)} /><TransitionText className="forecast-low" value={temperature(day.temperatureMin)} /></div><span className="forecast-rain"><Icon name="rain" /><TransitionText value={day.precipitationProbability === null ? '—' : `${day.precipitationProbability}%`} /></span></div>)}</div> : <div className="ambient-title">Forecast unavailable</div>}<div className="forecast-attribution">{disconnected ? 'Offline · ' : weather.status === 'stale' ? 'Saved forecast · ' : ''}{weather.source} · {ageLabel(weather.updatedAt, now.getTime())}</div></div>;
}

export const ForecastWidget: WidgetModule = { Renderer: Forecast };
