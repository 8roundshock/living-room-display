import type { WeatherDetailReading, WeatherState } from '../shared/contracts.ts';
import type { WidgetSize } from '../shared/widgets.ts';
import { sunIsUp } from './astronomy.ts';
import { compactWeatherTime, dateTimeFormat, lastKnownTime, NBSP, weatherTime } from './format.ts';

/**
 * Hourly forecast (#714): the pure shaping behind the widget. A fixed number of columns: one per hour,
 * and a column of its own for a sunrise or sunset, in time order between the hours it falls between (as
 * the hourly row of a phone's weather app shows it). The temperatures ride a trend that never joins
 * across an unknown value, and the heading gets at most two calm facts. Everything here is a function of
 * the saved weather and one instant, so the widget memoizes it per minute (#99). The status of a forecast
 * that is not fresh is not shaped here: the widget shows Forecast's (`weatherStatus`, ForecastStatusLine).
 */

const HOUR = 3_600_000;
/**
 * Columns per family, the same strip lengths as Forecast's families (medium 4 × 2, large 8 × 2). A sun
 * column takes one of them, so the strip's geometry never changes when an event enters or leaves it.
 */
export function hourlyForecastSlots(size: WidgetSize): number { return size === 'large' ? 12 : 6; }
/** A precipitation chance below this is not shown, so a dry stretch stays clean. */
export const HOURLY_CHANCE_MIN = 10;
/** Peak gusts are named from here up: about 40 km/h, where wind starts to move branches and umbrellas. */
export const NOTABLE_GUST = { 'km/h': 40, mph: 25 } as const;
/** The least temperature range the trend's height stands for, so a steady evening draws a nearly flat line. */
export const TREND_MIN_SPAN = { '°C': 5, '°F': 9 } as const;

interface ColumnBase {
  /** The instant this column describes. */
  time: string;
  /** The top label: “Now”, the hour (“5 PM”, “17”) or a sun event's exact time (“4:47”, “16:47”; no day period, see sunLabel). */
  label: string;
  /** Where the column's value sits on the trend, 0 (coolest shown) to 1 (warmest); null when unknown. */
  level: number | null;
}
export interface HourColumn extends ColumnBase {
  kind: 'hour';
  /** True for the first column when it shows the current reading, as Weather does. */
  now: boolean;
  temperature: number | null;
  weatherCode: number | null;
  /** Whether the sun is up at this hour at the weather location; Now uses the reading's own flag. */
  isDay: boolean;
  /** Chance of precipitation in the hour that starts at this column, in percent; null when unknown. */
  chance: number | null;
}
/** A sunrise or sunset between two hours. It has no temperature: its word sits where the trend passes. */
export interface SunColumn extends ColumnBase { kind: 'sunrise' | 'sunset' }
export type HourlyColumn = HourColumn | SunColumn;
export interface SunEvent { kind: 'sunrise' | 'sunset'; at: number }
export const SUN_WORD = { sunrise: 'Sunrise', sunset: 'Sunset' } as const;

export interface HourlyForecastView {
  columns: HourlyColumn[];
  /** At most two: the next sunrise or sunset when the strip does not show it, and peak gusts when notable. */
  facts: string[];
  /** SVG path data, one entry per unbroken run of known temperatures, in a 0–100 box (see trendPaths). */
  trend: string[];
}
export interface HourlyForecastOptions {
  /** The instant asked about, in milliseconds. */
  now: number;
  /** How many columns the family has (hourlyForecastSlots). */
  slots: number;
  clockFormat: '12h' | '24h';
  /** A valid IANA zone (weatherTimeZone). */
  timeZone: string;
  disconnected: boolean;
}

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Where each temperature sits on the trend, from the model's own values rather than the rounded labels,
 * so the line is the real course of the temperature. The band stands for at least TREND_MIN_SPAN degrees,
 * with a smaller range centred in it. Unknown values stay null.
 */
export function trendLevels(temperatures: readonly (number | null)[], unit: '°C' | '°F'): (number | null)[] {
  const values = temperatures.map(value => finite(value) ? value : null);
  const known = values.filter(finite);
  if (!known.length) return values.map(() => null);
  const low = Math.min(...known), high = Math.max(...known);
  const span = Math.max(high - low, TREND_MIN_SPAN[unit]), base = (low + high) / 2 - span / 2;
  return values.map(value => value === null ? null : (value - base) / span);
}

