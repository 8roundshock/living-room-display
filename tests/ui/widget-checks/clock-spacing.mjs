// #717: the Clock's digits never touch or overlap and the gaps between them are even, at rest and while a digit
// changes; and nothing but the changing digits moves when a minute changes. The spacing is measured from what is
// painted, not from layout boxes: each clock character paints one colour channel (red, green, blue in turn), so one
// RAM screenshot tells neighbours apart; the ink of a character is every pixel lit in its channel, outline stroke
// included. Where things stand is read from layout boxes over every minute of a day. Nothing is written to disk.
import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS, widgetSizes } from '../../../src/shared/widgets.ts';
import { waitForWidgetFit } from '../lib/fit-readiness.mjs';
import { mockScreenWakeLock, mockWindowsStatus } from '../lib/windows-fixture.mjs';

export const id = 'clockSpacing';

const CLOCK = '[data-widget-id="clock"]';
const CHANNELS = ['#f00', '#0f0', '#00f'];
/**
 * The measuring colours at full brightness. The display dims its content with a filter; the filter stays (at 1), so
 * the text is rasterised as the display rasterises it. The digit transition is stretched so a frame of it can be
 * held (its geometry is unchanged).
 */
const MEASURING_STYLE = `.ambient-content{filter:brightness(1)!important}.clock-calendar{visibility:hidden!important}.grid-ambient[data-animation]{--motion-digit:600s!important}${CHANNELS.map((color, index) => `.clock-char:nth-child(3n+${index + 1}){color:${color}!important}`).join('')}`;
/** A channel value above this is ink (about a fifth of full coverage; anti-aliased edges below it are not). */
const INK = 48;
/** The rule in widgets.css: the gap is 6% of the digit size and never under 42% of the shared text floor. */
const GAP_OF_SIZE = 0.06, GAP_OF_FLOOR = 0.42;
/**
 * Device px. Glyph positions snap to whole pixels and the bearings are measured to about a thousandth of an em,
 * so painted gaps differ by a few pixels at most (3 measured at 4K, 2 at the smallest clock). The allowance leaves
 * more than a pixel for another rasteriser. Before #717 the large 1080p clock's gaps ran from -12 px (44
 * overlapping) to 65 px (11), and the smallest 720p clock's from -1 to 8 px.
 */
const spreadAllowed = em => 3.5 + 0.005 * em;

/** Representative times: wide and narrow digits, the pairs that used to overlap (44, 04, 48), and every digit. */
const TIMES = ['00:00', '01:11', '10:08', '11:11', '12:34', '20:00', '23:59', '04:48', '20:44', '17:47', '15:36', '09:29'];
const SHORT_TIMES = ['00:00', '11:11', '20:44', '04:48'];
/** 12-hour: 12:00 AM, 10:08 PM, 9:41 AM (one character fewer) and 4:44 PM. */
const HALF_DAY_TIMES = ['00:00', '22:08', '09:41', '16:44'];
/** Minute changes: a wider last digit, two digits changing to narrower ones, and (12-hour) one more character. */
const CHANGES = [{ from: '20:43', format: '24h' }, { from: '20:09', format: '24h' }, { from: '09:59', format: '12h' }];

const spoken = (time, format) => { const [hours, minutes] = time.split(':').map(Number); return format === '12h' ? `${hours % 12 || 12}:${String(minutes).padStart(2, '0')}` : time; };
const digitsText = page => page.locator(`${CLOCK} .clock-digits`).evaluate(digits => [...digits.querySelectorAll('.clock-char')].map(character => character.textContent).join(''));

/** The clock alone at the top-left corner, Text 100%, in the given family, density, style, typeface and format. */
function clockOnly(state, { size, density, style, typeface = 'sans', format = '24h', animation = 'off' }) {
  state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'clock']));
  state.settings.widgetGrid.density = density; state.settings.widgetGrid.placements.clock = { column: 0, row: 0, size };
  Object.assign(state.settings.appearance, { clockStyle: style, fontFamily: typeface, fontScale: 1, motionEnabled: false, animation });
  state.settings.clockFormat = format; delete state.timers;
}

async function open(page) {
  await page.reload(); await page.locator('.display-page').waitFor(); await page.clock.runFor(100);
  await page.addStyleTag({ content: MEASURING_STYLE });
  await waitForWidgetFit(page, CLOCK);
}

/**
 * Sets the page's clock to `time` (HH:MM:20) on its current day, lets the display tick and waits for the digits to say
 * `expected`. With `intoNext` the clock starts at second 59 and runs two seconds, into the next minute.
 */
