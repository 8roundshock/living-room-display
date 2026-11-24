import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { advanceClockHands, type HandAngles } from '../../shared/motion.ts';
import type { Settings } from '../../shared/contracts.ts';
import type { WidgetSize } from '../../shared/widgets.ts';
import { TransitionText } from './TransitionText.tsx';
import { clockTimer, type ClockTimer } from '../timer.ts';
import { clockInk, clockPlacement, shownHour, type ClockInk } from '../clock-spacing.ts';
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

/**
 * One span per character keyed by its position from the right, so only changed characters remount. #717: each
 * character carries its glyph's side bearings (`--ink-left`, `--ink-right`), and widgets.css turns them into
 * margins that leave the same gap between every pair of neighbours. Without `ink` (a typeface not measured yet,
 * or one that cannot be) the run has no `clock-ink` class and keeps tabular figures at their natural spacing;
 * the class change lets the shared fit rerun (#314).
 */
function ClockCharacters({ text, ink, run }: { text: string; ink: ClockInk | null; run: RefObject<HTMLSpanElement | null> }) {
  const characters = Array.from(text);
  return <span ref={run} className={ink ? 'clock-digits clock-ink' : 'clock-digits'} aria-hidden="true">
    {characters.map((character, index) => {
      const fromEnd = characters.length - 1 - index, glyph = ink?.[character];
      const style = { '--char-from-end': fromEnd, ...(glyph && { '--ink-left': glyph.left, '--ink-right': glyph.right }) } as CSSProperties;
      return <span key={`${fromEnd}:${character}`} className="clock-char" style={style}>{character}</span>;
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

/**
 * The timer slot (#438): while a timer is visible, the date line shows it in the same elements and
 * fonts as the date, so the clock's fit is unchanged and the date returns afterwards. The name and
 * the minute-rounded value change at most once a minute through TransitionText; only a timer's last
 * minute counts every second, as plain tabular text (#99). Silent: no sound and no flashing.
 */
function ClockTimerSlot({ timer }: { timer: ClockTimer }) {
  return <>
    <div className="ambient-label clock-timer-label" data-timer-phase={timer.phase}>
      <span className="clock-timer-name"><TransitionText value={timer.label} /></span>
      {timer.more > 0 && <span className="clock-timer-more">+{timer.more}</span>}
    </div>
    <div className="clock-date clock-timer-value" data-timer-phase={timer.phase}>
      {timer.phase === 'paused' && <span className="clock-timer-paused" aria-hidden="true"><i /><i /></span>}
      {timer.ticking ? <span className="clock-timer-digits">{timer.value}</span> : <TransitionText value={timer.value} />}
    </div>
  </>;
}

function Clock({ state, settings, now, size, disconnected }: WidgetContentProps) {
  const minute = Math.floor(now.getTime() / 60_000);
  // `now` is a new Date every second; the labels change only with the minute.
  const labels = useMemo(() => clockLabels(new Date(minute * 60_000), settings.clockFormat, size), [minute, settings.clockFormat, size]);
  const hands = useHands(now.getHours(), now.getMinutes());
  const style = settings.appearance.clockStyle;
  const timer = clockTimer(state.timers, now.getTime(), settings.clockFormat, size, disconnected);
  // #717: the digits' typeface is measured once per typeface (clock-spacing.ts), when the run is first on the page
  // and again when the typeface, the style or the family changes. Analog has no run and no table. A typeface that
  // could not be measured is tried again when the hour the clock shows changes (local time, never a UTC hour).
  const run = useRef<HTMLSpanElement>(null);
  const [ink, setInk] = useState<ClockInk | null>(null);
  const typeface = `${settings.appearance.fontFamily}:${style}:${size}`, retry = ink ? null : shownHour(now);
  useLayoutEffect(() => { setInk(run.current ? clockInk(run.current) : null); }, [typeface, retry]);
  // Where this minute's time sits in the room of the widest time; widgets.css holds that room and places the time.
  // A centred clock is held by the middle minute: the hold is what this minute's box is short of it. With AM/PM
  // the period stands after the widest minute's room and ends the box, so the box is already the widest minute's
  // and the hold is the same all hour; without it the room trails the last digit. Without a table, tabular
  // figures are all one width: the room is only the character a one-digit hour lacks.
  const placement = useMemo(() => ink ? clockPlacement(ink, labels.clock, settings.clockFormat) : null, [ink, labels.clock, settings.clockFormat]);
  const room: Record<string, number> = { '--clock-short': Math.max(0, 5 - labels.clock.length) };
  if (placement) Object.assign(room, { '--clock-lead': placement.lead, '--clock-lead-gaps': placement.leadGaps }, labels.period ? { '--clock-slack': placement.slack, '--clock-hold': Math.round((placement.hold - placement.slack) * 10_000) / 10_000 } : { '--clock-trail': placement.trail, '--clock-hold': placement.hold });
  return <div className={`clock-face clock-family-${size} clock-style-${style}`} style={room as CSSProperties}>
    <div className={timer ? 'clock-calendar clock-timer' : 'clock-calendar'}>{timer ? <ClockTimerSlot timer={timer} /> : <><div className="ambient-label"><TransitionText value={labels.weekday} /></div><div className="clock-date"><TransitionText value={labels.date} /></div></>}</div>
    {style === 'analog'
      ? <AnalogClock hour={hands.hour} minute={hands.minute} snap={!hands.animate} label={labels.spoken} />
      : <div className={`clock-time clock-${style}${ink ? '' : ' clock-unmeasured'}`}>
        {/* Empty boxes that hold the widest time's room on each side: the shared fit and the float measure them. */}
        <span className="clock-room clock-room-start" aria-hidden="true" />
        <ClockCharacters text={labels.clock} ink={ink} run={run} />
        {labels.period && <span className="clock-period" aria-hidden="true"><TransitionText value={labels.period} /></span>}
        <span className="clock-room clock-room-end" aria-hidden="true" />
        <span className="sr-only">{labels.spoken}</span>
      </div>}
  </div>;
}

export const ClockWidget: WidgetModule = { Renderer: Clock };
