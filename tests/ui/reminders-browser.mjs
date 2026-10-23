import { mockWindowsStatus } from './lib/windows-fixture.mjs';
// Home All reminders dialog check-off, local history (#73), editor polish (#265) and the #372 polish: compact rows
// (#366), reminders deleted in another window (#355), forms kept across dialog reopen with a leave prompt
// (#274), expiring messages (#295), a future creation time on Undo (#296), focus after an expired Undo
// (#297) and typing cost (#354). Own ephemeral loopback server and data; synthetic reminders only.
// Screenshots are RAM buffers and only taken with `capture`.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';

const now = Date.parse('2026-10-18T13:00:00Z'); // Sunday 9:00 AM in Toronto
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
function reminder(index, text, { dueAt = null, completedAt = null, createdAt = new Date(now - (100 - index) * 60_000).toISOString() } = {}) {
  return { id: id(index), text, completed: completedAt !== null, dueAt, createdAt, updatedAt: completedAt ?? createdAt };
}
/** Five pending reminders (eight with `extra`) and 59 completed ones. */
function seed({ extra = false } = {}) {
  const archived = Array.from({ length: 55 }, (_, index) => reminder(100 + index, `Archived ${index + 1}`, { completedAt: new Date(Date.parse('2025-09-01T15:00:00Z') + index * 3_600_000).toISOString(), createdAt: '2025-08-01T12:00:00.000Z' }));
  return [
    reminder(1, 'Pay the bill', { dueAt: '2026-10-17T19:00:00.000Z' }),
    reminder(2, 'Water the plants', { dueAt: '2026-10-18T22:00:00.000Z' }),
    reminder(3, 'Plan the weekend'),
    reminder(4, 'Call a friend'),
    reminder(5, 'Book a check-up', { dueAt: '2026-11-20T15:00:00.000Z' }),
    ...(extra ? [reminder(6, 'Pick up groceries'), reminder(7, 'Return the library books'), reminder(8, 'Sort the recycling')] : []),
    reminder(10, 'Read a chapter', { dueAt: '2026-10-17T19:00:00.000Z', completedAt: '2026-10-18T12:42:00.000Z' }),
    reminder(11, 'Take a walk', { completedAt: '2026-10-17T23:15:00.000Z' }),
    reminder(12, 'Fix the shelf', { completedAt: '2026-10-12T16:00:00.000Z' }),
    reminder(13, 'Old note', { completedAt: '2025-10-12T16:00:00.000Z' }),
    ...archived,
  ];
}
const EIGHT = ['Pay the bill', 'Water the plants', 'Sort the recycling', 'Return the library books', 'Pick up groceries', 'Call a friend', 'Plan the weekend', 'Book a check-up'];

/**
 * Polls `read` in real time until it deep-equals `expected` (#184). The page's fake clock also flows
 * naturally and React renders asynchronously, so a check straight after `clock.runFor` could race.
 */
