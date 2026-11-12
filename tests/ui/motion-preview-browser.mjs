// #515: isolated synthetic editor/display pages; no native host, installed data or screenshot files.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { WIDGET_IDS } from '../../src/shared/widgets.ts';
import { floatPath, FLOAT_TRAVEL, stepPath } from '../../src/shared/float.ts';
import { keepPagesLocal } from './lib/local-only.mjs';
import { mockScreenWakeLock } from './lib/windows-fixture.mjs';

// #530: enabling Preview starts this real-time entrance independently of the local movement
// clock. Compare sought frames after it ends, rather than caching ink from two reveal phases.
export async function settleClockEntrance(page) {
  await page.locator('.clock-digits').evaluate(async digits => {
    await Promise.all(digits.getAnimations().filter(animation => animation instanceof CSSAnimation && animation.animationName === 'lrd-clock-reveal').map(animation => animation.finished));
  });
}

// #686: the preview is one slider over an hour that follows the draft settings. A settings change keeps the
// slider where it is and redraws that moment; poll the rendered frame for the new mode instead of advancing the clock.
export function motionPreviewModeReady({ seconds, float }) {
  const slider = document.querySelector('[aria-label="Movement preview time"]'), ambient = document.querySelector('.preview-surface .grid-ambient');
  return slider?.value === String(seconds) && ambient?.getAttribute('data-preview-seconds') === Number(seconds).toFixed(3) && ambient.getAttribute('data-float') === float;
}