const point = (value: number) => String(Math.round(value * 100) / 100);
/**
 * The trend line through the column centres: x runs 0–100 from the first column's centre to the last
 * one's, y from 0 (level 1, warmest) to 100 (level 0). A null level ends the run and the next known one
 * starts another, so nothing is ever drawn across an unknown value; a known value with no known
 * neighbour draws no line. Each run is a monotone cubic (Fritsch–Butland tangents), which is smooth and
 * never rises above or dips below the values it joins.
 */
export function trendPaths(levels: readonly (number | null)[]): string[] {
  const step = levels.length > 1 ? 100 / (levels.length - 1) : 0;
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  levels.forEach((level, index) => {
    if (level === null) { if (run.length) runs.push(run); run = []; return; }
    run.push({ x: index * step, y: (1 - level) * 100 });
  });
  if (run.length) runs.push(run);
  return runs.filter(points => points.length > 1).map(points => {
    const slopes = points.slice(1).map((next, index) => (next.y - points[index]!.y) / step);
    const tangent = (index: number) => {
      const before = slopes[index - 1], after = slopes[index];
      if (before === undefined) return after!;
      if (after === undefined) return before;
      return before * after <= 0 ? 0 : 2 * before * after / (before + after);
    };
    let path = `M${point(points[0]!.x)},${point(points[0]!.y)}`;
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1]!, to = points[index]!, third = step / 3;
      path += `C${point(from.x + third)},${point(from.y + tangent(index - 1) * third)} ${point(to.x - third)},${point(to.y - tangent(index) * third)} ${point(to.x)},${point(to.y)}`;
    }
    return path;
  });
}

/** How finely the sun is sampled between `from` and `to`; the hour columns' instants are always samples. */
const SUN_SCAN = 5 * 60_000;
/**
 * Every sunrise and sunset after `from` and up to `to` at a place, in time order: the instants at which
 * `sunIsUp` changes. The hour columns' day and night glyphs ask the same `sunIsUp`, so a sun column and
 * the glyphs around it cannot disagree, also at the ends of the polar day, where the per-day sunrise and
 * sunset of `sunDay` and the sun's altitude part ways for a night or two. Elsewhere the two agree to well
 * under a second, so the time shown is the one Sun & moon shows.
 *
 * The sun is sampled every five minutes on a grid through `anchor` (pass an hour column's instant, so
 * every hour column is a sample) and each change is bisected to the millisecond; `at` is the first
 * millisecond of the new state. A sun that dips or peeks for less than five minutes between two samples
 * is not reported, and the glyphs do not show it either. None on a polar day or night, and none without
 * a real place: nothing is invented.
 */
export function sunEvents(from: number, to: number, latitude: number, longitude: number, anchor = from): SunEvent[] {
  if (!finite(latitude) || !finite(longitude) || !finite(from) || !finite(to) || !finite(anchor)) return [];
  const start = Math.round(from), end = Math.round(to), grid = Math.round(anchor);
  if (!(end > start)) return [];
  const up = (at: number) => sunIsUp(new Date(at), latitude, longitude);
  const events: SunEvent[] = [];
  let before = start, state = up(start);
  for (let sample = grid + (Math.floor((start - grid) / SUN_SCAN) + 1) * SUN_SCAN; before < end; sample += SUN_SCAN) {
    const at = Math.min(sample, end), next = up(at);
    if (next !== state) {
      // `low` keeps the old state and `high` the new one; they close in to neighbouring milliseconds.
      let low = before, high = at;
      while (high - low > 1) { const middle = Math.floor((low + high) / 2); if (up(middle) === state) low = middle; else high = middle; }
      events.push({ kind: next ? 'sunrise' : 'sunset', at: high });
      state = next;
    }
    before = at;
  }
  return events;
}

/** The next sunrise or sunset after `now` within a day, or null (polar day or night, or no place). */
export function nextSunEvent(now: number, latitude: number, longitude: number): SunEvent | null {
  return sunEvents(now, now + 24 * HOUR, latitude, longitude)[0] ?? null;
}

/** The highest known gust among the readings when it is notable (NOTABLE_GUST), rounded; null otherwise. */
export function peakGust(readings: readonly Pick<WeatherDetailReading, 'windGust'>[], unit: 'km/h' | 'mph'): number | null {
  const gusts = readings.map(reading => reading.windGust).filter(finite);
  if (!gusts.length) return null;
  const peak = Math.round(Math.max(...gusts));
  return peak >= NOTABLE_GUST[unit] ? peak : null;
}

