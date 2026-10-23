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
import { floatPath, FLOAT_TRAVEL } from '../../src/shared/float.ts';
import { keepPagesLocal } from './lib/local-only.mjs';

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
  const readFrame = page => page.locator('.grid-ambient').evaluate(ambient => ({
    time: ambient.getAttribute('data-preview-seconds'), cycle: ambient.getAttribute('data-composition'),
    plane: ambient.querySelector('.widget-grid-plane').style.transform,
    widgets: [...ambient.querySelectorAll('.ambient-widget')].map(el => ({ id: el.dataset.widgetId, left: el.style.left, top: el.style.top, floatX: el.style.getPropertyValue('--float-x'), floatY: el.style.getPropertyValue('--float-y'), transform: getComputedStyle(el).transform, opacity: getComputedStyle(el).opacity })),
  }));
  async function open(path = '/editor', viewport = { width: 1280, height: 720 }, reducedMotion = 'no-preference', preview = path === '/editor') {
    const context = await browser.newContext({ viewport, reducedMotion, timezoneId: 'America/Toronto' }); contexts.push(context);
    await keepPagesLocal(context, base);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).origin === base && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
    await page.clock.install({ time: new Date(now) }); await page.clock.pauseAt(new Date(now));
    await page.goto(base + path); await page.locator('.grid-ambient').waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (preview) await page.getByRole('button', { name: 'Preview movement', exact: true }).click();
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
    await lifecycle.getByRole('button', { name: 'Preview movement', exact: true }).click(); await seek(lifecycle, 31.5);
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
    await seek(lifecycle, 31.5);
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
    assert.equal(await page.getByRole('button', { name: 'Play movement preview' }).count(), 1, 'preview starts paused');
    const frames = new Map();
    for (const time of [0, 15, 29.95, 30, 31.5, 33, 60, 61.5, 123]) {
      await seek(page, time); frames.set(time, await readFrame(page));
      const expected = floatPath(time, 30);
      const actual = await page.locator('.grid-ambient').evaluate((el, args) => {
        const dpr = devicePixelRatio || 1, snap = v => Math.round(v * dpr) / dpr;
        return { actual: el.querySelector('.widget-grid-plane').style.transform, expected: `translate(${snap(args.x * args.travel * el.clientWidth)}px, ${snap(args.y * args.travel * el.clientHeight)}px)` };
      }, { ...expected, travel: FLOAT_TRAVEL });
      assert.equal(actual.actual, actual.expected, `time ${time} uses runtime floatPath`);
      const ink = await inkGeometry(page);
      assert.ok(ink.every(item => item.withinSlot && item.withinScreen), `time ${time}: measured content remains in its moving slot and screen ${JSON.stringify(ink)}`);
      const overlaps = [];
      for (let a = 0; a < ink.length; a++) for (let b = a + 1; b < ink.length; b++) {
        const one = ink[a].ink, two = ink[b].ink;
        if (Math.min(one.right, two.right) - Math.max(one.left, two.left) > 1 && Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top) > 1) overlaps.push([ink[a].id, ink[b].id]);
      }
      if ([0, 15, 29.95, 33, 123].includes(time)) assert.deepEqual(overlaps, [], `settled frame ${time} has no content overlap`);
      else if (overlaps.length) crossings.push({ time, pairs: overlaps });
    }
    assert.equal(frames.get(29.95).cycle, '0'); assert.equal(frames.get(30).cycle, '1'); assert.equal(frames.get(60).cycle, '2'); assert.equal(frames.get(123).cycle, '4');
    assert.notDeepEqual(frames.get(30).widgets.map(w => w.transform), frames.get(31.5).widgets.map(w => w.transform), 'complete swap progression is seekable');
    for (const time of [31.5, 15, 123, 30, 61.5, 0]) { await seek(page, time); assert.deepEqual(await readFrame(page), frames.get(time), `backward seek ${time} is deterministic`); }
    checks.push('0%, intermediate, transition boundaries and 100% sample shared float paths; backward and repeated seeks replay identical composition history and glide frames');

    await seek(page, 31.5); const paused = await readFrame(page); await page.clock.runFor(2500);
    assert.deepEqual(await readFrame(page), paused, 'paused movement stays stable while live information ticks');
    const animations = await page.locator('.grid-ambient').evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.id === 'lrd-preview').map(a => ({ time: a.currentTime, state: a.playState })));
    assert.ok(animations.length > 0); assert.ok(animations.every(a => a.time === 1500 && a.state === 'paused'));
    await page.getByRole('button', { name: 'Play movement preview' }).click(); await page.clock.runFor(1200);
    await page.getByRole('button', { name: 'Pause movement preview' }).click();
    assert.ok(Number(await page.locator('.grid-ambient').getAttribute('data-preview-seconds')) > 32.5, 'resume advances from sought position');
    await page.getByRole('button', { name: 'Back one second' }).click();
    const afterBack = Number(await page.locator('.grid-ambient').getAttribute('data-preview-seconds'));
    await page.getByRole('button', { name: 'Forward one second' }).click();
    assert.ok(Math.abs(Number(await page.locator('.grid-ambient').getAttribute('data-preview-seconds')) - afterBack - 1) < .01);
    const slider = page.getByRole('slider', { name: 'Movement preview time', exact: true });
    await slider.focus(); await page.keyboard.press('Home'); assert.equal(await slider.inputValue(), '0');
    await page.keyboard.press('ArrowRight'); assert.equal(await slider.inputValue(), '0.05');
    await page.keyboard.press('End'); assert.equal(await slider.inputValue(), '123');
    await page.getByRole('button', { name: 'Play movement preview' }).click(); await page.clock.runFor(300);
    assert.ok(Number(await slider.inputValue()) < 1, 'Play at the end restarts');
    await page.getByRole('button', { name: 'Pause movement preview' }).click();
    await page.getByRole('combobox', { name: 'Movement preview window' }).selectOption('24'); assert.equal(await slider.getAttribute('max'), '723');
    await page.getByRole('button', { name: 'Jump to interval 24', exact: true }).click(); assert.equal(await slider.inputValue(), '720');
    await page.getByRole('combobox', { name: 'Movement preview window' }).selectOption('4'); assert.equal(await slider.inputValue(), '123');
    checks.push('Paused stability, resume, one-second nudges, range keyboard Home/End/arrows, restart at end, 4/12/24 interval windows and boundary jumps');

    await page.getByRole('tab', { name: 'Style', exact: true }).click(); await page.locator('summary', { hasText: 'Motion' }).click();
    await page.getByRole('checkbox', { name: 'Float gently', exact: true }).uncheck();
    assert.equal(await slider.inputValue(), '0', 'mode change resets local preview'); assert.equal(await slider.getAttribute('max'), '121.2');
    await seek(page, 30.3); assert.equal((await readFrame(page)).cycle, '0');
    await seek(page, 30.6); assert.equal((await readFrame(page)).cycle, '1');
    assert.ok((await readFrame(page)).widgets.some(w => Number(w.opacity) <= .401), 'dim midpoint is inspectable');
    await page.getByRole('checkbox', { name: 'Swap places', exact: true }).uncheck(); await seek(page, 120);
    assert.equal((await readFrame(page)).cycle, '0');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(JSON.stringify(app.store.snapshot().settings), saved); assert.deepEqual(writes, []);
    assert.deepEqual(await readFrame(live), liveBefore, 'editor clock cannot mutate an already-open display');
    checks.push('Mode changes reset only the local clock; dim midpoint and swaps-off behavior are correct, draft Cancel restores settings, and no API writes or live-display changes occur');

    await seek(page, 31.5);
    if (capture) images.push({ name: 'motion-preview-desktop', bytes: await page.screenshot() });
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }]) {
      const mobile = await open('/editor', viewport); const controls = mobile.getByRole('region', { name: 'Movement preview' });
      await controls.scrollIntoViewIfNeeded();
      assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page overflow');
      const targets = await controls.locator('button, select').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; }));
      assert.ok(targets.every(r => r.width >= 40 && r.height >= 44), JSON.stringify(targets));
      await mobile.getByRole('button', { name: 'Jump to interval 2', exact: true }).click(); assert.equal((await readFrame(mobile)).cycle, '2');
      if (capture) images.push({ name: `motion-preview-${viewport.width}`, bytes: await mobile.screenshot({ fullPage: true }) });
      await mobile.getByRole('button', { name: 'Back to layout', exact: true }).click();
      assert.equal(await mobile.getByRole('slider', { name: 'Movement preview time', exact: true }).count(), 0);
      await mobile.getByRole('button', { name: 'Preview movement', exact: true }).click(); assert.equal((await readFrame(mobile)).time, '0.000');
    }
    const reduced = await open('/editor', { width: 1280, height: 720 }, 'reduce');
    await seek(reduced, 15); assert.equal((await readFrame(reduced)).plane, 'translate(0px, 0px)');
    await seek(reduced, 30.6); assert.equal((await readFrame(reduced)).cycle, '1');
    assert.equal(await reduced.locator('.grid-ambient').getAttribute('data-float'), 'step');
    checks.push('320/390px mobile controls fit with touch targets and preserve return/reopen behavior; reduced motion keeps stepped positions and dim swaps');
    assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.equal(JSON.stringify(app.store.snapshot().settings), saved);
    return { checks, images, crossings };
  } finally {
    await browser.close(); await new Promise(resolve => app.server.close(resolve)); await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runMotionPreviewQa(values); console.log(JSON.stringify({ checks: result.checks, crossings: result.crossings }, null, 2));
}