async function showTime(page, time, expected, intoNext = false) {
  const [hours, minutes] = time.split(':').map(Number);
  const at = await page.evaluate(([hour, minute, second]) => { const day = new Date(); return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, second).getTime(); }, [hours, minutes, intoNext ? 59 : 20]);
  await page.clock.setSystemTime(at); await page.clock.runFor(intoNext ? 2_000 : 1_000);
  for (let attempt = 0; await digitsText(page) !== expected; attempt++) { assert.ok(attempt < 250, `the clock shows ${expected} (it shows ${await digitsText(page)})`); await page.waitForTimeout(20); }
}

/** In the page: the ink box of each character in its own channel, and the pixels two neighbours both paint. */
function scan({ encoded, boxes, reach, ink }) {
  return (async () => {
    const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height), { width, height } = image;
    // A character's ink cannot reach past its neighbours' boxes, and the same channel returns three characters on.
    const spans = boxes.map(box => ({ from: Math.max(0, Math.floor(box.left - reach)), to: Math.min(width - 1, Math.ceil(box.right + reach)) }));
    const inks = spans.map(({ from, to }, index) => {
      let left = Infinity, right = -Infinity;
      for (let y = 0; y < height; y++) for (let x = from; x <= to; x++) if (data[(y * width + x) * 4 + index % 3] > ink) { if (x < left) left = x; if (x > right) right = x; }
      return Number.isFinite(left) ? { left, right } : null;
    });
    const shared = spans.slice(0, -1).map((span, index) => {
      const next = spans[index + 1]; let both = 0;
      for (let y = 0; y < height; y++) for (let x = Math.max(span.from, next.from); x <= Math.min(span.to, next.to); x++) { const offset = (y * width + x) * 4; if (data[offset + index % 3] > ink && data[offset + (index + 1) % 3] > ink) both++; }
      return both;
    });
    return { inks, shared };
  })();
}

/** What the clock paints now: per pair of neighbours the gap between their ink boxes and the pixels both paint (device px). */
async function painted(page) {
  const geometry = await page.locator(CLOCK).evaluate((section, colors) => {
    const probe = expression => { const span = document.createElement('span'); span.style.cssText = `position:absolute;visibility:hidden;font-size:${expression}`; section.append(span); const size = parseFloat(getComputedStyle(span).fontSize); span.remove(); return size; };
    const time = section.querySelector('.clock-time'), digits = time.querySelector('.clock-digits'), characters = [...digits.querySelectorAll('.clock-char')], period = time.querySelector('.clock-period');
    // The AM/PM period joins as one more character, in the next channel.
    if (period) period.style.color = colors[characters.length % 3];
    const box = element => { const bounds = element.getBoundingClientRect(); return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }; };
    return {
      text: characters.map(character => character.textContent).join(''), period: period?.textContent ?? null, dpr: devicePixelRatio, view: [innerWidth, innerHeight],
      size: parseFloat(getComputedStyle(time).fontSize), floor: probe('var(--min-text)'), stroke: parseFloat(getComputedStyle(digits).webkitTextStrokeWidth) || 0,
      spaced: digits.classList.contains('clock-ink'), fit: new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a,
      time: box(time), run: box(digits), boxes: [...characters, ...(period ? [period] : [])].map(box),
    };
  }, CHANNELS);
  const pad = Math.ceil(geometry.size * 0.35), [viewWidth, viewHeight] = geometry.view;
  const clip = { x: Math.max(0, Math.floor(geometry.time.left - pad)), y: Math.max(0, Math.floor(geometry.time.top - pad)) };
  clip.width = Math.min(viewWidth - clip.x, Math.ceil(geometry.time.right + pad) - clip.x); clip.height = Math.min(viewHeight - clip.y, Math.ceil(geometry.time.bottom + pad) - clip.y);
  const shot = await page.screenshot({ clip });
  const toImage = x => (x - clip.x) * geometry.dpr;
  const { inks, shared } = await page.evaluate(scan, { encoded: shot.toString('base64'), boxes: geometry.boxes.map(box => ({ left: toImage(box.left), right: toImage(box.right) })), reach: geometry.size * 0.3 * geometry.dpr, ink: INK });
  const names = [...geometry.text, ...(geometry.period ? [geometry.period] : [])];
  const pairs = names.slice(0, -1).map((name, index) => ({ pair: `${name}${names[index + 1]}`, period: index + 1 === geometry.text.length, both: shared[index], gap: inks[index] && inks[index + 1] ? inks[index + 1].left - inks[index].right - 1 : null }));
  // The gap the stylesheet asks for, in device px, and the run's painted edges against its box.
  const scale = geometry.dpr * geometry.fit, wanted = Math.max(GAP_OF_SIZE * geometry.size, GAP_OF_FLOOR * geometry.floor) * scale;
  const edges = inks[0] && inks[geometry.text.length - 1] ? { left: inks[0].left - toImage(geometry.run.left), right: toImage(geometry.run.right) - inks[geometry.text.length - 1].right - 1 } : null;
  return { text: geometry.text, period: geometry.period, pairs, edges, wanted, em: geometry.size * scale, stroke: geometry.stroke * scale, fit: geometry.fit, spaced: geometry.spaced, boxes: geometry.boxes };
}

