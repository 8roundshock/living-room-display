import { useEffect, useMemo, useRef } from 'react';
import type { AlertsState, AppState, DynamicSources, RainInterval, Settings } from '../../shared/contracts.ts';
import { needsAlerts } from '../../shared/widgets.ts';
import {
  DYNAMIC_ROWS_MAX, chooseDynamic, dynamicSignals, dynamicSummary, memoizeDynamicSignals, rotationSlot,
  type DynamicCard, type DynamicChoice, type DynamicGlyph, type DynamicInput, type DynamicPhrase, type DynamicPrevious, type DynamicSignals,
} from '../dynamic.ts';
import { ageLabel } from '../format.ts';
import { Icon } from '../icons.tsx';
import { weatherAttributionWidget } from '../model.ts';
import { atNaturalWidth, fittingCount, layoutExtent, useMeasured } from './measure.ts';
import { MoonGlyph } from './SunMoon.tsx';
import { WeatherGlyph } from './WeatherGlyph.tsx';
import type { WidgetContentProps, WidgetModule, WidgetSettingsProps } from './types.ts';
import './dynamic.css';

/**
 * Dynamic (#437): what matters now (an official warning, a storm or rain starting soon, a reminder due
 * within the hour), otherwise one calm card per wall-clock minute. The engine in ../dynamic.ts ranks;
 * this renders one card at a time. Urgency is carried by words, rank and size, never by added light:
 * no fills, frames, glow or loops, and no audio or live region. A new card is a new element (a React
 * key), so two cards never share the box; it fades in with the value-change fade at Subtle and Lively.
 */

const OFF_ALERTS: AlertsState = { status: 'off', provider: null, source: null, sourceUrl: null, area: null, checkedAt: null, error: null, alerts: [] };
const MINUTE = 60_000;

function signalsInput(state: AppState, settings: Settings, now: number, disconnected: boolean): DynamicInput {
  return {
    weather: state.weather, airQuality: state.airQuality, alerts: state.alerts ?? OFF_ALERTS, reminders: state.reminders,
    countdowns: settings.widgetData.countdowns, sources: settings.widgetData.dynamic, onBoard: settings.widgets,
    clockFormat: settings.clockFormat, airScale: settings.widgetData.airQuality.scale, now, disconnected,
  };
}

/** Shared by `visible`, which the display asks every second: it computes once per minute and data change. */
const visibleSignals = memoizeDynamicSignals();

function Glyph({ glyph, still }: { glyph: DynamicGlyph; still: boolean }) {
  // Never the hero glyph (no loops), and still while the data is saved or the display is offline.
  if (glyph.kind === 'weather') return <WeatherGlyph code={glyph.code} isDay={glyph.isDay} still={still} size={null} className="dynamic-glyph" />;
  if (glyph.kind === 'moon') return <MoonGlyph moon={glyph.phase} southern={glyph.southern} className="dynamic-glyph" />;
  return <Icon name={glyph.name} size={null} className="dynamic-glyph" data-glyph={glyph.glyph} />;
}

/** Footer phrases that never break inside; the small family keeps one. */
function footerPhrases(lead: DynamicCard | null, signals: DynamicSignals, size: WidgetContentProps['size'], credit: boolean): ({ kind: 'provenance' | 'age' | 'status' | 'credit' } & DynamicPhrase)[] {
  const own = lead?.source;
  // A status about the lead's own source is already said by its age; "Offline" too, when the age says it.
  const statuses = signals.statuses.filter(status => status.source !== own && !(status.source === 'connection' && /offline/i.test(lead?.age?.text ?? ''))
    && (size === 'large' || !status.largeOnly));
  if (size === 'small') {
    if (lead?.age?.caution) return [{ kind: 'age', ...lead.age }];
    const ranked = statuses.filter(status => status.smallRank !== null);
    if (ranked.length) return [{ kind: 'status', text: ranked[0]!.text, caution: ranked[0]!.caution }];
    const provenance = lead?.provenanceShort ?? lead?.provenance;
    return provenance ? [{ kind: 'provenance', text: provenance, caution: false }] : [];
  }
  return [
    ...(lead?.provenance ? [{ kind: 'provenance' as const, text: lead.provenance, caution: false }] : []),
    ...(lead?.age ? [{ kind: 'age' as const, ...lead.age }] : []),
    ...statuses.map(status => ({ kind: 'status' as const, text: status.text, caution: status.caution })),
    ...(credit ? [{ kind: 'credit' as const, text: 'Forecast by Open-Meteo', caution: false }] : []),
  ];
}

