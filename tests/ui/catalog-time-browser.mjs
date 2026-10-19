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
import { forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { ACTIVE_WIDGET_IDS, WIDGET_CATALOG, WIDGET_CATEGORIES } from '../../src/shared/widgets.ts';

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
  async function reset(update = () => {}) {
    await app.store.update(data => { data.settings = defaultSettings(); data.reminders = []; update(data.settings); });
  }
  async function open({ viewport = { width: 1440, height: 1000 }, route = '/editor' } = {}) {
    await context?.close();
    context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', locale: 'en-US', reducedMotion: 'reduce' });
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
    // 1. Grouped picker: categories in WIDGET_CATEGORIES order, only active widgets, keyboard navigation.
    await reset(); await open();
    await tab('Widgets'); await button('Add widget').click();
    const groups = await page.locator('.widget-catalog .catalog-group').evaluateAll(nodes => nodes.map(node => ({
      label: node.querySelector('.catalog-group-label').textContent, labelled: node.getAttribute('aria-labelledby') === node.querySelector('.catalog-group-label').id && node.getAttribute('role') === 'group',
      items: [...node.querySelectorAll('.catalog-item')].map(item => item.getAttribute('aria-label')),
    })));
    const expected = Object.entries(WIDGET_CATEGORIES).map(([category, label]) => ({ label, labelled: true, items: ACTIVE_WIDGET_IDS.filter(id => WIDGET_CATALOG[id].category === category).map(id => `Preview ${WIDGET_CATALOG[id].name}`) })).filter(group => group.items.length);
    assert.deepEqual(groups, expected);
    assert.deepEqual(groups.map(group => group.label), ['Time', 'Weather & sky', 'Personal', 'Pictures']);
    for (const name of ['Calendar', 'Countdown', 'Note']) assert.ok(groups.flatMap(group => group.items).includes(`Preview ${name}`), name);
    // Rain is part of the adaptive Weather since #74, so the group lists Weather and never Rain.
    assert.ok(groups.find(group => group.label === 'Weather & sky').items.includes('Preview Weather'), 'Weather & sky lists Weather');
    assert.equal(groups.flatMap(group => group.items).includes('Preview Rain'), false, 'Rain is not offered (#74)');
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
    await page.keyboard.press('Tab'); assert.equal(await focused(), order[groupBoundary + 1], 'Tab keeps its normal order: every widget stays a tab stop');
    await button('Preview Calendar').click(); assert.equal(await button('Calendar medium').getAttribute('aria-pressed'), 'true', 'Calendar defaults to medium');
    assert.match(await page.locator('.picker-detail').innerText(), /This month at a glance/);
    await page.locator('.picker-sample [data-widget-id], .picker-sample .ambient-calendar').first().waitFor();
    assert.equal(await page.locator('.picker-sample .calendar-grid td[aria-current="date"]').innerText(), '18', 'the sample uses the sample clock');
    await button('Preview Countdown').click();
    assert.match(await page.locator('.picker-sample').innerText(), /12\s*days\s*Weekend trip/);
    await button('Preview Note').click();
    assert.equal((await page.locator('.picker-sample .note-text').innerText()).trim(), 'Dinner at seven');
    // The #73 free-size caption follows the catalog rule: none for these fixed-family widgets, kept for Reminders.
    assert.equal(await page.locator('.picker-free-size').count(), 0, 'fixed-family widgets show no free-size caption');
    await button('Preview Reminders').click();
    assert.equal(await page.locator('.picker-free-size').innerText(), 'Resize freely after adding — up to the full height', 'Reminders keeps its caption in the grouped picker');
    assert.match(await page.locator('.picker-footnote').innerText(), /Sample content/);
    if (capture) images.push({ name: 'picker-1440', bytes: await page.screenshot() });
    await page.keyboard.press('Escape');
    checks.push('Grouped picker: Time / Weather & sky / Personal / Pictures in catalog order with labelled groups, Weather and no Rain (#74), Up/Down/Home/End (clamped, across groups) preview the focused widget, Tab order kept, synthetic samples for the three widgets, free-size caption only for Reminders (#73)');

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
    await tab('Style'); await button('Night').click();
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
    await tab('Style'); await button('Night').click(); await save();
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
    await tab('Style'); await button('Room').click(); await save();
    assert.equal(snapshot().widgetData.note.text, 'Dinner at seven\nBack by nine'); assert.equal(snapshot().widgetData.countdowns.length, 1); assert.equal(snapshot().widgetData.calendar.weekStart, 'monday');
    assert.deepEqual(added(), board, 'Room keeps Calendar, Countdown and Note enabled and in place');
    await button('Night').click(); await save();
    assert.deepEqual(added(), board, 'Night keeps them too');
    await page.getByText('Saved styles', { exact: true }).click();
    await page.getByLabel('Style name', { exact: true }).fill('Synthetic style'); await button('Add style').click(); await save();
    await button('Room').click(); await save();
    await page.getByRole('combobox', { name: 'Saved style', exact: true }).selectOption({ label: 'Synthetic style' });
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
    await app.store.patchSettings({
      appearance: { motionIntervalSeconds: 30 },
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
        const plane = document.querySelector('.widget-grid-plane').getBoundingClientRect();
        return Object.fromEntries(ids.map(id => {
          const element = document.querySelector(`[data-widget-id="${id}"]`);
          if (!element) return [id, null];
          const box = element.getBoundingClientRect();
          const outside = [...element.querySelectorAll('*')].filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1); }).length;
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
    checks.push('Dense Balanced board (88/96 cells) with a 2 × 8 Reminders column beside Calendar, Countdown and Note: the server keeps the span, and display compositions 0–3 keep every widget whole, inside the plane, disjoint and relocating (#73, #93)');

    // 7. Narrow reflow and Save-bar clearance for focused fields.
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 844 }, { width: 390, height: 480 }]) {
      await open({ viewport });
      row = await inspector('Countdown');
      await row.getByRole('button', { name: 'Add date', exact: true }).click();
      const title = row.getByRole('textbox', { name: 'Countdown 2 title' });
      await title.fill('Synthetic focus'); await page.keyboard.press('Tab'); await page.clock.runFor(100);
      const date = row.getByLabel('Countdown 2 date', { exact: true });
      assert.equal(await date.evaluate(element => element === document.activeElement), true);
      await date.scrollIntoViewIfNeeded();
      const field = await date.boundingBox(), bar = await savebar().boundingBox();
      assert.ok(field.y >= 0 && field.y + field.height <= bar.y - 4, `${viewport.width}×${viewport.height} focused date clears the Save bar: ${JSON.stringify({ field, bar })}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${viewport.width}px has no horizontal scroll`);
      const overflow = await row.evaluate(element => [...element.querySelectorAll('input, button, textarea, select')].filter(control => { const r = control.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map(control => control.getAttribute('aria-label') ?? control.textContent));
      assert.deepEqual(overflow, [], `${viewport.width}px countdown controls stay within the screen`);
      await row.getByRole('button', { name: 'Remove countdown 2' }).click();
      const noteRow = await inspector('Note');
      await noteRow.getByRole('textbox', { name: 'Note' }).fill('Synthetic narrow note'); await page.clock.runFor(100);
      await noteRow.getByRole('textbox', { name: 'Note' }).blur(); await noteRow.getByRole('textbox', { name: 'Note' }).focus(); await page.clock.runFor(100);
      const box = await noteRow.getByRole('textbox', { name: 'Note' }).boundingBox(), noteBar = await savebar().boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= noteBar.y - 4, `${viewport.width}x${viewport.height} focused note clears the Save bar: ${JSON.stringify({ box, noteBar })}`);
      if (capture) images.push({ name: `panels-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
      await cancel();
    }
    checks.push('390/320px and 390×480 reflow: no horizontal scroll, countdown controls on screen, focused fields clear of the Save bar');

    // 8. The grouped picker fits the compact viewports.
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1280, height: 600 }, { width: 1024, height: 600 }, { width: 760, height: 600 }, { width: 390, height: 700 }, { width: 390, height: 480 }, { width: 640, height: 300 }]) {
      await reset(); await open({ viewport });
      await tab('Widgets'); await button('Add widget').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${viewport.width}×${viewport.height} picker has no horizontal scroll`);
      if (viewport.width > 700) {
        const panel = await page.locator('.inspector-panel').evaluate(element => [element.clientHeight, element.scrollHeight]);
        assert.ok(panel[1] <= panel[0] + 1, `${viewport.width}×${viewport.height} picker fits its panel`);
      }
      const labels = await page.locator('.catalog-group-label').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && node.scrollWidth <= Math.ceil(r.width) + 1; }));
      assert.ok(labels.every(Boolean), `${viewport.width}×${viewport.height} group labels are visible and unclipped`);
      for (const name of ['Calendar', 'Countdown', 'Note']) {
        const item = button(`Preview ${name}`); await item.scrollIntoViewIfNeeded(); await item.click();
        const add = button(`Add ${name}`); await add.scrollIntoViewIfNeeded(); await inView(add, `${viewport.width}×${viewport.height} Add ${name}`);
      }
      if (capture) images.push({ name: `picker-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
    }
    checks.push('Grouped picker fits 1280×720, 1280×600, 1024×600, 760×600, 390×700, 390×480 and 640×300 with visible group labels and reachable Add actions');
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