/**
 * One painted frame: nothing overlaps and no gap is far under the stylesheet's. Whole-pixel snapping and hinting move
 * an edge by up to a pixel: the smallest clock (a 4.2 px gap at 720p) measures 3 px here, and 2 px is required, so
 * a rasteriser that differs by a pixel still passes while the unfixed clock (0 px and less) fails.
 */
function assertApart(sample, label) {
  const where = `${label} ${sample.text}${sample.period ? ` ${sample.period}` : ''}`;
  for (const pair of sample.pairs) {
    assert.ok(pair.gap !== null, `${where}: "${pair.pair}" is painted`);
    assert.equal(pair.both, 0, `${where}: "${pair.pair}" overlap (${pair.both} px painted by both)`);
    assert.ok(pair.gap >= Math.max(2, 0.7 * sample.wanted - 2), `${where}: "${pair.pair}" are ${pair.gap} px apart, wanted about ${sample.wanted.toFixed(1)} px`);
  }
  // On the suite's own machine the typeface is always measurable; the stylesheet's fallback is checked on its own.
  assert.ok(sample.spaced, `${where}: the digits are spaced by their measured ink (clock-ink)`);
}

/**
 * The stylesheet's fallback, for a typeface the clock cannot measure: tabular figures tracked apart by the stroke and
 * a floor, drawn smaller so they stay inside the measured clock's room. The gaps are the typeface's own (uneven),
 * but nothing touches (3 px and more measured on the smallest 720p clock; 2 required) and the clock fits at 1 at
 * every time, a one-digit hour included.
 */
function assertUnmeasured(samples, label) {
  for (const sample of samples) {
    const where = `${label} ${sample.text}${sample.period ? ` ${sample.period}` : ''}`;
    assert.equal(sample.spaced, false, `${where}: no ink table, so no clock-ink class`);
    assert.equal(sample.fit, 1, `${where}: fits at 1 at Text 100%`);
    for (const pair of sample.pairs) {
      assert.equal(pair.both, 0, `${where}: "${pair.pair}" overlap (${pair.both} px painted by both)`);
      assert.ok(pair.gap >= 2, `${where}: "${pair.pair}" are ${pair.gap} px apart`);
    }
  }
}

/**
 * Where the clock stands now, in CSS px from the left edge of the widget's content box, so the board's and the
 * widget's own float cancel out: where each character's ink starts (its box and its left bearing; and whether it is
 * the same node as before), the time's painted
 * start and end, the AM/PM period, the date line, the fit, and the box the float measures. `floatBox` walks the
 * content as `inkSlack` in Display.tsx does: text, and elements with nothing in them.
 */
function placed(page) {
  return page.locator(CLOCK).evaluate(async section => {
    // The page clock is faked; React commits on a real task after the faked tick.
    for (let turn = 0; turn < 3; turn++) await new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = resolve; channel.port2.postMessage(null); });
    const content = section.querySelector('.widget-content'), origin = content.getBoundingClientRect(), time = section.querySelector('.clock-time'), digits = time.querySelector('.clock-digits');
    const characters = [...digits.querySelectorAll('.clock-char')], period = time.querySelector('.clock-period'), date = section.querySelector('.clock-calendar');
    for (const character of characters) character.__node ??= (window.__clockNodes = (window.__clockNodes ?? 0) + 1);
    const left = element => element.getBoundingClientRect().left - origin.left, right = element => element.getBoundingClientRect().right - origin.left;
    const size = parseFloat(getComputedStyle(time).fontSize), inkStart = character => left(character) + (parseFloat(character.style.getPropertyValue('--ink-left')) || 0) * size;
    const box = { left: Infinity, right: -Infinity }, range = document.createRange();
    const add = rect => { if (rect.width <= 0 && rect.height <= 0) return; box.left = Math.min(box.left, rect.left - origin.left); box.right = Math.max(box.right, rect.right - origin.left); };
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) { if (child.textContent.trim()) { range.selectNodeContents(child); for (const rect of range.getClientRects()) add(rect); } }
        else if (child instanceof Element && !child.classList.contains('sr-only')) { if (child.matches('svg, img, canvas, picture, video, [role="img"]') || !child.firstElementChild && !child.textContent.trim()) add(child.getBoundingClientRect()); else walk(child); }
      }
    };
    walk(content);
    return {
      text: characters.map(character => character.textContent).join(''), nodes: characters.map(character => character.__node), lefts: characters.map(inkStart),
      start: left(digits), end: period ? right(period) : right(digits), period: period ? { text: period.textContent, left: left(period) } : null, date: { text: date.textContent, left: left(date) },
      centre: origin.width / 2, size, fit: new DOMMatrix(getComputedStyle(content).transform).a, scroll: content.scrollWidth, floatBox: box,
    };
  });
}

