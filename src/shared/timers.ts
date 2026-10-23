import type { Timer } from './contracts.ts';

/**
 * Silent timers started from Home (#438). Pure rules shared by the server, the display Clock's timer
 * slot and Home. Every phase comes from absolute instants, so a display that has lost the computer
 * keeps counting from `endsAt` and a restart keeps what was left.
 */
export const TIMER_LIMIT = 6;
export const TIMER_MIN_MS = 1000;
export const TIMER_MAX_MS = 86_400_000;
/** The most one "add time" request may add (Home sends +1 minute). */
export const TIMER_ADD_MAX_MS = 3_600_000;
export const TIMER_LABEL_MAX = 40;
/** How long the display Clock shows a finished timer as Done. */
export const DISPLAY_DONE_MS = 10 * 60_000;
/** How long Home lists a finished timer, unless it is dismissed; the server then prunes it. */
export const KEEP_DONE_MS = 60 * 60_000;

export const TIMER_MESSAGES = {
  limit: 'Up to 6 timers at once. Dismiss or cancel one first.',
  range: 'Choose a time between 1 second and 24 hours.',
  total: "A timer can't run for more than 24 hours.",
  finished: 'This timer has finished. Restart it instead.',
  notFound: 'Timer not found',
  cleared: "Timers couldn't be read after the app restarted, so they were cleared.",
} as const;

export type TimerPhase = 'running' | 'paused' | 'done';

/** Paused while `remainingMs` is set, done once `endsAt` has passed, otherwise running. */
export function timerPhase(timer: Pick<Timer, 'endsAt' | 'remainingMs'>, now: number): TimerPhase {
  if (timer.remainingMs !== null) return 'paused';
  return timer.endsAt !== null && Date.parse(timer.endsAt) <= now ? 'done' : 'running';
}

/** Milliseconds left: what was left when paused, the time to `endsAt` while running, 0 when done. */
export function timerRemaining(timer: Pick<Timer, 'endsAt' | 'remainingMs'>, now: number): number {
  if (timer.remainingMs !== null) return timer.remainingMs;
  return timer.endsAt === null ? 0 : Math.max(0, Date.parse(timer.endsAt) - now);
}

/** When a done timer finished; null while it runs or is paused. */
export function timerDoneAt(timer: Pick<Timer, 'endsAt' | 'remainingMs'>, now: number): number | null {
  return timerPhase(timer, now) === 'done' ? Date.parse(timer.endsAt!) : null;
}

/** Running and paused timers, and done ones for 10 minutes on the display or 60 minutes on Home. */
export function visibleTimers<T extends Pick<Timer, 'endsAt' | 'remainingMs'>>(timers: readonly T[], now: number, forDisplay: boolean): T[] {
  const window = forDisplay ? DISPLAY_DONE_MS : KEEP_DONE_MS;
  return timers.filter(timer => {
    const doneAt = timerDoneAt(timer, now);
    return doneAt === null || now - doneAt < window;
  });
}

const PHASE_ORDER: Record<TimerPhase, number> = { done: 0, running: 1, paused: 2 };
/** Done first (the newest end first), then running (the soonest end first), then paused (the least left first). */
export function orderTimers<T extends Pick<Timer, 'id' | 'endsAt' | 'remainingMs'>>(timers: readonly T[], now: number): T[] {
  const key = (timer: T) => {
    const phase = timerPhase(timer, now);
    return { phase, value: phase === 'done' ? -Date.parse(timer.endsAt!) : phase === 'running' ? Date.parse(timer.endsAt!) : timer.remainingMs! };
  };
  return [...timers].sort((a, b) => {
    const left = key(a), right = key(b);
    return PHASE_ORDER[left.phase] - PHASE_ORDER[right.phase] || left.value - right.value || a.id.localeCompare(b.id);
  });
}

/** "5 min", "1 h 30 min", "45 s" or "1 min 30 s": the whole hours, minutes and seconds of a length. */
export function durationName(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  const parts = [hours ? `${hours} h` : '', minutes ? `${minutes} min` : '', seconds ? `${seconds} s` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : '0 s';
}

/** The label, or a name from the length it was started with: "5 min timer". */
export function timerName(timer: Pick<Timer, 'label' | 'durationMs'>): string {
  return timer.label.trim() || `${durationName(timer.durationMs)} timer`;
}
