import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AppState, Settings, WidgetId } from '../shared/contracts.ts';
import { WIDGET_IDS, composeWidgetGrid, getWidgetRect, motionOffset } from '../shared/widgets.ts';
import { Icon } from './icons.tsx';
import { WIDGET_RENDERERS, widgetLabel, widgetVisible, type WidgetContentProps } from './widgets/registry.tsx';

export interface WidgetGesture { id: WidgetId; x: number; y: number; width?: number; height?: number }
function toggleFullscreen() {
  const request = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
  void request?.catch(() => undefined);
}

function Widget({ id, settings, children, index, style }: { id: WidgetId; settings: Settings; children: ReactNode; index: number; style: CSSProperties }) {
  const region = useRef<HTMLElement>(null); const content = useRef<HTMLDivElement>(null); const [fit, setFit] = useState(1); const current = useRef(1);
  useLayoutEffect(() => {
    const update = () => {
      const area = region.current, body = content.current; if (!area || !body) return;
      const computed = getComputedStyle(area);
      const width = area.clientWidth - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight);
      const height = area.clientHeight - parseFloat(computed.paddingTop) - parseFloat(computed.paddingBottom);
      // Overfull content is laid out proportionally wider before scaling, like zooming out, so a
      // larger Text size never wraps into extra lines that would render the text smaller.
      const fits = (scale: number) => { body.style.width = `${100 / scale}%`; return body.scrollHeight * scale <= height + 1 && body.scrollWidth * scale <= width + 1; };
      let next = 1;
      if (!fits(1)) {
        const prior = current.current;
        if (prior < 1 && fits(prior) && !fits(Math.min(1, prior + 0.002))) next = prior;
        else { let low = 0.05, high = 1; for (let step = 0; step < 12; step++) { const middle = (low + high) / 2; if (fits(middle)) low = middle; else high = middle; } next = low; }
      }
      if (Math.abs(current.current - next) < 0.002) next = current.current;
      body.style.width = `${100 / next}%`; current.current = next; setFit(next);
    };
    const observer = new ResizeObserver(update); if (region.current) observer.observe(region.current); if (content.current) observer.observe(content.current); update();
    return () => observer.disconnect();
  }, [settings.appearance.fontScale, settings.appearance.fontFamily, children]);
  const size = settings.widgetGrid.placements[id].size;
  return <section ref={region} className={`ambient-widget ambient-${id} widget-size-${size}`} style={{ ...style, '--widget-index': index } as CSSProperties} aria-label={widgetLabel(id)} data-widget-id={id} data-widget-size={size}>
    <div ref={content} className="widget-content" style={{ width: `${100 / fit}%`, maxWidth: 'none', transform: `scale(${fit})`, transformOrigin: 'left center' }}>{children}</div>
  </section>;
}

