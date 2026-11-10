/** Pure foreground geometry. The renderer supplies only eligible large reading
 * targets and interpolates these centre positions linearly, without rotation or
 * extra scaling. Art, protected-ink measurement and lifecycle stay with it. */
export interface PassageRect { left: number; top: number; right: number; bottom: number }
export interface PassageTarget { id: string; rect: PassageRect; swept: PassageRect }
export interface PassagePlan {
  kind: 'incursion' | 'near';
  targetId: string;
  duration: number;
  width: number;
  height: number;
  steps: readonly { offset: number; x: number; y: number }[];
  /** Conservative maximum of actual-target and future-envelope contact time. */
  intersectionMs: number;
  /** Maximum overlap-area ratio across the actual target and future envelope. */
  footprintRatio: number;
}
export interface PassageInput {
  width: number;
  height: number;
  targets: readonly PassageTarget[];
  protectedRects: readonly PassageRect[];
  now: number;
  lastGlobal: number | null;
  lastByTarget: Readonly<Record<string, number | undefined>>;
}
/** At most one passage a minute: the upper end of the owner's 45-60 second request (2026-11-09). */
export const PASSAGE_GLOBAL_COOLDOWN = 60_000;
export const PASSAGE_TARGET_COOLDOWN = 180_000;
export const PASSAGE_MAX_DURATION = 6_000;
export const PASSAGE_MAX_INTERSECTION = 1_200;
export const PASSAGE_MAX_FOOTPRINT = .05;
const DURATION = 4_800;
type PathGeometry = Pick<PassagePlan, 'duration' | 'width' | 'height' | 'steps'>;
type PassageStep = PassagePlan['steps'][number];