const middle = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
/**
 * Every minute of a day in one configuration, from layout boxes. A minute change may move only the characters that
 * change: an unchanged character (the same node) moves only when the hour changes, so at most 24 times a day, and
 * within an hour the hour, the colon and the left edge of the minutes stay where they are. The AM/PM period and the
 * date line beside a medium clock do not move with the minute either, and neither does anything the fit or the float
 * measures: the fit is 1 at every minute and the measured boxes keep their edges. A large clock that re-centred
 * every minute (1,295 of 1,440 changes before this rule) fails the first assertion.
 */
async function throughTheDay(page, state, options, label) {
  clockOnly(state, options); await open(page);
  await showTime(page, '00:00', spoken('00:00', options.format ?? '24h'));
  await waitForWidgetFit(page, CLOCK);
  let before = await placed(page); const moves = [], off = [], hourOf = text => text.split(':')[0];
  const note = sample => off.push((sample.start + sample.end) / 2 - sample.centre);
  note(before);
  for (let minute = 1; minute <= 1440; minute++) {
    await page.clock.fastForward(60_000);
    let now = await placed(page);
    for (let attempt = 0; now.text === before.text; attempt++) { assert.ok(attempt < 250, `${label}: the clock moves on from ${before.text}`); await page.waitForTimeout(10); now = await placed(page); }
    const change = `${label} ${before.text} → ${now.text}`, sameHour = hourOf(now.text) === hourOf(before.text), samePeriod = now.period?.text === before.period?.text;
    let furthest = 0;
    now.nodes.forEach((node, index) => { const was = before.nodes.indexOf(node); if (was >= 0) furthest = Math.max(furthest, Math.abs(now.lefts[index] - before.lefts[was])); });
    if (furthest >= 1) { moves.push(furthest); assert.ok(!sameHour, `${change}: an unchanged character moved ${furthest.toFixed(1)} px within the hour`); }
    assert.equal(now.fit, 1, `${change}: fits at 1`);
    if (sameHour) {
      // The hour's digits, the colon and the first minute digit start where they did.
      for (let place = 0; place < hourOf(now.text).length + 2; place++) assert.ok(Math.abs(now.lefts[place] - before.lefts[place]) <= 0.5, `${change}: character ${place} moved from ${before.lefts[place]} to ${now.lefts[place]}`);
      assert.ok(Math.abs(now.floatBox.left - before.floatBox.left) <= 0.5, `${change}: the box the float measures starts at ${now.floatBox.left}, was ${before.floatBox.left}`);
      if (now.period) assert.ok(Math.abs(now.period.left - before.period.left) <= 0.5, `${change}: ${now.period.text} moved from ${before.period.left} to ${now.period.left}`);
    }
    if (samePeriod) {
      // AM and PM differ in width, so a 12-hour clock's edges are compared within each.
      assert.ok(Math.abs(now.floatBox.right - before.floatBox.right) <= 0.5, `${change}: the box the float measures ends at ${now.floatBox.right}, was ${before.floatBox.right}`);
      assert.equal(now.scroll, before.scroll, `${change}: the width the fit measures`);
      if (options.size === 'medium' && now.date.text === before.date.text) assert.ok(Math.abs(now.date.left - before.date.left) <= 0.5, `${change}: the date line moved from ${before.date.left} to ${now.date.left}`);
    }
    note(now); before = now;
  }
  assert.ok(moves.length <= 24, `${label}: ${moves.length} changes a day move an unchanged character`);
  const size = before.size, result = { moves: moves.length, furthest: Math.max(0, ...moves), offMedian: middle(off.map(Math.abs)), offMost: Math.max(...off.map(Math.abs)), offRange: Math.max(...off) - Math.min(...off) };
  if (options.size === 'large') {
    // Centred by its middle minute each hour, so the painted time is never further off centre than a quarter of the
    // minutes' range (0.13 of the digit size in Segoe UI). With AM/PM the digits stand the same way and the period
    // after the widest minute, so the painted time, digits to period, is off by that quarter all day and never
    // shifts (AM and PM differ by a pixel or two).
    assert.ok(result.offMost <= 0.15 * size + 1, `${label}: the time is up to ${result.offMost.toFixed(1)} px off centre (allowed ${(0.15 * size + 1).toFixed(1)})`);
    if (options.format === '12h') assert.ok(result.offRange <= 3, `${label}: the painted time's centre moves over ${result.offRange.toFixed(1)} px through the day`);
    else assert.ok(result.offMedian <= 0.08 * size + 1, `${label}: the time is ${result.offMedian.toFixed(1)} px off centre at the median minute (allowed ${(0.08 * size + 1).toFixed(1)})`);
  }
  return result;
}

