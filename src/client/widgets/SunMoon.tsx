import { useMemo } from 'react';
import type { AppState, Settings } from '../../shared/contracts.ts';
import { addDays, civilDateKey, formatDuration, formatTime, moonPhase, nextMoonEvent, sunDay, sunIsUp, timeParts, zoneFormatter, type MoonPhase } from '../astronomy.ts';
import { weatherTimeZone } from '../format.ts';
import { Icon } from '../icons.tsx';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule, WidgetSettingsProps } from './types.ts';
import './sun-moon.css';

interface SkyModel {
  timeZone: string;
  sunrise: Date | null; sunset: Date | null; polar: 'day' | 'night' | null;
  daylightMinutes: number; change: number | null;
  next: { label: 'Sunrise' | 'Sunset'; at: Date } | { label: 'Sun up all day' | 'Sun stays down today'; at: null };
  /** Fraction of today's daylight elapsed while the sun is up; null otherwise. */
  dayFraction: number | null;
  moon: MoonPhase; upcoming: { kind: 'Full moon' | 'New moon'; at: Date };
  southern: boolean;
}

const polarLabel = (polar: 'day' | 'night') => polar === 'day' ? 'Sun up all day' as const : 'Sun stays down today' as const;

/** Calculated once per minute per place; rendering every second only formats cached values. */
function skyModel(minute: number, latitude: number, longitude: number, timeZone: string): SkyModel {
  const at = new Date(minute * 60_000);
  const today = civilDateKey(at, timeZone);
  const sun = sunDay(today, latitude, longitude, timeZone), yesterday = sunDay(addDays(today, -1), latitude, longitude, timeZone);
  let next: SkyModel['next'];
  if (sun.polar) next = { label: polarLabel(sun.polar), at: null };
  else if (at < sun.sunrise!) next = { label: 'Sunrise', at: sun.sunrise! };
  else if (at < sun.sunset!) next = { label: 'Sunset', at: sun.sunset! };
  else {
    const tomorrow = sunDay(addDays(today, 1), latitude, longitude, timeZone);
    next = tomorrow.sunrise ? { label: 'Sunrise', at: tomorrow.sunrise } : { label: polarLabel(tomorrow.polar ?? 'night'), at: null };
  }
  const up = sunIsUp(at, latitude, longitude);
  const dayFraction = up && sun.sunrise && sun.sunset && at >= sun.sunrise && at <= sun.sunset ? (at.getTime() - sun.sunrise.getTime()) / (sun.sunset.getTime() - sun.sunrise.getTime()) : null;
  const moon = moonPhase(at);
  // On the full moon itself the next useful event is the new moon.
  const upcoming = moon.name === 'Full moon' ? { kind: 'New moon' as const, at: nextMoonEvent(at, 'new') } : { kind: 'Full moon' as const, at: nextMoonEvent(at, 'full') };
  return {
    timeZone, sunrise: sun.sunrise, sunset: sun.sunset, polar: sun.polar, daylightMinutes: sun.daylightMinutes,
    change: sun.polar || yesterday.polar ? null : Math.round(sun.daylightMinutes) - Math.round(yesterday.daylightMinutes),
    next, dayFraction, moon, upcoming, southern: latitude < 0,
  };
}

function useSky(state: AppState, now: Date): SkyModel {
  const minute = Math.floor(now.getTime() / 60_000);
  const { latitude, longitude, timezone: zone } = state.weather.location;
  // Memoized like Weather's and Air quality's (#324): while a device location's zone is still `auto`,
  // the fallback to this computer's zone constructs an Intl formatter, and the display re-renders
  // every widget each second. A system zone change reaches the display on its next reload.
  const timeZone = useMemo(() => weatherTimeZone(zone), [zone]);
  return useMemo(() => skyModel(minute, latitude, longitude, timeZone), [minute, latitude, longitude, timeZone]);
}

/**
 * An outline disc with a dim lit fraction (never a bright full disc). Northern hemisphere waxing
 * light is on the right; waning and southern latitudes mirror it.
 */
export function MoonGlyph({ moon, southern, className }: { moon: MoonPhase; southern: boolean; className?: string }) {
  const k = moon.illumination;
  const rx = 10 * Math.abs(1 - 2 * k);
  const mirror = moon.waxing === southern;
  const lit = k < 0.01 ? null : k > 0.99 ? 'M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20Z' : `M12 2A10 10 0 0 1 12 22A${rx.toFixed(3)} 10 0 0 ${k < 0.5 ? 0 : 1} 12 2Z`;
  return <svg className={className ? `moon-glyph ${className}` : 'moon-glyph'} data-glyph="moon" viewBox="0 0 24 24" role="img" aria-label={`${moon.name}, ${Math.round(k * 100)}% lit`}>
    {lit && <path className="moon-lit" d={lit} transform={mirror ? 'matrix(-1 0 0 1 24 0)' : undefined} />}
    <circle className="moon-outline" cx="12" cy="12" r="10" />
  </svg>;
}

