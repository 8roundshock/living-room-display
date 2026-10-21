import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS, widgetSizes } from '../../../src/shared/widgets.ts';

export const id = 'clock';
export const selectors = ['.clock-calendar', '.analog-clock'];

/** CSS px at 1280×720 (the owner's 4K TV at 300%), scaled with the display height (#222). */
const HOUR_STROKE = 3, MINUTE_STROKE = 2, OUTLINE_STROKE = 1.2;
/** Hand lengths from the pivot as a share of the drawn clock box. */
const HOUR_REACH = 0.3, MINUTE_REACH = 0.45;
const SMALL_TV = { width: 1280, height: 720 };

async function reload(page) { await page.reload(); await page.locator('.display-page').waitFor(); await page.clock.runFor(100); }

/** The clock alone at the top-left corner of the given grid, in the given family and style. */
function only(state, { size, density, style, animation = 'off' }) {
  state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'clock']));
  state.settings.widgetGrid.density = density; state.settings.widgetGrid.placements.clock = { column: 0, row: 0, size };
  state.settings.appearance.clockStyle = style; state.settings.appearance.motionEnabled = false; state.settings.appearance.animation = animation;
}

/**
 * Counts `Intl.DateTimeFormat`/`NumberFormat` constructions over `ticks` one-second ticks inside one
 * minute (#99, #185). The wrapper lives only until the next navigation.
 */
export async function intlPerTicks(page, ticks = 5) {
  const toMinute = await page.evaluate(() => 60_000 - Date.now() % 60_000);
  if (toMinute < (ticks + 2) * 1000) await page.clock.runFor(toMinute + 1500);
  await page.evaluate(() => {
    window.__intlCount = 0;
    for (const name of ['DateTimeFormat', 'NumberFormat']) {
      const original = Intl[name];
      Intl[name] = new Proxy(original, { construct(target, args) { window.__intlCount++; return Reflect.construct(target, args); }, apply(target, self, args) { window.__intlCount++; return Reflect.apply(target, self, args); } });
    }
  });
  const minute = await page.evaluate(() => Math.floor(Date.now() / 60_000));
  await page.clock.runFor(ticks * 1000);
  const [count, after] = await page.evaluate(() => [window.__intlCount, Math.floor(Date.now() / 60_000)]);
  assert.equal(after, minute, 'the measured ticks stay inside one minute');
  return count;
}

/** Rendered analog geometry: computed CSS lengths times the widget fit scale. */
function analogGeometry(widget) {
  return widget.evaluate(section => {
    const fit = new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a;
    const padding = getComputedStyle(section), outer = section.getBoundingClientRect();
    const box = { width: (section.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight)) * fit, height: (section.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom)) * fit };
    const clock = section.querySelector('.analog-clock'), style = getComputedStyle(clock), rect = clock.getBoundingClientRect();
    const size = parseFloat(style.width), text = getComputedStyle(section.closest('.ambient')).color;
    const hand = name => {
      const wrapper = clock.querySelector(`.analog-${name}`), stroke = wrapper.querySelector('.analog-stroke'), computed = getComputedStyle(stroke);
      // Distance from the pivot to the rounded tip, whatever the angle.
      const reach = parseFloat(computed.bottom) + parseFloat(computed.height) - size / 2;
      return { html: wrapper instanceof HTMLElement && !(stroke instanceof SVGElement), stroke: parseFloat(computed.width) * fit, reach: reach / size, color: computed.backgroundColor, text, rotate: getComputedStyle(wrapper).rotate, inline: wrapper.style.rotate };
    };
    const calendar = section.querySelector('.clock-calendar').getBoundingClientRect();
    return {
      fit, box, size: size * fit, square: Math.abs(parseFloat(style.width) - parseFloat(style.height)), clip: style.overflow,
      rect: { left: rect.left - outer.left, top: rect.top - outer.top, right: rect.right - outer.left, bottom: rect.bottom - outer.top, width: rect.width, height: rect.height },
      calendar: { left: calendar.left - outer.left, top: calendar.top - outer.top, right: calendar.right - outer.left, bottom: calendar.bottom - outer.top },
      paddingLeft: parseFloat(padding.paddingLeft) * fit, gap: parseFloat(getComputedStyle(section.querySelector('.clock-face')).columnGap) * fit,
      hour: hand('hour'), minute: hand('minute'), pivot: getComputedStyle(clock.querySelector('.analog-pivot')).backgroundColor, label: clock.getAttribute('aria-label'),
    };
  });
}

