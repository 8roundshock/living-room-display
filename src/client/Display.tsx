import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AppState, Settings, WidgetGrid, WidgetId } from '../shared/contracts.ts';
import { GRID_DENSITIES, WIDGET_CATALOG, WIDGET_IDS, composeWidgetGrid, getWidgetRect, motionOffset, placementSpan, widgetRevealOrder } from '../shared/widgets.ts';
import { DEFAULT_ANIMATION_LEVEL, MAX_REVEAL_STEPS, motionPlan, revealTiming, type EntranceLevel, type MotionSurface } from '../shared/motion.ts';
import { renderedAccent, toneVariables } from '../shared/palette.ts';
import { Icon } from './icons.tsx';
import { MotionContext, usePrefersReducedMotion, type MotionState } from './useMotion.ts';
import { WIDGET_RENDERERS, widgetLabel, widgetVisible, type WidgetContentProps } from './widgets/registry.tsx';

export interface WidgetGesture { id: WidgetId; x: number; y: number; width?: number; height?: number }
function toggleFullscreen() {
  const request = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
  void request?.catch(() => undefined);
}

function Widget({ id, settings, children, index, revealOrder, style }: { id: WidgetId; settings: Settings; children: ReactNode; index: number; revealOrder: number; style: CSSProperties }) {
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
  // `style`, which the observer ignores, so a refit never triggers another.
  useLayoutEffect(() => {
    const area = region.current, body = content.current; if (!area || !body) return;
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
    };
    refit.current = update;
    const resize = new ResizeObserver(update); resize.observe(area); resize.observe(body);
    const mutation = new MutationObserver(update); mutation.observe(body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    update();
    return () => { resize.disconnect(); mutation.disconnect(); refit.current = () => undefined; };
  }, []);
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
/** The relocation step in progress: the fade-out (`hiding`) or the black rest (`resting`), started at `at` (performance.now). */
interface Relocation { phase: 'idle' | 'hiding' | 'resting'; at: number; fadeMs: number }
/** The fully black rest between one arrangement's fade-out and the next one's reveal. */
const BLACK_REST_MS = 1100;

/** The drift of Drift and fade between moves (#248, `motionEnabled`): ±0.5% of the plane over 71 s each way, in 36 discrete steps. */
const DRIFT_SECONDS = 71, DRIFT_STEPS = 36;
/** The drift offset (percent of the plane) after `seconds`, and the seconds until its next step. */
function planeDrift(seconds: number): { offset: number; next: number } {
  const step = DRIFT_SECONDS / DRIFT_STEPS, index = Math.floor(seconds / step), position = index % (2 * DRIFT_STEPS);
  const level = position <= DRIFT_STEPS ? position : 2 * DRIFT_STEPS - position;
  return { offset: Number((level / DRIFT_STEPS - 0.5).toFixed(4)), next: (index + 1) * step - seconds };
}

export function AmbientDisplay({ state, settings = state.settings, embedded = false, native = false, disconnected = false, compositionOverride, layoutEditing = false, photoPreview, gesture, motionSurface = 'editing', revealNonce }: {
  state: AppState; settings?: Settings; embedded?: boolean; native?: boolean; disconnected?: boolean; compositionOverride?: number; layoutEditing?: boolean; photoPreview?: string | null; gesture?: WidgetGesture | null;
  /** Embedded canvases only: `editing` (the default) keeps widgets still; `preview` shows the draft Animation level. */
  motionSurface?: 'preview' | 'editing';
  /** Each new value replays the entrance once on an embedded canvas (for example after choosing a level). */
  revealNonce?: number;
}) {
  const [now, setNow] = useState(() => new Date()); const [cycle, setCycle] = useState(0); const [fading, setFading] = useState(false); const [interacting, setInteracting] = useState(false);
  // #174: true only while the arrangement is fully black (from the end of the fade-out to the reveal).
  const [black, setBlack] = useState(false);
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
  const relocation = useRef<Relocation>({ phase: 'idle', at: 0, fadeMs: 0 });
  useEffect(() => {
    if (layoutEditing || compositionOverride !== undefined) { relocation.current = { phase: 'idle', at: 0, fadeMs: 0 }; setFading(false); setBlack(false); return; }
    // Reduced motion removes travel and effects, never relocation: the arrangement still goes black.
    const fadeMs = reducedMotion || !settings.appearance.motionEnabled ? 0 : settings.appearance.fadeSeconds * 1000;
    let hide: number | undefined; let reveal: number | undefined;
    const rest = (ms: number) => { reveal = window.setTimeout(() => { relocation.current = { phase: 'idle', at: 0, fadeMs: 0 }; setFading(false); setBlack(false); }, ms); };
    // Fully black: the next composition replaces this one during the black rest.
    const darken = () => { relocation.current = { phase: 'resting', at: performance.now(), fadeMs: 0 }; setCycle(value => value + 1); setBlack(true); rest(BLACK_REST_MS); };
    // #357: a settings or preference change that re-runs this effect during a fade-out or the black rest
    // finishes that step instead of abandoning it on black until the next interval. The fade-out already
    // running keeps its duration (a fade that is now off has jumped to black), so the composition still
    // changes only while black, and the reveal follows the rest as usual.
    const step = relocation.current;
    if (step.phase === 'hiding') hide = window.setTimeout(darken, fadeMs === 0 ? 0 : Math.max(0, step.at + step.fadeMs - performance.now()));
    else if (step.phase === 'resting') rest(Math.max(0, step.at + BLACK_REST_MS - performance.now()));
    const timer = window.setInterval(() => {
      relocation.current = { phase: 'hiding', at: performance.now(), fadeMs };
      setFading(true); hide = window.setTimeout(darken, fadeMs);
    }, settings.appearance.motionIntervalSeconds * 1000);
    return () => { window.clearInterval(timer); window.clearTimeout(hide); window.clearTimeout(reveal); };
  }, [settings.appearance.motionEnabled, settings.appearance.motionIntervalSeconds, settings.appearance.fadeSeconds, layoutEditing, compositionOverride, reducedMotion]);
  useEffect(() => {
    if (embedded || native) return;
    const key = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFullscreen(); showControls(); }
      // #438: Esc goes Home and E to Edit display (#436's close-on-Esc for an editor-opened display wins where it applies).
      if (event.key === 'Escape') window.location.assign('/');
      if (event.key.toLowerCase() === 'e') window.location.assign('/editor');
      if (event.key === 'Tab') showControls();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [embedded, native, showControls]);
  const effectiveCycle = layoutEditing ? 0 : compositionOverride ?? cycle;
  const enabledKey = JSON.stringify([settings.widgets, settings.preview.enabled]);
  const gridKey = JSON.stringify(settings.widgetGrid);
  const enabled = useMemo(() => ({ ...settings.widgets, preview: settings.widgets.preview && settings.preview.enabled }), [enabledKey]);
  // The two latest compositions: the next one moves away from the first and avoids recreating the second (#317).
  const previous = useRef(settings.widgetGrid), earlier = useRef<WidgetGrid | null>(null);
  // Polling returns new object identities. Recompose only on a real layout change or black interval.
  const grid = useMemo(() => composeWidgetGrid(settings.widgetGrid, enabled, effectiveCycle, previous.current, earlier.current ? [earlier.current] : []), [gridKey, enabled, effectiveCycle]);
  useEffect(() => { if (previous.current !== grid) { earlier.current = previous.current; previous.current = grid; } }, [grid]);
  const offset = motionOffset(effectiveCycle);
  // The drift of Drift and fade between moves (#248): a timer moves the whole plane one step about every
  // 2 s (about one device pixel across a 4K panel) with no transition, so nothing animates and the display
  // draws a frame only when the plane moves. A CSS animation, even with steps(), keeps the compositor
  // ticking every frame. The plane's own transform rule (the composition offset) applies when it is still,
  // and the drift starts from its midpoint, that same position, so starting never jumps. Stopping (Drift and
  // fade off, reduced motion, Edit layout) removes the inline transform at once, so the plane can shift by
  // up to ±0.5% of its size in one frame, as the earlier CSS animation did.
  const plane = useRef<HTMLDivElement>(null);
  const drifting = settings.appearance.motionEnabled && !reducedMotion && !layoutEditing;
  useLayoutEffect(() => {
    const element = plane.current; if (!element || !drifting) return;
    const started = performance.now() - (DRIFT_STEPS / 2 + 0.5) * (DRIFT_SECONDS / DRIFT_STEPS) * 1000; let timer: number | undefined;
    const step = () => {
      const { offset: drift, next } = planeDrift((performance.now() - started) / 1000);
      element.style.transform = `translate(calc(var(--motion-x, 0%) + ${drift}%), calc(var(--motion-y, 0%) + ${drift}%))`;
      timer = window.setTimeout(step, Math.max(50, next * 1000));
    };
    element.style.willChange = 'transform'; step();
    return () => { window.clearTimeout(timer); element.style.removeProperty('transform'); element.style.removeProperty('will-change'); };
  }, [drifting]);

  // Motion levels (#76). The ambient page and the editor's Preview movement behave as the display;
  // the authored canvas shows the draft level; Edit layout keeps widgets still.
  const surface: MotionSurface = !embedded ? 'display' : motionSurface === 'editing' ? 'canvas-editing' : layoutEditing ? 'canvas' : 'display';
  const motionInput = { level: settings.appearance.animation ?? DEFAULT_ANIMATION_LEVEL, reducedMotion, softMotion: settings.appearance.motionEnabled, fadeSeconds: settings.appearance.fadeSeconds, surface };
  const plan = useMemo(() => motionPlan(motionInput), [motionInput.level, reducedMotion, motionInput.softMotion, motionInput.fadeSeconds, surface]);
  const replayPlan = useMemo(() => motionPlan({ ...motionInput, replay: true }), [motionInput.level, reducedMotion, motionInput.softMotion, motionInput.fadeSeconds, surface]);
  const visible = WIDGET_IDS.filter(id => widgetVisible(id, { state, settings, size: settings.widgetGrid.placements[id].size, now, embedded, disconnected, photoPreview }));
  const revealOrder = widgetRevealOrder(grid, visible);
  const [reveal, setReveal] = useState<Reveal>({ epoch: 0, active: false });
  const [planeSettled, setPlaneSettled] = useState(false);
  const latest = useRef({ plan, replayPlan, visibleCount: visible.length, fadeSeconds: settings.appearance.fadeSeconds, fadeIn: !reducedMotion && settings.appearance.motionEnabled });
  latest.current = { plan, replayPlan, visibleCount: visible.length, fadeSeconds: settings.appearance.fadeSeconds, fadeIn: !reducedMotion && settings.appearance.motionEnabled };
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
  // The first display load counts as a reveal.
  useLayoutEffect(() => { setPlaneSettled(true); startReveal(latest.current.plan.entrance, 0); }, [startReveal]);
  const wasFading = useRef(false);
  useLayoutEffect(() => {
    // The new arrangement fades in from black: its widgets settle in during that fade.
    if (wasFading.current && !fading) startReveal(latest.current.plan.entrance, latest.current.fadeIn ? latest.current.fadeSeconds : 0);
    // Fading out never overlaps an entrance.
    if (fading) stopReveal();
    wasFading.current = fading;
  }, [fading, startReveal, stopReveal]);
  const shownCycle = useRef(effectiveCycle);
  useLayoutEffect(() => {
    // Preview movement's numbered arrangements switch without a black rest; each still reveals.
    if (shownCycle.current !== effectiveCycle && embedded && surface === 'display' && compositionOverride !== undefined) startReveal(latest.current.plan.entrance, 0);
    shownCycle.current = effectiveCycle;
  }, [effectiveCycle, embedded, surface, compositionOverride, startReveal]);
  const shownNonce = useRef(revealNonce);
  useLayoutEffect(() => {
    if (shownNonce.current !== revealNonce && embedded) startReveal(latest.current.replayPlan.entrance, 0);
    shownNonce.current = revealNonce;
  }, [revealNonce, embedded, startReveal]);
  // Leaving a surface that may animate (Edit layout, reduced motion) ends any entrance at once.
  useLayoutEffect(() => { if (plan.entrance === 'none' && replayPlan.entrance === 'none') stopReveal(); }, [plan.entrance, replayPlan.entrance, stopReveal]);
  const motion = useMemo<MotionState>(() => ({ plan, revealEpoch: reveal.epoch, revealing: reveal.active, resting: fading, black }), [plan, reveal.epoch, reveal.active, fading, black]);
  const animation = plan.valueTransitions ? plan.level : 'off';

  const ambientStyle = { '--ambient-accent': renderedAccent(settings.appearance.accentColor), '--ambient-text': settings.appearance.textColor, '--ambient-brightness': settings.appearance.brightness, '--font-scale': settings.appearance.fontScale,
    ...toneVariables(settings.appearance),
    '--fade-duration': reducedMotion || !settings.appearance.motionEnabled ? '0s' : `${settings.appearance.fadeSeconds}s`, '--motion-x': `${offset.x}%`, '--motion-y': `${offset.y}%` } as CSSProperties;
  // Editor polish: a released or invalid drag settles into its cell; a newly added widget drops in.
  const editingTransition = `left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease${plan.editorPolish ? ', transform 160ms var(--motion-ease), translate 240ms var(--motion-ease), opacity 240ms var(--motion-ease)' : ''}`;
  const Surface = embedded ? 'div' : 'main';
  return <Surface className={embedded ? 'preview-surface' : `display-page ${interacting ? 'interacting' : ''}`} onPointerMove={showControls}>
    <div
      className={[
        'ambient',
        'grid-ambient',
        `composition-${effectiveCycle % 4}`,
        `font-${settings.appearance.fontFamily}`,
        !settings.appearance.motionEnabled || reducedMotion || layoutEditing ? 'static' : '',
        layoutEditing ? 'layout-editing' : '',
        reducedMotion ? 'reduce-motion' : '',
      ].filter(Boolean).join(' ')}
      style={ambientStyle}
      data-composition={effectiveCycle}
      data-accent-mode={settings.appearance.accentMode}
      data-animation={animation}
      data-motion-surface={surface}
    >
      <MotionContext.Provider value={motion}>
        <div
          ref={plane}
          className={['ambient-content', 'widget-grid-plane', fading ? 'fading' : '', reveal.active ? 'revealing' : ''].filter(Boolean).join(' ')}
          data-reveal={reveal.active ? reveal.epoch : undefined}
          data-settled={planeSettled ? 'true' : undefined}
        >
          {WIDGET_IDS.map((id, index) => {
            const props: WidgetContentProps = { state, settings, size: settings.widgetGrid.placements[id].size, now, embedded, disconnected, photoPreview };
            if (!visible.includes(id)) return null;
            const rect = getWidgetRect(grid, id); const Renderer = WIDGET_RENDERERS[id];
            const activeGesture = gesture?.id === id ? gesture : null;
            return <Widget key={id} id={id} settings={settings} index={index} revealOrder={revealOrder.indexOf(id)} style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: activeGesture?.width === undefined ? `${rect.width}%` : `${activeGesture.width}px`, height: activeGesture?.height === undefined ? `${rect.height}%` : `${activeGesture.height}px`, transform: activeGesture ? `translate3d(${activeGesture.x}px, ${activeGesture.y}px, 0)` : undefined, transition: layoutEditing && !activeGesture && !reducedMotion ? editingTransition : 'none' }}><Renderer {...props} /></Widget>;
          })}
        </div>
      </MotionContext.Provider>
    </div>
    {!embedded && !native && <nav className="display-help" aria-label="Display controls"><button className="button display-control" onClick={toggleFullscreen}><Icon name="monitor" size={15} />Fullscreen · F</button><a className="button display-control" href="/"><Icon name="home" size={15} />Home · Esc</a><a className="button display-control" href="/editor"><Icon name="edit" size={15} />Edit display · E</a></nav>}
  </Surface>;
}