function Time({ at, timeZone, settings, className }: { at: Date; timeZone: string; settings: Settings; className: string }) {
  const { time, period } = timeParts(at, timeZone, settings.clockFormat);
  return <span className={className}><TransitionText value={time} />{period && <span className="sun-period">{period}</span>}</span>;
}
/** Discrete dots along the day arc (a half ellipse), so it stays a light dotted trace at any size. */
const ARC_DOTS = Array.from({ length: 29 }, (_, index) => {
  const angle = Math.PI * (1 - index / 28);
  return [(100 + 92 * Math.cos(angle)).toFixed(2), (60 - 52 * Math.sin(angle)).toFixed(2)] as const;
});
const signedMinutes =(value: number) => value === 0 ? '±0 min' : `${value > 0 ? '+' : '−'}${Math.abs(value)} min`;
const moonDate = (at: Date, timeZone: string) => zoneFormatter(timeZone, { weekday: 'short', month: 'short', day: 'numeric' }).format(at);

function SunMoon({ state, settings, size, now }: WidgetContentProps) {
  const sky = useSky(state, now);
  const place = state.weather.location.name;
  const clock = (at: Date | null) => at ? formatTime(at, sky.timeZone, settings.clockFormat) : '—';
  const daylight = sky.polar ? (sky.polar === 'day' ? '24 h daylight' : 'No daylight') : `${formatDuration(sky.daylightMinutes)} daylight`;
  const moonGroup = (detail: boolean) => <div className="moon-block tone-time">
    <MoonGlyph moon={sky.moon} southern={sky.southern} />
    <div className="moon-copy">
      <div className="moon-name"><TransitionText value={detail ? `${sky.moon.name} · ${Math.round(sky.moon.illumination * 100)}%` : sky.moon.name} /></div>
      {detail && <div className="moon-next">{sky.upcoming.kind} {moonDate(sky.upcoming.at, sky.timeZone)}</div>}
    </div>
  </div>;

  if (size === 'small') {
    const glyph = sky.next.at || sky.next.label === 'Sun up all day' ? 'sun' : 'moon';
    return <div className="widget-body sun-body">
      <div className="ambient-label"><Icon name={sky.next.at ? 'sunrise' : glyph} size={null} data-glyph={glyph} />{sky.next.at ? sky.next.label : 'Sun & moon'}</div>
      {sky.next.at ? <Time at={sky.next.at} timeZone={sky.timeZone} settings={settings} className="sun-hero" /> : <div className="sun-polar">{sky.next.label}</div>}
      <div className="weather-context sun-place">{place}</div>
    </div>;
  }
  const sunTimes = sky.polar ? <div className="sun-polar">{polarLabel(sky.polar)}</div> : <>
    <div className="sun-row"><span className="metric-label">Sunrise</span><TransitionText className="sun-value" value={clock(sky.sunrise)} /></div>
    <div className="sun-row"><span className="metric-label">Sunset</span><TransitionText className="sun-value" value={clock(sky.sunset)} /></div>
  </>;
  const daylightLine = <div className="sun-daylight">{daylight}{sky.change !== null && <span className="sun-change"> · {signedMinutes(sky.change)}</span>}</div>;
  if (size === 'medium') {
    return <div className="widget-body sun-body">
      <div className="ambient-label">{place}</div>
      <div className="sun-columns"><div className="sun-times">{sunTimes}{daylightLine}</div>{moonGroup(false)}</div>
    </div>;
  }
  const f = sky.dayFraction, angle = f === null ? 0 : Math.PI * (1 - f);
  return <div className="widget-body sun-body">
    <div className="ambient-label">{place}</div>
    {!sky.polar && <svg className="sun-arc" viewBox="0 0 200 66" aria-hidden="true">
      <g className="sun-arc-path">{ARC_DOTS.map(([x, y]) => <circle key={x} cx={x} cy={y} r="1.1" />)}</g>
      {f !== null && <circle className="sun-dot" data-glyph="sun" cx={(100 + 92 * Math.cos(angle)).toFixed(2)} cy={(60 - 52 * Math.sin(angle)).toFixed(2)} r="4.5" />}
    </svg>}
    <div className="sun-arc-ends">{sky.polar ? <div className="sun-polar">{polarLabel(sky.polar)}</div> : <>
      <div className="sun-row"><span className="metric-label">Sunrise</span><TransitionText className="sun-value" value={clock(sky.sunrise)} /></div>
      <div className="sun-row sun-row-end"><span className="metric-label">Sunset</span><TransitionText className="sun-value" value={clock(sky.sunset)} /></div>
    </>}</div>
    {daylightLine}
    {moonGroup(true)}
  </div>;
}

function SunMoonSettings({ settings }: WidgetSettingsProps) {
  return <p className="hint">Uses your weather location ({settings.location.name}); times are calculated on this computer.</p>;
}

export const SunMoonWidget: WidgetModule = { Renderer: SunMoon, Settings: SunMoonSettings };
