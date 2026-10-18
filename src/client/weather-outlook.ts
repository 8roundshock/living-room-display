import type { WeatherState } from '../shared/contracts.ts';
import { compactWeatherRange, compactWeatherTime, forecastDay, precipitation } from './format.ts';
import { precipitationOutlook } from './model.ts';

/**
 * The adaptive Weather outlook (#74): one classification of the next hours of the saved hourly
 * forecast, so Weather stays calm when the 12-hour forecast is complete and dry and adds rain
 * detail when rain is near. Every value is a forecast estimate, never an observation.
 */
/** The outlook window; precipitationOutlook in model.ts uses the same 12 hours. */
export const RAIN_OUTLOOK_HOURS = 12;
/** A spell starting within this lead (inclusive) elevates Weather's composition. */
export const RAIN_ELEVATED_LEAD_HOURS = 6;
/** A spell's peak hourly chance at or above this reads “likely”; below, “possible”. */
export const RAIN_LIKELY_CHANCE = 60;
/** Any hour at or above this chance, without a rain spell, reads “Precipitation possible”. */
export const PRECIPITATION_POSSIBLE_CHANCE = 30;
const HOUR = 3_600_000;

export type RainOutlookKind = 'calm' | 'now' | 'soon' | 'later' | 'possible' | 'unknown';
export type RainEmphasis = 'calm' | 'hint' | 'elevated';
export type RainUnknownReason = 'none' | 'rain-data' | 'partial';

/** Contiguous hours whose rain plus showers reach 0.1 mm (0.004 in). */
export interface RainSpell {
  start: string;
  end: string;
  /** The spell reaches the end of the known window, so its end is unknown. */
  openEnded: boolean;
  /** Rain plus showers over the spell. */
  amount: number;
  /** Some window hours lack rain amounts, so more rain may be unreported. */
  knownAmountOnly: boolean;
  /** Highest known hourly chance in the spell (all precipitation), or null when unknown. */
  peakChance: number | null;
}

export interface RainOutlookHour {
  start: string;
  end: string;
  /** All-precipitation hourly chance, or null when unknown. */
  chance: number | null;
  inSpell: boolean;
}

export interface RainOutlook {
  kind: RainOutlookKind;
  emphasis: RainEmphasis;
  qualifier: 'likely' | 'possible';
  firstSpell: RainSpell | null;
  laterSpells: RainSpell[];
  unknownReason: RainUnknownReason | null;
  /** Highest known hourly chance in the window. */
  peakChance: number | null;
  unit: 'mm' | 'in';
  hours: RainOutlookHour[];
  coverageComplete: boolean;
  hasGaps: boolean;
  chanceMissing: boolean;
  rainDataIncomplete: boolean;
  dataIncomplete: boolean;
}

export interface RainOutlookCopy { headline: string; detail: string; confidence: string }

const EMPHASIS: Record<RainOutlookKind, RainEmphasis> = { calm: 'calm', now: 'elevated', soon: 'elevated', later: 'hint', possible: 'hint', unknown: 'hint' };

