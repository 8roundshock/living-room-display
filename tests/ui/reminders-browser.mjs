// Reminders tab check-off and local history (#73). Own ephemeral loopback server and data;
// synthetic reminders only. Screenshots are RAM buffers and only taken with `capture`.
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

const now = Date.parse('2026-10-18T13:00:00Z'); // Sunday 9:00 AM in Toronto
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
function reminder(index, text, { dueAt = null, completedAt = null, createdAt = new Date(now - (100 - index) * 60_000).toISOString() } = {}) {
  return { id: id(index), text, completed: completedAt !== null, dueAt, createdAt, updatedAt: completedAt ?? createdAt };
}
function seed() {
  const archived = Array.from({ length: 55 }, (_, index) => reminder(100 + index, `Archived ${index + 1}`, { completedAt: new Date(Date.parse('2025-09-01T15:00:00Z') + index * 3_600_000).toISOString(), createdAt: '2025-08-01T12:00:00.000Z' }));
  return [
    reminder(1, 'Pay the bill', { dueAt: '2026-10-17T19:00:00.000Z' }),
    reminder(2, 'Water the plants', { dueAt: '2026-10-18T22:00:00.000Z' }),
    reminder(3, 'Plan the weekend'),
    reminder(4, 'Call a friend'),
    reminder(5, 'Book a check-up', { dueAt: '2026-11-20T15:00:00.000Z' }),
    reminder(10, 'Read a chapter', { dueAt: '2026-10-17T19:00:00.000Z', completedAt: '2026-10-18T12:42:00.000Z' }),
    reminder(11, 'Take a walk', { completedAt: '2026-10-17T23:15:00.000Z' }),
    reminder(12, 'Fix the shelf', { completedAt: '2026-10-12T16:00:00.000Z' }),
    reminder(13, 'Old note', { completedAt: '2025-10-12T16:00:00.000Z' }),
    ...archived,
  ];
}

