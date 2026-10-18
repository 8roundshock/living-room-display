// #76 Animation levels in production Edge. Own loopback server on port 0, temporary data,
// synthetic weather/images and RAM-only state; no screenshots are written.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture, photoFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { ACTIVE_WIDGET_IDS, WIDGET_IDS, widgetRevealOrder, widgetSizes } from '../../src/shared/widgets.ts';
import { WIDGET_CHECKS } from './widget-checks/index.mjs';

const ALLOWED_PROPERTIES = new Set(['transform', 'translate', 'rotate', 'scale', 'opacity']);
const LEVELS = ['off', 'subtle', 'lively'];

export async function runMotionQa({ playwright, edge, performance = true } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-motion-'));
  const now = Date.parse('2026-10-18T13:00:00Z'); // 9:00 in America/Toronto
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), now: () => now, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], errors = [], metrics = {};
  const contexts = new Set();
  const image = photoFixture(64, 40, Buffer.alloc((64 * 4 + 1) * 40, 60));
  const source = await (await fetch(`${base}/api/state`)).json();
  for (const check of Object.values(WIDGET_CHECKS)) check.prepare?.(source, { now });

  /** A display page whose /api/state is the synthetic `served.state` (or a 503 while offline). */
  async function displayPage({ state, time = now, reducedMotion = 'no-preference', viewport = { width: 1280, height: 720 }, clock = true, deviceScaleFactor = 1, path = '/display' }) {
    const context = await browser.newContext({ viewport, deviceScaleFactor, timezoneId: 'America/Toronto', reducedMotion }); contexts.add(context);
    const served = { state: structuredClone(state), offline: false };
    await context.route('**/api/state', route => route.fulfill(served.offline ? { status: 503, contentType: 'application/json', body: '{"error":"Synthetic offline"}' } : { status: 200, contentType: 'application/json', body: JSON.stringify(served.state) }));
    await context.route('**/api/photo/image?*', route => route.fulfill({ contentType: 'image/png', body: image }));
    await context.route('**/api/preview/image?*', route => route.fulfill({ contentType: 'image/png', body: image }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/503|Synthetic offline/.test(message.text())) errors.push(message.text()); });
    if (clock) await page.clock.install({ time: new Date(time) });
    await page.goto(base + path);
    await page.locator(path.startsWith('/display') ? '.display-page' : '.studio').waitFor();
    if (clock) await page.clock.runFor(50);
    return { page, context, served, async close() { contexts.delete(context); await context.close(); } };
  }
  function scenario(mutate) {
    const state = structuredClone(source);
    mutate?.(state);
    return state;
  }
  const level = animation => state => { state.settings.appearance.animation = animation; };
  const inventory = page => page.evaluate(names => {
    const plane = document.querySelector('.widget-grid-plane');
    return document.getAnimations().filter(animation => animation.effect?.target && plane?.contains(animation.effect.target)).map(animation => {
      const timing = animation.effect.getTiming(), target = animation.effect.target, keyframes = animation.effect.getKeyframes();
      return {
        name: animation.animationName ?? `transition:${animation.transitionProperty}`,
        iterations: timing.iterations, duration: timing.duration, delay: timing.delay, playState: animation.playState,
        plane: target === plane, hero: Boolean(target.closest('[data-glyph-hero]')), part: target.closest('.glyph-part')?.dataset.glyphPart ?? null,
        properties: [...new Set(keyframes.flatMap(frame => Object.keys(frame)).filter(key => !names.includes(key)))],
        opacities: keyframes.filter(frame => frame.opacity !== undefined).map(frame => Number(frame.opacity)),
      };
    });
  }, ['offset', 'computedOffset', 'easing', 'composite']);
  function assertCompositable(list, label) {
    for (const animation of list) {
      if (animation.plane && animation.name === 'grid-plane-drift') continue;
      if (animation.name.startsWith('transition:')) continue; // checked separately where they occur
      for (const property of animation.properties) assert.ok(ALLOWED_PROPERTIES.has(property), `${label}: ${animation.name} animates ${property}`);
      for (const opacity of animation.opacities) assert.ok(opacity <= 1, `${label}: ${animation.name} opacity ${opacity}`);
    }
  }
  /** Polls from Node (page timers may be faked by page.clock). */
  async function until(page, predicate, label) {
    for (let attempt = 0; attempt < 150; attempt++) { if (await page.evaluate(predicate)) return; await page.waitForTimeout(40); }
    throw new Error(`Timed out waiting for ${label}`);
  }
  const loops = list => list.filter(animation => animation.iterations === Infinity && !(animation.plane && animation.name === 'grid-plane-drift'));

  try {
    // (1) The root reports the effective level; reduced motion reports Off and still relocates.
    for (const animation of LEVELS) {
      const view = await displayPage({ state: scenario(level(animation)) });
      assert.equal(await view.page.locator('.ambient').getAttribute('data-animation'), animation);
      assert.equal(await view.page.locator('.ambient').getAttribute('data-motion-surface'), 'display');
      await view.close();
      const reduced = await displayPage({ state: scenario(level(animation)), reducedMotion: 'reduce' });
      assert.equal(await reduced.page.locator('.ambient').getAttribute('data-animation'), 'off', `${animation} under reduced motion`);
      assert.equal(await reduced.page.locator('.widget-grid-plane.revealing').count(), 0);
      await reduced.page.clock.runFor(185_000);
      assert.ok(Number(await reduced.page.locator('.ambient').getAttribute('data-composition')) > 0, 'reduced motion still relocates');
      assert.equal((await inventory(reduced.page)).length, 0, 'reduced motion leaves nothing running in the plane');
      await reduced.close();
    }
    checks.push('effective data-animation per level; reduced motion reports Off, runs nothing and still relocates through black');

    // (2) Inventory: Off/Subtle never loop; Lively loops only on hero-glyph layers, ≤3, each ≥1.2 s.
    const conditions = { sun: [0, true], moon: [0, false], cloud: [3, true], rain: [61, true], snow: [71, true], storm: [95, true] };
    for (const animation of LEVELS) for (const [glyph, [code, isDay]] of Object.entries(conditions)) {
      const view = await displayPage({ state: scenario(state => { level(animation)(state); state.weather.current.weatherCode = code; state.weather.current.isDay = isDay; }) });
      const { page } = view;
      assert.equal(await page.locator('.weather-symbol').getAttribute('data-glyph'), glyph);
      const during = await inventory(page);
      assertCompositable(during, `${animation}/${glyph} reveal`);
      if (animation === 'off') {
        assert.equal(during.filter(item => !(item.plane && item.name === 'grid-plane-drift')).length, 0, 'Off has no widget motion');
        // Resting pixels: the stacked parts render exactly like one SVG holding the same paths.
        await page.evaluate(() => {
          const glyph = document.querySelector('.weather-symbol'), parts = [...glyph.querySelectorAll('.glyph-part svg')];
          const stage = document.createElement('div'); stage.id = 'parity'; stage.style.cssText = 'position:fixed;inset:0;z-index:99;background:#000;color:#b8c1ca';
          const single = parts[0].cloneNode(false); single.innerHTML = parts.map(svg => svg.innerHTML).join(''); single.id = 'single';
          const stacked = glyph.cloneNode(true); stacked.id = 'stacked';
          for (const [element, left] of [[single, 20], [stacked, 200]]) { element.removeAttribute('class'); element.style.cssText = `position:absolute;top:20px;left:${left}px;width:96px;height:96px;display:block`; stage.append(element); }
          for (const part of stacked.querySelectorAll('.glyph-part')) part.style.cssText = 'position:absolute;inset:0;display:block';
          document.body.append(stage);
        });
        const single = await page.locator('#single').screenshot(), stacked = await page.locator('#stacked').screenshot();
        assert.ok(single.equals(stacked), `${glyph}: stacked glyph pixels match a single SVG`);
        await page.evaluate(() => document.getElementById('parity').remove());
      }
      await page.clock.runFor(2_500);
      assert.equal(await page.locator('.widget-grid-plane.revealing').count(), 0);
      const rest = await inventory(page);
      assertCompositable(rest, `${animation}/${glyph} rest`);
      const looping = loops(rest);
      if (animation !== 'lively') assert.equal(looping.length, 0, `${animation}/${glyph}: no loops`);
      else {
        assert.ok(looping.length >= 1 && looping.length <= 3, `${glyph}: ${looping.length} loops`);
        for (const item of looping) {
          assert.ok(item.hero && item.part, `${glyph}: loop ${item.name} on a hero glyph layer`);
          assert.ok(item.duration >= 1200, `${glyph}: ${item.name} cycle ${item.duration}`);
          if (item.name === 'lrd-glyph-bolt') assert.ok(item.duration >= 8000, 'bolt period');
        }
        // Loops pause during the black rest.
        await page.clock.runFor(178_000);
        assert.equal(await page.locator('.widget-grid-plane.fading').count(), 1);
        assert.ok(loops(await inventory(page)).every(item => item.playState === 'paused'), `${glyph}: loops pause on black`);
      }
      await view.close();
    }
    checks.push('getAnimations inventory: Off/Subtle zero loops; Lively ≤3 hero-glyph loops ≥1.2 s (bolt ≥8 s) that pause on black; only transform/opacity keyframes, opacity ≤1; stacked glyph pixels equal one SVG at rest');

    // (3) Stale, offline or unavailable weather keeps the glyph still.
    for (const status of ['stale', 'offline', 'unavailable']) {
      const view = await displayPage({ state: scenario(state => { level('lively')(state); state.weather.current.weatherCode = 61; if (status === 'stale') state.weather.status = 'stale'; if (status === 'unavailable') Object.assign(state.weather, { status: 'unavailable', current: null }); }) });
      if (status === 'offline') { view.served.offline = true; await view.page.clock.runFor(30_000); await until(view.page, () => /Offline/.test(document.querySelector('.ambient-weather')?.textContent ?? ''), 'offline weather'); }
      await view.page.clock.runFor(2_500);
      const glyph = view.page.locator('.weather-symbol');
      if (status === 'unavailable') assert.equal(await glyph.count(), 0);
      else assert.equal(await glyph.getAttribute('data-glyph-still'), 'true', status);
      const glyphMotion = (await inventory(view.page)).filter(item => item.part);
      assert.equal(glyphMotion.length, 0, `${status}: no running glyph animation ${JSON.stringify(glyphMotion)}`);
      await view.close();
    }
    checks.push('stale, offline and unavailable weather: still glyph, nothing running on it');

    // (4) Reveal sequence: black first, recomposition only while black, then a bounded reveal.
    async function observeCycle(mutate) {
      const view = await displayPage({ state: scenario(mutate) });
      const { page } = view;
      await page.clock.runFor(2_500);
      await page.evaluate(() => {
        window.__motion = [];
        const ambient = document.querySelector('.ambient'), plane = document.querySelector('.widget-grid-plane');
        const record = () => window.__motion.push({ t: Date.now(), composition: ambient.dataset.composition, fading: plane.classList.contains('fading'), revealing: plane.classList.contains('revealing'), reveal: plane.dataset.reveal ?? null });
        new MutationObserver(record).observe(ambient, { attributes: true, subtree: true, attributeFilter: ['data-composition', 'class', 'data-reveal'] });
        record();
      });
      await page.clock.runFor(180_000);
      for (let step = 0; step < 12; step++) await page.clock.runFor(100);
      // Delays of the entrance follow reading order while revealing.
      const delays = await page.evaluate(() => [...document.querySelectorAll('.widget-grid-plane.revealing > .ambient-widget')].map(section => ({
        id: section.dataset.widgetId, order: Number(getComputedStyle(section).getPropertyValue('--reveal-order')),
        delay: section.querySelector('.widget-content').getAnimations().find(animation => animation.animationName === 'lrd-enter')?.effect.getTiming().delay ?? null,
      })));
      for (let step = 0; step < 50; step++) await page.clock.runFor(100);
      const log = await page.evaluate(() => window.__motion);
      const state = await page.evaluate(() => fetch('/api/state').then(response => response.json()));
      await view.close();
      return { log, delays, state };
    }
    const fadeMs = source.settings.appearance.fadeSeconds * 1000;
    for (const animation of ['subtle', 'lively']) {
      const { log, delays } = await observeCycle(level(animation));
      const firstComposition = log[0].composition;
      const changed = log.find(entry => entry.composition !== firstComposition);
      assert.ok(changed, 'the composition advanced');
      const fadedAt = log.find(entry => entry.fading)?.t;
      assert.ok(fadedAt !== undefined && fadedAt <= changed.t, '.fading before the composition changes');
      for (let index = 1; index < log.length; index++) if (log[index].composition !== log[index - 1].composition) assert.ok(log[index].fading, 'composition changes only while black');
      const revealed = log.find(entry => entry.revealing && entry.t >= changed.t);
      assert.ok(revealed && revealed.reveal !== null, '.revealing with data-reveal after the black rest');
      assert.ok(!revealed.fading, 'never fading and revealing at once');
      const ended = log.find(entry => !entry.revealing && entry.t > revealed.t);
      assert.ok(ended && ended.t - revealed.t <= fadeMs + 1700, `reveal ends within fade + 1.7 s (${ended && ended.t - revealed.t} ms)`);
      const ordered = delays.filter(item => item.delay !== null).sort((a, b) => a.order - b.order);
      assert.ok(ordered.length >= 3, `${animation}: widgets entered (${JSON.stringify(delays)})`);
      for (let index = 1; index < ordered.length; index++) assert.ok(ordered[index].delay >= ordered[index - 1].delay, 'delays follow reading order');
      assert.ok(ordered.at(-1).delay > ordered[0].delay, 'a real stagger');
      assert.ok(ordered.at(-1).delay <= 6 * (animation === 'lively' ? 110 : 70), 'stagger capped at six steps');
    }
    for (const [label, mutate] of [['Soft motion off', state => { state.settings.appearance.motionEnabled = false; }], ['fade 0', state => { state.settings.appearance.fadeSeconds = 0; }]]) {
      const { log } = await observeCycle(state => { level('lively')(state); mutate(state); });
      assert.ok(log.some(entry => entry.composition !== log[0].composition), `${label}: still relocates`);
      assert.equal(log.filter(entry => entry.revealing).length, 0, `${label}: no entrance`);
    }
    // Reading order matches the shared helper.
    {
      const view = await displayPage({ state: scenario(level('subtle')) });
      const sections = await view.page.evaluate(() => [...document.querySelectorAll('.ambient-widget')].map(section => ({ id: section.dataset.widgetId, order: Number(section.style.getPropertyValue('--reveal-order')) })));
      const expected = widgetRevealOrder(source.settings.widgetGrid, sections.map(section => section.id));
      for (const section of sections) assert.equal(section.order, Math.min(expected.indexOf(section.id), 6), `${section.id} reading order`);
      await view.close();
    }
    checks.push('reveal: .fading before recomposition, composition only while black, .revealing[data-reveal] ends within fade + 1.7 s, delays in reading order (cap 6); none with Soft motion off or fade 0');

    // (5) Paused halfway through the entrance, content stays in its rectangle and keeps its fit.
    async function midReveal(page, label, disjoint) {
      const sample = await page.evaluate(() => {
        const plane = document.querySelector('.widget-grid-plane');
        let paused = 0;
        for (const animation of document.getAnimations()) {
          if (!plane.contains(animation.effect?.target) || animation.effect.getTiming().iterations === Infinity) continue;
          const timing = animation.effect.getTiming(); animation.pause(); animation.currentTime = timing.delay + timing.duration / 2; paused++;
        }
        const read = () => [...document.querySelectorAll('.ambient-widget')].map(section => {
          const content = section.querySelector('.widget-content'), outer = section.getBoundingClientRect(), inner = content.getBoundingClientRect();
          return { id: section.dataset.widgetId, outer: { left: outer.left, top: outer.top, right: outer.right, bottom: outer.bottom }, inner: { left: inner.left, top: inner.top, right: inner.right, bottom: inner.bottom }, fit: content.style.transform, translate: getComputedStyle(content).translate };
        });
        const middle = read();
        for (const animation of document.getAnimations()) if (plane.contains(animation.effect?.target) && animation.effect.getTiming().iterations !== Infinity) animation.finish();
        return { paused, middle, rest: read() };
      });
      assert.ok(sample.paused > 0, `${label}: an entrance was running`);
      assert.ok(sample.middle.some(item => item.translate !== 'none' && item.translate !== '0px'), `${label}: content is mid-settle`);
      for (const [index, item] of sample.middle.entries()) {
        for (const side of ['left', 'top']) assert.ok(item.inner[side] >= item.outer[side] - 0.5, `${label} ${item.id} ${side} ${item.inner[side]} < ${item.outer[side]}`);
        for (const side of ['right', 'bottom']) assert.ok(item.inner[side] <= item.outer[side] + 0.5, `${label} ${item.id} ${side} ${item.inner[side]} > ${item.outer[side]}`);
        assert.equal(item.fit, sample.rest[index].fit, `${label} ${item.id} fit scale unchanged`);
      }
      if (disjoint) for (let a = 0; a < sample.middle.length; a++) for (let b = a + 1; b < sample.middle.length; b++) {
        const first = sample.middle[a].outer, second = sample.middle[b].outer;
        assert.ok(first.right <= second.left + 0.5 || second.right <= first.left + 0.5 || first.bottom <= second.top + 0.5 || second.bottom <= first.top + 0.5, `${label}: ${sample.middle[a].id} and ${sample.middle[b].id} overlap`);
      }
    }
    let families = 0;
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
      for (const animation of ['subtle', 'lively']) {
        const view = await displayPage({ state: scenario(level(animation)), viewport });
        await midReveal(view.page, `${animation} default board ${viewport.width}`, true);
        await view.close();
      }
      for (const id of ACTIVE_WIDGET_IDS) for (const size of widgetSizes(id)) {
        const view = await displayPage({ viewport, state: scenario(state => {
          level('lively')(state); state.settings.widgetGrid.density = 'balanced';
          state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === id]));
          if (id === 'preview') state.settings.preview.enabled = true;
          state.settings.widgetGrid.placements[id] = { column: 0, row: 0, size };
        }) });
        await midReveal(view.page, `${id}/${size} ${viewport.width}`, false);
        families++;
        await view.close();
      }
    }
    checks.push(`paused at 50% of the Lively/Subtle entrance: ${families / 2} active families plus the default board at 1080p and 4K stay inside their rectangles, disjoint, with an unchanged fit scale`);

    // (6) Clock: only changed characters remount; at-rest geometry identical at every level.
    {
      const view = await displayPage({ state: scenario(state => { level('subtle')(state); state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'clock'])); }) });
      const { page } = view;
      await page.clock.runFor(2_500);
      const before = await page.evaluate(() => [...document.querySelectorAll('.clock-char')].map((char, index) => { char.__mark = index; return char.textContent; }).join(''));
      assert.equal(before, '9:00');
      await page.clock.runFor(60_000);
      const after = await page.evaluate(() => [...document.querySelectorAll('.clock-char')].map(char => ({ text: char.textContent, kept: char.__mark !== undefined, moving: char.getAnimations().length > 0 })));
      assert.equal(after.map(char => char.text).join(''), '9:01');
      assert.deepEqual(after.map(char => char.kept), [true, true, true, false], 'only the changed character is replaced');
      assert.equal(after[3].moving, true, 'the new character transitions in');
      assert.match(await page.locator('.clock-time .sr-only').textContent(), /^9:01 AM$/, 'a screen-reader full time');
      assert.equal(await page.locator('.clock-digits').getAttribute('aria-hidden'), 'true');
      await view.close();
      const boxes = {};
      for (const style of ['outline', 'digital']) for (const size of widgetSizes('clock')) for (const animation of LEVELS) {
        const clockView = await displayPage({ state: scenario(state => {
          level(animation)(state); state.settings.appearance.clockStyle = style;
          state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'clock']));
          state.settings.widgetGrid.placements.clock = { ...state.settings.widgetGrid.placements.clock, column: 0, row: 0, size };
        }) });
        await clockView.page.clock.runFor(2_500);
        const box = await clockView.page.evaluate(() => { for (const animation of document.getAnimations()) if (animation.effect.getTiming().iterations !== Infinity) animation.finish(); const r = document.querySelector('.clock-time').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
        const key = `${style}/${size}`;
        boxes[key] ??= box;
        for (const side of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(box[side] - boxes[key][side]) <= 1, `${key} ${animation}: ${side} ${box[side]} vs ${boxes[key][side]}`);
        await clockView.close();
      }
    }
    checks.push('clock: a minute replaces only changed .clock-char nodes, with a screen-reader full time; at-rest .clock-time box identical (±1 px) at Off/Subtle/Lively for outline and digital in every family');

    // (7) Analog hands move clockwise across 10:59 → 11:00 and 11:59 → 12:00; Off has no transition.
    for (const [time, label] of [['2026-10-18T14:59:30Z', '10:59 → 11:00'], ['2026-10-18T15:59:30Z', '11:59 → 12:00']]) for (const animation of ['subtle', 'off']) {
      const view = await displayPage({ time: Date.parse(time), state: scenario(state => { level(animation)(state); state.settings.appearance.clockStyle = 'analog'; state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'clock'])); }) });
      const angles = () => view.page.evaluate(() => [...document.querySelectorAll('.analog-clock line')].map(line => ({ angle: parseFloat(line.style.rotate), duration: getComputedStyle(line).transitionDuration })));
      const first = await angles();
      await view.page.clock.runFor(31_000);
      const second = await angles();
      for (const [index, hand] of second.entries()) assert.ok(hand.angle > first[index].angle, `${label} ${animation}: hand ${index} ${first[index].angle} → ${hand.angle}`);
      if (label.endsWith('12:00')) assert.equal(second[1].angle, 360, 'the minute hand reaches 12 clockwise');
      for (const hand of second) assert.equal(hand.duration, animation === 'off' ? '0s' : '0.6s', `${label} ${animation} transition`);
      await view.close();
    }
    checks.push('analog hands rotate clockwise across 10:59 → 11:00 and 11:59 → 12:00, 600 ms at Subtle, no transition at Off');

    // (8) A value change remounts its TransitionText and never shows an invented number.
    {
      const view = await displayPage({ state: scenario(level('subtle')) });
      const { page } = view;
      await page.clock.runFor(2_500);
      assert.equal(await page.locator('.current-temperature').textContent(), '14°');
      await page.evaluate(() => {
        const target = document.querySelector('.current-temperature');
        window.__first = target.querySelector('.value-transition'); window.__texts = [target.textContent];
        new MutationObserver(() => window.__texts.push(target.textContent)).observe(target, { childList: true, subtree: true, characterData: true });
      });
      view.served.state.weather.current.temperature = 15;
      await page.clock.runFor(30_000);
      await until(page, () => document.querySelector('.current-temperature').textContent === '15°', 'the new temperature');
      const result = await page.evaluate(() => {
        const span = document.querySelector('.current-temperature .value-transition');
        return { replaced: span !== window.__first, fading: span.getAnimations().some(animation => animation.transitionProperty === 'opacity'), texts: window.__texts };
      });
      assert.ok(result.replaced, '.value-transition remounted');
      assert.ok(result.fading, 'the new value fades in');
      for (const text of result.texts) assert.ok(text === '14°' || text === '15°', `never another numeral: ${text}`);
      await view.close();
    }
    checks.push('a weather value change from 14 to 15 remounts .value-transition, fades it in and never shows another numeral');

    // (9)–(10) Editor: samples are still; the Animation control follows the draft contract.
    async function editorPage({ reducedMotion = 'no-preference', viewport = { width: 1280, height: 720 } } = {}) {
      const context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', reducedMotion }); contexts.add(context);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
      await page.goto(base + '/editor');
      await page.getByRole('tab', { name: 'Style', exact: true }).waitFor();
      return { page, async close() { contexts.delete(context); await context.close(); } };
    }
    await app.store.update(data => { data.settings = defaultSettings(); data.reminders = []; });
    {
      const { page, close } = await editorPage();
      await page.getByRole('button', { name: 'Add widget to display' }).click();
      for (const name of ['Preview Weather', 'Preview Forecast']) {
        const catalog = page.getByRole('button', { name, exact: true });
        if (await catalog.count()) await catalog.click();
        await page.waitForTimeout(250);
        assert.equal(await page.locator('.picker-sample').getAttribute('data-animation'), 'off');
        assert.equal(await page.locator('.picker-sample').evaluate(element => element.getAnimations({ subtree: true }).length), 0, `${name}: sample has no animations`);
      }
      await close();
    }
    checks.push('picker samples report data-animation=off and run no animations');
    {
      const { page, close } = await editorPage();
      const state = async () => (await (await fetch(`${base}/api/state`)).json()).settings.appearance;
      const savebar = page.locator('.studio-savebar');
      const pressed = name => page.getByRole('group', { name: 'Animation' }).getByRole('button', { name, exact: true });
      assert.equal(await page.locator('.studio').getAttribute('data-animation'), 'subtle');
      await page.getByRole('tab', { name: 'Style', exact: true }).click();
      const summary = page.locator('summary', { hasText: 'Motion' });
      assert.match(await summary.textContent(), /Subtle/);
      await summary.click();
      assert.equal(await pressed('Subtle').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.getByText('Off keeps widgets still. Subtle animates changes. Lively adds gentle weather motion.').count(), 1);
      assert.equal(await page.getByText(/asks for reduced motion/).count(), 0);
      const canvas = page.locator('.preview-surface .ambient');
      await pressed('Lively').click();
      assert.equal(await pressed('Lively').getAttribute('aria-pressed'), 'true');
      assert.match(await summary.textContent(), /Lively/);
      await savebar.waitFor();
      assert.equal(await canvas.getAttribute('data-animation'), 'lively', 'the canvas shows the draft level');
      assert.equal(await canvas.getAttribute('data-motion-surface'), 'canvas');
      assert.equal(await page.locator('.studio').getAttribute('data-animation'), 'lively');
      await page.locator('.preview-surface .widget-grid-plane.revealing').waitFor({ timeout: 1000 });
      await pressed('Subtle').click();
      await savebar.waitFor({ state: 'detached' });
      await pressed('Lively').click(); await savebar.waitFor();
      assert.equal((await page.locator('.preset-button[aria-pressed="true"]').count()), 1, 'the style preset is not marked Custom');
      await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
      assert.equal(await canvas.getAttribute('data-animation'), 'off', 'Edit layout keeps the canvas still');
      assert.equal(await canvas.getAttribute('data-motion-surface'), 'canvas-editing');
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByRole('tab', { name: 'Style', exact: true }).click();
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await savebar.waitFor({ state: 'detached' });
      assert.equal((await state()).animation, 'lively', 'Save persists');
      await page.reload(); await page.getByRole('tab', { name: 'Style', exact: true }).click();
      await page.locator('summary', { hasText: 'Motion' }).click();
      assert.equal(await pressed('Lively').getAttribute('aria-pressed'), 'true', 'survives reload');
      await pressed('Off').click(); await savebar.waitFor();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await savebar.waitFor({ state: 'detached' });
      assert.equal(await pressed('Lively').getAttribute('aria-pressed'), 'true', 'Cancel restores');
      for (const preset of ['Room', 'Night']) {
        await page.locator('.preset-button', { hasText: preset }).click();
        assert.equal(await pressed('Lively').getAttribute('aria-pressed'), 'true', `${preset} keeps the level`);
      }
      await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await savebar.waitFor({ state: 'detached' });
      await page.locator('summary', { hasText: 'Saved styles' }).click();
      await page.getByPlaceholder('Evening').fill('Synthetic lively');
      await page.getByRole('button', { name: 'Add style', exact: true }).click();
      await pressed('Off').click();
      await page.getByRole('combobox').filter({ has: page.locator('option', { hasText: 'Synthetic lively' }) }).selectOption({ label: 'Synthetic lively' });
      assert.equal(await pressed('Lively').getAttribute('aria-pressed'), 'true', 'a saved style restores its level');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await savebar.waitFor({ state: 'detached' });
      await close();
      await app.store.update(data => { data.settings = defaultSettings(); });
    }
    {
      const { page, close } = await editorPage({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.studio').getAttribute('data-animation'), 'off');
      await page.getByRole('tab', { name: 'Style', exact: true }).click();
      await page.locator('summary', { hasText: 'Motion' }).click();
      assert.equal(await page.getByText('This screen asks for reduced motion, so animation stays off here. The display follows its own system setting.').count(), 1);
      await page.getByRole('group', { name: 'Animation' }).getByRole('button', { name: 'Lively', exact: true }).click();
      assert.equal(await page.locator('.studio').getAttribute('data-animation'), 'off', 'the control still edits the saved value');
      assert.equal(await page.locator('.preview-surface .ambient').getAttribute('data-animation'), 'off');
      await page.locator('.studio-savebar').waitFor();
      await close();
    }
    {
      // Editor polish (Subtle): sliding tab indicator, disclosure, Save bar, picker and drop-in, each ≤ 240 ms.
      const { page, close } = await editorPage();
      const editorMotion = () => page.evaluate(() => document.getAnimations().filter(animation => !(animation.timeline instanceof ScrollTimeline) && !animation.effect?.target?.closest?.('.preview-surface')).map(animation => ({ name: animation.animationName ?? `transition:${animation.transitionProperty}`, pseudo: animation.effect.pseudoElement, target: animation.effect.target.className?.baseVal ?? animation.effect.target.className, duration: animation.effect.getTiming().duration })));
      await page.getByRole('tab', { name: 'Reminders', exact: true }).click();
      const tabs = await editorMotion();
      assert.ok(tabs.some(item => item.pseudo === '::before' && /transition:(left|right)/.test(item.name)), `the active-tab indicator slides ${JSON.stringify(tabs)}`);
      assert.equal(await page.locator('.inspector-tabs').evaluate(element => getComputedStyle(element, '::before').positionAnchor), '--lrd-active-tab');
      await page.getByRole('tab', { name: 'Style', exact: true }).click();
      await page.waitForTimeout(300);
      // ::details-content transitions are not listed by getAnimations(), so measure the expansion.
      const disclosureHeight = () => page.locator('details.motion-disclosure').evaluate(element => element.getBoundingClientRect().height);
      await page.locator('summary', { hasText: 'Motion' }).click();
      const expanding = await disclosureHeight(); await page.waitForTimeout(400); const expanded = await disclosureHeight();
      assert.ok(expanding < expanded - 20, `the disclosure expands smoothly (${expanding} → ${expanded})`);
      await page.getByRole('group', { name: 'Animation' }).getByRole('button', { name: 'Lively', exact: true }).click();
      assert.ok((await editorMotion()).some(item => item.name === 'lrd-savebar-in' && item.duration <= 240), 'the Save bar slides in');
      await page.getByRole('button', { name: 'Add widget to display' }).click();
      assert.ok((await editorMotion()).some(item => /widget-picker/.test(item.target) && /transition:(opacity|scale)/.test(item.name)), 'the picker fades and scales in');
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: 'Preview Photo', exact: true }).click();
      await page.getByRole('button', { name: 'Add Photo', exact: true }).click();
      const dropped = await page.evaluate(() => ({
        frame: document.querySelector('.grid-widget-frame.selected')?.getAnimations().map(animation => animation.transitionProperty) ?? [],
        widget: document.querySelector('.preview-surface .ambient-photo')?.getAnimations().map(animation => animation.transitionProperty) ?? [],
      }));
      assert.ok(dropped.frame.includes('translate') && dropped.frame.includes('opacity'), `the new frame drops in ${JSON.stringify(dropped)}`);
      assert.ok(dropped.widget.includes('translate') && dropped.widget.includes('opacity'), `the new widget drops in ${JSON.stringify(dropped)}`);
      for (const item of await editorMotion()) assert.ok(item.duration <= 240, `${item.name} lasts ${item.duration} ms`);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await close();
      const reduced = await editorPage({ reducedMotion: 'reduce' });
      await reduced.page.getByRole('tab', { name: 'Reminders', exact: true }).click();
      await reduced.page.getByRole('tab', { name: 'Style', exact: true }).click();
      await reduced.page.locator('summary', { hasText: 'Motion' }).click();
      const immediate = await reduced.page.locator('details.motion-disclosure').evaluate(element => element.getBoundingClientRect().height);
      await reduced.page.waitForTimeout(300);
      assert.equal(await reduced.page.locator('details.motion-disclosure').evaluate(element => element.getBoundingClientRect().height), immediate, 'reduced motion opens disclosures at once');
      await reduced.page.getByRole('group', { name: 'Animation' }).getByRole('button', { name: 'Off', exact: true }).click();
      await reduced.page.locator('.studio-savebar').waitFor();
      assert.equal(await reduced.page.evaluate(() => document.getAnimations().filter(animation => animation.effect?.target?.closest?.('.studio') && !animation.effect.target.closest('.preview-surface') && animation.playState === 'running' && !(animation.timeline instanceof ScrollTimeline)).length), 0, 'reduced motion removes editor animation');
      await reduced.close();
    }
    checks.push('editor polish at Subtle: sliding tab indicator, disclosure expansion, Save bar entrance, picker open and drop-in of a new widget, all ≤ 240 ms; none under reduced motion');
    {
      // The Style tab still fits at 1280×720 with disclosures collapsed.
      const { page, close } = await editorPage();
      await page.getByRole('tab', { name: 'Style', exact: true }).click();
      const fit = await page.locator('.inspector-panel').evaluate(panel => panel.scrollHeight <= panel.clientHeight + 1);
      assert.ok(fit, 'Style tab fits without scrolling');
      await close();
    }
    checks.push('editor: pressed state, dirty-only Save on change and revert, Save persists and survives reload, Cancel restores, Room/Night and saved styles keep the level, reduced-motion hint and .studio[data-animation=off], canvas shows the draft level outside Edit layout only, Style tab fits at 1280×720');

    // (11) Performance on a TV-like surface without page.clock: Lively costs no layout and little main-thread time.
    if (performance) {
      for (const animation of ['off', 'lively']) {
        const view = await displayPage({ clock: false, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3, state: scenario(state => { level(animation)(state); state.weather.current.weatherCode = 61; state.weather.current.isDay = true; }) });
        const session = await view.context.newCDPSession(view.page);
        await session.send('Performance.enable');
        await view.page.waitForTimeout(3_000);
        const read = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
        const start = await read();
        await view.page.waitForTimeout(15_000);
        const end = await read();
        metrics[animation] = { LayoutCount: end.LayoutCount - start.LayoutCount, RecalcStyleCount: end.RecalcStyleCount - start.RecalcStyleCount, TaskDuration: Number((end.TaskDuration - start.TaskDuration).toFixed(4)), ScriptDuration: Number((end.ScriptDuration - start.ScriptDuration).toFixed(4)), loops: loops(await inventory(view.page)).length };
        await view.close();
      }
      assert.ok(Math.abs(metrics.lively.LayoutCount - metrics.off.LayoutCount) <= 3, `LayoutCount ${JSON.stringify(metrics)}`);
      assert.ok(metrics.lively.TaskDuration - metrics.off.TaskDuration <= 0.15, `TaskDuration ${JSON.stringify(metrics)}`);
      assert.equal(metrics.lively.loops, 3, 'rain at Lively runs its three drop loops');
      checks.push(`performance over 15 s at 1280×720 ×3: Off ${JSON.stringify(metrics.off)}; Lively ${JSON.stringify(metrics.lively)}`);
    }
    assert.deepEqual(errors, []);
    return { checks, metrics, images: 'none written; all state stays in RAM' };
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
    await browser.close(); await new Promise(done => app.server.close(done)); await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' }, 'skip-performance': { type: 'boolean' } } });
  const result = await runMotionQa({ playwright: values.playwright, edge: values.edge, performance: !values['skip-performance'] });
  console.log(JSON.stringify(result, null, 2));
}