/**
 * Float gently on: the widget's content floats inside the room its drawn content leaves. That room must not follow
 * the minute, or the whole clock shifts when a minute changes. One-second steps through three minute changes
 * (9:58 to 10:01 AM, 12-hour, where 10:00 adds a character): the float offset moves no further in a second with a minute
 * change than in any other second, and the room it floats in keeps its edges.
 */
async function floatThroughMinutes(page, state, options, label) {
  clockOnly(state, { ...options, format: '12h' }); state.settings.appearance.motionEnabled = true; state.settings.appearance.motionIntervalSeconds = 30;
  await open(page);
  assert.equal(await page.locator('.ambient').getAttribute('data-float'), 'float', `${label}: the display floats`);
  await showTime(page, '09:57', '9:57');
  const read = () => page.locator(CLOCK).evaluate(section => ({ x: parseFloat(getComputedStyle(section).getPropertyValue('--float-x')) || 0, y: parseFloat(getComputedStyle(section).getPropertyValue('--float-y')) || 0, text: [...section.querySelectorAll('.clock-char')].map(character => character.textContent).join('') }));
  // Let the float leave its starting place first.
  for (let second = 0; second < 40; second++) await page.clock.runFor(1_000);
  let before = await read(), box = (await placed(page)).floatBox; const steps = { change: 0, other: 0, changes: 0 };
  for (let second = 0; second < 200; second++) {
    await page.clock.runFor(1_000);
    let now = await read(); const moved = Math.max(Math.abs(now.x - before.x), Math.abs(now.y - before.y));
    if (now.text !== before.text) {
      steps.changes++; steps.change = Math.max(steps.change, moved);
      const after = (await placed(page)).floatBox, sameHour = now.text.split(':')[0] === before.text.split(':')[0];
      assert.ok(Math.abs(after.right - box.right) <= 0.5 && (!sameHour || Math.abs(after.left - box.left) <= 0.5), `${label} ${before.text} → ${now.text}: the box the float measures went from ${JSON.stringify(box)} to ${JSON.stringify(after)}`);
      box = after;
    } else steps.other = Math.max(steps.other, moved);
    before = now;
  }
  assert.ok(steps.changes >= 3, `${label}: ${steps.changes} minute changes seen`);
  assert.ok(steps.other > 0, `${label}: the content floats`);
  assert.ok(steps.change <= steps.other + 0.5, `${label}: the float moved ${steps.change} px in the second of a minute change, ${steps.other} px in any other second`);
  state.settings.appearance.motionEnabled = false;
  return steps;
}

/** A clock at rest over several times: apart, fit 1, even gaps (digits and colon alike) and painted edges on the run's box. */
function assertEven(samples, label) {
  const gaps = [];
  for (const sample of samples) {
    assertApart(sample, label);
    assert.equal(sample.fit, 1, `${label} ${sample.text}: fits at 1 at Text 100%`);
    for (const pair of sample.pairs) if (!pair.period) gaps.push({ gap: pair.gap, pair: pair.pair, text: sample.text });
    // A mitred corner (the tip of a 4 or a 1) may reach one stroke past the ink box.
    for (const side of ['left', 'right']) assert.ok(Math.abs(sample.edges[side]) <= sample.stroke + 2 + 0.005 * sample.em, `${label} ${sample.text}: the run's ${side} edge is ${sample.edges[side]} px from its ink`);
  }
  gaps.sort((a, b) => a.gap - b.gap);
  const tightest = gaps[0], widest = gaps.at(-1), { em, wanted } = samples[0];
  assert.ok(widest.gap - tightest.gap <= spreadAllowed(em), `${label}: gaps run from ${tightest.gap} px ("${tightest.pair}" in ${tightest.text}) to ${widest.gap} px ("${widest.pair}" in ${widest.text}); even within ${spreadAllowed(em).toFixed(1)} px`);
  assert.ok(widest.gap <= 1.3 * wanted + 3, `${label}: "${widest.pair}" in ${widest.text} are ${widest.gap} px apart, wanted about ${wanted.toFixed(1)} px`);
  return { tightest: tightest.gap, widest: widest.gap, pairs: gaps.length };
}

