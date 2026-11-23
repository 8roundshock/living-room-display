import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOCK_GLYPHS, MEASURE_SIZES, RETRY_AFTER_MS, clockPlacement, clockRun, dueForMeasuring, inkTable, widestClockRun, type ClockInk, type GlyphMeter } from './clock-spacing.ts';

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

/** The gap plus the stroke between two neighbours, in em: what widgets.css puts between painted edges. */
const STEP = 0.073;
const minutesOf = (text: string) => text.split(':')[1]!, hourOf = (text: string) => text.split(':')[0]!;
/**
 * The stylesheet's layout of a time, in em from the centre of a centred clock (large) or from its left edge
 * (small, medium): where each character's ink starts, and the box the fit and the float measure.
 */
function layout(text: string, format: '12h' | '24h', centred: boolean, period = format === '12h' ? 0.35 : 0) {
  const placement = clockPlacement(INK, text, format)!, run = clockRun(INK, text)!;
  const width = run.ink + (run.count - 1) * STEP, leadRoom = placement.lead + placement.leadGaps * STEP;
  // With a period the box is the digits, the widest minute's room and the period; without, the digits alone.
  // Either way the hold brings it to the middle minute's width (Clock.tsx).
  const box = period ? width + placement.slack + period : width, hold = period ? placement.hold - placement.slack : placement.hold;
  const left = centred ? -(box + hold) / 2 : 0;
  const starts: number[] = []; let x = left;
  for (const character of text) { starts.push(x); x += INK[character]!.width + STEP; }
  const roomStart = centred ? left - leadRoom / 2 : left, roomEnd = left + box + (centred ? leadRoom / 2 : leadRoom) + (period ? 0 : placement.trail);
  return { starts, left, right: left + box, roomStart, roomEnd, centre: left + box / 2, placement };
}

test('#717 a placement says what a time is short of the widest hour and the furthest minute', () => {
  // 24-hour 11:11 against 04:44: the hour is 0.465 + 0.505 - 2 × 0.245 of ink short and has as many characters.
  const narrow = clockPlacement(INK, '11:11', '24h')!;
  near(narrow.lead, 0.465 + 0.505 - 0.49); assert.equal(narrow.leadGaps, 0);
  near(narrow.slack, 1.01 - 0.49); near(narrow.trail, 1.01 + 0.03 - 0.49);
  // The middle of the narrowest (11) and the widest (44) minute is 0.75; 11 is 0.26 under it, 44 as much over.
  near(narrow.hold, 0.26); near(clockPlacement(INK, '04:44', '24h')!.hold, -0.26);
  // The widest time itself holds only its own tail; 12-hour 9:41 lacks a character and some ink of 10.
  const widest = clockPlacement(INK, '04:44', '24h')!;
  near(widest.lead, 0); near(widest.slack, 0); near(widest.trail, 0.03);
  const short = clockPlacement(INK, '9:41', '12h')!;
  near(short.lead, 0.245 + 0.465 - 0.45); assert.equal(short.leadGaps, 1); near(short.trail, 1.01 + 0.03 - 0.75);
  assert.ok(short.trail >= 0.18, 'never less than the tail of its own last digit');
  for (const text of ['9.41', '941', '9:4:1', ':41', '9:']) assert.equal(clockPlacement(INK, text, '12h'), null, text);
  near(clockPlacement(INK, '004:44', '24h')!.lead, 0); assert.equal(clockPlacement(INK, '004:44', '24h')!.leadGaps, 0);
  const { 7: _seven, ...partial } = INK;
  assert.equal(clockPlacement(partial, '04:44', '24h'), null, 'a table without every digit cannot say');
});

test('#717 the room a clock holds is the same at every minute of the day', () => {
  for (const format of ['12h', '24h'] as const) for (const centred of [false, true]) {
    const rooms = texts(format).map(text => layout(text, format, centred));
    for (const room of rooms) { near(room.roomStart, rooms[0]!.roomStart); near(room.roomEnd, rooms[0]!.roomEnd); }
    // Nothing the clock draws leaves that room.
    for (const room of rooms) assert.ok(room.left >= room.roomStart - 1e-9 && room.right <= room.roomEnd + 1e-9);
  }
});

test('#717 a centred clock is placed once an hour: within the hour only the digits that change move', () => {
  for (const format of ['12h', '24h'] as const) {
    const day = texts(format); let moves = 0, hourMoves = 0, furthest = 0;
    for (let index = 1; index <= day.length; index++) {
      const before = day[index - 1]!, after = day[index % day.length]!, was = layout(before, format, true), now = layout(after, format, true);
      // A character is unchanged when the same character stands at the same place counted from the right (Clock.tsx's key).
      let moved = 0;
      for (let fromEnd = 0; fromEnd < Math.min(before.length, after.length); fromEnd++) {
        if (before.at(-1 - fromEnd) !== after.at(-1 - fromEnd)) continue;
        moved = Math.max(moved, Math.abs(now.starts.at(-1 - fromEnd)! - was.starts.at(-1 - fromEnd)!));
      }
      if (moved < 1 / 302) continue;
      moves++; furthest = Math.max(furthest, moved);
      if (hourOf(before) !== hourOf(after)) hourMoves++;
    }
    assert.equal(moves, hourMoves, `${format}: an unchanged character moves only when the hour changes`);
    assert.ok(moves <= 24, `${format}: ${moves} changes a day move an unchanged character`);
    // Within an hour the hour, the colon and the left edge of the minutes never move; with AM/PM the time's end does not either.
    for (let index = 1; index < day.length; index++) {
      const before = day[index - 1]!, after = day[index]!; if (hourOf(before) !== hourOf(after)) continue;
      const was = layout(before, format, true), now = layout(after, format, true), fixed = hourOf(after).length + 2;
      for (let place = 0; place < fixed; place++) near(now.starts[place]!, was.starts[place]!);
      if (format === '12h') near(now.right, was.right);
    }
    assert.ok(furthest < 0.3, `${format}: the furthest step is ${furthest} em`);
  }
});

test('#717 a centred time is never further off centre than a quarter of the minutes\' range', () => {
  const widths = Array.from({ length: 60 }, (_, minute) => clockRun(INK, String(minute).padStart(2, '0'))!.ink), range = Math.max(...widths) - Math.min(...widths);
  const off = texts('24h').map(text => Math.abs(layout(text, '24h', true).centre));
  assert.ok(Math.max(...off) <= range / 4 + 1e-9, `${Math.max(...off)} against ${range / 4}`);
  near(Math.max(...off), range / 4);
  // Re-centring every minute (no hold) would put every time on the centre and move the hour with every minute.
  assert.ok([...off].sort((a, b) => a - b)[720]! > 0.03, 'the hold is in use');
  // With AM/PM the digits stand where they would without it beside them, and the period after the widest minute:
  // the painted time, digits to period, is that same quarter right of centre at every minute.
  for (const text of texts('12h')) near(layout(text, '12h', true).centre, range / 4);
});

test('#717 a typeface that could not be measured is tried again, not sooner than a minute later', () => {
  assert.equal(dueForMeasuring(undefined, 0), true, 'never measured');
  assert.equal(dueForMeasuring({ ink: INK, at: 0 }, 10 * RETRY_AFTER_MS), false, 'a table is kept');
  assert.equal(dueForMeasuring({ ink: null, at: 1_000 }, 1_000 + RETRY_AFTER_MS - 1), false, 'a failure is left alone at first');
  assert.equal(dueForMeasuring({ ink: null, at: 1_000 }, 1_000 + RETRY_AFTER_MS), true, 'and tried again later');
});