/**
 * An hour column's label in the weather city's zone: “5 PM” on the 12-hour clock and the bare hour, “17”,
 * on the 24-hour clock, as a phone's hourly row writes it. Only a sun column shows minutes, so its exact
 * time stands out. An instant that is not on a whole local hour keeps its minutes (“17:30”).
 */
function hourLabel(iso: string, timeZone: string, clockFormat: '12h' | '24h'): string {
  if (clockFormat === '12h') return compactWeatherTime(iso, timeZone, clockFormat);
  const parts = dateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? '';
  return part('minute') === '00' ? part('hour') : `${part('hour')}:${part('minute')}`;
}

/**
 * A label's time and 12-hour day period: “5 PM” is “5” and “PM”, “4:47 PM” is “4:47” and “PM”. The widget
 * draws an hour's period as a smaller suffix with no space before it (“5PM”), as a phone's hourly row does. A
 * 24-hour label, “Now” or a sun column's time (sunLabel) has no period.
 */
export function labelParts(label: string): { main: string; period: string | null } {
  const match = /^(.+?)\s+([AP]M)$/.exec(label);
  return match ? { main: match[1]!, period: match[2]! } : { main: label, period: null };
}

/** A sun event's exact time in the weather city's zone: “16:47”, “4:47 PM” (kept on one line). The heading's fact shows it whole. */
const sunTime = (at: number, timeZone: string, clockFormat: '12h' | '24h') => weatherTime(new Date(at).toISOString(), timeZone, clockFormat).replace(/\s/g, NBSP);
/**
 * A sun column's label: its exact time without a day period (“4:47”, “12:29”, “16:47”). The word under it and the
 * hour labels on either side (“4PM”, “5PM”) already say which half of the day it is, and at the shared label size
 * a column of twelve on the Fine grid has no room for “12:29AM” (final recheck 2 of PR #730).
 */
const sunLabel = (at: number, timeZone: string, clockFormat: '12h' | '24h') => labelParts(sunTime(at, timeZone, clockFormat)).main;

/**
 * The strip's columns, at most `slots` of them.
 * - The first reads “Now” and shows the current reading while Weather would present it as current (fresh,
 *   or saved for at most three hours: `lastKnownTime`). An hours-old saved reading is never called Now;
 *   the strip then starts at the next hour.
 * - Then the hourly model instants after `now`, one hour apart from the first. An instant the saved
 *   forecast lacks is a column of unknown values, never a guess, and the hours end at the last instant
 *   the forecast has.
 * - A sunrise or sunset after `now` and up to the last of those hours is a column of its own, in time
 *   order. It comes from the same `sunIsUp` as the hours' day and night glyphs (`sunEvents`), so a sun
 *   column always stands between the last hour of one sky and the first of the other: the hours before a
 *   sunset are day and those after it night. One exactly on an hour precedes that hour's column, whose
 *   glyph already shows the new sky. A sun column takes a slot, so the last hour gives way to it and the
 *   strip's width never changes. (Now keeps the current reading's own flag, as Weather shows it.)
 * A sun column between two known temperatures sits on the straight course between them and the trend
 * runs through it (`onTrend`); next to an unknown, or at either end of the strip, it takes its one
 * neighbour's level and the trend does not reach it. `nextSun` is the first sunrise or sunset within a
 * day of `now`, whether or not the strip reaches it.
 */
