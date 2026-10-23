import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AppState, Settings, WidgetGrid, WidgetId } from '../shared/contracts.ts';
import { GRID_DENSITIES, WIDGET_CATALOG, WIDGET_IDS, composeWidgetGrid, getWidgetRect, placementSpan, widgetRevealOrder } from '../shared/widgets.ts';
import { DEFAULT_ANIMATION_LEVEL, MAX_REVEAL_STEPS, motionPlan, revealTiming, type EntranceLevel, type MotionSurface } from '../shared/motion.ts';
import { FLOAT_TRAVEL, MAX_STEPS_PER_SECOND, clampFloatOffset, floatPath, floatRange, nextBoundaryDelay, nextStepDelay, stepPath, widgetFloatTarget, widgetTrack, type FloatSlack, type Point } from '../shared/float.ts';
import { compositionTimeline, dimSeconds, glideKeyframes, glideSeconds, movementFrame, SWAP_DIM } from '../shared/movementTimeline.ts';
import { renderedAccent, toneVariables } from '../shared/palette.ts';
import { DAYLIGHT_TRANSITION_SECONDS, daylightStep, effectiveBrightness } from './daylight.ts';
import { Icon } from './icons.tsx';
import { MotionContext, usePrefersReducedMotion, type MotionState } from './useMotion.ts';
import { useWakeLock } from './useWakeLock.ts';
import { leaveDisplay, liveOpener } from './displayWindow.ts';
import { WIDGET_RENDERERS, widgetLabel, widgetVisible, type WidgetContentProps } from './widgets/registry.tsx';

export interface WidgetGesture { id: WidgetId; x: number; y: number; width?: number; height?: number }
function toggleFullscreen() {
  const request = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
  void request?.catch(() => undefined);
}

/** CSS pixels a widget's visible content can move each way and stay inside its box (#436). */
type Slack = FloatSlack;
/** What the float timer needs from each widget, kept in a ref so measuring never re-renders. */
interface FloatEntry { section: HTMLElement; slack: Slack; offset: Point | null; measure: () => void }
type FloatRegistry = Map<WidgetId, FloatEntry>;
const NO_SLACK: Slack = { left: 0, right: 0, top: 0, bottom: 0 };
/** Elements measured whole: their inside (an analog clock's turning hands, an image) never shifts the content's extent. */
const ATOMIC = 'svg, img, canvas, picture, video, [role="img"]';

/**
 * The slack of a widget's content inside the section's content box, from the extent of what is
 * actually drawn (text, images, bars) rather than the full-size layout boxes. Measured relative to
 * the content's own rectangle, so the plane's and the section's translation, the fit scale and an
 * entrance in progress all cancel out.
 */
function inkSlack(area: HTMLElement, body: HTMLElement, fit: number): Slack {
  const frame = body.getBoundingClientRect();
  if (!frame.width || !frame.height || !fit) return NO_SLACK;
  const computed = getComputedStyle(area);
  const box = { left: parseFloat(computed.paddingLeft), top: parseFloat(computed.paddingTop), right: area.clientWidth - parseFloat(computed.paddingRight), bottom: area.clientHeight - parseFloat(computed.paddingBottom) };
  // The content's resting rectangle in the section: scaled by `fit` around its left centre (see Widget).
  const rest = { left: body.offsetLeft, top: body.offsetTop + body.offsetHeight * (1 - fit) / 2, width: body.offsetWidth * fit, height: body.offsetHeight * fit };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const add = (rect: DOMRect) => {
    if (rect.width <= 0 && rect.height <= 0) return;
    left = Math.min(left, rect.left); top = Math.min(top, rect.top); right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
  };
  const range = document.createRange();
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!child.textContent?.trim()) continue;
        range.selectNodeContents(child);
        for (const rect of range.getClientRects()) add(rect);
      } else if (child instanceof Element) {
        if (child.classList.contains('sr-only')) continue;
        if (child.matches(ATOMIC) || !child.firstElementChild && !child.textContent?.trim()) add(child.getBoundingClientRect());
        else walk(child);
      }
    }
  };
  walk(body);
  if (!Number.isFinite(left)) return NO_SLACK;
  const toX = (x: number) => rest.left + (x - frame.left) / frame.width * rest.width;
  const toY = (y: number) => rest.top + (y - frame.top) / frame.height * rest.height;
  return { left: Math.max(0, toX(left) - box.left), right: Math.max(0, box.right - toX(right)), top: Math.max(0, toY(top) - box.top), bottom: Math.max(0, box.bottom - toY(bottom)) };
}

const snap = (value: number, dpr: number) => Math.round(value * dpr) / dpr;

