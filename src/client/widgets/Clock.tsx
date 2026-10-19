import { useState, type CSSProperties } from 'react';
import { advanceClockHands, rebaseClockHands, type HandAngles } from '../../shared/motion.ts';
import { useMotion } from '../useMotion.ts';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

/**
 * Hand angles that accumulate clockwise for small forward steps (59 → 00 and 12 → 1 move
 * forward), snap for jumps, and return to [0, 360) during a black rest.
 */
function useHands(hours: number, minutes: number, resting: boolean): HandAngles & { key: string } {
  const key = `${hours}:${minutes}`;
  const [hands, setHands] = useState(() => ({ ...advanceClockHands(null, hours, minutes), key }));
  let next = hands;
  if (hands.key !== key) next = { ...advanceClockHands(hands, hours, minutes), key };
  if (resting && (next.hour >= 360 || next.minute >= 360 || next.animate)) next = { ...rebaseClockHands(next), key };
  // Adjusting state while rendering (React's "store information from previous renders" pattern).
  if (next !== hands) setHands(next);
  return next;
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

function Clock({ settings, now, size }: WidgetContentProps) {
  const { resting } = useMotion();
  const parts = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hour12: settings.clockFormat === '12h' }).formatToParts(now);
  const clock = parts.filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim(); const period = parts.find(part => part.type === 'dayPeriod')?.value;
  const spoken = period ? `${clock} ${period}` : clock;
  const hands = useHands(now.getHours(), now.getMinutes(), resting);
  const handState = hands.animate ? undefined : 'true';
  return <div className={`clock-face clock-family-${size} clock-style-${settings.appearance.clockStyle}`}>
    <div className="clock-calendar"><div className="ambient-label"><TransitionText value={new Intl.DateTimeFormat('en', { weekday: size === 'small' ? 'short' : 'long' }).format(now)} /></div><div className="clock-date"><TransitionText value={new Intl.DateTimeFormat('en', { month: size === 'small' ? 'short' : 'long', day: 'numeric' }).format(now)} /></div></div>
    {settings.appearance.clockStyle === 'analog'
      ? <svg className="analog-clock" viewBox="0 0 100 100" role="img" aria-label={spoken}><line className="analog-hour" x1="50" y1="53" x2="50" y2="27" style={{ rotate: `${hands.hour}deg` }} data-hand-snap={handState} /><line className="analog-minute" x1="50" y1="54" x2="50" y2="12" style={{ rotate: `${hands.minute}deg` }} data-hand-snap={handState} /></svg>
      : <div className={`clock-time clock-${settings.appearance.clockStyle}`}><ClockCharacters text={clock} />{period && <span className="clock-period" aria-hidden="true"><TransitionText value={period} /></span>}<span className="sr-only">{spoken}</span></div>}
  </div>;
}

export const ClockWidget: WidgetModule = { Renderer: Clock };