export function hourlyColumns(weather: WeatherState, { now, slots, clockFormat, timeZone, disconnected }: HourlyForecastOptions): { columns: HourlyColumn[]; onTrend: boolean[]; nextSun: SunEvent | null } {
  const { latitude, longitude } = weather.location;
  const located = finite(latitude) && finite(longitude);
  const details = new Map((weather.details ?? []).map(reading => [Date.parse(reading.time), reading] as const));
  const upcoming = [...details.keys()].filter(time => time > now && time <= now + 24 * HOUR).sort((a, b) => a - b);
  // The chance for the hour starting at an instant is the interval that starts there; the intervals
  // themselves describe the hour before their end (src/server/weather.ts).
  const chanceFrom = (start: number) => weather.hourly.find(interval => Date.parse(interval.intervalStart) === start)?.precipitationProbability ?? null;
  const current = weather.current && lastKnownTime(weather, disconnected, timeZone, clockFormat, now) === null ? weather.current : null;
  const columns: HourlyColumn[] = [];
  if (current) {
    const containing = weather.hourly.find(interval => Date.parse(interval.intervalStart) <= now && now < Date.parse(interval.intervalEnd));
    columns.push({ kind: 'hour', time: new Date(now).toISOString(), now: true, label: 'Now', temperature: current.temperature, weatherCode: current.weatherCode, isDay: current.isDay, chance: containing?.precipitationProbability ?? null, level: null });
  }
  const first = upcoming[0], last = upcoming.at(-1);
  let nextSun: SunEvent | null = null;
  if (first !== undefined && last !== undefined) {
    const ahead: HourlyColumn[] = [];
    for (let time = first; time <= last && ahead.length < slots; time += HOUR) {
      const reading = details.get(time), iso = new Date(time).toISOString();
      ahead.push({
        kind: 'hour', time: iso, now: false, label: hourLabel(iso, timeZone, clockFormat),
        temperature: reading?.temperature ?? null, weatherCode: reading?.weatherCode ?? null,
        // Without a real place there is no sun to ask about; the day symbol is WeatherGlyph's own default.
        isDay: located ? sunIsUp(new Date(time), latitude, longitude) : true, chance: chanceFrom(time), level: null,
      });
    }
    // One scan, on the hours' own grid, serves the strip and the heading.
    const events = sunEvents(now, now + 24 * HOUR, latitude, longitude, first), end = Date.parse(ahead.at(-1)!.time);
    nextSun = events[0] ?? null;
    const suns: HourlyColumn[] = events.filter(event => event.at <= end).map(event => ({ kind: event.kind, time: new Date(event.at).toISOString(), label: sunLabel(event.at, timeZone, clockFormat), level: null }));
    // Time order; a sun column exactly on an hour comes before that hour (Array#sort is stable, the sun columns are first).
    const ordered = [...suns, ...ahead].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    columns.push(...ordered.slice(0, Math.max(0, slots - columns.length)));
  }
  const hours = columns.filter((column): column is HourColumn => column.kind === 'hour');
  const levels = trendLevels(hours.map(column => column.temperature), weather.units.temperature);
  hours.forEach((column, index) => { column.level = levels[index]!; });
  const onTrend = columns.map(column => column.kind === 'hour' && column.level !== null);
  for (let index = 0; index < columns.length; index++) {
    if (columns[index]!.kind === 'hour') continue;
    // The run of sun columns from here to the next hour, and the hours on either side of it.
    let end = index; while (end < columns.length && columns[end]!.kind !== 'hour') end++;
    const before = columns[index - 1]?.level ?? null, after = columns[end]?.level ?? null, count = end - index;
    for (let offset = 0; offset < count; offset++) {
      const joined = before !== null && after !== null;
      columns[index + offset]!.level = joined ? before + (after - before) * (offset + 1) / (count + 1) : before ?? after;
      onTrend[index + offset] = joined;
    }
    index = end;
  }
  return { columns, onTrend, nextSun };
}

/** The whole view for one family at one minute. Without an upcoming hour there is nothing to show: `columns` is empty. */
export function hourlyForecastView(weather: WeatherState, options: HourlyForecastOptions): HourlyForecastView {
  const { clockFormat, timeZone } = options;
  const shaped = hourlyColumns(weather, options);
  // A lone Now column is not an hourly forecast.
  const shown = shaped.columns.some(column => column.kind === 'hour' && !column.now);
  const columns = shown ? shaped.columns : [];
  const facts: string[] = [];
  if (shown) {
    // The strip already shows a sun event inside its window; the heading names the next one only when it lies beyond.
    const sun = shaped.nextSun;
    if (sun && !columns.some(column => column.kind !== 'hour' && Date.parse(column.time) === sun.at)) facts.push(`${SUN_WORD[sun.kind]}${NBSP}${sunTime(sun.at, timeZone, clockFormat)}`);
    // Each reading's gust is the maximum of the hour ending at its instant, so the shown hours' readings
    // cover now to the last hour column.
    const times = new Set(columns.filter(column => column.kind === 'hour' && !column.now).map(column => Date.parse(column.time)));
    const gust = peakGust((weather.details ?? []).filter(reading => times.has(Date.parse(reading.time))), weather.units.windSpeed);
    if (gust !== null) facts.push(`Gusts${NBSP}${gust}${NBSP}${weather.units.windSpeed}`);
  }
  return { columns, facts, trend: shown ? trendPaths(columns.map((column, index) => shaped.onTrend[index] ? column.level : null)) : [] };
}
