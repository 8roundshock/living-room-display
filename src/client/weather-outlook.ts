import type { RainInterval, WeatherState } from '../shared/contracts.ts';
import { civilDate, compactWeatherRange, compactWeatherTime, forecastDay, NBSP, precipitation } from './format.ts';

/**
 * The adaptive Weather outlook (#74): one classification of the next hours of the saved hourly
 * forecast, so Weather stays calm when the 12-hour forecast is complete and dry and adds rain
 * detail when rain is near. Every value is a forecast estimate, never an observation. The window
 * and thresholds below are the only definition (#147); every outlook function reads them.
 */
/** The outlook window: intervals overlapping the next 12 hours, and the coverage that counts as complete. */
export const RAIN_OUTLOOK_HOURS = 12;
/** A spell starting within this lead (inclusive) elevates Weather's composition. */
export const RAIN_ELEVATED_LEAD_HOURS = 6;
/** The peak hourly chance of the spells at or above this reads “likely”; below, “possible”. */
export const RAIN_LIKELY_CHANCE = 60;
/** Any hour at or above this chance, without a rain spell, reads “Precipitation possible”. */
export const PRECIPITATION_POSSIBLE_CHANCE = 30;
/** An hour whose rain plus showers reach this amount is a rain hour (0.1 mm or 0.004 in). */
export function rainThreshold(unit: 'mm' | 'in'): number {
  return unit === 'in' ? 0.004 : 0.1;
}
const HOUR = 3_600_000;
const WINDOW = RAIN_OUTLOOK_HOURS * HOUR;

/** Valid intervals overlapping the outlook window after `now`, in time order; expired ones are ignored. */
export function upcomingRain(intervals: RainInterval[], now: number): RainInterval[] {
  return intervals
    .filter((interval) => {
      const start = Date.parse(interval.intervalStart);
      const end = Date.parse(interval.intervalEnd);
      return Number.isFinite(start) && Number.isFinite(end) && end > start && end > now && start < now + WINDOW;
    })
    .sort((a, b) => Date.parse(a.intervalStart) - Date.parse(b.intervalStart));
}

/** Coverage and data completeness of the window: what the outlook needs, and nothing it does not use. */
export function precipitationOutlook(source: RainInterval[], now: number) {
  const intervals = upcomingRain(source, now);
  let coveredUntil = now;
  let hasGaps = false;
  for (const interval of intervals) {
    const start = Date.parse(interval.intervalStart);
    const end = Date.parse(interval.intervalEnd);
    if (start > coveredUntil) hasGaps = true;
    coveredUntil = Math.max(coveredUntil, end);
  }
  const coverageComplete = intervals.length > 0 && !hasGaps && coveredUntil >= now + WINDOW;
  const knownChances = intervals.map((hour) => hour.precipitationProbability).filter((value) => value !== null);
  const knownAmounts = intervals.filter((hour) => hour.precipitationAmount !== null).length;
  const knownRain = intervals.filter((hour) => hour.rainAmount !== null).length;
  return {
    intervals,
    coverageComplete,
    hasGaps,
    /** Highest known hourly chance in the window, or null. */
    chance: knownChances.length ? Math.max(...knownChances) : null,
    rainDataIncomplete: knownRain !== intervals.length,
    incomplete: !coverageComplete || knownChances.length !== intervals.length || knownAmounts !== intervals.length,
  };
}

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

export type RainQualifier = 'likely' | 'possible';

