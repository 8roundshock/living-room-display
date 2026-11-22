import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOCK_GLYPHS, MEASURE_SIZES, clockReserve, clockRun, inkTable, widestClockRun, type ClockInk, type GlyphMeter } from './clock-spacing.ts';

/** A typeface in em: each glyph's advance and where its ink starts and ends inside it. */
type Face = Record<string, { advance: number; left: number; right: number }>;
/** Tabular figures as Segoe UI draws them: one advance, a 1 with wide bearings and a 4 that fills its box. */
const TABULAR: Face = Object.fromEntries([...CLOCK_GLYPHS].map(character => [character, character === '1' ? { advance: 0.539, left: 0.111, right: 0.185 } : character === '4' ? { advance: 0.539, left: 0.006, right: 0.034 } : character === ':' ? { advance: 0.217, left: 0.054, right: 0.053 } : { advance: 0.539, left: 0.042, right: 0.041 }]));
/**
 * A canvas as the browser behaves: bounds grow outwards to whole pixels. `page` is the face the page lays out,
 * the same one unless a test gives the canvas another figure set.
 */
function meter(canvas: Face, page: Face = canvas): GlyphMeter & { advances: number } {
  const result = {
    advances: 0,
    metrics: (character: string, size: number) => {
      const glyph = canvas[character]!;
      return { width: glyph.advance * size, actualBoundingBoxLeft: -Math.floor(glyph.left * size), actualBoundingBoxRight: Math.ceil((glyph.advance - glyph.right) * size) };
    },
    advance: (character: string, size: number) => { result.advances++; return page[character]!.advance * size; },
  };
  return result;
}

test('#717 the ink table holds the bearings of every clock glyph, measured from just outside its ink', () => {
  const table = inkTable(meter(TABULAR));
  assert.ok(table);
  assert.deepEqual(Object.keys(table).sort(), [...CLOCK_GLYPHS].sort());
  const errors = Object.entries(table).flatMap(([character, ink]) => [TABULAR[character]!.left - ink.left, TABULAR[character]!.right - ink.right]);
  // Whole-pixel bounds sit just outside the ink: a bearing is never over-measured, and never short by a whole
  // pixel of the smallest size, so two neighbours' gap is off by less than one hundredth of an em.
  for (const error of errors) assert.ok(error >= 0 && error < 1 / MEASURE_SIZES[0]!, `bearing error ${error}`);
  // The 1's hole and the 4's full box are what the clock's margins must cancel.
  assert.ok(table['1']!.right > 0.17 && table['4']!.left < 0.01, JSON.stringify(table));
  // The ink width is the advance less both bearings (never under-measured: the bounds sit outside the ink).
  for (const [character, ink] of Object.entries(table)) { const glyph = TABULAR[character]!, width = glyph.advance - glyph.left - glyph.right; assert.ok(ink.width >= width - 1e-9 && ink.width < width + 2 / MEASURE_SIZES[0]!, `${character} ink ${ink.width} for ${width}`); }
});

test('#717 several sizes measure better than one', () => {
  const spread = (sizes: readonly number[]) => {
    const table = inkTable(meter(TABULAR), CLOCK_GLYPHS, sizes)!;
    const errors = Object.entries(table).flatMap(([character, ink]) => [TABULAR[character]!.left - ink.left, TABULAR[character]!.right - ink.right]);
    return Math.max(...errors) - Math.min(...errors);
  };
  assert.ok(spread(MEASURE_SIZES) < spread([MEASURE_SIZES[0]!]), `${spread(MEASURE_SIZES)} against ${spread([MEASURE_SIZES[0]!])}`);
  assert.ok(MEASURE_SIZES.every(size => size < 256), 'above 256 px the canvas reports far coarser bounds');
});

test('#717 a glyph the page lays out differently from the canvas drops the whole table', () => {
  // Georgia without its lining figures: the canvas draws a wider old-style 0 than the page's lining one.
  const oldStyle: Face = { ...TABULAR, 0: { advance: 0.614, left: 0.05, right: 0.044 } };
  assert.equal(inkTable(meter(oldStyle, TABULAR)), null);
  // The same glyphs measured to within a hundredth of an em are trusted.
  const close: Face = { ...TABULAR, 0: { ...TABULAR['0']!, advance: 0.545 } };
  assert.ok(inkTable(meter(close, TABULAR)));
});

test('#717 the page\'s advance is read once per glyph, at the first size', () => {
  const counted = meter(TABULAR);
  assert.ok(inkTable(counted, '00:00'));
  assert.equal(counted.advances, 2, 'two different glyphs');
});

