import { mockWindowsStatus } from './lib/windows-fixture.mjs';
// Home (#438): day-to-day use beside the display. An isolated loopback server with temporary synthetic
// data and a fake clock that the server follows; screenshots stay in RAM. Build first.
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
import { keepPagesLocal } from './lib/local-only.mjs';
import { checkHomeNoteSync } from './lib/home-note-sync.mjs';
import { checkHomeDisplayCard } from './lib/home-display-card.mjs';

/** 6:42 PM on Tuesday, October 20, 2026 in Toronto. */
const NOW = Date.parse('2026-10-20T22:42:00.000Z');
const EDGE_VIEWPORTS = [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 568 }];
const NETWORK = "Can't reach the display server on this computer. Your changes are kept — try again.";
/** An owner-like full board without World clocks: every one of the 96 Balanced cells is used. */
const FULL_WITHOUT_WORLD_CLOCKS = {
  clock: { column: 0, row: 0, size: 'large' }, weather: { column: 8, row: 0, size: 'large' }, forecast: { column: 0, row: 6, size: 'large' },
  reminders: { column: 0, row: 4, size: 'medium' }, calendar: { column: 4, row: 4, size: 'medium' }, countdown: { column: 8, row: 4, size: 'small' },
  note: { column: 10, row: 4, size: 'small' }, sunMoon: { column: 8, row: 6, size: 'small' }, airQuality: { column: 10, row: 6, size: 'small' },
};

/** Counts every way a page could make a sound or ask to notify (an init script). */
function instrumentSilence() {
  const counts = window.__lrdSound = { play: 0, audioContexts: 0, notifications: 0 };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) { counts.play++; return play.apply(this, args); };
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Original = window[name];
    if (Original) window[name] = class extends Original { constructor(...args) { super(...args); counts.audioContexts++; } };
  }
  if (window.Notification) {
    const request = window.Notification.requestPermission?.bind(window.Notification);
    window.Notification.requestPermission = (...args) => { counts.notifications++; return request?.(...args); };
  }
}

