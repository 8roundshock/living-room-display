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
import { getVisual } from '../../src/client/model.ts';
import { keepPagesLocal } from './lib/local-only.mjs';

export async function runSettingsQa({ playwright, edge, capture = false } = {}) {
  const started = Date.now(), { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-settings-'));
  let providerCalls = 0;
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), fetcher: async () => { providerCalls++; return Response.json(forecastFixture()); } });
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
  async function reachable(target, label) {
    const handle = target.elementHandle ? await target.elementHandle() : target;
    await page.waitForFunction(element => {
      const box = element.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth
        && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }, handle, { timeout: 3000 }).catch(async () => {
      assert.fail(`${label}: ${JSON.stringify(await target.evaluate(element => ({ rect: element.getBoundingClientRect().toJSON(), scrollY, height: innerHeight })))}`);
    });
  }
  try {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 640 }, { width: 640, height: 300 }]) {
      await open('/settings', viewport); await units().waitFor();
      for (const label of await page.locator('.settings-fields .field-label').all()) {
        const size = await label.boundingBox();
        assert.ok(size.height < 30, `${viewport.width}: preference names stay on one line`);
      }
      const search = page.getByRole('searchbox', { name: 'Find a setting', exact: true });
      const searchArea = page.getByRole('search', { name: 'Find a setting', exact: true });
      const before = structuredClone(saved());
      let fileChoosers = 0; page.on('filechooser', () => { fileChoosers++; });
      await units().selectOption('imperial');
      await search.fill('temperature');
      assert.equal(await searchArea.getByRole('button', { name: 'Units Time & units', exact: true }).count(), 1);
      await search.press('Enter');
      await page.waitForFunction(() => document.activeElement?.id === 'settings-units');
      await reachable(units(), `${viewport.width}: search focuses an unobscured units control`);
      assert.equal(await units().inputValue(), 'imperial', 'search retains the dirty settings value');
      assert.deepEqual(saved(), before, 'search does not save a draft');
      await search.fill('clock'); await search.press('ArrowDown'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.activeElement?.id === 'settings-clock-format');
      await reachable(format(), `${viewport.width}: keyboard search focuses time format`);
      await search.fill('backup');
      await reachable(search, `${viewport.width}: returning to search keeps its field fully visible`);
      if (capture) images.push({ name: `settings-search-${viewport.width}`, bytes: await page.screenshot() });
      await search.press('ArrowDown'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
      assert.equal(await button('Restore from backup…').evaluate(element => document.activeElement === element), true);
      await reachable(button('Restore from backup…'), `${viewport.width}: search reaches recovery above savebar`);
      assert.equal(fileChoosers, 0, 'finding restore does not open a file chooser');
      await search.fill('gps'); await search.press('Enter');
      assert.equal(await button('Use device location').evaluate(element => document.activeElement === element), true);
      assert.equal(await page.evaluate(() => window.syntheticLocationCalls), 0, 'finding device location does not request access');
      await search.fill('not-a-setting'); await page.getByText('No matching settings', { exact: true }).waitFor();
      await button('Clear settings search').click(); assert.equal(await search.inputValue(), '');
      await search.fill('city'); await search.press('Escape'); assert.equal(await search.inputValue(), '');
      assert.equal(await search.evaluate(element => document.activeElement === element), true);
      assert.equal(await units().inputValue(), 'imperial');
      await button('Cancel').click(); await clean(); assert.deepEqual(saved(), before);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${viewport.width}: search reflows without sideways scroll`);
    }
    await open('/settings?focus=city');
    await page.waitForFunction(() => document.activeElement?.id === 'city-search');
    record('Find a setting supports everyday terms, keyboard selection, clear/no-match states and unobscured focus without saving drafts or running location/recovery actions');

    for (const viewport of [{ width: 1280, height: 480 }, { width: 760, height: 480 }, { width: 390, height: 720 }, { width: 320, height: 480 }]) {
      await open('/settings', viewport); await units().waitFor();
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, 10000);
      await page.waitForFunction(() => scrollY > 0);
      await reachable(button('Restore from backup…'), `${viewport.width}: wheel reaches recovery without clipping`);
      await page.keyboard.press('Control+Home');
      await page.waitForFunction(() => scrollY === 0);
      await page.keyboard.press('PageDown');
      await page.waitForFunction(() => scrollY > 0);
      await page.keyboard.press('Control+End');
      await reachable(button('Restore from backup…'), `${viewport.width}: keyboard reaches recovery`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${viewport.width}: one-axis reflow`);
    }
    record('Wheel and keyboard scrolling reach the final recovery controls in desktop, short and narrow windows without horizontal overflow');
    await open('/settings');
    assert.ok((await page.locator('#settings-schedule').boundingBox()).y < 600, 'ordinary Settings reaches Schedule in the first 720px screen');
    assert.equal(await page.locator('.settings-weather-card').getByRole('combobox', { name: 'Time format', exact: true }).count(), 0);
    assert.equal(await page.locator('.settings-preferences-card').getByRole('combobox', { name: 'Time format', exact: true }).count(), 1);
    for (const link of await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link').all()) {
      const href = await link.getAttribute('href');
      await link.click();
      assert.equal(await page.locator(href).evaluate(element => document.activeElement === element), true);
    }
    await units().selectOption('imperial');
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Weather', exact: true }).click();
    assert.equal(await units().inputValue(), 'imperial');
    await button('Cancel').click();
    if (capture) { await page.evaluate(() => scrollTo(0, 0)); await page.waitForFunction(() => scrollY === 0); images.push({ name: 'settings-groups-desktop', bytes: await page.screenshot() }); }
    record('Section links focus their destinations without losing drafts, and time/units live in their own compact group');

    for (const viewport of [{ width: 1280, height: 720 }, { width: 320, height: 480 }, { width: 640, height: 300 }]) {
      await open('/settings', viewport);
      const search = page.getByRole('searchbox', { name: 'Find a setting', exact: true });
      await search.fill('birthday'); await search.press('Enter');
      assert.equal(await page.locator('#settings-birthdays').evaluate(element => element === document.activeElement), true);
      assert.equal(await page.locator('.birthday-settings').getAttribute('open'), null, 'search only navigates');
      assert.equal(saved().birthdays.length, 0);
      await page.keyboard.press('Enter'); await button('Add birthday').click();
      const name = page.getByRole('textbox', { name: 'Name', exact: true });
      const month = page.getByRole('combobox', { name: 'Month', exact: true });
      const day = page.getByRole('combobox', { name: 'Day', exact: true });
      const treatment = page.getByRole('combobox', { name: 'Treatment', exact: true });
      assert.equal(await name.evaluate(element => element === document.activeElement), true, 'Add focuses the new name');
      assert.equal(await button('Save changes').isEnabled(), false, 'incomplete entry cannot save');
      await name.fill('Birthday A'); await month.selectOption('02'); await day.selectOption('31');
      await page.getByText('This month does not have 31 days. Choose another day.', { exact: true }).waitFor();
      assert.equal(await day.inputValue(), '31', 'invalid day remains editable');
      assert.equal(await button('Save changes').isEnabled(), false);
      assert.ok((await page.locator('.settings-savebar').boundingBox()).height <= 80, 'concise birthday cue avoids the former109px compact error bar');
      assert.match(await day.evaluate(element => document.getElementById(element.getAttribute('aria-describedby'))?.textContent), /31 days/, 'full date reason stays associated with the field');
      await day.selectOption('29');
      await page.getByText('February 29 birthdays appear only in leap years.', { exact: true }).waitFor();
      await month.selectOption('06'); await day.selectOption('12'); await treatment.selectOption('korean');
      assert.equal(await page.getByText('February 29 birthdays appear only in leap years.', { exact: true }).count(), 0);
      for (const target of [name, month, day, treatment, button('Remove from draft'), button('Add birthday')]) {
        await target.focus(); await reachable(target, `${viewport.width}: birthday control clears Save/Cancel`);
        assert.ok((await target.boundingBox()).height >= 44, 'birthday targets stay44px');
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(saved().birthdays.length, 0, 'all entry edits stay draft-only');
      if (capture) images.push({ name: `birthday-settings-${viewport.width}`, bytes: await page.screenshot() });
      await button('Cancel').click(); await clean(); assert.equal(await page.locator('.birthday-entry').count(), 0);
      await button('Add birthday').click(); await name.fill('Birthday A'); await month.selectOption('01'); await day.selectOption('10'); await treatment.selectOption('russian');
      const patches = []; const collect = request => { if (new URL(request.url()).pathname === '/api/settings' && request.method() === 'PATCH') patches.push(request.postDataJSON()); };
      page.on('request', collect); await button('Save changes').click(); await clean(); page.off('request', collect);
      assert.equal(patches.length, 1); assert.deepEqual(Object.keys(patches[0]), ['birthdays'], 'birthday save is field-scoped');
      assert.equal(saved().birthdays.length, 1); assert.equal(saved().birthdays[0].date, '01-10');
      await button('Remove from draft').click();
      assert.equal(await button('Add birthday').evaluate(element => element === document.activeElement), true, 'Remove focuses the surviving Add control');
      assert.equal(saved().birthdays.length, 1); await button('Cancel').click(); await clean();
      assert.equal(await page.locator('.birthday-entry').count(), 1, 'Cancel restores removed entry');
      await page.locator('.birthday-entry-toggle').click(); await button('Remove from draft').click(); await button('Save changes').click(); await clean();
      assert.deepEqual(saved().birthdays, []);
    }
    record('Global birthdays use search,44px compact controls,editable invalid dates and leap-day help; Add/edit/remove stay cancellable and save only their field');

    await open('/settings'); await page.locator('#settings-birthdays').click(); await button('Add birthday').click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Birthday A');
    await page.getByRole('combobox', { name: 'Month', exact: true }).selectOption('01');
    await page.getByRole('combobox', { name: 'Day', exact: true }).selectOption('10');
    await button('Save changes').click(); await clean();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Birthday A edited');
    let race = true;
    await page.route('**/api/settings', async route => {
      if (race && route.request().method() === 'PATCH') {
        race = false;
        await app.store.update(data => {
          data.settings.birthdays[0].treatment = 'korean';
          data.settings.birthdays.push({ id: '00000000-0000-4000-8000-000000000585', name: 'Birthday B', date: '01-10', treatment: 'russian' });
          data.settings.units = 'imperial';
        });
      }
      await route.continue();
    });
    await button('Save changes').click(); await page.getByRole('alert').filter({ hasText: 'Review your edits' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'Birthday A edited');
    assert.equal(await page.getByRole('combobox', { name: 'Treatment', exact: true }).inputValue(), 'korean');
    assert.equal(await page.locator('.birthday-entry').count(), 2);
    await page.getByText('Birthdays sharing a date use Classic when their treatments differ.', { exact: true }).waitFor();
    await page.unroute('**/api/settings');
    await page.route('**/api/settings', route => route.fulfill({ status: 503, json: { error: 'Synthetic birthday save unavailable' } }));
    await button('Save changes').click(); await page.getByRole('alert').filter({ hasText: 'Synthetic birthday save unavailable' }).waitFor();
    assert.equal(await page.locator('.birthday-entry').count(), 2);
    await page.unroute('**/api/settings'); await button('Save changes').click(); await clean();
    assert.equal(saved().birthdays[0].name, 'Birthday A edited'); assert.equal(saved().birthdays[0].treatment, 'korean');
    assert.equal(saved().birthdays.length, 2); assert.equal(saved().units, 'imperial');
    record('Birthday stale-save review merges names,treatments and remote additions byID; failed retry retains the list and unrelated saved preferences');

    for (const viewport of [{ width: 1280, height: 480 }, { width: 390, height: 640 }, { width: 320, height: 480 }]) {
      await open('/settings', viewport);
      await app.store.update(data => { data.settings.savedPresets = [{ id: 'layout-check', name: 'Layout check', visual: getVisual(data.settings) }]; });
      await page.reload(); await units().waitFor();
      await units().selectOption('imperial');
      await page.locator('.schedule-disclosure > summary').click();
      await button('Add schedule row').click();
      await page.getByRole('checkbox', { name: 'Monday', exact: true }).check();
      await page.getByLabel('From', { exact: true }).fill('08:00');
      await page.getByLabel('Until', { exact: true }).fill('12:00');
      const search = page.getByRole('searchbox', { name: 'Find a setting', exact: true });
      await search.fill('temperature'); await search.press('Enter');
      assert.equal(await units().inputValue(), 'imperial');
      assert.equal(await page.getByLabel('From', { exact: true }).inputValue(), '08:00');
      assert.equal(await page.getByLabel('Until', { exact: true }).inputValue(), '12:00');
      await page.keyboard.press('Control+End');
      await reachable(button('Restore from backup…'), `${viewport.width}: expanded schedule recovery clears the dirty savebar`);
      // Keep the earlier pointer interaction from holding unrelated hover help over Tab targets.
      await page.mouse.move(0, 0);
      await units().focus();
      let reachedSave = false;
      for (let count = 0; count < 60; count++) {
        await page.keyboard.press('Tab');
        const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent, label: document.activeElement?.getAttribute('aria-label') }));
        assert.notEqual(active.tag, 'BODY', `${viewport.width}: Tab retains a page control at step ${count}: ${JSON.stringify(active)}`);
        const focused = await page.evaluateHandle(() => document.activeElement);
        await reachable(focused, `${viewport.width}: focused ${active.tag} ${active.label ?? active.text?.slice(0, 30)} stays clear of the savebar`);
        await focused.dispose();
        if (active.text === 'Save changes') { reachedSave = true; break; }
      }
      assert.ok(reachedSave, `${viewport.width}: keyboard reaches Save changes after the expanded form`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${viewport.width}: expanded schedule reflows`);
      if (capture) images.push({ name: `settings-expanded-${viewport.width}`, bytes: await page.screenshot({ fullPage: true }) });
      await button('Cancel schedule edits').click();
      assert.equal(await units().inputValue(), 'imperial', 'canceling the schedule keeps the independent settings draft');
      await button('Cancel').click(); await clean();
    }
    record('Expanded schedule rows reflow, keyboard focus and lower controls clear the dirty savebar, and each draft cancels independently');
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
    await page.waitForFunction(() => document.activeElement?.textContent === 'Save changes');
    assert.equal(await units().inputValue(), 'metric'); assert.equal(saved().units, 'imperial');
    await button('Save changes').click(); await page.getByRole('alert').filter({ hasText: 'Synthetic save unavailable' }).waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent === 'Save changes');
    await page.unroute('**/api/settings');
    let releaseFailure; const heldFailure = new Promise(resolve => { releaseFailure = resolve; });
    await page.route('**/api/settings', async route => { await heldFailure; await route.fulfill({ status: 503, json: { error: 'Synthetic delayed failure' } }); });
    await button('Save changes').click(); await button('Saving…').waitFor(); await units().focus(); releaseFailure();
    await page.getByRole('alert').filter({ hasText: 'Synthetic delayed failure' }).waitFor();
    assert.equal(await units().evaluate(element => element === document.activeElement), true, 'failure keeps a different control deliberately chosen during the request');
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
    await page.waitForFunction(() => document.querySelector('select')?.value === 'imperial');
    assert.equal(await units().inputValue(), 'imperial');
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
    await context.close();
    const manual = defaultSettings(); manual.preview.enabled = false;
    manual.location = { name: 'Synthetic manual area', latitude: 48.1, longitude: -78.1, timezone: 'America/Toronto' };
    manual.locationSource = 'manual';
    for (const id of Object.keys(manual.widgets)) manual.widgets[id] = id === 'weather';
    const visual = getVisual(manual); visual.widgets.weather = false; visual.widgets.clock = true;
    manual.savedPresets = [{ id: 'no-weather', name: 'Clock only', visual }];
    await app.store.update(data => { data.settings = manual; });
    assert.equal(saved().location.name, 'Synthetic manual area', 'the uncached manual location is retained');
    assert.equal(saved().widgets.weather, true, 'the manual board still needs weather after making the independent saved visual');
    assert.equal(saved().widgets.clock, false);
    assert.equal(saved().savedPresets[0].visual.widgets.weather, false);
    assert.equal((await fetch(base + '/api/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, fallbackPresetId: 'no-weather', rules: [] }) })).status, 200);
    context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' }); await keepPagesLocal(context, base);
    page = await context.newPage(); const beforeProviders = providerCalls;
    await page.goto(base + '/'); await page.locator('.home-page').waitFor(); assert.equal(providerCalls, beforeProviders, 'Home does not fetch a provider hidden by the scheduled board');
    let editorHint = false; page.on('request', request => { if (new URL(request.url()).pathname === '/api/state' && request.headers()['x-lrd-view'] === 'editor') editorHint = true; });
    const beforeManual = structuredClone(saved());
    await page.goto(base + '/editor'); await page.locator('.preview-surface .current-temperature').waitFor();
    assert.equal(editorHint, true); assert.ok(providerCalls > beforeProviders); assert.deepEqual(saved(), beforeManual);
    record('The manual editor explicitly requests its weather hidden by a scheduled board, while Home remains effective-only and saved settings do not change');
    assert.deepEqual(errors, []); return { checks, images, seconds: Math.round((Date.now() - started) / 1000) };
  } catch (error) { console.log(JSON.stringify({ checksCompleted: checks.length, errors, page: await page.locator('body').innerText().catch(() => '') })); throw error; }
  finally { await browser.close(); app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runSettingsQa(values); console.log(JSON.stringify({ passed: result.checks.length, seconds: result.seconds, checks: result.checks }, null, 2));
}