/** One run of phrases joined by " · " that wraps only between phrases, so "2 hr ago" or "Open-Meteo" never breaks (#221). */
function Footer({ phrases }: { phrases: ReturnType<typeof footerPhrases> }) {
  if (!phrases.length) return null;
  return <p className="dynamic-footer">{phrases.map((phrase, index) => <span key={`${phrase.kind}-${index}`}>{index > 0 && ' · '}<span
    className={[`dynamic-${phrase.kind}`, phrase.caution ? 'status-caution' : ''].filter(Boolean).join(' ')}>{phrase.text}</span></span>)}</p>;
}

/**
 * The large family's rows: as many whole rows as the fixed 100cqh body holds, measured from layout boxes
 * like the large Countdown (#216, #221), then an exact "+N more" for the warning, focus and notable cards
 * left out. Rows that do not fit take no layout outside measuring.
 */
function measureRows(body: HTMLElement, total: number, more: (shown: number) => number): number | null {
  const rows = [...body.querySelectorAll<HTMLElement>('.dynamic-also > li')];
  if (!rows.length) return null;
  body.setAttribute('data-measuring', '');
  try {
    return atNaturalWidth(body, () => {
      const footer = layoutExtent(body.querySelector('.dynamic-footer'));
      const probe = layoutExtent(body.querySelector('.dynamic-also-probe'));
      return fittingCount(body, rows, count => footer + (more(count) > 0 ? probe : 0));
    });
  } finally { body.removeAttribute('data-measuring'); }
}

function Kicker({ card, choice, size }: { card: DynamicCard; choice: DynamicChoice; size: WidgetContentProps['size'] }) {
  const more = choice.position ? `${choice.position.index + 1} of ${choice.position.count}`
    : size !== 'large' && choice.more > 0 ? `+${choice.more} more` : null;
  return <div className="ambient-label dynamic-source">
    {card.official && <Icon name="alert" size={null} />}
    <span className={card.kickerCaution ? 'dynamic-kicker status-caution' : 'dynamic-kicker'}>{card.kicker}</span>
    {more && <span className="dynamic-more">{`· ${more}`}</span>}
  </div>;
}

