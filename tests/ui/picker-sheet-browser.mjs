// #554: the production Add-widget sheet. Isolated data, synthetic devices and RAM-only captures.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { catalogBoardDefaults, forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { keepPagesLocal } from './lib/local-only.mjs';
import { mockScreenWakeLock } from './lib/windows-fixture.mjs';

export async function runPickerSheetQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-picker-sheet-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const app = await createApplication({ dataDirectory: directory, clientDirectory: join(root, 'dist/client'), fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  let context, page;
  const button = name => page.getByRole('button', { name, exact: true });
  const sheet = () => page.getByRole('dialog', { name: 'Add a widget' });
  const snapshot = () => app.store.snapshot().settings;
  async function open(viewport, full = false) {
    await context?.close();
    await app.store.update(data => { data.settings = full ? defaultSettings() : catalogBoardDefaults(); data.reminders = []; });
    context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await keepPagesLocal(context, base); await mockScreenWakeLock(context);
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/editor'); await button('Add widget to display').waitFor();
  }
  async function visible(locator, label) {
    const box = await locator.boundingBox(), viewport = page.viewportSize();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${label}: ${JSON.stringify(box)}`);
  }
  async function close() { await page.keyboard.press('Escape'); await sheet().waitFor({ state: 'detached' }); }
  try {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 760, height: 600 }, { width: 390, height: 600 }, { width: 320, height: 480 }]) {
      await open(viewport);
      await button('Edit layout').click();
      await page.evaluate(() => document.fonts.ready);
      const initial = snapshot(), canvas = await page.locator('.preview-frame').boundingBox();
      await button('Add widget to display').click(); await sheet().waitFor();
      assert.deepEqual(await page.locator('.preview-frame').boundingBox(), canvas, 'opening the sheet keeps the board geometry');
      assert.ok(await page.locator('.widget-option').count() > 0, 'the inspector stays mounted');
      await visible(sheet(), 'sheet bounds'); await visible(button('Close widget picker'), 'Close');
      // Neither programmatic focus nor the native tab sequence can enter the inert background.
      await page.locator('.canvas-add').evaluate(element => element.focus());
      assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true);
      for (let key = 0; key < 18; key++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true, `Tab ${key}: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 160))}`); }
      await page.getByRole('searchbox', { name: 'Search widgets' }).fill('world');
      await button('Preview World clocks').click();
      if (viewport.width <= 600) {
        await visible(button('All widgets'), 'Browse return');
        assert.equal(await page.locator('.picker-sidebar').isVisible(), false);
      }
      const shapes = await page.locator('.family-shape i').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return box.width * box.height; }));
      assert.ok(shapes[0] < shapes[1] && shapes[1] < shapes[2], 'World clocks sizes have visibly different footprints');
      await button('World clocks medium').click();
      await visible(button('World clocks medium'), 'size choices');
      await visible(button('Add World clocks'), 'Add');
      if (viewport.width <= 600) {
        await button('All widgets').click();
        assert.equal(await page.getByRole('searchbox', { name: 'Search widgets' }).inputValue(), 'world');
        assert.equal(await button('Preview World clocks').evaluate(element => element === document.activeElement), true);
        await button('Preview World clocks').click();
        assert.equal(await button('World clocks medium').getAttribute('aria-pressed'), 'true');
      }
      assert.deepEqual(snapshot(), initial, 'browsing and size choices never persist');
      assert.equal(await page.locator('.studio-savebar').count(), 0);
      if (capture) images.push({ name: `picker-sheet-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
      await close();
      assert.equal(await button('Add widget to display').evaluate(element => element === document.activeElement), true, 'Escape returns to the original plus');
      assert.deepEqual(await page.locator('.preview-frame').boundingBox(), canvas);
      await button('Add widget to display').click(); await button('Preview World clocks').click();
      await button('World clocks small').click(); await button('Add World clocks').click();
      await sheet().waitFor({ state: 'detached' });
      assert.equal(await button('World clocks').evaluate(element => element === document.activeElement), true, 'adding focuses the new widget settings');
      assert.deepEqual(snapshot(), initial, 'an add remains unsaved');
      await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
      assert.equal(await page.locator('.widget-option[data-widget-option="worldClocks"]').count(), 0, 'Cancel restores the board');
      checks.push(`${viewport.width}×${viewport.height}: sheet bounds, inert background, keyboard containment, retained query/size, distinct size shapes, add focus and draft Cancel`);
    }
    await open({ width: 1280, height: 720 }, true);
    const full = snapshot();
    await button('Add widget to display').click();
    assert.equal(await page.locator('.picker-add').isVisible(), false, 'a full board does not offer an Add that only repeats a refusal');
    await visible(button('Switch the grid to Fine'), 'explicit room action');
    assert.deepEqual(snapshot(), full, 'preflight does not change the board');
    await button('Switch the grid to Fine').click(); await sheet().waitFor({ state: 'detached' });
    assert.equal(await page.locator('.widget-option[data-widget-option="worldClocks"]').count(), 1);
    assert.deepEqual(snapshot(), full, 'make room and add is one unsaved transaction');
    await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    assert.deepEqual(snapshot(), full);
    await button('Add widget to display').click();
    await page.getByRole('searchbox', { name: 'Search widgets' }).fill('nothing matches this');
    assert.equal(await page.locator('.picker-detail').count(), 0);
    await visible(button('Show all widgets'), 'empty-result recovery');
    await button('Show all widgets').click();
    await button('Preview World clocks').click(); await button('World clocks small').focus();
    await page.setViewportSize({ width: 390, height: 600 });
    await visible(button('World clocks small'), 'focused preview survives compact reflow');
    await close();
    checks.push('full-board explicit make-room add/Cancel, no-results recovery, and focused desktop-to-mobile reflow');
    assert.deepEqual(errors, []);
    return { checks, images };
  } finally {
    await context?.close(); await browser.close();
    app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
    const full = resolve(directory), allowed = resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/');
    if (full.startsWith(allowed) && full.includes('lrd-picker-sheet-')) await rm(full, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runPickerSheetQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks }, null, 2));
}