export function AmbientDisplay({ state, settings = state.settings, embedded = false, native = false, disconnected = false, compositionOverride, layoutEditing = false, photoPreview, gesture }: {
  state: AppState; settings?: Settings; embedded?: boolean; native?: boolean; disconnected?: boolean; compositionOverride?: number; layoutEditing?: boolean; photoPreview?: string | null; gesture?: WidgetGesture | null;
}) {
  const [now, setNow] = useState(() => new Date()); const [cycle, setCycle] = useState(0); const [fading, setFading] = useState(false); const [interacting, setInteracting] = useState(false);
  const interactionTimer = useRef<number | undefined>(undefined);
  const showControls = useCallback(() => {
    if (embedded || native) return;
    setInteracting(true);
    window.clearTimeout(interactionTimer.current);
    // Repeated pointer events need a fresh deadline even while the state is true.
    interactionTimer.current = window.setTimeout(() => { interactionTimer.current = undefined; setInteracting(false); }, 3500);
  }, [embedded, native]);
  useEffect(() => () => window.clearTimeout(interactionTimer.current), []);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setReducedMotion(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => {
    if (layoutEditing || compositionOverride !== undefined) { setFading(false); return; }
    let hide: number | undefined; let reveal: number | undefined;
    const timer = window.setInterval(() => {
      setFading(true);
      // Fully black rest separates compositions; reduced motion removes travel, never relocation.
      hide = window.setTimeout(() => { setCycle(value => value + 1); reveal = window.setTimeout(() => setFading(false), 1100); }, reducedMotion || !settings.appearance.motionEnabled ? 0 : settings.appearance.fadeSeconds * 1000);
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
      if (event.key === 'Escape' || event.key.toLowerCase() === 'e') window.location.assign('/editor');
      if (event.key === 'Tab') showControls();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [embedded, native, showControls]);
  const effectiveCycle = layoutEditing ? 0 : compositionOverride ?? cycle;
  const enabledKey = JSON.stringify([settings.widgets, settings.preview.enabled]);
  const gridKey = JSON.stringify(settings.widgetGrid);
  const enabled = useMemo(() => ({ ...settings.widgets, preview: settings.widgets.preview && settings.preview.enabled }), [enabledKey]);
  const previous = useRef(settings.widgetGrid);
  // Polling returns new object identities. Recompose only on a real layout change or black interval.
  const grid = useMemo(() => composeWidgetGrid(settings.widgetGrid, enabled, effectiveCycle, previous.current), [gridKey, enabled, effectiveCycle]);
  useEffect(() => { previous.current = grid; }, [grid]);
  const offset = motionOffset(effectiveCycle);
  const ambientStyle = { '--ambient-accent': settings.appearance.accentColor, '--ambient-text': settings.appearance.textColor, '--ambient-brightness': settings.appearance.brightness, '--font-scale': settings.appearance.fontScale,
    '--fade-duration': reducedMotion || !settings.appearance.motionEnabled ? '0s' : `${settings.appearance.fadeSeconds}s`, '--motion-x': `${offset.x}%`, '--motion-y': `${offset.y}%` } as CSSProperties;
  const Surface = embedded ? 'div' : 'main';
  return <Surface className={embedded ? 'preview-surface' : `display-page ${interacting ? 'interacting' : ''}`} onPointerMove={showControls}>
    <div className={`ambient grid-ambient composition-${effectiveCycle % 4} font-${settings.appearance.fontFamily} ${!settings.appearance.motionEnabled || reducedMotion || layoutEditing ? 'static' : ''} ${layoutEditing ? 'layout-editing' : ''} ${reducedMotion ? 'reduce-motion' : ''}`} style={ambientStyle} data-composition={effectiveCycle}>
      <div className={`ambient-content widget-grid-plane ${fading ? 'fading' : ''}`}>
        {WIDGET_IDS.map((id, index) => {
          const props: WidgetContentProps = { state, settings, size: settings.widgetGrid.placements[id].size, now, embedded, disconnected, photoPreview };
          if (!widgetVisible(id, props)) return null;
          const rect = getWidgetRect(grid, id); const Renderer = WIDGET_RENDERERS[id];
          const activeGesture = gesture?.id === id ? gesture : null;
          return <Widget key={id} id={id} settings={settings} index={index} style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: activeGesture?.width === undefined ? `${rect.width}%` : `${activeGesture.width}px`, height: activeGesture?.height === undefined ? `${rect.height}%` : `${activeGesture.height}px`, transform: activeGesture ? `translate3d(${activeGesture.x}px, ${activeGesture.y}px, 0)` : undefined, transition: layoutEditing && !activeGesture && !reducedMotion ? 'left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease' : 'none' }}><Renderer {...props} /></Widget>;
        })}
      </div>
    </div>
    {!embedded && !native && <nav className="display-help" aria-label="Display controls"><button className="button" onClick={toggleFullscreen}><Icon name="monitor" size={15} />Fullscreen · F</button><a className="button" href="/editor"><Icon name="settings" size={15} />Editor · Esc</a></nav>}
  </Surface>;
}
