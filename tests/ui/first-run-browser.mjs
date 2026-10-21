// First-run location card (#252, #310, #349), the Weather tab's Time & units (#235) and inspector names (#241)
// in the production build. Own ephemeral loopback server and data; synthetic location, geocoding and
// reminders; screenshots stay in RAM.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { defaultWidgetGrid, defaultWidgetVisibility } from '../../src/shared/widgets.ts';

const CITIES = { results: [{ id: 201, name: 'London', latitude: 51.5, longitude: -0.1, timezone: 'Europe/London', admin1: 'England', country: 'United Kingdom' }] };

export async function runFirstRunQa({ playwright, edge } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-first-run-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const now = Date.parse('2026-10-18T13:00:00Z'); // Sunday 09:00 in Toronto
  const app = await createApplication({
    dataDirectory: directory, clientDirectory: join(root, 'dist/client'), now: () => now,
    fetcher: async input => new URL(input).hostname === 'geocoding-api.open-meteo.com' ? Response.json(CITIES) : Response.json(forecastFixture()),
  });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  let context, page;
  const button = name => page.getByRole('button', { name, exact: true });
  const card = () => page.locator('.first-run-card');
  const savebar = () => page.locator('.studio-savebar');
  const at = new Date(now).toISOString();
  const synthetic = [
    { id: '00000000-0000-4000-8000-000000000001', text: 'Water the plants', completed: false, dueAt: '2026-10-18T22:00:00.000Z', createdAt: at, updatedAt: at },
    { id: '00000000-0000-4000-8000-000000000002', text: 'Call a friend', completed: false, dueAt: null, createdAt: at, updatedAt: at },
    { id: '00000000-0000-4000-8000-000000000003', text: 'Plan the weekend', completed: false, dueAt: null, createdAt: at, updatedAt: at },
  ];
  async function reset(update = () => {}) {
    await app.store.update(data => { data.settings = defaultSettings(); data.reminders = structuredClone(synthetic); update(data.settings); });
  }
  /** `geo` answers an explicit lookup: success, denied, or none (permission is "prompt" either way). */
  async function open({ viewport = { width: 1280, height: 720 }, geo = 'success', fresh = true } = {}) {
    if (fresh) { await context?.close(); context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', locale: 'en-US', reducedMotion: 'reduce' }); }
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(geo => {
      Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } });
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (success, failure) => geo === 'denied' ? failure({ code: 1 }) : success({ coords: { latitude: 43.71234, longitude: -79.41234, accuracy: 50 } }) } });
    }, geo);
    await page.clock.install({ time: new Date(now) });
    await page.goto(base + '/editor'); await button('Edit layout').waitFor(); await page.clock.runFor(500);
  }
  async function tab(name) { await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click(); await page.clock.runFor(200); }
  const panelFit = () => page.locator('.inspector-panel').evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
  try {
    // 1. Fresh data: the card sits above the tabs with the default Widgets tab, and every tab still
    // fits at 1280×720 (Style has no spare height, Weather holds the same actions, so it steps aside).
    await reset(); await open();
    await card().waitFor();
    assert.equal(await card().getByRole('heading').innerText(), 'Showing Toronto weather');
    const [cardBox, tabsBox] = [await card().boundingBox(), await page.getByRole('tablist').boundingBox()];
    assert.ok(cardBox.y + cardBox.height <= tabsBox.y, 'the card is above the tabs');
    assert.equal(await page.getByRole('tab', { selected: true }).innerText(), 'Widgets', 'Widgets is the default tab');
    let fit = await panelFit();
    assert.ok(fit.scroll <= fit.client + 1, `the default Widgets tab fits at 1280×720 with the card: ${JSON.stringify(fit)}`);
    images.push({ name: 'first-run-1280x720', bytes: await page.screenshot() });
    for (const name of ['Style', 'Weather', 'Reminders']) {
      await tab(name);
      assert.equal(await card().count(), 0, `the card steps aside on ${name}`);
      fit = await panelFit();
      assert.ok(fit.scroll <= fit.client + 1, `${name} fits at 1280×720: ${JSON.stringify(fit)}`);
    }
    // The picker is a focused mode: the card is hidden while it is open.
    await tab('Widgets'); await card().waitFor(); await button('Add widget').click();
    assert.equal(await card().count(), 0, 'hidden while the picker is open');
    await page.keyboard.press('Escape'); await card().waitFor();
    checks.push(`fresh data: card above the tabs (${Math.round(cardBox.height)} px) with the default Widgets tab, which still fits at 1280×720; Style, Weather and Reminders show no card and fit; hidden while the picker is open`);

    // 2. "Use my location" is a draft: Save appears, Cancel restores the default.
    await button('Use my location').click(); await page.clock.runFor(100);
    await savebar().waitFor();
    assert.equal(await card().locator('[role="status"]').innerText(), 'Your area is ready. Save changes to use it.');
    await button('Cancel').click(); await savebar().waitFor({ state: 'detached' });
    assert.equal(await card().locator('[role="status"]').innerText(), '', 'Cancel restores the card');
    assert.equal(app.store.snapshot().settings.locationSource, 'fallback', 'nothing was saved');
    await open({ geo: 'denied' });
    await button('Use my location').click(); await page.clock.runFor(100);
    assert.equal(await card().locator('[role="status"]').innerText(), 'Location is blocked in this browser. Choose a city instead.');
    assert.equal(await savebar().count(), 0);
    checks.push('“Use my location” makes a draft (“Your area is ready…”) that Cancel restores; a blocked lookup says so and changes nothing');

    // 3. "Choose a city" opens the Weather tab with the City field focused; Save hides the card for good.
    await button('Choose a city').click(); await page.clock.runFor(100);
    assert.equal(await page.getByRole('tab', { selected: true }).innerText(), 'Weather');
    const city = page.getByRole('combobox', { name: 'City', exact: true });
    assert.equal(await city.evaluate(element => element === document.activeElement), true, 'the City field is focused');
    // #241: the field's name is its visible label; searching is its description.
    assert.match(await page.locator(`[id="${await city.getAttribute('aria-describedby')}"]`).textContent(), /search/i);
    await page.keyboard.type('Lon'); await page.clock.runFor(300);
    await page.getByRole('option').first().waitFor();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await savebar().waitFor();
    await tab('Widgets');
    assert.equal(await card().locator('[role="status"]').innerText(), 'London is ready. Save changes to use it.');
    await button('Save changes').click(); await savebar().waitFor({ state: 'detached' });
    await tab('Widgets');
    assert.equal(await card().count(), 0, 'gone after a saved location');
    assert.equal(app.store.snapshot().settings.locationSource, 'manual');
    await page.reload(); await button('Edit layout').waitFor(); await page.clock.runFor(300);
    assert.equal(await card().count(), 0, 'stays gone after reload');
    checks.push('“Choose a city” opens Weather with the City field (named “City”, described as a search) focused; a chosen city is a draft the card names; Save hides the card through reload');

    // 4. Dismissal lives in this browser only; the saved data gains no key.
    await reset(); await open();
    // #438: Home says the same in one line, whose link opens Edit display's Weather tab with City focused.
    await page.goto(base + '/'); await page.locator('.home-page').waitFor();
    const homeLine = page.locator('.home-first-run');
    assert.equal((await homeLine.textContent()).replace(/\s+/g, ' ').trim(), 'Weather shows Toronto until you choose your city. Choose your city');
    await homeLine.getByRole('link', { name: 'Choose your city' }).click();
    await page.waitForURL(`${base}/editor`); await page.waitForFunction(() => document.activeElement?.id === 'city-search');
    assert.equal(await page.getByRole('tab', { name: 'Weather', exact: true }).getAttribute('aria-selected'), 'true');
    await tab('Widgets');
    const before = JSON.stringify(app.store.snapshot().settings);
    await button('Hide location tip').click();
    assert.equal(await card().count(), 0);
    assert.equal(await savebar().count(), 0, 'dismissal is not a settings change');
    assert.equal(JSON.stringify(app.store.snapshot().settings), before, 'no persisted key');
    await page.reload(); await button('Edit layout').waitFor(); await page.clock.runFor(300);
    assert.equal(await card().count(), 0, 'dismissal survives a reload in this browser');
    await page.goto(base + '/'); await page.locator('.home-page').waitFor();
    assert.equal(await page.locator('.home-first-run').count(), 0, 'Home shares the dismissal');
    await page.goto(base + '/editor'); await button('Edit layout').waitFor(); await page.clock.runFor(300);
    for (const name of ['Style', 'Widgets', 'Weather', 'Reminders']) {
      await tab(name); fit = await panelFit();
      assert.ok(fit.scroll <= fit.client + 1, `${name} fits at 1280×720 without the card: ${JSON.stringify(fit)}`);
    }
    await open(); // A new browser profile has no dismissal.
    await card().waitFor();
    checks.push('“Hide location tip” is stored in browser storage only (saved settings byte-identical, no Save bar), survives reload, and a new browser profile shows the card; every tab fits at 1280×720 without it; Home shows the same tip as one line whose link opens Weather with City focused, and shares the dismissal (#438)');

    // 5. #349: every card control is a 44 px target (Hide location tip 44 × 44) at 1280×720 and 390 px,
    // where the card stacks above the tabs without horizontal overflow.
    const targets = () => card().evaluate(element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, width: innerWidth, page: document.documentElement.scrollWidth,
        controls: [...element.querySelectorAll('button')].map(control => { const r = control.getBoundingClientRect(); return { name: control.getAttribute('aria-label') || control.textContent.trim(), inside: r.left >= box.left - 1 && r.right <= box.right + 1, width: r.width, height: r.height }; }) };
    });
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await open({ viewport });
      await card().scrollIntoViewIfNeeded();
      const found = await targets();
      assert.ok(found.left >= 0 && found.right <= found.width && found.page <= found.width, JSON.stringify(found));
      assert.deepEqual(found.controls.map(control => control.name), ['Hide location tip', 'Use my location', 'Choose a city']);
      for (const control of found.controls) assert.ok(control.inside && control.height >= 44 && (control.name !== 'Hide location tip' || control.width >= 44), `${viewport.width}: ${JSON.stringify(control)}`);
      if (viewport.width === 390) images.push({ name: 'first-run-390', bytes: await page.screenshot() });
    }
    checks.push('1280×720 and 390×844: the card’s controls are 44 px targets (Hide location tip 44 × 44) and fit the width with no horizontal scroll (#349)');

    // 6. #435 adds Calendar to the old five-row default. Keep #310's original compact-board
    // guarantees, and bound the six-row board's extra scroll to that one row without smaller targets.
    for (const currentBoard of [true, false]) {
      await reset(settings => {
        if (!currentBoard) { settings.widgets = defaultWidgetVisibility(); settings.widgetGrid = defaultWidgetGrid(); }
      });
      for (const viewport of [{ width: 1280, height: 600 }, { width: 1024, height: 600 }, { width: 760, height: 600 }]) {
        await open({ viewport });
        fit = await panelFit();
        const height = (await card().boundingBox()).height;
        const rows = page.locator('.widget-option');
        assert.equal(await rows.count(), currentBoard ? 6 : 5);
        const rowPitch = await rows.evaluateAll(elements => elements[1].getBoundingClientRect().top - elements[0].getBoundingClientRect().top);
        if (viewport.width === 1280) assert.ok(fit.scroll <= fit.client + (currentBoard ? rowPitch : 0) + 1, `${currentBoard ? 'six' : 'five'}-row Widgets at 1280x600 with the card: ${JSON.stringify(fit)}`);
        else assert.ok(fit.scroll - fit.client < height + (currentBoard ? rowPitch : 0), `${viewport.width}x600 stays within the card${currentBoard ? ' plus one added row' : ''}: ${JSON.stringify(fit)}`);
        // The scroll stays inside the panel; every select/remove action can be focused and hit.
        const reachable = async () => {
          for (const control of await page.locator('.widget-row button, .add-widget').all()) {
            await control.focus(); await control.scrollIntoViewIfNeeded();
            const box = await control.boundingBox(), panel = await page.locator('.inspector-panel').boundingBox();
            assert.ok(box.width >= 44 && box.height >= 44 && box.y >= panel.y - 1 && box.y + box.height <= panel.y + panel.height + 1, `${viewport.width}: control is reachable: ${JSON.stringify({ box, panel })}`);
            assert.equal(await control.evaluate(element => { const r = element.getBoundingClientRect(); return element === document.activeElement && element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, 'the control has keyboard focus and an unobscured pointer target');
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1), true, 'scroll remains inside the inspector, without body overflow');
        };
        await reachable();
        await button('Hide location tip').click(); fit = await panelFit();
        assert.ok(fit.scroll <= fit.client + (currentBoard ? rowPitch : 0) + 1, `${viewport.width}x600 ${currentBoard ? 'has at most one row of scroll' : 'fits'} without the card: ${JSON.stringify(fit)}`);
        await reachable();
      }
    }
    checks.push('at 600px high, the six-row default adds at most one row of internal scroll to the five-row #310 contract; all row controls remain 44px, focusable, unobscured and reachable at 1280/1024/760px; hiding the tip leaves at most one row of scroll; the original five-row no-scroll/less-than-card checks still pass');

    // 7. #235 and #241: Time format beside Units with the Clock off; the Reminders tab names its count.
    await reset(settings => { settings.widgets.clock = false; settings.locationSource = 'manual'; });
    await open();
    assert.equal(await page.getByRole('tab', { name: 'Reminders, 3 pending', exact: true }).count(), 1, 'the tab count is named');
    assert.equal(await page.locator('#tab-Reminders .tab-count').textContent(), '3');
    await tab('Weather');
    const group = page.getByRole('group', { name: 'Time & units', exact: true });
    assert.equal(await group.getByRole('combobox', { name: 'Units', exact: true }).count(), 1);
    const format = group.getByRole('combobox', { name: 'Time format', exact: true });
    assert.equal(await format.inputValue(), '12h');
    const canvasReminders = page.locator('.preview-frame [data-widget-id="reminders"]');
    assert.match(await canvasReminders.innerText(), /6:00\sPM/);
    await format.selectOption('24h'); await savebar().waitFor();
    assert.match(await canvasReminders.innerText(), /18:00/, 'the canvas follows the draft format');
    await tab('Reminders');
    assert.match(await page.locator('.reminders-panel').innerText(), /Today · 18:00/, 'the editor list follows the draft format');
    await button('Cancel').click(); await savebar().waitFor({ state: 'detached' });
    assert.match(await canvasReminders.innerText(), /6:00\sPM/);
    await tab('Weather'); await page.getByRole('combobox', { name: 'Time format', exact: true }).selectOption('24h');
    await button('Save changes').click(); await savebar().waitFor({ state: 'detached' });
    assert.equal(app.store.snapshot().settings.clockFormat, '24h');
    checks.push('with the Clock removed, Weather → Time & units holds Time format beside Units; 24-hour updates the editor list and canvas as a draft, Cancel restores and Save persists (#235); the Reminders tab is named “Reminders, 3 pending” (#241)');

    assert.deepEqual(errors, []);
    return { checks, images };
  } finally {
    await context?.close(); await browser.close();
    app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runFirstRunQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks }, null, 2));
}