/** Every time of `times` at rest in one configuration. */
async function atRest(page, state, options, times) {
  clockOnly(state, options); await open(page);
  const samples = [];
  for (const time of times) { await showTime(page, time, spoken(time, options.format ?? '24h')); await waitForWidgetFit(page, CLOCK); samples.push(await painted(page)); }
  return samples;
}

/**
 * A minute change at Subtle or Lively, held at three points of the digit transition. The new characters fade and
 * settle in place: every character already has its final box in the first frame, so no width changes while
 * anything moves, and no frame has an overlap.
 */
async function minuteChange(page, { from, format }, label) {
  const [hours, minutes] = from.split(':').map(Number), to = `${String(hours + (minutes === 59 ? 1 : 0)).padStart(2, '0')}:${String((minutes + 1) % 60).padStart(2, '0')}`;
  await showTime(page, from, spoken(from, format)); await waitForWidgetFit(page, CLOCK);
  await page.evaluate(() => { for (const running of document.getAnimations()) if (running.effect?.getTiming().iterations !== Infinity) running.finish(); });
  await showTime(page, from, spoken(to, format), true);
  const hold = progress => page.evaluate(share => {
    const running = document.getAnimations().filter(animation => animation.effect?.target?.classList?.contains('clock-char'));
    for (const animation of running) { animation.pause(); animation.currentTime = animation.effect.getComputedTiming().endTime * share; }
    return running.length;
  }, progress);
  const frames = [];
  for (const progress of [0.1, 0.4, 1]) {
    assert.ok(await hold(progress) > 0, `${label} ${from}: the new characters transition in`);
    const frame = await painted(page); assertApart(frame, `${label} ${from} → ${to} at ${progress * 100}%`); frames.push(frame);
  }
  for (const frame of frames.slice(0, -1)) frame.boxes.forEach((box, index) => { for (const side of ['left', 'right']) assert.ok(Math.abs(box[side] - frames.at(-1).boxes[index][side]) <= 0.5, `${label} ${from} → ${to}: character ${index} keeps its box through the transition (${side} ${box[side]} then ${frames.at(-1).boxes[index][side]})`); });
  await page.evaluate(() => { for (const running of document.getAnimations()) if (running.effect?.getTiming().iterations !== Infinity) running.finish(); });
  return frames.length;
}

