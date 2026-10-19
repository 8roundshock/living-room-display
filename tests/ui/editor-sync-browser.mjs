// Editor connection and sync (#232, #142, #242): clear network errors that clear after recovery,
// status-based reminder conflicts and two editor tabs keeping each other's list edits. Build first;
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
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', timezoneId: 'America/Toronto', locale: 'en-US' });
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
    await page.clock.install({ time: new Date(now) });
    if (wait) { await page.goto(base + '/editor'); await page.getByRole('button', { name: 'Edit layout', exact: true }).waitFor(); }
    return page;
  }
  const button = (page, name) => page.getByRole('button', { name, exact: true });
  const tab = (page, name) => page.getByRole('tab', { name: name === 'Reminders' ? /^Reminders/ : name, exact: name !== 'Reminders' }).click();
  const alert = (page, text) => page.getByRole('alert').filter({ hasText: text });
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
    assert.match(await page.locator('.fallback-hint').innerText(), /may still be starting, or it may have stopped/);
    await noRawFetch(page, 'loading page');
    if (capture) images.push({ name: 'offline-loading', bytes: await page.screenshot() });
    await page.unroute('**/api/**');
    await button(page, 'Try again').click(); await button(page, 'Edit layout').waitFor();
    checks.push('loading page: clear explanation without the raw browser error, Try again recovers');

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
    // Add reminder fails the same way and keeps the form open with its text.
    await tab(page, 'Reminders'); await button(page, 'Add reminder').click();
    await page.getByRole('textbox', { name: 'Reminder' }).fill('Synthetic offline reminder');
    await button(page, 'Save reminder').click();
    await alert(page, NETWORK).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Reminder' }).inputValue(), 'Synthetic offline reminder', 'the reminder form stays open with its text');
    await page.clock.runFor(30_000);
    await button(page, 'Retry').waitFor();
    assert.equal(await page.locator('.studio-error').count(), 1, 'one alert, not a repeat of the same message');
    await noRawFetch(page, 'failed poll');
    await page.unroute('**/api/**');
    await page.clock.runFor(30_000);
    await page.locator('.studio-error').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.save-status').innerText(), 'Unsaved changes', 'recovery keeps the draft');
    await button(page, 'Save reminder').click(); await page.getByRole('textbox', { name: 'Reminder' }).waitFor({ state: 'detached' });
    await button(page, 'Save changes').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    assert.equal(app.store.snapshot().settings.appearance.brightness, Number(edited) / 100);
    assert.deepEqual(app.store.snapshot().reminders.map(item => item.text), ['Synthetic offline reminder']);
    checks.push('offline Save and Add reminder: clear message, draft/form kept, one alert with Retry after a failed poll, cleared after recovery, then both save');

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
    await page.reload(); await button(page, 'Edit layout').waitFor();
    await tab(page, 'Reminders'); await button(page, 'Edit: Synthetic reminder').click();
    await page.getByRole('textbox', { name: 'Reminder' }).fill('Synthetic reminder, edited');
    await page.route('**/api/reminders/*', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 409, json: { error: 'Synthetic different wording' } }) : route.continue());
    await button(page, 'Save reminder').click();
    await alert(page, 'This reminder was completed elsewhere. Restore it to edit.').waitFor();
    await page.unroute('**/api/reminders/*');
    await page.route('**/api/reminders', route => route.request().method() === 'POST' ? route.fulfill({ status: 409, json: { error: 'Reminder limit reached' } }) : route.continue());
    await button(page, 'Cancel reminder').click(); await button(page, 'Add reminder').click();
    await page.getByRole('textbox', { name: 'Reminder' }).fill('Synthetic extra');
    await button(page, 'Save reminder').click();
    await alert(page, 'Reminder limit reached').waitFor();
    await page.unroute('**/api/reminders');
    checks.push('reminder edit conflict recognised by 409 status with different wording; a new reminder 409 keeps its own message');

    // 5. #242: two tabs add a countdown each; the second keeps both after its poll and saves both.
    await reset();
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
