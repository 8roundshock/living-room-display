import { useMemo, type CSSProperties } from 'react';
import type { RainInterval } from '../../shared/contracts.ts';
import { compactWeatherTime, lastKnownTime, NBSP, temperature, todayForecast, weatherTimeZone } from '../format.ts';
import { rainChartLabel, rainOutlook, rainOutlookCopy } from '../weather-outlook.ts';
import { conditionLabel, SourceCredit, WeatherAge } from './common.tsx';
import { TransitionText } from './TransitionText.tsx';
import { WeatherGlyph } from './WeatherGlyph.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

/**
 * One adaptive Weather widget (#74). Calm shows conditions; a hint line replaces feels-like when
 * rain is later, possible or unknown; elevated (rain now or within six hours) leads with rain
 * timing. The footprint never changes. Hooks for #75/#76: data-weather-mode, data-rain-kind,
 * --weather-rain and the .rain-bar classes. Everything that formats a time is memoized per minute
 * (#99): a tick within the same minute formats nothing.
 */
function Weather({ state: { weather }, settings, now, size, disconnected }: WidgetContentProps) {
  const current = weather.current;
  // The city's zone, or this computer's while a device location is still `auto` (no forecast yet).
  const timeZone = useMemo(() => weatherTimeZone(weather.location.timezone), [weather.location.timezone]);
  const clockFormat = settings.clockFormat;
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  const variant = size === 'small' ? 'compact' : 'full';
  const today = useMemo(() => todayForecast(weather.daily, timeZone, minute), [weather.daily, timeZone, minute]);
  const { outlook, copy, chart } = useMemo(() => {
    const outlook = rainOutlook(weather, minute);
    const copy = rainOutlookCopy(outlook, timeZone, clockFormat, minute, variant);
    if (size !== 'large' || outlook.emphasis !== 'elevated') return { outlook, copy, chart: null };
    const time = (iso: string) => compactWeatherTime(iso, timeZone, clockFormat);
    return { outlook, copy, chart: {
      label: rainChartLabel(outlook, timeZone, clockFormat),
      titles: outlook.hours.map(hour => `${time(hour.start)}: ${hour.chance === null ? 'unknown' : `${hour.chance}%`}`),
      from: time(outlook.hours[0]!.start), to: time(outlook.hours.at(-1)!.end),
    } };
    // weather.hourly and units are the outlook's inputs; the whole weather object changes on every poll.
  }, [weather.hourly, weather.units, timeZone, clockFormat, minute, variant, size]);
  const lastKnown = useMemo(() => lastKnownTime(weather, disconnected, timeZone, clockFormat, minute), [weather, disconnected, timeZone, clockFormat, minute]);
  const mode = outlook.emphasis;
  const condition = conditionLabel(current?.weatherCode ?? null);
  // Retained or unavailable forecasts never animate their glyph (#76).
  const still = disconnected || weather.status !== 'fresh';
  const showConfidence = current !== null && mode !== 'calm' && copy.confidence !== '' && (size !== 'small' || copy.confidence !== 'Forecast estimate');
  const highLow = today ? <><TransitionText value={temperature(today.temperatureMax)} /> / <TransitionText value={temperature(today.temperatureMin)} /></> : 'Unavailable';
  const hidden = <span className="sr-only">{condition}</span>;
  // An hours-old saved reading is qualified next to the temperature it describes (#243): “Last known · Thu 2 AM”
  // in the status tone takes the condition's line (the still glyph and assistive text keep the condition), and
  // leads the summary where the family shows rain timing instead of the condition.
  const known = lastKnown && `Last known${NBSP}·${NBSP}${lastKnown}`;
  const conditionLine = known ? <>{hidden}<div className="weather-condition weather-last-known status-caution"><TransitionText value={known} /></div></>
    : <div className="weather-condition"><TransitionText value={condition} /></div>;
  const leading = known && <div className="weather-last-known weather-last-known-lead status-caution"><TransitionText value={known} /></div>;
  let summary;
  if (size === 'small') summary = mode === 'calm' ? conditionLine
    : <>{hidden}{leading}<div className={mode === 'elevated' ? 'rain-timing' : 'weather-hint'}><TransitionText value={copy.headline} /></div></>;
  else if (mode === 'elevated' && size === 'medium') summary = <>{hidden}{leading}<div className="weather-rain"><div className="rain-timing"><TransitionText value={copy.headline} /></div><div className="rain-detail"><TransitionText value={copy.detail} /></div></div></>;
  else {
    const second = mode === 'elevated' ? <div className="weather-details weather-high-low">{today ? <>High <TransitionText value={temperature(today.temperatureMax)} /> · Low <TransitionText value={temperature(today.temperatureMin)} /></> : 'High / low unavailable'}</div>
      : mode === 'hint' ? <div className="weather-hint"><TransitionText value={copy.headline} /></div>
        : <div className="weather-details">Feels like <TransitionText value={temperature(current?.feelsLike ?? null)} /></div>;
    summary = <>{conditionLine}{second}</>;
  }
  return <div className="widget-body weather-body" data-weather-mode={mode} data-rain-kind={outlook.kind} data-last-known={lastKnown ? '' : undefined}>
    <div className="ambient-label weather-place">{weather.location.name}<span className="weather-unit"> · {weather.units.temperature}</span></div>
    {current ? <>
      <div className="weather-overview">
        <div className="current-weather-main"><TransitionText className="current-temperature" value={temperature(current.temperature)} />{current.weatherCode !== null && <WeatherGlyph code={current.weatherCode} isDay={current.isDay} hero still={still} size={null} className="weather-symbol" />}</div>
        <div className="weather-summary">{summary}</div>
      </div>
      {size === 'large' && mode !== 'elevated' && <div className="weather-metrics"><div><span className="metric-label">Wind</span><TransitionText value={current.windSpeed === null ? 'Unavailable' : `${Math.round(current.windSpeed)} ${weather.units.windSpeed}`} /></div><div><span className="metric-label">High / low</span><span>{highLow}</span></div></div>}
      {chart && <div className="weather-rain">
        <div className="rain-timing"><TransitionText value={copy.headline} /></div>
        <div className="rain-detail"><TransitionText value={copy.detail} /></div>
        <div className="rain-bars" role="img" aria-label={chart.label}>{outlook.hours.map((hour, index) => <span
          key={hour.start}
          className={['rain-bar', hour.inSpell ? 'rain-bar-spell' : '', hour.chance === null ? 'rain-bar-unknown' : ''].filter(Boolean).join(' ')}
          style={{ height: `${hour.chance === null ? 8 : Math.max(hour.chance, 2)}%` } as CSSProperties}
          title={chart.titles[index]}
        />)}</div>
        <div className="rain-hours"><TransitionText value={chart.from} /><TransitionText value={chart.to} /></div>
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