function CardView({ card, choice, signals, size, still, credit, swapped, settings }: { card: DynamicCard; choice: DynamicChoice; signals: DynamicSignals; size: WidgetContentProps['size']; still: boolean; credit: boolean; swapped: boolean; settings: Settings }) {
  const body = useRef<HTMLDivElement>(null);
  const large = size === 'large', rows = large ? choice.also : [];
  // "+N more" counts warning, focus and notable cards only; calm filler is never "more".
  const counted = Math.min(rows.length, choice.more);
  const leftOver = (shown: number) => Math.max(0, choice.more - Math.min(shown, counted));
  const phrases = footerPhrases(card, signals, size, credit);
  const key = JSON.stringify([card.id, card.headline, card.detail, rows.map(row => [row.id, row.compact, row.time]), phrases.map(phrase => phrase.text), settings.appearance.fontScale, settings.appearance.fontFamily]);
  const fit = useMeasured(body, key, element => large ? measureRows(element, rows.length, leftOver) : null, rows.length);
  const shown = Math.min(fit, rows.length), hidden = leftOver(shown);
  const value = card.value !== null ? <span className="dynamic-value">{card.value}</span> : card.glyph ? <Glyph glyph={card.glyph} still={still} /> : null;
  const detailText = size === 'small' ? card.detailCompact ?? card.detail : card.detail;
  const detail = detailText || card.detailFlag ? <p className="dynamic-detail">{card.detailFlag && <><span className="dynamic-flag status-caution">{card.detailFlag}</span>{detailText ? ' · ' : ''}</>}{detailText}</p> : null;
  return <div ref={body} className={['dynamic-card', `tone-${card.tone}`, large && rows.length ? 'dynamic-with-rows' : ''].filter(Boolean).join(' ')} data-swapped={swapped ? '' : undefined}>
    <Kicker card={card} choice={choice} size={size} />
    <div className={value ? 'dynamic-main' : 'dynamic-main dynamic-text-only'}>
      {value && <div className="dynamic-lead">{value}</div>}
      <div className="dynamic-copy">
        <p className="dynamic-headline">{size === 'small' ? card.compact : card.headline}</p>
        {detail}
      </div>
    </div>
    {large && rows.length > 0 && <>
      <ul className="dynamic-also">{rows.map((row, index) => <li key={row.id} className={index >= shown ? 'dynamic-overflow' : undefined}>
        <span className={row.kickerCaution ? 'dynamic-also-source status-caution' : 'dynamic-also-source'}>{row.kicker}</span>
        <span className="dynamic-also-headline">{row.compact}</span>
        {row.time && <span className="dynamic-also-time">{row.time}</span>}
      </li>)}</ul>
      {hidden > 0 && <p className="dynamic-also-more">+{hidden} more</p>}
      <p className="dynamic-also-probe" aria-hidden="true">+{choice.more} more</p>
    </>}
    <Footer phrases={phrases} />
  </div>;
}

function Dynamic({ state, settings, size, now, embedded, disconnected }: WidgetContentProps) {
  const minute = Math.floor(now.getTime() / MINUTE) * MINUTE;
  // Everything that formats a time is rebuilt once per minute and data change (#99, #185).
  const signals = useMemo(() => dynamicSignals(signalsInput(state, settings, minute, disconnected)),
    [state.weather, state.airQuality, state.alerts, state.reminders, settings.widgetData.countdowns, settings.widgetData.dynamic, settings.widgets, settings.clockFormat, settings.widgetData.airQuality.scale, minute, disconnected]);
  const slot = rotationSlot(now.getTime(), embedded);
  const previous = useRef<DynamicPrevious | null>(null);
  const choice = chooseDynamic(signals, slot, previous.current, size === 'large' ? DYNAMIC_ROWS_MAX : 2);
  previous.current = choice.lead ? { slot, id: choice.lead.id } : null;
  // The first card after mounting never animates; every later card fades in (Subtle and Lively only).
  const first = useRef<string | null | undefined>(undefined), swapped = useRef(false);
  if (first.current === undefined) first.current = choice.lead?.id ?? null;
  else if ((choice.lead?.id ?? null) !== first.current) swapped.current = true;
  const lead = choice.lead;
  const attributes = { 'data-dynamic-mode': choice.mode, 'data-dynamic-kind': lead?.kind ?? choice.mode, 'data-dynamic-id': lead?.id ?? '', 'data-dynamic-source': lead?.source ?? '' };
  if (!lead) {
    if (choice.mode === 'empty') return embedded ? <div className="widget-body image-placeholder dynamic-placeholder" {...attributes}>
      <Icon name="sparkles" size={null} />
      <div className="ambient-label">Dynamic</div>
      <div className="ambient-description"><span className="dynamic-phrase">Nothing to show yet</span> · <span className="dynamic-phrase">Turn on Sun & moon or Weather for a calm rotation</span></div>
    </div> : null;
    // Unavailable: say which source failed instead of implying there is nothing to know.
    const [headline, ...rest] = signals.statuses.filter(status => size === 'large' || !status.largeOnly);
    return <div className="widget-body dynamic-body" {...attributes}>
      <div className="dynamic-card tone-sky">
        <div className="ambient-label dynamic-source"><Icon name="sparkles" size={null} /><span className="dynamic-kicker">Dynamic</span></div>
        <div className="dynamic-main dynamic-text-only"><div className="dynamic-copy"><p className={headline?.caution ? 'dynamic-headline status-caution' : 'dynamic-headline'}>{headline?.text ?? 'Nothing to show'}</p></div></div>
        {size !== 'small' && rest.length > 0 && <div className="dynamic-footer">{rest.map((status, index) => <span key={index} className={status.caution ? 'dynamic-status status-caution' : 'dynamic-status'}>{status.text}</span>)}</div>}
      </div>
    </div>;
  }
  // Retained or unavailable forecasts never animate their glyph (#76).
  const still = disconnected || state.weather.status !== 'fresh';
  const credit = weatherAttributionWidget(settings) === 'dynamic' && (lead.source === 'weather' || (size === 'large' && choice.also.some(row => row.source === 'weather')));
  return <div className={`widget-body dynamic-body dynamic-mode-${choice.mode}`} {...attributes}>
    <CardView key={lead.id} card={lead} choice={choice} signals={signals} size={size} still={still} credit={credit} swapped={swapped.current} settings={settings} />
  </div>;
}

