import type { CSSProperties } from 'react';
import type { AirPollutant, AirQualityState, AppState, Settings } from '../../shared/contracts.ts';
import { civilDateKey, formatTime, isValidTimeZone, localTimeZone, zoneFormatter } from '../astronomy.ts';
import { ageLabel } from '../format.ts';
import { Icon } from '../icons.tsx';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule, WidgetSettingsProps } from './types.ts';
import './air-quality.css';

type Scale = AirQualityState['scale'];
export const SCALE_LABELS: Record<Scale, string> = { us: 'US AQI', european: 'European AQI' };
export const AIR_CREDIT = 'Air quality: CAMS via Open-Meteo';
// Words carry the level; there are deliberately no per-category colours.
const CATEGORIES: Record<Scale, [number, string, string?][]> = {
  us: [[50, 'Good'], [100, 'Moderate'], [150, 'Unhealthy for sensitive groups', 'Sensitive groups'], [200, 'Unhealthy'], [300, 'Very unhealthy'], [Infinity, 'Hazardous']],
  european: [[20, 'Good'], [40, 'Fair'], [60, 'Moderate'], [80, 'Poor'], [100, 'Very poor'], [Infinity, 'Extremely poor']],
};
export function aqiCategory(aqi: number | null, scale: Scale, compact = false): string | null {
  if (aqi === null) return null;
  const [, name, short] = CATEGORIES[scale].find(([limit]) => Math.round(aqi) <= limit)!;
  return compact && short ? short : name;
}
/** WHO UV index categories. */
export function uvCategory(uv: number): string {
  const value = Math.round(uv);
  return value <= 2 ? 'Low' : value <= 5 ? 'Moderate' : value <= 7 ? 'High' : value <= 10 ? 'Very high' : 'Extreme';
}
const POLLUTANTS: Record<AirPollutant, string> = { pm2_5: 'PM2.5', pm10: 'PM10', ozone: 'ozone', nitrogen_dioxide: 'nitrogen dioxide', sulphur_dioxide: 'sulphur dioxide', carbon_monoxide: 'carbon monoxide' };

function airState(state: AppState): AirQualityState {
  return state.airQuality ?? { status: 'off', updatedAt: null, error: null, source: 'CAMS via Open-Meteo', sourceUrl: 'https://open-meteo.com/en/docs/air-quality-api',
    location: state.weather.location, scale: state.settings.widgetData.airQuality.scale, current: null, hourly: [] };
}
function pollutantLine(current: NonNullable<AirQualityState['current']>): string | null {
  if (!current.dominant) return null;
  const concentration = current.dominant === 'pm2_5' ? current.pm2_5 : current.dominant === 'pm10' ? current.pm10 : null;
  return `Mostly ${POLLUTANTS[current.dominant]}${concentration === null ? '' : ` · ${Math.round(concentration)} µg/m³`}`;
}
function uvPeak(air: AirQualityState, timeZone: string, now: Date, clockFormat: Settings['clockFormat']): string {
  const known = air.hourly.filter(reading => reading.uvIndex !== null);
  if (!known.length) return 'UV forecast unavailable';
  const today = civilDateKey(now, timeZone);
  const hour = (iso: string) => zoneFormatter(timeZone, clockFormat === '12h' ? { hour: 'numeric', hour12: true } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  for (const tomorrow of [false, true]) {
    const day = known.filter(reading => (civilDateKey(new Date(reading.time), timeZone) === today) !== tomorrow);
    const peak = day.reduce<typeof day[number] | null>((best, reading) => !best || reading.uvIndex! > best.uvIndex! ? reading : best, null);
    if (peak && Math.round(peak.uvIndex!) >= 1) return `UV peaks ${Math.round(peak.uvIndex!)}${tomorrow ? ' tomorrow' : ''} at ${hour(peak.time)}`;
  }
  return 'UV low for the next 24 h';
}

function AirQuality({ state, settings, size, now, disconnected }: WidgetContentProps) {
  const air = airState(state);
  const timeZone = isValidTimeZone(air.location.timezone) ? air.location.timezone : localTimeZone();
  const current = air.status === 'fresh' || air.status === 'stale' ? air.current : null;
  const category = current ? aqiCategory(current.aqi, air.scale, size === 'small') : null;
  const caution = disconnected || air.status === 'stale' || air.status === 'unavailable';
  const age = `${disconnected ? 'Offline · ' : ''}${air.status === 'stale' ? 'Saved reading' : 'Model estimate'} · ${ageLabel(air.updatedAt, now.getTime())}`;
  // Bars are relative to the top of the "Moderate" band, or to the highest hour when worse.
  const top = Math.max(air.scale === 'us' ? 100 : 60, ...air.hourly.map(reading => reading.aqi ?? 0));
  return <div className="widget-body air-body">
    <div className="ambient-label"><Icon name="air" size={null} />Air quality</div>
    <div className="weather-context air-context">{air.location.name} · <span className="air-scale">{SCALE_LABELS[air.scale]}</span></div>
    {air.status === 'off' ? <div className="air-message">Air quality not loaded yet</div>
      : !current ? <div className="ambient-title air-message">Air quality unavailable</div>
      : <>
        <div className="air-reading"><TransitionText className="air-aqi" value={current.aqi === null ? '—' : String(Math.round(current.aqi))} /><span className="air-category">{category ?? 'AQI unavailable'}</span></div>
        {size !== 'small' && <div className="air-details">
          {pollutantLine(current) && <div>{pollutantLine(current)}</div>}
          <div>{current.uvIndex === null ? 'UV unavailable' : `UV ${Math.round(current.uvIndex)} · ${uvCategory(current.uvIndex)}`}</div>
        </div>}
        {size === 'large' && air.hourly.length > 0 && <>
          <div className="air-bars" aria-label={`Next ${air.hourly.length} hours of ${SCALE_LABELS[air.scale]}`}>{air.hourly.map(reading => <span key={reading.time}
            className={`air-bar ${reading.aqi === null ? 'air-bar-unknown' : ''}`}
            style={{ '--air-bar': reading.aqi === null ? '8%' : `${Math.max(3, Math.min(100, reading.aqi / top * 100))}%` } as CSSProperties}
            title={`${formatTime(new Date(reading.time), timeZone, settings.clockFormat)}: ${reading.aqi === null ? 'unknown' : Math.round(reading.aqi)}`} />)}</div>
          <div className="air-hours"><span>{formatTime(new Date(air.hourly[0]!.time), timeZone, settings.clockFormat)}</span><span>{formatTime(new Date(air.hourly[air.hourly.length - 1]!.time), timeZone, settings.clockFormat)}</span></div>
          <div className="air-uv-peak">{uvPeak(air, timeZone, now, settings.clockFormat)}</div>
        </>}
      </>}
    <div className="air-footer"><div className={`weather-age air-age ${caution ? 'stale' : ''}`}>{age}</div><div className="weather-credit air-credit">{AIR_CREDIT}</div></div>
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
