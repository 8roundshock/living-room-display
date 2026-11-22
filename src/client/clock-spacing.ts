/*
 * Even spacing for the Clock's digits (#717).
 *
 * A font spaces its figures by their advance boxes: tabular figures all share the widest box, so a 1 floats in
 * a hole while a 4 fills its box edge to edge. The clock used to pull every box together by a fixed negative
 * letter-spacing, which made "44", "04" and "48" overlap and left "11" a fifth of the digit height apart. The
 * clock now places each character by what it paints: this module measures, once per typeface, how far each
 * glyph's ink starts and ends inside its advance box (its side bearings, in em), and the stylesheet turns those
 * into margins that leave one equal gap between every pair of neighbours (`--clock-gap` in widgets.css).
 *
 * The bearings come from canvas `measureText`, which reports a glyph's real bounding box. Canvas text cannot set
 * `font-variant-numeric`, so a glyph is trusted only when the page lays it out with the same advance as the
 * canvas measured; when any glyph disagrees (another figure set, an unsupported font) the whole table is
 * dropped and the clock keeps the stylesheet's safe fallback, tabular figures at their natural spacing.
 *
 * Spaced this way a time is as wide as its digits: 11:11 is much narrower than 04:44. The shared fit must not
 * follow that from minute to minute, so the clock also reserves, invisibly, the room its widest time would take
 * (`clockReserve`), and a clock that has to zoom out keeps one scale all day.
 */

/**
 * A glyph in em: its side bearings (from the start of its advance box to its ink, and from its ink to the box
 * end) and the width of the ink between them.
 */
export interface GlyphInk { left: number; right: number; width: number }
export type ClockInk = Readonly<Record<string, GlyphInk>>;

/** Everything a clock face prints: `clockLabels` formats the time in English digits. */
export const CLOCK_GLYPHS = '0123456789:';
/**
 * The measuring sizes in CSS px. The canvas reports a glyph's bounds in whole pixels (and far more coarsely above
 * 256 px, where the browser stops rasterising glyphs), so one size is only good to half a percent of an em;
 * averaging a few sizes that share no factor brings every glyph within a thousandth. The average sits slightly
 * inside the true bearing by the same amount for every glyph, which leaves the gaps even.
 */
export const MEASURE_SIZES: readonly number[] = [173, 191, 199, 211, 229, 241];
/** The most the page's and the canvas's advance for one glyph may differ, in em, and still be the same glyph. */
const ADVANCE_TOLERANCE = 0.01;

/** The part of `TextMetrics` the table needs, in CSS px at the measured size. */
export type GlyphMetrics = Pick<TextMetrics, 'width' | 'actualBoundingBoxLeft' | 'actualBoundingBoxRight'>;
/** One typeface: what the canvas measures for a character at a size, and the advance the page lays it out with. */
export interface GlyphMeter { metrics(character: string, size: number): GlyphMetrics; advance(character: string, size: number): number }

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * The bearings of every character in `characters`, or null when any glyph cannot be trusted: no ink, a
 * non-finite measurement, or a canvas advance that is not the page's (the canvas drew another glyph).
 */
export function inkTable(meter: GlyphMeter, characters: string = CLOCK_GLYPHS, sizes: readonly number[] = MEASURE_SIZES): ClockInk | null {
  const glyphs = Array.from(new Set(characters)), sums = new Map(glyphs.map(character => [character, { left: 0, right: 0, width: 0 }]));
  // Size by size, so the canvas changes its font once per size.
  for (const size of sizes) for (const character of glyphs) {
    const metrics = meter.metrics(character, size);
    const left = -metrics.actualBoundingBoxLeft, right = metrics.width - metrics.actualBoundingBoxRight;
    if (![left, right].every(Number.isFinite) || !(metrics.width > 0) || !(metrics.width - left - right > 0)) return null;
    if (size === sizes[0] && !(Math.abs(metrics.width - meter.advance(character, size)) <= ADVANCE_TOLERANCE * size)) return null;
    const sum = sums.get(character)!; sum.left += left / size; sum.right += right / size; sum.width += (metrics.width - left - right) / size;
  }
  if (!sizes.length) return null;
  return Object.fromEntries(glyphs.map(character => { const sum = sums.get(character)!; return [character, { left: round(sum.left / sizes.length), right: round(sum.right / sizes.length), width: round(sum.width / sizes.length) }]; }));
}