async function eventually(read, expected, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  let actual;
  for (;;) {
    actual = await read();
    try { assert.deepEqual(actual, expected); return; } catch { /* retry */ }
    if (Date.now() > deadline) break;
    await delay(50);
  }
  assert.deepEqual(actual, expected, label);
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
  /** Pages whose clock is the fake one (all but the real-time typing-cost page). */
  const clocked = new WeakSet();
  async function reset({ clockFormat = '12h', extra = false } = {}) {
    await app.store.update(data => { data.settings = { ...defaultSettings(), clockFormat }; data.reminders = seed({ extra }); });
  }
  async function open({ viewport = { width: 1280, height: 720 }, reducedMotion = 'no-preference', clock = true, init } = {}) {
    const context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', locale: 'en-US', reducedMotion }); await mockWindowsStatus(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    // 404 and 400 replies are expected where a reminder was deleted elsewhere (#355) or a creation time is ahead of the server (#296).
    page.on('console', message => { if (message.type() === 'error' && !/\b(400|404|409|500)\b/.test(message.text())) errors.push(message.text()); });
    // Location lookups stay pending; this suite never touches device location.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } });
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: () => undefined } });
    });
    if (init) await page.addInitScript(init);
    if (clock) { await page.clock.install({ time: new Date(now) }); clocked.add(page); }
    await page.goto(`${base}/`);
    await page.locator('.home-page').waitFor();
    if (clock) await page.clock.runFor(1000);
    await remindersTab(page);
    return { context, page };
  }
  async function remindersTab(page) {
    if (!await page.locator('.home-sheet-allReminders').count())
      await page.getByRole('button', { name: /^All reminders/ }).click();
    if (clocked.has(page)) await page.clock.runFor(300);
    else await page.locator('.reminders-panel').waitFor();
  }
  /** An independent editor draft stays open while Home saves reminders. */
  const editorDrafts = new WeakMap();
  async function dirty(page) {
    const editor = await page.context().newPage();
    await editor.clock.install({ time: new Date(now) });
    await editor.goto(`${base}/editor`);
    await editor.getByRole('combobox', { name: 'Style', exact: true }).selectOption('builtin:night');
    await editor.locator('.studio-savebar').waitFor();
    editorDrafts.set(page, editor);
    await page.bringToFront();
  }
  async function closeReminders(page) {
    await page.getByRole('button', { name: 'Close All reminders', exact: true }).click();
    await page.locator('.home-sheet-allReminders').waitFor({ state: 'detached' });
  }
  const circle = (page, text) => page.getByRole('button', { name: `Complete: ${text}`, exact: true });
  const rowTitles = page => page.locator('.reminders-panel .reminder-list .reminder-copy p').allTextContents();
  const dueLines = page => page.locator('.reminders-panel .reminder-list .reminder-copy > span').allTextContents();
  const focused = page => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent);
  /** Focus moves in a requestAnimationFrame; let the fake clock run it, then poll. */
  const focusIs = async (page, expected, label) => { await page.clock.runFor(50); await eventually(() => focused(page), expected, label); };
  const status = page => page.locator('.reminder-status');
  const undoButton = page => status(page).getByRole('button', { name: 'Undo', exact: true });
  const reminderForm = page => page.locator('.reminders-panel .reminder-form');
  async function canvasReminders(page) {
    // Home deliberately has no preview. Inspect the actual editor renderer in a separate source
    // page, freshly loaded so these immediate-save assertions do not depend on its polling timer.
    const editor = await page.context().newPage();
    try {
      await editor.clock.install({ time: new Date(now) });
      await editor.goto(`${base}/editor`);
      return await editor.locator('.preview-surface .ambient-reminders').innerText();
    } finally { await editor.close(); }
  }
  const patches = (page, count) => new Promise(resolvePatches => {
    let seen = 0;
    const listener = response => {
      if (response.request().method() !== 'PATCH' || !/\/api\/reminders\/[0-9a-f-]{36}$/.test(response.url())) return;
      if (++seen === count) { page.off('response', listener); resolvePatches(); }
    };
    page.on('response', listener);
  });
  /**
   * Where an element sits against what can actually be seen: the inspector's scroll area on desktop,
   * the viewport on a phone, and below the dialog header. `hit` means a click at its
   * centre reaches it.
   */
  const placement = locator => locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const panel = document.querySelector('.home-sheet-body');
    const scrolls = getComputedStyle(panel).overflowY !== 'visible';
    const area = panel.getBoundingClientRect();
    const toolbar = document.querySelector('.home-sheet-header').getBoundingClientRect();
    const overToolbar = toolbar.left < box.right && toolbar.right > box.left;
    const visibleTop = Math.max(0, scrolls ? area.top : 0, overToolbar ? toolbar.bottom : 0);
    const visibleBottom = Math.min(innerHeight, scrolls ? area.bottom : innerHeight);
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), visibleTop: Math.round(visibleTop), visibleBottom: Math.round(visibleBottom), hit: element === hit || element.contains(hit), viewport: `${innerWidth}×${innerHeight}`, mask: scrolls ? getComputedStyle(panel).maskImage : 'n/a' };
  });
  const assertInView = (where, label) => assert.ok(where.top >= where.visibleTop - 1 && where.bottom <= where.visibleBottom + 1 && where.hit, `${label}: ${JSON.stringify(where)}`);
  /**
   * With no status message nothing covers the rows (review of #279). The scroll area (the inspector
   * on desktop, the page on a phone) steps through its whole range; at each step every row control
   * centred in the lower half of what can be seen must be what a click there reaches. `nearEdge`
   * counts the checks within 40 px of the visible bottom edge, where an empty sticky line would sit.
   */
  const rowsReachable = page => page.evaluate(() => {
    const panel = document.querySelector('.home-sheet-body');
    const scroller = getComputedStyle(panel).overflowY !== 'visible' ? panel : document.scrollingElement;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const blocked = [];
    let checked = 0, nearEdge = 0;
    for (let top = 0; top < max + 6; top += 6) {
      scroller.scrollTop = Math.min(top, max);
      const area = panel.getBoundingClientRect();
      const toolbar = document.querySelector('.home-sheet-header').getBoundingClientRect();
      for (const control of document.querySelectorAll('.reminders-panel .reminder-list button')) {
        const box = control.getBoundingClientRect();
        const x = box.left + box.width / 2, y = box.top + box.height / 2;
        const visibleTop = Math.max(0, scroller === panel ? area.top : 0, toolbar.left < box.right && toolbar.right > box.left ? toolbar.bottom : 0);
        const visibleBottom = Math.min(innerHeight, scroller === panel ? area.bottom : innerHeight);
        if (y < (visibleTop + visibleBottom) / 2 || y > visibleBottom - 2) continue;
        checked++;
        if (visibleBottom - y <= 40) nearEdge++;
        const hit = document.elementFromPoint(x, y);
        if (hit !== control && !control.contains(hit)) blocked.push(`${control.getAttribute('aria-label')} at x ${Math.round(x)}, y ${Math.round(y)} (scroll ${Math.round(scroller.scrollTop)}, viewport ${Math.round(visibleTop)}–${Math.round(visibleBottom)}, dialog ${JSON.stringify(document.querySelector('.home-sheet').getBoundingClientRect().toJSON())}) under ${hit?.tagName}.${hit?.className}`);
      }
    }
    scroller.scrollTop = 0;
    return { blocked: blocked.slice(0, 4), checked, nearEdge, max };
  });
  const assertRowsReachable = async (page, label) => {
    const result = await rowsReachable(page);
    const independent = editorDrafts.get(page);
    if (independent) {
      assert.equal(await independent.locator('.studio-savebar').count(), 1, 'Home actions keep the other page’s visual draft');
      assert.equal(await independent.getByRole('combobox', { name: 'Style', exact: true }).inputValue(), 'builtin:night');
    }
    assert.ok(result.max > 0 && result.nearEdge > 0, `${label}: the list scrolls past the bottom edge ${JSON.stringify(result)}`);
    assert.deepEqual(result.blocked, [], `${label}: every row control in the lower half receives the click (${result.checked} checks)`);
  };
  /** Scrolls the lowest Edit button that can get there to sit 19 px above the visible bottom edge; returns its centre. */
  const editAtBottomEdge = page => page.evaluate(() => {
    const panel = document.querySelector('.home-sheet-body');
    const scroller = getComputedStyle(panel).overflowY !== 'visible' ? panel : document.scrollingElement;
    const max = scroller.scrollHeight - scroller.clientHeight;
    let chosen = null;
    for (const control of document.querySelectorAll('.reminders-panel .reminder-list .edit-reminder')) {
      const box = control.getBoundingClientRect();
      const visibleBottom = Math.min(innerHeight, scroller === panel ? panel.getBoundingClientRect().bottom : innerHeight);
      const scroll = scroller.scrollTop + (box.top + box.height / 2) - (visibleBottom - 19);
      if (scroll >= 0 && scroll <= max) chosen = { control, scroll };
    }
    if (!chosen) return null;
    scroller.scrollTop = chosen.scroll;
    const box = chosen.control.getBoundingClientRect();
    return { label: chosen.control.getAttribute('aria-label'), x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });

  try {
    await reset();
    let { page, context } = await open();
    assert.equal(await page.getByRole('button', { name: /^All reminders/ }).textContent().then(text => text.trim()), 'All reminders · 5');
    assert.equal(await page.getByRole('button', { name: 'Up next (5)', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: 'History (59)', exact: true }).getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await rowTitles(page), ['Pay the bill', 'Water the plants', 'Call a friend', 'Plan the weekend', 'Book a check-up'], 'same order as the display');
    assert.deepEqual(await dueLines(page), ['Overdue · Yesterday · 3:00 PM', 'Today · 6:00 PM', 'Anytime', 'Anytime', 'Nov 20 · 10:00 AM']);
    assert.equal(await page.getByText('Show completed', { exact: false }).count(), 0, 'the segmented control replaces Show completed');
    assert.equal(await page.locator('.reminders-panel .complete-button').first().evaluate(element => element.getBoundingClientRect().width), 44);
    assert.deepEqual(await page.locator('.reminders-panel .complete-button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-pressed'))), ['false', 'false', 'false', 'false', 'false']);
    for (const text of ['Pay the bill', 'Water the plants']) {
      await page.getByRole('button', { name: `Edit: ${text}`, exact: true }).waitFor();
      await page.getByRole('button', { name: `Delete: ${text}`, exact: true }).waitFor();
    }
    assert.match(await canvasReminders(page), /Pay the bill/);
    assert.doesNotMatch(await canvasReminders(page), /Read a chapter|Take a walk/, 'the canvas widget never shows history');
    checks.push('Up next lists pending reminders in the display order with due lines, unpressed 44 px circles, Edit/Delete, the Home pending count and History count');
    if (capture) images.push({ name: 'up-next-1280', bytes: await page.screenshot() });

    // One tap: the check fills at once and reads as pressed (#186), the row settles, then moves to History.
    await circle(page, 'Pay the bill').click();
    await page.locator('.reminders-panel .complete-button.done').first().waitFor();
    assert.equal(await page.locator('.reminders-panel .reminder-copy.done p').first().textContent(), 'Pay the bill');
    assert.equal(await circle(page, 'Pay the bill').getAttribute('aria-pressed'), 'true', 'pressed while it saves and settles');
    await status(page).getByText('Completed “Pay the bill”', { exact: true }).waitFor();
    await focusIs(page, 'Complete: Water the plants', 'focus moves to the next circle');
    assert.equal(stored('Pay the bill').completed, true);
    assert.equal(stored('Pay the bill').updatedAt, new Date(now).toISOString());
    assert.doesNotMatch(await canvasReminders(page), /Pay the bill/, 'the canvas widget drops it as soon as it is saved');
    assert.ok((await rowTitles(page)).includes('Pay the bill'), 'the row stays while it settles');
    if (capture) images.push({ name: 'settling', bytes: await page.locator('.inspector').screenshot({ animations: 'disabled' }) });
    await page.clock.runFor(1300);
    await eventually(() => rowTitles(page), ['Water the plants', 'Call a friend', 'Plan the weekend', 'Book a check-up'], 'the row leaves Up next after the settle');
    assert.equal(await page.getByRole('button', { name: /^All reminders/ }).textContent().then(text => text.trim()), 'All reminders · 4');
    await page.getByRole('button', { name: 'Up next (4)', exact: true }).waitFor();
    await page.getByRole('button', { name: 'History (60)', exact: true }).waitFor();
    checks.push('one tap fills the check (aria-pressed) and dims the title at once, saves, moves focus to the next circle, settles and leaves Up next; the canvas widget drops it');

    // Undo (here from the keyboard) restores it to its sorted position and focuses its circle.
    await undoButton(page).focus();
    await page.keyboard.press('Enter');
    await status(page).getByText('Restored “Pay the bill”', { exact: true }).waitFor();
    await focusIs(page, 'Complete: Pay the bill', 'focus moves to the restored reminder, not <body>');
    assert.equal(stored('Pay the bill').completed, false);
    assert.equal((await rowTitles(page))[0], 'Pay the bill');
    assert.equal(await undoButton(page).count(), 0);
    // A second tap during the settle restores. The row stays (unchecked, unpressed) while the
    // restore saves, even when that takes longer than the settle and collapse.
    let releaseRestore;
    const restoreHeld = new Promise(resolveHeld => { releaseRestore = resolveHeld; });
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
    assert.equal(await circle(page, 'Water the plants').getAttribute('aria-pressed'), 'false', 'unpressed once the restore starts');
    releaseRestore();
    await status(page).getByText('Restored “Water the plants”', { exact: true }).waitFor();
    await page.unroute('**/api/reminders/*');
    assert.equal(stored('Water the plants').completed, false);
    await page.clock.runFor(1500);
    assert.ok((await rowTitles(page)).includes('Water the plants'));
    await circle(page, 'Book a check-up').click();
    await undoButton(page).waitFor();
    await page.clock.runFor(8100);
    await eventually(() => undoButton(page).count(), 0, 'Undo lasts about eight seconds');
    checks.push('keyboard Undo and a second tap during the settle restore to the sorted position (Undo focuses the restored circle; a slow restore keeps the row, unpressed); Undo expires after ~8 s');

    // Keyboard users tick off several in a row. Both saves finish before the fake clock runs past
    // the settle, and the result is polled rather than read once (#184).
    await page.clock.runFor(1500);
    const twoSaves = patches(page, 2);
    await circle(page, 'Pay the bill').focus();
    await page.keyboard.press('Enter');
    await focusIs(page, 'Complete: Water the plants');
    await page.keyboard.press('Enter');
    await focusIs(page, 'Complete: Call a friend');
    await twoSaves;
    await status(page).getByText('Completed “Water the plants”', { exact: true }).waitFor();
    await page.clock.runFor(1300);
    await eventually(() => rowTitles(page), ['Call a friend', 'Plan the weekend'], 'both keyboard completions settle and leave');
    checks.push('keyboard Enter completes and focus walks to the next circle; both saves land before the settle (#184)');

    // A failed save reverts the row, unpressed, and says so.
    await page.route('**/api/reminders/*', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic failure' }) }) : route.fallback());
    await circle(page, 'Call a friend').click();
    await page.locator('.home-sheet-status.error, [role="alert"]').getByText('Could not complete reminder. It is still in Up next.', { exact: true }).waitFor();
    assert.equal(await page.locator('.reminders-panel .complete-button.done').count(), 0, 'the row reverts');
    assert.equal(await circle(page, 'Call a friend').getAttribute('aria-pressed'), 'false');
    assert.equal(stored('Call a friend').completed, false);
    await page.unroute('**/api/reminders/*');
    checks.push('a forced 500 reverts the row (unpressed) with the honest error');

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
    assert.equal(await undoButton(page).count(), 0, 'a History delete offers no Undo');
    assert.equal(stored('Fix the shelf'), undefined);
    await page.getByRole('button', { name: /^Up next \(/ }).click();
    assert.deepEqual(await rowTitles(page), ['Read a chapter', 'Take a walk', 'Call a friend', 'Plan the weekend'], 'restored items return at their sorted positions');
    checks.push('History groups by completion day (TODAY/YESTERDAY/weekday/other year), pages by 50, has no Edit, restores to the sorted position and deletes (no Undo)');
    if (capture) { await page.getByRole('button', { name: /^History \(/ }).click(); images.push({ name: 'history-1280', bytes: await page.screenshot() }); await page.getByRole('button', { name: /^Up next \(/ }).click(); }

    // Editing happens in place under an "Edit reminder" heading (#236). The edited row has no circle,
    // so it cannot be checked off in this tab (#187); other rows still can, and the edit survives.
    await page.getByRole('button', { name: 'Edit: Plan the weekend', exact: true }).click();
    await page.getByRole('heading', { name: 'Edit reminder', exact: true }).waitFor();
    assert.equal(await page.locator('.editor-reminder-row.editing .reminder-form').count(), 1, 'the form takes the row’s place');
    assert.equal(await circle(page, 'Plan the weekend').count(), 0, 'the reminder being edited has no circle');
    assert.equal(await page.getByRole('button', { name: 'Cancel reminder' }).count(), 0, '“Cancel reminder” is renamed');
    await page.getByRole('button', { name: 'Discard', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.reminder-form input:not([type])')), true, 'the title field has focus');
    await page.getByLabel('Reminder', { exact: true }).fill('Plan the long weekend');
    await circle(page, 'Take a walk').click();
    await status(page).getByText('Completed “Take a walk”', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Reminder', { exact: true }).inputValue(), 'Plan the long weekend', 'checking off another reminder keeps the edit');
    await page.clock.runFor(1300);
    // Saving an edit for a reminder completed elsewhere: the cross-tab 409 keeps its message, then
    // the refreshed list shows it checked off and Save waits until it is restored.
    const response = await fetch(`${base}/api/reminders/${id(3)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: true }) });
    assert.equal(response.status, 200);
    await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
    await page.locator('.home-sheet-status.error, [role="alert"]').getByText('This reminder was completed elsewhere. Restore it to edit.', { exact: true }).waitFor();
    assert.equal(stored('Plan the weekend').completed, true);
    assert.equal(stored('Plan the long weekend'), undefined);
    await page.getByText('Checked off. Undo or restore it to edit.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save reminder', exact: true }).isDisabled(), true, 'Save waits for a restore');
    assert.equal((await rowTitles(page)).includes('Plan the weekend'), false, 'the list refreshes after the conflict');
    assert.equal(await page.getByLabel('Reminder', { exact: true }).inputValue(), 'Plan the long weekend', 'the typed edit is kept');
    await page.getByRole('button', { name: /^History \(/ }).click();
    await page.getByRole('button', { name: 'Restore: Plan the weekend', exact: true }).click();
    await status(page).getByText('Restored “Plan the weekend”', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^Up next \(/ }).click();
    assert.equal(await page.locator('.editor-reminder-row.editing .reminder-form').count(), 1, 'back in place once restored');
    assert.equal(await page.getByText('Checked off. Undo or restore it to edit.', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
    await status(page).getByText('Reminder saved', { exact: true }).waitFor();
    assert.equal(stored('Plan the long weekend').completed, false);
    await focusIs(page, 'Edit: Plan the long weekend', 'after Save, focus returns to the row’s Edit button (#230)');
    checks.push('editing happens in place under “Edit reminder” with no circle for that row; another check-off keeps the edit; a cross-tab completion keeps its 409 message, then Save waits (“Checked off. Undo or restore it to edit.”) until a restore, and saves the kept edit');

    // Discard and Escape abandon only the form and return focus (#230, #236).
    const before = JSON.stringify(app.store.snapshot().reminders);
    await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
    await page.getByRole('heading', { name: 'New reminder', exact: true }).waitFor();
    await page.getByLabel('Reminder', { exact: true }).fill('Never saved');
    await page.getByRole('button', { name: 'Discard', exact: true }).focus();
    await page.keyboard.press('Enter');
    await focusIs(page, 'Add reminder', 'Discard on a new reminder focuses Add');
    await page.getByRole('button', { name: 'Edit: Call a friend', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).fill('Changed then discarded');
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await focusIs(page, 'Edit: Call a friend', 'Discard on an edit focuses that row’s Edit button');
    await page.getByRole('button', { name: 'Edit: Call a friend', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).fill('Changed then escaped');
    await page.keyboard.press('Escape');
    await focusIs(page, 'Edit: Call a friend', 'Escape closes an edit and focuses its Edit button');
    await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
    await page.keyboard.press('Escape');
    await focusIs(page, 'Add reminder', 'Escape closes a new reminder and focuses Add');
    assert.equal(JSON.stringify(app.store.snapshot().reminders), before);
    assert.equal(await page.locator('.studio-savebar').count(), 0, 'reminders never join the settings draft');
    assert.equal(await reminderForm(page).count(), 0);
    // Enter in a new reminder saves it and focuses Add, not <body>.
    await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).fill('Synthetic new reminder');
    await page.keyboard.press('Enter');
    await status(page).getByText('Reminder saved', { exact: true }).waitFor();
    await focusIs(page, 'Add reminder', 'Enter-to-save on a new reminder focuses Add');
    assert.equal(stored('Synthetic new reminder').dueAt, null);
    checks.push('Discard (renamed from Cancel reminder) and Escape abandon only the form and return focus to the row’s Edit button or Add; Enter-to-save focuses Add; no settings Save bar');

    // Clear history: Keep, then Delete all, with focus on a real control throughout (#230).
    await page.getByRole('button', { name: /^History \(/ }).click();
    const completedCount = app.store.snapshot().reminders.filter(item => item.completed).length;
    await page.getByRole('button', { name: 'Clear history…', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.clear-history-confirm p').textContent(), `Delete ${completedCount} completed reminders? This can’t be undone.`);
    await focusIs(page, 'Keep', 'Clear history… focuses Keep');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.clear-history-confirm').count(), 0);
    await focusIs(page, 'Clear history…', 'Keep returns focus to Clear history…');
    assert.equal(app.store.snapshot().reminders.filter(item => item.completed).length, completedCount);
    await page.keyboard.press('Enter');
    await focusIs(page, 'Keep');
    await page.keyboard.press('Escape');
    await focusIs(page, 'Clear history…', 'Escape keeps history too');
    await page.getByRole('button', { name: 'Clear history…', exact: true }).click();
    await page.getByRole('button', { name: 'Delete all', exact: true }).click();
    await status(page).getByText(`History cleared (${completedCount})`, { exact: true }).waitFor();
    await focusIs(page, 'History (0)', 'after Delete all, focus is on the History switch');
    assert.equal(app.store.snapshot().reminders.filter(item => item.completed).length, 0);
    assert.ok(app.store.snapshot().reminders.length > 0, 'pending reminders stay');
    await page.getByText('No completed reminders yet', { exact: true }).waitFor();
    await page.getByText('Check off a reminder and it moves here.', { exact: true }).waitFor();
    checks.push('Clear history confirms inline: it focuses Keep; Keep or Escape changes nothing and refocuses Clear history…; Delete all clears only completed reminders and focuses the History switch');
    await context.close();

    // Undo after a single delete from Up next (#237): same text, exact due line and sorted place.
    await reset();
    ({ page, context } = await open());
    const order = await rowTitles(page), lines = await dueLines(page);
    const original = { ...stored('Water the plants') };
    await page.getByRole('button', { name: 'Delete: Water the plants', exact: true }).click();
    await status(page).getByText('Reminder deleted', { exact: true }).waitFor();
    assert.equal(stored('Water the plants'), undefined);
    await focusIs(page, 'Complete: Call a friend', 'focus moves to the next circle');
    await undoButton(page).focus();
    await page.keyboard.press('Enter');
    await status(page).getByText('Restored “Water the plants”', { exact: true }).waitFor();
    const recreated = stored('Water the plants');
    assert.deepEqual({ text: recreated.text, dueAt: recreated.dueAt, createdAt: recreated.createdAt, completed: recreated.completed }, { text: original.text, dueAt: original.dueAt, createdAt: original.createdAt, completed: false });
    assert.deepEqual(await rowTitles(page), order, 'back in its sorted place');
    assert.deepEqual(await dueLines(page), lines, 'with the same due line');
    await focusIs(page, 'Complete: Water the plants', 'focus moves to the restored circle');
    // An undated reminder returns between the same neighbours (undated sort newest first by creation).
    await page.getByRole('button', { name: 'Delete: Call a friend', exact: true }).click();
    await undoButton(page).click();
    await status(page).getByText('Restored “Call a friend”', { exact: true }).waitFor();
    assert.deepEqual(await rowTitles(page), order);
    // The offer lasts about eight seconds, like a check-off.
    await page.getByRole('button', { name: 'Delete: Book a check-up', exact: true }).click();
    await undoButton(page).waitFor();
    await page.clock.runFor(8100);
    await eventually(() => undoButton(page).count(), 0, 'delete Undo lasts about eight seconds');
    assert.equal(stored('Book a check-up'), undefined);
    checks.push('a single delete from Up next offers Undo for ~8 s; Undo re-creates it with its text, exact due string and createdAt, in its sorted place with the same due line, and focuses its circle');
    await context.close();

    // The Undo offer and an in-flight settle survive a tab switch (#143).
    await reset();
    ({ page, context } = await open());
    let releaseComplete;
    const completeHeld = new Promise(resolveHeld => { releaseComplete = resolveHeld; });
    await page.route('**/api/reminders/*', async route => {
      if (route.request().method() === 'PATCH') await completeHeld;
      await route.fallback();
    });
    await circle(page, 'Pay the bill').click();
    await closeReminders(page);
    const saved = patches(page, 1);
    releaseComplete();
    await saved;
    await remindersTab(page);
    await status(page).getByText('Completed “Pay the bill”', { exact: true }).waitFor();
    await page.unroute('**/api/reminders/*');
    await page.clock.runFor(1300);
    await eventually(() => rowTitles(page), ['Water the plants', 'Call a friend', 'Plan the weekend', 'Book a check-up'], 'the settle finished across the remount');
    await closeReminders(page);
    await page.clock.runFor(1000);
    await remindersTab(page);
    await undoButton(page).click();
    await status(page).getByText('Restored “Pay the bill”', { exact: true }).waitFor();
    await focusIs(page, 'Complete: Pay the bill');
    assert.equal(stored('Pay the bill').completed, false);
    await page.getByRole('button', { name: 'Delete: Plan the weekend', exact: true }).click();
    await closeReminders(page);
    await remindersTab(page);
    await undoButton(page).click();
    await status(page).getByText('Restored “Plan the weekend”', { exact: true }).waitFor();
    assert.equal(stored('Plan the weekend').completed, false);
    checks.push('a check-off saved while the dialog is closed still settles, and its Undo (and a delete Undo) still works after closing and reopening the dialog');
    await context.close();

    // Every time label follows the 24-hour setting (#129).
    await reset({ clockFormat: '24h' });
    ({ page, context } = await open());
    assert.deepEqual((await dueLines(page)).slice(0, 2), ['Overdue · Yesterday · 15:00', 'Today · 18:00']);
    await page.getByRole('button', { name: /^History \(/ }).click();
    assert.equal(await page.locator('.history-day').first().locator('.reminder-copy > span').first().textContent(), 'Completed 08:42 · was due Yesterday · 15:00');
    assert.match(await canvasReminders(page), /Overdue · Yesterday · 15:00/);
    await context.close();
    checks.push('due, completed and canvas labels follow the 24-hour setting');

    // The status line with Undo stays in view after checking off the first row (#228): five clean
    // and eight with a settings draft (independent editor draft open), at couch-editor, compact and phone sizes.
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 390, height: 844 }]) {
      for (const extra of [false, true]) {
        await reset({ extra });
        ({ page, context } = await open({ viewport }));
        if (extra) await dirty(page);
        const label = `${viewport.width}×${viewport.height} ${extra ? 'eight, Save bar' : 'five'}`;
        await circle(page, 'Pay the bill').click();
        await status(page).getByText('Completed “Pay the bill”', { exact: true }).waitFor();
        const where = await placement(undoButton(page));
        assertInView(where, `${label}: Undo in view`);
        if (where.mask !== 'n/a') assert.equal(where.mask, 'none', `${label}: the bottom fade is off while the status shows`);
        await page.clock.runFor(50);
        const clear = await page.evaluate(() => ({ label: document.activeElement.getAttribute('aria-label'), bottom: document.activeElement.getBoundingClientRect().bottom, toast: document.querySelector('.reminder-status').getBoundingClientRect().top }));
        assert.ok(clear.label === 'Complete: Water the plants' && clear.bottom <= clear.toast + 0.5, `${label}: the focused next circle stays clear of the status line ${JSON.stringify(clear)}`);
        if (capture && (viewport.width === 390 || viewport.height === 720)) images.push({ name: `undo-${label}`, bytes: await page.screenshot({ animations: 'disabled' }) });
        await page.clock.runFor(1300);
        await eventually(() => rowTitles(page).then(titles => titles.includes('Pay the bill')), false, `${label}: the row leaves`);
        assertInView(await placement(undoButton(page)), `${label}: Undo still in view after the row leaves`);
        await undoButton(page).click();
        await status(page).getByText('Restored “Pay the bill”', { exact: true }).waitFor();
        await context.close();
      }
    }
    checks.push('after checking off the first of five (clean) or eight (independent editor draft open) reminders, the status line and Undo are in view, unmasked and clickable at 1280×720, 1024×600 and 390×844 (the focused next circle stays clear of it), also after the row leaves');

    // Only a shown message sticks over the rows (review of #279): with no message, the empty status
    // line leaves every row reachable at the bottom edge, before any message and after an Undo expires.
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 390, height: 844 }]) {
      for (const draft of [false, true]) {
        const label = `${viewport.width}×${viewport.height}${draft ? ' concurrent editor draft' : ''}`;
        await reset({ extra: true });
        // The Home dialog is taller than the former inspector. Keep ample full-row
        // overflow even on a tall phone after deleting a row; the original bottom-edge hit test must run.
        await app.store.update(data => { data.reminders.push(...[9,14,15,16,17,18].map((index, position) => reminder(index, `Extra scroll row ${position+1}`))); });
        ({ page, context } = await open({ viewport }));
        if (draft) await dirty(page);
        assert.equal(await status(page).evaluate(element => element.classList.contains('has-message')), false);
        await assertRowsReachable(page, `${label}, no message yet`);
        const target = await editAtBottomEdge(page);
        assert.ok(target, `${label}: an Edit button reaches the bottom edge`);
        await page.mouse.click(target.x, target.y);
        await page.getByRole('heading', { name: 'Edit reminder', exact: true }).waitFor({ timeout: 2000 });
        await page.keyboard.press('Escape');
        await focusIs(page, target.label, `${label}: Escape returns to ${target.label}`);
        await page.getByRole('button', { name: 'Delete: Call a friend', exact: true }).click();
        await status(page).getByText('Reminder deleted', { exact: true }).waitFor();
        await page.clock.runFor(8200);
        await eventually(() => status(page).evaluate(element => element.classList.contains('has-message')), false, `${label}: the Undo offer expires`);
        await assertRowsReachable(page, `${label}, after the Undo expires`);
        if (capture && !draft) images.push({ name: `no-message-${label}`, bytes: await page.screenshot({ animations: 'disabled' }) });
        await context.close();
      }
    }
    checks.push('with no status message (before any, and after a delete Undo expires) the empty status line covers nothing: at 1280×720, 1024×600 and 390×844, clean and with an independent editor draft, every row control in the lower half of the visible list receives the click while it scrolls, and a mouse click on an Edit button 19 px above the bottom edge opens its form');

    // Forms stay in view (#236), the date message is the app's own (#258) and a delete Undo shows
    // in the same status area, at the owner's TV editor size and a phone.
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      const label = `${viewport.width}×${viewport.height}`;
      await reset({ extra: true });
      ({ page, context } = await open({ viewport }));
      assert.deepEqual(await rowTitles(page), EIGHT);
      await page.getByRole('button', { name: 'Edit: Plan the weekend', exact: true }).click();
      await page.clock.runFor(100);
      assert.equal(await page.getByRole('heading', { name: 'Edit reminder', exact: true }).count(), 1);
      assertInView(await placement(reminderForm(page)), `${label}: the in-place edit form is fully in view`);
      assert.deepEqual(await rowTitles(page), EIGHT.filter(text => text !== 'Plan the weekend'), 'its neighbours stay in order around it');
      assert.equal(await page.locator('.reminder-list > li').nth(6).locator('.reminder-form').count(), 1, 'the form is where the row was');
      if (capture) images.push({ name: `edit-in-place-${label}`, bytes: await page.screenshot({ animations: 'disabled' }) });
      await page.keyboard.press('Escape');
      await focusIs(page, 'Edit: Plan the weekend');
      await page.getByRole('button', { name: 'Delete: Book a check-up', exact: true }).scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
      await page.clock.runFor(100);
      assert.equal(await page.getByRole('heading', { name: 'New reminder', exact: true }).count(), 1);
      assertInView(await placement(reminderForm(page)), `${label}: “+” opens a visible form`);
      // A date without a time: the app's message, tied to the field, and nothing is created.
      const count = app.store.snapshot().reminders.length;
      await page.getByLabel('Reminder', { exact: true }).fill('Synthetic undated');
      const date = page.locator('.reminder-form input[type="datetime-local"]');
      // Step through the three date segments, whatever the locale's order, and leave the time empty.
      await date.focus();
      for (const key of ['ArrowUp', 'ArrowRight', 'ArrowUp', 'ArrowRight', 'ArrowUp']) await page.keyboard.press(key);
      assert.equal(await date.evaluate(element => element.validity.badInput), true, 'a date-only entry is incomplete');
      await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
      const problem = page.getByText('Enter both a date and a time, or clear the field.', { exact: true });
      await problem.waitFor();
      assert.equal(await date.getAttribute('aria-invalid'), 'true');
      assert.equal(await date.getAttribute('aria-describedby'), await problem.getAttribute('id'));
      assert.equal(await date.evaluate(element => document.activeElement === element), true, 'focus stays in the date field');
      assertInView(await placement(problem), `${label}: the date message is in view`);
      if (capture) images.push({ name: `date-problem-${label}`, bytes: await page.screenshot({ animations: 'disabled' }) });
      await page.keyboard.press('Enter');
      assert.equal(app.store.snapshot().reminders.length, count, 'nothing is created');
      await date.fill('');
      assert.equal(await date.evaluate(element => element.validity.badInput), false);
      await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
      await status(page).getByText('Reminder saved', { exact: true }).waitFor();
      assert.equal(stored('Synthetic undated').dueAt, null, 'cleared, Save creates an undated reminder');
      assert.equal(await problem.count(), 0);
      await page.getByRole('button', { name: 'Delete: Water the plants', exact: true }).click();
      await status(page).getByText('Reminder deleted', { exact: true }).waitFor();
      assertInView(await placement(undoButton(page)), `${label}: delete Undo in view`);
      await undoButton(page).click();
      await status(page).getByText('Restored “Water the plants”', { exact: true }).waitFor();
      assert.equal((await rowTitles(page))[1], 'Water the plants');
      await context.close();
    }
    checks.push('at 1280×720 and 390×844 with eight reminders: the in-place edit form and the “+” form are fully in view; a date-only entry shows “Enter both a date and a time, or clear the field.” (aria-invalid/aria-describedby, focus kept, nothing created) and clearing it saves an undated reminder; the delete Undo is in view');

    // The tab fits phone and desktop sizes; focus stays clear of the Save bar.
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 700 }, { width: 390, height: 480 }]) {
      await reset();
      ({ page, context } = await open({ viewport }));
      await dirty(page);
      for (const view of ['Up next', 'History']) {
        await page.getByRole('button', { name: new RegExp(`^${view} \\(`) }).click();
        const last = view === 'Up next' ? page.getByRole('button', { name: 'Delete: Book a check-up', exact: true }) : page.getByRole('button', { name: 'Clear history…', exact: true });
        const previous = view === 'Up next' ? page.getByRole('button', { name: 'Edit: Book a check-up', exact: true }) : page.getByRole('button', { name: 'Show 9 more', exact: true });
        await previous.focus();
        await page.keyboard.press('Tab');
        await page.clock.runFor(100);
        const layout = await page.evaluate(() => {
          const element = document.activeElement, active = element.getBoundingClientRect(), toolbar = document.querySelector('.home-sheet-header').getBoundingClientRect();
          const panel = document.querySelector('.home-sheet-body'), area = panel.getBoundingClientRect(), scrolls = getComputedStyle(panel).overflowY !== 'visible';
          const hit = document.elementFromPoint(active.left + active.width / 2, active.top + active.height / 2);
          return { label: element.getAttribute('aria-label') ?? element.textContent, bottom: active.bottom, top: active.top, visibleTop: Math.max(0, toolbar.bottom, scrolls ? area.top : 0), visibleBottom: Math.min(innerHeight, scrolls ? area.bottom : innerHeight), hit: hit === element || element.contains(hit), scroll: document.documentElement.scrollWidth, width: innerWidth };
        });
        assert.equal(layout.label, await last.evaluate(element => element.getAttribute('aria-label') ?? element.textContent));
        assert.ok(layout.bottom <= layout.visibleBottom + 0.5 && layout.top >= layout.visibleTop && layout.hit, `${viewport.width}×${viewport.height} ${view}: focus visible below the dialog header ${JSON.stringify(layout)}`);
        assert.ok(layout.scroll <= layout.width, `${viewport.width}×${viewport.height}: no horizontal page scroll`);
        if (capture) images.push({ name: `${view}-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
      }
      await context.close();
    }
    checks.push('the dialog fits 1280×720, 390×700 and 390×480 with keyboard focus visible below the dialog header, receiving clicks, and no horizontal scroll');

    // Reduced motion removes the collapse but keeps the settle delay.
    await reset();
    ({ page, context } = await open({ reducedMotion: 'reduce' }));
    await circle(page, 'Pay the bill').click();
    await status(page).getByText('Completed “Pay the bill”', { exact: true }).waitFor();
    await page.clock.runFor(600);
    assert.ok((await rowTitles(page)).includes('Pay the bill'), 'still settling');
    assert.equal(await page.locator('.editor-reminder-row.leaving').count(), 0);
    await page.clock.runFor(400);
    await eventually(() => rowTitles(page).then(titles => titles.includes('Pay the bill')), false, 'leaves after the settle without a collapse');
    await context.close();
    checks.push('reduced motion keeps the settle delay without the collapse');

    // Deleting a row while it settles is a delete from Up next (a completed reminder, so no Undo);
    // one completed reminder is singular.
    await reset();
    await app.store.update(data => { data.reminders = data.reminders.filter(item => !item.completed || item.text === 'Read a chapter'); });
    ({ page, context } = await open());
    await circle(page, 'Pay the bill').click();
    await status(page).getByText('Completed “Pay the bill”', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Delete: Pay the bill', exact: true }).click();
    await status(page).getByText('Reminder deleted', { exact: true }).waitFor();
    assert.equal(await undoButton(page).count(), 0, 'a checked-off row offers no delete Undo');
    assert.equal(stored('Pay the bill'), undefined);
    await page.clock.runFor(1300);
    await eventually(() => rowTitles(page).then(titles => titles.includes('Pay the bill')), false, 'gone');
    await page.getByRole('button', { name: 'History (1)', exact: true }).click();
    await page.getByRole('button', { name: 'Clear history…', exact: true }).click();
    assert.equal(await page.locator('.clear-history-confirm p').textContent(), 'Delete 1 completed reminder? This can’t be undone.');
    await page.getByRole('button', { name: 'Delete all', exact: true }).click();
    await status(page).getByText('History cleared (1)', { exact: true }).waitFor();
    await context.close();
    checks.push('a delete while settling reads “Reminder deleted” without Undo; one completed reminder reads “Delete 1 completed reminder?”');

    const hasMessage = page => status(page).evaluate(element => element.classList.contains('has-message'));
    const onTitleField = page => page.evaluate(() => document.activeElement === document.querySelector('.reminders-panel .reminder-form .reminder-text'));

    // #366: compact rows. Edit and Delete sit side by side, a one-line reminder with its due line is about
    // 60 px and at least five rows are fully visible at 1280×720; row and list controls keep 44 px targets
    // and the focus order stays circle, Edit, Delete.
    await reset({ extra: true });
    ({ page, context } = await open());
    const compact = await page.evaluate(() => {
      const area = document.querySelector('.home-sheet-body').getBoundingClientRect();
      const rows = [...document.querySelectorAll('.reminders-panel .reminder-list .editor-reminder')].map(row => {
        const box = row.getBoundingClientRect(), title = row.querySelector('.reminder-copy p');
        const [edit, remove] = [...row.querySelectorAll('.reminder-actions button')].map(button => button.getBoundingClientRect());
        return { text: title.textContent, height: Math.round(box.height * 10) / 10, oneLine: title.getBoundingClientRect().height < parseFloat(getComputedStyle(title).lineHeight) * 1.5, visible: box.top >= area.top - 0.5 && box.bottom <= area.bottom + 0.5, sideBySide: Math.abs(edit.top - remove.top) < 1 && remove.left >= edit.right - 0.5, targets: [edit.width, edit.height, remove.width, remove.height].map(size => Math.round(size * 1000) / 1000) };
      });
      return { rows, switches: [...document.querySelectorAll('.reminders-panel .reminder-view')].map(button => button.getBoundingClientRect().height) };
    });
    assert.equal(compact.rows.length, 8);
    for (const row of compact.rows) {
      assert.ok(row.sideBySide, `${row.text}: Edit and Delete side by side`);
      assert.ok(row.targets.every(size => size >= 44), `${row.text}: 44 px Edit and Delete (${row.targets})`);
      assert.ok(!row.oneLine || (row.height >= 44 && row.height <= 64), `${row.text}: a one-line row is about 60 px (${row.height})`);
    }
    assert.ok(compact.rows.filter(row => row.oneLine).length >= 5, 'the sample rows are one-line');
    assert.ok(compact.rows.filter(row => row.visible).length >= 5, `at least five rows fully visible at 1280×720 ${JSON.stringify(compact.rows.map(row => [row.height, row.visible]))}`);
    assert.ok(compact.switches.every(height => height >= 44), `Up next / History are at least 44 px tall (${compact.switches})`);
    if (capture) images.push({ name: 'compact-rows-1280', bytes: await page.screenshot({ animations: 'disabled' }) });
    await circle(page, 'Pay the bill').focus();
    for (const expected of ['Edit: Pay the bill', 'Delete: Pay the bill', 'Complete: Water the plants']) {
      await page.keyboard.press('Tab');
      assert.equal(await focused(page), expected, 'focus order: circle, Edit, Delete, next circle');
    }
    await circle(page, 'Pay the bill').click();
    const undoBox = await undoButton(page).boundingBox();
    assert.ok(undoBox.width >= 44 && undoBox.height >= 44, `Undo is at least 44 px (${JSON.stringify(undoBox)})`);
    await page.getByRole('button', { name: /^History \(/ }).click();
    const clearBox = await page.getByRole('button', { name: 'Clear history…', exact: true }).boundingBox();
    assert.ok(clearBox.width >= 44 && clearBox.height >= 44, `Clear history… is at least 44 px (${JSON.stringify(clearBox)})`);
    const historyTargets = await page.locator('.reminders-panel .history-reminder .reminder-actions button').evaluateAll(buttons => buttons.slice(0, 8).map(button => { const box = button.getBoundingClientRect(); return Math.min(box.width, box.height); }));
    assert.ok(historyTargets.length === 8 && historyTargets.every(size => size >= 44), `History row actions are 44 px (${historyTargets})`);
    await context.close();
    checks.push('compact rows (#366): at 1280×720 Edit and Delete sit side by side, one-line rows are about 60 px (44–64) and at least five are fully visible; Edit, Delete, Undo, Clear history…, History row actions and the Up next/History switch are at least 44 px; Tab goes circle, Edit, Delete, next circle');

    // #355: acting on a reminder another window already deleted. A check-off, a delete, a History restore
    // and an edit say so instead of a false or raw error, the row goes, and the edit keeps its text and
    // saves as a new reminder with the untouched due instant. A poll that removes the edited reminder
    // first shows the same offer before Save.
    await reset();
    ({ page, context } = await open());
    const deleteBehind = async index => assert.equal((await fetch(`${base}/api/reminders/${id(index)}`, { method: 'DELETE' })).status, 204);
    const deletedAlert = () => page.locator('.home-sheet-status.error, [role="alert"]').getByText('This reminder was deleted in another window.', { exact: true });
    await deleteBehind(1);
    await circle(page, 'Pay the bill').click();
    await deletedAlert().waitFor();
    await eventually(() => rowTitles(page).then(titles => titles.includes('Pay the bill')), false, 'a check-off of a deleted reminder removes its row');
    assert.equal(await page.getByText('Could not complete reminder. It is still in Up next.', { exact: true }).count(), 0, 'no false “still in Up next”');
    await deleteBehind(4);
    await page.getByRole('button', { name: 'Delete: Call a friend', exact: true }).click();
    await eventually(() => rowTitles(page).then(titles => titles.includes('Call a friend')), false, 'a delete of a deleted reminder removes its row');
    await deletedAlert().waitFor();
    assert.equal(await undoButton(page).count(), 0, 'nothing to undo');
    await page.getByRole('button', { name: 'Edit: Water the plants', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).fill('Water the plants and the herbs');
    await deleteBehind(2);
    await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
    await deletedAlert().waitFor();
    await eventually(() => rowTitles(page).then(titles => titles.includes('Water the plants')), false, 'the edited row goes');
    assert.equal(await page.getByText('Reminder not found', { exact: false }).count(), 0, 'never the raw server text');
    assert.equal(await page.getByLabel('Reminder', { exact: true }).inputValue(), 'Water the plants and the herbs', 'the typed edit is kept');
    await reminderForm(page).getByText('This reminder was deleted in another window.', { exact: true }).waitFor();
    await focusIs(page, '', 'the moved form keeps focus in its title field');
    assert.equal(await onTitleField(page), true);
    await page.getByRole('button', { name: 'Save as a new reminder', exact: true }).click();
    await status(page).getByText('Saved as a new reminder', { exact: true }).waitFor();
    const savedNew = stored('Water the plants and the herbs');
    assert.ok(savedNew && savedNew.id !== id(2) && savedNew.completed === false, 'saved as a new reminder');
    assert.equal(savedNew.dueAt, '2026-10-18T22:00:00.000Z', 'the untouched date keeps its exact instant');
    assert.equal(await reminderForm(page).count(), 0);
    await focusIs(page, 'Edit: Water the plants and the herbs', 'focus moves to the new row’s Edit button');
    await deleteBehind(11);
    await page.getByRole('button', { name: /^History \(/ }).click();
    await page.getByRole('button', { name: 'Restore: Take a walk', exact: true }).click();
    await deletedAlert().waitFor();
    await eventually(() => page.getByRole('button', { name: 'Restore: Take a walk', exact: true }).count(), 0, 'a History restore of a deleted reminder removes its row');
    await page.getByRole('button', { name: /^Up next \(/ }).click();
    await page.getByRole('button', { name: 'Edit: Plan the weekend', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).fill('Plan the long weekend away');
    await deleteBehind(3);
    await page.clock.runFor(30_500);
    await reminderForm(page).getByText('This reminder was deleted in another window.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save as a new reminder', exact: true }).count(), 1, 'offered before Save once a poll removed it');
    assert.equal(await page.getByLabel('Reminder', { exact: true }).inputValue(), 'Plan the long weekend away');
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await focusIs(page, 'Add reminder', 'Discard on a deleted reminder’s form focuses Add');
    await context.close();
    checks.push('a reminder deleted in another window (#355): check-off, delete and History restore say “This reminder was deleted in another window.” and drop the row (no false “still in Up next”, no Undo); an edit keeps its text, never shows “Reminder not found”, and “Save as a new reminder” POSTs it with the exact due instant; after a poll removes it the form offers the same before Save');

    // #274 and #295: an open form keeps its typed text and date across tab switches, in place for an edit,
    // with a working Save, without taking focus from the tab; + keeps a form with unsaved typing; leaving
    // the page with typed text asks first. Plain messages expire after about 8 s and stay gone.
    await reset();
    ({ page, context } = await open());
    const leaving = () => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
    const dueInput = () => page.locator('.reminder-form input[type="datetime-local"]');
    assert.equal(await leaving(), false, 'nothing typed: no leave prompt');
    await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
    assert.equal(await leaving(), false, 'an empty new form: no leave prompt');
    await page.getByLabel('Reminder', { exact: true }).fill('Half typed');
    await dueInput().fill('2026-10-20T09:30');
    assert.equal(await leaving(), true, 'typed text: the leave prompt');
    await closeReminders(page);
    await page.clock.runFor(300);
    assert.equal(await leaving(), true, 'still asks with the dialog closed');
    await remindersTab(page);
    await page.getByRole('heading', { name: 'New reminder', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Reminder', { exact: true }).inputValue(), 'Half typed', 'the text survives the switch');
    assert.equal(await dueInput().inputValue(), '2026-10-20T09:30', 'the date survives the switch');
    assert.equal(await page.getByRole('dialog', { name: 'All reminders', exact: true }).evaluate(dialog => dialog.contains(document.activeElement)), true, 'reopening puts focus inside the reminder dialog');
    await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
    await status(page).getByText('Reminder saved', { exact: true }).waitFor();
    assert.equal(stored('Half typed').dueAt, '2026-10-20T13:30:00.000Z', 'Save works after reopening');
    assert.equal(await leaving(), false, 'saved: no leave prompt');
    await page.clock.runFor(8200);
    await eventually(() => hasMessage(page), false, 'a plain message expires after about 8 s');
    await closeReminders(page);
    await remindersTab(page);
    assert.equal(await hasMessage(page), false, 'and does not come back after reopening the dialog');
    await page.getByRole('button', { name: 'Edit: Call a friend', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).fill('Call a friend back');
    await closeReminders(page);
    await remindersTab(page);
    assert.equal(await page.locator('.editor-reminder-row.editing .reminder-form').count(), 1, 'the edit form is back in place');
    assert.equal(await page.getByLabel('Reminder', { exact: true }).inputValue(), 'Call a friend back');
    assert.equal(await circle(page, 'Call a friend').count(), 0, 'the edited row still has no circle (#187)');
    await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
    await page.getByText('Save or discard this reminder first.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Edit reminder', exact: true }).count(), 1, '+ keeps a form with unsaved typing');
    assert.equal(await page.getByLabel('Reminder', { exact: true }).inputValue(), 'Call a friend back');
    await page.clock.runFor(50);
    assert.equal(await onTitleField(page), true, 'and focuses its title field');
    await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
    await status(page).getByText('Reminder saved', { exact: true }).waitFor();
    assert.equal(stored('Call a friend back').completed, false);
    await focusIs(page, 'Edit: Call a friend back', 'Save after reopening returns focus to the row (#230)');
    await page.getByRole('button', { name: 'Edit: Plan the weekend', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).fill('Changed then escaped');
    await closeReminders(page);
    await remindersTab(page);
    await page.getByLabel('Reminder', { exact: true }).focus();
    await page.keyboard.press('Escape');
    await focusIs(page, 'Edit: Plan the weekend', 'Escape after reopening closes only the form and focuses the row');
    assert.equal(stored('Plan the weekend').text, 'Plan the weekend');
    assert.equal(await leaving(), false, 'discarded: no leave prompt');
    // A message that expires while the dialog is closed is gone on return.
    await page.getByRole('button', { name: /^History \(/ }).click();
    await page.getByRole('button', { name: 'Restore: Read a chapter', exact: true }).click();
    await status(page).getByText('Restored “Read a chapter”', { exact: true }).waitFor();
    await closeReminders(page);
    await page.clock.runFor(9000);
    await remindersTab(page);
    assert.equal(await hasMessage(page), false, 'a plain message that expired elsewhere stays gone');
    // The real browser prompt: closing the page with typed text asks; dismissing it keeps the page.
    await page.getByRole('button', { name: /^Up next \(/ }).click();
    await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).fill('Do not lose me');
    const prompt = new Promise(resolvePrompt => page.once('dialog', async dialog => { const type = dialog.type(); await dialog.dismiss(); resolvePrompt(type); }));
    await page.close({ runBeforeUnload: true });
    assert.equal(await prompt, 'beforeunload', 'the browser asks before leaving');
    assert.equal(page.isClosed(), false, 'dismissing the prompt keeps the page');
    await context.close();
    checks.push('open forms survive closing and reopening the dialog (#274): a new form keeps its text and date and saves; an edit comes back in place (still no circle) and saves with focus back on its Edit; returning leaves focus on the tab; + keeps a form with unsaved typing (“Save or discard this reminder first.”); Escape still closes only the form; typed text fires the browser’s leave prompt (also from another tab), saved or discarded forms do not; plain messages expire after ~8 s and stay gone after reopening the dialog, also when they expire while the dialog is closed (#295)');

    // #296: Undo after deleting a reminder whose stored creation time is later than the clock. Five minutes
    // ahead it is left out; just ahead of the server only, the server refuses it and Undo retries without
    // it. Either way the reminder returns, stamped with the server's time, and no schema text shows.
    await reset();
    await app.store.update(data => {
      data.reminders.find(item => item.id === id(3)).createdAt = new Date(now + 5 * 60_000).toISOString();
      data.reminders.find(item => item.id === id(4)).createdAt = new Date(now + 500).toISOString();
    });
    ({ page, context } = await open());
    for (const [text, label] of [['Plan the weekend', 'five minutes ahead'], ['Call a friend', 'ahead of the server only']]) {
      await page.getByRole('button', { name: `Delete: ${text}`, exact: true }).click();
      await status(page).getByText('Reminder deleted', { exact: true }).waitFor();
      await undoButton(page).click();
      await status(page).getByText(`Restored “${text}”`, { exact: true }).waitFor();
      const back = stored(text);
      assert.ok(back && back.completed === false, `${label}: Undo re-creates it`);
      assert.equal(back.createdAt, new Date(now).toISOString(), `${label}: stamped with the server's own time`);
      assert.equal(await page.getByText(/createdAt|creation time/).count(), 0, `${label}: no schema text`);
    }
    await context.close();
    checks.push('delete Undo with a stored creation time later than the clock (#296): five minutes ahead it is left out, just ahead of the server it is retried without; the reminder returns stamped with the server time and no schema text shows');

    // #297: a focused Undo that expires moves focus to the Up next switch, never <body>; an Undo that
    // replaces it keeps focus on the button.
    await reset();
    ({ page, context } = await open());
    await circle(page, 'Pay the bill').click();
    await undoButton(page).focus();
    await page.clock.runFor(8200);
    await eventually(() => undoButton(page).count(), 0, 'the check-off Undo expires');
    await focusIs(page, 'Up next (4)', 'focus moves from an expired check-off Undo to the Up next switch');
    // #521: hold the delete's queued next-row focus until after the user has focused its Undo.
    // This order must preserve the newer focus choice, not move it back to a reminder row.
    await page.getByRole('button', { name: 'Delete: Book a check-up', exact: true }).focus();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.keyboard.press('Enter');
    await status(page).getByText('Reminder deleted', { exact: true }).waitFor();
    await undoButton(page).focus();
    assert.equal(await focused(page), 'Undo', 'the delete Undo starts focused');
    await focusIs(page, 'Undo', 'a pending delete focus callback respects the newly focused Undo');
    await page.clock.runFor(8150);
    await eventually(() => undoButton(page).count(), 0, 'the delete Undo expires');
    await focusIs(page, 'Up next (3)', 'focus moves from an expired delete Undo to the Up next switch');
    await circle(page, 'Call a friend').click();
    await status(page).getByText('Completed “Call a friend”', { exact: true }).waitFor();
    let releaseReplacement;
    const replacementHeld = new Promise(resolveHeld => { releaseReplacement = resolveHeld; });
    await page.route('**/api/reminders/*', async route => { if (route.request().method() === 'PATCH') await replacementHeld; await route.fallback(); });
    await circle(page, 'Water the plants').click();
    await page.clock.runFor(50);
    await undoButton(page).focus();
    releaseReplacement();
    await status(page).getByText('Completed “Water the plants”', { exact: true }).waitFor();
    await focusIs(page, 'Undo', 'a replacing Undo keeps focus');
    await page.unroute('**/api/reminders/*');
    await context.close();
    checks.push('a keyboard-focused Undo that expires (check-off or delete) moves focus to the Up next switch, never <body>; a replacing Undo keeps focus (#297)');

    // #354: typing stays cheap with 500 dated reminders: no Intl formatter is built per keystroke, and React
    // spends little time per keystroke because the list does not re-render (measured on the real clock).
    await app.store.update(data => {
      data.settings = { ...defaultSettings() };
      data.reminders = Array.from({ length: 500 }, (_, index) => reminder(2000 + index, `Synthetic dated ${index + 1}`, { dueAt: new Date(now + (index - 100) * 3_600_000).toISOString(), createdAt: new Date(now - (index + 1) * 1000).toISOString() }));
    });
    const countIntl = () => {
      window.__intl = 0;
      const Original = Intl.DateTimeFormat;
      const Counted = function (...values) { window.__intl++; return new Original(...values); };
      Counted.prototype = Original.prototype; Counted.supportedLocalesOf = Original.supportedLocalesOf.bind(Original);
      Intl.DateTimeFormat = Counted;
    };
    ({ page, context } = await open({ init: countIntl }));
    assert.equal(await page.locator('.reminders-panel .reminder-list .complete-button').count(), 500);
    await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).focus();
    const intlBefore = await page.evaluate(() => window.__intl);
    await page.keyboard.type('Synthetic typing check');
    const intlTyped = await page.evaluate(() => window.__intl) - intlBefore;
    assert.equal(await page.getByLabel('Reminder', { exact: true }).inputValue(), 'Synthetic typing check');
    assert.equal(intlTyped, 0, `no Intl formatter per keystroke with 500 dated reminders (${intlTyped} for 22 keystrokes)`);
    await context.close();
    ({ page, context } = await open({ clock: false }));
    await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).focus();
    await page.evaluate(() => {
      window.__typing = [];
      document.addEventListener('input', () => { const start = performance.now(); setTimeout(() => window.__typing.push(performance.now() - start), 0); }, true);
    });
    await page.keyboard.type('Synthetic typing cost', { delay: 25 });
    await delay(200);
    const typing = (await page.evaluate(() => window.__typing)).sort((a, b) => a - b);
    const median = typing[Math.floor(typing.length / 2)];
    assert.ok(typing.length >= 20 && median < 30, `a keystroke costs little with 500 dated reminders: median ${median?.toFixed(1)} ms ${JSON.stringify(typing.map(value => Math.round(value)))}`);
    await context.close();
    checks.push(`typing with 500 dated reminders (#354): no Intl formatter is built per keystroke (0 for 22), and a keystroke's update takes a median ${median.toFixed(1)} ms (bound 30 ms; main before #354 took about 110–140 ms) because the list does not re-render`);

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
