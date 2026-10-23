import { useEffect, useState } from 'react';
import type { DaylightBrightness, Settings } from '../shared/contracts.ts';
import { isValidTimeZone, timeParts } from './astronomy.ts';
import { DAYLIGHT_STEP_MS, daylightStatus } from './daylight.ts';
import { weatherTimeZone } from './format.ts';

/** The current minute, re-rendered just after each minute starts (when the value can change). */
function useMinute(): number {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / DAYLIGHT_STEP_MS));
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setMinute(Math.floor(Date.now() / DAYLIGHT_STEP_MS));
        schedule();
      }, DAYLIGHT_STEP_MS - (Date.now() % DAYLIGHT_STEP_MS) + 20);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);
  return minute;
}

/**
 * Follow daylight in the Style tab (#439): the value the display shows now and when it is brightest,
 * for the draft's range and weather location, in that location's time zone.
 */
export function DaylightStatus({
  range,
  settings,
  weatherZone,
}: {
  range: DaylightBrightness;
  settings: Settings;
  /** The forecast's resolved zone, used when the location stores `auto` (a device area). */
  weatherZone: string | null | undefined;
}) {
  const minute = useMinute();
  const status = daylightStatus(range, settings.location, minute * DAYLIGHT_STEP_MS);
  const zone = isValidTimeZone(settings.location.timezone)
    ? settings.location.timezone
    : weatherTimeZone(weatherZone);
  const { time, period } = timeParts(status.peak, zone, settings.clockFormat);
  // A no-break space keeps AM/PM with its time (#197).
  const peak = period ? `${time} ${period}` : time;
  const place = `your weather location (${settings.location.name})`;
  return (
    <div className="daylight-status">
      <p className="daylight-now">
        <span>Now {Math.round(status.brightness * 100)}%</span>
        {status.polar === 'night'
          ? ' · the sun stays down today'
          : ` · brightest at ${peak}`}
      </p>
      <p className="hint">
        {status.polar === 'night'
          ? `Stays at Dimmest while the sun is down at ${place}.`
          : status.polar === 'day'
            ? `Peaks at solar noon. The sun is up all day at ${place}, so it stays above Dimmest.`
            : `Peaks at solar noon at ${place} and rests at Dimmest from sunset to sunrise.`}
      </p>
    </div>
  );
}