function assertAnalog(geometry, { size, density, viewport }) {
  const label = `analog ${size}/${density} ${viewport.width}×${viewport.height}`, scale = viewport.height / 720;
  assert.equal(geometry.fit, 1, `${label}: fits without zooming out`);
  assert.ok(geometry.square < 0.5, `${label}: square box`); assert.equal(geometry.clip, 'clip', `${label}: rotated hands never add overflow`);
  assert.ok(geometry.hour.html && geometry.minute.html, `${label}: hands are HTML elements (composited rotation, #161)`);
  assert.ok(geometry.hour.stroke >= HOUR_STROKE * scale - 0.01, `${label}: hour stroke ${geometry.hour.stroke} ≥ ${HOUR_STROKE * scale}`);
  assert.ok(geometry.minute.stroke >= MINUTE_STROKE * scale - 0.01, `${label}: minute stroke ${geometry.minute.stroke} ≥ ${MINUTE_STROKE * scale}`);
  assert.ok(geometry.hour.stroke > geometry.minute.stroke, `${label}: the hour hand is the heavier one`);
  assert.ok(Math.abs(geometry.hour.reach - HOUR_REACH) < 0.005 && Math.abs(geometry.minute.reach - MINUTE_REACH) < 0.005, `${label}: reach ${geometry.hour.reach}/${geometry.minute.reach} of the box`);
  assert.ok(geometry.minute.reach * geometry.size + geometry.minute.stroke / 2 <= geometry.size / 2 + 0.5, `${label}: the minute tip stays inside the box`);
  assert.equal(geometry.hour.color, geometry.hour.text, `${label}: hour hand in the text colour`); assert.equal(geometry.minute.color, geometry.minute.text, `${label}: minute hand in the text colour`);
  assert.notEqual(geometry.pivot, geometry.hour.text, `${label}: the pivot dot is the dim accent`);
  if (size === 'large') {
    // Centred, with the quiet calendar line below.
    const centre = geometry.paddingLeft + geometry.box.width / 2;
    assert.ok(Math.abs((geometry.rect.left + geometry.rect.right) / 2 - centre) <= 1, `${label}: centred`);
    assert.ok(geometry.calendar.top >= geometry.rect.bottom - 0.5, `${label}: calendar below`);
    return;
  }
  // Small and medium: sized to the cell height, with the date beside the graphic.
  assert.ok(geometry.calendar.left >= geometry.rect.right + geometry.gap - 1, `${label}: date beside the graphic`);
  assert.ok(geometry.calendar.top < geometry.rect.bottom && geometry.calendar.bottom > geometry.rect.top, `${label}: date level with the graphic`);
  const share = geometry.size / geometry.box.height, rowFull = geometry.calendar.right >= geometry.paddingLeft + geometry.box.width - 1;
  assert.ok(share >= 0.89 || (share >= 0.78 && rowFull), `${label}: the graphic uses the cell height (${share.toFixed(3)} of ${geometry.box.height}, row full: ${rowFull})`);
}

/**
 * #332: the medium Clock keeps its date beside its own time. Nothing frames widgets, so the date's gap to its
 * own time (visible text, screen-reader text excluded) must be smaller than its gap to the cell's right edge,
 * beyond which the next widget begins.
 */
async function assertDateGrouped(widget, label) {
  const result = await widget.evaluate(section => {
    const ink = root => {
      const rects = []; const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim() || node.parentElement.closest('.sr-only')) continue;
        const range = document.createRange(); range.selectNodeContents(node); rects.push(...range.getClientRects());
      }
      return { left: Math.min(...rects.map(rect => rect.left)), right: Math.max(...rects.map(rect => rect.right)) };
    };
    const time = ink(section.querySelector('.clock-time')), date = ink(section.querySelector('.clock-calendar')), cell = section.getBoundingClientRect();
    return { fit: new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a, toTime: date.left - time.right, toEdge: cell.right - date.right };
  });
  assert.equal(result.fit, 1, `${label}: fits without zooming out`);
  assert.ok(result.toTime > 0 && result.toTime < result.toEdge, `${label}: the date is ${result.toTime.toFixed(1)} px from its time and ${result.toEdge.toFixed(1)} px from the cell's right edge`);
}