export async function runMotionPreviewQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-motion-preview-'));
  const now = Date.parse('2026-10-18T13:00:00Z');
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), now: () => now, fetcher: async () => Response.json(forecastFixture()) });
  const settings = defaultSettings();
  Object.assign(settings.appearance, { motionIntervalSeconds: 30, fadeSeconds: 2, rearrange: true, animation: 'lively', clockStyle: 'digital' });
  settings.widgets = Object.fromEntries(WIDGET_IDS.map(id => [id, ['clock', 'weather', 'note'].includes(id)]));
  settings.widgetData.note.text = 'A quiet room'; settings.widgetGrid.density = 'balanced';
  Object.assign(settings.widgetGrid.placements, { clock: { column: 0, row: 0, size: 'medium' }, weather: { column: 4, row: 0, size: 'medium' }, note: { column: 0, row: 4, size: 'medium' } });
  await app.store.update(data => { data.settings = settings; data.reminders = []; });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [], writes = [], contexts = [], crossings = [];
  const saved = JSON.stringify(app.store.snapshot().settings);
  const savedRevision = app.store.view().settingsRevision;
  async function assertNoPersistedWrites() {
    assert.equal(JSON.stringify(app.store.snapshot().settings), saved);
    assert.equal(app.store.view().settingsRevision, savedRevision, 'presence and preview cannot advance the persisted settings revision');
    for (const write of writes) {
      assert.deepEqual([write.method(), new URL(write.url()).pathname], ['POST', '/api/preview/display'], 'every other mutation remains forbidden');
      const body = write.postDataJSON();
      assert.ok(['start', 'heartbeat', 'release'].includes(body?.action), 'only normal display lifecycle actions are expected');
      assert.deepEqual(Object.keys(body).sort(), body.action === 'start' ? ['action'] : ['action', 'id']);
      if (body.action !== 'start') assert.match(body.id, /^[a-f0-9]{32}$/);
      const response = await write.response(); assert.equal(response?.status(), body.action === 'start' ? 201 : 204);
    }
  }
  const readFrame = page => page.locator('.grid-ambient').evaluate(ambient => ({
    time: ambient.getAttribute('data-preview-seconds'), cycle: ambient.getAttribute('data-composition'),
    plane: ambient.querySelector('.widget-grid-plane').style.transform,
    widgets: [...ambient.querySelectorAll('.ambient-widget')].map(el => ({ id: el.dataset.widgetId, left: el.style.left, top: el.style.top, floatX: el.style.getPropertyValue('--float-x'), floatY: el.style.getPropertyValue('--float-y'), transform: getComputedStyle(el).transform, opacity: getComputedStyle(el).opacity })),
  }));
  async function open(path = '/editor', viewport = { width: 1280, height: 720 }, reducedMotion = 'no-preference', preview = path === '/editor') {
    const context = await browser.newContext({ viewport, reducedMotion, timezoneId: 'America/Toronto' }); contexts.push(context);
    await keepPagesLocal(context, base);
    await mockScreenWakeLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).origin === base && !['GET', 'HEAD'].includes(request.method())) writes.push(request); });
    await page.clock.install({ time: new Date(now) }); await page.clock.pauseAt(new Date(now));
    await page.goto(base + path); await page.locator('.grid-ambient').waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (preview) {
      await page.getByRole('button', { name: 'Preview movement', exact: true }).click();
      await settleClockEntrance(page);
    }
    return page;
  }
  async function seek(page, seconds) {
    await page.getByRole('slider', { name: 'Movement preview time', exact: true }).evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    }, seconds);
    await page.waitForFunction(value => document.querySelector('.grid-ambient')?.getAttribute('data-preview-seconds') === Number(value).toFixed(3), seconds);
    // Let ResizeObserver settle measurements without advancing the preview's paused clock.
    await page.clock.runFor(40);
  }
  async function inkGeometry(page) {
    return page.locator('.grid-ambient').evaluate(ambient => {
      const bounds = ambient.getBoundingClientRect();
      return [...ambient.querySelectorAll('.ambient-widget')].map(section => {
        const box = section.getBoundingClientRect(), x = (parseFloat(section.style.getPropertyValue('--float-x')) || 0) * box.width / section.offsetWidth, y = (parseFloat(section.style.getPropertyValue('--float-y')) || 0) * box.height / section.offsetHeight;
        const rects = [...section.querySelectorAll('svg, img')].map(el => el.getBoundingClientRect());
        const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT); let node;
        while ((node = walker.nextNode())) {
          if (!node.textContent.trim() || node.parentElement.closest('.sr-only, svg')) continue;
          const range = document.createRange(); range.selectNode(node); rects.push(...range.getClientRects());
        }
        const drawn = rects.filter(r => r.width > 0 && r.height > 0);
        const ink = { left: Math.min(...drawn.map(r => r.left)), right: Math.max(...drawn.map(r => r.right)), top: Math.min(...drawn.map(r => r.top)), bottom: Math.max(...drawn.map(r => r.bottom)) };
        return { id: section.dataset.widgetId, ink, withinSlot: ink.left >= box.left - x - 1.5 && ink.right <= box.right - x + 1.5 && ink.top >= box.top - y - 1.5 && ink.bottom <= box.bottom - y + 1.5, withinScreen: ink.left >= bounds.left - 1.5 && ink.right <= bounds.right + 1.5 && ink.top >= bounds.top - 1.5 && ink.bottom <= bounds.bottom + 1.5 };
      });
    });
  }
  try {
    const lifecycle = await open('/editor', { width: 1280, height: 720 }, 'no-preference', false);
    await lifecycle.waitForFunction(() => document.querySelector('.weather-glyph[data-glyph-hero]')?.getAnimations({ subtree: true }).some(animation => animation.effect?.getTiming().iterations === Infinity));
    const loopCount = await lifecycle.evaluate(() => {
      const glyph = document.querySelector('.weather-glyph[data-glyph-hero]');
      const loops = glyph.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations === Infinity);
      globalThis.__lrdGlyphFixture = { glyph, loops };
      return loops.filter(animation => animation.playState === 'running').length;
    });
    assert.ok(loopCount > 0, 'the authored Lively weather glyph starts with a running loop');
    await lifecycle.getByRole('button', { name: 'Preview movement', exact: true }).click();
    await seek(lifecycle, 15);
    assert.deepEqual(await lifecycle.evaluate(() => {
      const { glyph, loops } = globalThis.__lrdGlyphFixture;
      return { same: glyph === document.querySelector('.weather-glyph[data-glyph-hero]'), paused: loops.every(animation => animation.playState === 'paused' && animation.currentTime === 15_000) };
    }), { same: true, paused: true }, 'preview seeks the same mounted glyph loops');
    await lifecycle.getByRole('button', { name: 'Back to layout', exact: true }).click();
    assert.deepEqual(await lifecycle.evaluate(() => {
      const { glyph, loops } = globalThis.__lrdGlyphFixture;
      return { same: glyph === document.querySelector('.weather-glyph[data-glyph-hero]'), running: loops.every(animation => animation.playState === 'running') };
    }), { same: true, running: true }, 'Back to layout resumes the same previously running glyph loops');
    await lifecycle.evaluate(() => { for (const animation of globalThis.__lrdGlyphFixture.loops) { animation.pause(); animation.currentTime = 1234; } });
    await lifecycle.getByRole('button', { name: 'Preview movement', exact: true }).click(); await seek(lifecycle, 31);
    await lifecycle.getByRole('button', { name: 'Back to layout', exact: true }).click();
    assert.ok(await lifecycle.evaluate(() => globalThis.__lrdGlyphFixture.loops.every(animation => animation.playState === 'paused' && animation.currentTime === 1234)), 'preview restores an already-paused loop without taking over its play state or time');
    await lifecycle.getByRole('button', { name: 'Preview movement', exact: true }).click(); await seek(lifecycle, 15);
    await lifecycle.route('**/api/state', async route => {
      const response = await route.fetch(), state = await response.json();
      state.weather.current.weatherCode = 61;
      await route.fulfill({ response, json: state });
    });
    await lifecycle.clock.runFor(30_100);
    await lifecycle.locator('.weather-glyph[data-glyph-hero][data-glyph="rain"]').waitFor();
    await seek(lifecycle, 31);
    assert.deepEqual(await lifecycle.evaluate(() => {
      const old = globalThis.__lrdGlyphFixture.loops;
      const fresh = document.querySelector('.weather-glyph[data-glyph-hero]').getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations === Infinity);
      globalThis.__lrdGlyphFixture.fresh = fresh;
      return { oldIdle: old.every(animation => animation.playState === 'idle' && !animation.effect.target.isConnected), freshPaused: fresh.length > 0 && fresh.every(animation => animation.playState === 'paused') };
    }), { oldIdle: true, freshPaused: true }, 'a condition update cancels the replaced glyph loops and seeks only their live replacements');
    await lifecycle.getByRole('button', { name: 'Back to layout', exact: true }).click();
    assert.ok(await lifecycle.evaluate(() => globalThis.__lrdGlyphFixture.loops.every(animation => animation.playState === 'idle') && globalThis.__lrdGlyphFixture.fresh.every(animation => animation.playState === 'running')), 'returning restores the replacement glyph without reviving its cancelled predecessor');
    await lifecycle.context().close();
    checks.push('Back to layout restores the same mounted Lively glyph loops and prior paused clocks; condition changes seek/restore the live replacement without reviving cancelled predecessors');

    const live = await open('/display'), liveBefore = await readFrame(live), page = await open();
    // #686: one hour slider and nothing else: no Play/Pause, one-second buttons, window chooser or interval jumps.
    const controls = page.getByRole('region', { name: 'Movement preview', exact: true });
    assert.deepEqual(await controls.evaluate(region => ({ sliders: region.querySelectorAll('input[type="range"]').length, buttons: region.querySelectorAll('button').length, selects: region.querySelectorAll('select').length, details: region.querySelectorAll('details').length,
      range: [...region.querySelectorAll('input[type="range"]')].map(input => [input.min, input.max, input.step, input.value]), time: region.querySelector('.motion-preview-time').textContent, note: region.querySelectorAll('p').length })),
    { sliders: 1, buttons: 0, selects: 0, details: 0, range: [['0', '3600', '1', '0']], time: '0:00 / 60:00', note: 1 }, 'one slider from 0:00 to 60:00 in seconds, the time and one line');
    assert.match(await controls.locator('p').innerText(), /an hour with these settings\. Nothing changes on the display or in saved settings\./);
    const frames = new Map();
    for (const time of [0, 15, 29, 30, 31, 33, 60, 61, 123, 1801, 3600]) {
      await seek(page, time); frames.set(time, await readFrame(page));
      const expected = floatPath(time, 30);
      const actual = await page.locator('.grid-ambient').evaluate((el, args) => {
        const dpr = devicePixelRatio || 1, snap = v => Math.round(v * dpr) / dpr;
        return { actual: el.querySelector('.widget-grid-plane').style.transform, expected: `translate(${snap(args.x * args.travel * parseFloat(getComputedStyle(el).width))}px, ${snap(args.y * args.travel * parseFloat(getComputedStyle(el).height))}px)` };
      }, { ...expected, travel: FLOAT_TRAVEL });
      assert.equal(actual.actual, actual.expected, `time ${time} uses runtime floatPath`);
      const ink = await inkGeometry(page);
      assert.ok(ink.every(item => item.withinSlot && item.withinScreen), `time ${time}: measured content remains in its moving slot and screen ${JSON.stringify(ink)}`);
      const overlaps = [];
      for (let a = 0; a < ink.length; a++) for (let b = a + 1; b < ink.length; b++) {
        const one = ink[a].ink, two = ink[b].ink;
        if (Math.min(one.right, two.right) - Math.max(one.left, two.left) > 1 && Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top) > 1) overlaps.push([ink[a].id, ink[b].id]);
      }
      if ([0, 15, 29, 33, 123].includes(time)) assert.deepEqual(overlaps, [], `settled frame ${time} has no content overlap`);
      else if (overlaps.length) crossings.push({ time, pairs: overlaps });
    }
    assert.equal(frames.get(29).cycle, '0'); assert.equal(frames.get(30).cycle, '1'); assert.equal(frames.get(60).cycle, '2'); assert.equal(frames.get(123).cycle, '4');
    assert.equal(frames.get(1801).cycle, '60'); assert.equal(frames.get(3600).cycle, '120', 'the end of the hour is the 120th swap at a 30 s interval');
    assert.notDeepEqual(frames.get(30).widgets.map(w => w.transform), frames.get(31).widgets.map(w => w.transform), 'complete swap progression is seekable');
    for (const time of [31, 15, 3600, 123, 30, 61, 1801, 0]) { await seek(page, time); assert.deepEqual(await readFrame(page), frames.get(time), `backward seek ${time} is deterministic`); }
    checks.push('One hour slider only (0:00-60:00, 1 s steps, the time and one line; no Play, one-second, window or interval controls); start, intermediate, transition boundaries, the middle and the end of the hour sample shared float paths; backward and repeated seeks replay identical composition history and glide frames');

    await seek(page, 31); const paused = await readFrame(page); await page.clock.runFor(2500);
    assert.deepEqual(await readFrame(page), paused, 'a resting slider holds the movement while live information ticks');
    const animations = await page.locator('.grid-ambient').evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.id === 'lrd-preview').map(a => ({ time: a.currentTime, state: a.playState })));
    assert.ok(animations.length > 0); assert.ok(animations.every(a => a.time === 1000 && a.state === 'paused'));
    // Keyboard (#686): arrows move 5 s, Page Up and Page Down a minute, Home and End to the ends, all clamped to the hour.
    const slider = page.getByRole('slider', { name: 'Movement preview time', exact: true }), shown = () => controls.locator('.motion-preview-time').textContent();
    await slider.focus();
    for (const [key, value, label] of [['Home', '0', '0:00'], ['ArrowRight', '5', '0:05'], ['ArrowUp', '10', '0:10'], ['PageUp', '70', '1:10'], ['PageDown', '10', '0:10'], ['ArrowLeft', '5', '0:05'], ['ArrowDown', '0', '0:00'], ['ArrowLeft', '0', '0:00'], ['PageDown', '0', '0:00'],
      ['End', '3600', '60:00'], ['ArrowRight', '3600', '60:00'], ['PageUp', '3600', '60:00'], ['PageDown', '3540', '59:00']]) {
      await page.keyboard.press(key);
      assert.equal(await slider.inputValue(), value, `${key} moves the slider to ${value} s`);
      assert.equal(await shown(), `${label} / 60:00`); assert.equal(await slider.getAttribute('aria-valuetext'), `${label} of 60:00`);
      assert.equal(await page.locator('.grid-ambient').getAttribute('data-preview-seconds'), Number(value).toFixed(3), `the canvas shows ${value} s`);
    }
    checks.push('A resting slider holds the movement while live information ticks; keyboard arrows move 5 s, Page Up/Down a minute, Home/End to 0:00 and 60:00, clamped, with the time shown and announced');

    await page.getByRole('tab', { name: 'Style', exact: true }).click(); await page.locator('summary', { hasText: 'Motion' }).click();
    // The slider follows the draft (#686): a settings change keeps the moment and draws it with the new settings.
    await seek(page, 1234); assert.equal(await page.locator('.grid-ambient').getAttribute('data-float'), 'float');
    await page.getByRole('checkbox', { name: 'Float gently', exact: true }).uncheck();
    await page.waitForFunction(motionPreviewModeReady, { seconds: 1234, float: 'step' }, { polling: 10 });
    assert.equal(await slider.inputValue(), '1234', 'a settings change keeps the slider where it is'); assert.equal(await slider.getAttribute('max'), '3600');
    const stepped = await page.locator('.grid-ambient').evaluate((el, args) => {
      const dpr = devicePixelRatio || 1, snap = v => Math.round(v * dpr) / dpr;
      return { actual: el.querySelector('.widget-grid-plane').style.transform, expected: `translate(${snap(args.x * args.travel * parseFloat(getComputedStyle(el).width))}px, ${snap(args.y * args.travel * parseFloat(getComputedStyle(el).height))}px)` };
    }, { ...stepPath(1234, 30), travel: FLOAT_TRAVEL });
    assert.equal(stepped.actual, stepped.expected, 'the same moment now steps, as the display would without Float gently');
    assert.equal(await page.locator('.grid-ambient').getAttribute('data-swap'), 'dim');
    await seek(page, 30); assert.equal((await readFrame(page)).cycle, '0');
    await seek(page, 31); assert.equal((await readFrame(page)).cycle, '1');
    assert.ok((await readFrame(page)).widgets.some(w => Number(w.opacity) < .99), 'a dim swap is inspectable');
    await page.getByRole('checkbox', { name: 'Swap places', exact: true }).uncheck();
    await page.waitForFunction(() => !document.querySelector('.preview-surface .grid-ambient')?.hasAttribute('data-swap'));
    assert.equal(await slider.inputValue(), '31'); await seek(page, 120);
    assert.equal((await readFrame(page)).cycle, '0');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await assertNoPersistedWrites();
    assert.deepEqual(await readFrame(live), liveBefore, 'editor clock cannot mutate an already-open display');
    checks.push('Settings changes keep the slider position and redraw that moment with the draft settings (stepping without Float gently); dim and swaps-off behavior are correct, Cancel restores settings, and only valid ephemeral display-presence requests occur without persisted writes or live-display changes');

    await seek(page, 31);
    if (capture) images.push({ name: 'motion-preview-desktop', bytes: await page.screenshot() });
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }]) {
      const mobile = await open('/editor', viewport); const controls = mobile.getByRole('region', { name: 'Movement preview' });
      await controls.scrollIntoViewIfNeeded();
      assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page overflow');
      const target = await controls.getByRole('slider', { name: 'Movement preview time', exact: true }).evaluate(el => { const r = el.getBoundingClientRect(), time = el.parentElement.querySelector('.motion-preview-time').getBoundingClientRect(); return { width: r.width, height: r.height, sameRow: Math.abs((r.top + r.bottom) / 2 - (time.top + time.bottom) / 2) < 12, timeInside: time.right <= innerWidth }; });
      assert.ok(target.width >= 160 && target.height >= 44 && target.sameRow && target.timeInside, `a touch-sized slider with the time beside it: ${JSON.stringify(target)}`);
      await seek(mobile, 60); assert.equal((await readFrame(mobile)).cycle, '2');
      if (capture) images.push({ name: `motion-preview-${viewport.width}`, bytes: await mobile.screenshot({ fullPage: true }) });
      await mobile.getByRole('button', { name: 'Back to layout', exact: true }).click();
      assert.equal(await mobile.getByRole('slider', { name: 'Movement preview time', exact: true }).count(), 0);
      await mobile.getByRole('button', { name: 'Preview movement', exact: true }).click(); assert.equal((await readFrame(mobile)).time, '0.000');
    }
    const reduced = await open('/editor', { width: 1280, height: 720 }, 'reduce');
    await seek(reduced, 15); assert.equal((await readFrame(reduced)).plane, 'translate(0px, 0px)');
    await seek(reduced, 31); assert.equal((await readFrame(reduced)).cycle, '1');
    assert.equal(await reduced.locator('.grid-ambient').getAttribute('data-float'), 'step');
    checks.push('320/390px mobile: a touch-sized slider with the time beside it, no page overflow, and return/reopen starts again at 0:00; reduced motion keeps stepped positions and dim swaps');
    assert.deepEqual(errors, []); await assertNoPersistedWrites();
    return { checks, images, crossings };
  } finally {
    await browser.close(); await new Promise(resolve => app.server.close(resolve)); await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runMotionPreviewQa(values); console.log(JSON.stringify({ checks: result.checks, crossings: result.crossings }, null, 2));
}
