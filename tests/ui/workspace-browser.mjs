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
import { WIDGET_IDS, widgetSizes } from '../../dist/shared/widgets.js';

export async function runWorkspaceQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-workspace-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const now = Date.parse('2026-10-18T13:41:00Z');
  const app = await createApplication({ dataDirectory: directory, clientDirectory: join(root, 'dist/client'), now: () => now, fetcher: async () => { throw new Error('Synthetic unavailable provider'); } });
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
  async function inView(locator, label) {
    const box = await locator.boundingBox(); const viewport = page.viewportSize();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${label} must fit the viewport: ${JSON.stringify(box)}`);
  }
  const frame = () => page.locator('.preview-frame').boundingBox();
  try {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1280, height: 600 }, { width: 1024, height: 600 }, { width: 760, height: 600 }]) {
      await open(viewport);
      const before = await frame();
      for (const name of ['Style', 'Widgets', 'Weather', 'Reminders']) {
        await tab(name);
        assert.deepEqual(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]), [viewport.width, viewport.height], `desktop ${name} must use contained scrolling`);
        await inView(button('Edit layout'), 'Edit layout');
        await inView(button('Add widget to display'), 'Canvas plus');
      }
      await tab('Widgets'); await button('Clock').click(); await button('Digital').click(); await button('Save changes').waitFor();
      assert.deepEqual(await frame(), before, 'dirty bar must not change canvas geometry');
      await inView(button('Cancel'), 'Cancel'); await inView(button('Save changes'), 'Save');
      assert.equal(await page.locator('.widget-position-control').count(), 0);
      await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
      await button('Edit layout').click(); await inView(page.getByRole('combobox', { name: 'Grid density' }), 'Density'); await button('Done').click();
      await button('Add widget').click();
      const panel = await page.locator('.inspector-panel').evaluate(element => [element.clientHeight, element.scrollHeight]);
      assert.ok(panel[1] <= panel[0] + 1, 'catalog and Add must fit the contained panel');
      for (const id of WIDGET_IDS) {
        const name = { clock: 'Clock', weather: 'Weather', rain: 'Rain', forecast: 'Forecast', reminders: 'Reminders', preview: 'Last screen', photo: 'Photo' }[id];
        await button(`Preview ${name}`).focus(); await page.keyboard.press('Enter');
        await inView(button(`Add ${name}`), `${name} Add`);
        for (const size of widgetSizes(id)) { await button(`${name} ${size}`).click(); await inView(button(`Add ${name}`), `${name}/${size} Add`); }
      }
      assert.doesNotMatch(await page.locator('.widget-picker').innerText(), /Private reminder sentinel|Toronto/);
      if (capture) images.push({ name: `picker-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
      await page.keyboard.press('Escape'); assert.equal(await page.locator('.widget-picker').count(), 0); assert.equal(await button('Add widget').evaluate(element => element === document.activeElement), true);
      await tab('Weather'); const input = page.getByRole('combobox', { name: 'Search for a city' }); await input.focus(); await input.fill('unsaved');
      await tab('Style'); await page.getByRole('slider', { name: 'Brightness', exact: true }).focus(); await page.keyboard.press('ArrowRight'); await tab('Weather'); await input.focus();
      const field = await input.boundingBox(), savebar = await page.locator('.studio-savebar').boundingBox();
      assert.ok(field.y >= 0 && field.y + field.height < savebar.y, 'focused desktop field must clear Save');
      await button('Cancel').click();
      checks.push(`${viewport.width}x${viewport.height}: bounded tabs/canvas/actions, stable dirty geometry, all21family catalog actions, keyboard close/focus return and Save clearance`);
    }
    for (const viewport of [{ width: 390, height: 700 }, { width: 390, height: 480 }, { width: 640, height: 300 }]) {
      await open(viewport);
      for (const name of ['Widgets', 'Style', 'Weather', 'Reminders']) { await tab(name); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow/200% equivalent must not scroll horizontally'); }
      await tab('Widgets'); await button('Add widget').click(); await button('Preview Photo').click(); await button('Photo large').click(); await button('Add Photo').scrollIntoViewIfNeeded(); await inView(button('Add Photo'), 'Mobile Add');
      if (capture) images.push({ name: `picker-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
      await button('Add Photo').click(); await button('Save changes').waitFor();
      const upload = page.locator('.photo-upload-control'); await upload.scrollIntoViewIfNeeded();
      const icon = await upload.locator('svg').boundingBox(); assert.ok(icon.width === 16 && icon.height === 16, 'upload icon keeps explicit geometry');
      await tab('Weather'); const input = page.getByRole('combobox', { name: 'Search for a city' }); await input.focus();
      const field = await input.boundingBox(), bar = await page.locator('.studio-savebar').boundingBox(); assert.ok(field.y >= 0 && field.y + field.height < bar.y, 'focused narrow field must clear Save');
      await button('Cancel').click();
      checks.push(`${viewport.width}x${viewport.height}: narrow/200% equivalent reflow, reachable picker/Add, fixed photo icon, focus clear of dirty Save`);
    }
    assert.deepEqual(errors, []); return { checks, images };
  } finally { await context?.close(); await browser.close(); await new Promise(resolve => app.server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runWorkspaceQa(values); console.log(JSON.stringify({ checks: result.checks }, null, 2));
}