/** Top and bottom ink rows of a RAM screenshot, decoded in the page (data: images are allowed by its CSP). */
async function inkRows(page, buffer) {
  return page.evaluate(async encoded => {
    const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height); let top = -1, bottom = -1;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      if (Math.max(data[index], data[index + 1], data[index + 2]) > 48) { if (top < 0) top = y; bottom = y; break; }
    }
    return { top, bottom };
  }, buffer.toString('base64'));
}

/** The hand angles the clock's own label implies, in [0, 360). */
function expectedAngles(label) {
  const [, hours, minutes] = label.match(/^(\d{1,2}):(\d{2})(?:\s*[AP]M)?$/);
  return { hour: (Number(hours) % 12 + Number(minutes) / 60) * 30, minute: Number(minutes) * 6 };
}

export async function family({ widget, size, density, viewport }) {
  if (size === 'medium' && await widget.locator('.clock-time').count()) await assertDateGrouped(widget, `${await widget.locator('.clock-time').getAttribute('class')} medium/${density} ${viewport.width}`);
  // The Outline style (the default): its stroke never thins below 1.2 px at 720p, scaled (#222).
  if (!await widget.locator('.clock-outline').count()) return;
  const outline = await widget.locator('.clock-digits').evaluate(element => ({ stroke: parseFloat(getComputedStyle(element).webkitTextStrokeWidth), fit: new DOMMatrix(getComputedStyle(element.closest('.widget-content')).transform).a }));
  assert.ok(outline.stroke * outline.fit >= OUTLINE_STROKE * viewport.height / 720 - 0.01, `outline ${size}/${density} ${viewport.width}: stroke ${outline.stroke}`);
}

/**
 * The timer slot (#438): a timer replaces the date line in the same elements and fonts. A synthetic
 * 40-character label and the longest values ("23 h 59 min left · ends tomorrow …", " · offline", "+5").
 */