function Widget({ id, settings, children, index, revealOrder, style, registry }: { id: WidgetId; settings: Settings; children: ReactNode; index: number; revealOrder: number; style: CSSProperties; registry: FloatRegistry }) {
  const region = useRef<HTMLElement>(null); const content = useRef<HTMLDivElement>(null); const [fit, setFit] = useState(1); const current = useRef(1);
  // Content first shown with the widget never animates; later insertions (a changed value, a new
  // reminder) may transition in through @starting-style once the widget has settled (#76).
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);
  const refit = useRef<() => void>(() => undefined);
  // #99: the display re-renders every widget on its one-second tick, so the fit must not follow
  // `children` (a new element each render). One ResizeObserver (the box and the content's size) and
  // one MutationObserver (text or structure that React actually changed, such as a new minute or a
  // data refresh, and any `class` change inside the content, #314) live as long as the widget; Text
  // size and typeface changes refit explicitly below. The fit itself writes only the content's
  // `style`, which the observer ignores, so a refit never triggers another. #436: the same
  // measurement records how far the content may float inside its box, in a ref (no re-render).
  useLayoutEffect(() => {
    const area = region.current, body = content.current; if (!area || !body) return;
    const entry: FloatEntry = { section: area, slack: NO_SLACK, offset: null, measure: () => {
      entry.slack = inkSlack(area, body, current.current);
      // A longer line must not wait for the next float tick, or ease back through neighbouring
      // content for seconds (#479). Clamp now, in the same measurement that sees it grow.
      if (entry.offset) {
        const safe = clampFloatOffset(entry.offset, entry.slack, window.devicePixelRatio || 1);
        if (safe.x !== entry.offset.x || safe.y !== entry.offset.y) {
          area.style.setProperty('--float-x', `${safe.x}px`);
          area.style.setProperty('--float-y', `${safe.y}px`);
          entry.offset = safe;
        }
      }
    } };
    const update = () => {
      const computed = getComputedStyle(area);
      const width = area.clientWidth - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight);
      const height = area.clientHeight - parseFloat(computed.paddingTop) - parseFloat(computed.paddingBottom);
      // Overfull content is laid out proportionally wider before scaling, like zooming out, so a
      // larger Text size never wraps into extra lines that would render the text smaller.
      const fits = (scale: number) => { body.style.width = `${100 / scale}%`; return body.scrollHeight * scale <= height + 1 && body.scrollWidth * scale <= width + 1; };
      // #249: one tolerance. A scale below 1 that still fits, while 0.002 more does not, is settled;
      // otherwise the search result is accepted as found (never snapped back to a scale that overflows).
      let next = 1;
      if (!fits(1)) {
        const prior = current.current;
        if (prior < 1 && fits(prior) && !fits(Math.min(1, prior + 0.002))) next = prior;
        else { let low = 0.05, high = 1; for (let step = 0; step < 12; step++) { const middle = (low + high) / 2; if (fits(middle)) low = middle; else high = middle; } next = low; }
      }
      body.style.width = `${100 / next}%`; current.current = next; setFit(next);
      entry.measure();
    };
    refit.current = update;
    registry.set(id, entry);
    const resize = new ResizeObserver(update); resize.observe(area); resize.observe(body);
    const mutation = new MutationObserver(update); mutation.observe(body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    update();
    return () => { resize.disconnect(); mutation.disconnect(); refit.current = () => undefined; if (registry.get(id) === entry) registry.delete(id); };
  }, [id, registry]);
  const { fontScale, fontFamily } = settings.appearance;
  const fontKey = useRef(`${fontScale}:${fontFamily}`);
  useLayoutEffect(() => {
    if (fontKey.current === `${fontScale}:${fontFamily}`) return;
    fontKey.current = `${fontScale}:${fontFamily}`; refit.current();
  }, [fontScale, fontFamily]);
  const size = settings.widgetGrid.placements[id].size, span = placementSpan(id, settings.widgetGrid.placements[id]);
  return <section
    ref={region}
    className={[
      'ambient-widget',
      `ambient-${id}`,
      `widget-size-${size}`,
      `tone-${WIDGET_CATALOG[id].tone}`,
    ].join(' ')}
    style={{ ...style, '--widget-index': index, '--reveal-order': Math.min(revealOrder, MAX_REVEAL_STEPS) } as CSSProperties}
    aria-label={widgetLabel(id)}
    data-widget-id={id}
    data-widget-size={size}
    data-widget-span={`${span.columns}x${span.rows}`}
    data-full-height={span.rows === GRID_DENSITIES[settings.widgetGrid.density].rows ? '' : undefined}
    data-settled={settled ? 'true' : undefined}
  >
    <div ref={content} className="widget-content" style={{ width: `${100 / fit}%`, maxWidth: 'none', transform: `scale(${fit})`, transformOrigin: 'left center' }}>{children}</div>
  </section>;
}

interface Reveal { epoch: number; active: boolean }
const NONE: ReadonlySet<WidgetId> = new Set();
/** A swap's glide (#436): clamp(fade × 1.5, 1.2, 6) seconds. */
export { glideSeconds } from '../shared/movementTimeline.ts';
/** A swap without animation (reduced motion, Float gently off or a 0 s glide) dims moving widgets for min(fade / 2, 0.6) s each way. */
export { dimSeconds } from '../shared/movementTimeline.ts';
/** The lowest opacity a moving widget reaches; the plane itself always stays at 1. */
export { SWAP_DIM } from '../shared/movementTimeline.ts';

