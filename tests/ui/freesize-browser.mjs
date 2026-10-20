// Free-size Reminders (#73) editing in production Edge: pointer/touch/keyboard resize, presets and
// steppers, Save/Cancel, density round trips and narrow layouts. Synthetic data, own server on port 0.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { catalogBoardDefaults, forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { resizeWidgetSpan } from '../../src/shared/widgets.ts';

// The fixtures below start from the catalog board (the default before #435), which has free cells;
// the #435 default board, which fills the grid, has its own steps.
/** Clock, Weather, Forecast and a small Reminders with free cells to its right and below. */
function roomy() {
  const settings = catalogBoardDefaults();
  settings.widgets.rain = false; settings.widgets.preview = false; settings.preview.enabled = false;
  settings.widgetGrid.placements.weather = { column: 8, row: 0, size: 'medium' };
  settings.widgetGrid.placements.reminders = { column: 8, row: 2, size: 'small' };
  settings.widgetGrid.placements.rain = { column: 8, row: 6, size: 'small' };
  return settings;
}
/**
 * Reminders in the top-right corner, with a medium Weather directly below it: a column must displace
 * Weather. (Rain is retired into Weather by #74; this is the merged form of the earlier Rain fixture.)
 */
function crowded() {
  const settings = catalogBoardDefaults();
  settings.widgets.preview = false; settings.preview.enabled = false;
  settings.widgetGrid.placements.weather = { column: 8, row: 2, size: 'medium' };
  settings.widgetGrid.placements.reminders = { column: 10, row: 0, size: 'small' };
  return settings;
}
/**
 * The catalog board with Last screen off and a medium Weather: its post-#74 large Weather leaves no
 * room for a 2 × 8 column beside the large Clock and Forecast (#183).
 */
function columnReady() {
  const settings = catalogBoardDefaults();
  settings.widgets.preview = false; settings.preview.enabled = false;
  settings.widgetGrid.placements.weather = { column: 8, row: 0, size: 'medium' };
  return settings;
}

/** Synthetic pending reminders so the widget renders in the canvas. */
function reminders() {
  const at = new Date(Date.parse('2026-10-18T12:00:00Z')).toISOString();
  return ['Read a chapter', 'Water the plants', 'Plan the weekend', 'Call a friend', 'A later reminder'].map((text, index) => ({ id: `00000000-0000-4000-8000-00000000000${index}`, text, completed: false, dueAt: null, createdAt: at, updatedAt: at }));
}

