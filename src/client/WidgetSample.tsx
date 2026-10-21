import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { AppearanceSettings, AppState, WidgetId } from '../shared/contracts';
import { defaultSettings } from '../shared/defaults';
import { GRID_DENSITIES, WIDGET_CATALOG, widgetSpan, type GridDensity, type WidgetSize } from '../shared/widgets';
import { renderedAccent, toneVariables } from '../shared/palette';
import { WIDGET_MODULES, WIDGET_RENDERERS } from './widgets/registry';

// The catalog never previews private reminders, photo, city or desktop snapshot. Only the date and
// time are real (#361): the Clock, the Calendar's today and the Countdown's day counts follow this
// computer's clock, which carries nothing private.
const settings = defaultSettings();
settings.appearance.motionEnabled = false;
settings.widgetBehavior.reminders.hideWhenEmpty = false;
function sampleState(now: Date): AppState {
  return {
    settings,
    reminders: ['Water the plants', 'Pick up groceries', 'Call a friend', 'Take a walk'].map((text, index) => ({ id: `sample-${index}`, text, completed: false, dueAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString() })),
    weather: {
      status: 'fresh', updatedAt: now.toISOString(), error: null, source: 'Open-Meteo', sourceUrl: 'https://open-meteo.com/',
      location: { name: 'Sample City', latitude: 0, longitude: 0, timezone: 'UTC' },
      units: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' },
      current: { time: now.toISOString(), temperature: 14, feelsLike: 13, weatherCode: 2, isDay: true, windSpeed: 8 },
      daily: Array.from({ length: 7 }, (_, index) => ({ date: new Date(now.getTime() + index * 86400000).toISOString().slice(0, 10), weatherCode: index % 2 ? 3 : 0, temperatureMax: 17 + index % 3, temperatureMin: 9 + index % 2, precipitationProbability: index % 2 ? 30 : 10, precipitationAmount: index % 2 ? 2 : 0 })),
      hourly: Array.from({ length: 12 }, (_, index) => ({ intervalStart: new Date(now.getTime() + index * 3600000).toISOString(), intervalEnd: new Date(now.getTime() + (index + 1) * 3600000).toISOString(), precipitationProbability: [10, 20, 40, 60, 50, 30, 10, 5, 5, 0, 0, 0][index]!, precipitationAmount: index > 1 && index < 6 ? 0.5 : 0, rainAmount: index > 1 && index < 6 ? 0.5 : 0 })),
    },
    preview: { available: false, capturedAt: null, width: null, height: null },
    photo: { available: false, id: null, width: null, height: null, updatedAt: null },
  };
}
const landscape = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#789296"/><stop offset="1" stop-color="#ced6c6"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h480v360H0z"/><circle fill="#e0cfac" cx="360" cy="95" r="29"/><path fill="#586f69" d="m0 260 140-147 115 118 93-79 132 99v109H0z"/><path fill="#344f47" d="m0 309 142-92 134 67 120-60 84 59v77H0z"/></svg>');

/** The current time, refreshed at each minute so an open picker's Clock stays right. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => { setNow(new Date()); schedule(); }, 60_000 - (Date.now() % 60_000) + 50);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}

/**
 * The display's fit (Display.tsx `Widget`): content that the larger sample text makes overfull is
 * laid out proportionally wider and scaled down as a whole, so nothing is cut off.
 */
function useSampleFit(box: RefObject<HTMLElement | null>, content: RefObject<HTMLDivElement | null>, key: string): number {
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const area = box.current, body = content.current;
    if (!area || !body) return;
    const update = () => {
      const computed = getComputedStyle(area);
      const width = area.clientWidth - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight);
      const height = area.clientHeight - parseFloat(computed.paddingTop) - parseFloat(computed.paddingBottom);
      const fits = (scale: number) => { body.style.width = `${100 / scale}%`; return body.scrollHeight * scale <= height + 1 && body.scrollWidth * scale <= width + 1; };
      let next = 1;
      if (!fits(1)) { let low = 0.05, high = 1; for (let step = 0; step < 12; step++) { const middle = (low + high) / 2; if (fits(middle)) low = middle; else high = middle; } next = low; }
      body.style.width = `${100 / next}%`;
      setFit(next);
    };
    const resize = new ResizeObserver(update); resize.observe(area); resize.observe(body);
    update();
    return () => resize.disconnect();
  }, [key]);
  return fit;
}

/**
 * A very wide family (Forecast large, 8 × 2) would be too short to read at the stage width, so a
 * sample is at most this many times as wide as it is tall; the footprint map keeps its real shape.
 */
const MAX_SAMPLE_RATIO = 2.5;

/** The family's footprint on the board (#361): its cells on a small map of the current grid. */
function Footprint({ columns, rows, density }: { columns: number; rows: number; density: GridDensity }) {
  const grid = GRID_DENSITIES[density];
  return <div className="sample-footprint">
    <span className="footprint-map" style={{ '--board-columns': grid.columns, '--board-rows': grid.rows } as CSSProperties}>
      {Array.from({ length: grid.columns * grid.rows }, (_, index) => <i key={index} data-on={index % grid.columns < columns && Math.floor(index / grid.columns) < rows ? '' : undefined} />)}
    </span>
    <span>{columns} × {rows} cells of {grid.columns} × {grid.rows}</span>
  </div>;
}

/**
 * Actual renderers keep the family examples honest; all content is synthetic. `appearance`
 * supplies the draft's accent mode and colour; samples keep their own text colour and full brightness.
 * Each family fills the stage width (at most twice the canvas scale) with a 9 px text floor, and the
 * footprint map shows how much of the board it takes (#361).
 */
export function WidgetSample({ id, size, appearance = settings.appearance, density = 'balanced' }: { id: WidgetId; size: WidgetSize; appearance?: AppearanceSettings; density?: GridDensity }) {
  const Renderer = WIDGET_RENDERERS[id];
  const span = widgetSpan(id, size);
  const now = useMinute();
  // A widget may adjust the synthetic sample (new objects only, never private content).
  const prepared = useMemo(() => {
    const base = { state: sampleState(now), settings };
    return WIDGET_MODULES[id].sample?.(base) ?? base;
  }, [id, now]);
  const box = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const fit = useSampleFit(box, content, `${id}-${size}`);
  return <div className="sample-stage" aria-hidden="true">
    <div className="sample-area">
      <div
        className="picker-sample ambient grid-ambient static layout-editing font-sans"
        style={{ '--sample-columns': span.columns, '--sample-ratio': Math.min(span.columns / span.rows, MAX_SAMPLE_RATIO), '--ambient-accent': renderedAccent(appearance.accentColor), '--ambient-text': '#d0d3df', '--ambient-brightness': 1, '--font-scale': 1, ...toneVariables(appearance) } as CSSProperties}
        data-accent-mode={appearance.accentMode}
        data-animation="off"
      >
        <div ref={box} className={`ambient-widget ambient-${id} widget-size-${size} tone-${WIDGET_CATALOG[id].tone}`}>
          <div ref={content} className="widget-content" style={{ maxWidth: 'none', transform: `scale(${fit})`, transformOrigin: 'left center' }}><Renderer state={prepared.state} settings={prepared.settings} size={size} now={now} embedded disconnected={false} photoPreview={landscape} /></div>
        </div>
      </div>
    </div>
    <Footprint columns={span.columns} rows={span.rows} density={density} />
  </div>;
}
