import assert from 'node:assert/strict';

// Synthetic reminders only. The list measures its actual box, so these checks measure too:
// complete visible rows inside the body, overflow rows taking no layout and an exact "+N more".
export const id = 'reminders';
export const selectors = ['.ambient-reminder-list > li:not(.reminder-overflow)', '.reminder-more', '.reminder-offline'];

const TITLES = ['Read a chapter', 'Water the plants', 'Plan the weekend', 'Call a friend', 'A later reminder'];
const LONG = 'A deliberately long synthetic reminder title that keeps going well past two lines of the available width without a single natural stopping point so it has to clamp';

function reminders(count, now, { long = false, overdue = false } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    text: long && index === 0 ? LONG : `${TITLES[index % TITLES.length]}${index >= TITLES.length ? ` ${index + 1}` : ''}`,
    completed: false,
    // A mix of dated and undated rows exercises both row heights.
    dueAt: overdue && index === 0 ? new Date(now - 26 * 3_600_000).toISOString() : long && index === 0 ? new Date(now + 1_800_000).toISOString() : index % 3 === 1 ? new Date(now + (index + 2) * 3_600_000).toISOString() : null,
    createdAt: new Date(now - index * 60_000).toISOString(),
    updatedAt: new Date(now - index * 60_000).toISOString(),
  }));
}

export function prepare(state, { now }) {
  state.reminders = reminders(5, now);
  // History is in the same array and must never reach the display.
  state.reminders.push({ ...state.reminders[0], id: '00000000-0000-4000-8000-999999999999', text: 'Completed synthetic', completed: true });
}

async function reopen(page) {
  await page.reload();
  await page.locator('.display-page').waitFor();
  await page.clock.runFor(100);
}

async function inspect(widget) {
  return widget.evaluate(element => {
    const body = element.querySelector('.reminders-body');
    const box = body.getBoundingClientRect();
    const rows = [...element.querySelectorAll('.ambient-reminder-list > li')];
    const visible = rows.filter(row => !row.classList.contains('reminder-overflow'));
    const inside = node => { const rect = node.getBoundingClientRect(); return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 && rect.left >= box.left - 1 && rect.right <= box.right + 1; };
    const more = element.querySelector('.reminder-more');
    const offline = element.querySelector('.reminder-offline');
    const content = element.querySelector('.widget-content');
    return {
      total: rows.length,
      visible: visible.length,
      visibleText: visible.map(row => row.querySelector('.ambient-reminder-title').textContent),
      outside: visible.filter(row => !inside(row)).length,
      overflowRendered: rows.filter(row => row.classList.contains('reminder-overflow') && (getComputedStyle(row).display !== 'none' || row.getBoundingClientRect().height > 0)).length,
      more: more ? more.textContent : null,
      moreInside: more ? inside(more) : true,
      offline: offline ? offline.textContent : null,
      offlineInside: offline ? inside(offline) : true,
      titles: visible.map(row => {
        const title = row.querySelector('.ambient-reminder-title');
        const style = getComputedStyle(title);
        return { text: title.textContent, lines: Math.round(title.offsetHeight / (parseFloat(style.fontSize) * 1.2)), clamp: style.webkitLineClamp, horizontal: title.scrollWidth > title.clientWidth + 1, size: parseFloat(style.fontSize) };
      }),
      scale: new DOMMatrix(getComputedStyle(content).transform).a,
      overfull: body.classList.contains('reminders-overfull'),
      displayHeight: element.closest('.ambient').getBoundingClientRect().height,
    };
  });
}

function assertMeasured(result, expectedTotal, label) {
  assert.ok(result.visible >= 1, `${label}: at least one row`);
  assert.equal(result.outside, 0, `${label}: every visible row is complete inside the box ${JSON.stringify(result)}`);
  assert.equal(result.overflowRendered, 0, `${label}: overflow rows take no layout`);
  const hidden = expectedTotal - result.visible;
  assert.equal(result.more, hidden > 0 ? `+${hidden} more` : null, `${label}: honest remaining count`);
  assert.ok(result.moreInside && result.offlineInside, `${label}: footer stays inside the box`);
  for (const title of result.titles) {
    assert.equal(title.horizontal, false, `${label}: titles never overflow sideways`);
    assert.ok(title.lines <= Number(title.clamp), `${label}: titles clamp at ${title.clamp} lines (${title.lines})`);
  }
}