// ---- Editor --------------------------------------------------------------------------------------------

const SOURCES: { key: keyof DynamicSources; label: string; hint: string }[] = [
  { key: 'weather', label: 'Weather', hint: 'Rain timing, storms, snow, heat, cold and wind' },
  { key: 'alerts', label: 'Official weather alerts', hint: 'Environment Canada or the US National Weather Service. Data Source: Environment and Climate Change Canada.' },
  { key: 'air', label: 'Air & UV', hint: 'Air quality and UV index · model estimate' },
  { key: 'sky', label: 'Sun & moon', hint: 'Sunrise, sunset and the full moon' },
  { key: 'personal', label: 'Reminders & countdowns', hint: 'Shows their titles on the display' },
];
export const DYNAMIC_DRAFT_PROBLEM = 'Dynamic needs at least one thing to show';
const anySource = (sources: DynamicSources) => Object.values(sources).some(Boolean);

/** The alerts line under the toggle, from the saved state (an unsaved change is checked after Save, #455). */
export function alertsStatusLine(draft: Settings, saved: Settings | undefined, alerts: AlertsState | undefined, now: number): string {
  const place = draft.location.name;
  const defaultPlace = draft.locationSource === 'fallback' ? ' (default location — choose your city in Weather)' : '';
  const savedLocation = saved && JSON.stringify(saved.location) === JSON.stringify(draft.location);
  if (!saved || !needsAlerts(saved) || !savedLocation || !alerts || alerts.status === 'off') return `Alerts are checked after you save.${defaultPlace}`;
  if (alerts.status === 'unsupported') return `Not available for ${place}: Canada and the US only.${defaultPlace}`;
  if (alerts.status !== 'fresh') return `Couldn't check alerts. Trying again.${defaultPlace}`;
  const count = alerts.alerts.length, ago = ageLabel(alerts.checkedAt, now).replace(/^Updated /, '');
  return `Covers ${alerts.area ?? place} · ${count ? `${count} in effect` : 'no alerts now'} · checked ${ago}${defaultPlace}`;
}

