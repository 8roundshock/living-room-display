import type { CSSProperties } from 'react';
import type { AppearanceSettings, AppState, WidgetId } from '../shared/contracts';
import { defaultSettings } from '../shared/defaults';
import { WIDGET_CATALOG, widgetSpan, type WidgetSize } from '../shared/widgets';
import { renderedAccent, toneVariables } from '../shared/palette';
import { WIDGET_MODULES, WIDGET_RENDERERS } from './widgets/registry';

// The catalog never previews private reminders, photo, city or desktop snapshot.
const now = new Date(2026, 9, 18, 9, 41);
const settings = defaultSettings();
settings.appearance.motionEnabled = false;
settings.widgetBehavior.reminders.hideWhenEmpty = false;
const sample: AppState = {
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
const landscape = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#789296"/><stop offset="1" stop-color="#ced6c6"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h480v360H0z"/><circle fill="#e0cfac" cx="360" cy="95" r="29"/><path fill="#586f69" d="m0 260 140-147 115 118 93-79 132 99v109H0z"/><path fill="#344f47" d="m0 309 142-92 134 67 120-60 84 59v77H0z"/></svg>');

/**
 * Actual renderers keep the family examples honest; all content is synthetic. `appearance`
 * supplies the draft's accent mode and colour; samples keep their own text colour and full brightness.
 */
export function WidgetSample({ id, size, appearance = settings.appearance }: { id: WidgetId; size: WidgetSize; appearance?: AppearanceSettings }) {
  const Renderer = WIDGET_RENDERERS[id];
  const span = widgetSpan(id, size);
  // A widget may adjust the synthetic sample (new objects only, never private content).
  const base = { state: sample, settings };
  const prepared = WIDGET_MODULES[id].sample?.(base) ?? base;
  return <div className="sample-stage" aria-hidden="true">
    <div
      className="picker-sample ambient grid-ambient static layout-editing font-sans"
      style={{ '--sample-columns': span.columns, '--sample-ratio': span.columns / span.rows, '--ambient-accent': renderedAccent(appearance.accentColor), '--ambient-text': '#d0d3df', '--ambient-brightness': 1, '--font-scale': 1, ...toneVariables(appearance) } as CSSProperties}
      data-accent-mode={appearance.accentMode}
      data-animation="off"
    >
      <div className={`ambient-widget ambient-${id} widget-size-${size} tone-${WIDGET_CATALOG[id].tone}`}>
        <div className="widget-content"><Renderer state={prepared.state} settings={prepared.settings} size={size} now={now} embedded disconnected={false} photoPreview={landscape} /></div>
      </div>
    </div>
  </div>;
}