const TIMER_LABEL = 'Synthetic slow-roast vegetables and rice';
const TIMER_STATES = ['running', 'ticking', 'paused', 'done', 'offline'];
function withTimers(state, kind, now) {
  const at = offset => new Date(now + offset).toISOString(), base = { label: TIMER_LABEL, createdAt: at(-60_000), updatedAt: at(-60_000) };
  const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const lead = kind === 'paused' ? { durationMs: 86_400_000, endsAt: null, remainingMs: 86_340_000 }
    : kind === 'ticking' ? { durationMs: 60_000, endsAt: at(45_000), remainingMs: null }
    : kind === 'done' ? { durationMs: 600_000, endsAt: at(-9 * 60_000 - 5_000), remainingMs: null }
    : { durationMs: 86_400_000, endsAt: at(86_340_000), remainingMs: null };
  // Five more timers, so the slot also says "+5"; a later end (or more left) keeps the lead first.
  const rest = Array.from({ length: 5 }, (_, index) => ({ ...base, id: id(index + 2), label: '', durationMs: 86_400_000, endsAt: kind === 'paused' ? null : at(86_350_000 + index), remainingMs: kind === 'paused' ? 86_350_000 + index : null }));
  state.timers = [{ ...base, id: id(1), ...lead }, ...rest];
}
/** Fit, clipping, floors and colours of the timer slot in the clock at the top-left corner. */
function timerSlot(widget) {
  return widget.evaluate(section => {
    const probe = expression => { const span = document.createElement('span'); span.style.cssText = `position:absolute;visibility:hidden;font-size:${expression}`; section.append(span); const size = parseFloat(getComputedStyle(span).fontSize); span.remove(); return size; };
    const outer = section.getBoundingClientRect(), face = section.querySelector('.clock-face').getBoundingClientRect();
    const fit = new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a;
    const part = selector => {
      const element = section.querySelector(selector); if (!element) return null;
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { text: element.textContent, phase: element.dataset.timerPhase, size: parseFloat(style.fontSize) * fit, color: style.color, left: rect.left - outer.left, right: rect.right - outer.left, top: rect.top - outer.top, bottom: rect.bottom - outer.top, width: rect.width, whiteSpace: style.whiteSpace };
    };
    const name = section.querySelector('.clock-timer-name'), nameStyle = name && getComputedStyle(name);
    return {
      fit, width: outer.width, height: outer.height, faceWidth: face.width, floor: probe('calc(var(--min-text) * var(--font-scale))') * fit,
      caution: getComputedStyle(section.closest('.ambient')).getPropertyValue('--ambient-caution').trim(),
      label: part('.clock-timer-label'), value: part('.clock-timer-value'), date: section.querySelectorAll('.clock-calendar .clock-date:not(.clock-timer-value)').length,
      name: name && { overflow: nameStyle.overflow, ellipsis: nameStyle.textOverflow },
    };
  });
}
function rgb(hex) { const value = Number.parseInt(hex.slice(1), 16); return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`; }

/** Every timer state × style × density × family at each view; returns the number of cases. */
async function timerSweep(page, state, views) {
  let cases = 0, marker = 0;
  // Each case reaches the page through the display's own 5 s change poll (#438) rather than a reload,
  // which keeps these hundreds of cases quick: a new marker, five seconds, then the state request.
  const changes = route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ change: `timer-sweep.${marker}` }) });
  const refresh = async () => {
    marker++;
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/state');
    await page.clock.runFor(5_000); await loaded; await page.clock.runFor(100); await page.waitForTimeout(20);
  };
  await page.route('**/api/changes', changes);
  try {
  for (const view of views) {
    await page.setViewportSize(view);
    only(state, { size: 'large', density: 'balanced', style: 'outline' }); delete state.timers; await reload(page);
    for (const kind of TIMER_STATES) for (const style of ['outline', 'digital', 'analog']) for (const density of Object.keys(GRID_DENSITIES)) for (const size of widgetSizes('clock')) {
      // Offline changes only a large clock (" · offline"); smaller families read exactly as running.
      if (kind === 'offline' && size !== 'large') continue;
      only(state, { size, density, style }); state.settings.clockFormat = '12h';
      withTimers(state, kind, await page.evaluate(() => Date.now()));
      await refresh();
      const label = `timer ${kind} ${style} ${size}/${density} ${view.width}×${view.height}`;
      if (kind === 'offline') {
        // The display has loaded once and then cannot reach the computer: it keeps counting from endsAt.
        await page.unroute('**/api/changes', changes);
        await page.route(/\/api\/(state|changes)$/, route => route.abort());
        try {
          await page.clock.runFor(5_000);
          for (let attempt = 0; !/offline/.test(await page.locator('.clock-timer-value').innerText()); attempt++) { assert.ok(attempt < 100, `${label}: says offline`); await page.waitForTimeout(20); }
        } finally { await page.unroute(/\/api\/(state|changes)$/); await page.route('**/api/changes', changes); }
      }
      const slot = await timerSlot(page.locator('[data-widget-id="clock"]'));
      assert.ok(slot.label && slot.value, `${label}: the date line shows the timer`);
      assert.equal(slot.date, 0, `${label}: the date is replaced, not added`);
      const phase = kind === 'offline' || kind === 'ticking' ? 'running' : kind;
      assert.equal(slot.label.phase, phase, label); assert.equal(slot.value.phase, phase, label);
      assert.match(slot.label.text, /\+5$/, `${label}: "+5" for the other timers`);
      assert.equal(slot.fit, 1, `${label}: the clock fits at 1 (Text 100%) ${JSON.stringify(slot)}`);
      for (const part of [slot.label, slot.value]) {
        assert.ok(part.left >= -1 && part.top >= -1 && part.right <= slot.width + 1 && part.bottom <= slot.height + 1, `${label}: ${part.text} stays inside the widget ${JSON.stringify(part)}`);
        assert.ok(part.size >= slot.floor - 0.01, `${label}: ${part.text} ${part.size}px keeps the ${slot.floor}px floor`);
      }
      assert.equal(slot.label.whiteSpace, 'nowrap', label);
      assert.deepEqual([slot.name.overflow, slot.name.ellipsis], ['hidden', 'ellipsis'], `${label}: a long name ends in an ellipsis`);
      if (size === 'large') assert.ok(slot.label.width <= slot.faceWidth * 0.6 + 1, `${label}: the name takes at most 60% of a large clock (${slot.label.width} of ${slot.faceWidth})`);
      const value = slot.value.text;
      if (kind === 'done') {
        assert.equal(slot.value.color, rgb(slot.caution), `${label}: Done in the status tone`);
        assert.equal(value, size === 'small' ? 'Done' : 'Done · 9 min ago', label);
      } else if (kind === 'ticking') assert.match(value, size === 'large' ? /^[34]\d s left$/ : /^[34]\d s$/, label);
      else if (kind === 'paused') assert.equal(value, size === 'large' ? '23 h 59 min left · paused' : '23 h 59 min', label);
      else {
        assert.match(value, size === 'large' ? /^23 h 5[89] min left · ends tomorrow \d{1,2}:\d{2} [AP]M( · offline)?$/ : /^23 h 5[89] min$/, `${label}: ${value}`);
        if (size === 'large') assert.equal(value.endsWith(' · offline'), kind === 'offline', `${label}: " · offline" only while disconnected`);
      }
      cases++;
    }
  }
  } finally { await page.unroute('**/api/changes', changes); }
  // A running timer outside its final minute builds no Intl formatter on the tick (#99).
  await page.setViewportSize(views.at(-1));
  only(state, { size: 'large', density: 'balanced', style: 'outline' }); withTimers(state, 'running', await page.evaluate(() => Date.now())); await reload(page);
  assert.equal(await intlPerTicks(page), 0, 'a running timer: no Intl formatter per tick while the minute holds');
  delete state.timers;
  return cases;
}

export async function sweep({ page, viewport, state }) {
  // Analog in every family and density at this viewport, and at 720p (with the Outline floor) once.
  const views = viewport.width === 1920 ? [SMALL_TV, viewport] : [viewport];
  const timerCases = await timerSweep(page, state, views);
  const timerSummary = `#438 Clock timer slot: ${timerCases} cases (running, last minute, paused and done in every family, and offline in the large one, × outline/digital/analog × every density at ${views.map(view => `${view.width}×${view.height}`).join(', ')}) fit at 1 with a 40-character name ending in an ellipsis (≤ 60% of a large clock), "+5", the readability floor, Done in the status tone and " · offline"; no Intl formatter per tick`;
  for (const view of views) {
    await page.setViewportSize(view);
    for (const density of Object.keys(GRID_DENSITIES)) for (const size of widgetSizes('clock')) {
      only(state, { size, density, style: 'analog' }); await reload(page);
      assertAnalog(await analogGeometry(page.locator('[data-widget-id="clock"]')), { size, density, viewport: view });
      if (view === SMALL_TV) {
        only(state, { size, density, style: 'outline' }); await reload(page);
        await family({ widget: page.locator('[data-widget-id="clock"]'), size, density, viewport: view });
      }
    }
    // #332: Digital medium too (Outline medium is checked by `family`).
    for (const density of Object.keys(GRID_DENSITIES)) {
      only(state, { size: 'medium', density, style: 'digital' }); await reload(page);
      await assertDateGrouped(page.locator('[data-widget-id="clock"]'), `digital medium/${density} ${view.width}`);
    }
  }
  await page.setViewportSize(viewport);
  if (viewport.width !== 1920) return `Analog clock: every family and density at 720p/1080p/4K fits at 1, hands ≥ 3/2 px at 720p (scaled), 30%/45% reach, text-colour HTML hands with an accent pivot, small/medium sized to the cell height with the date beside; Outline stroke ≥ 1.2 px at 720p (scaled) in every family; medium Outline and Digital keep the date nearer their time than the cell edge (#332). ${timerSummary}`;

  // #363: Classic (Georgia) numerals are lining and tabular: every digit shares one baseline and height. Georgia's
  // default old-style 9 would descend about a fifth of the size below the 0s.
  {
    only(state, { size: 'large', density: 'balanced', style: 'digital' }); state.settings.appearance.fontFamily = 'serif'; await reload(page);
    assert.equal(await page.locator('.clock-time').evaluate(element => getComputedStyle(element).fontVariantNumeric), 'lining-nums tabular-nums', 'Classic clock numerals');
    const digits = [];
    for (const character of await page.locator('.clock-char').all()) {
      const text = await character.textContent(); if (!/\d/.test(text)) continue;
      digits.push({ text, ...await inkRows(page, await character.screenshot()) });
    }
    // 9:xx: an old-style 9 would descend below the 0s and 1s and a 6 or 8 would rise above them.
    assert.match(digits.map(digit => digit.text).join(''), /^9\d\d$/);
    // Round digits overshoot a flat top or baseline by a few percent of their height; old-style figures differ by
    // about a fifth of it.
    const tolerance = Math.max(2, 0.05 * (digits[0].bottom - digits[0].top));
    for (const digit of digits) for (const edge of ['top', 'bottom']) assert.ok(Math.abs(digit[edge] - digits[0][edge]) <= tolerance, `Classic digit ${digit.text} ${edge} ${digit[edge]} vs ${digits[0][edge]} (±${tolerance.toFixed(1)}): ${JSON.stringify(digits)}`);
    state.settings.appearance.fontFamily = 'sans';
  }

  // At rest the geometry is the same at Off, Subtle and Lively (#161), and each hand points where the
  // label says; a minute change at Subtle eases only `rotate` on the HTML hands, and no Intl formatter
  // is built while the minute holds (#99).
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  try {
    let reference;
    for (const animation of ['off', 'subtle', 'lively']) {
      only(state, { size: 'medium', density: 'balanced', style: 'analog', animation }); await reload(page);
      await page.clock.runFor(2_500);
      await page.evaluate(() => { for (const running of document.getAnimations()) if (running.effect?.getTiming().iterations !== Infinity) running.finish(); });
      const geometry = await analogGeometry(page.locator('[data-widget-id="clock"]'));
      assert.equal(await page.locator('.ambient').getAttribute('data-animation'), animation);
      const expected = expectedAngles(geometry.label);
      for (const name of ['hour', 'minute']) assert.ok(Math.abs(((parseFloat(geometry[name].rotate) % 360) + 360) % 360 - expected[name]) < 0.01, `${animation}: ${name} hand at rest ${geometry[name].rotate} for ${geometry.label}`);
      const shape = { rect: geometry.rect, hour: [geometry.hour.stroke, geometry.hour.reach], minute: [geometry.minute.stroke, geometry.minute.reach] };
      reference ??= shape;
      for (const side of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(shape.rect[side] - reference.rect[side]) <= 0.5, `${animation}: clock box ${side} ${shape.rect[side]} vs ${reference.rect[side]}`);
      assert.deepEqual([shape.hour, shape.minute], [reference.hour, reference.minute], `${animation}: hand geometry unchanged`);
      if (animation === 'subtle') {
        const toMinute = await page.evaluate(() => 60_000 - Date.now() % 60_000);
        await page.clock.runFor(toMinute + 1_050);
        const transitions = await page.evaluate(() => document.getAnimations().filter(running => running.effect?.target?.closest?.('.analog-clock')).map(running => ({ property: running.transitionProperty ?? running.animationName, html: running.effect.target instanceof HTMLElement, hand: running.effect.target.classList.contains('analog-hand') })));
        assert.ok(transitions.length >= 1, 'the minute change eases the hands');
        for (const item of transitions) assert.deepEqual(item, { property: 'rotate', html: true, hand: true }, 'only `rotate` on an HTML hand wrapper');
      }
      assert.equal(await intlPerTicks(page), 0, `${animation}: no Intl formatter per tick while the minute holds`);
    }
    only(state, { size: 'large', density: 'balanced', style: 'outline' }); await reload(page);
    assert.equal(await intlPerTicks(page), 0, 'outline: no Intl formatter per tick');
  } finally { await page.emulateMedia({ reducedMotion: 'reduce' }); }
  return `Analog clock at rest: identical box and hand geometry at Off/Subtle/Lively with each hand at its labelled angle; a minute change at Subtle transitions only rotate on HTML hand wrappers; zero Intl formatters per tick within a minute; Classic digits are lining (one baseline and height, #363). ${timerSummary}`;
}
