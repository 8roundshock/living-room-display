import { Fragment, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { AppState, RainInterval } from '../../shared/contracts.ts';
import { ageLabel, chartAxisLabels, compactWeatherTime, lastKnownTime, NBSP, temperature, todayForecast, weatherTimeZone } from '../format.ts';
import { weatherAttributionWidget } from '../model.ts';
import { rainChartLabel, rainOutlook, rainOutlookCopy } from '../weather-outlook.ts';
import { conditionLabel, SourceCredit, WeatherAge } from './common.tsx';
import { TransitionText } from './TransitionText.tsx';
import { WeatherGlyph } from './WeatherGlyph.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

/**
 * The small family's footer (#283): one row of short phrases that wraps only between them, like Air
 * quality's (“Partial forecast · Saved forecast · 5 hr ago · Open-Meteo”). The status words keep the
 * age in the status tone; “Updated” goes only after “Saved forecast” (as Air quality's “Saved
 * reading · 2 hr ago”), never after “Offline”, where a bare age could read as the outage's. The
 * credit is the short “Open-Meteo” that Forecast's footer uses. Medium and large keep the full lines.
 */
function CompactFooter({ weather, disconnected, now, confidence, credit }: { weather: AppState['weather']; disconnected: boolean; now: Date; confidence: string | null; credit: boolean }) {
  const age = ageLabel(weather.updatedAt, now.getTime());
  const status = disconnected ? 'Offline' : weather.status === 'stale' ? 'Saved forecast' : null;
  const phrase = (text: string) => <span className="weather-phrase">{text}</span>;
  const parts: ReactNode[] = [
    ...(confidence ? [<span className="rain-confidence">{confidence.split(' · ').map((text, index) => <Fragment key={index}>{index > 0 && `${NBSP}· `}{phrase(text)}</Fragment>)}</span>] : []),
    <span className={`weather-age ${weather.status !== 'fresh' || disconnected ? 'stale' : ''}`}>{status && <>{phrase(status)}{NBSP}· </>}<span className="weather-age-value">{status === 'Saved forecast' && age.startsWith('Updated ') ? age.slice('Updated '.length) : age}</span></span>,
    ...(credit ? [<span className="weather-credit">{phrase('Open-Meteo')}</span>] : []),
  ];
  return <div className="weather-footer weather-footer-compact">{parts.map((part, index) => <Fragment key={index}>{index > 0 && <span className="weather-footer-separator">{NBSP}· </span>}{part}</Fragment>)}</div>;
}

/**
 * One adaptive Weather widget (#74). Calm shows conditions; a hint line replaces feels-like when
 * rain is later, possible or unknown; elevated (rain now or within six hours) leads with rain
 * timing. The footprint never changes, and every family renders at fit 1 at Text 100% in every
 * state (#283). Hooks for #75/#76: data-weather-mode, data-rain-kind, --weather-rain and the
 * .rain-bar classes (each bar's share in --rain-bar, drawn by translate, #161). Everything that
 * formats a time is memoized per minute (#99): a tick within the same minute formats nothing.
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
    // The axis Air quality's chart shares (#261): “Now” under the bar covering now, the window's end at the right.
    const axis = chartAxisLabels(outlook.hours, minute, timeZone, clockFormat)!;
    return { outlook, copy, chart: {
      label: rainChartLabel(outlook, timeZone, clockFormat),
      titles: outlook.hours.map(hour => `${time(hour.start)}: ${hour.chance === null ? 'unknown' : `${hour.chance}%`}`),
      from: axis.start, to: axis.end,
    } };
    // weather.hourly and units are the outlook's inputs; the whole weather object changes on every poll.
  }, [weather.hourly, weather.units, timeZone, clockFormat, minute, variant, size]);
  const lastKnown = useMemo(() => lastKnownTime(weather, disconnected, timeZone, clockFormat, minute), [weather, disconnected, timeZone, clockFormat, minute]);
  if (!current) {
    // Unavailable (#362): no louder than the weather it replaces. A dim, still cloud (the widget's own
    // icon, not a condition) and a dim placeholder keep the footprint; one status-tone line at the
    // label size says so (“· retrying” while the computer keeps trying, “· offline” while the display
    // cannot reach it); the age shows only when an update time is known, and no credit while no
    // forecast is shown.
    const reason = disconnected ? 'offline' : weather.status === 'fresh' ? null : 'retrying';
    return <div className="widget-body weather-body" data-weather-mode="unavailable">
      <div className="ambient-label weather-place">{weather.location.name}<span className="weather-unit"> · {weather.units.temperature}</span></div>
      <div className="weather-overview">
        <div className="current-weather-main"><span className="current-temperature weather-placeholder" aria-hidden="true"><span className="weather-placeholder-dash">—</span>°</span><WeatherGlyph code={3} still size={null} className="weather-symbol weather-symbol-unavailable" /></div>
        <div className="weather-summary"><div className="weather-unavailable status-caution">{reason ? `Weather unavailable${NBSP}·${NBSP}${reason}` : 'Weather unavailable'}</div></div>
      </div>
      {weather.updatedAt && <div className="weather-footer"><div className="weather-age"><span className="weather-age-value">{ageLabel(weather.updatedAt, now.getTime())}</span></div></div>}
    </div>;
  }
  const mode = outlook.emphasis;
  const condition = conditionLabel(current.weatherCode);
  // Retained forecasts never animate their glyph (#76).
  const still = disconnected || weather.status !== 'fresh';
  const showConfidence = mode !== 'calm' && copy.confidence !== '' && (size !== 'small' || copy.confidence !== 'Forecast estimate');
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
        : <div className="weather-details">Feels like <TransitionText value={temperature(current.feelsLike)} /></div>;
    summary = <>{conditionLine}{second}</>;
  }
  return <div className="widget-body weather-body" data-weather-mode={mode} data-rain-kind={outlook.kind} data-last-known={lastKnown ? '' : undefined}>
    <div className="ambient-label weather-place">{weather.location.name}<span className="weather-unit"> · {weather.units.temperature}</span></div>
    <div className="weather-overview">
      <div className="current-weather-main"><TransitionText className="current-temperature" value={temperature(current.temperature)} />{current.weatherCode !== null && <WeatherGlyph code={current.weatherCode} isDay={current.isDay} hero still={still} size={null} className="weather-symbol" />}</div>
      <div className="weather-summary">{summary}</div>
    </div>
    {size === 'large' && mode !== 'elevated' && <div className="weather-metrics"><div><span className="metric-label">Wind</span><TransitionText value={current.windSpeed === null ? 'Unavailable' : `${Math.round(current.windSpeed)} ${weather.units.windSpeed}`} /></div><div><span className="metric-label">High / low</span><span>{highLow}</span></div></div>}
    {chart && <div className="weather-rain">
      <div className="rain-timing"><TransitionText value={copy.headline} /></div>
      <div className="rain-detail"><TransitionText value={copy.detail} /></div>
      {/* Each bar is full height, moved down by translate so --rain-bar of it shows (#161). */}
      <div className="rain-bars" role="img" aria-label={chart.label}>{outlook.hours.map((hour, index) => <span
        key={hour.start}
        className={['rain-bar', hour.inSpell ? 'rain-bar-spell' : '', hour.chance === null ? 'rain-bar-unknown' : ''].filter(Boolean).join(' ')}
        style={{ '--rain-bar': `${hour.chance === null ? 8 : Math.max(hour.chance, 2)}%` } as CSSProperties}
        title={chart.titles[index]}
      />)}</div>
      <div className="rain-hours"><TransitionText value={chart.from} /><TransitionText value={chart.to} /></div>
    </div>}
    {size === 'small'
      ? <CompactFooter weather={weather} disconnected={disconnected} now={now} confidence={showConfidence ? copy.confidence : null} credit={weatherAttributionWidget(settings) === 'weather'} />
      : <div className="weather-footer">{showConfidence && <div className="rain-confidence">{copy.confidence}</div>}<WeatherAge weather={weather} disconnected={disconnected} now={now} /><SourceCredit id="weather" settings={settings} /></div>}
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
