/**
 * Float (#436): the whole board, and each widget's content inside its own box, drift slowly and
 * continuously so nothing stays on the same pixels, and the screen never goes dark to move. Pure
 * functions shared by the display's one timer (Display.tsx) and the tests.
 *
 * A track visits waypoints from a low-discrepancy sequence (the golden ratio and √2 − 1, as the
 * retired per-cycle motionOffset did), one each interval: it moves at constant speed between two
 * waypoints and eases in and out at each end, so it "reaches a new spot every interval".
 */

/**
 * The board's travel each way, as a share of the display's width and height. The plane is inset 4%
 * (widgets.css `.widget-grid-plane`), so ±3.5% keeps it 0.5% inside the screen: about ±134 × ±76
 * device pixels at 3840 × 2160.
 */
export const FLOAT_TRAVEL = 0.035;
/** The most position changes one timer makes per second. */
export const MAX_STEPS_PER_SECOND = 30;
/** Share of each interval spent speeding up at its start (and slowing down at its end). */
const EASE = 0.15;
/** Peak speed (progress per interval) of the eased profile. */
const PEAK = 1 / (1 - EASE);
const GOLDEN = 0.61803398875, SILVER = 0.41421356237;

export interface Point { x: number; y: number }
/** CSS pixels of free space around a widget's drawn content. */
export interface FloatSlack { left: number; right: number; top: number; bottom: number }
export interface FloatRange { lo: Point; hi: Point }
/** Same measured travel budget for live playback and a seeked editor frame. */
export function floatRange(slack: FloatSlack, width: number, height: number, dpr: number): FloatRange | null {
  const axis = (before: number, after: number, display: number) => {
    let lo = -before, hi = after;
    const cap = 0.06 * display;
    if (hi - lo > cap) { const shrink = cap / (hi - lo); lo *= shrink; hi *= shrink; }
    return (hi - lo) * dpr < 2 ? [0, 0] : [lo, hi];
  };
  const [loX, hiX] = axis(slack.left, slack.right, width), [loY, hiY] = axis(slack.top, slack.bottom, height);
  if (loX === hiX && loY === hiY) return null;
  return { lo: { x: loX!, y: loY! }, hi: { x: hiX!, y: hiY! } };
}

/** A track's target inside measured content slack; the live timer approaches it in device pixels. */
export function widgetFloatTarget(seconds: number, interval: number, floating: boolean, track: FloatTrack, range: FloatRange | null, slack: FloatSlack, dpr: number): Point {
  let target = { x: 0, y: 0 };
  if (range && (floating || seconds >= interval)) {
    const position = floating ? floatPath(seconds, interval, track) : stepPath(seconds, interval, track);
    const snap = (value: number) => Math.round(value * dpr) / dpr;
    target = { x: snap((range.lo.x + range.hi.x) / 2 + (range.hi.x - range.lo.x) / 2 * position.x), y: snap((range.lo.y + range.hi.y) / 2 + (range.hi.y - range.lo.y) / 2 * position.y) };
  }
  return clampFloatOffset(target, slack, dpr);
}
/**
 * Keep an already drawn offset inside newly measured slack (#479). Round bounds inward so a
 * whole-device-pixel translation cannot overshoot a fractional CSS-pixel edge. A content change
 * may need one immediate jump; ordinary float steps keep their one-device-pixel limit.
 */
export function clampFloatOffset(offset: Point, slack: FloatSlack, dpr: number): Point {
  const axis = (value: number, before: number, after: number) =>
    Math.min(Math.floor(after * dpr) / dpr, Math.max(Math.ceil(-before * dpr) / dpr, value)) || 0;
  return { x: axis(offset.x, slack.left, slack.right), y: axis(offset.y, slack.top, slack.bottom) };
}
/** Which waypoints a track follows (`lead`) and how far out of step with the board it runs (`phase`, a share of an interval). */
export interface FloatTrack { lead: number; phase: number }
/** The board: waypoint 0, the arrangement as the user placed it, at the start. */
export const PLANE_TRACK: FloatTrack = { lead: 0, phase: 0 };

const fraction = (value: number) => value - Math.floor(value);

/** Waypoint `k` in [-1, 1]²; waypoint 0 is the centre. Consecutive waypoints are at least 38% of the range apart on x and 41% on y. */
export function waypointUnit(k: number): Point {
  return { x: (fraction(k * GOLDEN + 0.5) - 0.5) * 2, y: (fraction(k * SILVER + 0.5) - 0.5) * 2 };
}
/** Waypoint `k` as a share of the display (±FLOAT_TRAVEL on each axis). */
export function waypoint(k: number): Point {
  const unit = waypointUnit(k);
  return { x: unit.x * FLOAT_TRAVEL, y: unit.y * FLOAT_TRAVEL };
}