export async function runHomeQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-home-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  // The server follows the pages' fake clock: both start at NOW and run together; `advance` moves both.
  let offset = NOW - Date.now();
  const serverNow = () => Date.now() + offset;
  // A restart listens on the same port, so the pages keep their address.
  const start = async (port = 0) => {
    const app = await createApplication({ dataDirectory: directory, clientDirectory: join(root, 'dist/client'), now: serverNow, fetcher: async () => Response.json(forecastFixture(Math.floor(NOW / 1000) - 3600)) });
    app.server.listen(port, '127.0.0.1'); await once(app.server, 'listening');
    return app;
  };
  let app = await start();
  const port = app.server.address().port, base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [], contexts = [];
  const watch = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/\b(409|503)\b|Failed to load resource/.test(message.text())) errors.push(message.text()); });
  };
  async function newContext(viewport = EDGE_VIEWPORTS[0]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', timezoneId: 'America/Toronto', locale: 'en-US' }); await mockWindowsStatus(context);
    contexts.push(context);
    await keepPagesLocal(context, base);
    await context.addInitScript(instrumentSilence);
    await context.clock.install({ time: new Date(serverNow()) });
    context.on('page', watch);
    return context;
  }
  async function reset(edit = () => {}) {
    await app.store.update(data => { data.settings = defaultSettings(); edit(data.settings); data.reminders = []; data.photoAsset = null; });
    for (const timer of (await (await fetch(`${base}/api/timers`)).json()).timers) await fetch(`${base}/api/timers/${timer.id}`, { method: 'DELETE' });
  }
  const advance = async (context, ms) => { offset += ms; await context.clock.runFor(ms); };
  const home = async (page, path = '/') => { await page.goto(base + path); await page.locator('.home-page').waitFor(); await page.waitForTimeout(150); };
  const action = (page, name) => page.locator(`.home-action[data-action="${name}"]`);
  const sheet = page => page.locator('dialog.home-sheet[open]');
  const status = page => page.locator('.home-page > .home-main > .home-status, dialog.home-sheet[open] .home-sheet-status').filter({ hasText: /\S/ }).first();
  const timers = async () => (await (await fetch(`${base}/api/timers`)).json()).timers;
  /** The display reloads after its next change poll, whose requests finish after the fake clock moved. */
  const slotSays = (display, pattern) => display.locator('.clock-timer-value').filter({ hasText: pattern }).waitFor({ timeout: 3_000 });
  const state = async () => (await fetch(`${base}/api/state`)).json();
  try {
    // Routes, titles and the header ------------------------------------------------------------
    await reset();
    let context = await newContext();
    let page = await context.newPage();
    await home(page);
    assert.equal(await page.title(), 'Still · Home');
    assert.equal(await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Home' }).getAttribute('aria-current'), 'page');
    assert.equal(await page.getByRole('link', { name: 'Still home' }).getAttribute('href'), '/');
    const openDisplay = page.locator('.studio-header a.open-display');
    assert.deepEqual([await openDisplay.getAttribute('target'), await openDisplay.getAttribute('rel')], ['still-display', null], 'one named display window, with an opener');
    assert.match(await page.locator('h1').innerText(), /Tuesday, October 20/);
    assert.equal(await page.locator('h1 .sr-only').innerText(), 'Home ·');
    await page.goto(base + '/somewhere/else'); await page.locator('.home-page').waitFor();
    assert.equal(await page.title(), 'Still · Home', 'an unknown path opens Home');
    await page.goto(base + '/editor'); await page.getByRole('tab', { name: 'Widgets', exact: true }).waitFor();
    assert.equal(await page.title(), 'Still · Edit display');
    assert.equal(await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Edit display' }).getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('.studio-header a.open-display').getAttribute('target'), 'still-display');
    assert.equal((await fetch(`${base}/`)).headers.get('permissions-policy'), 'geolocation=()');
    checks.push('/ is Home ("Still · Home", Pages nav with aria-current), /editor is Edit display ("Still · Edit display", its tabs), an unknown path opens Home; both headers target the one still-display window without rel=noreferrer');

    // Above the fold at 1280 × 720 and reflow at 390 and 320 px --------------------------------------
    await reset(settings => { settings.widgetData.worldClocks = [{ id: '11111111-1111-4111-8111-111111111111', label: 'Synthetic London', timezone: 'Europe/London', latitude: 51.5, longitude: -0.1 }]; });
    await fetch(`${base}/api/reminders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Synthetic call', dueAt: new Date(serverNow() + 3_600_000).toISOString() }) });
    await home(page);
    const fold = await page.evaluate(() => {
      const bottom = selector => document.querySelector(selector)?.getBoundingClientRect().bottom ?? Infinity;
      return { date: bottom('h1'), actions: Math.max(...[...document.querySelectorAll('.home-action')].map(button => button.getBoundingClientRect().bottom)), today: bottom('#home-today-title'), firstRow: bottom('.home-today .home-row'), edit: bottom('.home-edit-display'), actionHeights: [...document.querySelectorAll('.home-action')].map(button => button.getBoundingClientRect().height), count: document.querySelectorAll('.home-action').length };
    });
    assert.equal(fold.count, 6);
    for (const [name, value] of Object.entries(fold)) if (typeof value === 'number' && name !== 'count') assert.ok(value <= 720, `${name} is above the fold at 1280×720 (${value})`);
    assert.ok(fold.actionHeights.every(height => height >= 64), `compact quick actions are at least 64 px tall ${fold.actionHeights}`);
    assert.match(await page.locator('.home-chips').innerText(), /Synthetic London 11:42 PM · \+5 h/);
    if (capture) images.push({ name: 'home-1280x720', bytes: await page.screenshot() });
    for (const viewport of EDGE_VIEWPORTS) {
      await page.setViewportSize(viewport); await page.waitForTimeout(100);
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        small: [...document.querySelectorAll('.home-page button, .home-page a, .home-page input:not([type=hidden]), .home-page [role=gridcell]')]
          .filter(element => element.checkVisibility() && !element.closest('.home-preview, .home-link-inline'))
          .map(element => { const rect = element.getBoundingClientRect(); return { name: element.getAttribute('aria-label') ?? element.textContent.trim().slice(0, 30), width: rect.width, height: rect.height }; })
          .filter(target => target.width < 44 - 0.5 || target.height < 44 - 0.5),
        columns: getComputedStyle(document.querySelector('.home-actions')).gridTemplateColumns.split(' ').length,
        descriptions: getComputedStyle(document.querySelector('.home-action-description')).position,
      }));
      assert.ok(layout.overflow <= 0, `${viewport.width}: no horizontal overflow (${layout.overflow})`);
      assert.deepEqual(layout.small, [], `${viewport.width}: every target is at least 44 × 44`);
      assert.equal(layout.columns, viewport.width >= 360 ? 3 : 2, `${viewport.width}: quick actions ${viewport.width >= 360 ? '3 × 2' : '2 × 3'}`);
      if (viewport.width < 600) assert.equal(layout.descriptions, 'absolute', `${viewport.width}: descriptions are screen-reader only`);
      if (capture) images.push({ name: `home-${viewport.width}`, bytes: await page.screenshot({ fullPage: true }) });
    }
    await page.setViewportSize(EDGE_VIEWPORTS[0]);
    assert.match(await page.getByRole('group', { name: 'Quick actions' }).ariaSnapshot(), /button "Timer"[\s\S]*button "Reminder"[\s\S]*button "Calendar"[\s\S]*button "World clock"[\s\S]*button "Countdown"[\s\S]*button "Note"/);
    assert.equal(await action(page, 'timer').getAttribute('aria-haspopup'), 'dialog');
    checks.push(`1280×720: the date, the six compact quick actions (≥ 64 px), the Today heading and first row and Edit display are above the fold; 390 and 320 px: no horizontal overflow, 44 px targets, actions 3 × 2 at 390 and 2 × 3 at 320, descriptions screen-reader only; actions named by their labels with aria-haspopup=dialog`);

    // Timers: two activations, the display within 6 s, pause, +1 min, cancel and Undo -----------------
    const display = await context.newPage();
    await display.goto(base + '/display'); await display.locator('.display-page').waitFor();
    await home(page);
    await action(page, 'timer').click(); await sheet(page).waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent === '1 min'); // opening the sheet focuses the first preset
    await sheet(page).getByRole('button', { name: 'Start a 10 min timer' }).click();
    await sheet(page).waitFor({ state: 'detached' });
    assert.match(await status(page).innerText(), /10 min timer started · on your display's clock\./);
    assert.equal((await timers()).length, 1);
    const row = page.locator('.home-timer-row').first();
    await page.waitForFunction(() => document.activeElement?.closest('.home-timer-row') !== null); // focus moves to the new row
    await advance(context, 6_000);
    const slot = display.locator('.clock-timer-value');
    await slot.waitFor({ timeout: 2_000 });
    assert.match(await slot.innerText(), /^10 min left · ends 6:52 PM$/, 'the display shows the timer in its clock within 6 s');
    assert.equal(await display.locator('.clock-timer-label').innerText(), '10 min timer');
    await row.getByRole('button', { name: 'Pause 10 min timer' }).click();
    await page.getByRole('button', { name: 'Resume 10 min timer' }).waitFor();
    await advance(context, 6_000);
    await slotSays(display, /^10 min left · paused$/);
    const pausedLeft = (await timers())[0].remainingMs;
    assert.ok(pausedLeft > 580_000 && pausedLeft < 595_000, `paused with what was left (${pausedLeft})`);
    await row.getByRole('button', { name: 'Add 1 minute to 10 min timer' }).click();
    for (let attempt = 0; (await timers())[0].remainingMs === pausedLeft; attempt++) { assert.ok(attempt < 50, '+1 min saves'); await page.waitForTimeout(20); }
    assert.equal((await timers())[0].remainingMs, pausedLeft + 60_000, '+1 min adds to what is left');
    // #487: cancel while still paused, after +1 min grew the remainder past the starting length.
    await row.getByRole('button', { name: 'Cancel 10 min timer' }).click();
    await row.waitFor({ state: 'detached' });
    assert.deepEqual(await timers(), []);
    await status(page).getByRole('button', { name: 'Undo' }).click();
    await row.getByRole('button', { name: 'Resume 10 min timer' }).waitFor();
    const pausedRestored = (await timers())[0];
    assert.deepEqual([pausedRestored.durationMs, pausedRestored.remainingMs, pausedRestored.endsAt],
      [600_000, pausedLeft + 60_000, null], 'Undo keeps the extended paused remainder and original restart length');
    await row.getByRole('button', { name: 'Resume 10 min timer' }).click(); await page.getByRole('button', { name: 'Pause 10 min timer' }).waitFor();
    const runningEnd = (await timers())[0].endsAt;
    await row.getByRole('button', { name: 'Cancel 10 min timer' }).click();
    await page.locator('.home-timer-row').waitFor({ state: 'detached' });
    assert.match(await status(page).innerText(), /^10 min timer cancelled/);
    assert.deepEqual(await timers(), []);
    await status(page).getByRole('button', { name: 'Undo' }).click();
    await page.locator('.home-timer-row').waitFor();
    const restored = await timers();
    assert.equal(restored.length, 1, 'Undo brings the timer back');
    assert.equal(restored[0].endsAt, runningEnd, 'with the same end');
    await advance(context, 6_000);
    await slotSays(display, /^1[01] min left · ends/);
    checks.push('Timer: the 10 min preset starts in 2 activations, focus moves to the new row and the display Clock shows "10 min left · ends 6:52 PM" within 6 s; Pause shows "· paused" on the display, +1 min adds to what is left, Cancel and Undo restore the extended paused remainder and the same running end');

    // Done: the status tone, the row, the announcement and the title; the display hides it after 10 minutes.
    await fetch(`${base}/api/timers/${restored[0].id}`, { method: 'DELETE' }); await advance(context, 6_000);
    await action(page, 'timer').click(); await sheet(page).getByRole('button', { name: 'Start a 1 min timer' }).click(); await sheet(page).waitFor({ state: 'detached' });
    await advance(context, 61_000); await page.waitForTimeout(200);
    await page.locator('.home-timer-row[data-timer-phase="done"]').waitFor();
    assert.match(await page.locator('.home-timer-row').innerText(), /Done · just now/);
    assert.match(await status(page).innerText(), /1 min timer is done\./, 'announced once');
    assert.equal(await page.title(), 'Done · Still · Home');
    await advance(context, 5_000); await slotSays(display, /^Done/);
    const done = await display.locator('.clock-timer-value').evaluate(element => ({ text: element.textContent, phase: element.dataset.timerPhase, color: getComputedStyle(element).color, caution: getComputedStyle(element.closest('.ambient')).getPropertyValue('--ambient-caution').trim() }));
    assert.equal(done.phase, 'done'); assert.match(done.text, /^Done · just now$/);
    const caution = Number.parseInt(done.caution.slice(1), 16);
    assert.equal(done.color, `rgb(${caution >> 16}, ${(caution >> 8) & 255}, ${caution & 255})`, 'Done in the status tone');
    if (capture) images.push({ name: 'display-done', bytes: await display.screenshot() });
    await advance(context, 10 * 60_000);
    await display.locator('.clock-timer-value').waitFor({ state: 'detached', timeout: 3_000 }); // after 10 minutes the date returns on the display
    assert.equal(await page.locator('.home-timer-row[data-timer-phase="done"]').count(), 1, 'Home keeps it for an hour');
    await page.getByRole('button', { name: 'Dismiss 1 min timer' }).click(); await page.locator('.home-timer-row').waitFor({ state: 'detached' });
    assert.equal(await page.title(), 'Still · Home');
    checks.push('Done: Home shows "Done · just now", announces "1 min timer is done." once and titles the tab "Done · Still · Home"; the display shows Done in the status tone and returns to the date after 10 minutes; Dismiss clears the title');

    // A restart on the same data folder keeps what is left.
    await action(page, 'timer').click(); await sheet(page).getByRole('button', { name: 'Start a 5 min timer' }).click(); await sheet(page).waitFor({ state: 'detached' });
    const [paused] = await timers();
    await fetch(`${base}/api/timers/${paused.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: true }) });
    const left = (await timers())[0].remainingMs;
    app.server.closeAllConnections(); await new Promise(done => app.server.close(done));
    app = await start(port);
    await home(page);
    assert.equal((await timers())[0].remainingMs, left, 'the paused timer keeps what was left after a restart');
    assert.match(await page.locator('.home-timer-row .home-timer-digits').innerText(), /^(5:00|4:5\d)$/);
    assert.match(await page.locator('.home-timer-row .home-row-detail').innerText(), /· paused$/);
    await fetch(`${base}/api/timers/${paused.id}`, { method: 'DELETE' });
    await display.goto(base + '/display'); await display.locator('.display-page').waitFor();
    checks.push('A server restart on the same data folder keeps a paused timer\'s remaining time');

    // Calendar: next week at 9:00 AM, the dot, Today/Coming up and the display's Reminders ----------------
    await reset();
    await home(page);
    await action(page, 'calendar').click(); await sheet(page).waitFor();
    const today = sheet(page).locator('[role=gridcell][aria-current=date]');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-current') === 'date'); // the calendar opens with today focused
    assert.match(await today.getAttribute('aria-label'), /^Tuesday, October 20/);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-day')), '2026-10-26', 'arrows move by week and day');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.closest('label')?.textContent?.startsWith('What')); // Enter selects the day and moves to What
    assert.match(await sheet(page).locator('.home-legend').innerText(), /Add a reminder on Monday, October 26/i);
    await page.keyboard.type('Synthetic dentist');
    assert.equal(await sheet(page).locator('input[type=time]').inputValue(), '09:00');
    await sheet(page).getByRole('button', { name: 'Add to calendar' }).click();
    await sheet(page).locator('.home-day-list .home-row').filter({ hasText: 'Synthetic dentist' }).waitFor();
    const dentist = (await state()).reminders.find(item => item.text === 'Synthetic dentist');
    assert.equal(dentist.dueAt, '2026-10-26T13:00:00.000Z', '9:00 AM in Toronto on October 26 (EDT)');
    assert.match(await status(page).innerText(), /Added for Mon, Oct 26 at 9:00 AM · in Reminders on your display\./);
    assert.match(await sheet(page).locator('[data-day="2026-10-26"]').getAttribute('aria-label'), /Monday, October 26, 1 reminder/);
    assert.equal(await sheet(page).locator('[data-day="2026-10-26"] .home-day-dot').count(), 1, 'the day has a dot');
    await page.keyboard.press('Escape'); await sheet(page).waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.dataset.action === 'calendar'); // Esc returns focus to the opener
    assert.match(await page.locator('.home-today').innerText(), /Coming up[\s\S]*Synthetic dentist/i, 'Coming up lists it');
    await advance(context, 6_000);
    await display.getByText('Synthetic dentist').waitFor({ timeout: 2_000 });
    // A past day is refused, and so is a past time today.
    await action(page, 'calendar').click(); await sheet(page).waitFor();
    await sheet(page).locator('[data-day="2026-10-19"]').click();
    await sheet(page).getByText('This day has passed.').waitFor();
    await sheet(page).getByRole('button', { name: 'Go to today' }).click();
    await sheet(page).locator('input[type=time]').fill('09:00');
    await sheet(page).getByRole('textbox', { name: 'What' }).fill('Synthetic too late');
    await sheet(page).getByRole('button', { name: 'Add to calendar' }).click();
    await sheet(page).getByText('That time has passed. Choose a later time.').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.type), 'time', 'focus stays in the time field');
    // Spring forward: 2:30 AM on Sunday, March 14, 2027 does not exist.
    for (let month = 0; month < 5; month++) await sheet(page).getByRole('button', { name: 'Next month' }).click();
    assert.match(await sheet(page).locator('#home-calendar-month').innerText(), /March 2027/);
    await sheet(page).locator('[data-day="2027-03-14"]').click();
    await sheet(page).getByRole('textbox', { name: 'What' }).fill('Synthetic early train');
    await sheet(page).locator('input[type=time]').fill('02:30');
    await sheet(page).getByRole('button', { name: 'Add to calendar' }).click();
    await status(page).getByText(/2:30 AM doesn't exist on Sun, Mar 14 \(clocks spring forward\)\. Saved for 3:30 AM\./).waitFor();
    assert.equal((await state()).reminders.find(item => item.text === 'Synthetic early train').dueAt, '2027-03-14T07:30:00.000Z');
    await page.keyboard.press('Escape'); await sheet(page).waitFor({ state: 'detached' });
    checks.push('Calendar: arrows and Enter pick October 26; "Synthetic dentist" at 9:00 AM is stored as 2026-10-26T13:00:00.000Z, the day gets a dot and a "1 reminder" name, Coming up lists it and the display\'s Reminders shows it within 6 s; a past day and a past time are refused; 2:30 AM on Mar 14, 2027 is saved for 3:30 AM and named');

    // Reminder: Anytime, one-tap check-off and Undo.
    await action(page, 'reminder').click(); await sheet(page).waitFor();
    await page.waitForFunction(() => document.activeElement?.closest('label')?.textContent?.startsWith('What'));
    await page.keyboard.type('Synthetic water the plants');
    await sheet(page).getByRole('radio', { name: 'Anytime' }).check();
    await sheet(page).getByRole('button', { name: 'Add reminder' }).click(); await sheet(page).waitFor({ state: 'detached' });
    assert.match(await page.locator('.home-today').innerText(), /Anytime[\s\S]*Synthetic water the plants/i);
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Check off Synthetic water the plants'); // focus moves to the new row
    await page.getByRole('button', { name: 'Check off Synthetic water the plants' }).click();
    assert.equal(await page.getByRole('button', { name: 'Check off Synthetic water the plants' }).getAttribute('aria-pressed'), 'true');
    await page.waitForTimeout(1_200);
    assert.equal(await page.getByRole('button', { name: 'Check off Synthetic water the plants' }).count(), 0, 'the row settles and leaves');
    await status(page).getByRole('button', { name: 'Undo' }).click();
    await page.getByRole('button', { name: 'Check off Synthetic water the plants' }).waitFor();
    checks.push('Reminder: Anytime lands in the Anytime group with focus on its check; a one-tap check-off settles, leaves and comes back with Undo');

    // World clock with a mocked city search.
    await page.route('**/api/locations?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 1, name: 'Synthetic Tokyo', country: 'Japan', admin1: 'Tokyo', latitude: 35.68, longitude: 139.69, timezone: 'Asia/Tokyo' }]) }));
    await action(page, 'worldClock').click(); await sheet(page).waitFor();
    await sheet(page).getByRole('combobox', { name: 'City' }).fill('Synth');
    await advance(context, 400);
    await sheet(page).getByRole('option', { name: /Synthetic Tokyo/ }).click();
    assert.equal(await sheet(page).getByRole('textbox', { name: 'Label' }).inputValue(), 'Synthetic Tokyo');
    await sheet(page).getByRole('button', { name: 'Add clock' }).click();
    await sheet(page).getByRole('button', { name: 'Remove Synthetic Tokyo' }).waitFor();
    assert.equal((await state()).settings.widgetData.worldClocks.at(-1).timezone, 'Asia/Tokyo');
    assert.match(await sheet(page).getByText('Rename or reorder in').innerText(), /Edit display/);
    await page.keyboard.press('Escape'); await sheet(page).waitFor({ state: 'detached' });
    assert.match(await page.locator('.home-chips').innerText(), /Synthetic Tokyo \d{1,2}:\d{2} AM · \+13 h/);
    checks.push('World clock: a mocked city search adds "Synthetic Tokyo" with its zone; Home\'s chip reads its time and "+13 h"');

    // Countdown: add, remove and Undo.
    await action(page, 'countdown').click(); await sheet(page).waitFor();
    await sheet(page).getByRole('textbox', { name: 'Title' }).fill('Synthetic trip');
    assert.equal(await sheet(page).locator('#home-countdown-date').inputValue(), '2026-10-27', 'a week ahead');
    await sheet(page).getByRole('button', { name: 'Add countdown' }).click();
    const tripRow = sheet(page).locator('.home-list-row').filter({ hasText: 'Synthetic trip' });
    await tripRow.waitFor(); assert.match(await tripRow.innerText(), /In 7 days/);
    await tripRow.getByRole('button', { name: 'Remove Synthetic trip' }).click(); await tripRow.waitFor({ state: 'detached' });
    await status(page).getByRole('button', { name: 'Undo' }).click(); await tripRow.waitFor();
    assert.deepEqual((await state()).settings.widgetData.countdowns.map(item => item.title), ['Synthetic trip']);
    await page.keyboard.press('Escape'); await sheet(page).waitFor({ state: 'detached' });
    checks.push('Countdown: add (a week ahead by default), remove and Undo keep one "Synthetic trip"');

    // Note: Save and Discard only for an effective change; Clear with Undo; beforeunload only while it differs.
    await action(page, 'note').click(); await sheet(page).waitFor();
    const note = sheet(page).getByRole('textbox', { name: 'Note' });
    assert.equal(await sheet(page).getByRole('button', { name: 'Save note' }).count(), 0);
    await note.fill('Synthetic dinner at seven   ');
    assert.equal(await sheet(page).locator('#home-note-count').innerText(), '28/200');
    await sheet(page).getByRole('button', { name: 'Discard' }).click();
    assert.equal(await note.inputValue(), ''); assert.equal(await sheet(page).getByRole('button', { name: 'Save note' }).count(), 0);
    await note.fill('Synthetic dinner at seven');
    await sheet(page).getByRole('button', { name: 'Save note' }).click();
    await sheet(page).getByRole('button', { name: 'Clear note' }).waitFor();
    assert.equal((await state()).settings.widgetData.note.text, 'Synthetic dinner at seven');
    await note.fill('Synthetic dinner at seven ');
    assert.equal(await sheet(page).getByRole('button', { name: 'Save note' }).count(), 0, 'trailing spaces are not a change');
    await sheet(page).getByRole('button', { name: 'Clear note' }).click(); await sheet(page).getByRole('button', { name: 'Clear note' }).waitFor({ state: 'detached' });
    assert.equal((await state()).settings.widgetData.note.text, '');
    await status(page).getByRole('button', { name: 'Undo' }).click(); await sheet(page).getByRole('button', { name: 'Clear note' }).waitFor();
    assert.equal((await state()).settings.widgetData.note.text, 'Synthetic dinner at seven');
    await note.fill('Synthetic unsaved');
    const prompted = await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
    assert.equal(prompted, true, 'leaving with an unsaved note prompts');
    await sheet(page).getByRole('button', { name: 'Discard' }).click();
    assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), false, 'no prompt once it matches');
    await page.keyboard.press('Escape'); await sheet(page).waitFor({ state: 'detached' });
    checks.push('Note: Save note and Discard appear only for an effective change (trailing spaces are none), with a 28/200 counter; Clear note saves an empty note and Undo restores it; beforeunload prompts only while the note differs');

    // Saved/discarded text is not a retained draft when another page changes the note.
    for (const operation of ['save', 'discard', 'undo']) {
      await action(page, 'note').click(); await note.waitFor();
      if (operation === 'save') {
        await note.fill('Synthetic saved note');
        await sheet(page).getByRole('button', { name: 'Save note' }).click();
        await sheet(page).getByRole('button', { name: 'Clear note' }).waitFor();
      } else if (operation === 'discard') {
        await note.fill('Synthetic discarded draft');
        await sheet(page).getByRole('button', { name: 'Discard' }).click();
        await sheet(page).getByRole('button', { name: 'Clear note' }).waitFor();
      } else {
        await sheet(page).getByRole('button', { name: 'Clear note' }).click();
        await sheet(page).getByRole('button', { name: 'Clear note' }).waitFor({ state: 'detached' });
        await status(page).getByRole('button', { name: 'Undo' }).click();
        await sheet(page).getByRole('button', { name: 'Clear note' }).waitFor();
      }
      await page.keyboard.press('Escape'); await sheet(page).waitFor({ state: 'detached' });
      const external = `Synthetic external after ${operation}`;
      const response = await fetch(`${base}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ widgetData: { note: { text: external } } }) });
      assert.equal(response.status, 200);
      const refreshed = page.waitForResponse(response => response.url() === `${base}/api/state`);
      await advance(context, 6_000); await refreshed;
      await action(page, 'note').click(); await note.waitFor();
      assert.equal(await note.inputValue(), external, `${operation}: reopening reads the current saved note`);
      assert.equal(await sheet(page).getByRole('button', { name: 'Save note' }).count(), 0, `${operation}: no stale draft returns`);
      await page.keyboard.press('Escape'); await sheet(page).waitFor({ state: 'detached' });
    }
    await action(page, 'note').click(); await note.fill('Synthetic unsaved draft');
    await page.keyboard.press('Escape'); await sheet(page).waitFor({ state: 'detached' });
    await action(page, 'note').click(); await note.waitFor();
    assert.equal(await note.inputValue(), 'Synthetic unsaved draft', 'real unsaved text survives closing and reopening');
    await sheet(page).getByRole('button', { name: 'Discard' }).click();
    await page.keyboard.press('Escape'); await sheet(page).waitFor({ state: 'detached' });
    checks.push('Note: Save, Discard and Clear/Undo clear the retained draft so external saved changes appear on reopening without Save note; genuine unsaved text survives');

    await checkHomeNoteSync({ page, base, advance: ms => advance(context, ms) });
    checks.push('#512 Note: clean open text follows external saves without Save or an unload prompt; real typing survives, Discard uses current saved text, and typing back to saved clears the cached draft');

    const pendingDraft = () => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
    for (const [kind, label, value] of [['reminder', 'What', 'Synthetic pending reminder'], ['worldClock', 'City', 'Lon'], ['countdown', 'Title', 'Synthetic pending countdown'], ['timer', 'Name (optional)', 'Synthetic pending timer']]) {
      await action(page, kind).click(); await sheet(page).waitFor();
      const field = sheet(page).getByLabel(label, { exact: true }), initial = await field.inputValue();
      assert.equal(await pendingDraft(), false, `${kind}: merely opening defaults is clean`);
      await field.fill(value); assert.equal(await pendingDraft(), true, `${kind}: typed values are guarded`);
      await sheet(page).locator('.home-sheet-close').click(); await sheet(page).waitFor({ state: 'detached' });
      await action(page, 'note').click(); assert.equal(await pendingDraft(), true, `${kind}: another clean dialog cannot clear its draft guard`);
      await sheet(page).locator('.home-sheet-close').click(); await sheet(page).waitFor({ state: 'detached' });
      await action(page, kind).click(); assert.equal(await field.inputValue(), value, `${kind}: closing and reopening keeps typed values`);
      await field.fill(initial); assert.equal(await pendingDraft(), false, `${kind}: reverting to the original value is clean`);
      await sheet(page).locator('.home-sheet-close').click(); await sheet(page).waitFor({ state: 'detached' });
    }
    // An hour crossing must not change the baseline of the time already displayed to the user.
    await action(page, 'reminder').click(); const reminderTime = sheet(page).getByLabel('Time', { exact: true });
    const displayedTime = await reminderTime.inputValue(); offset += 3_600_000; await context.clock.fastForward(3_600_000);
    await reminderTime.fill('10:22'); assert.equal(await pendingDraft(), true);
    await reminderTime.fill(displayedTime); assert.equal(await pendingDraft(), false, 'revert uses the displayed default before the clock boundary');
    await sheet(page).locator('.home-sheet-close').click(); await sheet(page).waitFor({ state: 'detached' });
    await action(page, 'calendar').click(); const calendarText = sheet(page).getByRole('textbox', { name: 'What', exact: true });
    const calendarTime = sheet(page).getByLabel('Time', { exact: true }), calendarDefault = await calendarTime.inputValue();
    assert.equal(await pendingDraft(), false, 'merely opening Calendar stays clean');
    await calendarText.fill('Synthetic calendar draft'); await calendarTime.fill('10:22');
    const selectedDay = await sheet(page).locator('[role="gridcell"][aria-selected="true"]').getAttribute('data-day');
    await sheet(page).locator('.home-sheet-close').click(); await sheet(page).waitFor({ state: 'detached' }); assert.equal(await pendingDraft(), true);
    await action(page, 'calendar').click(); assert.equal(await calendarText.inputValue(), 'Synthetic calendar draft'); assert.equal(await calendarTime.inputValue(), '10:22');
    assert.equal(await sheet(page).locator('[role="gridcell"][aria-selected="true"]').getAttribute('data-day'), selectedDay);
    await calendarText.fill(''); assert.equal(await pendingDraft(), true, 'an explicit time choice remains guarded before any reminder text');
    await calendarTime.fill(calendarDefault); assert.equal(await pendingDraft(), false, 'reverting to the displayed Calendar default clears its draft');
    await sheet(page).locator('.home-sheet-close').click(); await sheet(page).waitFor({ state: 'detached' });
    await action(page, 'reminder').click(); await sheet(page).getByLabel('What', { exact: true }).fill('Keep this reminder draft'); await sheet(page).locator('.home-sheet-close').click();
    await action(page, 'note').click(); await note.fill('Discard this note only'); await sheet(page).getByRole('button', { name: 'Discard', exact: true }).click();
    assert.equal(await pendingDraft(), true, 'discarding a Note does not discard another pending form'); await sheet(page).locator('.home-sheet-close').click();
    let homeLeaveChoice = false;
    page.once('dialog', async dialog => { homeLeaveChoice = dialog.type() === 'beforeunload'; await dialog.dismiss(); });
    await page.getByRole('link', { name: 'Settings', exact: true }).click({ noWaitAfter: true });
    assert.equal(homeLeaveChoice, true); assert.equal(new URL(page.url()).pathname, '/');
    await action(page, 'reminder').click(); assert.equal(await sheet(page).getByLabel('What', { exact: true }).inputValue(), 'Keep this reminder draft');
    await sheet(page).getByLabel('What', { exact: true }).fill(''); assert.equal(await pendingDraft(), false); await sheet(page).locator('.home-sheet-close').click();
    checks.push('All Home quick forms guard meaningful retained drafts across close/reopen and navigation, keep Calendar text/day/time, remain clean for defaults/reverts, and scope Note discard to that form');

    // Show on my display: Clock off → Show the clock; a full board → Make room in Edit display; ?focus=city.
    await reset(settings => { settings.widgets.clock = false; });
    await home(page);
    await action(page, 'timer').click(); await sheet(page).waitFor();
    await sheet(page).getByText("Timers show in your display's Clock, which is off.").waitFor();
    await sheet(page).getByRole('button', { name: 'Show the clock' }).click();
    await sheet(page).getByText("Timers show in your display's Clock, which is off.").waitFor({ state: 'detached' });
    assert.equal((await state()).settings.widgets.clock, true);
    await page.keyboard.press('Escape'); await sheet(page).waitFor({ state: 'detached' });
    await reset(settings => {
      for (const id of WIDGET_IDS) settings.widgets[id] = id in FULL_WITHOUT_WORLD_CLOCKS;
      Object.assign(settings.widgetGrid.placements, FULL_WITHOUT_WORLD_CLOCKS);
    });
    await home(page);
    await action(page, 'worldClock').click(); await sheet(page).waitFor();
    const noRoom = sheet(page).locator('.home-show-none');
    assert.equal((await noRoom.textContent()).replace(/\s+/g, ' ').trim(), 'No room on your display · Make room in Edit display');
    await noRoom.getByRole('link', { name: 'Make room in Edit display' }).click();
    await page.waitForURL(`${base}/editor`);
    await page.locator('.widget-picker').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Preview World clocks', exact: true }).getAttribute('aria-pressed'), 'true', 'the picker opens on World clocks');
    assert.equal(await page.locator('.edit-layout').getAttribute('aria-pressed'), 'true', 'Edit layout is on');
    assert.equal(new URL(page.url()).search, '', 'the deep link is read once');
    await page.goto(`${base}/editor?focus=city`); await page.locator('#city-search').waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'city-search');
    assert.equal(await page.getByRole('heading', { name: 'Settings', exact: true }).count(), 1);
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, '/settings?focus=city');
    checks.push('Show on my display: with the Clock off the Timer sheet offers Show the clock and turns it on; on a full board World clocks says "No room on your display · Make room in Edit display", which opens /editor with the picker on World clocks; /editor?focus=city redirects to Settings with City focused');

    // Concurrency: two Home pages, and a Home add during an Edit display draft.
    await reset();
    const second = await context.newPage();
    await home(page); await home(second);
    for (const [target, title] of [[page, 'Synthetic from A'], [second, 'Synthetic from B']]) {
      await action(target, 'countdown').click(); await sheet(target).getByRole('textbox', { name: 'Title' }).fill(title);
    }
    await Promise.all([page, second].map(target => sheet(target).getByRole('button', { name: 'Add countdown' }).click()));
    await page.waitForFunction(() => document.querySelectorAll('dialog[open] .home-list-row').length >= 1);
    await page.waitForTimeout(300);
    assert.deepEqual((await state()).settings.widgetData.countdowns.map(item => item.title).sort(), ['Synthetic from A', 'Synthetic from B'], 'both kept');
    await second.close();
    await page.keyboard.press('Escape');
    const editor = await context.newPage();
    await editor.goto(base + '/editor'); await editor.getByRole('tab', { name: 'Style', exact: true }).click();
    await editor.getByRole('slider', { name: /Brightness/ }).fill('40');
    await editor.locator('.studio-savebar').waitFor();
    await action(page, 'countdown').click(); await sheet(page).getByRole('textbox', { name: 'Title' }).fill('Synthetic during a draft');
    await sheet(page).getByRole('button', { name: 'Add countdown' }).click();
    await sheet(page).locator('.home-list-row').filter({ hasText: 'Synthetic during a draft' }).waitFor();
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await editor.locator('.studio-savebar').waitFor({ state: 'detached', timeout: 10_000 });
    const after = (await state()).settings;
    assert.equal(after.appearance.brightness, 0.4);
    assert.ok(after.widgetData.countdowns.some(item => item.title === 'Synthetic during a draft'), 'the Home countdown survives the editor\'s Save');
    await editor.close(); await page.keyboard.press('Escape');
    checks.push('Concurrency: two Home pages adding countdowns at once keep both; a countdown added on Home while Edit display holds a draft survives its Save');

    // One display window, and the display's keys.
    for (const extra of context.pages()) if (extra !== page) await extra.close();
    await home(page);
    await checkHomeDisplayCard(page);
    checks.push('#513 Home card and header share Show/Close state, focus the same display without navigation, and both return to Open display after closing');
    const popup = context.waitForEvent('page');
    await page.locator('.studio-header a.open-display').click();
    const window = await popup; await window.locator('.display-page').waitFor();
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Edit display' }).click();
    await page.getByRole('tab', { name: 'Widgets', exact: true }).waitFor();
    let extraPage = false; const listener = () => { extraPage = true; }; context.on('page', listener);
    await page.locator('.studio-header a.open-display').click(); await page.waitForTimeout(800);
    context.off('page', listener);
    assert.equal(extraPage, false, 'Open display from Edit display reuses the window Home opened');
    assert.equal(context.pages().length, 2);
    await window.locator('.display-page').waitFor();
    const closed = window.waitForEvent('close');
    await window.keyboard.press('Escape').catch(error => { if (!window.isClosed()) throw error; });
    await closed;
    assert.equal(context.pages().length, 1, 'the script-opened display closes back to its opener');
    // Directly opened displays navigate in their own tab (#438), while #436 owns popup closure.
    const direct = await context.newPage();
    await direct.goto(base + '/display'); await direct.locator('.display-page').waitFor();
    await direct.keyboard.press('Escape'); await direct.waitForURL(`${base}/`);
    await direct.locator('.home-page').waitFor();
    await direct.goto(base + '/display'); await direct.locator('.display-page').waitFor();
    await direct.keyboard.press('e'); await direct.waitForURL(`${base}/editor`);
    await direct.goto(base + '/display'); await direct.locator('.display-page').waitFor();
    await direct.mouse.move(200, 200);
    const labels = await direct.getByRole('navigation', { name: 'Display controls' }).locator('.display-control').allInnerTexts();
    assert.deepEqual(labels.map(label => label.trim()), ['Fullscreen · F', 'Home · Esc', 'Edit display · E']);
    await direct.close();
    checks.push('Open display from Home and then from Edit display leaves one display window (still-display), closed by Esc; on a direct display Esc goes to / and E to /editor, with the controls Fullscreen · F, Home · Esc and Edit display · E');

    // Keyboard-only: Tab from the header reaches the actions; a sheet traps focus and Esc returns it.
    await home(page);
    await page.locator('body').focus();
    const order = [];
    for (let step = 0; step < 8 && !order.includes('Timer'); step++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.querySelector('.home-action-label')?.textContent ?? document.activeElement?.textContent?.trim().slice(0, 20))); }
    assert.deepEqual(order.slice(0, 4), ['Still home', 'Home', 'Edit display', 'Open display'], 'the header first');
    assert.deepEqual(order.slice(4), ['About full screen', 'Choose your city', 'Timer'], 'then full-screen help, the first-run line and the quick actions');
    await page.keyboard.press('Enter'); await sheet(page).waitFor();
    for (let step = 0; step < 30; step++) await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog.home-sheet')), true, 'focus stays in the sheet');
    await page.keyboard.press('Escape'); await sheet(page).waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.dataset.action === 'timer');
    assert.equal(await page.locator('.home-main > .home-status[role=status][aria-live=polite]').count(), 1, 'one always-mounted polite status region');
    checks.push('Keyboard: Tab goes header, quick actions, Today; a sheet keeps focus inside and Esc returns it to its button; one polite status region is always mounted');

    // A lost connection keeps typed values and says so.
    await action(page, 'reminder').click(); await page.waitForFunction(() => document.activeElement?.closest('label')?.textContent?.startsWith('What'));
    await page.keyboard.type('Synthetic kept while offline');
    await page.route('**/api/reminders', route => route.abort());
    await sheet(page).getByRole('button', { name: 'Add reminder' }).click();
    await sheet(page).locator('.home-sheet-status').getByText(NETWORK).waitFor();
    assert.equal(await sheet(page).getByRole('textbox', { name: 'What' }).inputValue(), 'Synthetic kept while offline');
    await page.unroute('**/api/reminders');
    await sheet(page).locator('.home-sheet-status').getByRole('button', { name: 'Retry' }).click();
    await sheet(page).waitFor({ state: 'detached' });
    assert.ok((await state()).reminders.some(item => item.text === 'Synthetic kept while offline'), 'Retry saves it');
    checks.push('A lost connection says "Can\'t reach the display server on this computer. Your changes are kept — try again." in the sheet, keeps the typed text, and Retry saves it');

    // Silence: nothing played, no audio context or media element, no notification request.
    for (const target of [page, ...context.pages()]) {
      const sound = await target.evaluate(() => ({ ...window.__lrdSound, media: document.querySelectorAll('audio, video').length }));
      assert.deepEqual(sound, { play: 0, audioContexts: 0, notifications: 0, media: 0 }, 'no audio on Home or the display');
    }
    checks.push('No audio: no play(), no AudioContext, no media elements and no Notification permission request on Home or the display');

    assert.deepEqual(errors, []);
    return { checks, images };
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close(); app.server.closeAllConnections(); await new Promise(done => app.server.close(done)); await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runHomeQa(values); console.log(JSON.stringify({ checks: result.checks }, null, 2));
}
