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
import { keepPagesLocal } from './lib/local-only.mjs';

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
  // Requests for anything but this suite's server (a filtering proxy's injected script) get an empty
  // answer and are listed in `outside` (tests/ui/lib/local-only.mjs).
  const cancelled = [], failedRequests = [], outside = new Set();
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
    const answered = await keepPagesLocal(context, base);
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
    return { page, context, served, async close() { watch.closing = true; for (const url of answered) outside.add(url); contexts.delete(context); await context.close(); } };
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
        name: animation.animationName ?? (animation.transitionProperty ? `transition:${animation.transitionProperty}` : animation.id || 'script'),
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
  /** Motion in the plane (the #436 float is a discrete timer, as #248's drift was, so it never appears): animation names or transition:<property>. */
  const planeMotion = async page => (await inventory(page)).map(item => item.name);
  /** Animation names or transition:<property> running on the elements matching `selector`. */
  const motionIn = (page, selector) => page.evaluate(query => [...document.querySelectorAll(query)].flatMap(element => element.getAnimations().map(animation => animation.animationName ?? (animation.transitionProperty ? `transition:${animation.transitionProperty}` : animation.id || 'script'))), selector);
  /**
   * #436 owner board: the default 12 × 8 board with two synthetic reminders, a routed Last screen
   * snapshot and Sun & moon, so six widgets show, at a 30 s interval with a 2 s fade, Lively and
   * brightness 0.37, as the owner's saved settings. No Swap places, as after the update.
   */
  const SYNTHETIC_REMINDERS = [1, 2].map(index => ({ id: `00000000-0000-4000-8000-00000000043${index}`, text: `Synthetic reminder ${index}`, completed: false, dueAt: null, createdAt: new Date(now - index * 60_000).toISOString(), updatedAt: new Date(now - index * 60_000).toISOString() }));
  const ownerBoard = (edit = () => undefined) => state => {
    level('lively')(state);
    Object.assign(state.settings.appearance, { motionIntervalSeconds: 30, fadeSeconds: 2, motionEnabled: true, brightness: 0.37, rearrange: false });
    Object.assign(state.settings.widgets, { clock: true, weather: true, forecast: true, reminders: true, preview: true, sunMoon: true });
    state.settings.preview.enabled = true;
    state.settings.widgetGrid.density = 'balanced';
    state.settings.widgetGrid.placements.sunMoon = { column: 8, row: 6, size: 'small' };
    state.reminders = structuredClone(SYNTHETIC_REMINDERS);
    state.preview = { available: true, capturedAt: new Date(now - 60_000).toISOString(), width: 1920, height: 1080 };
    edit(state);
  };
  /**
   * One sample of the display: the plane's translation and opacity, and per widget its cell (left/top),
   * computed opacity and the bounding box of what it actually draws (text, images, bars) in the viewport.
   */
  const sampleBoard = page => page.evaluate(() => {
    const plane = document.querySelector('.widget-grid-plane'), matrix = new DOMMatrix(getComputedStyle(plane).transform);
    const range = document.createRange();
    const ink = section => {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      const add = rect => { if (rect.width <= 0 && rect.height <= 0) return; left = Math.min(left, rect.left); top = Math.min(top, rect.top); right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom); };
      const walk = node => { for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (!child.textContent.trim()) continue;
          // A text rect is the font's content area, taller than the line box for large type (the clock's
          // digits); the glyphs sit inside the line box, so trim the difference evenly.
          const style = getComputedStyle(child.parentElement), lineHeight = parseFloat(style.lineHeight);
          range.selectNodeContents(child);
          for (const rect of range.getClientRects()) {
            const trim = Number.isFinite(lineHeight) && rect.height > lineHeight ? (rect.height - lineHeight) / 2 : 0;
            add(new DOMRect(rect.left, rect.top + trim, rect.width, rect.height - 2 * trim));
          }
        }
        else if (child instanceof Element && !child.classList.contains('sr-only')) { if (child.matches('svg, img, canvas, picture, video, [role="img"]') || (!child.firstElementChild && !child.textContent.trim())) add(child.getBoundingClientRect()); else walk(child); }
      } };
      walk(section.querySelector('.widget-content'));
      return { left, top, right, bottom };
    };
    return {
      t: Date.now(), x: matrix.e, y: matrix.f, opacity: Number(getComputedStyle(plane).opacity), transition: getComputedStyle(plane).transitionProperty,
      animations: plane.getAnimations().length, width: innerWidth, height: innerHeight,
      widgets: [...document.querySelectorAll('.ambient-widget')].map(section => ({ id: section.dataset.widgetId, left: section.style.left, top: section.style.top, opacity: Number(getComputedStyle(section).opacity), translate: getComputedStyle(section).translate, ink: ink(section) })),
    };
  });

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
      const before = await sampleBoard(reduced.page);
      await reduced.page.clock.runFor(185_000);
      const after = await sampleBoard(reduced.page);
      assert.equal(await reduced.page.locator('.ambient').getAttribute('data-float'), 'step');
      assert.ok(after.x !== before.x || after.y !== before.y, 'reduced motion still moves the board, in steps');
      assert.equal(after.opacity, 1, 'and never fades it');
      assert.equal((await inventory(reduced.page)).length, 0, 'reduced motion leaves nothing running in the plane');
      await reduced.close();
    }
    checks.push('effective data-animation per level; reduced motion reports Off, runs nothing and still moves the board in steps at opacity 1');

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
        // #436: across an interval nothing fades or pauses; the loops keep running.
        await page.clock.runFor(180_000);
        assert.equal(await page.locator('.widget-grid-plane.fading').count(), 0);
        assert.ok(loops(await inventory(page)).every(item => item.playState === 'running'), `${glyph}: loops keep running across an interval`);
      }
      await view.close();
    }
    checks.push('getAnimations inventory: Off/Subtle zero loops; Lively ≤3 hero-glyph loops ≥1.2 s (bolt ≥8 s) that keep running across an interval (#436); only transform/opacity keyframes, opacity ≤1; ' + (gpu ? 'stacked glyph pixels equal one SVG at rest' : 'glyph pixel parity skipped (--no-gpu)'));

    // (2b) #436 float, the acceptance check. On 3446400 and earlier builds it fails: every interval the board dims
    // for about 4.8 s and is black for about 1.8 s. On the owner's board at 1280 × 720 × 3, five virtual minutes
    // sampled every 50 ms keep the plane at opacity 1 and every widget in its own cell at full opacity; the board
    // floats over most of ±3.5% one device pixel at a time with no animation, transition or layout; and every
    // widget's drawn content stays inside the screen.
    {
      const view = await displayPage({ state: scenario(ownerBoard()), viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 });
      const { page } = view;
      // Page time moves only with runFor from here, so every 50 ms sample is exactly 50 ms of page time.
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10));
      await page.clock.runFor(2_500);
      assert.equal(await page.locator('.ambient-widget').count(), 6, 'six widgets on the owner board');
      assert.equal(await page.locator('.ambient').getAttribute('data-float'), 'float');
      const session = await view.context.newCDPSession(page); await session.send('Performance.enable');
      const layouts = async () => (await session.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'LayoutCount').value;
      const first = await sampleBoard(page), samples = [first];
      const cells = Object.fromEntries(first.widgets.map(widget => [widget.id, [widget.left, widget.top]]));
      let layoutStart = null, layoutEnd = null, steps = 0;
      for (let index = 1; index <= 6_000; index++) {
        await page.clock.runFor(50);
        // The no-layout window, 32 to 59 s after loading, holds no minute change (the clock's digits refit then)
        // and no 30 s state poll (a new reminders list remeasures): only float steps.
        const sample = await sampleBoard(page);
        if (layoutStart === null && sample.t >= now + 32_000) layoutStart = { value: await layouts(), steps };
        if (layoutEnd === null && sample.t >= now + 59_000) layoutEnd = { value: await layouts(), steps };
        const last = samples.at(-1);
        assert.equal(sample.opacity, 1, `the plane stays at opacity 1 (${sample.t - now} ms)`);
        assert.equal(sample.animations, 0, 'nothing animates on the plane');
        assert.doesNotMatch(sample.transition, /transform|all|opacity/, 'the plane never tweens');
        assert.ok(Math.abs(sample.x - last.x) * 3 <= 1.01 && Math.abs(sample.y - last.y) * 3 <= 1.01, `at most one device pixel per step: ${JSON.stringify([last.x, last.y, sample.x, sample.y])}`);
        if (sample.x !== last.x || sample.y !== last.y) steps++;
        for (const widget of sample.widgets) {
          assert.deepEqual([widget.left, widget.top], cells[widget.id], `${widget.id} keeps its cell (no swap)`);
          assert.ok(widget.opacity >= 0.99, `${widget.id} opacity ${widget.opacity} at ${sample.t - now} ms`);
          const box = widget.ink;
          assert.ok(box.left >= -0.5 && box.top >= -0.5 && box.right <= sample.width + 0.5 && box.bottom <= sample.height + 0.5, `${widget.id} content inside the screen: ${JSON.stringify(box)}`);
        }
        samples.push(sample);
      }
      const xs = samples.map(sample => sample.x), ys = samples.map(sample => sample.y);
      const reach = { x: (Math.max(...xs) - Math.min(...xs)) / (2 * 0.035 * 1280), y: (Math.max(...ys) - Math.min(...ys)) / (2 * 0.035 * 720) };
      assert.ok(reach.x >= 0.8 && reach.y >= 0.8, `the board covers at least 80% of ±3.5% on both axes: ${JSON.stringify(reach)}`);
      for (const sample of samples) assert.ok(Math.abs(sample.x) <= 0.035 * 1280 + 0.01 && Math.abs(sample.y) <= 0.035 * 720 + 0.01, 'within ±3.5%');
      assert.ok(layoutStart && layoutEnd && layoutEnd.steps - layoutStart.steps >= 100, `many float steps in the no-layout window: ${JSON.stringify([layoutStart, layoutEnd])}`);
      assert.equal(layoutEnd.value - layoutStart.value, 0, `no layout while the board floats: ${JSON.stringify([layoutStart, layoutEnd])}`);
      // Each widget's content floats inside its own box too, out of step with the others.
      const moved = first.widgets.filter(widget => new Set(samples.map(sample => sample.widgets.find(item => item.id === widget.id).translate)).size > 3).map(widget => widget.id);
      assert.ok(moved.length >= 3, `widget content floats inside its slack: ${moved}`);
      metrics.float = { steps, reach, floatingWidgets: moved, layoutsWhileFloating: layoutEnd.value - layoutStart.value };
      await view.close();
    }
    checks.push(`#436 float acceptance (owner board, 6 widgets, 1280×720 ×3, 30 s interval, 2 s fade, Lively): 5 virtual minutes sampled every 50 ms keep the plane at opacity 1 and every widget in its cell at opacity ≥ 0.99, with its content inside the screen; at most one device pixel per step, no animation, transition or layout; ${JSON.stringify(metrics.float)}`);

    // (2c) #436 without animation (reduced motion, or Float gently off): the board jumps to its next spot only at
    // interval boundaries, at once and at opacity 1.
    for (const [label, options] of [
      ['reduced motion', { reducedMotion: 'reduce', state: scenario(ownerBoard()) }],
      ['Float gently off', { state: scenario(ownerBoard(state => { state.settings.appearance.motionEnabled = false; })) }],
    ]) {
      const view = await displayPage({ ...options, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 });
      const { page } = view;
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10));
      assert.equal(await page.locator('.ambient').getAttribute('data-float'), 'step', label);
      const changes = [], first = await sampleBoard(page);
      let last = first;
      for (let index = 0; index < 95 * 20; index++) {
        await page.clock.runFor(50);
        const sample = await sampleBoard(page);
        assert.equal(sample.opacity, 1, `${label}: opacity 1`);
        for (const widget of sample.widgets) assert.ok(widget.opacity >= 0.99, `${label}: ${widget.id} opacity`);
        assert.equal(sample.animations, 0, `${label}: no animation on the plane`);
        const translates = sample.widgets.map(widget => widget.translate).join('|'), lastTranslates = last.widgets.map(widget => widget.translate).join('|');
        if (sample.x !== last.x || sample.y !== last.y || translates !== lastTranslates) changes.push(sample.t);
        last = sample;
      }
      assert.ok(changes.length >= 3, `${label}: the board moved at each boundary (${changes.map(at => at - now)})`);
      // The display mounted between installing the clock (now) and the first sample.
      assert.ok(changes[0] - now >= 30_000 && changes[0] - first.t <= 30_100, `${label}: first move one interval after loading (${changes[0] - now} ms after the clock started, ${changes[0] - first.t} ms after the first sample)`);
      for (let index = 1; index < changes.length; index++) assert.ok(Math.abs(changes[index] - changes[index - 1] - 30_000) <= 100, `${label}: moves only at interval boundaries (±100 ms): ${changes.map(at => at - now)}`);
      await view.close();
    }
    checks.push('#436 reduced motion and Float gently off: the board and widget content jump only at interval boundaries (±100 ms), with no animation and opacity 1');

    // (2d) #436 Swap places (opt-in). With a glide, at least one widget changes cell every interval, the plane
    // stays at 1, no widget drops below 0.35 and no frame dims every widget below 0.5 (stepping each glide's own
    // timeline, which page.clock does not drive). Reduced motion swaps dim moving widgets to 0.4 and back, with no
    // translate animation. A settings change mid-glide snaps to the new rectangles.
    {
      // A 45 s interval puts the App's 30 s polls between swaps, so a settings change can land mid-glide.
      const view = await displayPage({ state: scenario(ownerBoard(state => { Object.assign(state.settings.appearance, { rearrange: true, motionIntervalSeconds: 45 }); })), viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 });
      const { page } = view;
      assert.equal(await page.locator('.ambient').getAttribute('data-swap'), 'glide');
      const frames = [];
      for (let interval = 1; interval <= 3; interval++) {
        const before = await sampleBoard(page);
        for (let step = 0; Number(await page.locator('.ambient').getAttribute('data-composition')) < interval; step++) { assert.ok(step < 1_000, `swap ${interval} happens`); await page.clock.runFor(50); }
        await until(page, () => document.getAnimations().some(animation => animation.id === 'lrd-glide'), `glide ${interval}`);
        const result = await page.evaluate(() => {
          const glides = document.getAnimations().filter(animation => animation.id === 'lrd-glide');
          for (const animation of glides) animation.pause();
          const duration = glides[0].effect.getTiming().duration, frames = [];
          for (let time = 0; time <= duration; time += 50) {
            for (const animation of glides) animation.currentTime = time;
            frames.push({ time, plane: Number(getComputedStyle(document.querySelector('.widget-grid-plane')).opacity), widgets: [...document.querySelectorAll('.ambient-widget')].map(section => Number(getComputedStyle(section).opacity)) });
          }
          const translated = glides.every(animation => animation.effect.getKeyframes().some(frame => frame.transform && frame.transform !== 'none'));
          for (const animation of glides) animation.finish();
          return { count: glides.length, duration, frames, translated };
        });
        const after = await sampleBoard(page);
        const changed = after.widgets.filter(widget => { const old = before.widgets.find(item => item.id === widget.id); return old.left !== widget.left || old.top !== widget.top; });
        assert.ok(changed.length >= 1 && result.count === changed.length, `swap ${interval}: ${changed.length} widgets changed cell, ${result.count} glided`);
        assert.ok(Math.abs(result.duration - 3_000) < 1, `glide lasts clamp(2 × 1.5, 1.2, 6) s (${result.duration})`);
        assert.ok(result.translated, 'a glide translates the widget from its old cell');
        for (const frame of result.frames) {
          assert.equal(frame.plane, 1, 'the plane stays at 1 during a swap');
          assert.ok(Math.min(...frame.widgets) >= 0.35, `no widget below 0.35: ${frame.widgets}`);
          assert.ok(frame.widgets.some(opacity => opacity >= 0.5), `never every widget below 0.5 at once (${frame.time} ms: ${frame.widgets})`);
        }
        frames.push(Math.min(...result.frames.flatMap(frame => frame.widgets)));
        // The board keeps floating through swaps.
        assert.equal(after.opacity, 1);
      }
      // A settings change mid-glide (Sun & moon turned off, picked up by the next poll while a glide runs in real
      // time) snaps every widget to its new rectangle at full opacity; nothing is left dim or half-way.
      for (let step = 0; Number(await page.locator('.ambient').getAttribute('data-composition')) < 4; step++) { assert.ok(step < 1_000, 'swap 4'); await page.clock.runFor(50); }
      await until(page, () => document.getAnimations().some(animation => animation.id === 'lrd-glide' && animation.playState === 'running'), 'glide 4');
      view.served.state = structuredClone(view.served.state); view.served.state.settings.widgets.sunMoon = false;
      let snapped = null;
      for (let step = 0; step < 40 && !snapped; step++) {
        await page.clock.runFor(1_000);
        snapped = await page.evaluate(() => document.querySelector('.ambient-sunMoon') ? null : { running: document.getAnimations().filter(animation => animation.id === 'lrd-glide' && animation.playState === 'running').length, opacities: [...document.querySelectorAll('.ambient-widget')].map(section => Number(getComputedStyle(section).opacity)) });
      }
      assert.ok(snapped, 'the poll applied the change');
      assert.equal(snapped.running, 0, 'the change cancelled the glides');
      assert.ok(snapped.opacities.every(opacity => opacity === 1), `every widget at its new rectangle at full opacity: ${snapped.opacities}`);
      assert.equal((await sampleBoard(page)).opacity, 1);
      await view.close();
      metrics.swap = { lowestWidgetOpacity: Math.min(...frames) };

      const reduced = await displayPage({ reducedMotion: 'reduce', state: scenario(ownerBoard(state => { state.settings.appearance.rearrange = true; })), viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 });
      assert.equal(await reduced.page.locator('.ambient').getAttribute('data-swap'), 'dim');
      // Page time stands still between runFor calls, while the opacity transitions run in real time.
      await reduced.page.clock.pauseAt(await reduced.page.evaluate(() => Date.now() + 10));
      const start = await sampleBoard(reduced.page);
      await reduced.page.clock.runFor(30_100);
      await reduced.page.waitForTimeout(800); // the 0.6 s opacity transition runs in real time
      const dimmed = await reduced.page.evaluate(() => ({ plane: Number(getComputedStyle(document.querySelector('.widget-grid-plane')).opacity), widgets: [...document.querySelectorAll('.ambient-widget')].map(section => Number(getComputedStyle(section).opacity)), motion: [...document.querySelectorAll('.ambient-widget')].flatMap(section => section.getAnimations().map(animation => animation.transitionProperty ?? animation.id ?? 'animation')), composition: document.querySelector('.ambient').dataset.composition }));
      assert.equal(dimmed.composition, '0', 'moving widgets dim before they move');
      assert.equal(dimmed.plane, 1);
      assert.ok(dimmed.widgets.some(opacity => Math.abs(opacity - 0.4) < 0.01) && dimmed.widgets.every(opacity => opacity >= 0.35), `moving widgets dim to 0.4: ${dimmed.widgets}`);
      await reduced.page.clock.runFor(700);
      const moved = await sampleBoard(reduced.page);
      assert.equal(await reduced.page.locator('.ambient').getAttribute('data-composition'), '1');
      assert.ok(moved.widgets.some(widget => { const old = start.widgets.find(item => item.id === widget.id); return old.left !== widget.left || old.top !== widget.top; }), 'and move while dimmed');
      const motion = await motionIn(reduced.page, '.ambient-widget');
      assert.ok(motion.every(name => name === 'transition:opacity'), `a reduced-motion swap only fades opacity, never translates: ${motion}`);
      await reduced.page.waitForTimeout(800);
      assert.ok((await sampleBoard(reduced.page)).widgets.every(widget => widget.opacity >= 0.99), 'then every widget is back at full opacity');
      await reduced.close();
    }
    checks.push(`#436 Swap places: a glide every interval moves at least one widget, the plane stays at 1, no widget below 0.35, never every widget below 0.5; reduced motion dims moving widgets to 0.4 with no translate animation; a settings change mid-glide snaps; ${JSON.stringify(metrics.swap)}`);

    // (2e) #436 Animation Off keeps widget content still while the board floats: no keyframe animation runs in the plane.
    {
      const view = await displayPage({ state: scenario(ownerBoard(level('off'))) });
      for (let step = 0; step < 40; step++) {
        await view.page.clock.runFor(1_000);
        assert.deepEqual(await planeMotion(view.page), [], 'Animation Off: nothing animates while the board floats');
      }
      const sample = await sampleBoard(view.page);
      assert.ok(sample.x !== 0 || sample.y !== 0, 'the board has floated');
      await view.close();
    }
    checks.push('#436 Animation Off: no in-widget keyframe animations (#76 inventory) while the board floats');

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

    // (4) Reveal: the first load is the only entrance on the display (#436: no black rest ends in a reveal any more).
    // It ends within fade + 1.7 s with delays in reading order (cap 6); a later interval reveals nothing.
    async function observeLoad(mutate) {
      const view = await displayPage({ state: scenario(mutate) });
      const { page } = view;
      const delays = await page.evaluate(() => [...document.querySelectorAll('.widget-grid-plane.revealing > .ambient-widget')].map(section => ({
        id: section.dataset.widgetId, order: Number(getComputedStyle(section).getPropertyValue('--reveal-order')),
        delay: section.querySelector('.widget-content').getAnimations().find(animation => animation.animationName === 'lrd-enter')?.effect.getTiming().delay ?? null,
      })));
      const revealing = await page.locator('.widget-grid-plane.revealing').count();
      await page.evaluate(() => {
        window.__motion = [];
        const plane = document.querySelector('.widget-grid-plane');
        const record = () => window.__motion.push({ t: Date.now(), revealing: plane.classList.contains('revealing'), opacity: getComputedStyle(plane).opacity });
        new MutationObserver(record).observe(plane, { attributes: true, attributeFilter: ['class', 'data-reveal'] });
        record();
      });
      for (let step = 0; step < 40; step++) await page.clock.runFor(100);
      const ended = await page.evaluate(() => window.__motion.find(entry => !entry.revealing)?.t ?? null);
      await page.clock.runFor(200_000);
      const log = await page.evaluate(() => window.__motion);
      await view.close();
      return { delays, revealing, ended, log };
    }
    const fadeMs = source.settings.appearance.fadeSeconds * 1000;
    for (const animation of ['subtle', 'lively']) {
      const { delays, revealing, ended, log } = await observeLoad(level(animation));
      assert.equal(revealing, 1, `${animation}: the first load reveals`);
      assert.ok(ended !== null && ended - now <= fadeMs + 1700 + 200, `${animation}: the entrance ends within fade + 1.7 s (${ended && ended - now} ms)`);
      assert.equal(log.filter(entry => entry.revealing && entry.t > ended).length, 0, `${animation}: no entrance after an interval`);
      const ordered = delays.filter(item => item.delay !== null).sort((a, b) => a.order - b.order);
      assert.ok(ordered.length >= 3, `${animation}: widgets entered (${JSON.stringify(delays)})`);
      for (let index = 1; index < ordered.length; index++) assert.ok(ordered[index].delay >= ordered[index - 1].delay, 'delays follow reading order');
      assert.ok(ordered.at(-1).delay > ordered[0].delay, 'a real stagger');
      assert.ok(ordered.at(-1).delay <= 6 * (animation === 'lively' ? 110 : 70), 'stagger capped at six steps');
    }
    for (const [label, mutate] of [['Float gently off', state => { state.settings.appearance.motionEnabled = false; }], ['fade 0', state => { state.settings.appearance.fadeSeconds = 0; }]]) {
      const { revealing, log } = await observeLoad(state => { level('lively')(state); mutate(state); });
      assert.equal(revealing, 0, `${label}: no entrance`);
      assert.equal(log.filter(entry => entry.revealing).length, 0, `${label}: never an entrance`);
    }
    // Reading order matches the shared helper.
    {
      const view = await displayPage({ state: scenario(level('subtle')) });
      const sections = await view.page.evaluate(() => [...document.querySelectorAll('.ambient-widget')].map(section => ({ id: section.dataset.widgetId, order: Number(section.style.getPropertyValue('--reveal-order')) })));
      const expected = widgetRevealOrder(source.settings.widgetGrid, sections.map(section => section.id));
      for (const section of sections) assert.equal(section.order, Math.min(expected.indexOf(section.id), 6), `${section.id} reading order`);
      await view.close();
    }
    checks.push('reveal: the first load reveals once (.revealing ends within fade + 1.7 s, delays in reading order, cap 6) and no interval reveals again; none with Float gently off or fade 0');

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
          // The cell: the section's box without its #436 float translation (its content floats inside it).
          const [x, y] = getComputedStyle(section).translate.split(' ').map(value => parseFloat(value) || 0), dx = x ?? 0, dy = y ?? 0;
          return { id: section.dataset.widgetId, outer: { left: outer.left - dx, top: outer.top - dy, right: outer.right - dx, bottom: outer.bottom - dy }, inner: { left: inner.left - dx, top: inner.top - dy, right: inner.right - dx, bottom: inner.bottom - dy }, fit: content.style.transform, translate: getComputedStyle(content).translate };
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
        await view.close();
        if (animation === 'lively' && !still) {
          // The entrance (on load, #436) grows the bars of an elevated forecast from their baseline.
          const loaded = await displayPage({ reducedMotion, state: scenario(state => { level(animation)(state); only('weather', 'large')(state); }) });
          const grow = await motionIn(loaded.page, '.rain-bars > .rain-bar');
          assert.ok(grow.includes('lrd-bar-grow'), `the Lively entrance grows the rain bars (${grow})`);
          await loaded.close();
        }
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
        await view.close();
        if (animation === 'lively') {
          // The entrance (on load, #436) fades reminder rows without moving them.
          const loaded = await displayPage({ state: scenario(state => { level(animation)(state); only('reminders', 'medium')(state); state.reminders = pendingList(12); }) });
          await until(loaded.page, () => document.querySelectorAll('.ambient-reminder-list > li:not(.reminder-overflow)').length > 0, 'measured reminder rows');
          const entrance = await motionIn(loaded.page, '.ambient-reminder-list > li:not(.reminder-overflow)');
          assert.ok(entrance.length > 0 && entrance.every(name => name === 'lrd-fade-in'), `Lively reminder rows fade without moving (${entrance})`);
          await loaded.close();
        }
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

    // (15) #357 (superseded by #436): there is no fade-out to interrupt. A settings or preference change at any moment,
    // including just before an interval boundary, keeps the plane at opacity 1 and the board where it is.
    {
      const results = [];
      for (const [label, mutate] of [
        ['interval 30 → 120 s', state => { state.settings.appearance.motionIntervalSeconds = 120; }],
        ['Float gently off', state => { state.settings.appearance.motionEnabled = false; }],
        ['Swap places on', state => { state.settings.appearance.rearrange = true; }],
        ['reduced motion', null],
      ]) {
        const view = await displayPage({ state: scenario(ownerBoard()) });
        const { page, served } = view;
        let polls = 0; page.on('response', response => { if (new URL(response.url()).pathname === '/api/state') polls++; });
        // The App's 30 s poll lands about at the first interval boundary.
        await page.clock.runFor(29_000);
        const before = await sampleBoard(page);
        if (mutate) {
          served.state = structuredClone(served.state); mutate(served.state); const start = polls;
          for (let step = 0; polls === start; step++) { assert.ok(step < 40, `${label}: the 30 s poll`); await page.clock.runFor(100); await page.waitForTimeout(20); }
        } else await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForTimeout(300);
        let lowest = 1;
        for (let step = 0; step < 80; step++) {
          const sample = await sampleBoard(page);
          lowest = Math.min(lowest, sample.opacity, ...sample.widgets.map(widget => widget.opacity));
          await page.clock.runFor(50);
        }
        const after = await sampleBoard(page);
        assert.equal(lowest >= 0.35, true, `${label}: nothing goes dark (lowest opacity ${lowest})`);
        assert.ok(Math.abs(after.x - before.x) <= 0.035 * 1280 * 2 && after.opacity === 1, `${label}: the plane stays visible`);
        results.push(`${label}: lowest opacity ${lowest.toFixed(2)}`);
        await view.close();
      }
      checks.push(`#357/#436 settings changes at an interval boundary never darken the display: ${results.join('; ')}`);
    }

    // (16) #174/#436: the analog hands accumulate for the whole session (nothing goes black to re-base them), so each
    // minute turns them forward once, across 10:59 → 11:00, 11:59 → 12:00 and 12:59 → 1:00, never backwards; the
    // ease completes. #161: the hands turn as composited HTML wrappers, so a minute change animates only rotate.
    {
      const onlyAnalog = state => { state.settings.appearance.clockStyle = 'analog'; state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'clock'])); };
      const elevenAm = Date.parse('2026-10-18T15:00:00Z'); // 11:00 in America/Toronto: the minute hand wraps from 354° to 360°
      const view = await displayPage({ time: elevenAm - 90_000, state: scenario(state => { level('subtle')(state); onlyAnalog(state); }) });
      const { page } = view;
      await page.evaluate(() => {
        window.__hands = []; window.__handEvents = [];
        const clock = document.querySelector('.analog-clock'), minute = () => clock.querySelector('.analog-minute');
        const record = () => window.__hands.push({ t: Date.now(), minute: parseFloat(minute().style.rotate), hour: parseFloat(clock.querySelector('.analog-hour').style.rotate), snap: minute().hasAttribute('data-hand-snap') });
        new MutationObserver(record).observe(clock, { attributes: true, subtree: true, attributeFilter: ['style', 'data-hand-snap'] });
        for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) clock.addEventListener(type, event => { if (event.target.classList.contains('analog-minute')) window.__handEvents.push({ type, t: Date.now(), property: event.propertyName }); });
        record();
      });
      await page.clock.runFor(90_500);
      const eased = await page.evaluate(() => ({ minute: parseFloat(document.querySelector('.analog-minute').style.rotate), snap: document.querySelector('.analog-minute').hasAttribute('data-hand-snap'), motion: [...document.querySelectorAll('.analog-hand')].flatMap(hand => hand.getAnimations().map(animation => ({ name: animation.transitionProperty ?? animation.animationName, html: hand instanceof HTMLElement }))) }));
      assert.deepEqual([eased.minute, eased.snap], [360, false], `10:59 → 11:00 turns the minute hand on to 360°, easing (${JSON.stringify(eased)})`);
      assert.ok(eased.motion.length >= 1 && eased.motion.every(item => item.name === 'rotate' && item.html), `#161: only rotate on HTML hand wrappers (${JSON.stringify(eased.motion)})`);
      assert.ok((await inventory(page)).every(item => item.name === 'transition:rotate'), '#161: the minute change runs nothing else in the plane');
      await page.waitForTimeout(900); // the 600 ms ease runs in real time
      const events = await page.evaluate(() => window.__handEvents);
      const ease = events.slice(events.findLastIndex(event => event.type === 'transitionrun') + 1);
      assert.ok(ease.some(event => event.type === 'transitionend' && event.property === 'rotate'), `#174: the minute ease completes (${JSON.stringify(events)})`);
      assert.ok(!ease.some(event => event.type === 'transitioncancel'), `#174: nothing cuts the ease short (${JSON.stringify(events)})`);
      // Two more hours (with every interval boundary on the way): 11:59 → 12:00 and 12:59 → 1:00 keep turning forward.
      await page.clock.runFor(2 * 3_600_000 + 30_000);
      const log = await page.evaluate(() => window.__hands);
      for (let index = 1; index < log.length; index++) {
        assert.ok(log[index].minute >= log[index - 1].minute, `the minute hand never turns backwards (${JSON.stringify([log[index - 1], log[index]])})`);
        assert.ok(log[index].hour >= log[index - 1].hour, `the hour hand never turns backwards (${JSON.stringify([log[index - 1], log[index]])})`);
        assert.ok(log[index].minute - log[index - 1].minute <= 6 + 1e-9, 'one minute at a time');
      }
      const last = log.at(-1);
      assert.equal(last.minute, 360 * 3, 'at 1:00 the minute hand has turned forward three full times since 10:59');
      assert.ok(Math.abs(last.hour - 390) < 1e-9, `12:59 → 1:00: the hour hand reaches 1 going forward (${last.hour}°)`);
      await view.close();

      // #161 cost: CDP counts over one minute change at Off, at Subtle (a 600 ms ease) and at Subtle with the ease
      // stretched to 3 s, each over 3.5 real seconds after it. A main-thread ease would recalculate style on every
      // frame, about five times as often over 3 s as over 600 ms; a composited one costs the same for both.
      const cost = {};
      for (const [label, animation, ease] of [['off', 'off', null], ['subtle', 'subtle', null], ['subtle, 3 s ease', 'subtle', '3000ms']]) {
        const run = await displayPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3, state: scenario(state => { level(animation)(state); onlyAnalog(state); }) });
        if (ease) await run.page.addStyleTag({ content: `.grid-ambient { --motion-hand: ${ease} !important; }` });
        await run.page.clock.pauseAt(await run.page.evaluate(() => Date.now() + 100));
        await run.page.clock.setSystemTime(new Date(elevenAm - 3_000)); await run.page.clock.runFor(1_000); await run.page.waitForTimeout(300);
        const session = await run.context.newCDPSession(run.page); await session.send('Performance.enable');
        const read = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
        const start = await read();
        await run.page.clock.runFor(3_000); // a tick after 11:00 changes the minute
        await run.page.waitForTimeout(3_500);
        const end = await read();
        assert.equal(parseFloat(await run.page.locator('.analog-minute').evaluate(hand => hand.style.rotate)) % 360, 0, `${label}: the minute hand reached 12`);
        cost[label] = { RecalcStyleCount: end.RecalcStyleCount - start.RecalcStyleCount, LayoutCount: end.LayoutCount - start.LayoutCount };
        await run.close();
      }
      assert.ok(Math.abs(cost['subtle, 3 s ease'].RecalcStyleCount - cost.subtle.RecalcStyleCount) <= 4, `#161: style recalculation does not scale with the ease's frames ${JSON.stringify(cost)}`);
      assert.ok(cost.subtle.RecalcStyleCount - cost.off.RecalcStyleCount <= 12, `#161: an eased minute change recalculates style only a few times ${JSON.stringify(cost)}`);
      assert.ok(Math.max(cost.subtle.LayoutCount, cost['subtle, 3 s ease'].LayoutCount) - cost.off.LayoutCount <= 2, `#161: and adds no layout ${JSON.stringify(cost)}`);
      checks.push(`#174/#161/#436 analog hands: 10:59 → 11:00 eases to 360° on HTML wrappers (rotate only) and completes (transitionend, no cancel); over two more hours, through 11:59 → 12:00 and 12:59 → 1:00, both hands only ever turn forward, one minute at a time, never re-basing; one minute change over 3.5 s at 1280×720 ×3: ${JSON.stringify(cost)}`);
    }

    // (9)–(10) Editor: samples are still; the Animation control follows the draft contract.
    async function editorPage({ reducedMotion = 'no-preference', viewport = { width: 1280, height: 720 } } = {}) {
      const context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', reducedMotion }); contexts.add(context);
      const answered = await keepPagesLocal(context, base);
      // A fixed non-Windows status, so the Motion section's power line (#436, tests/ui/screen-browser.mjs) never
      // arrives while these checks measure the disclosure.
      await context.route('**/api/windows/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ available: false, selectedScreenSaver: null, active: null, timeoutSeconds: null, secure: null, isLivingRoomDisplay: false, power: { available: false, scheme: null, displayOffSeconds: null, sleepSeconds: null } }) }));
      const page = await context.newPage();
      const watch = collectErrors(page);
      await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
      await page.goto(base + '/editor');
      await page.getByRole('tab', { name: 'Style', exact: true }).waitFor();
      return { page, async close() { watch.closing = true; for (const url of answered) outside.add(url); contexts.delete(context); await context.close(); } };
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
      assert.equal(await page.getByText('Off keeps the content of widgets still; movement is set below. Subtle animates changes. Lively adds gentle weather motion.').count(), 1);
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
      // #248/#436 frame budget: at Off with Float gently on (the default), the display draws a frame only when the
      // board or a widget's content steps one device pixel (at most 30 steps a second) or a value changes; a
      // continuous animation drew about 120 frames a second. Whole-browser CPU (all Edge processes, % of one core)
      // is recorded alongside. Both depend on the GPU, so `gpu: false` leaves them out.
      const frames = metrics.frames = {};
      for (const [label, viewport, deviceScaleFactor] of gpu ? [['1280×720 ×3', { width: 1280, height: 720 }, 3], ['3840×2160 ×1', { width: 3840, height: 2160 }, 1]] : []) {
        const view = await displayPage({ clock: false, fixedTime: now, viewport, deviceScaleFactor, state: scenario(state => { level('off')(state); fullBoard(state); }) });
        assert.equal(await view.page.locator('.grid-ambient[data-float="float"]').count(), 1, 'Float gently is on');
        await view.page.waitForTimeout(3_000);
        // Count every float step: the plane's and each widget's style writes.
        await view.page.evaluate(() => { window.__steps = 0; new MutationObserver(records => { window.__steps += records.length; }).observe(document.querySelector('.widget-grid-plane'), { attributes: true, attributeFilter: ['style'], subtree: true }); });
        const session = await view.context.newCDPSession(view.page); const browserSession = await browser.newBrowserCDPSession();
        const cpu = async () => (await browserSession.send('SystemInfo.getProcessInfo')).processInfo.reduce((sum, item) => sum + item.cpuTime, 0);
        const events = []; session.on('Tracing.dataCollected', data => events.push(...data.value));
        await session.send('Tracing.start', { categories: 'disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' });
        const cpuStart = await cpu(), started = Date.now();
        await view.page.waitForTimeout(10_000);
        const seconds = (Date.now() - started) / 1000, cpuEnd = await cpu(), steps = await view.page.evaluate(() => window.__steps);
        const complete = new Promise(done => session.once('Tracing.tracingComplete', done)); await session.send('Tracing.end'); await complete;
        const drawn = events.filter(event => event.name === 'DrawFrame').length;
        frames[label] = { drawFramesPerSecond: Number((drawn / seconds).toFixed(2)), stepsPerSecond: Number((steps / seconds).toFixed(2)), browserCpuPercent: Number(((cpuEnd - cpuStart) / seconds * 100).toFixed(1)) };
        await browserSession.detach().catch(() => undefined);
        await view.close();
        assert.ok(frames[label].drawFramesPerSecond <= 30, `${label}: at most 30 frames a second ${JSON.stringify(frames[label])}`);
        assert.ok(drawn <= steps + 2 * seconds + 5, `${label}: a frame only when something steps ${JSON.stringify(frames[label])}`);
      }
      checks.push(gpu ? `#248/#436 frame budget at Off with Float gently on, full board over 10 s: ${JSON.stringify(frames)}` : '#248/#436 frame budget skipped (--no-gpu)');
    }
    // (17) #436 real time: 70 s at a 30 s interval on the owner board, timers running for real, never below 0.99.
    {
      const view = await displayPage({ clock: false, state: scenario(ownerBoard()), viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 });
      const started = Date.now();
      let lowest = 1, samples = 0, moved = new Set();
      while (Date.now() - started < 70_000) {
        const sample = await sampleBoard(view.page);
        lowest = Math.min(lowest, sample.opacity, ...sample.widgets.map(widget => widget.opacity));
        moved.add(`${sample.x},${sample.y}`); samples++;
        await view.page.waitForTimeout(100);
      }
      await view.close();
      assert.ok(lowest >= 0.99, `70 s in real time: lowest opacity ${lowest}`);
      assert.ok(moved.size > 20, `the board floated in real time (${moved.size} positions)`);
      metrics.realTime = { seconds: 70, samples, lowest, positions: moved.size };
      checks.push(`#436 70 s in real time at a 30 s interval (owner board): opacity never below 0.99 over ${samples} samples, ${moved.size} board positions`);
    }
    assert.deepEqual(errors, [], `page or console errors (failed requests: ${JSON.stringify(failedRequests)}; cancelled by closing: ${JSON.stringify(cancelled)})`);
    return { checks, metrics, cancelled, outside: [...outside], images: 'none written; all state stays in RAM' };
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
