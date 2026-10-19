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
import { ACTIVE_WIDGET_IDS, WIDGET_IDS, normalizePlacement, widgetRevealOrder, widgetSizes } from '../../src/shared/widgets.ts';
import { WIDGET_CHECKS } from './widget-checks/index.mjs';

const ALLOWED_PROPERTIES = new Set(['transform', 'translate', 'rotate', 'scale', 'opacity']);
const LEVELS = ['off', 'subtle', 'lively'];
const HOUR = 3_600_000;
/** Every active widget on one Balanced 12 x 8 board (as in palette-browser.mjs); a newly activated widget must be added here. */
const FULL_BOARD = {
  clock: { column: 0, row: 0, size: 'medium' }, worldClocks: { column: 4, row: 0, size: 'medium' }, weather: { column: 8, row: 0, size: 'large' },
  sunMoon: { column: 0, row: 2, size: 'large' }, calendar: { column: 4, row: 2, size: 'medium' }, airQuality: { column: 4, row: 4, size: 'medium' },
  reminders: { column: 8, row: 4, size: 'medium' }, forecast: { column: 0, row: 6, size: 'medium' }, countdown: { column: 4, row: 6, size: 'small' },
  note: { column: 6, row: 6, size: 'small' }, preview: { column: 8, row: 6, size: 'small' }, photo: { column: 10, row: 6, size: 'small' },
};
/** One widget alone at the board's top-left corner. */
const only = (id, placement) => state => {
  state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === id]));
  if (id === 'preview') state.settings.preview.enabled = true;
  state.settings.widgetGrid.density = 'balanced';
  state.settings.widgetGrid.placements[id] = typeof placement === 'string' ? { column: 0, row: 0, size: placement } : placement;
};
const fullBoard = state => {
  state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key in FULL_BOARD]));
  state.settings.preview.enabled = true; state.settings.widgetGrid.density = 'balanced';
  Object.assign(state.settings.widgetGrid.placements, structuredClone(FULL_BOARD));
};

/**
 * `gpu: false` (--no-gpu) leaves out the checks whose result depends on GPU rasterising: the resting glyph
 * pixel parity and the #248 frame budget. Without a GPU (Edge's software compositing, as on GitHub's
 * runners, #323) the stacked glyph's antialiasing differs from a single SVG's although nothing is wrong.
 */
