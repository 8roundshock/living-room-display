import { mockWindowsStatus } from './lib/windows-fixture.mjs';
// Compact context help on synthetic Home/editor pages. No installed profile, native actions or disk captures.
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
import { keepPagesLocal } from './lib/local-only.mjs';

export async function runContextHelpQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-context-help-'));
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  async function context(options = {}) {
    const created = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce', ...options }); await mockWindowsStatus(created);
    await keepPagesLocal(created, base);
    await created.route('**/api/windows/status', route => route.fulfill({ json: { available: false, isLivingRoomDisplay: false, power: { available: false } } }));
    created.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    return created;
  }
  async function hidden(page) { await page.getByRole('tooltip').waitFor({ state: 'detached' }); }
  async function bounds(page, viewport) {
    for (const element of [page.getByRole('button', { name: 'About full screen' }), page.getByRole('tooltip')]) {
      const box = await element.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, JSON.stringify(box));
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
  }
  try {
    const before = structuredClone(app.store.snapshot().settings);
    const desktop = await context();
    const page = await desktop.newPage();
    await page.goto(base); await page.locator('.studio-header').waitFor();
    const help = page.getByRole('button', { name: 'About full screen' });
    assert.equal(await page.locator('.open-display-hint').count(), 0);
    await help.hover();
    assert.equal(await page.getByRole('tooltip').innerText(), 'Open the display, then press F for full screen.');
    await page.getByRole('tooltip').hover(); await page.waitForTimeout(180);
    assert.equal(await page.getByRole('tooltip').count(), 1, 'hovering the text keeps it visible');
    await page.mouse.move(0, 300); await hidden(page);
    await help.focus(); await page.getByRole('tooltip').waitFor();
    assert.equal(await help.getAttribute('aria-describedby'), await page.getByRole('tooltip').getAttribute('id'));
    await page.keyboard.press('Escape'); await hidden(page); await page.waitForTimeout(180);
    assert.equal(await help.evaluate(element => document.activeElement === element), true, 'Escape retains focus');
    assert.equal(await page.getByRole('tooltip').count(), 0, 'focus does not reopen after Escape');
    await page.keyboard.press('Enter'); await page.getByRole('tooltip').waitFor();
    await page.keyboard.press('Space'); await hidden(page);
    await page.keyboard.press('Tab'); await help.focus(); await page.getByRole('tooltip').waitFor();
    await page.keyboard.press('Escape'); await hidden(page);
    checks.push('Hover text is persistent; focus describes the trigger; Escape dismisses without moving focus or reopening; Enter/Space activate');

    // Freeze the blur grace period: a fast keyboard transition must give the
    // newly opened sheet its own Escape rather than spending it on stale help.
    const quick = await desktop.newPage();
    await quick.clock.install();
    await quick.goto(base); await quick.locator('.home-page').waitFor();
    await quick.getByRole('button', { name: 'About full screen' }).focus();
    await quick.getByRole('tooltip').waitFor();
    await quick.locator('.home-action[data-action="timer"]').focus();
    await quick.keyboard.press('Enter');
    await quick.locator('dialog.home-sheet[open]').waitFor();
    assert.equal(await quick.getByRole('tooltip').count(), 1, 'the blur grace period has not elapsed');
    await quick.keyboard.press('Escape');
    await quick.locator('dialog.home-sheet[open]').waitFor({ state: 'detached', timeout: 1500 });
    await hidden(quick);
    assert.equal(await quick.locator('.home-action[data-action="timer"]').evaluate(element => document.activeElement === element), true, 'the sheet returns focus to Timer');
    await quick.close();

    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Edit display', exact: true }).click();
    await page.getByRole('tab', { name: 'Style', exact: true }).click();
    const brightness = page.getByRole('slider', { name: 'Brightness', exact: true });
    await brightness.focus(); await page.keyboard.press('ArrowLeft');
    const draft = await brightness.inputValue();
    await page.locator('.studio-savebar').waitFor();
    await page.locator('summary', { hasText: 'Motion' }).click();
    const animation = page.getByRole('button', { name: 'About animation' });
    await animation.focus(); assert.match(await page.getByRole('tooltip').innerText(), /Subtle animates changes/);
    await help.focus(); assert.equal(await page.getByRole('tooltip').count(), 1, 'only one tip');
    assert.match(await page.getByRole('tooltip').innerText(), /F for full screen/);
    const float = page.getByRole('checkbox', { name: 'Float gently', exact: true });
    const floating = await float.isChecked(); await float.click(); await hidden(page);
    assert.equal(await float.isChecked(), !floating, 'outside click still performs its action');
    if (capture) images.push({ name: 'editor-motion-1280', bytes: await page.screenshot() });
    await page.getByRole('tab', { name: 'Widgets', exact: true }).click();
    await page.getByRole('button', { name: 'Add widget', exact: true }).click();
    await help.focus(); await hidden(page);
    assert.equal(await help.evaluate(element => document.activeElement === element), false, 'background help cannot steal modal focus');
    assert.equal(await page.locator('.widget-picker-dialog').evaluate(element => element.contains(document.activeElement)), true);
    await page.keyboard.press('Escape'); await page.locator('.widget-picker').waitFor({ state: 'detached' });
    await help.focus(); await page.getByRole('tooltip').waitFor();
    await page.keyboard.press('Escape'); await hidden(page);
    await page.getByRole('button', { name: 'Add widget', exact: true }).click();
    assert.match(await page.locator('.widget-picker').innerText(), /Sample content/);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
    await page.getByRole('button', { name: 'About editing the layout' }).focus();
    assert.match(await page.getByRole('tooltip').innerText(), /Arrow keys work too/);
    await page.getByRole('button', { name: 'Done', exact: true }).click(); await hidden(page);
    await help.focus(); await page.getByRole('tooltip').waitFor(); await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Style', exact: true }).click();
    assert.equal(await brightness.inputValue(), draft, 'help, picker close/reopen and layout mode preserve the draft');
    assert.deepEqual(app.store.snapshot().settings, before, 'help never saves live settings');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    checks.push('Independent help instances, outside action, parent Escape including an unelapsed blur timer, unmount cleanup, picker reopen and draft/Cancel preservation');

    const popupPromise = desktop.waitForEvent('page');
    await page.getByRole('link', { name: 'Open display', exact: true }).click();
    const display = await popupPromise; await display.locator('.display-page').waitFor();
    await page.getByRole('button', { name: 'Close display', exact: true }).waitFor();
    for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 700 }, { width: 640, height: 360 }]) {
      await page.setViewportSize(viewport);
      await help.focus(); await page.getByRole('tooltip').waitFor(); await bounds(page, viewport);
      if (capture && viewport.width === 320) images.push({ name: 'editor-help-320-display-open', bytes: await page.screenshot() });
      await page.keyboard.press('Escape'); await help.evaluate(element => element.blur());
    }
    await page.getByRole('button', { name: 'Close display', exact: true }).click();
    await page.getByRole('link', { name: 'Still home', exact: true }).click();
    await page.locator('.studio-header').getByRole('link', { name: 'Open display', exact: true }).click();
    await page.getByRole('button', { name: 'Close display', exact: true }).waitFor();
    await page.setViewportSize({ width: 320, height: 640 });
    await help.focus(); await page.getByRole('tooltip').waitFor(); await bounds(page, { width: 320, height: 640 });
    if (capture) images.push({ name: 'home-help-320-display-open', bytes: await page.screenshot() });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Close display', exact: true }).click();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    const awake = page.getByRole('button', { name: 'About keeping the screen on' });
    await awake.focus(); assert.match(await page.getByRole('tooltip').innerText(), /Windows power settings apply otherwise/);
    await page.keyboard.press('Escape'); await hidden(page);
    assert.equal(await awake.evaluate(element => element === document.activeElement), true);
    await desktop.close();

    const mobile = await context({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
    const phone = await mobile.newPage(); await phone.goto(base); await phone.locator('.studio-header').waitFor();
    const touchHelp = phone.getByRole('button', { name: 'About full screen' });
    const target = await touchHelp.boundingBox(); assert.ok(target.width >= 44 && target.height >= 44);
    await touchHelp.tap(); await phone.getByRole('tooltip').waitFor(); await bounds(phone, { width: 320, height: 640 });
    if (capture) images.push({ name: 'home-help-320', bytes: await phone.screenshot() });
    await touchHelp.tap(); await hidden(phone);
    await touchHelp.tap(); await phone.getByRole('tooltip').waitFor();
    await phone.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Edit display', exact: true }).tap();
    await phone.getByRole('tab', { name: 'Style', exact: true }).waitFor(); await hidden(phone);
    assert.deepEqual(app.store.snapshot().settings, before);
    await mobile.close();
    checks.push('320 px touch first tap/toggle/reopen and outside navigation; 320/390/640 px help fits with a display window open; no saved changes');
    assert.deepEqual(errors, []);
    return { checks, images };
  } finally {
    await browser.close(); app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
    await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runContextHelpQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks }, null, 2));
}
