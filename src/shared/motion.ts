/** Motion inside widgets and the editor (#76). Relocation through black is unaffected. */
export const ANIMATION_LEVELS = ['off', 'subtle', 'lively'] as const;
export type AnimationLevel = typeof ANIMATION_LEVELS[number];
export const DEFAULT_ANIMATION_LEVEL: AnimationLevel = 'subtle';
export const ANIMATION_LABELS: Record<AnimationLevel, string> = { off: 'Off', subtle: 'Subtle', lively: 'Lively' };

/**
 * Where a renderer is shown. `display` is the ambient page (and the editor's Preview movement),
 * `canvas` the authored editor preview, `canvas-editing` the canvas during Edit layout and
 * `sample` a picker sample, which is always still.
 */
export type MotionSurface = 'display' | 'canvas' | 'canvas-editing' | 'sample';
export type EntranceLevel = 'none' | 'subtle' | 'lively';

/** What may move on one surface. Every animation is one-shot except Lively hero-glyph loops. */
export interface MotionPlan {
  /** The effective level on this screen: Off whenever the screen prefers reduced motion. */
  level: AnimationLevel;
  /** Changed values, clock characters and hands transition (never tweened through invented numbers). */
  valueTransitions: boolean;
  /** The hero weather glyph settles once on a reveal or condition change. */
  glyphOneShot: boolean;
  /** The only perpetual loops: the hero weather glyph at Lively. */
  glyphLoops: boolean;
  /** Widget content settles in after a black rest (or an editor replay). */
  entrance: EntranceLevel;
  /** Lively in-widget reveal choreography (forecast days, rain bars, metrics, reminders). */
  choreography: boolean;
  /** Editor micro-interactions (tabs, disclosures, picker, drag, Save bar). */
  editorPolish: boolean;
}

export interface MotionInput {
  level: AnimationLevel;
  reducedMotion: boolean;
  /** Style → Drift and fade between moves (`motionEnabled`): whole-arrangement fades, drift and travel. */
  softMotion: boolean;
  fadeSeconds: number;
  surface: MotionSurface;
  /** An explicit editor replay of the entrance (choosing a level, for example). */
  replay?: boolean;
}

const STILL: Omit<MotionPlan, 'level'> = { valueTransitions: false, glyphOneShot: false, glyphLoops: false, entrance: 'none', choreography: false, editorPolish: false };

export function isAnimationLevel(value: unknown): value is AnimationLevel {
  return typeof value === 'string' && (ANIMATION_LEVELS as readonly string[]).includes(value);
}

/** The level a screen actually shows: its own reduced-motion preference always wins. */
export function effectiveAnimationLevel(level: AnimationLevel | undefined, reducedMotion: boolean): AnimationLevel {
  if (reducedMotion) return 'off';
  return isAnimationLevel(level) ? level : DEFAULT_ANIMATION_LEVEL;
}

export function motionPlan({ level: saved, reducedMotion, softMotion, fadeSeconds, surface, replay = false }: MotionInput): MotionPlan {
  const level = effectiveAnimationLevel(saved, reducedMotion);
  if (surface === 'sample') return { level: 'off', ...STILL };
  const editorPolish = level !== 'off' && (surface === 'canvas' || surface === 'canvas-editing');
  if (level === 'off' || surface === 'canvas-editing') return { level, ...STILL, editorPolish };
  // The display reveals after each black rest only when the arrangement itself fades in; the
  // editor canvas plays it only when explicitly replayed.
  const entrance: EntranceLevel = replay || (surface === 'display' && softMotion && fadeSeconds > 0) ? level : 'none';
  return {
    level,
    valueTransitions: true,
    glyphOneShot: true,
    glyphLoops: level === 'lively',
    entrance,
    choreography: entrance === 'lively',
    editorPolish,
  };
}

