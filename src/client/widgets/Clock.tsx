import { useMemo, useState, type CSSProperties } from 'react';
import { advanceClockHands, type HandAngles } from '../../shared/motion.ts';
import type { Settings } from '../../shared/contracts.ts';
import type { WidgetSize } from '../../shared/widgets.ts';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

/**
 * Hand angles that accumulate clockwise for small forward steps (59 → 00 and 12 → 1 move
 * forward) and snap for jumps. #436: the display never goes black, so they keep accumulating
 * for the whole session (#174's re-base on black is gone) and a hand never turns backwards.
 */
function useHands(hours: number, minutes: number): HandAngles & { key: string } {
  const key = `${hours}:${minutes}`;
  const [hands, setHands] = useState(() => ({ ...advanceClockHands(null, hours, minutes), key }));
  let next = hands;
  if (hands.key !== key) next = { ...advanceClockHands(hands, hours, minutes), key };
  // Adjusting state while rendering (React's "store information from previous renders" pattern).
  if (next !== hands) setHands(next);
  return next;
}

export interface ClockLabels { clock: string; period: string | null; spoken: string; weekday: string; date: string }

/**
 * Everything the clock prints for one minute of the computer's local time. The renderer memoizes
 * it per minute (#99), so the one-second tick builds no `Intl` formatter while the minute holds.
 */
export function clockLabels(at: Date, clockFormat: Settings['clockFormat'], size: WidgetSize): ClockLabels {
  const parts = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hour12: clockFormat === '12h' }).formatToParts(at);
  const clock = parts.filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim();
  const period = parts.find(part => part.type === 'dayPeriod')?.value ?? null;
  return {
    clock, period, spoken: period ? `${clock} ${period}` : clock,
    weekday: new Intl.DateTimeFormat('en', { weekday: size === 'small' ? 'short' : 'long' }).format(at),
    date: new Intl.DateTimeFormat('en', { month: size === 'small' ? 'short' : 'long', day: 'numeric' }).format(at),
  };
}

/** One span per character keyed by its position from the right, so only changed characters remount. */
function ClockCharacters({ text }: { text: string }) {
  const characters = Array.from(text);
  return <span className="clock-digits" aria-hidden="true">
    {characters.map((character, index) => {
      const fromEnd = characters.length - 1 - index;
      return <span key={`${fromEnd}:${character}`} className="clock-char" style={{ '--char-from-end': fromEnd } as CSSProperties}>{character}</span>;
    })}
  </span>;
}

/**
 * Hand-only analog time (#222): no face, bezel or tick ring, only a dim pivot dot over the
 * junction the hands always light. Each hand is an HTML bar inside a full-box wrapper whose
 * `rotate` turns around the box centre, so Subtle and Lively ease it on the compositor (#161);
 * the at-rest geometry is the same at every Animation level.
 */
function AnalogClock({ hour, minute, snap, label }: { hour: number; minute: number; snap: boolean; label: string }) {
  const state = snap ? 'true' : undefined;
  return <div className="analog-clock" role="img" aria-label={label}>
    <span className="analog-hand analog-hour" style={{ rotate: `${hour}deg` }} data-hand-snap={state}><span className="analog-stroke" /></span>
    <span className="analog-hand analog-minute" style={{ rotate: `${minute}deg` }} data-hand-snap={state}><span className="analog-stroke" /></span>
    <span className="analog-pivot" />
  </div>;
}

function Clock({ settings, now, size }: WidgetContentProps) {
  const minute = Math.floor(now.getTime() / 60_000);
  // `now` is a new Date every second; the labels change only with the minute.
  const labels = useMemo(() => clockLabels(new Date(minute * 60_000), settings.clockFormat, size), [minute, settings.clockFormat, size]);
  const hands = useHands(now.getHours(), now.getMinutes());
  const style = settings.appearance.clockStyle;
  return <div className={`clock-face clock-family-${size} clock-style-${style}`}>
    <div className="clock-calendar"><div className="ambient-label"><TransitionText value={labels.weekday} /></div><div className="clock-date"><TransitionText value={labels.date} /></div></div>
    {style === 'analog'
      ? <AnalogClock hour={hands.hour} minute={hands.minute} snap={!hands.animate} label={labels.spoken} />
      : <div className={`clock-time clock-${style}`}><ClockCharacters text={labels.clock} />{labels.period && <span className="clock-period" aria-hidden="true"><TransitionText value={labels.period} /></span>}<span className="sr-only">{labels.spoken}</span></div>}
  </div>;
}

export const ClockWidget: WidgetModule = { Renderer: Clock };
