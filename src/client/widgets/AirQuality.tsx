import { useMemo, type CSSProperties } from 'react';
import type { AirPollutant, AirQualityReading, AirQualityState, AppState } from '../../shared/contracts.ts';
import { airAgeIsStatus, airAgeSegments, airHourly, airReadingView } from '../airHourly.ts';
import { ageLabel, weatherTimeZone } from '../format.ts';
import { Icon } from '../icons.tsx';
import { SCALE_LABELS, aqiCategory, uvCategory } from '../air-categories.ts';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule, WidgetSettingsProps } from './types.ts';
import './air-quality.css';

type Scale = AirQualityState['scale'];
export { SCALE_LABELS, aqiCategory, uvCategory } from '../air-categories.ts';
const POLLUTANTS: Record<AirPollutant, string> = { pm2_5: 'PM2.5', pm10: 'PM10', ozone: 'ozone', nitrogen_dioxide: 'nitrogen dioxide', sulphur_dioxide: 'sulphur dioxide', carbon_monoxide: 'carbon monoxide' };

function airState(state: AppState): AirQualityState {
  return state.airQuality ?? { status: 'off', updatedAt: null, error: null, source: 'CAMS via Open-Meteo', sourceUrl: 'https://open-meteo.com/en/docs/air-quality-api',
    location: state.weather.location, scale: state.settings.widgetData.airQuality.scale, current: null, hourly: [] };
}
function pollutantLine(current: NonNullable<AirQualityState['current']>): string[] | null {
  if (!current.dominant) return null;
  const concentration = current.dominant === 'pm2_5' ? current.pm2_5 : current.dominant === 'pm10' ? current.pm10 : null;
  return [`Mostly ${POLLUTANTS[current.dominant]}`, ...(concentration === null ? [] : [`${Math.round(concentration)} µg/m³`])];
}
const NO_HOURS: AirQualityReading[] = [];

/** Phrases joined by " · " that wrap only between phrases, so "12 min ago" and "12 µg/m³" stay whole (#221). */
function Phrases({ parts }: { parts: string[] }) {
  return <>{parts.map((part, index) => <span key={index}>{index > 0 && ' · '}<span className="air-phrase">{part}</span></span>)}</>;
}