/** Classifies the saved hourly intervals at `now`; expired intervals are ignored. */
export function rainOutlook(weather: Pick<WeatherState, 'hourly' | 'units'>, now: Date | number): RainOutlook {
  const time = typeof now === 'number' ? now : now.getTime();
  const unit = weather.units.precipitation;
  const base = precipitationOutlook(weather.hourly, unit, time);
  const threshold = unit === 'in' ? 0.004 : 0.1;
  const intervals = base.intervals;
  const groups: (typeof intervals)[] = [];
  intervals.forEach((interval, index) => {
    if (interval.rainAmount === null || interval.rainAmount < threshold) return;
    // A dry or unknown hour, or a coverage gap, ends a spell.
    const previous = intervals[index - 1], group = groups.at(-1);
    if (group && previous && group.at(-1) === previous && Date.parse(previous.intervalEnd) === Date.parse(interval.intervalStart)) group.push(interval);
    else groups.push([interval]);
  });
  const spells = groups.map((hours): RainSpell => {
    const chances = hours.map(hour => hour.precipitationProbability).filter(value => value !== null);
    return {
      start: hours[0]!.intervalStart,
      end: hours.at(-1)!.intervalEnd,
      openEnded: hours.at(-1) === intervals.at(-1),
      amount: hours.reduce((total, hour) => total + (hour.rainAmount ?? 0), 0),
      knownAmountOnly: base.rainDataIncomplete,
      peakChance: chances.length ? Math.max(...chances) : null,
    };
  });
  const inSpell = new Set(groups.flat());
  const firstSpell = spells[0] ?? null;
  let kind: RainOutlookKind;
  let unknownReason: RainUnknownReason | null = null;
  if (!intervals.length) { kind = 'unknown'; unknownReason = 'none'; }
  else if (firstSpell) {
    const start = Date.parse(firstSpell.start);
    kind = start <= time ? 'now' : start <= time + RAIN_ELEVATED_LEAD_HOURS * HOUR ? 'soon' : 'later';
  } else if (base.rainDataIncomplete) { kind = 'unknown'; unknownReason = 'rain-data'; }
  else if (intervals.some(hour => (hour.precipitationProbability ?? -1) >= PRECIPITATION_POSSIBLE_CHANCE || (hour.precipitationAmount ?? 0) >= threshold)) kind = 'possible';
  else if (base.incomplete || base.hasGaps) { kind = 'unknown'; unknownReason = 'partial'; }
  else kind = 'calm';
  return {
    kind,
    emphasis: EMPHASIS[kind],
    qualifier: firstSpell?.peakChance !== null && firstSpell?.peakChance !== undefined && firstSpell.peakChance >= RAIN_LIKELY_CHANCE ? 'likely' : 'possible',
    firstSpell,
    laterSpells: spells.slice(1),
    unknownReason,
    peakChance: base.chance,
    unit,
    hours: intervals.map(hour => ({ start: hour.intervalStart, end: hour.intervalEnd, chance: hour.precipitationProbability, inSpell: inSpell.has(hour) })),
    coverageComplete: base.coverageComplete,
    hasGaps: base.hasGaps,
    chanceMissing: intervals.some(hour => hour.precipitationProbability === null),
    rainDataIncomplete: base.rainDataIncomplete,
    dataIncomplete: base.incomplete || base.rainDataIncomplete,
  };
}

function civilDate(timestamp: string | number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}

/**
 * Wording in the weather city's timezone and the 12/24-hour setting. `compact` is the one-line
 * small family; `full` the medium/large wording. Calm returns no headline: saying nothing about
 * rain means the 12-hour forecast is complete and dry. Never claims it is or will be raining.
 */
export function rainOutlookCopy(outlook: RainOutlook, timeZone: string, clockFormat: '12h' | '24h', now: Date | number, variant: 'compact' | 'full'): RainOutlookCopy {
  const time = (iso: string) => compactWeatherTime(iso, timeZone, clockFormat);
  const spell = outlook.firstSpell, rain = `Rain ${outlook.qualifier}`;
  let headline = '';
  if (outlook.kind === 'now' && spell) headline = spell.openEnded ? variant === 'compact' ? `${rain} now` : `${rain} beyond ${time(spell.end)}` : `${rain} until ${time(spell.end)}`;
  else if (outlook.kind === 'soon' && spell) {
    const several = outlook.laterSpells.length > 0;
    headline = !several && !spell.openEnded ? `${rain} ${compactWeatherRange(spell.start, spell.end, timeZone, clockFormat)}`
      : several && variant === 'full' ? `${rain} on and off from ${time(spell.start)}` : `${rain} from ${time(spell.start)}`;
  } else if (outlook.kind === 'later' && spell) {
    const date = civilDate(spell.start, timeZone);
    const day = variant === 'full' && date !== civilDate(typeof now === 'number' ? now : now.getTime(), timeZone) ? `${forecastDay(date, timeZone, now)} ` : '';
    headline = `${rain} from ${day}${time(spell.start)}`;
  } else if (outlook.kind === 'possible') headline = outlook.peakChance === null ? 'Precipitation possible' : `Precipitation possible · ${outlook.peakChance}%`;
  else if (outlook.kind === 'unknown') headline = outlook.unknownReason === 'rain-data' ? 'Rain timing unavailable' : outlook.unknownReason === 'partial' ? 'Rain outlook partial' : 'Rain outlook unavailable';
  let detail = '';
  if (spell) {
    // The detail covers every spell in the window, so “on and off” rain is not under-reported.
    const spells = [spell, ...outlook.laterSpells];
    const chances = spells.map(item => item.peakChance).filter(value => value !== null);
    const amount = spells.reduce((total, item) => total + item.amount, 0);
    const peak = chances.length ? `Peak ${Math.max(...chances)}%` : 'Chance unavailable';
    detail = `${peak} · ${spell.knownAmountOnly ? `Known rain ${precipitation(amount, outlook.unit)}` : `${precipitation(amount, outlook.unit)} rain`}`;
  }
  const confidence = !outlook.hours.length ? ''
    : `${!outlook.coverageComplete ? 'Partial forecast' : outlook.dataIncomplete ? 'Partial data' : 'Forecast estimate'}${outlook.hasGaps ? ' · coverage gaps' : ''}`;
  return { headline, detail, confidence };
}