function DynamicSettings({ settings, onChange, saving, state, saved }: WidgetSettingsProps) {
  const sources = settings.widgetData.dynamic;
  const set = (key: keyof DynamicSources, value: boolean) => onChange(previous => ({ ...previous, widgetData: { ...previous.widgetData, dynamic: { ...previous.widgetData.dynamic, [key]: value } } }));
  // Closing the panel with every source off would leave Save blocked by a choice nobody can see:
  // the sources go back to the saved ones (or all on).
  const latest = useRef({ settings, onChange, saved });
  latest.current = { settings, onChange, saved };
  useEffect(() => () => {
    const { settings: last, onChange: change, saved: baseline } = latest.current;
    if (anySource(last.widgetData.dynamic)) return;
    change(previous => anySource(previous.widgetData.dynamic) ? previous
      : { ...previous, widgetData: { ...previous.widgetData, dynamic: baseline && anySource(baseline.widgetData.dynamic) ? { ...baseline.widgetData.dynamic } : { weather: true, alerts: true, air: true, sky: true, personal: true } } });
  }, []);
  const now = Date.now();
  const summary = useMemo(() => {
    if (!state || !anySource(sources)) return null;
    const signals = dynamicSignals(signalsInput(state, settings, now - now % MINUTE, false));
    // Slot 0, as the canvas shows it.
    return dynamicSummary(chooseDynamic(signals, 0, null, 2));
  }, [state, settings, Math.floor(now / MINUTE)]);
  return <>
    <fieldset className="dynamic-sources">
      <legend className="field-label">Show</legend>
      {SOURCES.map(source => <div key={source.key} className="dynamic-source-option">
        <label className="toggle-row">
          <span>{source.label}</span>
          <input className="toggle" type="checkbox" checked={sources[source.key]} disabled={saving} aria-describedby={`dynamic-${source.key}-hint`} onChange={event => set(source.key, event.target.checked)} />
        </label>
        <p className="hint dynamic-source-hint" id={`dynamic-${source.key}-hint`}>{source.hint}</p>
        {source.key === 'alerts' && sources.alerts && <p className="hint dynamic-alerts-status">{alertsStatusLine(settings, saved, state?.alerts, now)}</p>}
      </div>)}
    </fieldset>
    <p className="hint">Stays on what matters most, such as an official warning, a storm or rain starting soon, and otherwise shows one calm card each minute. Uses your weather location ({settings.location.name}). Forecasts and model estimates are not official warnings.</p>
    {summary && <p className="hint dynamic-summary">{summary}</p>}
  </>;
}

const HOUR = 3_600_000;
/** Hour-aligned synthetic rain starting within two hours (as the Weather sample), at a synthetic place. */
const SAMPLE_CHANCE = [10, 15, 40, 65, 70, 50, 25, 10, 5, 5, 0, 0, 0];
const SAMPLE_RAIN = [0, 0, 0.6, 1.4, 1.2, 0.4, 0, 0, 0, 0, 0, 0, 0];

export const DynamicWidget: WidgetModule = {
  Renderer: Dynamic,
  visible: props => props.embedded || chooseDynamic(visibleSignals(signalsInput(props.state, props.settings, props.now.getTime(), props.disconnected)), 0, null, 0).mode !== 'empty',
  Settings: DynamicSettings,
  draftProblem: settings => anySource(settings.widgetData.dynamic) ? null : DYNAMIC_DRAFT_PROBLEM,
  // Synthetic only: rain soon, the sun and the moon. Never an official alert, a reminder or a countdown.
  sample: ({ state, settings }) => {
    const reference = Date.parse(state.weather.updatedAt ?? '');
    if (!Number.isFinite(reference)) return { state, settings };
    const start = Math.floor(reference / HOUR) * HOUR;
    const hourly: RainInterval[] = SAMPLE_CHANCE.map((chance, index) => ({
      intervalStart: new Date(start + index * HOUR).toISOString(), intervalEnd: new Date(start + (index + 1) * HOUR).toISOString(),
      precipitationProbability: chance, precipitationAmount: SAMPLE_RAIN[index]!, rainAmount: SAMPLE_RAIN[index]!,
    }));
    const next = { ...settings, widgetData: { ...settings.widgetData, countdowns: [], dynamic: { weather: true, alerts: false, air: false, sky: true, personal: false } } };
    const weather = { ...state.weather, hourly, location: { name: 'Sample City', latitude: 43.65, longitude: -79.38, timezone: 'America/Toronto' } };
    return { state: { ...state, settings: next, weather, reminders: [], alerts: OFF_ALERTS }, settings: next };
  },
};
