import { mockWindowsStatus } from './lib/windows-fixture.mjs';
// Calendar, Countdown and Note (#78): grouped picker, settings panels and draft behaviour in the
// production build. Own ephemeral loopback server and data; synthetic content; screenshots stay in RAM.
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
import { ACTIVE_WIDGET_IDS, WIDGET_CATALOG, WIDGET_CATEGORIES, fitWidgetFamily, widgetSizes, widgetSpan } from '../../src/shared/widgets.ts';
import { addToGrid } from '../../src/client/make-room.ts';

/** The picker's grouped order (#154): WIDGET_CATEGORIES order, catalog order inside each group. */
const GROUPED = Object.keys(WIDGET_CATEGORIES).flatMap(category => ACTIVE_WIDGET_IDS.filter(id => WIDGET_CATALOG[id].category === category));
/** A picker item's name carries its added state (#241). */
const itemName = (id, widgets) => `Preview ${WIDGET_CATALOG[id].name}${widgets[id] ? ', on your display' : ''}`;
/** The 2026-10-19 QA board (#238): the catalog board (the default before #435) plus Calendar, World clocks, Sun & moon and Air quality. */
function qaBoard(settings) {
  for (const id of ['calendar', 'worldClocks', 'sunMoon', 'airQuality']) {
    settings.widgetGrid = addToGrid(settings.widgetGrid, id, WIDGET_CATALOG[id].defaultSize, settings.widgets); settings.widgets[id] = true;
  }
  settings.locationSource = 'manual';
}