/** Reveal timing per entrance level. CSS mirrors these values in motion.css. */
export const REVEAL_TIMING: Record<Exclude<EntranceLevel, 'none'>, { staggerMs: number; enterMs: number; glyphSettleMs: number }> = {
  subtle: { staggerMs: 70, enterMs: 700, glyphSettleMs: 900 },
  lively: { staggerMs: 110, enterMs: 1000, glyphSettleMs: 1000 },
};
/** Later widgets share the sixth step, so a dense board never waits long for its last widget. */
export const MAX_REVEAL_STEPS = 6;

/**
 * How long a reveal lasts. `totalMs` covers the arrangement's own fade-in and the last widget's
 * settle, and never exceeds fadeSeconds × 1000 + 1660 ms.
 */
export function revealTiming(plan: Pick<MotionPlan, 'entrance'>, fadeSeconds: number, visibleCount: number): { staggerMs: number; enterMs: number; totalMs: number } {
  if (plan.entrance === 'none') return { staggerMs: 0, enterMs: 0, totalMs: 0 };
  const timing = REVEAL_TIMING[plan.entrance];
  const steps = Math.min(Math.max(Math.floor(visibleCount) - 1, 0), MAX_REVEAL_STEPS);
  const fadeMs = Number.isFinite(fadeSeconds) ? Math.max(0, fadeSeconds) * 1000 : 0;
  return { staggerMs: timing.staggerMs, enterMs: timing.enterMs, totalMs: Math.max(fadeMs, steps * timing.staggerMs + Math.max(timing.enterMs, timing.glyphSettleMs)) };
}

export function normalizeAngle(angle: number): number {
  const result = angle % 360;
  return result < 0 ? result + 360 : result + 0;
}

/**
 * Next rotation for a clock hand. A small forward step accumulates clockwise past 360 (so 59 → 00
 * and the 12 → 1 wrap move forward); anything else, including backwards and large jumps, snaps
 * to the target without animation.
 */
export function advanceAngle(previous: number | null, target: number, maxForwardStep = 90): { angle: number; animate: boolean } {
  const goal = normalizeAngle(target);
  if (previous === null || !Number.isFinite(previous)) return { angle: goal, animate: false };
  const forward = normalizeAngle(goal - previous);
  if (forward < 1e-9 || 360 - forward < 1e-9) return { angle: previous, animate: false };
  if (forward < maxForwardStep) return { angle: previous + forward, animate: true };
  return { angle: goal, animate: false };
}

export interface HandAngles { hour: number; minute: number; animate: boolean }
/** The hour hand moves 0.5° a minute, so its step limit (7.5°) treats anything over 15 minutes as a jump. */
export const HOUR_HAND_MAX_STEP = 7.5;

/**
 * Both analog hands move together: when either jumps (a DST fall-back, sleep/resume, a manual
 * clock change) both snap, so the hands never disagree mid-animation.
 */
export function advanceClockHands(previous: Pick<HandAngles, 'hour' | 'minute'> | null, hours: number, minutes: number): HandAngles {
  const hourTarget = ((hours % 12) + minutes / 60) * 30, minuteTarget = minutes * 6;
  if (!previous) return { hour: normalizeAngle(hourTarget), minute: normalizeAngle(minuteTarget), animate: false };
  const hour = advanceAngle(previous.hour, hourTarget, HOUR_HAND_MAX_STEP), minute = advanceAngle(previous.minute, minuteTarget);
  const jumped = (!hour.animate && hour.angle !== previous.hour) || (!minute.animate && minute.angle !== previous.minute);
  if (jumped) return { hour: normalizeAngle(hourTarget), minute: normalizeAngle(minuteTarget), animate: false };
  return { hour: hour.angle, minute: minute.angle, animate: hour.animate || minute.animate };
}

/** During a black rest, accumulated angles return to [0, 360) without a visible change. */
export function rebaseClockHands(hands: Pick<HandAngles, 'hour' | 'minute'>): HandAngles {
  return { hour: normalizeAngle(hands.hour), minute: normalizeAngle(hands.minute), animate: false };
}