function AirQuality({ state, settings, size, now, disconnected }: WidgetContentProps) {
  const air = airState(state);
  const zone = air.location.timezone;
  // The place's zone, or this computer's while it is still `auto`; memoized, since the fallback builds a formatter.
  const timeZone = useMemo(() => weatherTimeZone(zone), [zone]);
  const current = air.status === 'fresh' || air.status === 'stale' ? air.current : null;
  // Everything that needs a clock or a formatter is rebuilt once per minute (#185): whether the saved
  // values are still current (#188), and the large family's bars, hour labels and UV peak, which use
  // upcoming hours only (a saved reading keeps its old series).
  const minute = Math.floor(now.getTime() / 60_000);
  const view = useMemo(() => current ? airReadingView({ updatedAt: air.updatedAt, hourly: air.hourly }, current, minute * 60_000, timeZone, settings.clockFormat) : null,
    [current, air.updatedAt, air.hourly, minute, timeZone, settings.clockFormat]);
  const series = size === 'large' && current ? air.hourly : NO_HOURS;
  const hourly = useMemo(() => series.length ? airHourly(series, minute * 60_000, air.scale, SCALE_LABELS[air.scale], timeZone, settings.clockFormat) : null,
    [series, minute, air.scale, timeZone, settings.clockFormat]);
  const category = view ? aqiCategory(view.aqi, air.scale, size === 'small') : null;
  // One footer row (#221, #715): a fresh reading says only "Model est."; the age follows a status label only
  // (saved, offline, or values over 3 hours old), in the status tone. No provider name: that is in the settings hint.
  const old = Boolean(view && view.kind !== 'current');
  const age = airAgeSegments({ age: ageLabel(air.updatedAt, now.getTime()), status: air.status, reading: Boolean(current), disconnected, old });
  const caution = airAgeIsStatus({ status: air.status, disconnected, old });
  const pollutant = current && view?.showPollutant ? pollutantLine(current) : null;
  const uv = view?.showUv ? view.uvIndex === null ? ['UV unavailable'] : [`UV ${Math.round(view.uvIndex)}`, uvCategory(view.uvIndex)] : null;
  return <div className="widget-body air-body">
    <div className="ambient-label"><Icon name="air" size={null} />Air quality</div>
    <div className="weather-context air-context">{air.location.name} · <span className="air-scale">{SCALE_LABELS[air.scale]}</span></div>
    {air.status === 'off' ? <div className="air-message">Air quality not loaded yet</div>
      : !current || !view ? <div className="ambient-title air-message">Air quality unavailable</div>
      : <>
        <div className="air-reading" data-air-reading={view.kind}>
          <TransitionText className="air-aqi" value={view.aqi === null ? '—' : String(Math.round(view.aqi))} />
          {/* The qualifier is the shared status cue: .status-caution at full opacity (#322, #329). */}
          <div className="air-words"><TransitionText className="air-category" value={category ?? 'AQI unavailable'} />{view.qualifier && <div className="air-qualifier status-caution"><Phrases parts={view.qualifier.split(' · ')} /></div>}</div>
        </div>
        {size !== 'small' && (pollutant || uv) && <div className="air-details">
          {pollutant && <div><Phrases parts={pollutant} /></div>}
          {uv && <div><Phrases parts={uv} /></div>}
        </div>}
        {size === 'large' && (hourly ? <>
          <div className="air-bars" role="img" aria-label={hourly.summary}>{hourly.bars.map(bar => <span key={bar.time}
            className={`air-bar ${bar.unknown ? 'air-bar-unknown' : ''}`} style={{ '--air-bar': bar.height } as CSSProperties} title={bar.title} />)}</div>
          <div className="air-hours"><span>{hourly.start}</span><span>{hourly.end}</span></div>
          <div className="air-uv-peak">{hourly.uvPeak}</div>
        </> : <div className="air-hourly-missing">Hourly estimate unavailable</div>)}
      </>}
    {age.length > 0 && <div className="air-footer"><div className={caution ? 'weather-age air-age stale status-caution' : 'weather-age air-age'}><Phrases parts={age} /></div></div>}
  </div>;
}

function AirQualitySettings({ settings, onChange, saving }: WidgetSettingsProps) {
  return <>
    <label>
      <span className="field-label">Scale</span>
      <select className="select-input" aria-label="Air quality scale" value={settings.widgetData.airQuality.scale} disabled={saving}
        onChange={event => { const scale = event.target.value as Scale; onChange(previous => ({ ...previous, widgetData: { ...previous.widgetData, airQuality: { ...previous.widgetData.airQuality, scale } } })); }}>
        <option value="us">US AQI</option>
        <option value="european">European AQI</option>
      </select>
    </label>
    <p className="hint">Model estimate from Copernicus CAMS via Open-Meteo for your weather location. Canada's AQHI and local sensors are not available.</p>
  </>;
}

export const AirQualityWidget: WidgetModule = {
  Renderer: AirQuality,
  Settings: AirQualitySettings,
  // Synthetic, plausible model values for the picker; never a real reading.
  sample: ({ state, settings }) => {
    const anchor = Date.parse(state.weather.updatedAt ?? '2026-10-18T13:41:00Z'), hour = anchor - anchor % 3600_000;
    const aqi = [42, 41, 40, 38, 36, 35, 33, 30, 28, 27, 27, 29, 32, 36, 40, 44, 47, 49, 48, 46, 44, 43, 42, 41];
    const uv = [3, 4, 5, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3];
    const airQuality: AirQualityState = {
      status: 'fresh', updatedAt: new Date(anchor - 12 * 60_000).toISOString(), error: null, source: 'CAMS via Open-Meteo', sourceUrl: 'https://open-meteo.com/en/docs/air-quality-api',
      location: { ...state.weather.location }, scale: 'us',
      current: { time: new Date(hour).toISOString(), aqi: 42, dominant: 'pm2_5', pm2_5: 10, pm10: 16, uvIndex: 3 },
      hourly: aqi.map((value, index) => ({ time: new Date(hour + index * 3600_000).toISOString(), aqi: value, uvIndex: uv[index]! })),
    };
    const next = { ...settings, widgetData: { ...settings.widgetData, airQuality: { scale: 'us' as const } } };
    return { state: { ...state, settings: next, airQuality }, settings: next };
  },
};