export async function sweep({ page, viewport, state, base }) {
  const started = await page.evaluate(() => Date.now()), densities = Object.keys(GRID_DENSITIES), families = widgetSizes('clock');
  // 720p rides on the 1080p pass, as in the Clock sweep.
  const views = viewport.width === 1920 ? [{ width: 1280, height: 720 }, viewport] : [viewport];
  let cases = 0, frames = 0; const range = { tightest: Infinity, widest: -Infinity }, days = {};
  const record = (samples, label) => { const result = assertEven(samples, label); cases++; frames += samples.length; return result; };
  try {
    for (const view of views) {
      await page.setViewportSize(view);
      const at = `${view.width}×${view.height}`;
      // The large Balanced clock (the default board's): Outline in every typeface over every time, Digital over the
      // times that used to overlap (every typeface at 1080p).
      const full = view.width === 1920;
      for (const typeface of ['sans', 'serif', 'mono']) {
        const result = record(await atRest(page, state, { size: 'large', density: 'balanced', style: 'outline', typeface }, typeface === 'sans' || full ? TIMES : SHORT_TIMES), `outline ${typeface} large/balanced ${at}`);
        if (full && typeface === 'sans') Object.assign(range, result);
        if (typeface === 'sans' || full) record(await atRest(page, state, { size: 'large', density: 'balanced', style: 'digital', typeface }, SHORT_TIMES), `digital ${typeface} large/balanced ${at}`);
      }
      // Every family and density in the default style and typeface; at 1080p the other typefaces' smallest clocks too.
      for (const density of densities) for (const size of families) if (!(density === 'balanced' && size === 'large')) record(await atRest(page, state, { size, density, style: 'outline' }, SHORT_TIMES), `outline sans ${size}/${density} ${at}`);
      if (full) for (const typeface of ['serif', 'mono']) for (const size of ['small', 'medium']) record(await atRest(page, state, { size, density: 'fine', style: 'outline', typeface }, SHORT_TIMES), `outline ${typeface} ${size}/fine ${at}`);
      // 12-hour: the AM/PM period stays clear of the last digit too.
      for (const size of full ? families : ['large']) record(await atRest(page, state, { size, density: size === 'small' ? 'fine' : 'balanced', style: 'outline', format: '12h' }, HALF_DAY_TIMES), `outline sans ${size} 12-hour ${at}`);
    }
    await page.setViewportSize(viewport);
    if (viewport.width !== 1920) return `#717 Clock digit spacing at 4K: ${cases} configurations, ${frames} painted times (as at 1080p).`;

    // The timer slot shares the face: the digits keep their spacing while the date line shows a timer.
    {
      clockOnly(state, { size: 'large', density: 'balanced', style: 'outline' });
      const now = await page.evaluate(() => Date.now()), stamp = offset => new Date(now + offset).toISOString();
      state.timers = [{ id: '00000000-0000-4000-8000-000000000717', label: 'Synthetic timer', durationMs: 86_400_000, endsAt: stamp(86_340_000), remainingMs: null, createdAt: stamp(-60_000), updatedAt: stamp(-60_000) }];
      await open(page);
      await page.locator(`${CLOCK} .clock-timer-value`).waitFor({ state: 'attached' });
      const samples = [];
      for (const time of ['20:44', '11:11']) { await showTime(page, time, time); await waitForWidgetFit(page, CLOCK); samples.push(await painted(page)); }
      record(samples, 'outline sans large with a timer');
      // The slot's own text keeps the typeface's natural spacing (nothing pulls its figures together).
      const tracking = await page.locator(`${CLOCK} .clock-timer-value`).evaluate(element => getComputedStyle(element).letterSpacing);
      assert.ok(tracking === 'normal' || parseFloat(tracking) >= 0, `the timer slot is never tracked tighter than its typeface (${tracking})`);
      delete state.timers;
    }

    // Every minute of a day: the large clock in both formats (placed once an hour), the medium clock (the date line
    // never moves) and the small one.
    days.day = await throughTheDay(page, state, { size: 'large', density: 'balanced', style: 'outline' }, 'large 24-hour');
    days.half = await throughTheDay(page, state, { size: 'large', density: 'balanced', style: 'outline', format: '12h' }, 'large 12-hour');
    await throughTheDay(page, state, { size: 'medium', density: 'balanced', style: 'outline', format: '12h' }, 'medium 12-hour');
    await throughTheDay(page, state, { size: 'small', density: 'balanced', style: 'digital' }, 'small 24-hour');

    // Pages of their own. Scale factors: the owner's 4K TV shows 1280×720 CSS px at 300%; 150% and 200% of a 4K
    // panel too. And pages whose canvas reports another advance than its text, at 720p and 1080p, so the clock
    // cannot trust its ink table and keeps the stylesheet's fallback.
    const browser = page.context().browser();
    let unmeasuredFrames = 0;
    const UNMEASURED = [
      { size: 'large', density: 'balanced', style: 'outline' }, { size: 'small', density: 'fine', style: 'outline' }, { size: 'medium', density: 'balanced', style: 'digital', typeface: 'serif' },
      // 12-hour, where a one-digit hour must take the room of two: the smallest clocks in every typeface.
      { size: 'small', density: 'fine', style: 'outline', format: '12h' }, { size: 'small', density: 'fine', style: 'outline', typeface: 'serif', format: '12h' }, { size: 'small', density: 'fine', style: 'outline', typeface: 'mono', format: '12h' },
      { size: 'small', density: 'balanced', style: 'digital', typeface: 'mono', format: '12h' }, { size: 'medium', density: 'fine', style: 'outline', typeface: 'mono', format: '12h' },
    ];
    for (const { view, deviceScaleFactor = 1, unmeasured = false } of [{ view: { width: 1280, height: 720 }, deviceScaleFactor: 3 }, { view: { width: 2560, height: 1440 }, deviceScaleFactor: 1.5 }, { view: { width: 1920, height: 1080 }, deviceScaleFactor: 2 }, { view: { width: 1280, height: 720 }, unmeasured: true }, { view: { width: 1920, height: 1080 }, unmeasured: true }]) {
      const context = await browser.newContext({ viewport: view, deviceScaleFactor, timezoneId: 'America/Toronto', reducedMotion: 'reduce' });
      try {
        await mockWindowsStatus(context); await mockScreenWakeLock(context);
        if (unmeasured) await context.addInitScript(() => {
          const measure = CanvasRenderingContext2D.prototype.measureText;
          CanvasRenderingContext2D.prototype.measureText = function (text) { const metrics = measure.call(this, text); return { width: metrics.width * 1.5, actualBoundingBoxLeft: metrics.actualBoundingBoxLeft, actualBoundingBoxRight: metrics.actualBoundingBoxRight }; };
        });
        const other = structuredClone(state);
        await context.route('**/api/state', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(other) }));
        const otherPage = await context.newPage();
        await otherPage.clock.install({ time: new Date(started) });
        for (const options of unmeasured ? UNMEASURED : [{ size: 'large', density: 'balanced', style: 'outline' }]) {
          clockOnly(other, options);
          await otherPage.goto(`${base}/display`); await otherPage.locator('.display-page').waitFor(); await otherPage.clock.runFor(100);
          await otherPage.addStyleTag({ content: MEASURING_STYLE }); await waitForWidgetFit(otherPage, CLOCK);
          const samples = [], format = options.format ?? '24h';
          // 12-hour: 9:59 and 10:00 (one character more) must have the same fit, with 12:00 AM and 4:44 PM.
          for (const time of format === '12h' ? ['09:59', '10:00', '00:00', '16:44'] : SHORT_TIMES) { await showTime(otherPage, time, spoken(time, format)); await waitForWidgetFit(otherPage, CLOCK); samples.push(await painted(otherPage)); }
          if (unmeasured) { assertUnmeasured(samples, `unmeasured ${options.style} ${options.typeface ?? 'sans'} ${options.size}/${options.density} ${format} ${view.width}×${view.height}`); unmeasuredFrames += samples.length; }
          else record(samples, `outline sans large/balanced ${view.width}×${view.height} ×${deviceScaleFactor}`);
        }
      } finally { await context.close(); }
    }
    await page.bringToFront();

    // While a digit changes (Subtle and Lively need motion allowed), and while the display floats.
    let held = 0, floated;
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    try {
      floated = await floatThroughMinutes(page, state, { size: 'small', density: 'balanced', style: 'outline' }, 'float, small Balanced');
      await floatThroughMinutes(page, state, { size: 'medium', density: 'fine', style: 'outline' }, 'float, medium Fine');
      for (const animation of ['subtle', 'lively']) for (const change of CHANGES) {
        clockOnly(state, { size: 'large', density: 'balanced', style: 'outline', format: change.format, animation }); await open(page);
        assert.equal(await page.locator('.ambient').getAttribute('data-animation'), animation);
        held += await minuteChange(page, change, `${animation} outline sans large`);
      }
    } finally { await page.emulateMedia({ reducedMotion: 'reduce' }); }
    return `#717 Clock digit spacing, measured from painted pixels: ${cases} configurations and ${frames} painted times (Outline × System/Classic/Monospace on the large Balanced clock over ${TIMES.length} times, Digital over the ${SHORT_TIMES.length} that overlapped; every family × density; 12-hour with AM/PM; a timer in the date line; 720p, 1080p and scale factors 1.5, 2 and 3) have no overlap, fit 1 and gaps even within ${spreadAllowed(302).toFixed(1)} px at a 302 px digit size (the 1080p outline clock's gaps run ${range.tightest}–${range.widest} px; before #717 they ran from -12 to 65 px); ${held} held frames of minute changes at Subtle and Lively keep every character's box and never overlap; with an unmeasurable typeface (${unmeasuredFrames} painted times at 720p and 1080p, 12-hour included) the fallback keeps tabular figures apart at fit 1. Every minute of a day (large 24- and 12-hour, medium, small): an unchanged character moves at ${days.day.moves} changes in 24-hour (all at the hour, up to ${days.day.furthest.toFixed(1)} px) and ${days.half.moves} in 12-hour (up to ${days.half.furthest.toFixed(1)} px); the large 24-hour time is off centre by ${days.day.offMedian.toFixed(1)} px at the median minute and ${days.day.offMost.toFixed(1)} px at most, and the 12-hour one, digits to AM/PM, by a steady ${days.half.offMost.toFixed(1)} px; AM/PM, the medium date line, the fit (1) and the box the float measures do not move within the hour. Floating, the offset moves ${floated.change} px in the second of a minute change and ${floated.other} px in any other second`;
  } finally {
    // Later sweeps read the fixture's own moment.
    await page.clock.setSystemTime(started);
  }
}