export async function runRemindersQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-reminders-ui-'));
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), now: () => now, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  const stored = text => app.store.snapshot().reminders.find(item => item.text === text);
  async function reset(clockFormat = '12h') {
    await app.store.update(data => { data.settings = { ...defaultSettings(), clockFormat }; data.reminders = seed(); });
  }
  async function open({ viewport = { width: 1280, height: 720 }, reducedMotion = 'no-preference' } = {}) {
    const context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', reducedMotion });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/\b(409|500)\b/.test(message.text())) errors.push(message.text()); });
    // Location lookups stay pending; this suite never touches device location.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } });
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: () => undefined } });
    });
    await page.clock.install({ time: new Date(now) });
    await page.goto(`${base}/editor`);
    await page.locator('.clock-time').waitFor();
    await page.clock.runFor(1000);
    await page.getByRole('tab', { name: /^Reminders/ }).click();
    await page.clock.runFor(300);
    return { context, page };
  }
  const circle = (page, text) => page.getByRole('button', { name: `Complete: ${text}`, exact: true });
  const rowTitles = page => page.locator('.reminders-panel .reminder-list .reminder-copy p').allTextContents();
  const focused = page => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent);
  const status = page => page.locator('.reminder-status');
  const canvasReminders = page => page.locator('.preview-surface .ambient-reminders');

  try {
    await reset();
    let { page, context } = await open();
    assert.equal(await page.locator('#tab-Reminders .tab-count').textContent(), '5');
    assert.equal(await page.getByRole('button', { name: 'Up next (5)', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: 'History (59)', exact: true }).getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await rowTitles(page), ['Pay the bill', 'Water the plants', 'Call a friend', 'Plan the weekend', 'Book a check-up'], 'same order as the display');
    assert.deepEqual(await page.locator('.reminders-panel .reminder-copy > span').allTextContents(), ['Overdue · Yesterday · 3:00 PM', 'Today · 6:00 PM', 'Anytime', 'Anytime', 'Nov 20 · 10:00 AM']);
    assert.equal(await page.getByText('Show completed', { exact: false }).count(), 0, 'the segmented control replaces Show completed');
    assert.equal(await page.locator('.reminders-panel .complete-button').first().evaluate(element => element.getBoundingClientRect().width), 44);
    for (const text of ['Pay the bill', 'Water the plants']) {
      await page.getByRole('button', { name: `Edit: ${text}`, exact: true }).waitFor();
      await page.getByRole('button', { name: `Delete: ${text}`, exact: true }).waitFor();
    }
    assert.match(await canvasReminders(page).innerText(), /Pay the bill/);
    assert.doesNotMatch(await canvasReminders(page).innerText(), /Read a chapter|Take a walk/, 'the canvas widget never shows history');
    checks.push('Up next lists pending reminders in the display order with due lines, 44 px circles, Edit/Delete, the tab badge and History count');
    if (capture) images.push({ name: 'up-next-1280', bytes: await page.screenshot() });

    // One tap: the check fills at once, the row settles, then moves to History.
    await circle(page, 'Pay the bill').click();
    await page.locator('.reminders-panel .complete-button.done').first().waitFor();
    assert.equal(await page.locator('.reminders-panel .reminder-copy.done p').first().textContent(), 'Pay the bill');
    await status(page).getByText('Completed “Pay the bill”', { exact: true }).waitFor();
    await page.clock.runFor(50);
    assert.equal(await focused(page), 'Complete: Water the plants', 'focus moves to the next circle');
    assert.equal(stored('Pay the bill').completed, true);
    assert.equal(stored('Pay the bill').updatedAt, new Date(now).toISOString());
    assert.doesNotMatch(await canvasReminders(page).innerText(), /Pay the bill/, 'the canvas widget drops it as soon as it is saved');
    assert.ok((await rowTitles(page)).includes('Pay the bill'), 'the row stays while it settles');
    if (capture) images.push({ name: 'settling', bytes: await page.locator('.inspector').screenshot({ animations: 'disabled' }) });
    await page.clock.runFor(1300);
    assert.deepEqual(await rowTitles(page), ['Water the plants', 'Call a friend', 'Plan the weekend', 'Book a check-up']);
    assert.equal(await page.locator('#tab-Reminders .tab-count').textContent(), '4');
    await page.getByRole('button', { name: 'Up next (4)', exact: true }).waitFor();
    await page.getByRole('button', { name: 'History (60)', exact: true }).waitFor();
    checks.push('one tap fills the check and dims the title at once, saves, moves focus to the next circle, settles and leaves Up next; the canvas widget drops it');

    // Undo (here from the keyboard) restores it to its sorted position and focuses its circle.
    await status(page).getByRole('button', { name: 'Undo', exact: true }).focus();
    await page.keyboard.press('Enter');
    await status(page).getByText('Restored “Pay the bill”', { exact: true }).waitFor();
    await page.clock.runFor(50);
    assert.equal(await focused(page), 'Complete: Pay the bill', 'focus moves to the restored reminder, not <body>');
    assert.equal(stored('Pay the bill').completed, false);
    assert.equal((await rowTitles(page))[0], 'Pay the bill');
    assert.equal(await status(page).getByRole('button', { name: 'Undo' }).count(), 0);
    // A second tap during the settle restores. The row stays (unchecked) while the restore
    // saves, even when that takes longer than the settle and collapse.
    let releaseRestore;
    const restoreHeld = new Promise(resolve => { releaseRestore = resolve; });
    await page.route('**/api/reminders/*', async route => {
      if (route.request().method() === 'PATCH' && JSON.parse(route.request().postData() ?? '{}').completed === false) await restoreHeld;
      await route.fallback();
    });
    await circle(page, 'Water the plants').click();
    await status(page).getByText('Completed “Water the plants”', { exact: true }).waitFor();
    await page.clock.runFor(300);
    await circle(page, 'Water the plants').click();
    for (let step = 0; step < 3; step++) {
      await page.clock.runFor(500);
      assert.ok((await rowTitles(page)).includes('Water the plants'), 'the row stays while its restore saves');
      assert.equal(await page.locator('.editor-reminder-row.leaving').count(), 0, 'no collapse while restoring');
    }
    assert.equal(await circle(page, 'Water the plants').evaluate(element => element.classList.contains('done')), false, 'shown unchecked while restoring');
    releaseRestore();
    await status(page).getByText('Restored “Water the plants”', { exact: true }).waitFor();
    await page.unroute('**/api/reminders/*');
    assert.equal(stored('Water the plants').completed, false);
    await page.clock.runFor(1500);
    assert.ok((await rowTitles(page)).includes('Water the plants'));
    await circle(page, 'Book a check-up').click();
    await status(page).getByRole('button', { name: 'Undo', exact: true }).waitFor();
    await page.clock.runFor(8100);
    assert.equal(await status(page).getByRole('button', { name: 'Undo' }).count(), 0, 'Undo lasts about eight seconds');
    checks.push('keyboard Undo and a second tap during the settle restore to the sorted position (Undo focuses the restored circle; a slow restore keeps the row); Undo expires after ~8 s');

    // Keyboard users tick off several in a row.
    await circle(page, 'Pay the bill').focus();
    await page.keyboard.press('Enter');
    await page.clock.runFor(50);
    assert.equal(await focused(page), 'Complete: Water the plants');
    await page.keyboard.press('Enter');
    await page.clock.runFor(50);
    assert.equal(await focused(page), 'Complete: Call a friend');
    await page.clock.runFor(1300);
    assert.deepEqual(await rowTitles(page), ['Call a friend', 'Plan the weekend']);
    checks.push('keyboard Enter completes and focus walks to the next circle');

    // A failed save reverts the row and says so.
    await page.route('**/api/reminders/*', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic failure' }) }) : route.fallback());
    await circle(page, 'Call a friend').click();
    await page.getByRole('alert').getByText('Could not complete reminder. It is still in Up next.', { exact: true }).waitFor();
    assert.equal(await page.locator('.reminders-panel .complete-button.done').count(), 0, 'the row reverts');
    assert.equal(stored('Call a friend').completed, false);
    await page.unroute('**/api/reminders/*');
    checks.push('a forced 500 reverts the row with the honest error');

    // History: day groups, restore and delete, no Edit for completed reminders.
    await page.getByRole('button', { name: /^History \(/ }).click();
    const headings = await page.locator('.history-heading').allTextContents();
    assert.deepEqual(headings.slice(0, 4), ['TODAY', 'YESTERDAY', 'Mon, Oct 12', 'Oct 12, 2025']);
    assert.equal(await page.locator('.reminders-panel .history-check').count(), 50, 'the first 50 items');
    const today = page.locator('.history-day').first();
    // The synthetic server clock is fixed, so equal completion times fall back to the newest created.
    assert.deepEqual(await today.locator('.reminder-copy p').allTextContents(), ['Book a check-up', 'Water the plants', 'Pay the bill', 'Read a chapter']);
    assert.equal(await today.locator('.reminder-copy > span').last().textContent(), 'Completed 8:42 AM · was due Yesterday · 3:00 PM');
    assert.equal(await page.locator('.reminders-panel').getByRole('button', { name: /^Edit:/ }).count(), 0, 'completed rows have no Edit');
    await page.getByRole('button', { name: 'Show 12 more', exact: true }).click();
    assert.equal(await page.locator('.reminders-panel .history-check').count(), 62);
    assert.equal(await page.getByText('Kept on this computer · latest 500', { exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Restore: Read a chapter', exact: true }).click();
    await status(page).getByText('Restored “Read a chapter”', { exact: true }).waitFor();
    assert.equal(stored('Read a chapter').completed, false);
    await page.getByRole('button', { name: 'Move back to Up next: Take a walk', exact: true }).click();
    await status(page).getByText('Restored “Take a walk”', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Delete: Fix the shelf', exact: true }).click();
    await status(page).getByText('Deleted from history', { exact: true }).waitFor();
    assert.equal(stored('Fix the shelf'), undefined);
    await page.getByRole('button', { name: /^Up next \(/ }).click();
    assert.deepEqual(await rowTitles(page), ['Read a chapter', 'Take a walk', 'Call a friend', 'Plan the weekend'], 'restored items return at their sorted positions');
    checks.push('History groups by completion day (TODAY/YESTERDAY/weekday/other year), pages by 50, has no Edit, restores to the sorted position and deletes');
    if (capture) { await page.getByRole('button', { name: /^History \(/ }).click(); images.push({ name: 'history-1280', bytes: await page.screenshot() }); await page.getByRole('button', { name: /^Up next \(/ }).click(); }

    // Saving an edit for a reminder completed elsewhere.
    await page.getByRole('button', { name: 'Edit: Plan the weekend', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).fill('Plan the long weekend');
    const response = await fetch(`${base}/api/reminders/${id(3)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: true }) });
    assert.equal(response.status, 200);
    await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
    await page.getByRole('alert').getByText('This reminder was completed elsewhere. Restore it to edit.', { exact: true }).waitFor();
    assert.equal(stored('Plan the weekend').completed, true);
    assert.equal(stored('Plan the long weekend'), undefined);
    await page.getByRole('button', { name: 'Cancel reminder', exact: true }).click();
    await page.clock.runFor(100);
    assert.equal((await rowTitles(page)).includes('Plan the weekend'), false, 'the list refreshes after the conflict');
    checks.push('an edit of a reminder completed in another tab returns 409 with “completed elsewhere”, and the list refreshes');

    // Form Cancel abandons only the form.
    const before = JSON.stringify(app.store.snapshot().reminders);
    await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).fill('Never saved');
    await page.getByRole('button', { name: 'Cancel reminder', exact: true }).click();
    await page.getByRole('button', { name: 'Edit: Call a friend', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).fill('Changed then cancelled');
    await page.getByRole('button', { name: 'Cancel reminder', exact: true }).click();
    assert.equal(JSON.stringify(app.store.snapshot().reminders), before);
    assert.equal(await page.locator('.studio-savebar').count(), 0, 'reminders never join the settings draft');
    assert.equal(await page.locator('.reminder-form').count(), 0);
    checks.push('reminder form Cancel abandons only the form; no settings Save bar');

    // Clear history: Keep, then Delete all.
    await page.getByRole('button', { name: /^History \(/ }).click();
    const completedCount = app.store.snapshot().reminders.filter(item => item.completed).length;
    await page.getByRole('button', { name: 'Clear history…', exact: true }).click();
    assert.equal(await page.locator('.clear-history-confirm p').textContent(), `Delete ${completedCount} completed reminders? This can’t be undone.`);
    await page.getByRole('button', { name: 'Keep', exact: true }).click();
    assert.equal(await page.locator('.clear-history-confirm').count(), 0);
    assert.equal(app.store.snapshot().reminders.filter(item => item.completed).length, completedCount);
    await page.getByRole('button', { name: 'Clear history…', exact: true }).click();
    await page.getByRole('button', { name: 'Delete all', exact: true }).click();
    await status(page).getByText(`History cleared (${completedCount})`, { exact: true }).waitFor();
    assert.equal(app.store.snapshot().reminders.filter(item => item.completed).length, 0);
    assert.ok(app.store.snapshot().reminders.length > 0, 'pending reminders stay');
    await page.getByText('No completed reminders yet', { exact: true }).waitFor();
    await page.getByText('Check off a reminder and it moves here.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'History (0)', exact: true }).waitFor();
    checks.push('Clear history confirms inline: Keep changes nothing, Delete all clears only completed reminders, then the empty state');
    await context.close();

    // Every time label follows the 24-hour setting (#129).
    await reset('24h');
    ({ page, context } = await open());
    assert.deepEqual((await page.locator('.reminders-panel .reminder-copy > span').allTextContents()).slice(0, 2), ['Overdue · Yesterday · 15:00', 'Today · 18:00']);
    await page.getByRole('button', { name: /^History \(/ }).click();
    assert.equal(await page.locator('.history-day').first().locator('.reminder-copy > span').first().textContent(), 'Completed 08:42 · was due Yesterday · 15:00');
    assert.match(await canvasReminders(page).innerText(), /Overdue · Yesterday · 15:00/);
    await context.close();
    checks.push('due, completed and canvas labels follow the 24-hour setting');

    // The tab fits phone and desktop sizes; focus stays clear of the Save bar.
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 700 }, { width: 390, height: 480 }]) {
      await reset();
      ({ page, context } = await open({ viewport }));
      await page.getByRole('tab', { name: 'Style', exact: true }).click();
      await page.getByRole('button', { name: 'Night', exact: true }).click();
      await page.getByRole('tab', { name: /^Reminders/ }).click();
      await page.clock.runFor(300);
      await page.locator('.studio-savebar').waitFor();
      for (const view of ['Up next', 'History']) {
        await page.getByRole('button', { name: new RegExp(`^${view} \\(`) }).click();
        const last = view === 'Up next' ? page.getByRole('button', { name: 'Delete: Book a check-up', exact: true }) : page.getByRole('button', { name: 'Clear history…', exact: true });
        const previous = view === 'Up next' ? page.getByRole('button', { name: 'Edit: Book a check-up', exact: true }) : page.getByRole('button', { name: 'Show 9 more', exact: true });
        await previous.focus();
        await page.keyboard.press('Tab');
        await page.clock.runFor(100);
        const layout = await page.evaluate(() => {
          const active = document.activeElement.getBoundingClientRect(), bar = document.querySelector('.studio-savebar').getBoundingClientRect();
          return { label: document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent, bottom: active.bottom, top: active.top, barTop: bar.top, panelBottom: document.querySelector('.inspector-panel').getBoundingClientRect().bottom, scroll: document.documentElement.scrollWidth, width: innerWidth };
        });
        assert.equal(layout.label, await last.evaluate(element => element.getAttribute('aria-label') ?? element.textContent));
        assert.ok(layout.bottom <= layout.barTop + 0.5 && layout.top >= 0, `${viewport.width}×${viewport.height} ${view}: focus clear of the Save bar ${JSON.stringify(layout)}`);
        assert.ok(layout.scroll <= layout.width, `${viewport.width}×${viewport.height}: no horizontal page scroll`);
        if (capture) images.push({ name: `${view}-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
      }
      await context.close();
    }
    checks.push('the tab fits 1280×720, 390×700 and 390×480 with keyboard focus clear of the Save bar and no horizontal scroll');

    // Reduced motion removes the collapse but keeps the settle delay.
    await reset();
    ({ page, context } = await open({ reducedMotion: 'reduce' }));
    await circle(page, 'Pay the bill').click();
    await status(page).getByText('Completed “Pay the bill”', { exact: true }).waitFor();
    await page.clock.runFor(600);
    assert.ok((await rowTitles(page)).includes('Pay the bill'), 'still settling');
    assert.equal(await page.locator('.editor-reminder-row.leaving').count(), 0);
    await page.clock.runFor(400);
    assert.equal((await rowTitles(page)).includes('Pay the bill'), false);
    await context.close();
    checks.push('reduced motion keeps the settle delay without the collapse');

    // Deleting a row while it settles is a delete from Up next; one completed reminder is singular.
    await reset();
    await app.store.update(data => { data.reminders = data.reminders.filter(item => !item.completed || item.text === 'Read a chapter'); });
    ({ page, context } = await open());
    await circle(page, 'Pay the bill').click();
    await status(page).getByText('Completed “Pay the bill”', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Delete: Pay the bill', exact: true }).click();
    await status(page).getByText('Reminder deleted', { exact: true }).waitFor();
    assert.equal(stored('Pay the bill'), undefined);
    await page.clock.runFor(1300);
    assert.equal((await rowTitles(page)).includes('Pay the bill'), false);
    await page.getByRole('button', { name: 'History (1)', exact: true }).click();
    await page.getByRole('button', { name: 'Clear history…', exact: true }).click();
    assert.equal(await page.locator('.clear-history-confirm p').textContent(), 'Delete 1 completed reminder? This can’t be undone.');
    await page.getByRole('button', { name: 'Delete all', exact: true }).click();
    await status(page).getByText('History cleared (1)', { exact: true }).waitFor();
    await context.close();
    checks.push('a delete while settling reads “Reminder deleted”; one completed reminder reads “Delete 1 completed reminder?”');

    assert.deepEqual(errors, []);
    return { checks, images };
  } finally {
    await browser.close();
    app.server.closeAllConnections();
    app.server.close();
    await once(app.server, 'close');
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runRemindersQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks }, null, 2));
}