/**
 * A run of characters as the clock lays it out: the summed ink width in em, how many characters share it, and
 * `tail`, the last glyph's right bearing. The run's box ends with its ink, but the last character's advance box
 * still reaches `tail` past it, and the shared fit measures boxes, so the room a run takes ends there.
 */
export interface ClockRun { ink: number; count: number; tail: number }

/** `text` as a run, or null when the table lacks one of its characters. */
export function clockRun(ink: ClockInk, text: string): ClockRun | null {
  let width = 0, count = 0, tail = 0;
  for (const character of text) { const glyph = ink[character]; if (!glyph) return null; width += glyph.width; tail = glyph.right; count++; }
  return { ink: round(width), count, tail };
}

const two = (value: number) => String(value).padStart(2, '0');
/**
 * The widest of `texts` by `reach`. One more character always outweighs wider digits: it brings a digit and a
 * gap, against differences of a few hundredths of an em.
 */
function widest(ink: ClockInk, texts: string[], reach: (run: ClockRun) => number): ClockRun | null {
  let best: ClockRun | null = null;
  for (const text of texts) {
    const run = clockRun(ink, text);
    if (!run) return null;
    if (!best || run.count > best.count || run.count === best.count && reach(run) > reach(best)) best = run;
  }
  return best;
}

/**
 * The time that takes the most room in this format, as a run: the widest hour, the colon and the minute that
 * reaches furthest (its ink and its last glyph's bearing).
 */
export function widestClockRun(ink: ClockInk, clockFormat: '12h' | '24h'): ClockRun | null {
  const hours = clockFormat === '12h' ? Array.from({ length: 12 }, (_, hour) => String(hour + 1)) : Array.from({ length: 24 }, (_, hour) => two(hour));
  const hour = widest(ink, hours, run => run.ink), minute = widest(ink, Array.from({ length: 60 }, (_, value) => two(value)), run => run.ink + run.tail), colon = clockRun(ink, ':');
  return hour && minute && colon ? { ink: round(hour.ink + colon.ink + minute.ink), count: hour.count + colon.count + minute.count, tail: minute.tail } : null;
}

/**
 * The room `text` leaves free of what the widest time of its format takes: `spare` in em, measured from the end
 * of the run's ink (so never less than the run's own tail), and `gaps` for the characters, each with its gap, the
 * widest time has more. Null when the table cannot say.
 */
export function clockReserve(ink: ClockInk, text: string, clockFormat: '12h' | '24h'): { spare: number; gaps: number } | null {
  const run = clockRun(ink, text), most = widestClockRun(ink, clockFormat);
  if (!run || !most) return null;
  // A run with more characters than the format's widest time is not a time of that format: reserve only its tail.
  if (run.count > most.count) return { spare: run.tail, gaps: 0 };
  return { spare: Math.max(run.tail, round(most.ink + most.tail - run.ink)), gaps: most.count - run.count };
}

/** One table per typeface for the life of the page; null records a typeface that could not be measured. */
const tables = new Map<string, ClockInk | null>();

/** `typeface` is a CSS font shorthand without its size: style, weight and family list. */
function measure(document: Document, typeface: { style: string; weight: string; family: string }): ClockInk | null {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  const font = (size: number) => `${typeface.style} ${typeface.weight} ${size}px ${typeface.family}`;
  // The page's own advance for each glyph, from a hidden probe in the same font with the clock's figures.
  const probe = document.createElement('span');
  probe.style.cssText = 'position:fixed;left:0;top:0;display:inline-block;visibility:hidden;pointer-events:none;white-space:pre';
  document.body.append(probe);
  let current = 0;
  try {
    return inkTable({
      metrics: (character, size) => { if (size !== current) { context.font = font(size); current = size; } return context.measureText(character); },
      advance: (character, size) => {
        probe.style.font = font(size); probe.style.fontVariantNumeric = 'lining-nums'; probe.style.letterSpacing = '0';
        probe.textContent = character; return parseFloat(getComputedStyle(probe).width);
      },
    });
  } catch { return null; } finally { probe.remove(); }
}

/** The ink table for the typeface `digits` (the clock's digit run) is drawn in, measured on first use. */
export function clockInk(digits: Element): ClockInk | null {
  const style = getComputedStyle(digits), typeface = { style: style.fontStyle, weight: style.fontWeight, family: style.fontFamily };
  const key = `${typeface.style} ${typeface.weight} ${typeface.family}`;
  let table = tables.get(key);
  if (table === undefined) { table = measure(digits.ownerDocument, typeface); tables.set(key, table); }
  return table;
}
