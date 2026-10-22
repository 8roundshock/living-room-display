// #436 Keep the screen on, one display window and the editor's Screen and Motion controls, in headless Edge.
// Own loopback server on port 0, temporary synthetic data, a stubbed navigator.wakeLock where noted and a
// synthetic /api/windows/status; no installed app, no native host, nothing changes Windows, no screenshots.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { keepPagesLocal } from './lib/local-only.mjs';

/** A fake Screen Wake Lock API that records every request and release (installed before any page script). */
function stubWakeLock() {
  const record = window.__wakeLock = { requests: 0, releases: 0, sentinels: [], reject: false };
  const api = {
    request: async type => {
      record.requests++;
      if (record.reject) throw new DOMException('Synthetic denial', 'NotAllowedError');
      const sentinel = new EventTarget();
      Object.assign(sentinel, { type, released: false });
      sentinel.release = async () => { if (sentinel.released) return; sentinel.released = true; record.releases++; sentinel.dispatchEvent(new Event('release')); };
      record.sentinels.push(sentinel);
      return sentinel;
    },
  };
  Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => api });
  // Page visibility the test can change (a real headless page is always visible).
  window.__visibility = 'visible';
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => window.__visibility });
}
function removeWakeLock() { delete Navigator.prototype.wakeLock; }
/** Counts focus() calls on each document, so the editor's win.focus() on the display can be observed. */
function countFocus() {
  window.__focusCalls = 0;
  const focus = window.focus.bind(window);
  window.focus = () => { window.__focusCalls++; return focus(); };
}