export async function runCatalogTimeQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-catalog-time-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const now = Date.parse('2026-10-18T13:00:00Z'); // Sunday 09:00 in Toronto
  const app = await createApplication({ dataDirectory: directory, clientDirectory: join(root, 'dist/client'), now: () => now, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  let context, page;
  const button = name => page.getByRole('button', { name, exact: true });
  const savebar = () => page.locator('.studio-savebar');
  const saveStatus = () => page.locator('.studio-savebar .save-status');
  const canvas = id => page.locator(`.preview-frame [data-widget-id="${id}"]`);
  const snapshot = () => app.store.snapshot().settings;
  /**
   * Most flows here add widgets, so they start from the catalog board, which has free cells. The
   * #435 default board fills the grid; the picker sections pass `defaultSettings` to check it.
   */
  async function reset(update = () => {}, board = catalogBoardDefaults) {
    await app.store.update(data => { data.settings = board(); data.reminders = []; update(data.settings); });
  }
  async function open({ viewport = { width: 1440, height: 1000 }, route = '/editor' } = {}) {
    await context?.close();
    context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', locale: 'en-US', reducedMotion: 'reduce' }); await mockWindowsStatus(context);
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
    await page.clock.install({ time: new Date(now) });
    await page.goto(base + route);
    if (route === '/editor') await button('Edit layout').waitFor(); else await page.locator('.display-page').waitFor();
    await page.clock.runFor(500);
  }
  async function tab(name) { await page.getByRole('tab', { name, exact: true }).click(); await page.clock.runFor(200); }
  async function save() { await button('Save changes').click(); await savebar().waitFor({ state: 'detached' }); }
  async function cancel() { await button('Cancel').click(); await savebar().waitFor({ state: 'detached' }); }
  async function addFromPicker(name) {
    await tab('Widgets'); await button('Add widget').click();
    await button(`Preview ${name}`).click(); await button(`Add ${name}`).click();
    await page.locator('.widget-picker').waitFor({ state: 'detached' });
  }
  async function inspector(name) {
    await tab('Widgets');
    const row = page.locator('.widget-option').filter({ has: page.getByRole('button', { name, exact: true }) });
    if (await row.getAttribute('class').then(value => !value.includes('selected'))) await button(name).click();
    return row;
  }
  async function inView(locator, label) {
    const box = await locator.boundingBox(), viewport = page.viewportSize();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${label} must fit the viewport: ${JSON.stringify(box)}`);
  }
  try {
    // 1. Grouped picker on the #435 default board: categories in WIDGET_CATEGORIES order, only active
    // widgets, keyboard navigation.
    await reset(() => {}, defaultSettings); await open();
    await tab('Widgets'); await button('Add widget').click();
    const defaults = defaultSettings().widgets;
    const groups = await page.locator('.widget-catalog .catalog-group').evaluateAll(nodes => nodes.map(node => ({
      label: node.querySelector('.catalog-group-label').textContent, labelled: node.getAttribute('aria-labelledby') === node.querySelector('.catalog-group-label').id && node.getAttribute('role') === 'group',
      items: [...node.querySelectorAll('.catalog-item')].map(item => item.getAttribute('aria-label')),
    })));
    const expected = Object.entries(WIDGET_CATEGORIES).map(([category, label]) => ({ label, labelled: true, items: ACTIVE_WIDGET_IDS.filter(id => WIDGET_CATALOG[id].category === category).map(id => itemName(id, defaults)) })).filter(group => group.items.length);
    assert.deepEqual(groups, expected);
    assert.deepEqual(groups.map(group => group.label), ['Time', 'Weather & sky', 'Personal', 'Pictures']);
    for (const id of ['calendar', 'countdown', 'note']) assert.ok(groups.flatMap(group => group.items).includes(itemName(id, defaults)), id);
    assert.equal(itemName('calendar', defaults), 'Preview Calendar, on your display', 'Calendar is on the default board (#435)');
    // Rain is part of the adaptive Weather since #74, so the group lists Weather and never Rain.
    assert.ok(groups.find(group => group.label === 'Weather & sky').items.includes('Preview Weather, on your display'), 'Weather & sky lists Weather, named as added (#241)');
    assert.equal(groups.flatMap(group => group.items).some(item => item.startsWith('Preview Rain')), false, 'Rain is not offered (#74)');
    // #154: the initial selection is the first widget not on the display in the grouped order.
    const firstUnadded = GROUPED.find(id => !defaults[id]);
    assert.equal(await page.locator('.catalog-item[aria-pressed="true"]').getAttribute('aria-label'), itemName(firstUnadded, defaults), 'opens on the first unadded widget in grouped order');
    assert.equal(await page.locator('.picker-detail h3').innerText(), WIDGET_CATALOG[firstUnadded].name);
    // #241: the Add button's name is its visible text, also while disabled for an added widget.
    const addButton = page.locator('.picker-add');
    assert.equal(await addButton.getAttribute('aria-label'), null);
    assert.equal((await addButton.innerText()).trim(), `Add ${WIDGET_CATALOG[firstUnadded].name}`);
    assert.equal(await button(`Add ${WIDGET_CATALOG[firstUnadded].name}`).isEnabled(), true);
    await button(itemName('clock', defaults)).click();
    assert.equal((await addButton.innerText()).trim(), 'Add Clock');
    assert.equal(await button('Add Clock').isDisabled(), true, 'the disabled button is found by its visible text');
    assert.equal(await page.locator('#picker-added-note').innerText(), 'Clock is on your display');
    assert.equal(await addButton.getAttribute('aria-describedby'), 'picker-added-note');
    const order = groups.flatMap(group => group.items);
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    await button(order[0]).focus();
    await page.keyboard.press('ArrowDown'); assert.equal(await focused(), order[1]);
    assert.equal(await button(order[1]).getAttribute('aria-pressed'), 'true', 'the focused widget is previewed');
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); assert.equal(await focused(), order[0], 'Up stops at the first widget');
    await page.keyboard.press('End'); assert.equal(await focused(), order.at(-1));
    await page.keyboard.press('ArrowDown'); assert.equal(await focused(), order.at(-1), 'Down stops at the last widget');
    await page.keyboard.press('Home'); assert.equal(await focused(), order[0]);
    await page.keyboard.press('ArrowRight'); assert.equal(await focused(), order[1], 'Right follows the narrow three-column reading order');
    await page.keyboard.press('ArrowLeft'); assert.equal(await focused(), order[0]);
    const groupBoundary = groups[0].items.length;
    await button(order[groupBoundary - 1]).focus(); await page.keyboard.press('ArrowDown'); assert.equal(await focused(), order[groupBoundary], 'Down crosses into the next group');
    // #348: the rail is one roving tab stop, the previewed widget; Tab leaves it for the sizes.
    const tabStops = () => page.locator('.catalog-item').evaluateAll(items => items.filter(item => item.tabIndex === 0).map(item => item.getAttribute('aria-label')));
    assert.deepEqual(await tabStops(), [order[groupBoundary]], 'only the previewed widget takes Tab');
    const nextName = WIDGET_CATALOG[GROUPED[groupBoundary]].name;
    await page.keyboard.press('Tab'); assert.equal(await focused(), `${nextName} ${widgetSizes(GROUPED[groupBoundary])[0]}`, 'Tab goes from the rail to the size buttons');
    await page.keyboard.press('Shift+Tab'); assert.equal(await focused(), order[groupBoundary], 'Shift+Tab returns to the previewed widget');
    assert.equal(await page.locator('.catalog-item[data-widget-id]').count(), 0, 'rail items carry no data-widget-id (#310)');
    // Search and the availability filter add two stops before the one-stop rail and size choices.
    // From Close, Add is at most seven Tab presses away (a widget not yet
    // on the display, so Add is enabled).
    await button(itemName(firstUnadded, defaults)).click();
    await button('Close widget picker').focus();
    const path = [];
    const named = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent.trim());
    for (let press = 0; press < 7 && !path.at(-1)?.startsWith('Add '); press++) { await page.keyboard.press('Tab'); path.push(await named()); }
    assert.equal(path.at(-1), `Add ${WIDGET_CATALOG[firstUnadded].name}`, `Add is reached in at most seven Tab presses: ${path.join(' > ')}`);
    assert.deepEqual(path.slice(0, 3), ['Search widgets', 'Filter widgets', itemName(firstUnadded, defaults)], 'search and filter precede the one rail tab stop');
    await button(itemName('preview', defaults)).click();
    assert.equal(await page.locator('.picker-detail-heading p').innerText(), 'A dim picture of your screen from just before the display starts', 'plain Last screen description (#281)');
    await button(itemName('calendar', defaults)).click(); assert.equal(await button('Calendar medium').getAttribute('aria-pressed'), 'true', 'Calendar is added at medium');
    assert.match(await page.locator('.picker-detail').innerText(), /This month at a glance/);
    await page.locator('.picker-sample .ambient-calendar').first().waitFor();
    assert.equal(await page.locator('.picker-sample .calendar-grid td[aria-current="date"]').innerText(), '18', 'the sample marks today (#361)');
    assert.equal(await page.locator('.sample-footprint').innerText(), '4 × 2 cells of 12 × 8', 'the footprint names the family and the board');
    await button('Preview Countdown').click();
    assert.match(await page.locator('.picker-sample').innerText(), /12\s*days\s*Weekend trip/);
    await button('Preview Note').click();
    assert.equal((await page.locator('.picker-sample .note-text').innerText()).trim(), 'Dinner at seven');
    // The #73 free-size caption follows the catalog rule: none for these fixed-family widgets, kept for Reminders.
    assert.equal(await page.locator('.picker-free-size').count(), 0, 'fixed-family widgets show no free-size caption');
    await button(itemName('reminders', defaults)).click();
    // #238/#183: the full default board (#435) has room for a full-height column only once Clock is smaller.
    assert.equal(await page.locator('.picker-free-size').innerText(), 'Resize freely. Full height needs room first: make Clock smaller.', 'Reminders keeps its caption, qualified for this board');
    assert.match(await page.locator('.picker-footnote').innerText(), /Sample content/);
    if (capture) images.push({ name: 'picker-1440', bytes: await page.screenshot() });
    await page.keyboard.press('Escape');
    checks.push('Grouped picker on the #435 default board: Time / Weather & sky / Personal / Pictures in catalog order with labelled groups, Calendar named as on your display, Weather and no Rain (#74), opens on the first unadded widget in that order (#154), item names carry the added state and Add names match their visible text (#241), Up/Down/Home/End (clamped, across groups) preview the focused widget, the rail is one roving tab stop and Add is within five Tab presses of Close (#348), no data-widget-id on rail items (#310), plain Last screen description (#281), synthetic samples for the three widgets with today marked and the footprint named (#361), free-size caption only for Reminders, qualified when a column has no room (“make Clock smaller”, #73, #238)');

    // 1a. The #435 default board fills the grid: an add says so once and offers Fine and one reduction,
    // each applied as one draft edit that Cancel restores.
    await reset(() => {}, defaultSettings); await open();
    await tab('Widgets'); await button('Add widget').click();
    assert.match(await page.locator('.widget-picker .room-message').innerText(), /No room/, 'the full default board is explained before Add (#448)');
    assert.match(await page.locator('#picker-room-help').innerText(), /make room and add this widget to your draft/);
    assert.equal(await savebar().count(), 0, 'preflight never changes the draft');
    await button('Preview Countdown').click(); await button('Countdown small').click(); await button('Add Countdown').click(); await page.clock.runFor(100);
    assert.equal(await page.getByText('No room for Countdown at small size.', { exact: true }).count(), 1, 'the full board is explained once');
    assert.deepEqual(await page.locator('.widget-picker .room-fix').allInnerTexts(), ['Switch the grid to Fine', 'Make room: Reminders small']);
    assert.equal(await savebar().count(), 0, 'nothing changes before a fix is chosen');
    await button('Make room: Reminders small').click(); await page.locator('.widget-picker').waitFor({ state: 'detached' });
    await savebar().waitFor();
    assert.equal(await canvas('countdown').getAttribute('data-widget-size'), 'small');
    assert.equal(await canvas('reminders').getAttribute('data-widget-size'), 'small');
    assert.equal(await page.locator('.widget-list .inline-message').innerText(), 'Reminders is now small. Countdown added.');
    await cancel();
    assert.equal(await canvas('countdown').count(), 0, 'Cancel restores the default board');
    assert.equal(await canvas('reminders').getAttribute('data-widget-size'), 'medium');
    await button('Add widget').click();
    await button('Preview Note').click(); await button('Note large').click(); await button('Add Note').click(); await page.clock.runFor(100);
    assert.equal(await page.getByText('No room for Note at large size.', { exact: true }).count(), 1);
    assert.deepEqual(await page.locator('.widget-picker .room-fix').allInnerTexts(), ['Switch the grid to Fine', 'Make room: Clock medium']);
    await button('Switch the grid to Fine').click(); await page.locator('.widget-picker').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('combobox', { name: 'Grid density' }).inputValue(), 'fine');
    assert.equal(await canvas('note').getAttribute('data-widget-size'), 'large');
    for (const id of ['calendar', 'clock', 'weather', 'forecast']) assert.equal(await canvas(id).getAttribute('data-widget-size'), 'large', `${id} keeps its family on Fine`);
    await cancel();
    assert.equal(await page.getByRole('combobox', { name: 'Grid density' }).inputValue(), 'balanced');
    checks.push('#435 default board: adding Countdown small says “No room for Countdown at small size.” once with Switch the grid to Fine and Make room: Reminders small; the reduction adds it as one draft (“Reminders is now small. Countdown added.”) that Cancel restores; a large Note offers Fine or Make room: Clock medium, and Fine keeps every large family');

    // #516 / #430: discovery is local to this picker and never changes widget data or the draft.
    await reset(() => {}, defaultSettings); await open({ viewport: { width: 1280, height: 720 } });
    await tab('Widgets'); await button('Add widget').click();
    const search = () => page.getByRole('searchbox', { name: 'Search widgets' });
    const filter = () => page.getByRole('combobox', { name: 'Filter widgets' });
    const names = () => page.locator('.catalog-item').evaluateAll(items => items.map(item => item.getAttribute('aria-label')));
    await page.locator('.picker-detail').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await button('Preview Note').click();
    assert.equal(await page.locator('.picker-detail').evaluate(element => element.scrollTop), 0, 'selecting another widget returns its title/sample to the top');
    await search().fill('Pictures');
    assert.deepEqual(await names(), [itemName('preview', defaults), itemName('photo', defaults)], 'category text is searchable');
    assert.equal(await search().evaluate(element => element === document.activeElement), true, 'filtering keeps typing focus');
    assert.deepEqual(await tabStops(), [itemName('preview', defaults)], 'a filtered-away selection falls back to the first result');
    await search().press('Home'); await search().press('ArrowRight'); await search().press('End');
    assert.equal(await search().evaluate(element => element === document.activeElement), true, 'text editing keys never enter the rail');
    assert.deepEqual(await tabStops(), [itemName('preview', defaults)]);
    await filter().selectOption('not-added');
    assert.deepEqual(await names(), ['Preview Photo']);
    assert.equal(await page.locator('.picker-results [role="status"]').innerText(), '1 widget');
    await button('Photo large').click();
    const sizeDescription = await button('Photo large').getAttribute('aria-describedby');
    assert.equal(await page.locator(`#${sizeDescription}`).innerText(), '4 columns by 4 rows on the 12 by 8 grid.');
    assert.equal(await page.locator(`#${sizeDescription}`).evaluate(element => element.closest('[aria-hidden="true"]') === null), true, 'family footprints are accessible outside the hidden sample');
    assert.match(await page.locator('#picker-keyboard-help').innerText(), /arrow keys.*Home and End.*Tab/s);
    assert.equal(await button('Preview Photo').getAttribute('aria-describedby'), 'picker-keyboard-help');
    await search().fill('no such widget');
    assert.equal(await page.locator('.picker-detail').count(), 0, 'zero results remove the stale Add action');
    assert.equal(await page.locator('.picker-add').count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'No matching widgets' }).count(), 1);
    assert.equal(await page.locator('.picker-results [role="status"]').innerText(), '0 widgets');
    if (capture) images.push({ name: 'picker-empty-1280', bytes: await page.screenshot() });
    await button('Show all widgets').click();
    assert.equal(await search().inputValue(), ''); assert.equal(await filter().inputValue(), 'all');
    assert.equal(await search().evaluate(element => element === document.activeElement), true, 'reset leaves focus on search');
    await button('Preview Photo').click();
    assert.equal(await button('Photo large').getAttribute('aria-pressed'), 'true', 'size choices survive filtering');
    await filter().selectOption('on-display');
    assert.deepEqual(await names(), GROUPED.filter(id => defaults[id]).map(id => itemName(id, defaults)));
    assert.equal(await page.locator('.picker-add').isDisabled(), true, 'added widgets cannot be added again');
    assert.equal(await page.locator('.widget-picker .room-fix').count(), 0, 'added widgets have no add fixes');
    await search().fill('clock'); await button('Clear widget search').click();
    assert.equal(await search().evaluate(element => element === document.activeElement), true, 'clear returns focus to the input');
    assert.equal(await savebar().count(), 0, 'search, filters, sizes and preflight leave settings unchanged');
    await page.keyboard.press('Escape'); await page.locator('.widget-picker').waitFor({ state: 'detached' });
    assert.equal(await button('Add widget').evaluate(element => element === document.activeElement), true);
    await button('Add widget').click();
    assert.equal(await search().inputValue(), ''); assert.equal(await filter().inputValue(), 'all', 'reopening starts a fresh catalog');
    await button('Preview Countdown').click(); await button('Countdown small').click();
    await button('Make room: Reminders small').click(); // No failed Add is needed first.
    await page.locator('.widget-picker').waitFor({ state: 'detached' });
    assert.equal(await canvas('countdown').getAttribute('data-widget-size'), 'small');
    await button('Add widget').click(); await filter().selectOption('on-display');
    assert.ok((await names()).includes('Preview Countdown, on your display'), 'filters use the unsaved draft');
    await button('Preview Countdown, on your display').click();
    assert.equal(await button('Add Countdown').isDisabled(), true);
    await button('Close widget picker').click(); await cancel();
    await button('Add widget').click(); await filter().selectOption('not-added');
    assert.ok((await names()).includes('Preview Countdown'), 'Cancel restores the available widget');
    await button('Close widget picker').click();
    assert.deepEqual(snapshot(), defaultSettings(), 'discovery and cancelled room fixes preserve saved data');
    await button('Add widget').click(); await button('Preview Note').click(); await button('Note large').click();
    assert.match(await page.locator('.widget-picker .room-message').innerText(), /No room/);
    await search().focus();
    await app.store.patchSettings({ widgets: { clock: false } });
    await page.clock.runFor(30_000);
    await page.locator('.widget-picker .room-fix').first().waitFor({ state: 'detached' });
    assert.equal(await page.locator('.widget-picker .room-message').innerText(), '', 'newly available room clears stale preflight guidance');
    assert.equal(await search().evaluate(element => element === document.activeElement), true, 'a board refresh preserves typing focus');
    await reset(settings => {
      settings.widgetGrid.density = 'fine';
      for (const id of ACTIVE_WIDGET_IDS) settings.widgets[id] = false;
      for (const id of ACTIVE_WIDGET_IDS) {
        settings.widgetGrid = addToGrid(settings.widgetGrid, id, 'small', settings.widgets);
        assert.ok(settings.widgetGrid, `${id} fits the all-added synthetic board`);
        settings.widgets[id] = true;
      }
    });
    await open(); await tab('Widgets'); await button('Add widget').click();
    await filter().selectOption('not-added');
    assert.equal(await page.getByRole('heading', { name: 'Every widget is on your display' }).count(), 1);
    assert.equal(await page.locator('.picker-add').count(), 0);
    await button('Show all widgets').click();
    assert.equal(await page.locator('.catalog-item').count(), ACTIVE_WIDGET_IDS.length);
    assert.equal(await page.locator('.picker-add').isDisabled(), true);
    await filter().selectOption('on-display'); await button('Preview Clock, on your display').click();
    await button('Preview Clock, on your display').focus();
    await app.store.patchSettings({ widgets: { clock: false } });
    await page.clock.runFor(30_000);
    await button('Preview Clock, on your display').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('catalog-item')), true, 'a removed filtered item returns focus to the remaining rail');
    assert.equal(await page.locator('.catalog-item[tabindex="0"]').count(), 1);
    await search().fill('Calendar');
    await button('Calendar medium').focus();
    await app.store.patchSettings({ widgets: { calendar: false } });
    await page.clock.runFor(30_000);
    await page.locator('.picker-detail').waitFor({ state: 'detached' });
    assert.equal(await search().evaluate(element => element === document.activeElement), true, 'removing the last result while a size has focus returns to search');
    checks.push('#516/#430/#448: search names/descriptions/categories, draft availability filters and counts, retained size, typed Home/End/arrows, one visible rail stop, accessible keyboard help and family footprints, no-results/reset/clear focus, duplicate prevention, Escape/reopen, pure preflight and direct draft fix with Cancel');

    // 1b. "No room" (#238): one live region, cleared on close, and fixes that apply as draft edits.
    await reset(qaBoard); await open();
    const noRoom = 'No room for Countdown at medium size.';
    const announcing = () => page.locator('[role="status"], [aria-live]').evaluateAll(nodes => nodes.filter(node => node.textContent.includes('No room')).length);
    async function tryCountdownMedium() {
      await tab('Widgets'); await button('Add widget').click();
      await button('Preview Countdown').click(); await button('Countdown medium').click(); await button('Add Countdown').click(); await page.clock.runFor(100);
    }
    await tryCountdownMedium();
    assert.equal(await page.getByText(noRoom, { exact: true }).count(), 1, 'the message is shown once');
    assert.equal(await announcing(), 1, 'one live region announces it');
    assert.deepEqual(await page.locator('.widget-picker .room-fix').allInnerTexts(), ['Switch the grid to Fine', 'Make room: Weather medium']);
    assert.equal(await savebar().count(), 0, 'nothing changes before a fix is chosen');
    await button('Countdown small').click();
    assert.equal(await page.getByText(noRoom).count(), 0, 'a different size clears the stale message');
    await page.keyboard.press('Escape'); await page.locator('.widget-picker').waitFor({ state: 'detached' });
    assert.equal(await page.getByText(/No room/).count(), 0, 'closing the picker clears it everywhere');
    await tryCountdownMedium();
    await page.keyboard.press('Escape'); await page.locator('.widget-picker').waitFor({ state: 'detached' });
    assert.equal(await announcing(), 0, 'nothing is left in any live region after close');
    await tryCountdownMedium();
    await button('Switch the grid to Fine').click(); await page.clock.runFor(200);
    await page.locator('.widget-picker').waitFor({ state: 'detached' });
    await savebar().waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Grid density' }).inputValue(), 'fine', 'the grid switched as part of the draft');
    assert.equal(await canvas('countdown').getAttribute('data-widget-size'), 'medium');
    assert.equal(await page.locator('.widget-list .inline-message').innerText(), 'Grid switched to Fine. Countdown added.');
    await cancel();
    assert.equal(await canvas('countdown').count(), 0, 'Cancel restores the board');
    assert.equal(await page.getByRole('combobox', { name: 'Grid density' }).inputValue(), 'balanced', 'Cancel restores the grid');
    // "Try small" when only the small family fits.
    await reset(settings => { qaBoard(settings); settings.widgetGrid = fitWidgetFamily(settings.widgetGrid, 'preview', 'small', settings.widgets); });
    await open();
    await tab('Widgets'); await button('Add widget').click();
    await button('Preview Note').click(); await button('Note medium').click(); await button('Add Note').click(); await page.clock.runFor(100);
    assert.equal(await page.getByText('No room for Note at medium size.', { exact: true }).count(), 1);
    await button('Try small').click(); await page.locator('.widget-picker').waitFor({ state: 'detached' });
    assert.equal(await canvas('note').getAttribute('data-widget-size'), 'small');
    await cancel();
    await reset(); await open();
    checks.push('“No room” (#238): shown once in one live region, cleared by another size or closing the picker; “Switch the grid to Fine” and “Try small” add the widget as one draft edit that Cancel restores');

    // 2. Calendar: add, week start, Cancel, Save, reload.
    await addFromPicker('Calendar');
    await canvas('calendar').waitFor(); await savebar().waitFor();
    await save(); assert.equal(snapshot().widgets.calendar, true);
    let row = await inspector('Calendar');
    const weekStart = row.getByRole('combobox', { name: 'Week starts on' });
    assert.deepEqual(await weekStart.locator('option').allInnerTexts(), ['Automatic · Sunday', 'Sunday', 'Monday'], 'Automatic shows the resolved en-US day');
    const firstHeader = () => canvas('calendar').locator('th').first().innerText();
    assert.equal(await firstHeader(), 'S');
    await weekStart.selectOption('monday'); assert.equal(await firstHeader(), 'M'); await savebar().waitFor();
    await weekStart.selectOption('locale'); await savebar().waitFor({ state: 'detached' });
    await weekStart.selectOption('monday'); await cancel(); assert.equal(await firstHeader(), 'S'); assert.equal(await weekStart.inputValue(), 'locale');
    await weekStart.selectOption('monday'); await save(); assert.equal(snapshot().widgetData.calendar.weekStart, 'monday');
    await page.reload(); await button('Edit layout').waitFor(); await page.clock.runFor(300);
    row = await inspector('Calendar'); assert.equal(await row.getByRole('combobox', { name: 'Week starts on' }).inputValue(), 'monday'); assert.equal(await firstHeader(), 'M');
    checks.push('Calendar: add from the picker, Week starts on (Automatic · Sunday / Sunday / Monday) previews live, reverting hides the Save bar, Cancel restores, Save and reload persist');

    // 3. Countdown: placeholder, add/edit/delete, empty-title error blocks Save, Every year, Passed.
    await addFromPicker('Countdown');
    assert.match(await canvas('countdown').innerText(), /Add a date to count down to/, 'editor placeholder while empty');
    row = await inspector('Countdown');
    await row.getByRole('button', { name: 'Add date', exact: true }).click();
    const title1 = row.getByRole('textbox', { name: 'Countdown 1 title' });
    assert.equal(await title1.evaluate(element => element === document.activeElement), true, 'Add date focuses the new title');
    assert.equal(await row.getByLabel('Countdown 1 date', { exact: true }).inputValue(), '2026-10-25', 'a new row is dated one week ahead');
    await row.getByText('Countdown needs a title', { exact: true }).waitFor();
    assert.equal(await title1.getAttribute('aria-invalid'), 'true');
    assert.equal(await saveStatus().innerText(), 'Countdown needs a title');
    assert.equal(await button('Save changes').isDisabled(), true, 'an empty title blocks Save');
    if (capture) images.push({ name: 'countdown-error', bytes: await page.screenshot() });
    await title1.fill('Weekend trip');
    assert.equal(await row.getByText('Countdown needs a title', { exact: true }).count(), 0);
    assert.equal(await button('Save changes').isDisabled(), false);
    assert.match(await canvas('countdown').innerText(), /7\s*days/);
    await row.getByLabel('Countdown 1 date', { exact: true }).fill('2026-10-30');
    assert.match(await canvas('countdown').innerText(), /12\s*days\s*Weekend trip\s*Fri, Oct 30/);
    assert.match(await row.locator('.countdown-editor-status').first().innerText(), /In 12 days/);
    await row.getByRole('button', { name: 'Add date', exact: true }).click();
    await row.getByRole('textbox', { name: 'Countdown 2 title' }).fill('Old trip');
    await row.getByLabel('Countdown 2 date', { exact: true }).fill('2026-10-01');
    assert.equal(await row.locator('.countdown-editor-status').nth(1).innerText(), 'Passed', 'a past one-time date is labelled Passed in the editor');
    assert.doesNotMatch(await canvas('countdown').innerText(), /Old trip/, 'and ignored on the widget');
    await row.getByRole('checkbox', { name: 'Countdown 2 every year' }).check();
    assert.match(await row.locator('.countdown-editor-status').nth(1).innerText(), /In 348 days · Fri, Oct 1, 2027/, 'Every year rolls to the next occurrence');
    await row.getByRole('checkbox', { name: 'Countdown 2 every year' }).uncheck();
    await row.getByLabel('Countdown 2 date', { exact: true }).fill('2201-01-01');
    assert.equal(await saveStatus().innerText(), 'Use a date between 1900 and 2200');
    assert.equal(await row.getByLabel('Countdown 2 date', { exact: true }).getAttribute('aria-invalid'), 'true');
    await row.getByText('Use a date between 1900 and 2200', { exact: true }).waitFor();
    await row.getByLabel('Countdown 2 date', { exact: true }).fill('2026-10-01');
    await save();
    assert.deepEqual(snapshot().widgetData.countdowns.map(({ title, date, repeatsYearly }) => [title, date, repeatsYearly]), [['Weekend trip', '2026-10-30', false], ['Old trip', '2026-10-01', false]]);
    await row.getByRole('textbox', { name: 'Countdown 1 title' }).fill('');
    assert.equal(await button('Save changes').isDisabled(), true); await cancel();
    assert.equal(await row.getByRole('textbox', { name: 'Countdown 1 title' }).inputValue(), 'Weekend trip', 'Cancel restores the saved title');
    await row.getByRole('button', { name: 'Remove countdown 2' }).click(); await save();
    assert.deepEqual(snapshot().widgetData.countdowns.map(event => event.title), ['Weekend trip']);
    await row.getByRole('checkbox', { name: 'Countdown 1 every year' }).check(); await save();
    assert.equal(snapshot().widgetData.countdowns[0].repeatsYearly, true);
    await row.getByRole('textbox', { name: 'Countdown 1 title' }).fill('Weekend trip  ');
    await row.getByRole('textbox', { name: 'Countdown 1 title' }).blur();
    await savebar().waitFor({ state: 'detached' });
    // An incomplete row never strands Save: closing the panel or removing the widget drops it.
    await row.getByRole('button', { name: 'Add date', exact: true }).click(); await savebar().waitFor();
    assert.equal(await button('Save changes').isDisabled(), true);
    await button('Countdown').click();
    await savebar().waitFor({ state: 'detached' });
    assert.equal(snapshot().widgetData.countdowns.length, 1);
    row = await inspector('Countdown');
    assert.equal(await row.getByRole('textbox', { name: 'Countdown 2 title' }).count(), 0, 'collapsing the panel drops the untitled row');
    await row.getByRole('button', { name: 'Add date', exact: true }).click();
    await button('Remove Countdown').click();
    await tab('Style'); await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('builtin:night');
    const switchStyle = page.getByRole('group', { name: 'Switch style', exact: true });
    assert.equal(await switchStyle.getByRole('button', { name: 'Save and switch', exact: true }).isDisabled(), false, 'the removed incomplete row does not block switching styles');
    await switchStyle.getByRole('button', { name: 'Keep editing', exact: true }).click();
    assert.equal(await saveStatus().innerText(), 'Unsaved changes');
    assert.equal(await button('Save changes').isDisabled(), false, 'removing the widget never leaves Save blocked by a hidden field');
    await cancel();
    row = await inspector('Countdown');
    assert.deepEqual(await row.locator('input[data-countdown-title]').evaluateAll(inputs => inputs.map(input => input.value)), ['Weekend trip'], 'Cancel restores the saved widget and its one date');
    // Closing the panel never deletes a saved date: a cleared title or date reverts instead.
    await row.getByRole('textbox', { name: 'Countdown 1 title' }).fill('');
    await button('Countdown').click();
    await savebar().waitFor({ state: 'detached' });
    row = await inspector('Countdown');
    assert.equal(await row.getByRole('textbox', { name: 'Countdown 1 title' }).inputValue(), 'Weekend trip', 'a cleared title reverts when the panel closes');
    await row.getByLabel('Countdown 1 date', { exact: true }).fill('');
    await row.getByRole('textbox', { name: 'Countdown 1 title' }).fill('Weekend away');
    await tab('Style'); await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('builtin:night'); await save();
    assert.deepEqual(snapshot().widgetData.countdowns.map(({ title, date, repeatsYearly }) => [title, date, repeatsYearly]), [['Weekend away', '2026-10-30', true]], 'a cleared date reverts while other edits are kept');
    await app.store.patchSettings({ widgets: { countdown: true, calendar: true } });
    await page.reload(); await button('Edit layout').waitFor(); await page.clock.runFor(300);
    row = await inspector('Countdown');
    await row.getByRole('textbox', { name: 'Countdown 1 title' }).fill('Weekend trip'); await save();
    // Rows are read-only while a Save is running, so the rebase records what the server stored.
    let releasePatch;
    await page.route('**/api/settings', async route => { if (route.request().method() === 'PATCH') await new Promise(resolve => { releasePatch = resolve; }); await route.continue(); });
    await row.getByRole('textbox', { name: 'Countdown 1 title' }).fill('Weekend trip!');
    await button('Save changes').click();
    await page.waitForFunction(() => document.querySelector('[data-countdown-title]')?.disabled === true);
    for (const control of [row.getByRole('textbox', { name: 'Countdown 1 title' }), row.getByLabel('Countdown 1 date', { exact: true }), row.getByRole('checkbox', { name: 'Countdown 1 every year' }), row.getByRole('button', { name: 'Remove countdown 1' })]) assert.equal(await control.isDisabled(), true);
    releasePatch(); await savebar().waitFor({ state: 'detached' }); await page.unroute('**/api/settings');
    assert.equal(await row.getByRole('textbox', { name: 'Countdown 1 title' }).isDisabled(), false);
    await row.getByRole('textbox', { name: 'Countdown 1 title' }).fill('Weekend trip'); await save();
    // A date saved while the panel stays open is protected too, and so is a saved retitle.
    await row.getByRole('button', { name: 'Add date', exact: true }).click();
    await row.getByRole('textbox', { name: 'Countdown 2 title' }).fill('Concert'); await save();
    await row.getByRole('textbox', { name: 'Countdown 2 title' }).fill('');
    await row.getByRole('textbox', { name: 'Countdown 1 title' }).fill('Weekend away'); await page.keyboard.press('Tab');
    await button('Countdown').click();
    row = await inspector('Countdown');
    assert.deepEqual(await row.locator('input[data-countdown-title]').evaluateAll(inputs => inputs.map(input => input.value)), ['Weekend away', 'Concert'], 'a date saved after the panel opened reverts instead of disappearing');
    await save();
    await row.getByRole('textbox', { name: 'Countdown 1 title' }).fill('');
    await button('Countdown').click(); await savebar().waitFor({ state: 'detached' });
    row = await inspector('Countdown');
    assert.equal(await row.getByRole('textbox', { name: 'Countdown 1 title' }).inputValue(), 'Weekend away', 'a cleared title reverts to the latest saved title');
    assert.deepEqual(snapshot().widgetData.countdowns.map(event => event.title), ['Weekend away', 'Concert']);
    await row.getByRole('textbox', { name: 'Countdown 1 title' }).fill('Weekend trip');
    await row.getByRole('button', { name: 'Remove countdown 2' }).click(); await save();
    checks.push('Countdown: editor placeholder, Add date (one week ahead, title focused), inline empty-title error blocks Save via draftProblem, live preview, Passed label, Every year, Remove, Cancel restores, trailing spaces trimmed on blur leave no Save bar');

    // 4. Note: counter, Clear, 4-line limit, dirty-only Save bar, reload.
    await addFromPicker('Note'); await save();
    assert.match(await canvas('note').innerText(), /Write a note/);
    row = await inspector('Note');
    const note = row.getByRole('textbox', { name: 'Note' });
    await note.fill('Dinner at seven'); assert.equal(await row.locator('.note-count').innerText(), '15/200');
    assert.equal((await canvas('note').innerText()).trim(), 'Dinner at seven'); await savebar().waitFor();
    await row.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await note.inputValue(), ''); assert.equal(await row.locator('.note-count').innerText(), '0/200');
    await savebar().waitFor({ state: 'detached' });
    assert.equal(await row.getByRole('button', { name: 'Clear', exact: true }).isDisabled(), true);
    await note.fill('one\ntwo\nthree\nfour\nfive'); assert.equal(await note.inputValue(), 'one\ntwo\nthree\nfour', 'at most four lines');
    await note.fill('x'.repeat(250)); assert.equal((await note.inputValue()).length, 200, 'at most 200 characters');
    assert.equal(await row.locator('.note-count').innerText(), '200/200');
    await note.fill('Dinner at seven\nBack by nine');
    assert.match(await row.locator('.hint').innerText(), /Stored on this device and included in exports\./);
    await save(); assert.equal(snapshot().widgetData.note.text, 'Dinner at seven\nBack by nine');
    await page.reload(); await button('Edit layout').waitFor(); await page.clock.runFor(300);
    row = await inspector('Note'); assert.equal(await row.getByRole('textbox', { name: 'Note' }).inputValue(), 'Dinner at seven\nBack by nine');
    assert.deepEqual((await canvas('note').locator('.note-text').innerText()).split('\n'), ['Dinner at seven', 'Back by nine'], 'line breaks are kept');
    if (capture) images.push({ name: 'editor-1440', bytes: await page.screenshot() });
    checks.push('Note: live counter, Clear, 4-line and 200-character limits, Save bar only while effective, line breaks kept, Save and reload persist');

    // 5. Styles never erase widget content, and built-in styles are looks only (#153): the added
    // Calendar, Countdown and Note stay enabled and in place. The look is Night already, so Room changes it.
    const added = () => Object.fromEntries(['calendar', 'countdown', 'note'].map(id => [id, [snapshot().widgets[id], snapshot().widgetGrid.placements[id]]]));
    const board = added();
    assert.deepEqual(Object.values(board).map(([enabled]) => enabled), [true, true, true], 'the three widgets are on the board');
    await tab('Style'); await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('builtin:room'); await save();
    assert.equal(snapshot().widgetData.note.text, 'Dinner at seven\nBack by nine'); assert.equal(snapshot().widgetData.countdowns.length, 1); assert.equal(snapshot().widgetData.calendar.weekStart, 'monday');
    assert.deepEqual(added(), board, 'Room keeps Calendar, Countdown and Note enabled and in place');
    await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('builtin:night'); await save();
    assert.deepEqual(added(), board, 'Night keeps them too');
    await page.getByRole('button', { name: /^Save as new/ }).click();
    await page.getByRole('textbox', { name: 'New style', exact: true }).fill('Synthetic style');
    await button('Save new style').click(); await savebar().waitFor({ state: 'detached' });
    await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('builtin:room'); await save();
    await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption({ label: 'Synthetic style' });
    await save();
    assert.equal(snapshot().widgetData.note.text, 'Dinner at seven\nBack by nine'); assert.equal(snapshot().widgetData.countdowns[0].title, 'Weekend trip');
    assert.equal('widgetData' in snapshot().savedPresets[0].visual, false);
    assert.deepEqual(added(), board, 'a saved style made from this board keeps them as well');
    checks.push('Built-in Room/Night keep Calendar, Countdown and Note enabled and in place (#153); built-in and saved styles keep the note, countdowns and week start; saved styles never contain widget content');

    // 6. Display: visible with content; hidden when empty while the editor keeps placeholders.
    // Built-in styles keep the widget set (#153), so the three are still on.
    assert.equal(snapshot().widgets.note, true, 'a built-in style keeps the widget set');
    await open({ route: '/display', viewport: { width: 1280, height: 720 } });
    assert.equal(await page.locator('[data-widget-id="note"]').count(), 1); assert.equal(await page.locator('[data-widget-id="countdown"]').count(), 1); assert.equal(await page.locator('[data-widget-id="calendar"]').count(), 1);
    if (capture) images.push({ name: 'display-1280', bytes: await page.screenshot() });
    await app.store.patchSettings({ widgetData: { note: { text: '' }, countdowns: [{ id: '00000000-0000-4000-8000-000000000001', title: 'Passed', date: '2026-01-01', repeatsYearly: false }] } });
    await page.reload(); await page.locator('[data-widget-id="calendar"]').waitFor(); await page.clock.runFor(300);
    assert.equal(await page.locator('[data-widget-id="note"]').count(), 0, 'an empty note is hidden on the display');
    assert.equal(await page.locator('[data-widget-id="countdown"]').count(), 0, 'a countdown with nothing upcoming is hidden on the display');
    await open();
    assert.match(await canvas('note').innerText(), /Write a note/); assert.match(await canvas('countdown').innerText(), /Add a date to count down to/);
    checks.push('Display shows the three widgets with content; an empty note and a countdown with only passed dates are hidden there while the editor canvas shows placeholders');

    // 6b. With free-size Reminders (#73) and the #93 fallback: a dense Balanced board (88 of 96 cells) with a
    // full-height column beside Calendar, Countdown and Note keeps every widget whole on screen and keeps moving.
    const restore = structuredClone(app.store.snapshot());
    await app.store.update(data => {
      data.reminders = Array.from({ length: 12 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, text: `Synthetic reminder ${index + 1}`, completed: false, dueAt: null, createdAt: new Date(now - index * 60_000).toISOString(), updatedAt: new Date(now - index * 60_000).toISOString() }));
    });
    // #436: arrangements change only with Swap places on (opt-in).
    await app.store.patchSettings({
      appearance: { motionIntervalSeconds: 30, rearrange: true },
      widgets: { clock: true, weather: true, forecast: false, reminders: true, preview: false, photo: false, calendar: true, countdown: true, note: true },
      widgetGrid: { placements: {
        reminders: { column: 0, row: 0, size: 'small', span: { columns: 2, rows: 8 } }, clock: { column: 2, row: 0, size: 'large' },
        countdown: { column: 10, row: 0, size: 'small' }, note: { column: 10, row: 2, size: 'small' },
        weather: { column: 2, row: 4, size: 'large' }, calendar: { column: 6, row: 4, size: 'large' },
      } },
      widgetData: { countdowns: [{ id: '00000000-0000-4000-8000-000000000101', title: 'Weekend trip', date: '2026-10-30', repeatsYearly: false }], note: { text: 'Dinner at seven' } },
    });
    assert.deepEqual(snapshot().widgetGrid.placements.reminders.span, { columns: 2, rows: 8 }, 'the server keeps the column beside the three widgets');
    await open({ route: '/display', viewport: { width: 1280, height: 720 } });
    const dense = ['reminders', 'clock', 'countdown', 'note', 'weather', 'calendar'];
    const arrangements = [];
    for (let composition = 0; composition < 4; composition++) {
      if (composition) { await page.clock.runFor(30_000); await page.clock.runFor(1_200); }
      assert.equal(await page.locator('.ambient').getAttribute('data-composition'), String(composition));
      const layout = await page.evaluate(ids => {
        // A swap's glide runs in real time: finish it to read the new cells at rest.
        for (const animation of document.getAnimations()) if (animation.id === 'lrd-glide') animation.finish();
        const plane = document.querySelector('.widget-grid-plane').getBoundingClientRect();
        return Object.fromEntries(ids.map(id => {
          const element = document.querySelector(`[data-widget-id="${id}"]`);
          if (!element) return [id, null];
          // The cell: the box without the #436 float translation (the content floats inside it).
          const [x, y] = getComputedStyle(element).translate.split(' ').map(value => parseFloat(value) || 0), raw = element.getBoundingClientRect();
          const box = { left: raw.left - (x ?? 0), top: raw.top - (y ?? 0), right: raw.right - (x ?? 0), bottom: raw.bottom - (y ?? 0) };
          const outside = [...element.querySelectorAll('*')].filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.left < raw.left - 1 || r.right > raw.right + 1 || r.top < raw.top - 1 || r.bottom > raw.bottom + 1); }).length;
          return [id, { left: box.left - plane.left, top: box.top - plane.top, right: box.right - plane.left, bottom: box.bottom - plane.top, width: plane.width, height: plane.height, span: element.getAttribute('data-widget-span'), full: element.hasAttribute('data-full-height'), outside }];
        }));
      }, dense);
      const label = `dense board composition ${composition}`;
      for (const id of dense) {
        const rect = layout[id];
        assert.ok(rect, `${label}: ${id} is on screen`);
        assert.ok(rect.left >= -1 && rect.top >= -1 && rect.right <= rect.width + 1 && rect.bottom <= rect.height + 1, `${label}: ${id} stays inside the plane ${JSON.stringify(rect)}`);
        if (['calendar', 'countdown', 'note'].includes(id)) assert.equal(rect.outside, 0, `${label}: ${id} content stays inside its box`);
      }
      for (const a of dense) for (const b of dense) {
        if (a >= b) continue;
        const [p, q] = [layout[a], layout[b]];
        assert.ok(p.right <= q.left + 1 || q.right <= p.left + 1 || p.bottom <= q.top + 1 || q.bottom <= p.top + 1, `${label}: ${a} and ${b} never overlap`);
      }
      assert.equal(layout.reminders.span, '2x8', label); assert.equal(layout.reminders.full, true, `${label}: the column stays full height`);
      arrangements.push(JSON.stringify(dense.map(id => [Math.round(layout[id].left), Math.round(layout[id].top)])));
      if (capture) images.push({ name: `dense-1280-composition-${composition}`, bytes: await page.screenshot() });
    }
    for (let index = 1; index < arrangements.length; index++) assert.notEqual(arrangements[index], arrangements[index - 1], `dense board composition ${index} relocates`);
    await app.store.update(data => { data.settings = restore.settings; data.reminders = restore.reminders; });
    checks.push('Dense Balanced board (88/96 cells) with a 2 × 8 Reminders column beside Calendar, Countdown and Note: the server keeps the span, and display compositions 0–3 (Swap places on, #436) keep every widget whole, inside the plane, disjoint and relocating (#73, #93)');

    // 7. Narrow reflow and top-toolbar clearance for focused fields.
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 844 }, { width: 390, height: 480 }]) {
      await open({ viewport });
      row = await inspector('Countdown');
      await row.getByRole('button', { name: 'Add date', exact: true }).click();
      const title = row.getByRole('textbox', { name: 'Countdown 2 title' });
      await title.fill('Synthetic focus'); await page.keyboard.press('Tab'); await page.clock.runFor(100);
      const date = row.getByLabel('Countdown 2 date', { exact: true });
      assert.equal(await date.evaluate(element => element === document.activeElement), true);
      await date.scrollIntoViewIfNeeded();
      const field = await date.boundingBox(), toolbar = await page.locator('.editor-style-bar').boundingBox();
      assert.ok(field.y >= Math.max(0, toolbar.y + toolbar.height) + 4 && field.y + field.height <= viewport.height, `${viewport.width}×${viewport.height} focused date is visible below the Style and Save toolbar: ${JSON.stringify({ field, toolbar })}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${viewport.width}px has no horizontal scroll`);
      const overflow = await row.evaluate(element => [...element.querySelectorAll('input, button, textarea, select')].filter(control => { const r = control.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map(control => control.getAttribute('aria-label') ?? control.textContent));
      assert.deepEqual(overflow, [], `${viewport.width}px countdown controls stay within the screen`);
      await row.getByRole('button', { name: 'Remove countdown 2' }).click();
      const noteRow = await inspector('Note');
      await noteRow.getByRole('textbox', { name: 'Note' }).fill('Synthetic narrow note'); await page.clock.runFor(100);
      await noteRow.getByRole('textbox', { name: 'Note' }).blur(); await noteRow.getByRole('textbox', { name: 'Note' }).focus(); await page.clock.runFor(100);
      const box = await noteRow.getByRole('textbox', { name: 'Note' }).boundingBox(), noteToolbar = await page.locator('.editor-style-bar').boundingBox();
      assert.ok(box.y >= Math.max(0, noteToolbar.y + noteToolbar.height) + 4 && box.y + box.height <= viewport.height, `${viewport.width}x${viewport.height} focused note is visible below the Style and Save toolbar: ${JSON.stringify({ box, noteToolbar })}`);
      if (capture) images.push({ name: `panels-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
      await cancel();
    }
    checks.push('390/320px and 390×480 reflow: no horizontal scroll, countdown controls on screen, focused fields visible below the top Style and Save toolbar');

    // 8. The grouped picker fits the compact viewports, on the #435 default board a new install shows.
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1280, height: 600 }, { width: 1024, height: 600 }, { width: 760, height: 600 }, { width: 390, height: 700 }, { width: 390, height: 480 }, { width: 640, height: 300 }]) {
      await reset(() => {}, defaultSettings); await open({ viewport });
      await tab('Widgets'); await button('Add widget').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${viewport.width}×${viewport.height} picker has no horizontal scroll`);
      if (viewport.width > 700) {
        const panel = await page.locator('.inspector-panel').evaluate(element => [element.clientHeight, element.scrollHeight]);
        assert.ok(panel[1] <= panel[0] + 1, `${viewport.width}×${viewport.height} picker fits its panel`);
      }
      const labels = await page.locator('.catalog-group-label').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && node.scrollWidth <= Math.ceil(r.width) + 1; }));
      assert.ok(labels.every(Boolean), `${viewport.width}×${viewport.height} group labels are visible and unclipped`);
      if (viewport.width > 700) {
        // #195: rail labels and button names are at least 11 px on desktop widths, and never clipped.
        const sizes = await page.locator('.catalog-group-label, .catalog-item span').evaluateAll(nodes => nodes.map(node => Number.parseFloat(getComputedStyle(node).fontSize)));
        assert.ok(Math.min(...sizes) >= 11, `${viewport.width}×${viewport.height} rail text is at least 11 px: ${Math.min(...sizes)}`);
        const clipped = await page.locator('.catalog-item span').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
        assert.deepEqual(clipped, [], `${viewport.width}×${viewport.height} widget names are not clipped`);
        // #154: the initial selection is visible inside the rail.
        const selection = await page.locator('.catalog-item[aria-pressed="true"]').evaluate(item => {
          const rail = item.closest('.widget-catalog').getBoundingClientRect(), box = item.getBoundingClientRect();
          return { name: item.getAttribute('aria-label'), visible: box.top >= rail.top - 1 && box.bottom <= rail.bottom + 1 && box.top >= 0 && box.bottom <= innerHeight };
        });
        const widgets = defaultSettings().widgets;
        assert.equal(selection.name, itemName(GROUPED.find(id => !widgets[id]), widgets));
        assert.ok(selection.visible, `${viewport.width}×${viewport.height} the initial selection is in view: ${JSON.stringify(selection)}`);
      }
      for (const name of ['Calendar', 'Countdown', 'Note']) {
        const item = button(itemName(name.toLowerCase(), defaultSettings().widgets)); await item.scrollIntoViewIfNeeded(); await item.click();
        const add = button(`Add ${name}`); await add.scrollIntoViewIfNeeded(); await inView(add, `${viewport.width}×${viewport.height} Add ${name}`);
      }
      for (const control of [search(), filter(), page.locator('.family-previews button').first(), page.locator('.widget-picker .room-fix').first()]) {
        if (await control.count()) {
          const box = await control.boundingBox();
          assert.ok(box.height >= 44, `${viewport.width}x${viewport.height} picker control ${await control.getAttribute('aria-label') ?? await control.textContent()} has a 44 px target: ${JSON.stringify(box)}`);
        }
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${viewport.width}x${viewport.height} picker has no horizontal overflow`);
      if (capture) images.push({ name: `picker-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
    }
    checks.push('Grouped picker fits 1280×720, 1280×600, 1024×600, 760×600, 390×700, 390×480 and 640×300 with visible group labels, rail text of at least 11 px on desktop widths (#195), the initial selection in view (#154) and reachable Add actions');

    // 9. #361: readable samples. At 1280×720 every family's smallest text line is at least 9 px, the
    // sample fills the stage width (at most 100 px per cell) and the footprint names its span. The
    // date and time are this computer's, on any day: here the page clock is 5 March 2027, 10:20.
    // On the catalog board, where Calendar is not yet on the display (#435).
    await reset();
    const catalogWidgets = catalogBoardDefaults().widgets;
    await context?.close();
    context = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'America/Toronto', locale: 'en-US', reducedMotion: 'reduce' }); await mockWindowsStatus(context);
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
    await page.clock.install({ time: new Date('2027-03-05T15:20:00Z') });
    await page.goto(base + '/editor'); await button('Edit layout').waitFor(); await page.clock.runFor(500);
    await tab('Widgets'); await button('Add widget').click();
    const smallest = [];
    for (const id of ACTIVE_WIDGET_IDS) {
      await button(itemName(id, catalogWidgets)).click();
      for (const size of widgetSizes(id)) {
        await button(`${WIDGET_CATALOG[id].name} ${size}`).click(); await page.clock.runFor(50);
        await page.locator(`.picker-sample .ambient-${id}.widget-size-${size}`).waitFor();
        const measured = await page.evaluate(() => {
          const sample = document.querySelector('.picker-sample'), stage = document.querySelector('.sample-area').getBoundingClientRect(), box = sample.getBoundingClientRect();
          let min = Infinity, text = '';
          const walker = document.createTreeWalker(sample, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent.trim()) continue;
            const style = getComputedStyle(node.parentElement);
            if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0 && rect.height < min) { min = rect.height; text = node.textContent.trim(); }
          }
          const ratio = Number.parseFloat(sample.style.getPropertyValue('--sample-ratio')), columns = Number.parseFloat(sample.style.getPropertyValue('--sample-columns'));
          return { min: min === Infinity ? null : Math.round(min * 10) / 10, text, width: box.width, fill: Math.min(stage.width, stage.height * ratio, columns * 100), footprint: document.querySelector('.sample-footprint').textContent };
        });
        const span = widgetSpan(id, size), label = `${id} ${size}`;
        if (measured.min !== null) { assert.ok(measured.min >= 9, `${label}: smallest sample text ${measured.min} px ("${measured.text}")`); smallest.push(measured.min); }
        assert.ok(Math.abs(measured.width - measured.fill) <= 1, `${label} fills its area (width, height or the 2× cap): ${JSON.stringify(measured)}`);
        assert.ok(measured.width <= span.columns * 100 + 1, `${label} is at most twice the canvas scale: ${JSON.stringify(measured)}`);
        assert.equal(measured.footprint, `${span.columns} × ${span.rows} cells of 12 × 8`, label);
      }
    }
    assert.ok(Math.min(...smallest) >= 9);
    await button(itemName('clock', catalogWidgets)).click(); await button('Clock small').click();
    assert.match(await page.locator('.picker-sample').innerText(), /10:20/, 'the Clock sample shows this computer\'s time');
    await button('Preview Calendar').click();
    assert.equal(await page.locator('.picker-sample .calendar-grid td[aria-current="date"]').innerText(), '5', 'the Calendar sample marks today');
    assert.match(await page.locator('.picker-sample').innerText(), /March/);
    await button('Preview Countdown').click(); await button('Countdown small').click();
    assert.match(await page.locator('.picker-sample').innerText(), /12\s*days\s*Weekend trip\s*Wed, Mar 17/, 'Countdown counts from today');
    if (capture) images.push({ name: 'picker-samples-1280x720', bytes: await page.screenshot() });
    checks.push(`#361 at 1280×720 every picker family's smallest sample text line is at least 9 px (smallest ${Math.min(...smallest)} px), each sample fills the stage width at no more than twice the canvas scale and names its footprint; on 5 March 2027 the Clock shows 10:20, the Calendar marks the 5th and Countdown still reads 12 days`);
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
  const result = await runCatalogTimeQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks }, null, 2));
}