test('#717 a glyph without ink or with a broken measurement drops the table', () => {
  const blank: Face = { ...TABULAR, 7: { advance: 0.539, left: 0.3, right: 0.3 } };
  assert.equal(inkTable(meter(blank)), null, 'ink narrower than nothing');
  const missing = meter(TABULAR);
  assert.equal(inkTable({ ...missing, metrics: () => ({ width: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }) }), null, 'no advance');
  assert.equal(inkTable({ ...missing, metrics: (character, size) => ({ ...missing.metrics(character, size), actualBoundingBoxLeft: Number.NaN }) }), null, 'not a number');
  assert.equal(inkTable({ ...missing, advance: () => Number.NaN }), null, 'the page gave no advance');
  assert.equal(inkTable(missing, CLOCK_GLYPHS, []), null, 'no size to measure at');
});

/**
 * Ink widths and right bearings in em, as measured for Segoe UI: the 1 is about half as wide as the other digits
 * with the widest bearing, and the 4 is the widest digit.
 */
const WIDTHS = { 0: 0.465, 1: 0.245, 2: 0.445, 3: 0.415, 4: 0.505, 5: 0.4, 6: 0.455, 7: 0.449, 8: 0.459, 9: 0.45, ':': 0.116 };
const INK: ClockInk = Object.fromEntries(Object.entries(WIDTHS).map(([character, width]) => [character, { left: 0.04, right: character === '1' ? 0.18 : character === '4' ? 0.03 : 0.04, width }]));
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);
const texts = (format: '12h' | '24h') => Array.from({ length: 1440 }, (_, minute) => `${format === '12h' ? Math.floor(minute / 60) % 12 || 12 : String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);

test('#717 a run is the ink of its characters, how many they are and the right bearing of the last', () => {
  const run = clockRun(INK, '10:41')!;
  near(run.ink, 0.245 + 0.465 + 0.116 + 0.505 + 0.245); assert.equal(run.count, 5); near(run.tail, 0.18);
  assert.equal(clockRun(INK, '11.11'), null, 'a character the table lacks');
});

test('#717 the widest time is the widest hour, the colon and the minute that reaches furthest', () => {
  // 24-hour: 04:44. The widest hour is 04 (a 2 cannot be followed by a 4), the widest minute 44.
  const day = widestClockRun(INK, '24h')!;
  near(day.ink, 0.465 + 0.505 + 0.116 + 0.505 + 0.505); assert.equal(day.count, 5); near(day.tail, 0.03);
  // 12-hour: 10:44. A two-digit hour outweighs any one-digit hour, and 10 is the widest of 10, 11 and 12.
  const half = widestClockRun(INK, '12h')!;
  near(half.ink, 0.245 + 0.465 + 0.116 + 0.505 + 0.505); assert.equal(half.count, 5);
  // A last digit with a long bearing reaches further than a slightly wider one: with a huge bearing on the 1, x1 wins.
  const longTail: ClockInk = { ...INK, 1: { ...INK['1']!, right: 0.5 } };
  near(widestClockRun(longTail, '24h')!.tail, 0.5);
  const { 7: _seven, ...partial } = INK;
  assert.equal(widestClockRun(partial, '24h'), null, 'a table without every digit cannot say');
});

test('#717 every minute of a format reserves up to the same edge, and never less than its own tail', () => {
  for (const format of ['12h', '24h'] as const) {
    const most = widestClockRun(INK, format)!, edge = most.ink + most.tail;
    for (const text of texts(format)) {
      const run = clockRun(INK, text)!, reserve = clockReserve(INK, text, format)!;
      near(run.ink + reserve.spare, edge); assert.equal(run.count + reserve.gaps, most.count, `${format} ${text}`);
      assert.ok(reserve.spare >= run.tail - 1e-9, `${format} ${text}: the reserve covers the last advance box`);
    }
  }
  // The widest time itself reserves only its tail; 12-hour 9:41 is also one character, and so one gap, short.
  near(clockReserve(INK, '04:44', '24h')!.spare, 0.03);
  const short = clockReserve(INK, '9:41', '12h')!;
  near(short.spare, 0.245 + 0.465 + 0.116 + 1.01 + 0.03 - (0.45 + 0.116 + 0.505 + 0.245)); assert.equal(short.gaps, 1);
  assert.equal(clockReserve(INK, '9.41', '12h'), null, 'an unknown character');
  assert.deepEqual(clockReserve(INK, '004:44', '24h'), { spare: 0.03, gaps: 0 }, 'more characters than any time of the format');
});