export interface RainOutlook {
  kind: RainOutlookKind;
  emphasis: RainEmphasis;
  /** From the highest known peak of every spell in the window, the same spells the detail covers (#167). */
  qualifier: RainQualifier;
  /** From the first spell's own peak (#319): for a headline that names only the first spell. */
  firstQualifier: RainQualifier;
  /** From the later spells' highest known peak, or null without later spells. */
  laterQualifier: RainQualifier | null;
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

/** The highest known peak chance of some spells, or null when none is known. */
function spellsPeak(spells: RainSpell[]): number | null {
  const chances = spells.map(item => item.peakChance).filter(value => value !== null);
  return chances.length ? Math.max(...chances) : null;
}
/** “likely” at or above RAIN_LIKELY_CHANCE; below it, or with no known chance, “possible”. */
function qualify(peak: number | null): RainQualifier {
  return peak !== null && peak >= RAIN_LIKELY_CHANCE ? 'likely' : 'possible';
}

/** Classifies the saved hourly intervals at `now`; expired intervals are ignored. */
export function rainOutlook(weather: Pick<WeatherState, 'hourly' | 'units'>, now: Date | number): RainOutlook {
  const time = typeof now === 'number' ? now : now.getTime();
  const unit = weather.units.precipitation;
  const base = precipitationOutlook(weather.hourly, time);
  const threshold = rainThreshold(unit);
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
  const later = spells.slice(1);
  return {
    kind,
    emphasis: EMPHASIS[kind],
    qualifier: qualify(spellsPeak(spells)),
    firstQualifier: qualify(firstSpell?.peakChance ?? null),
    laterQualifier: later.length ? qualify(spellsPeak(later)) : null,
    firstSpell,
    laterSpells: later,
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

/**
 * Wording in the weather city's timezone and the 12/24-hour setting. `compact` is the one-line
 * small family; `full` the medium/large wording. Calm returns no headline: saying nothing about
 * rain means the 12-hour forecast is complete and dry. Never claims it is or will be raining.
 * The detail's peak and the amount cover every spell in the window (#167), and so does the
 * qualifier of a headline that covers them all (“on and off …”). A headline that names only the
 * first spell (“now”, “from 10 AM”, a later spell) takes that spell's own qualifier, and says so
 * when a later spell is likelier: “Rain possible now, likely later” (#319). A headline that names
 * one end never implies the window is dry after it.
 */
export function rainOutlookCopy(outlook: RainOutlook, timeZone: string, clockFormat: '12h' | '24h', now: Date | number, variant: 'compact' | 'full'): RainOutlookCopy {
  const time = (iso: string) => compactWeatherTime(iso, timeZone, clockFormat);
  const spell = outlook.firstSpell, every = `Rain ${outlook.qualifier}`, first = `Rain ${outlook.firstQualifier}`;
  const several = outlook.laterSpells.length > 0, last = outlook.laterSpells.at(-1) ?? spell;
  // Only the first spell is named, so a likelier later spell is mentioned rather than borrowed.
  const likelyLater = several && outlook.firstQualifier === 'possible' && outlook.laterQualifier === 'likely' ? ', likely later' : '';
  let headline = '';
  if (outlook.kind === 'now' && spell) {
    if (variant === 'compact') headline = spell.openEnded || several ? `${first} now${likelyLater}` : `${first} until ${time(spell.end)}`;
    else if (several) headline = `${every} on and off ${last!.openEnded ? 'beyond' : 'until'} ${time(last!.end)}`;
    else headline = `${first} ${spell.openEnded ? 'beyond' : 'until'} ${time(spell.end)}`;
  } else if (outlook.kind === 'soon' && spell) {
    headline = !several && !spell.openEnded ? `${first} ${compactWeatherRange(spell.start, spell.end, timeZone, clockFormat)}`
      : several && variant === 'full' ? `${every} on and off from ${time(spell.start)}` : `${first} from ${time(spell.start)}${likelyLater}`;
  } else if (outlook.kind === 'later' && spell) {
    const date = civilDate(new Date(spell.start), timeZone);
    const day = variant === 'full' && date !== civilDate(now, timeZone) ? `${forecastDay(date, timeZone, now)} ` : '';
    headline = `${first} from ${day}${time(spell.start)}${likelyLater}`;
  } else if (outlook.kind === 'possible') headline = outlook.peakChance === null ? 'Precipitation possible' : `Precipitation possible${NBSP}·${NBSP}${outlook.peakChance}%`;
  else if (outlook.kind === 'unknown') headline = outlook.unknownReason === 'rain-data' ? 'Rain timing unavailable' : outlook.unknownReason === 'partial' ? 'Rain outlook partial' : 'Rain outlook unavailable';
  let detail = '';
  if (spell) {
    // The detail covers every spell in the window, so “on and off” rain is not under-reported.
    const spells = [spell, ...outlook.laterSpells];
    const peak = spellsPeak(spells);
    const amount = spells.reduce((total, item) => total + item.amount, 0);
    detail = `${peak === null ? 'Chance unavailable' : `Peak ${peak}%`} · ${spell.knownAmountOnly ? `Known rain ${precipitation(amount, outlook.unit)}` : `${precipitation(amount, outlook.unit)} rain`}`;
  }
  const confidence = !outlook.hours.length ? ''
    : `${!outlook.coverageComplete ? 'Partial forecast' : outlook.dataIncomplete ? 'Partial data' : 'Forecast estimate'}${outlook.hasGaps ? ' · coverage gaps' : ''}`;
  return { headline, detail, confidence };
}

/**
 * The accessible name of the large family's hourly chance bars (#166): their span, the peak and
 * how many hours are unknown, e.g. “Hourly precipitation chance, 9 AM to 9 PM: peak 60% at 10 AM,
 * 1 hour unknown”. The headline and detail carry the same outlook in words.
 */
export function rainChartLabel(outlook: RainOutlook, timeZone: string, clockFormat: '12h' | '24h'): string {
  const hours = outlook.hours;
  if (!hours.length) return 'Hourly precipitation chance unavailable';
  const time = (iso: string) => compactWeatherTime(iso, timeZone, clockFormat);
  const known = hours.filter(hour => hour.chance !== null);
  const unknown = hours.length - known.length;
  const peakHour = known.reduce<RainOutlookHour | null>((best, hour) => best === null || hour.chance! > best.chance! ? hour : best, null);
  const parts = [peakHour ? `peak ${peakHour.chance}% at ${time(peakHour.start)}` : 'chance unknown'];
  if (peakHour && unknown) parts.push(`${unknown} ${unknown === 1 ? 'hour' : 'hours'} unknown`);
  return `Hourly precipitation chance, ${time(hours[0]!.start)} to ${time(hours.at(-1)!.end)}: ${parts.join(', ')}`;
}