export async function runScreenQa({ playwright, edge } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-screen-'));
  const now = Date.parse('2026-10-18T13:00:00Z');
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), now: () => now, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], errors = [], contexts = new Set(), outside = new Set(), info = [];
  const step = () => checks.length ? `after check ${checks.length}` : 'before the first check';
  function watch(page) {
    page.on('pageerror', error => errors.push(`${error.message} [${page.url()}; ${step()}]`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`${message.text()} [${page.url()}; ${step()}]`);
      if (message.type() === 'info') info.push(message.text());
    });
  }
  async function context({ viewport = { width: 1280, height: 720 }, init = [], route } = {}) {
    const created = await browser.newContext({ viewport, timezoneId: 'America/Toronto' }); contexts.add(created);
    const answered = await keepPagesLocal(created, base);
    for (const script of init) await created.addInitScript(script);
    if (route) await route(created);
    created.on('page', watch);
    return { context: created, async close() { for (const url of answered) outside.add(url); contexts.delete(created); await created.close(); } };
  }
  const settingsWith = edit => { const settings = defaultSettings(); edit?.(settings); return settings; };
  async function useSettings(edit) { await app.store.update(data => { data.settings = settingsWith(edit); data.reminders = []; }); }
  const wakeState = page => page.locator('.grid-ambient').getAttribute('data-wake-lock');
  const record = page => page.evaluate(() => ({ requests: window.__wakeLock.requests, releases: window.__wakeLock.releases, held: window.__wakeLock.sentinels.filter(sentinel => !sentinel.released).length }));
  async function display(path, options = {}) {
    const session = await context(options);
    const page = await session.context.newPage();
    if (options.clock !== false) await page.clock.install({ time: new Date(now) });
    await page.goto(base + path); await page.locator('.display-page').waitFor();
    return { ...session, page };
  }
  async function until(page, predicate, label, argument) {
    for (let attempt = 0; attempt < 150; attempt++) { if (await page.evaluate(predicate, argument)) return; await page.waitForTimeout(40); }
    throw new Error(`Timed out waiting for ${label}`);
  }

  try {
    await useSettings();
    // (1) Keep the screen on: only the native screensaver page or full screen, only while visible.
    {
      const native = await display('/display?native=1', { init: [stubWakeLock] });
      await until(native.page, () => document.querySelector('.grid-ambient')?.dataset.wakeLock === 'held', 'native wake lock');
      assert.deepEqual(await record(native.page), { requests: 1, releases: 0, held: 1 }, 'native=1 requests once');
      assert.equal(await native.page.title(), 'Still · Display', 'native title is exactly Still · Display (PR #51, #444)');
      // The browser releases the lock (for example the screen locks): the display asks again while still wanted.
      await native.page.evaluate(() => window.__wakeLock.sentinels[0].release());
      await until(native.page, () => window.__wakeLock.requests === 2, 're-request after release');
      assert.equal(await wakeState(native.page), 'held');
      // Hidden releases it; visible again requests it again.
      await native.page.evaluate(() => { window.__visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
      await until(native.page, () => document.querySelector('.grid-ambient').dataset.wakeLock === 'off', 'released while hidden');
      assert.equal((await record(native.page)).held, 0, 'nothing held while hidden');
      await native.page.evaluate(() => { window.__visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
      await until(native.page, () => window.__wakeLock.requests === 3 && document.querySelector('.grid-ambient').dataset.wakeLock === 'held', 're-request when visible');
      await native.close();

      const windowed = await display('/display', { init: [stubWakeLock] });
      await windowed.page.clock.runFor(65_000);
      assert.deepEqual(await record(windowed.page), { requests: 0, releases: 0, held: 0 }, 'a windowed display never asks: a stray tab must not block the Windows screensaver');
      assert.equal(await wakeState(windowed.page), 'off');
      // Full screen (F) asks; leaving full screen releases.
      await windowed.page.keyboard.press('f');
      await until(windowed.page, () => document.fullscreenElement !== null && document.querySelector('.grid-ambient').dataset.wakeLock === 'held', 'full screen wake lock');
      assert.equal((await record(windowed.page)).requests, 1);
      await windowed.page.keyboard.press('f');
      await until(windowed.page, () => document.fullscreenElement === null && document.querySelector('.grid-ambient').dataset.wakeLock === 'off', 'released after full screen');
      assert.deepEqual(await record(windowed.page), { requests: 1, releases: 1, held: 0 }, 'leaving full screen releases');
      await windowed.close();

      await useSettings(settings => { settings.screen.keepAwake = false; });
      const off = await display('/display?native=1', { init: [stubWakeLock] });
      await off.page.clock.runFor(30_000);
      assert.deepEqual(await record(off.page), { requests: 0, releases: 0, held: 0 }, 'Keep the screen on off never asks');
      assert.equal(await wakeState(off.page), 'off');
      await off.close();
      await useSettings();

      const unsupported = await display('/display?native=1', { init: [removeWakeLock] });
      await unsupported.page.clock.runFor(2_000);
      assert.equal(await wakeState(unsupported.page), 'unsupported', 'no API: unsupported, with no error');
      await unsupported.close();

      // A denial is reported once (console.info only, nothing on screen) and retried at most every 10 s.
      const denied = await display('/display?native=1', { init: [stubWakeLock, () => { window.__wakeLock.reject = true; }] });
      await until(denied.page, () => document.querySelector('.grid-ambient').dataset.wakeLock === 'denied', 'denied');
      await denied.page.clock.runFor(9_000);
      assert.equal((await record(denied.page)).requests, 1, 'no retry within 10 s');
      await denied.page.clock.runFor(1_500);
      await until(denied.page, () => window.__wakeLock.requests === 2, 'one retry after 10 s');
      assert.equal(await denied.page.locator('.display-page').evaluate(page => page.innerText.includes('wake')), false, 'nothing about it on the display');
      await denied.close();
      assert.equal(info.filter(text => /Keep the screen on/.test(text)).length, 1, 'the denial is logged once');

      // The real API in headless Edge on loopback: acquired.
      const real = await display('/display?native=1', { clock: false });
      await until(real.page, () => ['held', 'denied', 'unsupported'].includes(document.querySelector('.grid-ambient')?.dataset.wakeLock), 'a real wake lock answer');
      assert.equal(await wakeState(real.page), 'held', 'headless Edge grants a screen wake lock on loopback');
      await real.close();
    }
    checks.push('Keep the screen on: native=1 requests once when visible and again after a release or becoming visible; a windowed display never asks; full screen asks and leaving it releases; off never asks; no API reports unsupported; a denial logs once and retries after 10 s; the real API is held in headless Edge; native title Still · Display');

    // (2) One display window from the editor: reused, focused, closable; Esc closes it back to the editor.
    {
      const session = await context({ init: [countFocus] });
      const editor = await session.context.newPage();
      await editor.goto(base + '/editor'); await editor.locator('.studio').waitFor();
      const open = editor.locator('.open-display');
      assert.equal((await open.textContent()).trim(), 'Open display');
      assert.equal(await open.getAttribute('target'), 'still-display');
      assert.equal(await open.getAttribute('rel'), null, 'no rel: the display keeps window.opener');
      const popup = session.context.waitForEvent('page');
      await open.click();
      const shown = await popup;
      await shown.waitForURL(url => new URL(url).pathname === '/display'); await shown.locator('.display-page').waitFor();
      await open.click(); await open.click();
      await until(shown, () => window.__focusCalls >= 2, 'the editor focuses the display window');
      const displays = session.context.pages().filter(page => new URL(page.url()).pathname === '/display');
      assert.equal(displays.length, 1, 'three clicks leave exactly one display page');
      assert.equal(await shown.evaluate(() => document.hasFocus()), true, 'the display has focus');
      await until(editor, () => document.querySelector('.open-display')?.textContent.trim() === 'Show display', 'Show display');
      assert.equal(await editor.locator('.close-display').count(), 1, 'Close display is offered while it is open');
      // The display offers Close display too (pointer controls), because the editor opened it.
      await shown.mouse.move(300, 300);
      assert.equal(await shown.getByRole('navigation', { name: 'Display controls' }).getByRole('button', { name: 'Close display' }).count(), 1);
      // Close display closes it.
      const closed = shown.waitForEvent('close');
      await editor.locator('.close-display').click();
      await closed;
      await until(editor, () => document.querySelector('.open-display')?.textContent.trim() === 'Open display' && !document.querySelector('.close-display'), 'Open display again');
      // Esc on an editor-opened display returns to the editor and closes the display.
      const again = session.context.waitForEvent('page');
      await open.click();
      const second = await again;
      await second.waitForURL(url => new URL(url).pathname === '/display'); await second.locator('.display-page').waitFor();
      const gone = second.waitForEvent('close');
      // The display closes on keydown, so the key's release has no page left to reach.
      await second.keyboard.press('Escape').catch(error => { if (!second.isClosed()) throw error; });
      await gone;
      const left = session.context.pages().map(page => new URL(page.url()).pathname);
      assert.deepEqual(left, ['/editor'], `Esc leaves one editor: ${left}`);
      await until(editor, () => window.__focusCalls >= 1, 'Esc focuses the editor');
      await session.close();
    }
    checks.push('one display window: three clicks on Open display leave one /display page with focus; the button reads Show display with Close display beside it (and on the display); Close display closes it; Esc on an editor-opened display closes it and leaves one editor');

    // #480 The remembered script-opened state survives the editor closing first.
    for (const control of ['Close display', 'Escape', 'e']) {
      const session = await context();
      const editor = await session.context.newPage();
      await editor.goto(base + '/editor'); await editor.locator('.studio').waitFor();
      const popup = session.context.waitForEvent('page');
      await editor.locator('.open-display').click();
      const shown = await popup;
      await shown.locator('.display-close').waitFor({ state: 'attached' });
      await editor.close();
      assert.equal(await shown.evaluate(() => !window.opener || window.opener.closed), true, 'the opening editor is gone');
      if (control === 'Close display') await shown.mouse.move(300, 300);
      const closed = shown.waitForEvent('close');
      const action = control === 'Close display'
        ? shown.locator('.display-close').click()
        : shown.keyboard.press(control);
      await action.catch(error => { if (!shown.isClosed()) throw error; });
      await closed;
      assert.equal(session.context.pages().length, 0, `${control} closes the display without opening another editor`);
      await session.close();
    }
    checks.push('#480 Close display, Escape and E still close an editor-opened display after its editor has closed');

    // (3) A display opened directly retires the older one: it closes (editor-opened) or shows the card and stops polling.
    {
      const session = await context();
      const older = await session.context.newPage();
      await older.clock.install({ time: new Date(now) });
      await older.goto(base + '/display'); await older.locator('.display-page').waitFor();
      let polls = 0;
      older.on('request', request => { if (new URL(request.url()).pathname === '/api/state') polls++; });
      const newer = await session.context.newPage();
      await newer.goto(base + '/display'); await newer.locator('.display-page').waitFor();
      await older.clock.runFor(300);
      await until(older, () => document.querySelector('.display-retired') !== null, 'the retired card');
      assert.deepEqual(await older.locator('.display-retired-card p').allInnerTexts(), ['The display is open in another window.', 'Close this tab (Ctrl+W).']);
      assert.equal(await older.locator('.grid-ambient').count(), 0, 'nothing floats behind the card');
      const before = polls;
      await older.clock.runFor(95_000);
      await older.waitForTimeout(300);
      assert.equal(polls - before, 0, 'a retired display makes no /api/state polls');
      assert.equal(await newer.locator('.grid-ambient').count(), 1, 'the newer display keeps running');
      assert.equal(await newer.locator('.display-retired').count(), 0);
      await session.close();

      // An editor-opened display (script-closable) closes itself when a newer display opens.
      const both = await context();
      const editor = await both.context.newPage();
      await editor.goto(base + '/editor'); await editor.locator('.studio').waitFor();
      const popup = both.context.waitForEvent('page');
      await editor.locator('.open-display').click();
      const opened = await popup;
      await opened.waitForURL(url => new URL(url).pathname === '/display'); await opened.locator('.display-page').waitFor();
      const closes = opened.waitForEvent('close');
      const typed = await both.context.newPage();
      await typed.goto(base + '/display'); await typed.locator('.display-page').waitFor();
      await closes;
      assert.equal(both.context.pages().filter(page => new URL(page.url()).pathname === '/display').length, 1, 'one display left');
      await both.close();
    }
    checks.push('a display opened by URL retires the older one: an editor-opened display closes itself, a typed one shows "The display is open in another window. Close this tab (Ctrl+W)." and makes no /api/state polls afterwards');

    // (4) Editor: Style › Screen and the #436 Motion wording.
    {
      const statuses = {
        warn: { available: true, selectedScreenSaver: 'C:\\Synthetic\\LivingRoomDisplay.scr', active: true, timeoutSeconds: 1200, secure: false, isLivingRoomDisplay: true, power: { available: true, scheme: 'Balanced', displayOffSeconds: { ac: 600, dc: 300 }, sleepSeconds: { ac: 0, dc: 900 } } },
        never: { available: true, selectedScreenSaver: 'C:\\Synthetic\\LivingRoomDisplay.scr', active: true, timeoutSeconds: 1200, secure: false, isLivingRoomDisplay: true, power: { available: true, scheme: 'High performance', displayOffSeconds: { ac: 0, dc: 600 }, sleepSeconds: { ac: 0, dc: 0 } } },
        sleep: { available: true, selectedScreenSaver: 'C:\\Synthetic\\LivingRoomDisplay.scr', active: true, timeoutSeconds: 1200, secure: false, isLivingRoomDisplay: true, power: { available: true, scheme: 'Balanced', displayOffSeconds: { ac: 3600, dc: 600 }, sleepSeconds: { ac: 900, dc: 900 } } },
        other: { available: false, selectedScreenSaver: null, active: null, timeoutSeconds: null, secure: null, isLivingRoomDisplay: false, power: { available: false, scheme: null, displayOffSeconds: null, sleepSeconds: null } },
      };
      const results = {};
      for (const [name, status] of Object.entries(statuses)) {
        const session = await context({ route: created => created.route('**/api/windows/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(status) })) });
        const page = await session.context.newPage();
        await page.goto(base + '/editor'); await page.getByRole('tab', { name: 'Style', exact: true }).click();
        // Keep the screen on is the Screen part of Style › Motion, so the Style tab still fits 1280 × 720.
        await page.locator('summary', { hasText: 'Motion' }).click();
        const body = page.getByRole('group', { name: 'Screen', exact: true });
        await body.getByRole('checkbox', { name: 'Keep the screen on while the display shows', exact: true }).waitFor();
        assert.match(await body.locator('.keep-awake-hint').innerText(), /^When the display is full screen or running as your screensaver, Windows won't turn the screen off\. Windows' own power settings apply the rest of the time\.$/);
        if (name !== 'other') await body.locator('.power-status').waitFor();
        await page.waitForTimeout(200);
        results[name] = { line: await body.locator('.power-status').count() ? await body.locator('.power-status').innerText() : null, warning: await body.locator('.power-warning').count() ? await body.locator('.power-warning').innerText() : null };
        await session.close();
      }
      assert.deepEqual(results.warn, { line: 'Windows turns the screen off after 10 min · Sleeps after Never', warning: "Windows turns the screen off after 10 min, before your screensaver starts at 20 min, so the display won't appear. Change it in Settings › System › Power & sleep, or choose a shorter wait." });
      assert.deepEqual(results.never, { line: 'Windows turns the screen off after Never · Sleeps after Never', warning: null });
      assert.deepEqual(results.sleep, { line: 'Windows turns the screen off after 1 hour · Sleeps after 15 min', warning: "Windows sleeps after 15 min, before your screensaver starts at 20 min, so the display won't appear. Change it in Settings › System › Power & sleep, or choose a shorter wait." });
      assert.deepEqual(results.other, { line: null, warning: null }, 'off Windows: no power line');
      checks.push(`Style › Motion › Screen: the toggle and its hint; Windows power line and the early display-off / sleep warning from synthetic statuses: ${JSON.stringify(results)}`);

      // Saving Keep the screen on, and the unsupported-browser note.
      await useSettings();
      const session = await context();
      const page = await session.context.newPage();
      await page.goto(base + '/editor'); await page.getByRole('tab', { name: 'Style', exact: true }).click();
      await page.locator('summary', { hasText: 'Motion' }).click();
      const toggle = page.getByRole('checkbox', { name: 'Keep the screen on while the display shows', exact: true });
      assert.equal(await toggle.isChecked(), true, 'on by default');
      assert.equal(await page.locator('.keep-awake-unsupported').count(), 0, 'Edge supports it');
      await toggle.uncheck();
      await page.locator('.studio-savebar').waitFor();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await page.locator('.studio-savebar').waitFor({ state: 'detached' });
      assert.equal(app.store.snapshot().settings.screen.keepAwake, false);
      assert.deepEqual(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).settings.screen, { keepAwake: false });
      await toggle.check(); await page.locator('.studio-savebar').waitFor();
      await toggle.uncheck(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
      await toggle.check();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await page.locator('.studio-savebar').waitFor({ state: 'detached' });
      assert.equal('screen' in JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).settings, false, 'back on: omitted at rest');
      await session.close();
      const old = await context({ init: [removeWakeLock] });
      const oldPage = await old.context.newPage();
      await oldPage.goto(base + '/editor'); await oldPage.getByRole('tab', { name: 'Style', exact: true }).click();
      await oldPage.locator('summary', { hasText: 'Motion' }).click();
      await oldPage.locator('.keep-awake-unsupported').waitFor();
      assert.equal(await oldPage.locator('.keep-awake-unsupported').innerText(), "This browser can't keep the screen on. The screensaver display uses Microsoft Edge, which can.");
      await old.close();
    }
    checks.push('Keep the screen on saves (state.json carries keepAwake false; back on, the section is omitted), Save shows only for an effective change, and a browser without the API says so');

    {
      await useSettings(settings => { settings.appearance.motionIntervalSeconds = 30; });
      const session = await context();
      const page = await session.context.newPage();
      await page.goto(base + '/editor'); await page.getByRole('tab', { name: 'Style', exact: true }).click();
      await page.locator('summary', { hasText: 'Motion' }).click();
      const body = page.locator('.motion-disclosure .disclosure-body');
      await body.getByRole('checkbox', { name: 'Float gently', exact: true }).waitFor();
      await body.getByRole('slider', { name: 'Move every', exact: true }).waitFor();
      const sentence = () => body.locator('.motion-sentence').innerText();
      assert.equal(await sentence(), 'Your widgets stay where you put them and float slowly, reaching a new spot every 30 s, to protect your TV. The screen never goes dark to move.');
      assert.equal(await body.getByText('Off keeps the content of widgets still; movement is set below.', { exact: false }).count(), 1);
      const swap = body.getByRole('checkbox', { name: 'Swap places', exact: true });
      assert.equal(await swap.isChecked(), false, 'Swap places is off by default');
      assert.equal(await body.locator('.swap-hint').innerText(), 'Widgets sometimes trade places. Your arrangement stays saved.');
      assert.equal(await body.getByRole('slider', { name: 'Swap glide', exact: true }).count(), 0, 'Swap glide only with Swap places on');
      // #515: one timeline inspects float and optional swaps without changing the saved arrangement.
      await page.locator('.movement-preview').click();
      assert.equal(await page.locator('.motion-preview-controls').getAttribute('data-swaps'), 'false');
      assert.equal(await page.locator('.preview-surface .grid-ambient').getAttribute('data-float'), 'float', 'Preview movement shows the draft float');
      await swap.check();
      assert.equal(await sentence(), 'Your widgets float slowly and swap places every 30 s, gliding without going dark.');
      await body.getByRole('slider', { name: 'Swap glide', exact: true }).waitFor();
      assert.equal(await page.locator('.motion-preview-controls').getAttribute('data-swaps'), 'true');
      await body.getByRole('checkbox', { name: 'Float gently', exact: true }).uncheck();
      assert.equal(await sentence(), 'Your widgets swap places every 30 s without animation, dimming briefly instead of going dark.');
      await swap.uncheck();
      assert.equal(await sentence(), 'Your widgets stay where you put them and shift a little every 30 s, without animation, to protect your TV. The screen never goes dark to move.');
      assert.equal(await page.getByText(/Drift and fade|through black|Fade duration|Move widgets every/).count(), 0, 'the old wording is gone');
      // Swap places is saved and keeps the style preset (a motion choice, not a look).
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.locator('.studio-savebar').waitFor({ state: 'detached' });
      await swap.check();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await page.locator('.studio-savebar').waitFor({ state: 'detached' });
      assert.equal(app.store.snapshot().settings.appearance.rearrange, true);
      assert.equal(app.store.snapshot().settings.appearance.preset, 'room', 'the style preset stays');
      await session.close();
    }
    checks.push('Motion: Float gently, Move every with the live sentence for float, steps and swaps, Swap places (off) with its hint, Swap glide only while swapping, arrangement buttons only while swapping, the old black-move wording gone; Swap places saves without marking the style Custom');

    // (5) Small screens: shared Home/editor actions retain 44 px targets, including Close display.
    for (const width of [390, 320]) {
      const session = await context({ viewport: { width, height: 844 } });
      const editor = await session.context.newPage();
      await editor.goto(base + '/editor'); await editor.locator('.studio').waitFor();
      const popup = session.context.waitForEvent('page');
      await editor.locator('.open-display').click();
      const shown = await popup; await shown.locator('.display-page').waitFor();
      await until(editor, () => document.querySelector('.close-display') !== null, `Close display at ${width} px`);
      const fits = await editor.evaluate(() => [...document.querySelectorAll('.studio-header .open-display, .studio-header .close-display, .studio-header .brand')].map(element => { const box = element.getBoundingClientRect(); return { name: element.className, left: box.left, right: box.right, width: box.width, height: box.height }; }));
      for (const item of fits) {
        assert.ok(item.left >= 0 && item.right <= width, `${item.name} fits at ${width} px: ${JSON.stringify(item)}`);
        assert.ok(item.width >= 44 && item.height >= 44, `${item.name} keeps a 44 px target: ${JSON.stringify(item)}`);
      }
      assert.equal(await editor.evaluate(width => document.documentElement.scrollWidth <= width, width), true, 'no horizontal scroll');
      await session.close();
    }
    checks.push('390 and 320 px editor: brand, Show display and Close display retain 44 px targets without horizontal scrolling');

    assert.deepEqual(errors, [], 'page or console errors');
    return { checks, outside: [...outside], images: 'none written; all state stays in RAM' };
  } finally {
    for (const created of contexts) await created.close().catch(() => undefined);
    await browser.close(); await new Promise(done => app.server.close(done)); await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runScreenQa({ playwright: values.playwright, edge: values.edge });
  console.log(JSON.stringify(result, null, 2));
}