export function AmbientDisplay({ state, settings = state.settings, embedded = false, native = false, disconnected = false, compositionOverride, layoutEditing = false, photoPreview, gesture, motionSurface = 'editing', revealNonce, previewSeconds }: {
  state: AppState; settings?: Settings; embedded?: boolean; native?: boolean; disconnected?: boolean; compositionOverride?: number; layoutEditing?: boolean; photoPreview?: string | null; gesture?: WidgetGesture | null;
  /** Embedded canvases only: `editing` (the default) keeps widgets still; `preview` shows the draft Animation level. */
  motionSurface?: 'preview' | 'editing';
  /** Each new value replays the entrance once on an embedded canvas (for example after choosing a level). */
  revealNonce?: number;
  /** Editor-only movement clock. Never controls the live display, information time, or polling. */
  previewSeconds?: number;
}) {
  const [now, setNow] = useState(() => new Date()); const [cycle, setCycle] = useState(0); const [interacting, setInteracting] = useState(false);
  // #436 Swap places without animation: the widgets about to move, dimmed (never below SWAP_DIM) while they move.
  const [dimmed, setDimmed] = useState<ReadonlySet<WidgetId>>(NONE);
  const interactionTimer = useRef<number | undefined>(undefined);
  const showControls = useCallback(() => {
    if (embedded || native) return;
    setInteracting(true);
    window.clearTimeout(interactionTimer.current);
    // Repeated pointer events need a fresh deadline even while the state is true.
    interactionTimer.current = window.setTimeout(() => { interactionTimer.current = undefined; setInteracting(false); }, 3500);
  }, [embedded, native]);
  useEffect(() => () => window.clearTimeout(interactionTimer.current), []);
  const reducedMotion = usePrefersReducedMotion();
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  // #436 Keep the screen on: only the ambient page, and only full screen or as the native screensaver.
  const wakeLock = useWakeLock(!embedded && settings.screen.keepAwake, native);
  // Remember that this display is script-opened, even after its editor has closed (#480).
  const [opened, setOpened] = useState(false);
  useEffect(() => { if (!embedded && !native) setOpened(liveOpener() !== null); }, [embedded, native]);

  const { motionEnabled, motionIntervalSeconds, fadeSeconds, rearrange } = settings.appearance;
  const controlled = embedded && previewSeconds !== undefined && Number.isFinite(previewSeconds) && !layoutEditing;
  const previewTime = controlled ? Math.max(0, previewSeconds!) : 0;
  // #436 movement. The board never fades out or rests on black: by default it keeps the arrangement and
  // floats (the plane and each widget's content), or steps once each interval without animation. Swap
  // places (`rearrange`, opt-in) also trades cells every interval, gliding (or dimming) without going dark.
  const floating = motionEnabled && !reducedMotion && !layoutEditing;
  const swapsAllowed = rearrange && !layoutEditing;
  const swapping = swapsAllowed && compositionOverride === undefined && !controlled;
  const glide = floating && fadeSeconds > 0;
  const dimMs = glide ? 0 : dimSeconds(fadeSeconds) * 1000;
  const previewFrame = movementFrame(previewTime, { interval: motionIntervalSeconds, swaps: swapsAllowed, glide, fade: fadeSeconds });

  useEffect(() => {
    if (embedded || native) return;
    const key = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFullscreen(); showControls(); }
      if (event.key === 'Escape') leaveDisplay('/', opened);
      if (event.key.toLowerCase() === 'e') leaveDisplay('/editor', opened);
      if (event.key === 'Tab') showControls();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [embedded, native, opened, showControls]);
  const effectiveCycle = controlled ? previewFrame.cycle : swapsAllowed ? compositionOverride ?? cycle : 0;
  const enabledKey = JSON.stringify([settings.widgets, settings.preview.enabled]);
  const gridKey = JSON.stringify(settings.widgetGrid);
  const enabled = useMemo(() => ({ ...settings.widgets, preview: settings.widgets.preview && settings.preview.enabled }), [enabledKey]);
  const previewBoard = useMemo(() => compositionTimeline(settings.widgetGrid, enabled), [gridKey, enabled]);
  // The two latest compositions: the next one moves away from the first and avoids recreating the second (#317).
  const previous = useRef(settings.widgetGrid), earlier = useRef<WidgetGrid | null>(null);
  // The latest composition computed, so the swap that dims its widgets first and the render that moves
  // them use the same board, computed once.
  const composed = useRef<{ key: string; previous: WidgetGrid; grid: WidgetGrid } | null>(null);
  const composeFor = (target: number): WidgetGrid => {
    const key = `${gridKey}|${enabledKey}|${target}`, hit = composed.current;
    if (hit && hit.key === key && hit.previous === previous.current) return hit.grid;
    const next = composeWidgetGrid(settings.widgetGrid, enabled, target, previous.current, earlier.current ? [earlier.current] : []);
    composed.current = { key, previous: previous.current, grid: next };
    return next;
  };
  // Polling returns new object identities. Recompose only on a real layout change or a swap.
  const grid = useMemo(() => controlled ? previewBoard(effectiveCycle) : composeFor(effectiveCycle), [gridKey, enabled, effectiveCycle, controlled, previewBoard]);
  useEffect(() => { if (!controlled && previous.current !== grid) { earlier.current = previous.current; previous.current = grid; } }, [grid, controlled]);
  // A composition can change CSS-only content alignment (Reminders top/bottom anchoring)
  // without resizing a widget or mutating its descendants. Remeasure after that DOM commit
  // so the existing offset clamps to the new slack before paint, just as for content growth.
  useLayoutEffect(() => { for (const entry of registry.current.values()) entry.measure(); }, [grid, effectiveCycle]);

  // Motion levels (#76). The ambient page and the editor's Preview movement behave as the display;
  // the authored canvas shows the draft level; Edit layout keeps widgets still.
  const surface: MotionSurface = !embedded ? 'display' : motionSurface === 'editing' ? 'canvas-editing' : layoutEditing ? 'canvas' : 'display';
  const motionInput = { level: settings.appearance.animation ?? DEFAULT_ANIMATION_LEVEL, reducedMotion, softMotion: motionEnabled, fadeSeconds, surface };
  const plan = useMemo(() => motionPlan(motionInput), [motionInput.level, reducedMotion, motionInput.softMotion, motionInput.fadeSeconds, surface]);
  const replayPlan = useMemo(() => motionPlan({ ...motionInput, replay: true }), [motionInput.level, reducedMotion, motionInput.softMotion, motionInput.fadeSeconds, surface]);
  const visible = WIDGET_IDS.filter(id => widgetVisible(id, { state, settings, size: settings.widgetGrid.placements[id].size, now, embedded, disconnected, photoPreview }));
  const revealOrder = widgetRevealOrder(grid, visible);

  // The latest render's values for timers that outlive it.
  const latestBoard = useRef({ grid, visible, cycle, composeFor });
  latestBoard.current = { grid, visible, cycle, composeFor };
  // Swap places (#436): every interval the next composition (#395's variety) replaces the board. With a
  // glide the layout effect below animates it; otherwise the widgets that move dim first, move while
  // dimmed and brighten again. Nothing else changes opacity, so the screen never goes dark.
  useEffect(() => {
    if (!swapping) return;
    let pending: number | undefined;
    const timer = window.setInterval(() => {
      window.clearTimeout(pending);
      if (dimMs === 0) { setCycle(value => value + 1); return; }
      const board = latestBoard.current, next = board.composeFor(board.cycle + 1);
      setDimmed(new Set(board.visible.filter(id => board.grid.placements[id].column !== next.placements[id].column || board.grid.placements[id].row !== next.placements[id].row)));
      pending = window.setTimeout(() => { setCycle(value => value + 1); setDimmed(NONE); }, dimMs);
    }, motionIntervalSeconds * 1000);
    return () => { window.clearInterval(timer); window.clearTimeout(pending); setDimmed(NONE); };
  }, [swapping, dimMs, motionIntervalSeconds]);

  const plane = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null);
  const registry = useRef<FloatRegistry>(new Map());
  // Glides in progress: a later change of settings or visibility snaps them to the new rectangles.
  const glides = useRef<Animation[]>([]);
  const shown = useRef<{ grid: WidgetGrid; cycle: number; layout: string } | null>(null);
  const layoutKey = `${gridKey}|${enabledKey}`;
  useLayoutEffect(() => {
    const before = shown.current; shown.current = { grid, cycle: effectiveCycle, layout: layoutKey };
    if (!before || before.grid === grid) return;
    for (const animation of glides.current) animation.cancel();
    glides.current = [];
    const element = plane.current;
    if (!element || !glide || !swapping || before.layout !== layoutKey || before.cycle === effectiveCycle) return;
    // FLIP: the widgets already have their new left/top; each starts from an inverse translation and
    // glides to its new cell. All move together; their opacity dips (never below SWAP_DIM) are spread
    // over the middle of the glide in reading order, so the board never dims as a whole.
    const width = element.offsetWidth, height = element.offsetHeight, duration = glideSeconds(fadeSeconds) * 1000;
    const moving = widgetRevealOrder(grid, visible).filter(id => registry.current.has(id) && (before.grid.placements[id].column !== grid.placements[id].column || before.grid.placements[id].row !== grid.placements[id].row));
    moving.forEach((id, index) => {
      const from = getWidgetRect(before.grid, id), to = getWidgetRect(grid, id);
      const dx = (from.left - to.left) / 100 * width, dy = (from.top - to.top) / 100 * height;
      const animation = registry.current.get(id)!.section.animate(glideKeyframes(dx, dy, index, moving.length), { duration, easing: 'ease-in-out' });
      animation.id = 'lrd-glide';
      glides.current.push(animation);
    });
  }, [grid]);
  // Turning the glide off (reduced motion, Float gently off, Swap places off, Edit layout) snaps too.
  useEffect(() => {
    if (glide && swapping) return;
    for (const animation of glides.current) animation.cancel();
    glides.current = [];
  }, [glide, swapping]);
  useEffect(() => () => { for (const animation of glides.current) animation.cancel(); }, []);

  // #436 float, replacing #248's drift: one timer moves the plane (and each widget's content inside
  // its own slack) one device pixel at a time with `transform`/`translate` only, no CSS transition and
  // no layout, so the display draws a frame only when something moves. Without animation (Float gently
  // off, reduced motion) the same timer jumps to the next waypoint at each interval boundary instead.
  // The track's clock survives settings changes: a new interval keeps the current position.
  const size = useRef({ width: 0, height: 0 });
  const kick = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const element = root.current; if (!element) return;
    size.current = { width: element.clientWidth, height: element.clientHeight };
    const observer = new ResizeObserver(entries => {
      const box = entries.at(-1)?.contentRect; if (!box) return;
      if (box.width === size.current.width && box.height === size.current.height) return;
      size.current = { width: box.width, height: box.height }; kick.current?.();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const floatClock = useRef<{ start: number; interval: number } | null>(null);
  useLayoutEffect(() => {
    const element = plane.current; if (!element || layoutEditing || controlled) return;
    const interval = motionIntervalSeconds, at = performance.now(), clock = floatClock.current;
    if (!clock) floatClock.current = { start: at, interval };
    else if (clock.interval !== interval) floatClock.current = { start: at - (at - clock.start) * interval / clock.interval, interval };
    const start = floatClock.current!.start;
    let timer: number | undefined, planeAt: Point | null = null, jump = true;
    const tick = () => {
      window.clearTimeout(timer);
      const seconds = (performance.now() - start) / 1000, { width, height } = size.current, dpr = window.devicePixelRatio || 1;
      // Floating never moves anything more than one device pixel per step on either axis, even when a timer
      // fires late: it catches up a pixel at a time instead (a resize jumps once). A shrinking
      // widget's measured slack clamps its offset immediately before any ordinary step (#479).
      const toward = (from: number, to: number) => Math.abs(to - from) * dpr <= 1.001 ? to : snap(from + Math.sign(to - from) / dpr, dpr);
      const unit = floating ? floatPath(seconds, interval) : stepPath(seconds, interval);
      const planeTarget = { x: snap(unit.x * FLOAT_TRAVEL * width, dpr), y: snap(unit.y * FLOAT_TRAVEL * height, dpr) };
      const planeNext = planeAt && floating && !jump ? { x: toward(planeAt.x, planeTarget.x), y: toward(planeAt.y, planeTarget.y) } : planeTarget;
      if (!planeAt || planeNext.x !== planeAt.x || planeNext.y !== planeAt.y) { element.style.transform = `translate(${planeNext.x}px, ${planeNext.y}px)`; planeAt = planeNext; }
      let delay = floating ? nextStepDelay(seconds, interval, { x: FLOAT_TRAVEL * width * dpr, y: FLOAT_TRAVEL * height * dpr }) : nextBoundaryDelay(seconds, interval);
      if (planeNext.x !== planeTarget.x || planeNext.y !== planeTarget.y) delay = Math.min(delay, 1 / MAX_STEPS_PER_SECOND);
      for (const [id, entry] of registry.current) {
        const track = widgetTrack(WIDGET_IDS.indexOf(id)), range = floatRange(entry.slack, width, height, dpr);
        // Every widget starts where the user put it (offset 0): floating eases away from there one device
        // pixel at a time, and stepping makes its first jump at the first interval boundary.
        const target = widgetFloatTarget(seconds, interval, floating, track, range, entry.slack, dpr);
        if (range && (floating || seconds >= interval)) {
          const middle = { x: (range.lo.x + range.hi.x) / 2, y: (range.lo.y + range.hi.y) / 2 }, half = { x: (range.hi.x - range.lo.x) / 2, y: (range.hi.y - range.lo.y) / 2 };
          if (floating) delay = Math.min(delay, nextStepDelay(seconds, interval, { x: half.x * dpr, y: half.y * dpr, originX: middle.x * dpr, originY: middle.y * dpr }, track));
        }
        const fresh = entry.offset === null;
        const last = entry.offset ?? (floating ? { x: 0, y: 0 } : undefined);
        let offset = target;
        if (last && floating) {
          offset = { x: toward(last.x, target.x), y: toward(last.y, target.y) };
          if (offset.x !== target.x || offset.y !== target.y) delay = Math.min(delay, 1 / MAX_STEPS_PER_SECOND);
        }
        if (fresh || last!.x !== offset.x || last!.y !== offset.y) {
          entry.section.style.setProperty('--float-x', `${offset.x}px`);
          entry.section.style.setProperty('--float-y', `${offset.y}px`);
          if (floating) entry.section.style.willChange = 'translate';
          entry.offset = offset;
        }
      }
      jump = false;
      timer = window.setTimeout(tick, delay * 1000);
    };
    kick.current = () => { jump = true; tick(); };
    if (floating) element.style.willChange = 'transform';
    tick();
    return () => {
      window.clearTimeout(timer); kick.current = null;
      element.style.removeProperty('transform'); element.style.removeProperty('will-change');
      for (const entry of registry.current.values()) {
        entry.offset = null;
        for (const property of ['--float-x', '--float-y', 'will-change']) entry.section.style.removeProperty(property);
      }
    };
  }, [layoutEditing, floating, motionIntervalSeconds, controlled]);

  // #515: seek the runtime's paths and FLIP keyframes without starting its timers. The display's
  // one-pixel catch-up after a late timer/resize is intentionally not a second clock here.
  const previewAnimations = useRef<{ key: string; animations: Animation[] }>({ key: '', animations: [] });
  const previewLoops = useRef(new Map<Animation, { time: Animation['currentTime']; running: boolean }>());
  const applyPreview = useRef<() => void>(() => undefined);
  useLayoutEffect(() => {
    if (!controlled) return;
    const draw = () => {
      const element = plane.current; if (!element) return;
      for (const animation of previewLoops.current.keys()) {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        if (animation.playState === 'idle' || !target?.isConnected || !root.current?.contains(target)) previewLoops.current.delete(animation);
      }
      const { width, height } = size.current, dpr = window.devicePixelRatio || 1;
      const unit = floating ? floatPath(previewTime, motionIntervalSeconds) : stepPath(previewTime, motionIntervalSeconds);
      element.style.transform = `translate(${snap(unit.x * FLOAT_TRAVEL * width, dpr)}px, ${snap(unit.y * FLOAT_TRAVEL * height, dpr)}px)`;
      for (const [id, entry] of registry.current) {
        const range = floatRange(entry.slack, width, height, dpr), track = widgetTrack(WIDGET_IDS.indexOf(id));
        const offset = widgetFloatTarget(previewTime, motionIntervalSeconds, floating, track, range, entry.slack, dpr);
        entry.offset = offset;
        entry.section.style.setProperty('--float-x', `${offset.x}px`);
        entry.section.style.setProperty('--float-y', `${offset.y}px`);
      }
      const { transition, phase, duration, elapsed } = previewFrame;
      const before = previewBoard(Math.max(0, transition - 1)), after = previewBoard(transition);
      const moving = widgetRevealOrder(after, visible).filter(id => registry.current.has(id) && (before.placements[id].column !== after.placements[id].column || before.placements[id].row !== after.placements[id].row));
      const key = `${layoutKey}|${transition}|${phase}|${duration}|${element.offsetWidth}|${element.offsetHeight}|${moving.join(',')}`;
      if (previewAnimations.current.key !== key) {
        for (const animation of previewAnimations.current.animations) animation.cancel();
        const animations: Animation[] = [];
        if (phase !== 'still') moving.forEach((id, index) => {
          const from = getWidgetRect(before, id), to = getWidgetRect(after, id);
          const frames = phase === 'glide' ? glideKeyframes((from.left - to.left) / 100 * element.offsetWidth, (from.top - to.top) / 100 * element.offsetHeight, index, moving.length) : [
            { offset: 0, opacity: 1, easing: 'ease-in-out' }, { offset: 0.5, opacity: SWAP_DIM, easing: 'ease-in-out' }, { offset: 1, opacity: 1 },
          ];
          const animation = registry.current.get(id)!.section.animate(frames, { duration: duration * 1000, easing: phase === 'glide' ? 'ease-in-out' : 'linear', fill: 'both' });
          animation.id = 'lrd-preview'; animation.pause(); animations.push(animation);
        });
        previewAnimations.current = { key, animations };
      }
      for (const animation of previewAnimations.current.animations) animation.currentTime = elapsed * 1000;
      // Lively glyph loops use the same CSS animations, sampled by this clock. Information still
      // updates normally; its one-shot value transitions are not time-travelled or replayed.
      for (const animation of root.current?.getAnimations({ subtree: true }) ?? []) {
        if (animation.id === 'lrd-preview') continue;
        if (animation.effect?.getTiming().iterations === Infinity) {
          if (!previewLoops.current.has(animation)) previewLoops.current.set(animation, { time: animation.currentTime, running: animation.playState === 'running' });
          animation.pause(); animation.currentTime = previewTime * 1000;
        }
      }
    };
    applyPreview.current = draw; kick.current = draw; draw();
  }, [controlled, previewTime, grid, floating, glide, fadeSeconds, motionIntervalSeconds, layoutKey, visible.join(',')]);
  useLayoutEffect(() => {
    if (!controlled) return;
    // Font loading and fresh data may change available slack even while paused.
    const observer = new ResizeObserver(() => applyPreview.current());
    for (const entry of registry.current.values()) observer.observe(entry.section.firstElementChild!);
    const mutation = new MutationObserver(() => applyPreview.current());
    if (root.current) mutation.observe(root.current, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    return () => { observer.disconnect(); mutation.disconnect(); };
  }, [controlled, visible.join(',')]);
  useLayoutEffect(() => {
    if (!controlled) return;
    return () => {
      for (const animation of previewAnimations.current.animations) animation.cancel();
      // Return the borrowed CSS loops to their original clock and owner. A removed/replaced glyph
      // has cancelled its animation; never revive it while restoring the remaining mounted loops.
      for (const [animation, before] of previewLoops.current) {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        if (animation.playState === 'idle' || !target?.isConnected || !root.current?.contains(target)) continue;
        animation.currentTime = before.time;
        if (before.running) animation.play(); else animation.pause();
      }
      previewLoops.current.clear();
      previewAnimations.current = { key: '', animations: [] }; applyPreview.current = () => undefined; kick.current = null;
      plane.current?.style.removeProperty('transform');
      for (const entry of registry.current.values()) { entry.offset = null; entry.section.style.removeProperty('--float-x'); entry.section.style.removeProperty('--float-y'); }
    };
  }, [controlled]);

  const [reveal, setReveal] = useState<Reveal>({ epoch: 0, active: false });
  const [planeSettled, setPlaneSettled] = useState(false);
  const latest = useRef({ plan, replayPlan, visibleCount: visible.length });
  latest.current = { plan, replayPlan, visibleCount: visible.length };
  const revealTimer = useRef<number | undefined>(undefined), revealFrame = useRef<number | undefined>(undefined), revealActive = useRef(false);
  const stopReveal = useCallback(() => {
    window.clearTimeout(revealTimer.current); window.cancelAnimationFrame(revealFrame.current ?? 0);
    if (revealActive.current) { revealActive.current = false; setReveal(value => ({ ...value, active: false })); }
  }, []);
  const startReveal = useCallback((entrance: EntranceLevel, fadeSeconds: number) => {
    const restart = revealActive.current;
    stopReveal();
    if (entrance === 'none') return;
    const { totalMs } = revealTiming({ entrance }, fadeSeconds, latest.current.visibleCount);
    const begin = () => {
      revealActive.current = true;
      setReveal(value => ({ epoch: value.epoch + 1, active: true }));
      revealTimer.current = window.setTimeout(() => { revealActive.current = false; setReveal(value => ({ ...value, active: false })); }, totalMs);
    };
    // A reveal already in progress restarts from its first frame once its class is gone.
    if (restart) revealFrame.current = window.requestAnimationFrame(() => { revealFrame.current = window.requestAnimationFrame(begin); });
    else begin();
  }, [stopReveal]);
  useEffect(() => () => { window.clearTimeout(revealTimer.current); window.cancelAnimationFrame(revealFrame.current ?? 0); }, []);
  // Reveals start in layout effects, before paint, so widgets never flash at full opacity first.
  // The first display load is the only reveal on the display (#436: there is no black rest to end).
  useLayoutEffect(() => { setPlaneSettled(true); if (!controlled) startReveal(latest.current.plan.entrance, 0); }, [startReveal]);
  // Once an entrance ends, measure every widget's slack again at rest.
  useEffect(() => { if (!reveal.active) for (const entry of registry.current.values()) entry.measure(); }, [reveal.active]);
  const shownCycle = useRef(effectiveCycle);
  useLayoutEffect(() => {
    // Preview movement's numbered arrangements (Swap places on) switch at once; each still reveals.
    if (!controlled && shownCycle.current !== effectiveCycle && embedded && surface === 'display' && compositionOverride !== undefined) startReveal(latest.current.plan.entrance, 0);
    shownCycle.current = effectiveCycle;
  }, [effectiveCycle, embedded, surface, compositionOverride, startReveal]);
  const shownNonce = useRef(revealNonce);
  useLayoutEffect(() => {
    if (!controlled && shownNonce.current !== revealNonce && embedded) startReveal(latest.current.replayPlan.entrance, 0);
    shownNonce.current = revealNonce;
  }, [revealNonce, embedded, startReveal]);
  // Leaving a surface that may animate (Edit layout, reduced motion) ends any entrance at once.
  useLayoutEffect(() => { if (plan.entrance === 'none' && replayPlan.entrance === 'none') stopReveal(); }, [plan.entrance, replayPlan.entrance, stopReveal]);
  useLayoutEffect(() => { if (controlled) stopReveal(); }, [controlled, stopReveal]);
  const motion = useMemo<MotionState>(() => ({ plan, revealEpoch: reveal.epoch, revealing: reveal.active }), [plan, reveal.epoch, reveal.active]);
  const animation = plan.valueTransitions ? plan.level : 'off';

  // Follow daylight (#439): one value per minute at the weather location. The ambient page glides to
  // it (widgets.css); editor canvases follow the draft at once. Fixed renders `brightness` unchanged.
  const daylight = settings.appearance.daylightBrightness;
  const brightnessStep = daylightStep(now).getTime();
  const brightness = useMemo(() => effectiveBrightness(settings.appearance, settings.location, brightnessStep),
    [settings.appearance.brightness, daylight?.dimmest, daylight?.brightest, settings.location.latitude, settings.location.longitude, brightnessStep]);
  const ambientStyle = { '--ambient-accent': renderedAccent(settings.appearance.accentColor), '--ambient-text': settings.appearance.textColor, '--ambient-brightness': brightness, '--font-scale': settings.appearance.fontScale,
    ...(daylight && !embedded ? { '--brightness-transition': `${DAYLIGHT_TRANSITION_SECONDS}s` } : {}),
    ...toneVariables(settings.appearance) } as CSSProperties;
  // Editor polish: a released or invalid drag settles into its cell; a newly added widget drops in.
  const editingTransition = `left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease${plan.editorPolish ? ', transform 160ms var(--motion-ease), translate 240ms var(--motion-ease), opacity 240ms var(--motion-ease)' : ''}`;
  const dimTransition = dimMs > 0 ? `opacity ${dimMs}ms ease-in-out` : 'none';
  const Surface = embedded ? 'div' : 'main';
  return <Surface className={embedded ? 'preview-surface' : `display-page ${interacting ? 'interacting' : ''}`} onPointerMove={showControls}>
    <div
      ref={root}
      className={[
        'ambient',
        'grid-ambient',
        `composition-${effectiveCycle % 4}`,
        `font-${settings.appearance.fontFamily}`,
        !motionEnabled || reducedMotion || layoutEditing ? 'static' : '',
        layoutEditing ? 'layout-editing' : '',
        reducedMotion ? 'reduce-motion' : '',
      ].filter(Boolean).join(' ')}
      style={ambientStyle}
      data-composition={effectiveCycle}
      data-preview-seconds={controlled ? previewTime.toFixed(3) : undefined}
      data-accent-mode={settings.appearance.accentMode}
      data-brightness={daylight ? 'daylight' : 'fixed'}
      data-animation={animation}
      data-motion-surface={surface}
      data-float={layoutEditing ? undefined : floating ? 'float' : 'step'}
      data-swap={swapsAllowed ? (glide ? 'glide' : 'dim') : undefined}
      data-wake-lock={embedded ? undefined : wakeLock}
    >
      <MotionContext.Provider value={motion}>
        <div
          ref={plane}
          className={['ambient-content', 'widget-grid-plane', reveal.active ? 'revealing' : ''].filter(Boolean).join(' ')}
          data-reveal={reveal.active ? reveal.epoch : undefined}
          data-settled={planeSettled ? 'true' : undefined}
        >
          {WIDGET_IDS.map((id, index) => {
            const props: WidgetContentProps = { state, settings, size: settings.widgetGrid.placements[id].size, now, embedded, disconnected, photoPreview };
            if (!visible.includes(id)) return null;
            const rect = getWidgetRect(grid, id); const Renderer = WIDGET_RENDERERS[id];
            const activeGesture = gesture?.id === id ? gesture : null;
            return <Widget key={id} id={id} settings={settings} index={index} revealOrder={revealOrder.indexOf(id)} registry={registry.current} style={{
              left: `${rect.left}%`, top: `${rect.top}%`,
              width: activeGesture?.width === undefined ? `${rect.width}%` : `${activeGesture.width}px`,
              height: activeGesture?.height === undefined ? `${rect.height}%` : `${activeGesture.height}px`,
              transform: activeGesture ? `translate3d(${activeGesture.x}px, ${activeGesture.y}px, 0)` : undefined,
              transition: controlled ? 'none' : layoutEditing && !activeGesture && !reducedMotion ? editingTransition : dimTransition,
              opacity: dimmed.has(id) ? SWAP_DIM : undefined,
            }}><Renderer {...props} /></Widget>;
          })}
        </div>
      </MotionContext.Provider>
    </div>
    {!embedded && !native && <nav className="display-help" aria-label="Display controls">
      <button className="button display-control" onClick={toggleFullscreen}><Icon name="monitor" size={15} />Fullscreen · F</button>
      <a className="button display-control" href="/" onClick={event => { if (!opened && !liveOpener()) return; event.preventDefault(); leaveDisplay('/', opened); }}><Icon name="home" size={15} />Home · Esc</a>
      <a className="button display-control" href="/editor" onClick={event => { if (!opened && !liveOpener()) return; event.preventDefault(); leaveDisplay('/editor', opened); }}><Icon name="edit" size={15} />Edit display · E</a>
      {opened && <button className="button display-control display-close" onClick={() => leaveDisplay('/editor', opened)}><Icon name="close" size={15} />Close display</button>}
    </nav>}
  </Surface>;
}