export async function runMotionQa({ playwright, edge, performance = true, gpu = true } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-motion-'));
  const now = Date.parse('2026-10-18T13:00:00Z'); // 9:00 in America/Toronto
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), now: () => now, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], errors = [], metrics = {};
  const contexts = new Set();
  // #315: each page or console error names its resource URL, page and step, and every failed request
  // is kept for the failure message. A resource that fails only because its page's context is being
  // closed (the request is cancelled) is listed in the result, not counted; any other error fails.
  const cancelled = [], failedRequests = [];
  const step = () => checks.length ? `after check ${checks.length} "${checks.at(-1).slice(0, 70)}…"` : 'before the first check';
  function collectErrors(page, ignore = null) {
    const watch = { closing: false };
    page.on('pageerror', error => errors.push(`${error.message} [page ${page.url()}; ${step()}]`));
    page.on('console', message => {
      if (message.type() !== 'error' || ignore?.test(message.text())) return;
      const entry = `${message.text()} [resource ${message.location().url || 'unknown'}; page ${page.url()}; ${step()}]`;
      if (watch.closing && /^Failed to load resource: net::ERR_/.test(message.text())) cancelled.push(`${entry} while its context closed`);
      else errors.push(entry);
    });
    page.on('requestfailed', request => {
      const failure = `${request.failure()?.errorText ?? 'failed'} ${request.method()} ${request.url()} [page ${page.url()}; ${step()}]`;
      (watch.closing ? cancelled : failedRequests).push(watch.closing ? `${failure} while its context closed` : failure);
    });
    return watch;
  }
  // A valid mid-grey PNG: each scanline starts with filter type 0, so the image actually paints.
  const pixels = Buffer.alloc((64 * 4 + 1) * 40, 120); for (let row = 0; row < 40; row++) pixels[row * (64 * 4 + 1)] = 0;
  const image = photoFixture(64, 40, pixels);
  const source = await (await fetch(`${base}/api/state`)).json();
  for (const check of Object.values(WIDGET_CHECKS)) check.prepare?.(source, { now });

  /**
   * A display page whose /api/state is the synthetic `served.state` (or a 503 while offline). `clock: false`
   * leaves time to the browser; with `fixedTime`, Playwright's clock pins the date the page reads while its
   * timers keep running in real time (#298).
   */
  async function displayPage({ state, time = now, reducedMotion = 'no-preference', viewport = { width: 1280, height: 720 }, clock = true, fixedTime = null, deviceScaleFactor = 1, path = '/display' }) {
    const context = await browser.newContext({ viewport, deviceScaleFactor, timezoneId: 'America/Toronto', reducedMotion }); contexts.add(context);
    const served = { state: structuredClone(state), offline: false };
    await context.route('**/api/state', route => route.fulfill(served.offline ? { status: 503, contentType: 'application/json', body: '{"error":"Synthetic offline"}' } : { status: 200, contentType: 'application/json', body: JSON.stringify(served.state) }));
    await context.route('**/api/photo/image?*', route => route.fulfill({ contentType: 'image/png', body: image }));
    await context.route('**/api/preview/image?*', route => route.fulfill({ contentType: 'image/png', body: image }));
    const page = await context.newPage();
    const watch = collectErrors(page, /503|Synthetic offline/);
    if (clock) await page.clock.install({ time: new Date(time) });
    else if (fixedTime !== null) await page.clock.setFixedTime(new Date(fixedTime));
    await page.goto(base + path);
    await page.locator(path.startsWith('/display') ? '.display-page' : '.studio').waitFor();
    if (clock) await page.clock.runFor(50);
    return { page, context, served, async close() { watch.closing = true; contexts.delete(context); await context.close(); } };
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
  const loops = list => list.filter(animation => animation.iterations === Infinity);
  /** Motion in the plane (the Soft motion drift is a discrete timer, #248, so it never appears): animation names or transition:<property>. */
  const planeMotion = async page => (await inventory(page)).map(item => item.name);
  /** Animation names or transition:<property> running on the elements matching `selector`. */
  const motionIn = (page, selector) => page.evaluate(query => [...document.querySelectorAll(query)].flatMap(element => element.getAnimations().map(animation => animation.animationName ?? `transition:${animation.transitionProperty}`)), selector);
  /** Steps the page clock until the next arrangement's entrance starts. */
  async function untilRevealing(page) {
    for (let step = 0; step < 120; step++) { if (await page.locator('.widget-grid-plane.revealing').count()) return; await page.clock.runFor(100); }
    throw new Error('Timed out waiting for the next reveal');
  }

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
        assert.equal(during.length, 0, 'Off has no motion in the plane: no widget motion, and the Soft motion drift is a discrete timer (#248)');
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
        if (gpu) assert.ok(single.equals(stacked), `${glyph}: stacked glyph pixels match a single SVG`);
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
    checks.push('getAnimations inventory: Off/Subtle zero loops; Lively ≤3 hero-glyph loops ≥1.2 s (bolt ≥8 s) that pause on black; only transform/opacity keyframes, opacity ≤1; ' + (gpu ? 'stacked glyph pixels equal one SVG at rest' : 'glyph pixel parity skipped (--no-gpu)'));

    // (2b) #248: the Soft motion drift moves the whole plane in discrete steps of 1/36 of ±0.5% about every
    // 2 s, with no animation or transition in between; Soft motion off and reduced motion keep it still.
    {
      const drift = async page => page.locator('.widget-grid-plane').evaluate(plane => {
        const matrix = new DOMMatrix(getComputedStyle(plane).transform);
        return { x: matrix.e, y: matrix.f, width: plane.offsetWidth, height: plane.offsetHeight, animations: plane.getAnimations().length, transition: getComputedStyle(plane).transitionProperty };
      });
      const view = await displayPage({ state: scenario(level('off')), viewport: { width: 1280, height: 720 } });
      const samples = [];
      for (let step = 0; step < 48; step++) { samples.push({ at: step * 250, ...await drift(view.page) }); await view.page.clock.runFor(250); }
      const { width, height } = samples[0];
      const changes = samples.filter((sample, index) => index && (sample.x !== samples[index - 1].x || sample.y !== samples[index - 1].y));
      assert.ok(changes.length >= 4 && changes.length <= 7, `about one step every 2 s over 12 s: ${changes.length} ${JSON.stringify(changes.map(change => change.at))}`);
      for (const [index, change] of changes.entries()) {
        const before = samples[samples.indexOf(change) - 1];
        assert.ok(Math.abs(Math.abs(change.x - before.x) - width * 0.01 / 36) < 0.02 && Math.abs(Math.abs(change.y - before.y) - height * 0.01 / 36) < 0.02, `one 1/36 step of ±0.5%: ${JSON.stringify([before, change])}`);
        if (index) assert.ok(change.at - changes[index - 1].at >= 1_750, `steps are about 2 s apart: ${changes.map(item => item.at)}`);
      }
      for (const sample of samples) {
        assert.ok(Math.abs(sample.x) <= width * 0.005 + 0.01 && Math.abs(sample.y) <= height * 0.005 + 0.01, `within ±0.5% of the plane: ${JSON.stringify(sample)}`);
        assert.equal(sample.animations, 0, 'nothing animates on the plane'); assert.doesNotMatch(sample.transition, /transform|all/, 'the plane never tweens between steps');
      }
      await view.close();
      for (const [label, options] of [['Soft motion off', { state: scenario(state => { level('off')(state); state.settings.appearance.motionEnabled = false; }) }], ['reduced motion', { state: scenario(level('subtle')), reducedMotion: 'reduce' }]]) {
        const still = await displayPage(options); const first = await drift(still.page);
        await still.page.clock.runFor(10_000);
        assert.deepEqual(await drift(still.page), first, `${label}: the plane stays still`);
        await still.close();
      }
    }
    checks.push('#248 Soft motion drift: discrete 1/36 steps of ±0.5% of the plane about every 2 s, no animation or transform transition on the plane; Soft motion off and reduced motion keep the plane still');

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
    // Coverage of the merged catalog: every active widget has a widget-checks module (its prepare
    // hook gives it content above) and the full board lists every active widget.
    for (const id of ACTIVE_WIDGET_IDS) assert.ok(WIDGET_CHECKS[id], `${id} needs a tests/ui/widget-checks module`);
    assert.deepEqual(Object.keys(FULL_BOARD).sort(), [...ACTIVE_WIDGET_IDS].sort(), 'FULL_BOARD lists every active widget');
    const expectedFamilies = ACTIVE_WIDGET_IDS.reduce((sum, id) => sum + widgetSizes(id).length, 0);
    // A free-size Reminders span (#73) from the top edge to the bottom edge.
    const tallReminders = normalizePlacement('reminders', { column: 0, row: 0, size: 'small', span: { columns: 4, rows: 8 } });
    let families = 0;
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
      for (const animation of ['subtle', 'lively']) {
        const view = await displayPage({ state: scenario(level(animation)), viewport });
        await midReveal(view.page, `${animation} default board ${viewport.width}`, true);
        await view.close();
        const board = await displayPage({ state: scenario(state => { level(animation)(state); fullBoard(state); }), viewport });
        assert.equal(await board.page.locator('.ambient-widget').count(), ACTIVE_WIDGET_IDS.length, 'the full board shows every widget');
        await midReveal(board.page, `${animation} full board ${viewport.width}`, true);
        await board.close();
      }
      for (const id of ACTIVE_WIDGET_IDS) for (const size of widgetSizes(id)) {
        const view = await displayPage({ viewport, state: scenario(state => { level('lively')(state); only(id, size)(state); }) });
        await midReveal(view.page, `${id}/${size} ${viewport.width}`, false);
        families++;
        await view.close();
      }
      const tall = await displayPage({ viewport, state: scenario(state => { level('lively')(state); only('reminders', tallReminders)(state); }) });
      assert.equal(await tall.page.locator('.ambient-reminders').getAttribute('data-widget-span'), '4x8');
      assert.equal(await tall.page.locator('.ambient-reminders').getAttribute('data-full-height'), '');
      await midReveal(tall.page, `reminders 4x8 ${viewport.width}`, false);
      await tall.close();
    }
    assert.equal(families / 2, expectedFamilies, 'every family of every active widget');
    checks.push(`paused at 50% of the Lively/Subtle entrance: all ${families / 2} families of the ${ACTIVE_WIDGET_IDS.length} active widgets (each with a widget-checks module), a full-height 4 × 8 free-size Reminders span, the default board and a full board of every widget at 1080p and 4K stay inside their rectangles, disjoint, with an unchanged fit scale`);

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
      const angles = () => view.page.evaluate(() => [...document.querySelectorAll('.analog-clock .analog-hand')].map(hand => ({ angle: parseFloat(hand.style.rotate), duration: getComputedStyle(hand).transitionDuration })));
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

    // (12) Adaptive Weather (#74): the hero glyph at its CSS size (#128); a calm → elevated change
    // fades the new bars in to at most their resting opacity and crossfades the rain copy; the next
    // Lively entrance grows the bars from their baseline. Off and reduced motion stay still.
    {
      const calmWeather = state => { for (const hour of state.weather.hourly) Object.assign(hour, { precipitationProbability: 0, precipitationAmount: 0, rainAmount: 0 }); };
      for (const [animation, reducedMotion] of [['subtle', 'no-preference'], ['lively', 'no-preference'], ['off', 'no-preference'], ['lively', 'reduce']]) {
        const label = `${animation}${reducedMotion === 'reduce' ? ' (reduced motion)' : ''}`;
        const still = animation === 'off' || reducedMotion === 'reduce';
        const view = await displayPage({ reducedMotion, state: scenario(state => { level(animation)(state); only('weather', 'large')(state); calmWeather(state); }) });
        const { page } = view;
        await page.clock.runFor(2_500);
        assert.equal(await page.locator('.weather-body').getAttribute('data-weather-mode'), 'calm', `${label}: calm`);
        const glyph = await page.locator('.weather-symbol[data-glyph-hero]').evaluate(element => ({ width: element.getBoundingClientRect().width, inline: element.style.width }));
        assert.ok(glyph.width >= 48 && glyph.inline === '', `${label}: the hero glyph takes its CSS size (${JSON.stringify(glyph)})`);
        view.served.state.weather.hourly = structuredClone(source.weather.hourly);
        await page.clock.runFor(30_000);
        await until(page, () => document.querySelector('.weather-body')?.dataset.weatherMode === 'elevated', 'elevated Weather');
        const bars = await motionIn(page, '.rain-bar'), copy = await motionIn(page, ':is(.rain-timing, .rain-detail, .rain-hours) .value-transition');
        if (still) assert.deepEqual(await planeMotion(page), [], `${label}: a mode change moves nothing`);
        else {
          assert.ok(bars.length > 0 && bars.every(name => name === 'transition:opacity'), `${label}: the new bars fade in (${bars})`);
          assert.ok(copy.length > 0 && copy.every(name => name === 'transition:opacity'), `${label}: the rain copy crossfades (${copy})`);
          const opacities = await page.locator('.rain-bar').evaluateAll(elements => elements.map(element => ({ opacity: Number(getComputedStyle(element).opacity), spell: element.classList.contains('rain-bar-spell') })));
          for (const bar of opacities) assert.ok(bar.opacity <= (bar.spell ? 0.65 : 0.35) + 0.001, `${label}: a fading bar stays at or below its resting opacity (${JSON.stringify(bar)})`);
        }
        if (animation === 'lively' && !still) {
          await page.clock.runFor(140_000);
          await untilRevealing(page);
          const grow = await motionIn(page, '.rain-bars > .rain-bar');
          assert.ok(grow.includes('lrd-bar-grow'), `the Lively entrance grows the rain bars (${grow})`);
        }
        await view.close();
      }
    }
    checks.push('adaptive Weather: the hero glyph takes its CSS size (no inline size); calm → elevated fades the new rain bars in (never above their 0.35/0.65 resting opacity) and crossfades the rain timing, detail and hours at Subtle and Lively; the Lively entrance grows the bars; Off and reduced motion run nothing');

    // (13) Reminders (#73's measured list): only a newly pending reminder fades, by opacity alone; a
    // re-sorted row (#172), a row that stops overflowing and a remeasurement replay nothing. The
    // measured rows and the exact "+N more" are identical at every level; Off stays still.
    {
      const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      const pendingList = count => Array.from({ length: count }, (_, index) => ({ id: id(index), text: `Synthetic reminder ${index + 1}`, completed: false, dueAt: null, createdAt: new Date(now - (index + 1) * 60_000).toISOString(), updatedAt: new Date(now - (index + 1) * 60_000).toISOString() }));
      const rows = page => page.evaluate(() => [...document.querySelectorAll('.ambient-reminder-list > li')].map(row => ({
        title: row.querySelector('.ambient-reminder-title').textContent, overflow: row.classList.contains('reminder-overflow'), fresh: row.hasAttribute('data-new'),
        space: row.getClientRects().length, motion: row.getAnimations().map(animation => animation.animationName ?? `transition:${animation.transitionProperty}`),
      })));
      const more = page => page.locator('.reminder-more').textContent();
      const settle = page => page.waitForTimeout(600); // real-time CSS transitions (#165)
      const shown = {};
      for (const animation of LEVELS) {
        const view = await displayPage({ state: scenario(state => { level(animation)(state); only('reminders', 'medium')(state); state.reminders = pendingList(12); }) });
        const { page, served } = view;
        await page.clock.runFor(2_500);
        const first = await rows(page), visible = first.filter(row => !row.overflow);
        shown[animation] = visible.map(row => row.title);
        assert.ok(visible.length >= 2 && visible.length < 12, `${animation}: ${visible.length} rows fit`);
        assert.equal(await more(page), `+${12 - visible.length} more`, `${animation}: exact +N more`);
        assert.ok(first.filter(row => row.overflow).every(row => row.space === 0), `${animation}: overflow rows take no space`);
        // A new reminder due soon sorts first.
        served.state.reminders = [{ id: id(99), text: 'Synthetic new reminder', completed: false, dueAt: new Date(now + HOUR).toISOString(), createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }, ...pendingList(12)];
        await page.clock.runFor(30_000);
        await until(page, () => document.querySelector('.ambient-reminder-title')?.textContent === 'Synthetic new reminder', 'the new reminder');
        const added = await rows(page);
        assert.ok(added[0].fresh && added.slice(1).every(row => !row.fresh), `${animation}: only the new reminder is marked new`);
        if (animation === 'off') assert.deepEqual(await planeMotion(page), [], 'Off: a new reminder appears without motion');
        else {
          assert.deepEqual(added[0].motion, ['transition:opacity'], `${animation}: the new reminder fades in`);
          assert.deepEqual(added.slice(1).flatMap(row => row.motion), [], `${animation}: other rows stay still`);
        }
        await settle(page);
        // A due-time edit moves an existing row (React re-inserts it): no entrance replays (#172).
        served.state.reminders = structuredClone(served.state.reminders);
        Object.assign(served.state.reminders.find(reminder => reminder.id === id(1)), { dueAt: new Date(now + 30 * 60_000).toISOString(), updatedAt: new Date(now + 1_000).toISOString() });
        await page.clock.runFor(30_000);
        await until(page, () => document.querySelector('.ambient-reminder-title')?.textContent === 'Synthetic reminder 2', 'the re-sorted reminder');
        const resorted = await rows(page);
        assert.ok(resorted.every(row => !row.fresh), `${animation}: a re-sorted row is not new`);
        assert.deepEqual(resorted.flatMap(row => row.motion), [], `${animation}: re-sorting replays no entrance`);
        await settle(page);
        // Completing the top reminder removes it at once; the row that stops overflowing does not fade.
        served.state.reminders = structuredClone(served.state.reminders);
        served.state.reminders.find(reminder => reminder.id === id(1)).completed = true;
        await page.clock.runFor(30_000);
        await until(page, () => document.querySelector('.ambient-reminder-title')?.textContent === 'Synthetic new reminder', 'the completed reminder leaves');
        const completed = await rows(page);
        assert.deepEqual(completed.flatMap(row => row.motion), [], `${animation}: completion and the newly visible row stay still`);
        assert.equal(await more(page), `+${completed.length - completed.filter(row => !row.overflow).length} more`, `${animation}: exact +N more after completion`);
        await settle(page);
        // A remeasurement that keeps the count (an edited title) replays nothing, "+N more" included.
        const countBefore = await more(page);
        served.state.reminders = structuredClone(served.state.reminders);
        served.state.reminders.find(reminder => reminder.id === id(0)).text = 'Synthetic edited reminder';
        await page.clock.runFor(30_000);
        await until(page, () => [...document.querySelectorAll('.ambient-reminder-title')].some(title => title.textContent === 'Synthetic edited reminder'), 'the edited title');
        assert.equal(await more(page), countBefore);
        assert.deepEqual(await planeMotion(page), [], `${animation}: a remeasurement replays nothing`);
        if (animation === 'lively') {
          await page.clock.runFor(60_000);
          await untilRevealing(page);
          const entrance = await motionIn(page, '.ambient-reminder-list > li:not(.reminder-overflow)');
          assert.ok(entrance.length > 0 && entrance.every(name => name === 'lrd-fade-in'), `Lively reminder rows fade without moving (${entrance})`);
        }
        await view.close();
      }
      assert.deepEqual(shown.subtle, shown.off, 'Subtle measures the same rows as Off');
      assert.deepEqual(shown.lively, shown.off, 'Lively measures the same rows as Off');
    }
    checks.push('reminders: identical measured rows and an exact "+N more" at Off/Subtle/Lively with overflow rows taking no space; only a newly pending reminder (data-new) fades, by opacity; a due-time re-sort (#172), a completion with a row that stops overflowing, and a remeasurement that keeps the count replay nothing; the Lively entrance fades rows without moving them; Off runs nothing');

    // (14) The #78 widgets' values crossfade through TransitionText at Subtle and stay still at Off.
    {
      const CHANGES = [
        ['airQuality', 'medium', { mutate: state => { state.airQuality.current.aqi = 87; } }],
        ['note', 'medium', { mutate: state => { state.settings.widgetData.note = { text: 'A changed synthetic note' }; } }],
        ['countdown', 'medium', { mutate: state => { state.settings.widgetData.countdowns = state.settings.widgetData.countdowns.filter(item => item.title !== 'Synthetic today'); } }],
        ['sunMoon', 'medium', { mutate: state => { state.weather.location = { ...state.weather.location, latitude: state.weather.location.latitude + 10 }; } }],
        ['worldClocks', 'medium', { advance: 60_000 }],
        ['calendar', 'medium', { time: Date.parse('2026-10-19T03:59:20Z'), advance: 45_000 }],
      ];
      for (const [widget, size, change] of CHANGES) for (const animation of ['subtle', 'off']) {
        const view = await displayPage({ time: change.time ?? now, state: scenario(state => { level(animation)(state); only(widget, size)(state); }) });
        const { page, served } = view;
        await page.clock.runFor(2_500);
        await page.evaluate(() => { for (const value of document.querySelectorAll('.ambient-widget .value-transition')) value.__kept = true; });
        if (change.mutate) { served.state = structuredClone(served.state); change.mutate(served.state); await page.clock.runFor(30_000); }
        if (change.advance) await page.clock.runFor(change.advance);
        await until(page, () => [...document.querySelectorAll('.ambient-widget .value-transition')].some(value => !value.__kept), `${widget}: a TransitionText value remounts`);
        const values = await page.evaluate(() => [...document.querySelectorAll('.ambient-widget .value-transition')].filter(value => !value.__kept).map(value => ({ text: value.textContent, motion: value.getAnimations().map(animation => animation.transitionProperty) })));
        if (animation === 'off') assert.deepEqual(await planeMotion(page), [], `${widget} Off: nothing moves`);
        else assert.ok(values.every(value => value.motion.length === 1 && value.motion[0] === 'opacity'), `${widget}: each new value fades in (${JSON.stringify(values)})`);
        await view.close();
      }
    }
    checks.push('Air quality (AQI and category), Note, Countdown, Sun & moon, World clocks and Calendar: a changed value remounts its TransitionText and fades in by opacity at Subtle; Off runs nothing');

    // (9)–(10) Editor: samples are still; the Animation control follows the draft contract.
    async function editorPage({ reducedMotion = 'no-preference', viewport = { width: 1280, height: 720 } } = {}) {
      const context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', reducedMotion }); contexts.add(context);
      const page = await context.newPage();
      const watch = collectErrors(page);
      await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
      await page.goto(base + '/editor');
      await page.getByRole('tab', { name: 'Style', exact: true }).waitFor();
      return { page, async close() { watch.closing = true; contexts.delete(context); await context.close(); } };
    }
    await app.store.update(data => { data.settings = defaultSettings(); data.reminders = []; });
    {
      const { page, close } = await editorPage();
      await page.getByRole('button', { name: 'Add widget to display' }).click();
      for (const name of ['Preview Weather', 'Preview Forecast']) {
        const catalog = page.getByRole('button', { name: new RegExp(`^${name}(, on your display)?$`) });
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

    // (11) Performance on a TV-like surface with timers running in real time: Lively costs no layout and little
    // main-thread time. The page reads the fixture's date (#298): the synthetic forecast ends 24 hours after
    // `now`, so on the real date a day later the large Weather would lose its hours, overflow its box and
    // refit on every tick. The date never changes inside the window, so no minute change (clock digits,
    // world clocks) lands in only one level's window, and every widget must fit its box at fit 1.
    const fits = page => page.locator('.ambient-widget').evaluateAll(sections => sections.map(section => {
      const content = section.querySelector('.widget-content');
      return { id: section.dataset.widgetId, fit: content ? new DOMMatrix(getComputedStyle(content).transform).a : 1 };
    }).filter(item => item.fit < 1));
    if (performance) {
      // The default board and a full board of every merged widget (#162), each Off against Lively.
      for (const [board, arrange] of [['default', () => undefined], ['full', fullBoard]]) {
        const result = metrics[board] = {};
        for (const animation of ['off', 'lively']) {
          const view = await displayPage({ clock: false, fixedTime: now, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3, state: scenario(state => { level(animation)(state); arrange(state); state.weather.current.weatherCode = 61; state.weather.current.isDay = true; }) });
          const session = await view.context.newCDPSession(view.page);
          await session.send('Performance.enable');
          await view.page.waitForTimeout(3_000);
          assert.deepEqual(await fits(view.page), [], `${board} ${animation}: no widget below fit 1 before the performance window`);
          const read = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
          const start = await read();
          await view.page.waitForTimeout(15_000);
          const end = await read();
          assert.deepEqual(await fits(view.page), [], `${board} ${animation}: no widget below fit 1 after the performance window`);
          result[animation] = { widgets: await view.page.locator('.ambient-widget').count(), LayoutCount: end.LayoutCount - start.LayoutCount, RecalcStyleCount: end.RecalcStyleCount - start.RecalcStyleCount, TaskDuration: Number((end.TaskDuration - start.TaskDuration).toFixed(4)), ScriptDuration: Number((end.ScriptDuration - start.ScriptDuration).toFixed(4)), loops: loops(await inventory(view.page)).length };
          await view.close();
        }
        assert.ok(Math.abs(result.lively.LayoutCount - result.off.LayoutCount) <= 3, `${board} LayoutCount ${JSON.stringify(result)}`);
        assert.ok(result.lively.TaskDuration - result.off.TaskDuration <= 0.15, `${board} TaskDuration ${JSON.stringify(result)}`);
        assert.equal(result.lively.loops, 3, `${board}: rain at Lively runs its three drop loops`);
        if (board === 'full') assert.ok(result.off.widgets === ACTIVE_WIDGET_IDS.length && result.lively.widgets === ACTIVE_WIDGET_IDS.length, 'the full board shows every widget');
        checks.push(`performance over 15 s at 1280×720 ×3, ${board} board: Off ${JSON.stringify(result.off)}; Lively ${JSON.stringify(result.lively)}`);
      }
      // #248 frame budget: at Off with Soft motion on (the default), the display draws only when the plane
      // steps or a value changes, a few frames per second at most (a continuous drift drew about 120 per
      // second). Whole-browser CPU (all Edge processes, % of one core) is recorded alongside. Both depend
      // on the GPU, so `gpu: false` leaves them out.
      const frames = metrics.frames = {};
      for (const [label, viewport, deviceScaleFactor] of gpu ? [['1280×720 ×3', { width: 1280, height: 720 }, 3], ['3840×2160 ×1', { width: 3840, height: 2160 }, 1]] : []) {
        const view = await displayPage({ clock: false, fixedTime: now, viewport, deviceScaleFactor, state: scenario(state => { level('off')(state); fullBoard(state); }) });
        assert.equal(await view.page.locator('.grid-ambient:not(.static)').count(), 1, 'Soft motion is on');
        await view.page.waitForTimeout(3_000);
        const session = await view.context.newCDPSession(view.page); const browserSession = await browser.newBrowserCDPSession();
        const cpu = async () => (await browserSession.send('SystemInfo.getProcessInfo')).processInfo.reduce((sum, item) => sum + item.cpuTime, 0);
        const events = []; session.on('Tracing.dataCollected', data => events.push(...data.value));
        await session.send('Tracing.start', { categories: 'disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' });
        const cpuStart = await cpu(), started = Date.now();
        await view.page.waitForTimeout(10_000);
        const seconds = (Date.now() - started) / 1000, cpuEnd = await cpu();
        const complete = new Promise(done => session.once('Tracing.tracingComplete', done)); await session.send('Tracing.end'); await complete;
        frames[label] = { drawFramesPerSecond: Number((events.filter(event => event.name === 'DrawFrame').length / seconds).toFixed(2)), browserCpuPercent: Number(((cpuEnd - cpuStart) / seconds * 100).toFixed(1)) };
        await browserSession.detach().catch(() => undefined);
        await view.close();
        assert.ok(frames[label].drawFramesPerSecond <= 4, `${label}: at most a few frames per second at rest ${JSON.stringify(frames[label])}`);
      }
      checks.push(gpu ? `#248 frame budget at Off with Soft motion on, full board over 10 s: ${JSON.stringify(frames)}` : '#248 frame budget skipped (--no-gpu)');
    }
    assert.deepEqual(errors, [], `page or console errors (failed requests: ${JSON.stringify(failedRequests)}; cancelled by closing: ${JSON.stringify(cancelled)})`);
    return { checks, metrics, cancelled, images: 'none written; all state stays in RAM' };
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
    await browser.close(); await new Promise(done => app.server.close(done)); await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' }, 'skip-performance': { type: 'boolean' }, 'no-gpu': { type: 'boolean' } } });
  const result = await runMotionQa({ playwright: values.playwright, edge: values.edge, performance: !values['skip-performance'], gpu: !values['no-gpu'] });
  console.log(JSON.stringify(result, null, 2));
}