export async function family({ page, widget, size, density, viewport, state }) {
  const now = await page.evaluate(() => Date.now());
  const original = { reminders: state.reminders, fontScale: state.settings.appearance.fontScale };
  const fourK = viewport.width > 2000;
  const counts = { };
  try {
    // Every family × density × 1080p/4K; Text size 0.7/1/1.5 × 1/5/30 pending (4K samples Text size 1).
    for (const fontScale of fourK ? [1] : [0.7, 1, 1.5]) for (const count of [1, 5, 30]) {
      state.settings.appearance.fontScale = fontScale; state.reminders = reminders(count, now);
      await reopen(page);
      const label = `${size}/${density}/${viewport.width}p text ${fontScale} × ${count}`;
      const result = await inspect(widget);
      assertMeasured(result, count, label);
      assert.ok(result.scale >= 0.65, `${label}: fit scale ${result.scale}`);
      if (fontScale <= 1) assert.equal(result.scale, 1, `${label}: normal titles fit without zooming out`);
      if (count > 1) assert.equal(result.titles[0].clamp, '2');
      // Titles are capped near 3.2% of the display height, so a tall box never inflates them.
      for (const title of result.titles) assert.ok(title.size <= result.displayHeight * 0.032 * fontScale + 0.5, `${label}: title ${title.size}px within the display cap`);
      counts[`${fontScale}/${count}`] = result.visible;
    }
    assert.ok(counts['1/30'] >= counts['1.5/30'] || fourK, `${size}/${density}: larger text never shows more rows`);

    // Long titles clamp; a single pending reminder may use four lines.
    state.settings.appearance.fontScale = 1;
    state.reminders = reminders(5, now, { long: true });
    await reopen(page);
    let result = await inspect(widget);
    assertMeasured(result, 5, `${size}/${density} long title`);
    assert.equal(result.titles[0].text, LONG, 'the soonest reminder leads');
    assert.equal(result.titles[0].lines, 2, `${size}/${density}: the long title clamps to two lines`);
    assert.equal(result.scale, 1, `${size}/${density}: a long title keeps the full scale`);
    state.reminders = reminders(1, now, { long: true });
    await reopen(page);
    result = await inspect(widget);
    assertMeasured(result, 1, `${size}/${density} single long title`);
    assert.equal(result.titles[0].clamp, '4');
    assert.ok(result.titles[0].lines > 2 && result.titles[0].lines <= 4, `${size}/${density}: the only reminder uses up to four lines (${result.titles[0].lines})`);
    assert.ok(result.scale >= 0.65, `${size}/${density}: single long title scale ${result.scale}`);

    if (!fourK && density === 'balanced' && size === 'medium') await states({ page, widget, state, now });
  } finally {
    state.reminders = original.reminders; state.settings.appearance.fontScale = original.fontScale;
  }
}

async function states({ page, widget, state, now }) {
  const display = page.locator('[data-widget-id="reminders"]');
  // Measurement is stable: the per-second refit and clock ticks never toggle rows or the body.
  state.reminders = reminders(30, now);
  await reopen(page);
  await widget.evaluate(element => {
    window.__reminderMutations = 0;
    new MutationObserver(records => { window.__reminderMutations += records.length; })
      .observe(element.querySelector('.reminders-body'), { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'data-measuring', 'style'] });
  });
  await page.clock.runFor(5000);
  assert.equal(await page.evaluate(() => window.__reminderMutations), 0, 'no measurement loop between the observer, the list and the widget fit');
  // Overdue is carried by the word, tinted with the caution token.
  state.reminders = reminders(3, now, { overdue: true });
  await reopen(page);
  const overdue = widget.locator('.ambient-reminder-overdue').first();
  assert.equal(await overdue.textContent(), 'Overdue');
  assert.match(await widget.locator('.ambient-reminder-date').first().textContent(), /^Overdue · Yesterday · \d{1,2}:\d{2} [AP]M$/);
  assert.equal(await overdue.evaluate(element => getComputedStyle(element).color), 'rgb(176, 146, 107)');
  state.settings.clockFormat = '24h';
  await reopen(page);
  assert.match(await widget.locator('.ambient-reminder-date').first().textContent(), /^Overdue · Yesterday · \d{2}:\d{2}$/);
  state.settings.clockFormat = '12h';

  // Completed reminders never appear.
  state.reminders = reminders(2, now).map((reminder, index) => ({ ...reminder, completed: index === 0 }));
  await reopen(page);
  assert.deepEqual((await inspect(widget)).visibleText, [state.reminders[1].text]);

  // Offline with saved pending reminders keeps the list and says so.
  state.reminders = reminders(30, now);
  await reopen(page);
  await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic outage' }) }));
  await page.clock.runFor(30_500);
  await widget.locator('.reminder-offline').waitFor();
  const offline = await inspect(widget);
  assert.equal(offline.offline, 'Saved reminders · offline');
  assertMeasured(offline, 30, 'offline');
  // Disconnected with nothing cached is unavailable, never an empty list.
  await page.unroute('**/api/state');
  state.reminders = [];
  await reopen(page);
  assert.equal(await display.count(), 0, 'confirmed empty hides by default');
  await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic outage' }) }));
  await page.clock.runFor(30_500);
  await display.getByText('Reminders unavailable', { exact: true }).waitFor();
  await page.unroute('**/api/state');

  // A missing reminders array is unavailable.
  delete state.reminders;
  await reopen(page);
  assert.equal(await display.getByText('Reminders unavailable', { exact: true }).count(), 1);
  assert.equal(await display.locator('li').count(), 0);

  // Empty: hidden while Hide when empty is on, otherwise a quiet "All clear".
  state.reminders = reminders(1, now).map(reminder => ({ ...reminder, completed: true }));
  await reopen(page);
  assert.equal(await display.count(), 0, 'history alone hides the widget');
  state.settings.widgetBehavior.reminders.hideWhenEmpty = false;
  await reopen(page);
  assert.match(await display.innerText(), /Up next\s+All clear/);
  state.settings.widgetBehavior.reminders.hideWhenEmpty = true;
}
