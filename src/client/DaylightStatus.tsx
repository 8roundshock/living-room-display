import { useEffect, useMemo, useState } from 'react';
import type { DaylightBrightness, Settings } from '../shared/contracts.ts';
import { formatTime } from './astronomy.ts';
import { DAYLIGHT_DIM_RAMP_MINUTES, DAYLIGHT_STEP_MS, daylightStatus, daylightTimeZone } from './daylight.ts';
import { InfoTip } from './InfoTip';

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
 * Follow daylight in the Style tab (#439, #591): the value the display shows now, when it is at
 * Brightest and when it next dims, for the draft's range and weather location, in that location's
 * time zone.
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
  const zone = useMemo(() => daylightTimeZone(settings.location.timezone, weatherZone), [settings.location.timezone, weatherZone]);
  const status = daylightStatus(range, settings.location, minute * DAYLIGHT_STEP_MS, zone);
  // formatTime keeps AM/PM with its time by a no-break space (#197).
  const time = (at: Date) => formatTime(at, zone, settings.clockFormat);
  const bright = status.full
    ? status.fullAt ? `brightest since ${time(status.fullAt)}` : 'brightest all day'
    : status.fullAt ? `brightest from ${time(status.fullAt)}`
      : status.polar === 'night' ? 'the sun stays down today' : 'the sun stays low today';
  const dims = status.dims === 'time' ? `dims at ${time(status.dimAt)}`
    : status.dims === 'dusk' ? `Dimmest after dusk at ${time(status.dimAt)}`
      : 'light all night';
  const place = `your weather location (${settings.location.name})`;
  const evening = `${Math.round(status.eveningBrightness * 100)}%`;
  return (
    <div className="daylight-status">
      <p className="daylight-now">
        <span>Now {Math.round(status.brightness * 100)}%</span>
        {` · ${bright} · ${dims}`}
      </p>
      <InfoTip label="How daylight brightness works">
        {`Rises through dawn at ${place}, reaches Brightest soon after sunrise and stays there while it is light. `}
        {`After sunset it eases to an evening level (${evening}) for a lit room, glides to Dimmest over ${DAYLIGHT_DIM_RAMP_MINUTES} minutes from the dim time, and stays there until dawn. `}
        {status.polar === 'night'
          ? 'While the sun stays down it rises only to the evening level, late in the morning. '
          : status.dims !== 'time'
            ? 'While it is still light at the dim time, it dims with the dusk instead. '
            : ''}
        {'Starter looks keep this daylight range. Saved styles restore their saved brightness mode, range and dim time.'}
      </InfoTip>
    </div>
  );
}