const validRect = (rect: PassageRect) => [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
  && rect.right > rect.left && rect.bottom > rect.top;
const area = (rect: PassageRect) => (rect.right - rect.left) * (rect.bottom - rect.top);
const contains = (outer: PassageRect, inner: PassageRect) => outer.left <= inner.left && outer.top <= inner.top
  && outer.right >= inner.right && outer.bottom >= inner.bottom;
function validPath(plan: PathGeometry) {
  return Number.isFinite(plan.duration) && plan.duration > 0 && Number.isFinite(plan.width) && plan.width > 0
    && Number.isFinite(plan.height) && plan.height > 0 && plan.steps.length >= 2
    && plan.steps[0]!.offset === 0 && plan.steps.at(-1)!.offset === 1
    && plan.steps.every((step, index) => [step.offset, step.x, step.y].every(Number.isFinite)
      && step.offset >= 0 && step.offset <= 1 && (!index || step.offset > plan.steps[index - 1]!.offset));
}

/** Open interval with positive actor/rectangle overlap. Expanding the rectangle
 * by half the actor size turns the swept-AABB problem into line clipping. */
function contactInterval(from: PassageStep, to: PassageStep, rect: PassageRect, halfWidth: number, halfHeight: number): readonly [number, number] | null {
  let enter = 0, leave = 1;
  for (const [position, delta, low, high] of [
    [from.x, to.x - from.x, rect.left - halfWidth, rect.right + halfWidth],
    [from.y, to.y - from.y, rect.top - halfHeight, rect.bottom + halfHeight],
  ]) {
    if (delta === 0) { if (position! <= low! || position! >= high!) return null; continue; }
    const first = (low! - position!) / delta!, last = (high! - position!) / delta!;
    enter = Math.max(enter, Math.min(first, last));
    leave = Math.min(leave, Math.max(first, last));
    if (leave <= enter) return null;
  }
  return [enter, leave];
}

function overlapAxes(x: number, y: number, halfWidth: number, halfHeight: number, rect: PassageRect): readonly [number, number] {
  return [Math.max(0, Math.min(x + halfWidth, rect.right) - Math.max(x - halfWidth, rect.left)),
    Math.max(0, Math.min(y + halfHeight, rect.bottom) - Math.max(y - halfHeight, rect.top))];
}

/** Overlap width and height are piecewise linear. Their product is quadratic
 * between edge crossings, so endpoints plus its stationary point are exact. */
function largestOverlap(from: PassageStep, to: PassageStep, rect: PassageRect, halfWidth: number, halfHeight: number) {
  const dx = to.x - from.x, dy = to.y - from.y, breaks = [0, 1];
  for (const [position, delta, edges] of [
    [from.x, dx, [rect.left - halfWidth, rect.left + halfWidth, rect.right - halfWidth, rect.right + halfWidth]],
    [from.y, dy, [rect.top - halfHeight, rect.top + halfHeight, rect.bottom - halfHeight, rect.bottom + halfHeight]],
  ] as const) {
    if (!delta) continue;
    for (const edge of edges) {
      const time = (edge - position) / delta;
      if (time > 0 && time < 1) breaks.push(time);
    }
  }
  const times = [...new Set(breaks)].sort((a, b) => a - b);
  let maximum = 0;
  for (let index = 1; index < times.length; index++) {
    const start = times[index - 1]!, end = times[index]!;
    const [w0, h0] = overlapAxes(from.x + dx * start, from.y + dy * start, halfWidth, halfHeight, rect);
    const [w1, h1] = overlapAxes(from.x + dx * end, from.y + dy * end, halfWidth, halfHeight, rect);
    maximum = Math.max(maximum, w0 * h0, w1 * h1);
    const dw = w1 - w0, dh = h1 - h0, quadratic = dw * dh;
    if (quadratic !== 0) {
      const stationary = -(w0 * dh + h0 * dw) / (2 * quadratic);
      if (stationary > 0 && stationary < 1) maximum = Math.max(maximum, (w0 + dw * stationary) * (h0 + dh * stationary));
    }
  }
  return maximum;
}

/** Revalidate a plan against current reading/protected geometry at content or
 * resize boundaries. Null is invalid geometry and must cancel the passage. */
export function passagePathMetrics(plan: PathGeometry, rect: PassageRect): { intersectionMs: number; footprintRatio: number } | null {
  if (!validPath(plan) || !validRect(rect)) return null;
  const halfWidth = plan.width / 2, halfHeight = plan.height / 2;
  let intersectionMs = 0, maximumArea = 0;
  for (let index = 1; index < plan.steps.length; index++) {
    const from = plan.steps[index - 1]!, to = plan.steps[index]!;
    const interval = contactInterval(from, to, rect, halfWidth, halfHeight);
    if (interval) intersectionMs += (interval[1] - interval[0]) * (to.offset - from.offset) * plan.duration;
    maximumArea = Math.max(maximumArea, largestOverlap(from, to, rect, halfWidth, halfHeight));
  }
  const footprintRatio = maximumArea / area(rect);
  return Number.isFinite(intersectionMs) && Number.isFinite(footprintRatio)
    ? { intersectionMs: Math.min(plan.duration, intersectionMs), footprintRatio } : null;
}

function candidate(target: PassageTarget, viewportWidth: number, viewportHeight: number, side: 'left' | 'right'): PathGeometry | null {
  const rect = target.rect, rectWidth = rect.right - rect.left, rectHeight = rect.bottom - rect.top;
  // The whole actor is at most13% of target width and20% of target height;
  // the path penetrates only15% of the actor width into the target edge.
  const width = Math.min(Math.min(viewportWidth, viewportHeight) * .03, rectWidth * .13, rectHeight * .40);
  if (width < 8) return null;
  const height = width / 2, halfWidth = width / 2, halfHeight = height / 2;
  const gap = Math.max(5, Math.min(12, width * .4));
  const outsideX = side === 'left' ? target.swept.left - halfWidth - gap : target.swept.right + halfWidth + gap;
  const insideX = side === 'left' ? rect.left - width * .35 : rect.right + width * .35;
  const nearY = rect.bottom - height * .70;
  const rootY = Math.min(viewportHeight - halfHeight - 2, rect.bottom + halfHeight + gap);
  // A very broad future swap envelope is a reason to omit the event, not race
  // from its edge to the actual target in a fraction of a second.
  if (Math.abs(insideX - outsideX) > Math.min(viewportWidth, viewportHeight) * .12) return null;
  const steps: PassagePlan['steps'] = [
    { offset: 0, x: outsideX, y: rootY },
    { offset: .40, x: outsideX, y: nearY + height * .30 },
    { offset: .47, x: insideX, y: nearY },
    { offset: .53, x: insideX, y: nearY - height * .08 },
    { offset: .60, x: outsideX, y: nearY + height * .18 },
    { offset: 1, x: outsideX, y: rootY },
  ];
  // Convex viewport bounds contain every complete line segment, not just its
  // centre. Passage art and its strokes are already bounded by this rectangle.
  if (steps.some(step => step.x - halfWidth < 0 || step.x + halfWidth > viewportWidth
    || step.y - halfHeight < 0 || step.y + halfHeight > viewportHeight)) return null;
  return { duration: DURATION, width, height, steps };
}

export function planPassage(input: PassageInput): PassagePlan | null {
  const { width, height, targets, protectedRects, now, lastGlobal, lastByTarget } = input;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 || !Number.isFinite(now) || now < 0
    || lastGlobal !== null && (!Number.isFinite(lastGlobal) || now - lastGlobal < PASSAGE_GLOBAL_COOLDOWN)
    || protectedRects.some(rect => !validRect(rect))) return null;
  const viewport = { left: 0, top: 0, right: width, bottom: height };
  // Stable selection plus per-target cooldown naturally rotates among eligible
  // reading areas without introducing a random clock or persisted state.
  const ordered = [...targets].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const target of ordered) {
    const last = Object.hasOwn(lastByTarget, target.id) ? lastByTarget[target.id] : undefined;
    if (!target.id || !validRect(target.rect) || !validRect(target.swept) || !contains(viewport, target.rect) || !contains(target.swept, target.rect)
      || last !== undefined && (!Number.isFinite(last) || now - last < PASSAGE_TARGET_COOLDOWN)) continue;
    for (const side of ['left', 'right'] as const) {
      const path = candidate(target, width, height, side);
      if (!path || path.duration > PASSAGE_MAX_DURATION) continue;
      const actual = passagePathMetrics(path, target.rect), swept = passagePathMetrics(path, target.swept);
      if (!actual || !swept || actual.intersectionMs <= 0 || actual.footprintRatio <= 0) continue;
      const intersectionMs = Math.max(actual.intersectionMs, swept.intersectionMs);
      const footprintRatio = Math.max(actual.footprintRatio, swept.footprintRatio);
      if (intersectionMs > PASSAGE_MAX_INTERSECTION || footprintRatio > PASSAGE_MAX_FOOTPRINT) continue;
      if (protectedRects.some(rect => {
        const metrics = passagePathMetrics(path, rect);
        return !metrics || metrics.intersectionMs > 0 || metrics.footprintRatio > 0;
      })) continue;
      return { kind: 'incursion', targetId: target.id, ...path, intersectionMs, footprintRatio };
    }
  }
  return null;
}

