import { mockWindowsStatus } from './lib/windows-fixture.mjs';
// Synthetic manual-display controls only; no desktop, installed app or native host.
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
import { NATIVE_READY_TITLE, NATIVE_STARTING_TITLE } from '../../src/client/nativeReadiness.ts';

export async function runDisplayControlsQa({ playwright, edge, capture = false, clientDirectory } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-display-controls-'));
  const app = await createApplication({ dataDirectory: directory, clientDirectory: clientDirectory ?? fileURLToPath(new URL('../../dist/client', import.meta.url)), fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' }); await mockWindowsStatus(context);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-10-18T13:00:00Z') });
    // #209: a capture listener counts handled pointer moves, so the fake clock never advances past a move
    // the page has not dispatched yet (a coalesced or late pointermove once hid the controls early).
    const open = async (path = '/display') => {
      await page.goto(base + path); await page.locator(path === '/editor' ? '.preview-surface' : '.display-page').waitFor();
      await page.evaluate(() => { window.__lrdPointerMoves = 0; document.addEventListener('pointermove', () => { window.__lrdPointerMoves++; }, true); });
    };
    const moves = () => page.evaluate(() => window.__lrdPointerMoves);
    const move = async (x, y) => {
      const before = await moves(); await page.mouse.move(x, y);
      for (let attempt = 0; (await moves()) <= before; attempt++) { assert.ok(attempt < 300, 'the page handles the pointer move'); await page.waitForTimeout(10); }
    };
    const interacting = () => page.locator('.display-page').evaluate(el => el.classList.contains('interacting'));
    const controls = page.getByRole('navigation', { name: 'Display controls' });
    const opacity = () => controls.evaluate(el => Number(getComputedStyle(el).opacity));

    await open(); assert.equal(await opacity(), 0);
    // #262: the button and the link share one inline-flex layout: icon and label 8px apart, centred.
    const layout = await controls.evaluate(nav => [...nav.querySelectorAll('.display-control')].map(control => {
      const icon = control.querySelector('svg').getBoundingClientRect(), label = [...control.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const range = document.createRange(); range.selectNodeContents(label); const text = range.getBoundingClientRect();
      return { label: label.textContent.trim(), tag: control.tagName, display: getComputedStyle(control).display, align: getComputedStyle(control).alignItems, columnGap: getComputedStyle(control).columnGap, gap: Number((text.left - icon.right).toFixed(2)), offset: Math.abs((icon.top + icon.bottom) / 2 - (text.top + text.bottom) / 2) };
    }));
    // #438: Home · Esc goes to Home and Edit display · E to Edit display.
    assert.deepEqual(layout.map(item => [item.tag, item.label]), [['BUTTON', 'Fullscreen · F'], ['A', 'Home · Esc'], ['A', 'Edit display · E']]);
    assert.deepEqual(await controls.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href'))), ['/', '/editor']);
    for (const item of layout) {
      // inline-flex, blockified to flex inside the flex row of controls.
      assert.deepEqual([item.display, item.align, item.columnGap], ['flex', 'center', '8px'], `${item.label} uses the shared layout`);
      assert.ok(Math.abs(item.gap - 8) <= 0.5, `${item.label}: 8px between icon and label, got ${item.gap}`);
      assert.ok(item.offset <= 2, `${item.label}: icon and label share a centre line (${item.offset}px)`);
    }
    checks.push(`The three display controls (Fullscreen · F, Home · Esc to /, Edit display · E to /editor) share one inline-flex layout with an 8px icon gap: ${JSON.stringify(layout.map(item => [item.label, item.gap]))}`);
    await move(200, 200); await page.clock.runFor(2500);
    await move(250, 220); await page.clock.runFor(2500);
    assert.equal(await interacting(), true, 'Pointer activity restarts the idle deadline instead of hiding after the first movement');
    assert.equal(await opacity(), 1);
    if (capture) images.push({ name: 'ongoing-pointer-controls', bytes: await page.screenshot() });
    await page.clock.runFor(800); assert.equal(await opacity(), 1);
    await page.clock.runFor(300); assert.equal(await interacting(), false); assert.equal(await opacity(), 0);
    checks.push('Pointer controls remain visible for the full interval after the latest activity and hide after inactivity');

    const tabSignal = () => page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    await tabSignal(); await page.clock.runFor(2500); await tabSignal(); await page.clock.runFor(2500);
    assert.equal(await interacting(), true, 'Repeated keyboard activity refreshes the same deadline');
    await controls.getByRole('button', { name: 'Fullscreen' }).focus(); await page.clock.runFor(4000);
    assert.equal(await interacting(), false); assert.equal(await opacity(), 1, 'Focused controls stay visible after idle timeout');
    if (capture) images.push({ name: 'focused-controls-after-idle', bytes: await page.screenshot() });
    await page.locator('body').evaluate(el => { el.tabIndex = -1; el.focus(); }); assert.equal(await opacity(), 0);
    checks.push('Keyboard activity refreshes the deadline; focus remains visible without moving focus on timeout');

    // #438: unmodified Esc goes to Home and E to Edit display; typing in a field or with a modifier does neither.
    await open(); await page.keyboard.press('Escape'); await page.waitForURL(`${base}/`); await page.locator('.home-page').waitFor();
    await open(); await page.keyboard.press('e'); await page.waitForURL(`${base}/editor`); await page.locator('.preview-surface').waitFor();
    await open(); await page.keyboard.press('Control+e'); await page.keyboard.press('Shift+Escape'); await page.clock.runFor(200);
    assert.equal(new URL(page.url()).pathname, '/display', 'modified keys do not navigate');
    checks.push('Esc goes to Home (/) and E to Edit display (/editor); Ctrl+E and Shift+Esc stay on the display');
    await move(300, 250); await open('/editor'); await page.clock.runFor(4000);
    assert.equal(await page.locator('.display-help').count(), 0);
    await open('/display?native=1'); assert.equal(await controls.count(), 0);
    await move(350, 280); await tabSignal(); await page.clock.runFor(4000);
    assert.equal(await controls.count(), 0); assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).cursor), 'none');
    checks.push('Editor/navigation and explicit native presentation retain their existing control exclusions; no native helper or fullscreen launch');

    // #334: every display start (each native activation, every reload) is true black before React mounts. With the
    // app's script held, /display?native=1 (the screensaver's page) paints only black at 1280×720 and 4K, with a
    // black computed document background and theme colour; the editor keeps its navy page once mounted.
    const premount = [];
    for (const viewport of [{ width: 1280, height: 720 }, { width: 3840, height: 2160 }]) {
      const held = await browser.newContext({ viewport }); await mockWindowsStatus(held);
      try {
        let release; const gate = new Promise(resolve => { release = resolve; });
        await held.route(/\/assets\/[^/?]+\.js(\?.*)?$/, async route => { await gate; await route.continue(); });
        const heldPage = await held.newPage(); heldPage.on('pageerror', error => errors.push(error.message));
        await heldPage.goto(base + '/display?native=1', { waitUntil: 'commit' });
        await heldPage.waitForFunction(() => document.readyState !== 'loading' && [...document.styleSheets].some(sheet => sheet.href?.includes('/assets/')));
        const document_ = await heldPage.evaluate(() => ({ mounted: document.getElementById('root')?.childElementCount ?? -1, background: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, theme: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') }));
        assert.deepEqual(document_, { mounted: 0, background: 'rgb(0, 0, 0)', body: 'rgba(0, 0, 0, 0)', theme: '#000000' }, `${viewport.width}: before mount the document is black`);
        // The capture stays in RAM; a blank page decodes it.
        const shot = await heldPage.screenshot();
        const decoder = await held.newPage();
        const pixels = await decoder.evaluate(async encoded => {
          const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
          const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          const data = context.getImageData(0, 0, image.width, image.height).data; let max = 0, lit = 0;
          for (let index = 0; index < data.length; index += 4) { const value = Math.max(data[index], data[index + 1], data[index + 2]); if (value) { lit++; max = Math.max(max, value); } }
          return { width: image.width, height: image.height, lit, max };
        }, shot.toString('base64'));
        await decoder.close();
        assert.deepEqual([pixels.width, pixels.height, pixels.lit], [viewport.width, viewport.height, 0], `${viewport.width}: every pre-mount pixel is black ${JSON.stringify(pixels)}`);
        premount.push(`${viewport.width}×${viewport.height}: ${pixels.width * pixels.height} black pixels`);
        release(); await heldPage.locator('.display-page').waitFor();
        assert.equal(await heldPage.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(0, 0, 0)', 'the mounted display stays black');
      } finally { await held.close(); }
    }
    await open('/editor');
    assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(9, 11, 18)', 'the mounted editor keeps its navy page');
    checks.push(`#334 /display?native=1 with the app script held: ${premount.join('; ')}, document background and theme colour black; the mounted editor keeps rgb(9, 11, 18)`);

    // #539: hold actual state delivery. A route/title is never a painted-board certificate.
    const startup = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' }); await mockWindowsStatus(startup);
    let releaseState; const stateGate = new Promise(resolve => { releaseState = resolve; });
    await startup.route('**/api/state', async route => { await stateGate; await route.continue(); });
    try {
      const starting = await startup.newPage(); starting.on('pageerror', error => errors.push(error.message));
      await starting.goto(base + '/display?native=1', { waitUntil: 'domcontentloaded' });
      await starting.locator('.display-fallback').waitFor();
      assert.equal(await starting.title(), NATIVE_STARTING_TITLE, 'pending state cannot advertise the content-ready marker');
      assert.equal(await starting.locator('.fallback-content').evaluate(element => getComputedStyle(element).visibility), 'hidden', 'native loading content remains covered');
      assert.equal(await starting.locator('html').evaluate(element => element.dataset.nativeReady), undefined);
      releaseState();
      await starting.waitForFunction(title => document.title === title, NATIVE_READY_TITLE);
      const first = await starting.locator('.display-page').evaluate(element => ({
        board: element.querySelector('.grid-ambient') !== null,
        widgets: element.querySelectorAll('.ambient-widget').length,
        background: getComputedStyle(element).backgroundColor,
        opacity: getComputedStyle(element).opacity,
        ready: document.documentElement.dataset.nativeReady,
        controls: element.querySelector('.display-help') !== null,
      }));
      assert.ok(first.board && first.widgets > 0, 'content-ready title follows the actual default board');
      assert.deepEqual([first.background, first.opacity, first.ready, first.controls], ['rgb(0, 0, 0)', '1', 'true', false]);
      if (capture) images.push({ name: 'native-content-ready-board', bytes: await starting.screenshot() });
      // A normal state poll must never replay the entrance or clear the ready marker.
      await starting.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal(await starting.title(), NATIVE_READY_TITLE);
      checks.push('#539: held state keeps native fallback black/hidden and title unready; committed default board publishes readiness after paint opportunities, with no native controls');
    } finally { releaseState(); await startup.close(); }
    assert.deepEqual(errors, []);
    return { checks, images };
  } finally { await browser.close(); await new Promise(resolve => app.server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runDisplayControlsQa(values); console.log(JSON.stringify({ checks: result.checks }, null, 2));
}
