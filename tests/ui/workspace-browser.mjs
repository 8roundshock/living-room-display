import { mockWindowsStatus } from './lib/windows-fixture.mjs';
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
  async function open(viewport, reducedMotion = 'reduce', settings = defaultSettings(), options = {}) {
    await context?.close();
    await app.store.update(data => { data.settings = structuredClone(settings); data.reminders = [{ id: '11111111-1111-4111-8111-111111111111', text: 'Private reminder sentinel', completed: false, dueAt: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }]; });
    context = await browser.newContext({ viewport, reducedMotion, timezoneId: 'America/Toronto', ...options }); await mockWindowsStatus(context);
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
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${viewport.width}x${viewport.height}: ${label} must fit the viewport: ${JSON.stringify(box)}`);
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
      // The controlled clock must run the scroll handler's animation frame before geometry checks.
      await page.clock.runFor(32);
      const name = await control.evaluate(element => element.getAttribute('aria-label') || element.textContent.trim());
      const box = await control.boundingBox(), alertBox = await alert.boundingBox();
      if (viewport.width <= 700 && viewport.height > 360 && await alert.evaluate(element => element.classList.contains('studio-error-action'))) {
        assert.equal(await alert.evaluate(element => element.classList.contains('studio-error-floating')), false, `${label}: a visible canvas action keeps the error in its reserved row`);
      }
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
    await page.goto(base + '/settings'); const input = page.getByRole('combobox', { name: 'City', exact: true });
    await input.fill('London'); await page.getByRole('option', { name: /London/ }).first().click();
    const note = page.locator('.current-location'); await note.waitFor(); await button('Save changes').waitFor();
    assert.match(await note.innerText(), /London[\s\S]*Draft/);
    const covered = await note.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element); const misses = [];
      for (const rect of range.getClientRects()) for (let step = 0; step <= 16; step++) {
        const x = rect.left + 1 + (rect.width - 2) * step / 16, y = rect.top + rect.height / 2, hit = document.elementFromPoint(x, y);
        if (!(hit === element || element.contains(hit))) misses.push([Math.round(x), Math.round(y), hit?.className]);
      }
      return misses;
    });
    assert.deepEqual(covered, [], `${viewport.width}x${viewport.height}: the weather note must not be covered`);
    const noteBox = await note.boundingBox(), bar = await page.locator('.settings-savebar').boundingBox();
    assert.ok(!overlaps(noteBox, bar), 'the note box stays clear of the Save bar');
    if (capture && viewport.height === 720) images.push({ name: 'weather-note-1280x720', bytes: await page.screenshot() });
    await button('Cancel').click(); await page.locator('.settings-savebar').waitFor({ state: 'detached' });
    await page.goto(base + '/editor'); await button('Edit layout').waitFor();
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
    // #311: the layout status region is mounted, empty, before the first removal, which it then announces;
    // no other live region repeats it, and the visible copy stays in the list.
    const layoutAnnouncer = page.locator('.layout-announcer');
    assert.equal(await layoutAnnouncer.getAttribute('role'), 'status');
    assert.equal(await layoutAnnouncer.textContent(), '', 'mounted and empty before the first removal');
    assert.equal(initial[0], 'Clock');
    await button(`Remove ${initial[0]}`).focus(); await page.keyboard.press('Enter');
    assert.equal(await layoutAnnouncer.textContent(), 'Clock removed');
    assert.equal(await page.locator('[role="status"], [role="alert"], [aria-live]').evaluateAll(nodes => nodes.filter(node => node.textContent.includes('Clock removed')).length), 1, 'no second live region repeats it');
    assert.equal(await page.locator('.widget-list .inline-message').textContent(), 'Clock removed', 'shown in the list as before');
    assert.equal(await focusedName(), initial[1], 'focus moves to the next row');
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    assert.deepEqual(await rows(), initial.slice(1), 'Enter on the focused row only expands and collapses it');
    await button(`Remove ${initial.at(-1)}`).focus(); await page.keyboard.press('Enter');
    assert.equal(await focusedName(), initial.at(-2), 'removing the last row focuses the previous one');
    for (const name of initial.slice(1, -1)) { await button(`Remove ${name}`).focus(); await page.keyboard.press('Enter'); }
    assert.deepEqual(await rows(), []); assert.equal(await focusedName(), 'Add widget', 'with no rows left focus moves to Add widget');
    await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
  }
  /** Every active widget on one Balanced board, every cell used (as in the palette and motion suites). */
  const FULL_BOARD = {
    clock: { column: 0, row: 0, size: 'medium' }, worldClocks: { column: 4, row: 0, size: 'medium' }, weather: { column: 8, row: 0, size: 'large' },
    sunMoon: { column: 0, row: 2, size: 'large' }, calendar: { column: 4, row: 2, size: 'medium' }, airQuality: { column: 4, row: 4, size: 'medium' },
    reminders: { column: 8, row: 4, size: 'medium' }, forecast: { column: 0, row: 6, size: 'medium' }, countdown: { column: 4, row: 6, size: 'small' },
    note: { column: 6, row: 6, size: 'small' }, preview: { column: 8, row: 6, size: 'small' }, photo: { column: 10, row: 6, size: 'small' },
  };
  function fullBoard() {
    const settings = defaultSettings();
    for (const id of Object.keys(settings.widgets)) settings.widgets[id] = id in FULL_BOARD;
    settings.preview.enabled = true; Object.assign(settings.widgetGrid.placements, structuredClone(FULL_BOARD));
    return settings;
  }
  // #365: the picker's groups, catalog order inside each.
  const GROUPED = ['Clock', 'World clocks', 'Calendar', 'Weather', 'Forecast', 'Air quality', 'Sun & moon', 'Reminders', 'Countdown', 'Note', 'Last screen', 'Photo'];
  const listRows = () => page.locator('.widget-list .widget-select').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
  /** The box of an element's 44 × 44 hit area: elementFromPoint at its corners and centre must be the element. */
  async function hitArea(locator, label) {
    const result = await locator.evaluate(element => {
      const box = element.getBoundingClientRect(), before = getComputedStyle(element, '::before');
      // A transparent absolute ::before extends the hit area; its offsets are from the padding box.
      const hit = before.content === 'none' || before.position !== 'absolute' ? box : {
        left: box.left + element.clientLeft + parseFloat(before.left), top: box.top + element.clientTop + parseFloat(before.top),
        width: parseFloat(before.width), height: parseFloat(before.height),
      };
      const points = [[1, 1], [hit.width - 1, 1], [1, hit.height - 1], [hit.width - 1, hit.height - 1], [hit.width / 2, hit.height / 2]];
      const misses = points.map(([x, y]) => [hit.left + x, hit.top + y]).filter(([x, y]) => { const target = document.elementFromPoint(x, y); return !(target === element || element.contains(target)); });
      return { visual: [Math.round(box.width), Math.round(box.height)], hit: [hit.width, hit.height], misses: misses.map(point => point.map(Math.round)) };
    });
    assert.ok(result.hit[0] >= 44 && result.hit[1] >= 44, `${label}: hit area at least 44 × 44: ${JSON.stringify(result)}`);
    assert.deepEqual(result.misses, [], `${label}: every corner of the hit area reaches it: ${JSON.stringify(result)}`);
    return result;
  }
  /** #339, #345, #349 and #365 on the full board at one viewport. */
  async function layoutEditing(viewport) {
    const label = `${viewport.width}x${viewport.height}`, stacked = viewport.width <= 700;
    await open(viewport, 'reduce', fullBoard());
    if (viewport.width === 1280) assert.deepEqual(await listRows(), GROUPED, 'the list follows the picker groups (#365)');
    await button('Edit layout').click();
    // Layout directions are available on demand without occupying the message line.
    const hint = button('About editing the layout');
    await inView(hint, label + ' layout help');
    await hint.focus();
    assert.match(await page.getByRole('tooltip').innerText(), /Drag a widget to move it or its corner to resize/);
    await page.keyboard.press('Escape');
    await inView(page.locator('.grid-density-label'), `${label} Grid label`);
    assert.equal(await page.locator('.grid-density-label').innerText(), 'Grid');
    if (!stacked) assert.equal(await page.evaluate(() => `${document.documentElement.scrollWidth},${document.documentElement.scrollHeight}`), `${viewport.width},${viewport.height}`, `${label}: Edit layout keeps the bounded workspace`);
    // #339: selecting each widget on the canvas brings its settings' first control fully into view.
    for (const name of GROUPED) {
      await button(`Move ${name}`).click();
      const control = page.locator('.widget-option.selected .widget-inspector').locator('button, input, select, textarea').first();
      await control.waitFor();
      const box = await control.boundingBox(), area = stacked ? { x: 0, y: 0, width: viewport.width, height: viewport.height } : await page.locator('.inspector-panel').boundingBox();
      assert.ok(box.y >= area.y - 0.5 && box.y + box.height <= area.y + area.height + 0.5 && box.y >= 0 && box.y + box.height <= viewport.height,
        `${label}: ${name}'s first control is fully visible after selecting it on the canvas: ${JSON.stringify({ box, area })}`);
      assert.equal(await focusedName(), `Move ${name}`, 'selecting never moves focus away from the canvas');
    }
    // A list row click does the same.
    await button(GROUPED[0]).click();
    const first = page.locator('.widget-option.selected .widget-inspector').locator('button').first();
    const firstBox = await first.boundingBox();
    assert.ok(firstBox.y >= 0 && firstBox.y + firstBox.height <= viewport.height, `${label}: a list row's settings come into view`);
    // Layout messages remain visible while help stays available in the toolbar.
    await button('Move Note').focus(); await page.keyboard.press('ArrowUp');
    assert.equal(await hint.count(), 1, 'layout help stays available beside the message');
    assert.match(await page.locator('.grid-status').innerText(), /^No room above$|^Note moved to column \d+, row \d+/);
    // #349: the canvas resize handle keeps its look but takes a 44 × 44 hit area, also at the canvas edge.
    await button('Move Calendar').focus();
    const handle = await hitArea(page.getByRole('button', { name: 'Resize Calendar', exact: true }), `${label} resize handle`);
    assert.deepEqual(handle.visual, viewport.width <= 480 ? [30, 30] : [30, 36], 'the visible handle keeps its size');
    await button('Move Photo').focus();
    await hitArea(page.getByRole('button', { name: 'Resize Photo', exact: true }), `${label} resize handle at the canvas corner`);
    // #349: the Note's Clear keeps a 44 px target.
    await button('Note').click();
    const clear = await page.getByRole('button', { name: 'Clear', exact: true }).boundingBox();
    assert.ok(clear.height >= 44 && clear.width >= 44, `${label}: Note Clear is 44 px: ${JSON.stringify(clear)}`);
    if (capture) images.push({ name: `layout-${label}`, bytes: await page.screenshot() });
    // #365: removal focus follows the grouped order: after Calendar comes Weather.
    if (viewport.width === 1280) {
      await button('Remove Calendar').focus(); await page.keyboard.press('Enter');
      assert.equal(await focusedName(), 'Weather', 'removal focus follows the grouped order');
    }
    if (await page.locator('.studio-savebar').count()) { await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' }); }
    checks.push(`${label} full board: Edit layout how-to and visible Grid label (#345); each canvas selection brings the inspector's first control into view without moving focus, and a list row too (#339); layout help stays available beside messages; the resize handle keeps its ${handle.visual.join(' × ')} look with a 44 × 44 hit area, also at the canvas corner, and Note Clear is 44 px (#349)${viewport.width === 1280 ? '; the list follows the picker groups and removal focus follows that order (#365)' : ''}`);
  }
  /**
   * The focused element is fully visible: inside the viewport, inside the inspector panel's visible
   * box when it is in the panel (desktop scrolls the panel), and clear of the Save bar. Returns its name.
   */
  async function focusVisible(label) {
    const result = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return { name: 'BODY', visible: false };
      const box = element.getBoundingClientRect(), panel = element.closest('.inspector-panel')?.getBoundingClientRect(), bar = document.querySelector('.editor-style-bar')?.getBoundingClientRect();
      const top = Math.max(0, panel?.top ?? 0), bottom = Math.min(innerHeight, panel?.bottom ?? innerHeight);
      const covered = !!bar && box.top < bar.bottom - 0.5 && bar.top < box.bottom - 0.5 && box.left < bar.right - 0.5 && bar.left < box.right - 0.5;
      return { name: element.getAttribute('aria-label') || element.textContent.trim(), box: [box.left, box.top, box.right, box.bottom].map(Math.round), area: [Math.round(top), Math.round(bottom)],
        visible: box.top >= top - 0.5 && box.bottom <= bottom + 0.5 && box.left >= -0.5 && box.right <= innerWidth + 0.5 && !covered };
    });
    assert.ok(result.visible, `${label}: the focused ${result.name} must be fully in view: ${JSON.stringify(result)}`);
    return result.name;
  }
  /** #339 review: closing the picker leaves focus fully in view, and an old reveal never scrolls again. */
  async function pickerFocus(viewport) {
    const label = `${viewport.width}x${viewport.height}`, picker = () => page.locator('.widget-picker');
    await open(viewport, 'reduce', fullBoard());
    // Escape with the last row selected: focus returns to Add widget, which no replayed scroll hides.
    await button('Photo').click();
    await button('Add widget').focus(); await page.keyboard.press('Enter'); await picker().waitFor();
    await page.keyboard.press('Escape'); await picker().waitFor({ state: 'detached' });
    assert.equal(await focusVisible(`${label} Escape from the picker`), 'Add widget');
    if (capture) images.push({ name: `picker-escape-${label}`, bytes: await page.screenshot() });
    // A keyboard add: focus moves to the new widget's row, in view with its settings and clear of the
    // Save bar (Last screen stays removed, so the draft differs from the saved board).
    for (const name of ['Last screen', 'Photo']) { await button(`Remove ${name}`).focus(); await page.keyboard.press('Enter'); }
    await button('Add widget').focus(); await page.keyboard.press('Enter'); await picker().waitFor();
    await button('Preview Photo').focus(); await page.keyboard.press('Enter');
    await button('Photo small').focus(); await page.keyboard.press('Enter');
    await button('Add Photo').focus(); await page.keyboard.press('Enter'); await picker().waitFor({ state: 'detached' });
    assert.equal(await focusVisible(`${label} keyboard add`), 'Photo');
    assert.equal(await page.locator('.widget-option.selected').getAttribute('data-widget-option'), 'photo', 'the added widget is selected');
    const control = await page.locator('.widget-option.selected .widget-inspector').locator('button, input, select, textarea').first().boundingBox();
    const area = viewport.width <= 700 ? { y: 0, height: viewport.height } : await page.locator('.inspector-panel').boundingBox();
    assert.ok(control.y >= Math.max(0, area.y) - 0.5 && control.y + control.height <= Math.min(viewport.height, area.y + area.height) + 0.5,
      `${label}: the added widget's first control is in view too: ${JSON.stringify({ control, area })}`);
    if (capture) images.push({ name: `picker-add-${label}`, bytes: await page.screenshot() });
    // A canvas widget focused while the picker is open selects it and closes the picker; focus stays on the canvas.
    await button('Add widget').focus(); await page.keyboard.press('Enter'); await picker().waitFor();
    await button('Move Clock').focus(); await picker().waitFor({ state: 'detached' });
    assert.equal(await focusVisible(`${label} canvas focus with the picker open`), 'Move Clock');
    // Coming back to the Widgets tab does not scroll to an earlier selection again.
    await button('Photo').click();
    const scroll = () => page.evaluate(() => [Math.round(scrollY), Math.round(document.querySelector('.inspector-panel').scrollTop)]);
    await page.evaluate(() => document.getElementById('tab-Style').click());
    await page.evaluate(() => { scrollTo(0, 0); document.querySelector('.inspector-panel').scrollTop = 0; });
    await page.evaluate(() => document.getElementById('tab-Widgets').click());
    await page.locator('.widget-option.selected[data-widget-option="photo"]').waitFor(); await page.waitForTimeout(100);
    assert.deepEqual(await scroll(), [0, 0], `${label}: returning to the Widgets tab keeps the page and panel where they were`);
    await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    checks.push(`${label} full board: after Escape from the picker with the last row selected, Add widget has focus fully in view; after a keyboard add the new row has focus fully in view; a canvas widget focused with the picker open keeps focus; returning to the Widgets tab replays no scroll (#339)`);
  }
  /** #349: on a coarse pointer the size families are 44 px tall. */
  async function coarseTargets() {
    await open({ width: 390, height: 844 }, 'reduce', defaultSettings(), { hasTouch: true });
    await tab('Widgets'); await button('Clock').click();
    const sizes = await page.locator('.widget-option.selected .size-options .button').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    assert.ok(sizes.length === 3 && sizes.every(height => height >= 44), `coarse-pointer size families are 44 px: ${sizes}`);
    checks.push('390x844 with a coarse pointer: size family buttons are 44 px tall (#349)');
  }
  const WIDGET_ID = Object.fromEntries(ACTIVE_WIDGET_IDS.map(id => [WIDGET_CATALOG[id].name, id]));
  /**
   * #339 review: on a stacked touch layout a canvas tap selects the tapped widget and nothing else.
   * The tap's click is hit-tested where the finger was, after the release, so the page may scroll to
   * the settings only once that click has gone to the canvas. With an instant scroll (reduced motion
   * or animation Off) an earlier scroll sent it to whatever list control moved under the finger:
   * another widget's row, a Remove button or a tab. A mouse click() cannot show this.
   */
  async function canvasTaps(viewport, reducedMotion, settings, how) {
    const label = `${viewport.width}x${viewport.height} ${how}`;
    await open(viewport, reducedMotion, settings, { hasTouch: true });
    await button('Edit layout').tap(); await page.locator('.grid-editor').waitFor();
    for (const name of GROUPED) {
      const id = WIDGET_ID[name];
      // From the top of the page, where the canvas is: the reveal then has to scroll the page.
      await page.evaluate(() => scrollTo(0, 0));
      await button(`Move ${name}`).tap();
      // The page scrolls to the tapped widget's settings once its click has gone to the canvas.
      const option = `.widget-option[data-widget-option="${id}"]`;
      await page.waitForFunction(selector => {
        const control = document.querySelector(`${selector}.selected .widget-inspector`)?.querySelector('button, input, select, textarea');
        const box = control?.getBoundingClientRect();
        return !!box && box.top >= -0.5 && box.bottom <= innerHeight + 0.5;
      }, option, { timeout: 5000 }).catch(() => {});
      // Let any later click land before looking at what changed.
      await page.waitForTimeout(250);
      const state = await page.evaluate(() => ({
        selected: document.querySelector('.widget-option.selected')?.getAttribute('data-widget-option') ?? null,
        frame: document.querySelector('.grid-widget-frame.selected')?.getAttribute('data-frame-id') ?? null,
        tab: document.querySelector('.inspector-tabs [role="tab"][aria-selected="true"]')?.id ?? null,
        rows: document.querySelectorAll('.widget-list .widget-select').length,
        savebar: !!document.querySelector('.studio-savebar'),
        scrollY: Math.round(scrollY),
      }));
      const { scrollY, ...result } = state;
      assert.deepEqual(result, { selected: id, frame: id, tab: 'tab-Widgets', rows: GROUPED.length, savebar: false },
        `${label}: tapping ${name} on the canvas selects it and changes nothing else (scrollY ${scrollY})`);
      assert.equal(await focusedName(), `Move ${name}`, `${label}: focus stays on the tapped widget`);
      const control = await page.locator(`${option} .widget-inspector`).locator('button, input, select, textarea').first().boundingBox();
      assert.ok(control.y >= -0.5 && control.y + control.height <= viewport.height + 0.5, `${label}: ${name}'s first control comes into view after the tap: ${JSON.stringify({ control, scrollY })}`);
    }
    checks.push(`${label} full board with touch: tapping each of the ${GROUPED.length} widgets on the canvas selects that widget, scrolls its first control into view and changes nothing else (no other selection, removal, Save bar or tab switch); focus stays on the tapped widget (#339 review)`);
  }
  const familyActions = ACTIVE_WIDGET_IDS.reduce((total, id) => total + widgetSizes(id).length, 0);
  try {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1280, height: 600 }, { width: 1024, height: 600 }, { width: 760, height: 600 }]) {
      await open(viewport);
      const before = await frame();
      // #438: the shared header keeps its 64 px height, and the canvas starts below it as before.
      const header = await page.locator('.studio-header').boundingBox();
      assert.equal(header.height, 64, `${viewport.width}x${viewport.height}: the header keeps 64 px`);
      assert.ok(before.y >= header.y + header.height, 'the canvas starts below the header');
      assert.equal(await page.getByRole('navigation', { name: 'Pages' }).getByRole('link').count(), 3, 'Home, Edit display and Settings links');
      for (const name of ['Style', 'Widgets']) {
        await tab(name);
        assert.equal(await page.evaluate(() => `${document.documentElement.scrollWidth},${document.documentElement.scrollHeight}`), `${viewport.width},${viewport.height}`, `desktop ${name} must use contained scrolling`);
        await inView(button('Edit layout'), 'Edit layout');
        await inView(button('Add widget to display'), 'Canvas plus');
      }
      await tab('Widgets'); await button('Clock').click(); await button('Digital').click(); await button('Save changes').waitFor();
      assert.deepEqual(await frame(), before, 'dirty bar must not change canvas geometry');
      await inView(button('Cancel'), 'Cancel'); await inView(button('Save changes'), 'Save');
      const bar = await page.locator('.studio-savebar').boundingBox(), styleBar = await page.locator('.editor-style-bar').boundingBox(), aside = await page.locator('.inspector').boundingBox();
      assert.equal(await page.locator('.studio-savebar').count(), 1, 'one Save group serves the editor');
      assert.ok(bar.y >= styleBar.y && bar.y + bar.height <= styleBar.y + styleBar.height + 0.5, 'Save stays in the top Style toolbar');
      assert.ok(!overlaps(bar, aside), 'top Save stays clear of the inspector');
      assert.equal(await page.locator('.widget-position-control').count(), 0);
      await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
      await button('Edit layout').click(); await inView(page.getByRole('combobox', { name: 'Grid density' }), 'Density');
      await inView(button('About editing the layout'), 'Edit layout how-to (#345)');
      assert.equal(await page.evaluate(() => `${document.documentElement.scrollWidth},${document.documentElement.scrollHeight}`), `${viewport.width},${viewport.height}`, 'Edit layout stays within the height budget');
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
      if (viewport.width === 760 && viewport.height === 600) {
        const detail = page.locator('.picker-detail-content');
        const reminders = page.getByRole('button', { name: /^Preview Reminders(, on your display)?$/ });
        const clock = page.getByRole('button', { name: /^Preview Clock(, on your display)?$/ });
        await reminders.click(); await button('Reminders large').click();
        const scrolled = await detail.evaluate(element => {
          element.scrollTop = element.scrollHeight;
          return { top: element.scrollTop, height: element.clientHeight, content: element.scrollHeight };
        });
        assert.ok(scrolled.top > 0, `760x600: the long Reminders preview exercises the detail scroller: ${JSON.stringify(scrolled)}`);
        await clock.focus(); await page.keyboard.press('Enter');
        assert.equal(await detail.evaluate(element => element.scrollTop), 0, 'changing widgets starts the new detail at its heading');
        assert.equal(await clock.evaluate(element => element === document.activeElement), true, 'resetting the detail scroll keeps keyboard focus in the catalog');
        await button('Clock small').click();
        assert.equal(await button('Clock small').getAttribute('aria-pressed'), 'true', 'size controls still select a family after the scroller reset');
        await inView(button('Add Clock'), 'Clock Add after changing its size');
        await reminders.click();
        assert.equal(await button('Reminders large').getAttribute('aria-pressed'), 'true', 'switching widgets retains each previewed size choice');
        assert.equal(await detail.evaluate(element => element.scrollTop), 0, 'returning to the long preview also starts at its heading');
        assert.equal(await page.locator('.studio-savebar').count(), 0, 'preview scrolling, selection and size choices do not edit the display');
        checks.push('760x600: a scrolled long picker sample resets to its heading on widget selection without moving catalog focus, while size selection and per-widget size memory stay intact and the display stays unchanged');
      }
      assert.doesNotMatch(await page.locator('.widget-picker').innerText(), /Private reminder sentinel|Toronto/);
      if (capture) images.push({ name: `picker-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
      await page.keyboard.press('Escape'); assert.equal(await page.locator('.widget-picker').count(), 0); assert.equal(await focusVisible(`${viewport.width}x${viewport.height} Escape from the picker`), 'Add widget');
      await tab('Style'); const input = page.getByRole('slider', { name: 'Brightness', exact: true }); await input.focus(); await page.keyboard.press('ArrowRight');
      const field = await input.boundingBox(), savebar = await page.locator('.studio-savebar').boundingBox();
      assert.ok(field.y >= savebar.y + savebar.height && field.y + field.height <= viewport.height, 'focused desktop field stays below top Save and within the viewport');
      await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
      if (viewport.width === 1280) await weatherNoteClear(viewport);
      if (viewport.width === 1280 && viewport.height === 720) await keyboardFocus();
      await alertRows(viewport);
      checks.push(`${viewport.width}x${viewport.height}: bounded tabs/canvas/actions, stable dirty geometry, all ${familyActions} family catalog actions, keyboard close/focus return and one Save group inside the top Style toolbar clear of the inspector; storage, connection and photo alerts in their own row clear of every canvas action, dismiss and recovery${viewport.width === 1280 ? ', weather note clear of Save' : ''}${viewport.width === 1280 && viewport.height === 720 ? ', keyboard focus after Save/Cancel/Remove with announcements' : ''}`);
    }
    for (const viewport of [{ width: 390, height: 700 }, { width: 390, height: 480 }, { width: 640, height: 300 }]) {
      await open(viewport);
      // Compact help and display/page controls stay inside the responsive header.
      const header = await page.locator('.studio-header').evaluate(element => {
        const box = element.getBoundingClientRect();
        const controls = [...element.querySelectorAll('.brand, .studio-page-link, .open-display, .close-display, .context-help')].filter(control => control.checkVisibility()).map(control => {
          const rect = control.getBoundingClientRect();
          return { name: control.getAttribute('aria-label') ?? control.textContent.trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
        });
        return { top: box.top, bottom: box.bottom, controls };
      });
      for (const control of header.controls) {
        assert.ok(control.width >= 44 && control.height >= 44, control.name + ': 44 px header target');
        assert.ok(control.left >= 0 && control.right <= viewport.width, control.name + ': inside viewport');
        assert.ok(control.top >= header.top && control.bottom <= header.bottom, control.name + ': inside header');
      }
      if (viewport.width <= 480) {
        assert.deepEqual(await page.getByRole('navigation', { name: 'Pages' }).getByRole('link').allInnerTexts(), ['Home', 'Edit display', 'Settings']);
        assert.equal(await page.locator('.open-display-label').isVisible(), false); await inView(page.getByRole('link', { name: 'Open display' }), 'icon-only Open display');
      }
      for (const name of ['Widgets', 'Style']) { await tab(name); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow/200% equivalent must not scroll horizontally'); }
      await tab('Widgets'); await button('Add widget').click(); await button('Preview Photo').click(); await button('Photo large').click(); await button('Add Photo').scrollIntoViewIfNeeded(); await inView(button('Add Photo'), 'Mobile Add');
      if (capture) images.push({ name: `picker-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
      await addPhoto();
      const upload = page.locator('.photo-upload-control'); await upload.scrollIntoViewIfNeeded();
      const icon = await upload.locator('svg').boundingBox(); assert.ok(icon.width === 16 && icon.height === 16, 'upload icon keeps explicit geometry');
      await tab('Style'); const input = page.getByRole('slider', { name: 'Brightness', exact: true }); await input.focus();
      const field = await input.boundingBox(), bar = await page.locator('.editor-style-bar').boundingBox(); assert.ok(field.y >= bar.y + bar.height && field.y + field.height <= viewport.height, 'focused narrow field clears the sticky top Style/Save toolbar and stays in view');
      await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
      await alertRows(viewport);
      checks.push(`${viewport.width}x${viewport.height}: narrow/200% equivalent reflow, reachable picker/Add, fixed photo icon, focus clear of dirty Save, alerts clear of every canvas action`);
    }
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 390, height: 844 }]) { await layoutEditing(viewport); await pickerFocus(viewport); }
    await coarseTargets();
    const animationOff = fullBoard(); animationOff.appearance.animation = 'off';
    await canvasTaps({ width: 390, height: 844 }, 'reduce', fullBoard(), 'reduced motion');
    await canvasTaps({ width: 600, height: 900 }, 'reduce', fullBoard(), 'reduced motion');
    await canvasTaps({ width: 390, height: 844 }, 'no-preference', animationOff, 'animation Off');
    assert.deepEqual(errors, []); return { checks, images };
  } finally { await context?.close(); await browser.close(); await new Promise(resolve => app.server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}
if (typeof process !== 'undefined' && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runWorkspaceQa(values); console.log(JSON.stringify({ checks: result.checks }, null, 2));
}
