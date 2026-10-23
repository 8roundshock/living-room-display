// #517: real destinations, app-wide preferences and recovery with synthetic private data.
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
import { keepPagesLocal } from './lib/local-only.mjs';

export async function runSettingsQa({ playwright, edge, capture = false } = {}) {
  const started = Date.now(), { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-settings-'));
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`, browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  const record = text => { checks.push(text); console.log(`PASS: ${text}`); };
  let context, page;
  const button = name => page.getByRole('button', { name, exact: true });
  const units = () => page.getByRole('combobox', { name: 'Units', exact: true });
  const format = () => page.getByRole('combobox', { name: 'Time format', exact: true });
  const saved = () => app.store.snapshot().settings;
  async function clean() { await page.locator('.settings-savebar').waitFor({ state: 'detached' }); }
  async function open(path = '/settings', viewport = { width: 1280, height: 720 }) {
    await context?.close();
    await app.store.update(data => { data.settings = defaultSettings(); data.reminders = []; });
    context = await browser.newContext({ viewport, reducedMotion: 'reduce' }); await keepPagesLocal(context, base);
    await context.addInitScript(() => {
      window.syntheticLocationCalls = 0;
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: success => { window.syntheticLocationCalls++; success({ coords: { latitude: 45.5012, longitude: -73.5673, accuracy: 50 } }); } } });
    });
    await context.route('**/api/windows/status', route => route.fulfill({ json: { available: false, isLivingRoomDisplay: false, power: { available: false } } }));
    await context.route('**/api/locations?*', route => route.fulfill({ json: [{ name: 'London', latitude: 51.5, longitude: -0.1, timezone: 'Europe/London', country: 'United Kingdom' }] }));
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + path); await page.locator('.studio-header').waitFor();
  }
  try {
    for (const path of ['/', '/editor', '/display', '/settings-extra']) assert.equal((await fetch(base + path)).headers.get('permissions-policy'), 'geolocation=()', path);
    assert.equal((await fetch(base + '/settings?focus=city')).headers.get('permissions-policy'), 'geolocation=(self)');
    await open('/');
    assert.equal(await page.locator('.studio-pages a').count(), 3);
    assert.equal(await page.locator('.home-preview, .home-page .ambient').count(), 0);
    await page.getByRole('link', { name: 'Edit display', exact: true }).first().click(); await page.getByRole('tab', { name: 'Widgets', exact: true }).waitFor();
    assert.deepEqual(await page.getByRole('tab').allTextContents(), ['Style', 'Widgets']);
    assert.equal(await page.getByRole('button', { name: 'Edit reminders', exact: true }).count(), 0);
    await page.getByRole('link', { name: 'Settings', exact: true }).click(); await units().waitFor();
    assert.equal(await page.locator('.studio-pages a[aria-current="page"]').innerText(), 'Settings');
    assert.equal(await page.evaluate(() => window.syntheticLocationCalls), 0);
    record('Home, Edit display and Settings have clear stable destinations; Home has no duplicate ambient preview and no page prompts for location automatically');

    await units().selectOption('imperial'); assert.equal(saved().units, 'metric');
    await button('Cancel').click(); await clean(); assert.equal(await units().inputValue(), 'metric');
    await page.getByRole('combobox', { name: 'City', exact: true }).fill('Lo');
    await page.getByRole('option', { name: /London/ }).click();
    assert.equal(saved().location.name, 'Toronto'); await format().selectOption('24h'); await units().selectOption('imperial');
    await button('Save changes').click(); await clean();
    assert.equal(saved().location.name, 'London'); assert.equal(saved().units, 'imperial'); assert.equal(saved().clockFormat, '24h');
    await page.reload(); await units().waitFor(); assert.equal(await units().inputValue(), 'imperial'); assert.equal(await format().inputValue(), '24h');
    record('City dropdown, units and time format are cancellable field-scoped drafts; Save persists and reload shows the saved values');

    await button('Use device location').click(); await page.getByText('Area ready to save.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.syntheticLocationCalls), 1);
    assert.equal(saved().location.name, 'London'); await button('Cancel').click(); await clean(); assert.equal(saved().location.name, 'London');
    record('An explicit synthetic device lookup is a draft and Cancel keeps the chosen city; no location result is silently saved');

    await units().selectOption('metric');
    await page.route('**/api/settings', async route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, json: { error: 'Synthetic save unavailable' } }) : route.continue());
    await button('Save changes').click(); await page.getByRole('alert').filter({ hasText: 'Synthetic save unavailable' }).waitFor();
    assert.equal(await units().inputValue(), 'metric'); assert.equal(saved().units, 'imperial');
    await page.unroute('**/api/settings'); await button('Save changes').click(); await clean(); assert.equal(saved().units, 'metric');
    record('Failed saves retain the exact draft and a normal retry succeeds');

    await format().selectOption('12h');
    await app.store.update(data => { data.settings.location = { name: 'Ottawa', latitude: 45.4, longitude: -75.7, timezone: 'America/Toronto' }; });
    await button('Save changes').click(); await page.getByRole('alert').filter({ hasText: 'Review your edits' }).waitFor();
    assert.equal(await format().inputValue(), '12h'); assert.equal(saved().clockFormat, '24h');
    await button('Save changes').click(); await clean(); assert.equal(saved().clockFormat, '12h'); assert.equal(saved().location.name, 'Ottawa');
    record('A stale revision requires review, retains local fields and preserves a city saved elsewhere on the explicit retry');

    await units().selectOption('imperial'); let warned = false;
    page.once('dialog', async dialog => { warned = dialog.type() === 'beforeunload'; await dialog.dismiss(); });
    await page.getByRole('link', { name: 'Home', exact: true }).click({ noWaitAfter: true });
    await page.waitForFunction(() => location.pathname === '/settings');
    assert.equal(warned, true); assert.equal(await units().inputValue(), 'imperial');
    await button('Cancel').click(); await clean();
    await page.getByRole('link', { name: 'Home', exact: true }).click(); await page.locator('.home-page').waitFor();
    await page.goBack(); await units().waitFor(); assert.equal(await units().inputValue(), 'metric');
    record('Leaving a dirty page triggers the browser leave guard; Keep preserves the draft, Cancel permits navigation and Back restores saved preferences');

    await page.goto(base + '/editor?focus=city'); await page.waitForURL('**/settings?focus=city');
    await page.waitForFunction(() => document.activeElement?.id === 'city-search');
    record('Legacy city links reach Settings with City focused');

    await units().selectOption('imperial'); await button('Restore from backup…').click();
    await page.getByText('Save or cancel your changes before restoring a backup.', { exact: true }).waitFor();
    assert.equal(saved().units, 'metric'); await button('Cancel').click(); await clean();
    await page.getByLabel('Backup file', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await page.getByText("That file isn't a backup. Choose one made with Export saved data.", { exact: true }).waitFor();
    const exported = await (await fetch(base + '/api/export')).json(); exported.settings.units = 'imperial';
    await page.getByLabel('Backup file', { exact: true }).setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await page.getByRole('group', { name: 'Restore backup', exact: true }).waitFor(); assert.equal(saved().units, 'metric');
    await button("Don't restore").click(); assert.equal(saved().units, 'metric');
    await page.getByLabel('Backup file', { exact: true }).setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await button('Restore').click(); await page.getByText(/Backup restored:/).waitFor();
    await page.waitForFunction(() => document.querySelector('.time-units') === null && document.querySelector('select')?.value !== '');
    assert.equal(saved().units, 'imperial');
    record('Recovery refuses dirty/invalid data, asks before replacement, supports cancellation and restores only after confirmation');

    for (const width of [1280, 760, 390, 320]) {
      await open('/settings', { width, height: 720 }); await units().waitFor(); await units().selectOption('imperial');
      for (const target of [page.getByRole('link', { name: 'Home', exact: true }), page.getByRole('link', { name: 'Edit display', exact: true }), page.getByRole('link', { name: 'Settings', exact: true }), button('Save changes'), button('Cancel')]) {
        const box = await target.boundingBox(); assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1, `${width}: ${JSON.stringify(box)}`);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (capture) images.push({ name: `settings-${width}`, bytes: await page.screenshot() });
      await button('Cancel').click(); await clean();
    }
    record('The three navigation labels and Save/Cancel remain visible, 44px high and within narrow viewports');
    assert.deepEqual(errors, []); return { checks, images, seconds: Math.round((Date.now() - started) / 1000) };
  } catch (error) { console.log(JSON.stringify({ checksCompleted: checks.length, errors, page: await page.locator('body').innerText().catch(() => '') })); throw error; }
  finally { await browser.close(); app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runSettingsQa(values); console.log(JSON.stringify({ passed: result.checks.length, seconds: result.seconds, checks: result.checks }, null, 2));
}
