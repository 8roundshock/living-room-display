// Bounded editor regressions. Build first; all server state and images are isolated.
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
import { ACTIVE_WIDGET_IDS, WIDGET_CATALOG, widgetSizes } from '../../dist/shared/widgets.js';

export async function runWorkspaceQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-workspace-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const now = Date.parse('2026-10-18T13:41:00Z');
  const app = await createApplication({ dataDirectory: directory, clientDirectory: join(root, 'dist/client'), now: () => now, fetcher: async input => {
    const url = new URL(input);
    if (url.hostname === 'geocoding-api.open-meteo.com' && url.searchParams.get('name') === 'London') return Response.json({ results: [{ id: 101, name: 'London', latitude: 51.5, longitude: -0.1, timezone: 'Europe/London', admin1: 'England', country: 'United Kingdom' }] });
    throw new Error('Synthetic unavailable provider');
  } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  let context, page;
  const button = name => page.getByRole('button', { name, exact: true });
  const tab = name => page.getByRole('tab', { name: name === 'Reminders' ? /^Reminders/ : name, exact: name !== 'Reminders' }).click();
  async function open(viewport, reducedMotion = 'reduce') {
    await context?.close();
    await app.store.update(data => { data.settings = defaultSettings(); data.reminders = [{ id: '11111111-1111-4111-8111-111111111111', text: 'Private reminder sentinel', completed: false, dueAt: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }]; });
    context = await browser.newContext({ viewport, reducedMotion, timezoneId: 'America/Toronto' });
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
    await page.clock.install({ time: new Date(now) });
    await page.goto(base + '/editor'); await button('Edit layout').waitFor();
  }
  /**
   * Adds the previewed Photo. The #435 default board fills the grid, so the add is explained with room
   * fixes; the first (Switch the grid to Fine) adds it as the same single draft edit.
   */
  async function addPhoto() {
    await button('Add Photo').click();
    await page.locator('.studio-savebar, .widget-picker .room-fix').first().waitFor();
    const fix = page.locator('.widget-picker .room-fix').first();
    if (await fix.count()) { assert.equal(await fix.innerText(), 'Switch the grid to Fine'); await fix.scrollIntoViewIfNeeded(); await fix.click(); }
    await button('Save changes').waitFor();
  }
  async function inView(locator, label) {
    const box = await locator.boundingBox(); const viewport = page.viewportSize();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${label} must fit the viewport: ${JSON.stringify(box)}`);
  }
  const frame = () => page.locator('.preview-frame').boundingBox();
  const overlaps = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
  const focusedName = () => page.evaluate(() => { const element = document.activeElement; return !element || element === document.body ? 'BODY' : element.getAttribute('aria-label') || element.textContent.trim(); });
  const NETWORK = "Can't reach the display server on this computer. Your changes are kept — try again.";
  // #227: an alert has its own row; every canvas action stays visible and clickable beside it.
  async function alertClear(viewport, label) {
    const alert = page.locator('.studio-error'); await alert.waitFor();
    for (const control of await page.locator('.canvas-heading-actions button, .canvas-toolbar button, .canvas-toolbar select').all()) {
      await control.scrollIntoViewIfNeeded();
      const name = await control.evaluate(element => element.getAttribute('aria-label') || element.textContent.trim());
      const box = await control.boundingBox(), alertBox = await alert.boundingBox();
      assert.ok(!overlaps(box, alertBox), `${label}: the alert must not overlap ${name}: ${JSON.stringify({ box, alertBox })}`);
      assert.equal(await control.evaluate(element => { const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return element === hit || element.contains(hit); }), true, `${label}: ${name} must be the topmost element at its centre`);
    }
    if (viewport.width > 700) {
      const alertBox = await alert.boundingBox(), aside = await page.locator('.inspector').boundingBox(), toolbar = await page.locator('.canvas-toolbar').boundingBox();
      assert.ok(!overlaps(alertBox, aside), `${label}: the alert stays out of the inspector`);
      assert.ok(alertBox.y >= toolbar.y + toolbar.height - 0.5, `${label}: the alert row sits below the canvas actions`);
      await inView(alert, `${label} alert`);
      const bar = page.locator('.studio-savebar');
      if (await bar.count()) assert.ok(!overlaps(alertBox, await bar.boundingBox()), `${label}: the alert stays clear of the Save bar`);
    }
  }
  async function alertRows(viewport) {
    // A storage warning: actions stay clickable, and a dismissed warning stays hidden through polls.
    await page.route('**/api/state', async route => { const response = await route.fetch(); await route.fulfill({ response, json: { ...(await response.json()), storageWarning: 'Synthetic storage warning' } }); });
    await page.reload(); await page.getByRole('alert').filter({ hasText: 'Synthetic storage warning' }).waitFor();
    await alertClear(viewport, `${viewport.width}x${viewport.height} storage warning`);
    await button('Preview movement').click();
    assert.equal(await button('Back to layout').getAttribute('aria-pressed'), 'true', 'Preview movement is clickable while an alert shows');
    await alertClear(viewport, `${viewport.width}x${viewport.height} storage warning with arrangements`);
    await button('Back to layout').click();
    if (capture && viewport.width === 1280 && viewport.height === 720) images.push({ name: 'alert-1280x720', bytes: await page.screenshot() });
    await button('Dismiss message').click(); await page.locator('.studio-error').waitFor({ state: 'detached' });
    assert.notEqual(await focusedName(), 'BODY', 'dismissing keeps keyboard focus on the page');
    await page.clock.runFor(30_000); await page.waitForTimeout(100);
    assert.equal(await page.locator('.studio-error').count(), 0, 'a dismissed warning stays hidden after the next poll');
    await page.unroute('**/api/state');
    // A lost connection: the clear message and Retry, which clears it once the server answers.
    await page.route('**/api/state', route => route.abort());
    await page.clock.runFor(30_000);
    await page.getByRole('alert').filter({ hasText: NETWORK }).waitFor();
    await alertClear(viewport, `${viewport.width}x${viewport.height} connection loss`);
    await page.unroute('**/api/state');
    await button('Retry').click(); await page.locator('.studio-error').waitFor({ state: 'detached' });
    // A rejected photo, with the Save bar showing for the added Photo widget.
    await tab('Widgets'); await button('Add widget').click(); await button('Preview Photo').click();
    if (viewport.width <= 700) await button('Photo large').click();
    await button('Add Photo').scrollIntoViewIfNeeded(); await addPhoto();
    await page.getByLabel('Choose local photo').setInputFiles({ name: 'bad.png', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    await page.getByRole('alert').filter({ hasText: 'Choose a JPEG, PNG or WebP image' }).waitFor();
    await alertClear(viewport, `${viewport.width}x${viewport.height} rejected photo`);
    // Adding a widget opened Edit layout; leaving it is the next successful action, which clears the error.
    await button('Done').click(); await page.locator('.studio-error').waitFor({ state: 'detached' });
    await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
  }
  // #231: the weather note under the canvas is never covered by the Save bar.
  async function weatherNoteClear(viewport) {
    await tab('Weather'); const input = page.getByRole('combobox', { name: 'City', exact: true });
    await input.fill('London'); await page.getByRole('option', { name: /London/ }).first().click();
    const note = page.locator('.canvas-note'); await note.waitFor(); await button('Save changes').waitFor();
    assert.match(await note.innerText(), /Weather updates after Save · preview still shows/);
    const covered = await note.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element); const misses = [];
      for (const rect of range.getClientRects()) for (let step = 0; step <= 16; step++) {
        const x = rect.left + 1 + (rect.width - 2) * step / 16, y = rect.top + rect.height / 2, hit = document.elementFromPoint(x, y);
        if (!(hit === element || element.contains(hit))) misses.push([Math.round(x), Math.round(y), hit?.className]);
      }
      return misses;
    });
    assert.deepEqual(covered, [], `${viewport.width}x${viewport.height}: the weather note must not be covered`);
    const noteBox = await note.boundingBox(), bar = await page.locator('.studio-savebar').boundingBox();
    assert.ok(!overlaps(noteBox, bar), 'the note box stays clear of the Save bar');
    if (capture && viewport.height === 720) images.push({ name: 'weather-note-1280x720', bytes: await page.screenshot() });
    await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
  }
  // #229: Save, Cancel and Remove widget never drop keyboard focus to the page.
  async function keyboardFocus() {
    const announcer = page.locator('.save-announcer');
    assert.equal(await announcer.getAttribute('role'), 'status');
    await tab('Style'); const slider = page.getByRole('slider', { name: 'Brightness', exact: true });
    await slider.focus(); await page.keyboard.press('ArrowRight');
    await button('Save changes').focus(); await page.keyboard.press('Enter');
    await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    assert.equal(await focusedName(), 'Brightness', 'Save returns focus to the last edited control');
    assert.equal((await announcer.textContent()).trim(), 'Changes saved');
    await page.keyboard.press('ArrowRight'); await button('Cancel').focus(); await page.keyboard.press('Enter');
    await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    assert.equal(await focusedName(), 'Brightness', 'Cancel returns focus to the last edited control');
    assert.equal((await announcer.textContent()).trim(), 'Changes discarded');
    // The edited control is gone (another tab): focus the active tab instead.
    await tab('Widgets'); await button('Clock').click(); await button('Digital').click(); await tab('Style');
    await button('Cancel').focus(); await page.keyboard.press('Enter'); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'tab-Style', 'Cancel falls back to the active tab');
    // Remove widget: the next row, else the previous one, else Add widget.
    await tab('Widgets');
    const rows = async () => page.locator('.widget-list .widget-select').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
    const initial = await rows(); assert.ok(initial.length >= 3, 'the default board lists several widgets');
    await button(`Remove ${initial[0]}`).focus(); await page.keyboard.press('Enter');
    assert.equal(await focusedName(), initial[1], 'focus moves to the next row');
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    assert.deepEqual(await rows(), initial.slice(1), 'Enter on the focused row only expands and collapses it');
    await button(`Remove ${initial.at(-1)}`).focus(); await page.keyboard.press('Enter');
    assert.equal(await focusedName(), initial.at(-2), 'removing the last row focuses the previous one');
    for (const name of initial.slice(1, -1)) { await button(`Remove ${name}`).focus(); await page.keyboard.press('Enter'); }
    assert.deepEqual(await rows(), []); assert.equal(await focusedName(), 'Add widget', 'with no rows left focus moves to Add widget');
    await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
  }
  const familyActions = ACTIVE_WIDGET_IDS.reduce((total, id) => total + widgetSizes(id).length, 0);
  try {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1280, height: 600 }, { width: 1024, height: 600 }, { width: 760, height: 600 }]) {
      await open(viewport);
      const before = await frame();
      for (const name of ['Style', 'Widgets', 'Weather', 'Reminders']) {
        await tab(name);
        assert.equal(await page.evaluate(() => `${document.documentElement.scrollWidth},${document.documentElement.scrollHeight}`), `${viewport.width},${viewport.height}`, `desktop ${name} must use contained scrolling`);
        await inView(button('Edit layout'), 'Edit layout');
        await inView(button('Add widget to display'), 'Canvas plus');
      }
      await tab('Widgets'); await button('Clock').click(); await button('Digital').click(); await button('Save changes').waitFor();
      assert.deepEqual(await frame(), before, 'dirty bar must not change canvas geometry');
      await inView(button('Cancel'), 'Cancel'); await inView(button('Save changes'), 'Save');
      if (viewport.width > 1050) { const bar = await page.locator('.studio-savebar').boundingBox(), aside = await page.locator('.inspector').boundingBox(); assert.ok(bar.x + bar.width <= aside.x, 'wide Save bar must stay clear of the full-height inspector'); }
      assert.equal(await page.locator('.widget-position-control').count(), 0);
      await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
      await button('Edit layout').click(); await inView(page.getByRole('combobox', { name: 'Grid density' }), 'Density');
      await button('Move Weather').focus();
      assert.equal(await page.getByRole('button', { name: /^Resize / }).count(), 1, 'only the selected/focused widget exposes a resize handle');
      await page.keyboard.press('Tab'); assert.equal(await button('Resize Weather').evaluate(element => element === document.activeElement), true, 'keyboard users can reach the selected resize handle');
      await button('Done').click();
      await button('Add widget').click();
      const panel = await page.locator('.inspector-panel').evaluate(element => [element.clientHeight, element.scrollHeight]);
      assert.ok(panel[1] <= panel[0] + 1, 'catalog and Add must fit the contained panel');
      for (const id of ACTIVE_WIDGET_IDS) {
        const name = WIDGET_CATALOG[id].name;
        await page.getByRole('button', { name: new RegExp(`^Preview ${name}(, on your display)?$`) }).focus(); await page.keyboard.press('Enter');
        await inView(button(`Add ${name}`), `${name} Add`);
        for (const size of widgetSizes(id)) { await button(`${name} ${size}`).click(); await inView(button(`Add ${name}`), `${name}/${size} Add`); }
      }
      assert.doesNotMatch(await page.locator('.widget-picker').innerText(), /Private reminder sentinel|Toronto/);
      if (capture) images.push({ name: `picker-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
      await page.keyboard.press('Escape'); assert.equal(await page.locator('.widget-picker').count(), 0); assert.equal(await button('Add widget').evaluate(element => element === document.activeElement), true);
      await tab('Weather'); const input = page.getByRole('combobox', { name: 'City', exact: true }); await input.focus(); await input.fill('unsaved');
      await tab('Style'); await page.getByRole('slider', { name: 'Brightness', exact: true }).focus(); await page.keyboard.press('ArrowRight'); await tab('Weather'); await input.focus();
      const field = await input.boundingBox(), savebar = await page.locator('.studio-savebar').boundingBox();
      assert.ok(field.y >= 0 && field.y + field.height < savebar.y, 'focused desktop field must clear Save');
      await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
      if (viewport.width === 1280) await weatherNoteClear(viewport);
      if (viewport.width === 1280 && viewport.height === 720) await keyboardFocus();
      await alertRows(viewport);
      checks.push(`${viewport.width}x${viewport.height}: bounded tabs/canvas/actions, stable dirty geometry, all ${familyActions} family catalog actions, keyboard close/focus return and Save clearance${viewport.width > 1050 ? ', wide Save bar beside the inspector' : ''}; storage, connection and photo alerts in their own row clear of every canvas action, dismiss and recovery${viewport.width === 1280 ? ', weather note clear of Save' : ''}${viewport.width === 1280 && viewport.height === 720 ? ', keyboard focus after Save/Cancel/Remove with announcements' : ''}`);
    }
    for (const viewport of [{ width: 390, height: 700 }, { width: 390, height: 480 }, { width: 640, height: 300 }]) {
      await open(viewport);
      for (const name of ['Widgets', 'Style', 'Weather', 'Reminders']) { await tab(name); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow/200% equivalent must not scroll horizontally'); }
      await tab('Widgets'); await button('Add widget').click(); await button('Preview Photo').click(); await button('Photo large').click(); await button('Add Photo').scrollIntoViewIfNeeded(); await inView(button('Add Photo'), 'Mobile Add');
      if (capture) images.push({ name: `picker-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
      await addPhoto();
      const upload = page.locator('.photo-upload-control'); await upload.scrollIntoViewIfNeeded();
      const icon = await upload.locator('svg').boundingBox(); assert.ok(icon.width === 16 && icon.height === 16, 'upload icon keeps explicit geometry');
      await tab('Weather'); const input = page.getByRole('combobox', { name: 'City', exact: true }); await input.focus();
      const field = await input.boundingBox(), bar = await page.locator('.studio-savebar').boundingBox(); assert.ok(field.y >= 0 && field.y + field.height < bar.y, 'focused narrow field must clear Save');
      await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
      await alertRows(viewport);
      checks.push(`${viewport.width}x${viewport.height}: narrow/200% equivalent reflow, reachable picker/Add, fixed photo icon, focus clear of dirty Save, alerts clear of every canvas action`);
    }
    assert.deepEqual(errors, []); return { checks, images };
  } finally { await context?.close(); await browser.close(); await new Promise(resolve => app.server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}
if (typeof process !== 'undefined' && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runWorkspaceQa(values); console.log(JSON.stringify({ checks: result.checks }, null, 2));
}
