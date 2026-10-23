import { mockWindowsStatus } from './lib/windows-fixture.mjs';
// Editor connection and sync (#232, #142, #242, #287, #350, #289): clear network errors that clear
// after recovery, status-based reminder conflicts, two editor tabs keeping each other's list edits and
// widgets (also when one saves before its poll), and Save keeping focus while it runs. Build first;
// the server, its data folder and every value are synthetic and temporary. Images stay in RAM.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../dist/server/app.js';
import { defaultSettings } from '../../dist/shared/defaults.js';
import { defaultWidgetGrid, defaultWidgetVisibility } from '../../dist/shared/widgets.js';

const NETWORK = "Can't reach the display server on this computer. Your changes are kept — try again.";

export async function runEditorSyncQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-editor-sync-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const now = Date.parse('2026-10-18T13:41:00Z');
  const app = await createApplication({ dataDirectory: directory, clientDirectory: join(root, 'dist/client'), now: () => now, fetcher: async () => { throw new Error('Synthetic unavailable provider'); } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [], contexts = [];
  async function open(viewport = { width: 1280, height: 720 }, { wait = true } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', timezoneId: 'America/Toronto', locale: 'en-US' }); await mockWindowsStatus(context);
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
    await page.clock.install({ time: new Date(now) });
    if (wait) { await page.goto(base + '/editor'); await page.getByRole('button', { name: 'Edit layout', exact: true }).waitFor(); }
    return page;
  }
  const button = (page, name) => page.getByRole('button', { name, exact: true });
  const tab = async (page, name) => {
    if (name === 'Reminders') {
      if (!new URL(page.url()).pathname.startsWith('/editor')) {
        await page.getByRole('button', { name: /^All reminders/ }).click();
        return;
      }
      throw new Error('Reminder actions must use a separate Home page, preserving the editor draft.');
    }
    await page.getByRole('tab', { name, exact: true }).click();
  };
  const alert = (page, text) => page.locator('[role="alert"], .home-sheet-status.error').filter({ hasText: text });
  const noRawFetch = async (page, label) => assert.doesNotMatch(await page.locator('body').innerText(), /Failed to fetch|TypeError|NetworkError/, `${label}: no raw browser error`);
  async function reset(update = () => {}) {
    await app.store.update(data => { data.settings = defaultSettings(); data.reminders = []; update(data); });
  }
  try {
    // 1. The loading page explains a server it cannot reach, then recovers with Try again.
    await reset();
    let page = await open(undefined, { wait: false });
    await page.route('**/api/**', route => route.abort());
    await page.goto(base + '/editor');
    await page.getByText("Can't reach the display server on this computer.", { exact: true }).waitFor();
    assert.equal(await page.locator('.fallback-hint').innerText(), 'The app needs the display server that runs on this computer. Try again in a moment; if it keeps failing, restart the app.');
    await noRawFetch(page, 'loading page');
    if (capture) images.push({ name: 'offline-loading', bytes: await page.screenshot() });
    // #438: Home's loading page names Home.
    await page.goto(base + '/');
    await page.getByText("Can't reach the display server on this computer.", { exact: true }).waitFor();
    assert.equal(await page.locator('.fallback-hint').innerText(), 'Home needs the display server that runs on this computer. It may still be starting, or it may have stopped. Try again in a moment; if it keeps failing, restart the app.');
    await page.goto(base + '/editor'); await page.getByText("Can't reach the display server on this computer.", { exact: true }).waitFor();
    await page.unroute('**/api/**');
    await button(page, 'Try again').click(); await button(page, 'Edit layout').waitFor();
    assert.equal(await page.title(), 'Still · Edit display');
    checks.push('loading page: clear explanation without the raw browser error (Edit display\'s and Home\'s own hints), Try again recovers; the title is "Still · Edit display"');

    // 2. Save while the server is unreachable keeps the draft, shows the clear message, hands the
    //    Retry offer to the next failed poll and clears everything once a poll succeeds.
    await tab(page, 'Style');
    const slider = page.getByRole('slider', { name: 'Brightness', exact: true });
    await slider.focus(); await page.keyboard.press('ArrowRight'); const edited = await slider.inputValue();
    await page.route('**/api/**', route => route.abort());
    await button(page, 'Save changes').click();
    await alert(page, NETWORK).waitFor();
    assert.equal(await slider.inputValue(), edited, 'the draft is kept');
    assert.equal(await page.locator('.save-status').innerText(), 'Unsaved changes');
    assert.equal(await button(page, 'Save changes').evaluate(element => element === document.activeElement), true, 'focus returns to Save for a retry');
    await noRawFetch(page, 'failed Save');
    await page.clock.runFor(30_000);
    await button(page, 'Retry').waitFor();
    assert.equal(await page.locator('.studio-error').count(), 1);
    await page.unroute('**/api/**'); await page.clock.runFor(30_000);
    await page.locator('.studio-error').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.save-status').innerText(), 'Unsaved changes');
    const visualBeforeHome = app.store.snapshot().settings.appearance.brightness;
    // Home owns independently saved reminders. A failed request retains the form without joining
    // the visual editor draft; this page is intentionally separate, not an invisible editor tab.
    const home = await open(undefined, { wait: false });
    await home.goto(base + '/'); await home.locator('.home-page').waitFor();
    await tab(home, 'Reminders'); await button(home, 'Add reminder').click();
    await home.getByRole('textbox', { name: 'Reminder' }).fill('Synthetic offline reminder');
    await home.route('**/api/reminders', route => route.abort());
    await button(home, 'Save reminder').click(); await alert(home, NETWORK).waitFor();
    assert.equal(await home.getByRole('textbox', { name: 'Reminder' }).inputValue(), 'Synthetic offline reminder');
    await noRawFetch(home, 'failed reminder Save');
    await home.unroute('**/api/reminders'); await button(home, 'Save reminder').click();
    await home.getByRole('textbox', { name: 'Reminder' }).waitFor({ state: 'detached' });
    assert.deepEqual(app.store.snapshot().reminders.map(item => item.text), ['Synthetic offline reminder']);
    await home.close();
    assert.equal(await page.locator('.studio-savebar').count(), 1, 'Home reminder save keeps the other page’s visual draft');
    assert.equal(await slider.inputValue(), edited, 'the typed visual value stays');
    assert.equal(app.store.snapshot().settings.appearance.brightness, visualBeforeHome, 'Home reminder save does not persist visual settings');
    await button(page, 'Save changes').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    assert.equal(app.store.snapshot().settings.appearance.brightness, Number(edited) / 100);
    checks.push('Editor offline Save keeps draft/one Retry alert and recovers; Home reminder failure independently keeps its form and saves on retry');

    // 3. A Save that failed while the server restarted clears after the next successful poll,
    //    even though no poll ever failed.
    await tab(page, 'Style'); await slider.focus(); await page.keyboard.press('ArrowRight');
    await page.route('**/api/settings', route => route.abort());
    await button(page, 'Save changes').click(); await alert(page, NETWORK).waitFor();
    await page.unroute('**/api/settings');
    await page.clock.runFor(30_000);
    await page.locator('.studio-error').waitFor({ state: 'detached' });
    await button(page, 'Save changes').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    // A server error is not a connection error: it stays until the next action or dismissal.
    await slider.focus(); await page.keyboard.press('ArrowRight');
    await page.route('**/api/settings', route => route.fulfill({ status: 500, json: { error: 'Synthetic save failure' } }));
    await button(page, 'Save changes').click(); await alert(page, 'Synthetic save failure').waitFor();
    await page.clock.runFor(30_000); await page.waitForTimeout(100);
    assert.equal(await alert(page, 'Synthetic save failure').count(), 1, 'a server error stays after a successful poll');
    await button(page, 'Dismiss message').click(); await page.locator('.studio-error').waitFor({ state: 'detached' });
    await page.unroute('**/api/settings');
    await button(page, 'Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    checks.push('a connection-caused Save error clears after the next successful poll; a server error stays until dismissed');

    // 4. #142: an edit refused with 409 is recognised by status, whatever the wording.
    await reset(data => { data.reminders = [{ id: '11111111-1111-4111-8111-111111111111', text: 'Synthetic reminder', completed: false, dueAt: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }]; });
    await page.goto(base + '/'); await page.locator('.home-page').waitFor();
    await tab(page, 'Reminders'); await button(page, 'Edit: Synthetic reminder').click();
    await page.getByRole('textbox', { name: 'Reminder' }).fill('Synthetic reminder, edited');
    await page.route('**/api/reminders/*', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 409, json: { error: 'Synthetic different wording' } }) : route.continue());
    await button(page, 'Save reminder').click();
    await alert(page, 'This reminder was completed elsewhere. Restore it to edit.').waitFor();
    await page.unroute('**/api/reminders/*');
    await page.route('**/api/reminders', route => route.request().method() === 'POST' ? route.fulfill({ status: 409, json: { error: 'Reminder limit reached' } }) : route.continue());
    await button(page, 'Discard').click(); await button(page, 'Add reminder').click();
    await page.getByRole('textbox', { name: 'Reminder' }).fill('Synthetic extra');
    await button(page, 'Save reminder').click();
    await alert(page, 'Reminder limit reached').waitFor();
    await page.unroute('**/api/reminders');
    checks.push('reminder edit conflict recognised by 409 status with different wording; a new reminder 409 keeps its own message');

    // 5. #242: two tabs add a countdown each; the second keeps both after its poll and saves both.
    // The catalog board (the default before #435) has room for Countdown; the #435 default board is full.
    await reset(data => { data.settings.widgets = defaultWidgetVisibility(); data.settings.widgetGrid = defaultWidgetGrid(); });
    const first = await open();
    await tab(first, 'Widgets'); await button(first, 'Add widget').click(); await button(first, 'Preview Countdown').click(); await button(first, 'Add Countdown').click();
    await button(first, 'Save changes').click(); await first.locator('.studio-savebar').waitFor({ state: 'detached' });
    const second = await open();
    const addDate = async (target, title) => {
      await tab(target, 'Widgets');
      const row = target.locator('.widget-option').filter({ has: button(target, 'Countdown') });
      if (!(await row.getAttribute('class')).includes('selected')) await button(target, 'Countdown').click();
      await button(target, 'Add date').click();
      await target.locator('.widget-option.selected input[aria-label$=" title"]').last().fill(title);
    };
    await addDate(first, 'From tab A'); await addDate(second, 'From tab B');
    await button(first, 'Save changes').click(); await first.locator('.studio-savebar').waitFor({ state: 'detached' });
    await second.clock.runFor(30_000);
    const titles = target => target.locator('.widget-option.selected input[aria-label$=" title"]').evaluateAll(inputs => inputs.map(input => input.value));
    await second.waitForFunction(() => [...document.querySelectorAll('.widget-option.selected input[aria-label$=" title"]')].length === 2);
    assert.deepEqual(await titles(second), ['From tab A', 'From tab B'], 'the poll merges the other tab’s saved countdown');
    assert.equal(await second.locator('.save-status').innerText(), 'Unsaved changes');
    if (capture) images.push({ name: 'two-tab-merge', bytes: await second.screenshot() });
    await button(second, 'Save changes').click(); await second.locator('.studio-savebar').waitFor({ state: 'detached' });
    assert.deepEqual(app.store.snapshot().settings.widgetData.countdowns.map(item => item.title), ['From tab A', 'From tab B'], 'the server keeps both countdowns');
    await first.clock.runFor(30_000);
    await first.waitForFunction(() => [...document.querySelectorAll('.widget-option.selected input[aria-label$=" title"]')].length === 2);
    assert.deepEqual(await titles(first), ['From tab A', 'From tab B'], 'the first tab shows both after its poll');
    checks.push('two editor tabs: a countdown added in each ends with both on the server and in both tabs');

    // 6. #287: the same, but B saves before its poll. Its stale Save is refused, merged and sent again.
    await reset(data => { data.settings.widgets = defaultWidgetVisibility(); data.settings.widgetGrid = defaultWidgetGrid(); data.settings.widgets.countdown = true; data.settings.widgetGrid.placements.countdown = { column: 2, row: 4, size: 'small' }; });
    const tabA = await open(), tabB = await open();
    const patches = [];
    tabB.on('response', response => { if (response.url().endsWith('/api/settings') && response.request().method() === 'PATCH') patches.push(response.status()); });
    await addDate(tabA, 'Saved first in A'); await addDate(tabB, 'Saved second in B');
    await button(tabA, 'Save changes').click(); await tabA.locator('.studio-savebar').waitFor({ state: 'detached' });
    await button(tabB, 'Save changes').click(); await tabB.locator('.studio-savebar').waitFor({ state: 'detached' });
    assert.deepEqual(patches, [409, 200], 'the stale Save is refused once, then the clean merge saves by itself');
    assert.deepEqual(app.store.snapshot().settings.widgetData.countdowns.map(item => item.title), ['Saved first in A', 'Saved second in B'], 'the server keeps both countdowns');
    assert.deepEqual(await titles(tabB), ['Saved first in A', 'Saved second in B']);
    assert.equal(await tabB.locator('.studio-error').count(), 0, 'a clean retry needs no message');
    await tabA.clock.runFor(30_000);
    await tabA.waitForFunction(() => [...document.querySelectorAll('.widget-option.selected input[aria-label$=" title"]')].length === 2);
    checks.push('#287: B saves before its poll; the 409 merge keeps both countdowns and saves once more by itself');

    // 7. #287: both tabs change the same value. B's draft is kept with a review message; its next Save wins.
    for (const target of [tabA, tabB]) await tab(target, 'Style');
    const brightness = target => target.getByRole('slider', { name: 'Brightness', exact: true });
    await brightness(tabA).focus(); await tabA.keyboard.press('ArrowRight');
    await brightness(tabB).focus(); await tabB.keyboard.press('ArrowLeft'); await tabB.keyboard.press('ArrowLeft');
    const fromB = await brightness(tabB).inputValue();
    await button(tabA, 'Save changes').click(); await tabA.locator('.studio-savebar').waitFor({ state: 'detached' });
    patches.length = 0;
    await button(tabB, 'Save changes').click();
    await alert(tabB, 'Settings changed in another window. Review and save again.').waitFor();
    assert.deepEqual(patches, [409], 'no automatic retry would overwrite the other window’s value');
    assert.equal(await brightness(tabB).inputValue(), fromB, 'the draft is kept');
    assert.equal(await tabB.locator('.save-status').innerText(), 'Unsaved changes');
    assert.equal(await tabB.locator('.studio-savebar .button.primary').evaluate(element => element === document.activeElement), true, 'focus stays on Save');
    if (capture) images.push({ name: 'stale-save-review', bytes: await tabB.screenshot() });
    await button(tabB, 'Save changes').click(); await tabB.locator('.studio-savebar').waitFor({ state: 'detached' });
    assert.deepEqual(patches, [409, 200]);
    assert.equal(app.store.snapshot().settings.appearance.brightness, Number(fromB) / 100, 'the reviewed Save wins');
    checks.push('#287: the same value changed in both tabs keeps B’s draft with “Settings changed in another window”, and B’s next Save wins');

    // 8. #350: an unsaved Countdown in B, Note saved elsewhere, a poll, then Save: Note stays enabled.
    // Like #242/#287 above, these two scenarios require the old catalog board's free cells.
    await reset(data => { data.settings.widgets = defaultWidgetVisibility(); data.settings.widgetGrid = defaultWidgetGrid(); });
    const layoutTab = await open();
    await tab(layoutTab, 'Widgets'); await button(layoutTab, 'Add widget').click(); await button(layoutTab, 'Preview Countdown').click(); await button(layoutTab, 'Add Countdown').click();
    await app.store.patchSettings({ widgets: { note: true }, widgetGrid: { placements: { note: { column: 10, row: 6, size: 'small' } } } });
    await layoutTab.clock.runFor(30_000);
    const canvasWidget = (target, id) => target.locator(`.preview-frame [data-widget-id="${id}"]`);
    await canvasWidget(layoutTab, 'note').waitFor();
    assert.equal(await canvasWidget(layoutTab, 'countdown').count(), 1, 'the unsaved Countdown stays');
    await button(layoutTab, 'Save changes').click(); await layoutTab.locator('.studio-savebar').waitFor({ state: 'detached' });
    let saved = app.store.snapshot().settings;
    assert.equal(saved.widgets.note, true, 'Note saved elsewhere is still enabled'); assert.equal(saved.widgets.countdown, true);
    assert.deepEqual(saved.widgetGrid.placements.note, { column: 10, row: 6, size: 'small' });
    checks.push('#350: an unsaved Countdown, Note saved elsewhere, a poll and Save keep Note enabled at its saved place');

    // 9. #350: with no room for it on this layout, the draft wins and the editor says so.
    await reset(data => { data.settings.widgets = defaultWidgetVisibility(); data.settings.widgetGrid = defaultWidgetGrid(); });
    await layoutTab.reload(); await button(layoutTab, 'Edit layout').waitFor();
    await tab(layoutTab, 'Widgets'); await button(layoutTab, 'Add widget').click(); await button(layoutTab, 'Preview Countdown').click(); await button(layoutTab, 'Add Countdown').click();
    // The other window gives Note the very cells this draft gave Countdown (the first free ones).
    assert.equal(await canvasWidget(layoutTab, 'countdown').getAttribute('data-widget-size'), 'small');
    await app.store.patchSettings({ widgets: { note: true }, widgetGrid: { placements: { note: { column: 2, row: 4, size: 'small' } } } });
    await layoutTab.clock.runFor(30_000);
    const noRoom = 'Note was added in another window; there is no room for it in this layout';
    // A poll's message is not an edit made in the Widgets list, so the canvas line shows it once and the
    // one layout announcer speaks it (#311, #341).
    await layoutTab.locator('.canvas-messages .grid-status').filter({ hasText: noRoom }).waitFor();
    assert.equal(await layoutTab.locator('.widget-list .inline-message').filter({ hasText: noRoom }).count(), 0, 'shown once, in the canvas line');
    assert.equal(await layoutTab.locator('[role="status"], [aria-live], [role="alert"]').evaluateAll((nodes, text) => nodes.filter(node => node.textContent.includes(text)).length, noRoom), 1, 'one live region speaks it');
    assert.equal(await canvasWidget(layoutTab, 'note').count(), 0);
    if (capture) images.push({ name: 'no-room-message', bytes: await layoutTab.screenshot() });
    await button(layoutTab, 'Save changes').click(); await layoutTab.locator('.studio-savebar').waitFor({ state: 'detached' });
    saved = app.store.snapshot().settings;
    assert.equal(saved.widgets.countdown, true); assert.equal(saved.widgets.note, false, 'the announced draft wins');
    checks.push('#350: a widget saved elsewhere with no room on this layout is named once, in the canvas line, by one live region, and the draft wins');

    // 10. #289: Save keeps focus while a held request runs, and a second Enter sends nothing.
    await tab(layoutTab, 'Style');
    await brightness(layoutTab).focus(); await layoutTab.keyboard.press('ArrowRight');
    let release; const held = new Promise(resolve => { release = resolve; });
    let sent = 0;
    await layoutTab.route('**/api/settings', async route => { if (route.request().method() === 'PATCH') { sent++; await held; } await route.continue(); });
    const saveButton = layoutTab.locator('.studio-savebar .button.primary');
    await saveButton.focus(); await layoutTab.keyboard.press('Enter');
    await layoutTab.locator('.save-status').filter({ hasText: 'Saving…' }).waitFor();
    assert.equal(await saveButton.evaluate(element => element === document.activeElement), true, 'focus stays on Save while saving');
    assert.equal(await saveButton.getAttribute('aria-disabled'), 'true');
    assert.equal(await saveButton.evaluate(element => element.disabled), false, 'not the disabled attribute, which would drop focus');
    await layoutTab.keyboard.press('Enter'); await layoutTab.keyboard.press('Space'); await layoutTab.waitForTimeout(150);
    assert.equal(sent, 1, 'a second activation sends no second request');
    release();
    await layoutTab.locator('.studio-savebar').waitFor({ state: 'detached' });
    assert.equal(sent, 1);
    await layoutTab.unroute('**/api/settings');
    checks.push('#289: during a held Save, focus stays on Save (aria-disabled) and a second Enter or Space sends nothing');

    assert.deepEqual(errors, []);
    return { checks, images };
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close(); await new Promise(done => app.server.close(done)); await rm(directory, { recursive: true, force: true });
  }
}
if (typeof process !== 'undefined' && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runEditorSyncQa(values); console.log(JSON.stringify({ checks: result.checks }, null, 2));
}