export interface PassageOrigin { id: string; x: number; y: number; edge: 'top' | 'bottom' | 'left' | 'right' }
/** Bind the exact incursion geometry to a visible authored habitat. If that route
 * cannot clear every protected reading, a near-depth passage may stay entirely
 * in whitespace. Empty/clock-only boards therefore keep the optional depth. */
export function planScenePassage(input: PassageInput & { origins: readonly PassageOrigin[] }): PassagePlan | null {
  if (!Number.isFinite(input.now) || input.now < 0 || input.lastGlobal !== null && (!Number.isFinite(input.lastGlobal) || input.now - input.lastGlobal < PASSAGE_GLOBAL_COOLDOWN)) return null;
  const short = Math.min(input.width, input.height);
  if (!Number.isFinite(short) || short <= 0) return null;
  const inside = (path: PathGeometry) => path.steps.every(step => step.x - path.width / 2 >= 0 && step.x + path.width / 2 <= input.width && step.y - path.height / 2 >= 0 && step.y + path.height / 2 <= input.height);
  const clears = (path: PathGeometry, rects: readonly PassageRect[]) => rects.every(rect => { const metrics = passagePathMetrics(path, rect); return metrics && metrics.intersectionMs === 0 && metrics.footprintRatio === 0; });
  const origins = input.origins.filter(o => Number.isFinite(o.x) && Number.isFinite(o.y));
  const graze = planPassage(input);
  if (graze) for (const origin of origins) {
    if (Math.hypot(origin.x - graze.steps[0]!.x, origin.y - graze.steps[0]!.y) > short * .30) continue;
    const path = { ...graze, steps: graze.steps.map((step, index) => index === 0 || index === graze.steps.length - 1 ? { ...step, x: origin.x, y: origin.y } : step) };
    const target = input.targets.find(t => t.id === graze.targetId)!;
    const actual = passagePathMetrics(path, target.rect), swept = passagePathMetrics(path, target.swept);
    if (!actual || !swept || !inside(path) || !clears(path, input.protectedRects)) continue;
    const intersectionMs = Math.max(actual.intersectionMs, swept.intersectionMs), footprintRatio = Math.max(actual.footprintRatio, swept.footprintRatio);
    if (intersectionMs <= PASSAGE_MAX_INTERSECTION && footprintRatio <= PASSAGE_MAX_FOOTPRINT) return { ...path, intersectionMs, footprintRatio };
  }
  const protectedRects = [...input.protectedRects, ...input.targets.map(t => t.swept)];
  for (const origin of origins) {
    const targetId = `habitat:${origin.id}`, last = input.lastByTarget[targetId];
    if (last !== undefined && (!Number.isFinite(last) || input.now - last < PASSAGE_TARGET_COOLDOWN)) continue;
    const inward = origin.edge === 'bottom' ? [0, -1] : origin.edge === 'top' ? [0, 1] : origin.edge === 'left' ? [1, 0] : [-1, 0];
    // A cluster of several forms, 40-80px across, arcing through widget whitespace. Longer
    // routes are tried first; every candidate must clear all reading and movement space.
    for (const reach of [1, .7, .45]) for (const direction of [-1, 1]) {
      const along = [-inward[1]! * direction, inward[0]! * direction];
      const steps = [[0, 0, .02], [.3, .13, .1], [.65, .3, .15], [1, .44, .07]].map(([offset, travel, depth]) => ({
        offset: offset!, x: origin.x + short * reach * (along[0]! * travel! + inward[0]! * depth!), y: origin.y + short * reach * (along[1]! * travel! + inward[1]! * depth!),
      }));
      const path = { duration: PASSAGE_MAX_DURATION, width: short * .075, height: short * .05, steps };
      if (inside(path) && clears(path, protectedRects)) return { kind: 'near', targetId, ...path, intersectionMs: 0, footprintRatio: 0 };
    }
  }
  return null;
}