/** Progress (0 → 1) through one interval at time `u` (0 → 1): constant speed in the middle, smoothly eased over the first and last 15%. */
export function easedProgress(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (u < EASE) return PEAK * u * u / (2 * EASE);
  if (u > 1 - EASE) return 1 - PEAK * (1 - u) ** 2 / (2 * EASE);
  return PEAK * (u - EASE / 2);
}
/** The time `u` at which easedProgress reaches `p`. */
function progressTime(p: number): number {
  const edge = PEAK * EASE / 2;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  if (p < edge) return Math.sqrt(2 * EASE * p / PEAK);
  if (p > 1 - edge) return 1 - Math.sqrt(2 * EASE * (1 - p) / PEAK);
  return p / PEAK + EASE / 2;
}

/** Widget `index` follows its own waypoints, out of step with the board and with the other widgets. */
export function widgetTrack(index: number): FloatTrack {
  return { lead: 7 * (index + 1), phase: fraction((index + 1) * GOLDEN) };
}

/** A track's position in [-1, 1]² after `seconds`, moving to its next waypoint every `intervalSeconds`. */
export function floatPath(seconds: number, intervalSeconds: number, track: FloatTrack = PLANE_TRACK): Point {
  const time = seconds / intervalSeconds + track.phase, k = Math.floor(time), p = easedProgress(time - k);
  const from = waypointUnit(k + track.lead), to = waypointUnit(k + 1 + track.lead);
  return { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p };
}
/** Without animation (Float gently off, or reduced motion): a track jumps to its next waypoint at each interval boundary. */
export function stepPath(seconds: number, intervalSeconds: number, track: FloatTrack = PLANE_TRACK): Point {
  return waypointUnit(Math.floor(seconds / intervalSeconds) + track.lead);
}
/** The board's offset as a share of the display (±FLOAT_TRAVEL) after `seconds`. */
export function floatOffset(seconds: number, intervalSeconds: number): Point {
  const unit = floatPath(seconds, intervalSeconds);
  return { x: unit.x * FLOAT_TRAVEL, y: unit.y * FLOAT_TRAVEL };
}
/** Widget `index`'s position in [-1, 1]² inside its own slack after `seconds`. */
export function widgetPhase(seconds: number, intervalSeconds: number, index: number): Point {
  return floatPath(seconds, intervalSeconds, widgetTrack(index));
}

/**
 * How a unit position maps to device pixels on each axis: `x`/`y` device pixels per unit (half the
 * range) around `originX`/`originY` (the device position of unit 0).
 */
export interface DeviceScale { x: number; y: number; originX?: number; originY?: number }
/** A unit position in whole device pixels. */
export function devicePosition(unit: Point, scale: DeviceScale): Point {
  return { x: Math.round((scale.originX ?? 0) + unit.x * scale.x), y: Math.round((scale.originY ?? 0) + unit.y * scale.y) };
}

/**
 * Seconds until a floating track's whole-device-pixel position next changes, never less than one
 * step at MAX_STEPS_PER_SECOND: the timer wakes only when something on screen will move.
 */
export function nextStepDelay(seconds: number, intervalSeconds: number, devicePixels: DeviceScale, track: FloatTrack = PLANE_TRACK): number {
  const minimum = 1 / MAX_STEPS_PER_SECOND;
  const time = seconds / intervalSeconds + track.phase, first = Math.floor(time);
  let best = Infinity;
  // A tiny range may not change pixel within the current segment; look at most two segments further.
  for (let segment = 0; segment < 3 && best === Infinity; segment++) {
    const k = first + segment, start = segment === 0 ? easedProgress(time - k) : 0;
    const from = waypointUnit(k + track.lead), to = waypointUnit(k + 1 + track.lead);
    for (const axis of ['x', 'y'] as const) {
      const scale = devicePixels[axis], origin = (axis === 'x' ? devicePixels.originX : devicePixels.originY) ?? 0;
      const a = origin + from[axis] * scale, b = origin + to[axis] * scale;
      if (!(Math.abs(b - a) > 1e-9)) continue;
      const rounded = Math.round(a + (b - a) * start);
      // Math.round rounds halves up: moving up the pixel changes at r + 0.5, moving down just below r − 0.5.
      const boundary = b > a ? rounded + 0.5 : rounded - 0.5;
      const p = (boundary - a) / (b - a);
      if (p > 1 || p < start) continue;
      best = Math.min(best, (k + progressTime(p) - track.phase) * intervalSeconds - seconds);
    }
  }
  if (best === Infinity) best = (first + 3 - track.phase) * intervalSeconds - seconds;
  // One millisecond past the crossing, so the rounded position has really changed when the timer fires.
  return Math.max(minimum, best + 0.001);
}

/** Seconds until the next interval boundary, when a stepping track jumps. */
export function nextBoundaryDelay(seconds: number, intervalSeconds: number): number {
  return Math.max(1 / MAX_STEPS_PER_SECOND, (Math.floor(seconds / intervalSeconds) + 1) * intervalSeconds - seconds + 0.001);
}