export async function runFreeSizeQa({ playwright, edge } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-freesize-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const now = Date.parse('2026-10-18T13:00:00Z');
  const app = await createApplication({ dataDirectory: directory, clientDirectory: join(root, 'dist/client'), now: () => now, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const errors = [], checks = [];
  let context, page;
  async function open(settings, options = {}, items = reminders()) {
    await context?.close();
    await app.store.update(data => { data.settings = structuredClone(settings); data.reminders = structuredClone(items); data.photoAsset = null; });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Toronto', ...options });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('500')) errors.push(message.text()); });
    await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
    await page.clock.install({ time: new Date(now) });
    await page.goto(base + '/editor');
    await page.getByRole('tab', { name: 'Widgets', exact: true }).waitFor();
    await page.clock.runFor(300);
  }
  const save = () => page.getByRole('button', { name: 'Save changes', exact: true });
  const cancel = () => page.getByRole('button', { name: 'Cancel', exact: true });
  const clean = () => page.locator('.studio-savebar').waitFor({ state: 'detached' });
  const dirty = () => save().waitFor();
  const layout = () => page.getByRole('button', { name: 'Edit layout', exact: true }).click();
  const handle = () => page.getByRole('button', { name: 'Resize Reminders', exact: true });
  const mover = () => page.getByRole('button', { name: 'Move Reminders', exact: true });
  const frameSpan = id => page.locator(`[data-frame-id="${id}"]`).getAttribute('data-frame-span');
  const frameStyle = id => page.locator(`[data-frame-id="${id}"]`).getAttribute('style');
  const ambient = () => page.locator('.preview-screen [data-widget-id="reminders"]');
  const status = () => page.locator('.grid-status');
  async function cells() {
    const box = await page.locator('.grid-editor').boundingBox();
    const columns = Number(await page.locator('.grid-editor').evaluate(element => getComputedStyle(element).getPropertyValue('--grid-columns')));
    const rows = Number(await page.locator('.grid-editor').evaluate(element => getComputedStyle(element).getPropertyValue('--grid-rows')));
    return { width: box.width / columns, height: box.height / rows };
  }
  async function center(locator) { const r = await locator.boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
  /** Drags the handle by fractional cells; `during` runs while the pointer is still down. */
  async function resizeBy(dx, dy, { during, finish = 'up' } = {}) {
    await mover().focus();
    const cell = await cells(), start = await center(handle());
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + cell.width * dx, start.y + cell.height * dy, { steps: 6 });
    if (during) await during();
    if (finish === 'escape') await page.keyboard.press('Escape');
    await page.mouse.up(); await page.clock.runFor(220);
    // Frames animate their snap with a real-time CSS transition; let it settle before the next gesture.
    await page.waitForTimeout(300);
  }
  async function selectReminders() {
    await page.getByRole('tab', { name: 'Widgets', exact: true }).click();
    const row = page.getByRole('button', { name: 'Reminders', exact: true });
    if (await row.getAttribute('aria-expanded') !== 'true') await row.click();
  }
  const preset = name => page.getByRole('button', { name: `Reminders size ${name}`, exact: true });
  const subtitle = () => page.locator('.widget-option').filter({ has: page.getByRole('button', { name: 'Reminders', exact: true }) }).locator('.widget-row-copy small');
  /** Every visible widget's family and span on the canvas, to prove nothing moved. */
  const shapes = () => page.locator('.preview-screen [data-widget-id]').evaluateAll(nodes => nodes.map(node => `${node.dataset.widgetId}:${node.dataset.widgetSize}:${node.dataset.widgetSpan ?? ''}`).sort());
  /** Live regions that currently say "No room". */
  const announcing = () => page.locator('[role="status"], [aria-live]').evaluateAll(nodes => nodes.filter(node => node.textContent.includes('No room')).map(node => node.textContent));
  try {
    // Pointer: snapping, live reflow, Escape and commit.
    await open(crowded()); await layout(); await clean();
    const weatherBefore = await frameStyle('weather');
    await resizeBy(0, 3.4, { finish: 'escape' });
    await clean();
    assert.equal(await frameSpan('reminders'), '2x2', 'Escape abandons the resize');
    await resizeBy(0.3, 6.35, {
      during: async () => {
        assert.notEqual(await frameStyle('weather'), weatherBefore, 'neighbours reflow live while resizing');
        assert.equal(await page.locator('.grid-drop-placeholder').count(), 1);
      },
    });
    await dirty();
    assert.equal(await frameSpan('reminders'), '2x8', 'a fractional pointer position snaps to whole cells');
    assert.notEqual(await frameStyle('weather'), weatherBefore, 'Weather moved aside for the column');
    assert.equal(await ambient().getAttribute('data-widget-span'), '2x8');
    assert.equal(await ambient().getAttribute('data-full-height'), '');
    assert.equal(await status().textContent(), 'Reminders resized to 2 × 8');
    await selectReminders();
    assert.equal(await page.locator('.widget-option.selected .widget-row-copy small').textContent(), 'Column');
    assert.equal(await page.getByRole('button', { name: 'Reminders size column', exact: true }).getAttribute('aria-pressed'), 'true');
    // Save persists the span; reload keeps it.
    await save().click(); await clean();
    assert.deepEqual(app.store.snapshot().settings.widgetGrid.placements.reminders, { column: 10, row: 0, size: 'small', span: { columns: 2, rows: 8 } });
    await page.reload(); await page.getByRole('tab', { name: 'Widgets', exact: true }).waitFor(); await page.clock.runFor(300);
    assert.equal(await ambient().getAttribute('data-widget-span'), '2x8');
    await layout(); await clean();
    assert.equal(await frameSpan('reminders'), '2x8');
    // Keyboard on the handle, then Cancel restores the saved column.
    await mover().focus(); await handle().focus(); await page.keyboard.press('ArrowUp');
    await dirty();
    assert.equal(await frameSpan('reminders'), '2x7');
    assert.equal(await status().textContent(), 'Reminders resized to 2 × 7');
    await cancel().click(); await clean();
    assert.equal(await frameSpan('reminders'), '2x8', 'Cancel restores the saved shape');
    // Density round trip: full height stays full height, then the exact span returns.
    await page.getByRole('combobox', { name: 'Grid density' }).selectOption('spacious');
    await dirty();
    assert.equal(await ambient().getAttribute('data-widget-span'), '2x6');
    assert.equal(await ambient().getAttribute('data-full-height'), '');
    await page.getByRole('combobox', { name: 'Grid density' }).selectOption('balanced');
    await clean();
    assert.equal(await frameSpan('reminders'), '2x8', 'switching back restores the exact span');
    checks.push('pointer resize snaps to whole cells and reflows neighbours live; Escape abandons; Save persists the span; reload, Cancel and a density round trip restore it');

    // #152: a Column stays a Column in a finer grid, and a custom size dropped to fit is named.
    // A medium Photo in Rain's pre-#74 cells keeps the earlier geometry, so Spacious must drop the column.
    const columnBoard = columnReady(); columnBoard.widgets.photo = true;
    columnBoard.widgetGrid.placements.photo = { column: 8, row: 2, size: 'medium' };
    columnBoard.widgetGrid = resizeWidgetSpan(columnBoard.widgetGrid, 'reminders', { columns: 2, rows: 8 }, columnBoard.widgets);
    assert.ok(columnBoard.widgetGrid, 'the column fits beside a medium Weather and Photo');
    await open(columnBoard); await layout(); await clean();
    const densityControl = () => page.getByRole('combobox', { name: 'Grid density' });
    await densityControl().selectOption('spacious'); await dirty();
    assert.equal(await status().textContent(), 'Clock medium · Reminders 2 × 8 → small to fit. Switch back to restore.');
    assert.equal(await frameSpan('reminders'), '2x2');
    await densityControl().selectOption('balanced'); await clean();
    assert.equal(await frameSpan('reminders'), '2x8');
    await densityControl().selectOption('fine'); await dirty();
    assert.equal(await frameSpan('reminders'), '2x10', 'the minimum width survives the finer grid');
    await selectReminders();
    assert.equal(await page.locator('.widget-option.selected .widget-row-copy small').textContent(), 'Column');
    assert.equal(await page.getByRole('button', { name: 'Reminders size column', exact: true }).getAttribute('aria-pressed'), 'true');
    await cancel().click(); await clean();
    checks.push('a Column stays a 2-wide full-height Column in Fine, and a density fit that drops it names “Reminders 2 × 8 → small”');

    // Keyboard width/height with no displacement; resizing back to the saved shape hides the Save bar.
    await open(roomy()); await layout(); await clean();
    assert.match(await page.locator('#grid-keyboard-help').textContent(), /resize; Reminders changes width with left and right and height with up and down\./, 'keyboard help names the catalog free-size widgets');
    await mover().focus(); await handle().focus();
    await page.keyboard.press('ArrowDown'); await dirty();
    assert.equal(await frameSpan('reminders'), '2x3');
    await page.keyboard.press('ArrowRight');
    assert.equal(await frameSpan('reminders'), '3x3');
    assert.equal(await status().textContent(), 'Reminders resized to 3 × 3');
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    assert.equal(await status().textContent(), 'Reminders cannot get any narrower');
    assert.equal(await frameSpan('reminders'), '2x3');
    await page.keyboard.press('ArrowUp');
    await clean();
    assert.equal(await frameSpan('reminders'), '2x2');
    assert.equal(await handle().evaluate(element => element === document.activeElement), true, 'focus stays on the handle');
    checks.push('arrow keys on the handle change width and height by one cell, announce the result and limits, and resizing back to the saved shape is clean');

    // An impossible size keeps the board and says so.
    await open(catalogBoardDefaults()); await layout(); await clean();
    const board = await page.locator('.grid-widget-frame').evaluateAll(elements => elements.map(element => element.getAttribute('style')));
    await resizeBy(6.4, 3.4, {
      during: async () => {
        assert.equal(await page.locator('[data-frame-id="reminders"].invalid').count(), 1);
        assert.equal(await status().textContent(), 'No room for that size');
      },
    });
    await clean();
    assert.equal(await status().textContent(), 'No room for that size');
    assert.deepEqual(await page.locator('.grid-widget-frame').evaluateAll(elements => elements.map(element => element.getAttribute('style'))), board, 'every placement is unchanged');
    checks.push('an impossible resize keeps the previous board, marks the widget and shows “No room for that size”');

    // #183: on the catalog board a full-height column has no room. The Column preset says so before it
    // is chosen; choosing it names what takes the space and offers one draft fix; nothing changes until then.
    const fresh = catalogBoardDefaults();
    assert.equal(resizeWidgetSpan(fresh.widgetGrid, 'reminders', { columns: 2, rows: 8 }, fresh.widgets), null, 'the catalog board has no room for a column');
    await open(fresh); await clean();
    await selectReminders();
    const before = await shapes();
    assert.equal(await preset('column').getAttribute('aria-disabled'), 'true', 'Column is unavailable on this board');
    for (const name of ['small', 'medium', 'large']) assert.equal(await preset(name).getAttribute('aria-disabled'), null, `${name} fits`);
    const reason = await preset('column').getAttribute('aria-describedby');
    assert.equal(await page.locator(`[id="${reason}"]`).textContent(), 'Column needs more room on this board.');
    await preset('column').focus(); await page.keyboard.press('Enter'); await page.clock.runFor(100);
    const columnProblem = 'No room for a full-height Reminders column beside Clock, Weather and Forecast.';
    assert.deepEqual(await announcing(), [columnProblem], 'one live region names what takes the space');
    assert.equal(await page.getByText(columnProblem, { exact: true }).count(), 1, 'shown once');
    assert.equal(await preset('column').evaluate(element => element === document.activeElement), true, 'focus stays on the unavailable preset');
    assert.deepEqual(await shapes(), before, 'no widget is resized without an explicit action');
    assert.equal(await page.locator('.studio-savebar').count(), 0);
    const makeRoom = page.getByRole('button', { name: 'Make room: Weather medium', exact: true });
    await makeRoom.click(); await page.clock.runFor(200);
    await dirty();
    assert.equal(await page.locator('.preview-screen [data-widget-id="weather"]').getAttribute('data-widget-size'), 'medium');
    assert.equal(await ambient().getAttribute('data-widget-span'), '2x8');
    assert.equal(await ambient().getAttribute('data-full-height'), '');
    assert.equal(await subtitle().textContent(), 'Column');
    assert.equal(await preset('column').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.widget-list .inline-message').textContent(), 'Weather is now medium. Reminders is now a full-height column.');
    assert.deepEqual(await announcing(), [], 'the explanation clears once the column fits');
    await cancel().click(); await clean();
    assert.deepEqual(await shapes(), before, 'Cancel restores the board');
    // A stepper with no room explains itself the same way: from 2 × 6 on the catalog board, 2 × 7 has none.
    const tall = catalogBoardDefaults();
    tall.widgetGrid = resizeWidgetSpan(tall.widgetGrid, 'reminders', { columns: 2, rows: 6 }, tall.widgets);
    assert.ok(tall.widgetGrid);
    await open(tall); await clean(); await selectReminders();
    const tallBefore = await shapes();
    await page.getByRole('group', { name: 'Reminders height' }).getByRole('button', { name: 'Taller' }).click(); await page.clock.runFor(100);
    assert.deepEqual(await announcing(), ['No room for a 2 × 7 Reminders beside Clock, Weather and Forecast.']);
    assert.deepEqual(await shapes(), tallBefore, 'nothing changes');
    await page.getByRole('button', { name: 'Make room: Weather medium', exact: true }).click(); await dirty();
    assert.equal(await ambient().getAttribute('data-widget-span'), '2x7');
    assert.equal(await page.getByRole('group', { name: 'Reminders height' }).locator('output').textContent(), '7 rows');
    await cancel().click(); await clean();
    checks.push('catalog board (#183): Column is aria-disabled with its reason; choosing it names Clock, Weather and Forecast in one live region and changes nothing; “Make room: Weather medium” makes the column as one draft that Cancel restores; a stepper with no room explains itself too');

    // #435: the default board fills the grid, so its medium Reminders has room for Small only. Large and
    // Column say so; choosing Column names Clock, and Make room: Clock medium makes the column as one draft.
    const board435 = defaultSettings();
    await open(board435); await clean();
    await selectReminders();
    const before435 = await shapes();
    assert.equal(await subtitle().textContent(), 'Medium');
    for (const name of ['large', 'column']) assert.equal(await preset(name).getAttribute('aria-disabled'), 'true', `${name} is unavailable on the default board`);
    for (const name of ['small', 'medium']) assert.equal(await preset(name).getAttribute('aria-disabled'), null, `${name} fits`);
    assert.equal(await page.locator(`[id="${await preset('column').getAttribute('aria-describedby')}"]`).textContent(), 'Large and Column need more room on this board.');
    await preset('column').focus(); await page.keyboard.press('Enter'); await page.clock.runFor(100);
    assert.deepEqual(await announcing(), ['No room for a full-height Reminders column beside Clock.'], 'one live region names Clock');
    assert.deepEqual(await shapes(), before435, 'nothing changes before the fix');
    await page.getByRole('button', { name: 'Make room: Clock medium', exact: true }).click(); await page.clock.runFor(200);
    await dirty();
    assert.equal(await page.locator('.preview-screen [data-widget-id="clock"]').getAttribute('data-widget-size'), 'medium');
    assert.equal(await ambient().getAttribute('data-widget-span'), '2x8');
    assert.equal(await subtitle().textContent(), 'Column');
    assert.equal(await page.locator('.widget-list .inline-message').textContent(), 'Clock is now medium. Reminders is now a full-height column.');
    await cancel().click(); await clean();
    assert.deepEqual(await shapes(), before435, 'Cancel restores the default board');
    checks.push('#435 default board: Large and Column are aria-disabled (“Large and Column need more room on this board.”); choosing Column names Clock; “Make room: Clock medium” makes the column as one draft that Cancel restores');

    // #233: the list subtitle says when the display hides an empty Reminders.
    await open(roomy(), {}, []); await clean();
    await selectReminders();
    assert.equal(await subtitle().textContent(), 'Small · Hidden when empty');
    await page.getByRole('checkbox', { name: 'Hide when empty' }).click(); await dirty();
    assert.equal(await subtitle().textContent(), 'Small', 'shown (“All clear”) when the option is off');
    await cancel().click(); await clean();
    await open(roomy()); await selectReminders();
    assert.equal(await subtitle().textContent(), 'Small', 'pending reminders are shown');
    checks.push('the Widgets list subtitle reads “Small · Hidden when empty” only while the display hides an empty Reminders (#233)');

    // Touch: real pointer capture through CDP touch input.
    await open(crowded(), { hasTouch: true }); await layout(); await clean();
    await mover().focus();
    const touch = await context.newCDPSession(page), cell = await cells(), point = await center(handle());
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
    for (let step = 1; step <= 6; step++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + cell.height * 6.3 * step / 6 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.clock.runFor(220);
    await dirty();
    assert.equal(await frameSpan('reminders'), '2x8');
    await cancel().click(); await clean();
    assert.equal(await frameSpan('reminders'), '2x2');
    checks.push('touch resize to a full-height column snaps to cells; Cancel restores');

    // Presets and steppers.
    await open(roomy());
    await selectReminders();
    assert.equal(await preset('small').getAttribute('aria-pressed'), 'true');
    await preset('column').click(); await dirty();
    assert.equal(await ambient().getAttribute('data-widget-span'), '2x8');
    assert.equal(await preset('column').getAttribute('aria-pressed'), 'true');
    assert.equal(await preset('small').getAttribute('aria-pressed'), 'false');
    let width = page.getByRole('group', { name: 'Reminders width' }), height = page.getByRole('group', { name: 'Reminders height' });
    assert.equal(await height.locator('output').textContent(), '8 rows');
    assert.equal(await height.getByRole('button', { name: 'Taller' }).getAttribute('aria-disabled'), 'true');
    await width.getByRole('button', { name: 'Wider' }).click();
    assert.equal(await width.locator('output').textContent(), '3 columns');
    assert.equal(await page.locator('.widget-option.selected .widget-row-copy small').textContent(), '3 × 8');
    for (let step = 0; step < 8; step++) await width.getByRole('button', { name: 'Wider' }).click();
    assert.ok(Number((await width.locator('output').textContent()).split(' ')[0]) <= 8, 'never wider than two-thirds of Balanced');
    await height.getByRole('button', { name: 'Shorter' }).click();
    assert.equal(await height.locator('output').textContent(), '7 rows');
    await preset('medium').click();
    assert.equal(await ambient().getAttribute('data-widget-span'), '4x2');
    assert.equal(await page.locator('.widget-option.selected .widget-row-copy small').textContent(), 'Medium');
    await preset('small').click();
    assert.equal(await page.getByText('Shows as many reminders as fit · soonest first').count(), 1);
    await save().click(); await clean();
    assert.equal(Object.hasOwn(app.store.snapshot().settings.widgetGrid.placements.reminders, 'span'), false, 'a family preset saves without a span');
    checks.push('Small/Medium/Large/Column presets press the matching shape; Width and Height steppers stop at their limits; the list subtitle follows the shape');

    // Presets and steppers fit narrow and short viewports, with focus clear of the Save bar.
    for (const viewport of [
      { width: 1280, height: 720 }, { width: 1280, height: 600 }, { width: 1024, height: 600 }, { width: 760, height: 600 },
      { width: 390, height: 700 }, { width: 390, height: 480 }, { width: 640, height: 300 },
    ]) {
      await open(roomy(), { viewport });
      await selectReminders();
      await preset('column').click(); await dirty();
      width = page.getByRole('group', { name: 'Reminders width' }); height = page.getByRole('group', { name: 'Reminders height' });
      const targets = [preset('small'), preset('medium'), preset('large'), preset('column'),
        width.getByRole('button', { name: 'Narrower' }), width.getByRole('button', { name: 'Wider' }),
        height.getByRole('button', { name: 'Shorter' }), height.getByRole('button', { name: 'Taller' })];
      for (const target of targets) {
        await target.focus(); await page.clock.runFor(50);
        const geometry = await target.evaluate(element => {
          const r = element.getBoundingClientRect(), bar = document.querySelector('.studio-savebar')?.getBoundingClientRect();
          const controls = element.closest('.free-size-controls'), box = controls.getBoundingClientRect();
          return { active: document.activeElement === element, top: r.top, bottom: r.bottom, left: r.left, right: r.right, barTop: bar && bar.left < r.right && r.left < bar.right ? bar.top : innerHeight,
            width: innerWidth, boxLeft: box.left, boxRight: box.right, overflow: controls.scrollWidth - controls.clientWidth, page: document.documentElement.scrollWidth - innerWidth };
        });
        const label = JSON.stringify({ viewport, name: await target.getAttribute('aria-label'), ...geometry });
        assert.equal(geometry.active, true, label);
        assert.ok(geometry.bottom <= geometry.barTop - 4 && geometry.top >= 0, `focused control is clear of the Save bar: ${label}`);
        assert.ok(geometry.left >= geometry.boxLeft - 1 && geometry.right <= geometry.boxRight + 1 && geometry.right <= geometry.width, `control fits its panel: ${label}`);
        assert.ok(geometry.overflow <= 1 && geometry.page <= 1, `no horizontal overflow: ${label}`);
      }
    }
    checks.push('presets and steppers fit at 1280×720, 1280×600, 1024×600, 760×600, 390×700, 390×480 and 640×300 with keyboard focus clear of the Save bar');

    // The picker keeps every family action and adds one caption for free-size widgets, qualified while
    // the board has no room for a full-height column (#238).
    const roomyPicker = roomy(); roomyPicker.widgets.reminders = false;
    await open(roomyPicker);
    await page.getByRole('button', { name: 'Add widget', exact: true }).click();
    await page.getByRole('button', { name: 'Preview Reminders', exact: true }).click();
    assert.equal(await page.locator('.picker-free-size').textContent(), 'Resize freely after adding — up to the full height');
    const pickerSettings = defaultSettings(); pickerSettings.widgets.reminders = false;
    await open(pickerSettings);
    await page.getByRole('button', { name: 'Add widget', exact: true }).click();
    await page.getByRole('button', { name: 'Preview Reminders', exact: true }).click();
    for (const family of ['small', 'medium', 'large']) assert.equal(await page.getByRole('button', { name: `Reminders ${family}`, exact: true }).count(), 1);
    // On the #435 default board without Reminders, a column would need Clock to be smaller.
    assert.equal(await page.getByText('Resize freely after adding. Full height needs room first: make Clock smaller.', { exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Preview Clock, on your display', exact: true }).click();
    assert.equal(await page.locator('.picker-free-size').count(), 0, 'only free-size widgets show the caption');
    await page.getByRole('button', { name: 'Preview Reminders', exact: true }).click();
    await page.getByRole('button', { name: 'Reminders medium', exact: true }).click();
    await page.getByRole('button', { name: 'Add Reminders', exact: true }).click();
    await dirty();
    assert.equal(await ambient().getAttribute('data-widget-size'), 'medium');
    checks.push('the picker exposes every family action plus the free-size caption (qualified on the default board), and adding still uses a family');

    assert.deepEqual(errors, []);
    return { checks };
  } finally {
    await browser.close();
    app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
    await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runFreeSizeQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks }, null, 2));
}
