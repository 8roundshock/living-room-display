import type { Settings, Timer } from '../shared/contracts.ts';
import type { WidgetSize } from '../shared/widgets.ts';
import { orderTimers, timerDoneAt, timerName, timerPhase, timerRemaining, visibleTimers, type TimerPhase } from '../shared/timers.ts';
import { dateTimeFormat } from './format.ts';

type ClockFormat = Settings['clockFormat'];

/** Some engines put a narrow no-break space before AM/PM; timer lines use a plain space. */
function plain(text: string): string { return text.replace(/[  ]/g, ' '); }
function civilDays(at: Date): number { return Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / 86_400_000; }

/** A time of day in the 12/24-hour setting, from a cached formatter (#99): "6:51 PM" or "18:51". */
export function timeOfDay(at: Date, format: ClockFormat): string {
  return plain(dateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hourCycle: format === '24h' ? 'h23' : 'h12' }).format(at));
}

/** When a running timer ends, on this computer's clock: "ends 6:51 PM", "ends tomorrow 1:10 AM" or, further out, "ends Thu 1:10 AM". */
export function timerEnds(endsAt: number, now: number, format: ClockFormat): string {
  const end = new Date(endsAt), offset = civilDays(end) - civilDays(new Date(now));
  const day = offset === 0 ? '' : offset === 1 ? 'tomorrow ' : `${dateTimeFormat('en', { weekday: 'short' }).format(end)} `;
  return `ends ${day}${timeOfDay(end, format)}`;
}

/**
 * What is left, as the display says it: whole minutes rounded up ("8 min", "1 h 5 min", "2 min" for
 * 61 s) above a minute, then seconds rounded up ("60 s", "45 s"). The minute form changes at most once a
 * minute; only the last 60 s count every second.
 */
export function timeLeft(ms: number): string {
  if (ms <= 60_000) return `${Math.max(0, Math.ceil(ms / 1000))} s`;
  const minutes = Math.ceil(ms / 60_000), hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? (rest ? `${hours} h ${rest} min` : `${hours} h`) : `${minutes} min`;
}

/** "just now", "2 min ago" or "1 h 5 min ago" since a timer finished, in whole minutes. */
export function doneAgo(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'just now';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return `${hours ? (rest ? `${hours} h ${rest} min` : `${hours} h`) : `${minutes} min`} ago`;
}

export interface ClockTimer {
  /** The timer's name in the accent colour. */
  label: string;
  /** How many more timers are visible (" +N", dim). */
  more: number;
  /** What the date line says instead of the date. */
  value: string;
  phase: TimerPhase;
  /** Running within its last minute: the value changes every second, so it is plain text with no transition. */
  ticking: boolean;
}

/**
 * The display Clock's timer slot (#438): the first timer of `orderTimers(visibleTimers(..., display))`, or
 * null when none is visible, so the date returns. Large adds "left", when it ends and " · offline" while
 * the display cannot reach the computer (it keeps counting from `endsAt`). Built from cached formatters,
 * so a running timer constructs no Intl object on the one-second tick.
 */
export function clockTimer(timers: readonly Timer[] | undefined, now: number, format: ClockFormat, size: WidgetSize, disconnected: boolean): ClockTimer | null {
  if (!timers?.length) return null;
  const visible = orderTimers(visibleTimers(timers, now, true), now);
  const timer = visible[0];
  if (!timer) return null;
  const phase = timerPhase(timer, now), large = size === 'large';
  const remaining = timerRemaining(timer, now);
  let value: string;
  if (phase === 'done') value = size === 'small' ? 'Done' : `Done · ${doneAgo(now - timerDoneAt(timer, now)!)}`;
  else if (!large) value = timeLeft(remaining);
  else if (phase === 'paused') value = `${timeLeft(remaining)} left · paused`;
  else value = remaining <= 60_000 ? `${timeLeft(remaining)} left` : `${timeLeft(remaining)} left · ${timerEnds(Date.parse(timer.endsAt!), now, format)}`;
  if (large && disconnected) value += ' · offline';
  return { label: timerName(timer), more: visible.length - 1, value, phase, ticking: phase === 'running' && remaining <= 60_000 };
}

/** Home's live digits: "9:59" or "1:05:00", seconds rounded up so a fresh 10-minute timer reads 10:00. */
export function timerDigits(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** The per-minute screen-reader text beside the live digits: "about 8 minutes left", "less than a minute left". */
export function spokenTimeLeft(ms: number): string {
  if (ms <= 60_000) return 'less than a minute left';
  const minutes = Math.ceil(ms / 60_000), hours = Math.floor(minutes / 60), rest = minutes % 60;
  const unit = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`;
  return `about ${hours ? `${unit(hours, 'hour')}${rest ? ` ${unit(rest, 'minute')}` : ''}` : unit(minutes, 'minute')} left`;
}

/** How Home names a timer in a sentence or a control: "Pasta timer", or "10 min timer" without a label. */
export function timerPhrase(timer: Pick<Timer, 'label' | 'durationMs'>): string {
  const label = timer.label.trim();
  return label ? `${label} timer` : timerName(timer);
}
