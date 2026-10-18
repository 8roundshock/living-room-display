import { useEffect, useState, type ComponentType, type CSSProperties } from 'react';
import type { AppState, Settings, WidgetId } from '../../shared/contracts.ts';
import { WIDGET_CATALOG, widgetContentLimits, type WidgetSize } from '../../shared/widgets.ts';
import { ageLabel, forecastDay, forecastPeriod, precipitation, reminderDate, temperature, weatherTime } from '../format.ts';
import { Icon, weatherIcon } from '../icons.tsx';
import { SnapshotImage } from './SnapshotImage.tsx';
import { precipitationOutlook, reminderPresentation, sortReminders, weatherAttributionWidget } from '../model.ts';

export interface WidgetContentProps { state: AppState; settings: Settings; size: WidgetSize; now: Date; embedded: boolean; disconnected: boolean; photoPreview?: string | null }
const conditions: Record<number, string> = { 0: 'Clear skies', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms with hail', 99: 'Thunderstorms with hail' };

function Clock({ settings, now, size }: WidgetContentProps) {
  const parts = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hour12: settings.clockFormat === '12h' }).formatToParts(now);
  const clock = parts.filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim(); const period = parts.find(part => part.type === 'dayPeriod')?.value;
  return <div className={`clock-face clock-family-${size} clock-style-${settings.appearance.clockStyle}`}>
    <div className="clock-calendar"><div className="ambient-label">{new Intl.DateTimeFormat('en', { weekday: size === 'small' ? 'short' : 'long' }).format(now)}</div><div className="clock-date">{new Intl.DateTimeFormat('en', { month: size === 'small' ? 'short' : 'long', day: 'numeric' }).format(now)}</div></div>
    {settings.appearance.clockStyle === 'analog' ? <svg className="analog-clock" viewBox="0 0 100 100" role="img" aria-label={`${clock} ${period ?? ''}`}><line x1="50" y1="53" x2="50" y2="27" transform={`rotate(${(now.getHours() % 12 + now.getMinutes() / 60) * 30} 50 50)`} /><line className="analog-minute" x1="50" y1="54" x2="50" y2="12" transform={`rotate(${now.getMinutes() * 6} 50 50)`} /></svg> : <div className={`clock-time clock-${settings.appearance.clockStyle}`}><span className="clock-digits">{clock}</span>{period && <span className="clock-period">{period}</span>}</div>}
  </div>;
}
function SourceCredit({ id, settings }: { id: 'weather' | 'rain'; settings: Settings }) {
  return weatherAttributionWidget(settings) === id ? <div className="weather-credit">Forecast by Open-Meteo</div> : null;
}
function WeatherAge({ weather, disconnected, now }: { weather: AppState['weather']; disconnected: boolean; now: Date }) {
  return <div className={`weather-age ${weather.status !== 'fresh' || disconnected ? 'stale' : ''}`}>{disconnected ? 'Offline · ' : weather.status === 'stale' ? 'Saved forecast · ' : ''}{ageLabel(weather.updatedAt, now.getTime())}</div>;
}
function Weather({ state: { weather }, settings, now, size, disconnected }: WidgetContentProps) {
  const current = weather.current;
  const today = weather.daily.find(day => forecastDay(day.date, weather.location.timezone, now) === 'Today');
  return <div className="widget-body weather-body"><div className="ambient-label weather-place">{weather.location.name}<span className="weather-unit"> · {weather.units.temperature}</span></div>
    {current ? <><div className="weather-overview"><div className="current-weather-main"><span className="current-temperature">{temperature(current.temperature)}</span>{current.weatherCode !== null && <Icon name={weatherIcon(current.weatherCode, current.isDay)} className="weather-symbol" />}</div><div className="weather-summary"><div className="weather-condition">{current.weatherCode === null ? 'Conditions unavailable' : conditions[current.weatherCode] ?? 'Weather conditions'}</div>{size !== 'small' && <div className="weather-details">Feels like {temperature(current.feelsLike)}</div>}</div></div>{size === 'large' && <div className="weather-metrics"><div><span className="metric-label">Wind</span><span>{current.windSpeed === null ? 'Unavailable' : `${Math.round(current.windSpeed)} ${weather.units.windSpeed}`}</span></div><div><span className="metric-label">High / low</span><span>{today ? `${temperature(today.temperatureMax)} / ${temperature(today.temperatureMin)}` : 'Unavailable'}</span></div></div>}</> : <div className="ambient-title">Weather unavailable</div>}
    <div className="weather-footer"><WeatherAge weather={weather} disconnected={disconnected} now={now} /><SourceCredit id="weather" settings={settings} /></div></div>;
}
function Rain({ state: { weather }, now, settings, size, disconnected }: WidgetContentProps) {
  const { intervals: rain, wet, rainy, chance, rainExpected, rainDataIncomplete, incomplete, coverageComplete, hasGaps, coverageStart, coverageEnd } = precipitationOutlook(weather.hourly, weather.units.precipitation, now.getTime());
  const period = coverageStart && coverageEnd ? forecastPeriod(coverageStart, coverageEnd, weather.location.timezone, settings.clockFormat, now) : '';
  return <div className="widget-body rain-body"><div className="rain-heading"><div className="ambient-label"><Icon name="rain" />Rain & precipitation</div><div className="weather-context">{weather.location.name}</div></div>
    {rain.length ? <><div className="rain-summary"><div className="rain-chance">{chance === null ? '—' : `${chance}%`}<span>peak hourly chance</span></div><div className="rain-timing">{rainy.length ? <><span className="metric-label">Rain estimate</span>{new Date(rainy[0]!.intervalStart).getTime() <= now.getTime() ? 'Now' : weatherTime(rainy[0]!.intervalStart, weather.location.timezone, settings.clockFormat)}–{weatherTime(rainy[rainy.length - 1]!.intervalEnd, weather.location.timezone, settings.clockFormat)}</> : rainDataIncomplete ? 'Rain timing unavailable' : wet.length ? 'Precipitation possible' : incomplete ? 'Forecast incomplete' : 'Mostly dry ahead'}</div></div>{<div className="rain-amount">{rainExpected === null ? 'Rain amount unavailable' : `${rainDataIncomplete ? 'Known rain ' : ''}${precipitation(rainExpected, weather.units.precipitation)}${rainDataIncomplete ? '' : ' rain'}`}<span>{period}</span></div>}
      {size === 'large' && <><div className="rain-bars" aria-label="Hourly precipitation probabilities">{rain.map(hour => <span className={`rain-bar ${hour.precipitationProbability === null ? 'rain-bar-unknown' : ''}`} key={hour.intervalStart} style={{ height: `${hour.precipitationProbability === null ? 8 : Math.max(hour.precipitationProbability, 2)}%` }} title={`${weatherTime(hour.intervalStart, weather.location.timezone, settings.clockFormat)}: ${hour.precipitationProbability === null ? 'unknown' : `${hour.precipitationProbability}%`}`} />)}</div><div className="rain-hours"><span>{weatherTime(rain[0]!.intervalStart, weather.location.timezone, settings.clockFormat)}</span><span>{weatherTime(rain[rain.length - 1]!.intervalEnd, weather.location.timezone, settings.clockFormat)}</span></div></>}</> : <div className="ambient-title">Outlook unavailable</div>}
    <div className="rain-footer">
      {rain.length > 0 && <div className="rain-confidence">{chance === null ? 'Chance unavailable · ' : ''}{!coverageComplete ? 'Partial forecast' : incomplete || rainDataIncomplete ? 'Partial data' : 'Forecast estimate'}{hasGaps ? ' · coverage gaps' : ''}</div>}
    <WeatherAge weather={weather} disconnected={disconnected} now={now} /><SourceCredit id="rain" settings={settings} /></div></div>;
}
function Forecast({ state: { weather }, size, now, disconnected }: WidgetContentProps) {
  const count = widgetContentLimits(size).forecastDays;
  return <div className="widget-body forecast-body"><div className="forecast-heading"><div className="ambient-label">{count === 7 ? 'The week' : `Next ${count} days`}</div><div className="weather-context">{weather.location.name} · {weather.units.temperature}</div></div>{weather.daily.length ? <div className="forecast-strip" style={{ '--forecast-days': Math.min(count, weather.daily.length) } as CSSProperties}>{weather.daily.slice(0, count).map(day => <div className="forecast-day" key={day.date}><span className="forecast-day-label" aria-label={`${forecastDay(day.date, weather.location.timezone, now)}, ${day.date}`} title={`${forecastDay(day.date, weather.location.timezone, now)}, ${day.date}`}>{forecastDay(day.date, weather.location.timezone, now, true)}</span>{day.weatherCode === null ? <span className="forecast-unknown" aria-label="Conditions unavailable">—</span> : <Icon name={weatherIcon(day.weatherCode)} />}<div className="forecast-temperatures"><span>{temperature(day.temperatureMax)}</span><span className="forecast-low">{temperature(day.temperatureMin)}</span></div><span className="forecast-rain"><Icon name="rain" />{day.precipitationProbability === null ? '—' : `${day.precipitationProbability}%`}</span></div>)}</div> : <div className="ambient-title">Forecast unavailable</div>}<div className="forecast-attribution">{disconnected ? 'Offline · ' : weather.status === 'stale' ? 'Saved forecast · ' : ''}{weather.source} · {ageLabel(weather.updatedAt, now.getTime())}</div></div>;
}
function Reminders({ state, settings, now, disconnected, size }: WidgetContentProps) {
  const status = reminderPresentation(settings, state.reminders, disconnected); const all = sortReminders(state.reminders ?? []).filter(reminder => !reminder.completed); const reminders = all.slice(0, widgetContentLimits(size).reminders);
  return <div className="widget-body reminders-body"><div className="ambient-label">Up next</div>{reminders.length ? <ul className="ambient-reminder-list">{reminders.map(reminder => <li key={reminder.id}><span className="ambient-reminder-dot" /><div><p className="ambient-reminder-title">{reminder.text}</p>{reminder.dueAt && <p className="ambient-reminder-date">{reminderDate(reminder.dueAt, now)}</p>}</div></li>)}</ul> : status === 'unavailable' ? <div className="ambient-title">Reminders unavailable</div> : <div className="ambient-title">All clear</div>}{all.length > reminders.length && <div className="ambient-description">+{all.length - reminders.length} more</div>}{disconnected && reminders.length > 0 && <div className="ambient-description">Saved reminders · offline</div>}</div>;
}
function Preview({ state: { preview }, settings, embedded }: WidgetContentProps) {
  const [failed, setFailed] = useState(false); useEffect(() => setFailed(false), [preview.capturedAt]);
  return preview.available && preview.capturedAt && !failed ? <div className="widget-body snapshot-body"><div className="preview-image-shell"><SnapshotImage src={`/api/preview/image?t=${encodeURIComponent(preview.capturedAt)}`} opacity={settings.preview.opacity} onError={() => setFailed(true)} /></div><div className="preview-caption">Last screen · {new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hour12: settings.clockFormat === '12h' }).format(new Date(preview.capturedAt))}</div></div> : embedded || failed ? <div className="widget-body image-placeholder"><Icon name="monitor" /><div className="ambient-label">Last screen</div><div className="ambient-description">{failed ? 'Snapshot unavailable' : 'Captured on activation'}</div></div> : null;
}
function Photo({ state, photoPreview, embedded }: WidgetContentProps) {
  const source = photoPreview === undefined ? state.photo?.available && state.photo.id ? `/api/photo/image?id=${state.photo.id}` : null : photoPreview;
  const [failed, setFailed] = useState(false); useEffect(() => setFailed(false), [source]);
  return source && !failed ? <div className="photo-image-shell"><img className="ambient-photo-image" src={source} alt="Selected local photo" onError={() => setFailed(true)} /></div> : embedded || failed ? <div className="widget-body image-placeholder"><Icon name="photo" /><div className="ambient-label">Photo</div><div className="ambient-description">{failed ? 'Photo unavailable' : 'Choose a photo'}</div></div> : null;
}

/** Adding an id requires a renderer here; the catalog supplies the platform metadata. */
export const WIDGET_RENDERERS: Record<WidgetId, ComponentType<WidgetContentProps>> = { clock: Clock, weather: Weather, rain: Rain, forecast: Forecast, reminders: Reminders, preview: Preview, photo: Photo };
export function widgetVisible(id: WidgetId, props: WidgetContentProps): boolean {
  if (!props.settings.widgets[id]) return false;
  if (id === 'reminders') return reminderPresentation(props.settings, props.state.reminders, props.disconnected) !== 'hidden';
  if (id === 'preview') return props.settings.preview.enabled && (props.embedded || props.state.preview.available);
  if (id === 'photo') return props.embedded || Boolean(props.photoPreview === undefined ? props.state.photo?.available : props.photoPreview);
  return true;
}
export function widgetLabel(id: WidgetId): string { return WIDGET_CATALOG[id].name; }


