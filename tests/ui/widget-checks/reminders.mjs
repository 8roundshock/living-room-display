import assert from 'node:assert/strict';

// Synthetic reminders only. The list measures its actual box, so these checks measure too:
// complete visible rows inside the body, overflow rows taking no layout and an exact "+N more".
export const id = 'reminders';
export const selectors = ['.ambient-reminder-list > li:not(.reminder-overflow)', '.reminder-more', '.reminder-offline'];

const TITLES = ['Read a chapter', 'Water the plants', 'Plan the weekend', 'Call a friend', 'A later reminder'];
const LONG = 'A deliberately long synthetic reminder title that keeps going well past two lines of the available width without a single natural stopping point so it has to clamp';
/** The shared status tone (`--ambient-caution`). */
const CAUTION = 'rgb(176, 146, 107)';

function reminders(count, now, { long = false, allLong = false, overdue = false } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    text: (long && index === 0) || allLong ? LONG : `${TITLES[index % TITLES.length]}${index >= TITLES.length ? ` ${index + 1}` : ''}`,
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

// ResizeObserver callbacks run on a real rendering frame, not on the page's fake clock.
async function resize(page, viewport) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(80);
  await page.clock.runFor(50);
  await page.waitForTimeout(20);
}

async function inspect(widget) {
  return widget.evaluate(element => {
    const body = element.querySelector('.reminders-body');
    // The body grows while overfull (it is then zoomed out as a whole), so rows must also stay
    // inside the widget's own section box, which never grows.
    const box = body.getBoundingClientRect(), section = element.getBoundingClientRect();
    const rows = [...element.querySelectorAll('.ambient-reminder-list > li')];
    const visible = rows.filter(row => !row.classList.contains('reminder-overflow'));
    const within = (rect, outer) => rect.top >= outer.top - 1 && rect.bottom <= outer.bottom + 1 && rect.left >= outer.left - 1 && rect.right <= outer.right + 1;
    const inside = node => { const rect = node.getBoundingClientRect(); return within(rect, box) && within(rect, section); };
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
        return { text: title.textContent, lines: Math.round(title.offsetHeight / (parseFloat(style.fontSize) * 1.2)), clamp: style.webkitLineClamp, cut: (() => { const clamped = title.offsetHeight; title.style.webkitLineClamp = 'none'; const full = title.offsetHeight; title.style.webkitLineClamp = ''; return full > clamped + 1; })(), horizontal: title.scrollWidth > title.clientWidth + 1, size: parseFloat(style.fontSize) };
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
  // Titles clamp at 2 lines (4 for a single reminder); only when every pending reminder is shown may
  // clamped titles relax to 3–4 lines (#254).
  const base = expectedTotal === 1 ? 4 : 2;
  for (const title of result.titles) {
    assert.equal(title.horizontal, false, `${label}: titles never overflow sideways`);
    assert.ok(title.lines <= Number(title.clamp), `${label}: titles clamp at ${title.clamp} lines (${title.lines})`);
    if (hidden > 0 || result.overfull) assert.equal(Number(title.clamp), base, `${label}: the ${base}-line clamp holds while reminders are hidden`);
    else assert.ok(Number(title.clamp) >= base && Number(title.clamp) <= 4, `${label}: a relaxed clamp stays within ${base}–4 lines (${title.clamp})`);
  }
}

export async function family({ page, widget, size, density, viewport, state }) {
  const now = await page.evaluate(() => Date.now());
  const original = { reminders: state.reminders, fontScale: state.settings.appearance.fontScale, fontFamily: state.settings.appearance.fontFamily };
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
      // Titles are capped near 3.2% of the display height, so a tall box (or #254 growth) never inflates them.
      for (const title of result.titles) assert.ok(title.size <= result.displayHeight * 0.032 * fontScale + 0.5, `${label}: title ${title.size}px within the display cap`);
      counts[`${fontScale}/${count}`] = result.visible;
    }
    assert.ok(counts['1/30'] >= counts['1.5/30'] || fourK, `${size}/${density}: larger text never shows more rows`);

    // Long titles clamp at two lines while any reminder is hidden; when all five show, the long title
    // may use up to four lines (#254). A single pending reminder may always use four lines.
    state.settings.appearance.fontScale = 1;
    state.reminders = reminders(5, now, { long: true });
    await reopen(page);
    let result = await inspect(widget);
    assertMeasured(result, 5, `${size}/${density} long title`);
    assert.equal(result.titles[0].text, LONG, 'the soonest reminder leads');
    assert.equal(result.titles[0].lines, Number(result.titles[0].clamp), `${size}/${density}: the long title fills its ${result.titles[0].clamp}-line clamp`);
    if (result.more !== null) assert.equal(result.titles[0].lines, 2, `${size}/${density}: the long title clamps to two lines while reminders are hidden`);
    assert.equal(result.scale, 1, `${size}/${density}: a long title keeps the full scale`);
    // Every font family: Mono is the widest, so it wraps (and may zoom out) first.
    for (const fontFamily of ['sans', 'serif', 'mono']) {
      state.settings.appearance.fontFamily = fontFamily;
      state.reminders = reminders(1, now, { long: true });
      await reopen(page);
      result = await inspect(widget);
      const label = `${size}/${density} ${fontFamily} single long title`;
      assertMeasured(result, 1, label);
      assert.equal(result.titles[0].clamp, '4');
      assert.ok(result.titles[0].lines > 2 && result.titles[0].lines <= 4, `${label}: the only reminder uses up to four lines (${result.titles[0].lines})`);
      assert.ok(result.scale >= 0.65, `${label}: scale ${result.scale}`);
    }
    state.settings.appearance.fontFamily = original.fontFamily;

    if (!fourK) await remeasures({ page, widget, size, density, viewport, state, now });
    if (!fourK && density === 'balanced' && size === 'medium') {
      await transformedRows({ page, widget, viewport, state, now });
      await states({ page, widget, state, now });
      await editorPlaceholder({ page, state });
    }
  } finally {
    state.reminders = original.reminders; state.settings.appearance.fontScale = original.fontScale; state.settings.appearance.fontFamily = original.fontFamily;
  }
}

/**
 * Any resize remeasures the list. Larger text and long titles push some families into the overfull
 * state (one row, whole-widget zoom-out); a remeasure there must not count rows against the grown
 * body. After a 1px resize and back, every visible row stays inside the widget, "+N more" stays
 * exact and the state at the original size is unchanged, title clamp and size included.
 */
async function remeasures({ page, widget, size, density, viewport, state, now }) {
  let overfull = 0;
  try {
    for (const fontFamily of ['sans', 'serif', 'mono']) for (const fontScale of [1.25, 1.5]) for (const count of [1, 3]) {
      state.settings.appearance.fontFamily = fontFamily; state.settings.appearance.fontScale = fontScale;
      state.reminders = reminders(count, now, { allLong: true });
      await reopen(page);
      const label = `${size}/${density} ${fontFamily} text ${fontScale} × ${count} long`;
      const first = await inspect(widget);
      assertMeasured(first, count, label);
      if (first.overfull) overfull++;
      await resize(page, { width: viewport.width + 1, height: viewport.height });
      assertMeasured(await inspect(widget), count, `${label} after a 1px resize`);
      await resize(page, viewport);
      const back = await inspect(widget);
      assertMeasured(back, count, `${label} after resizing back`);
      const facts = result => ({ overfull: result.overfull, visible: result.visible, more: result.more, titles: result.titles.map(title => [title.clamp, title.size]) });
      assert.deepEqual(facts(back), facts(first), `${label}: a remeasure at the same size keeps the state`);
    }
    // Keeps the overfull path covered; if a density decision (#144) removes it here, choose another overfull case.
    if (size === 'small' && density === 'fine') assert.ok(overfull > 0, `${size}/${density}: the remeasure cases include an overfull widget`);
  } finally {
    await page.setViewportSize(viewport);
  }
}

/**
 * #216: rows are measured from layout boxes, so a transform on the rows (an entrance or transition
 * caught mid-flight) cannot change the count. Each transform below would have moved or resized the
 * rows' rectangles by a whole row; a remeasure while it applies must keep the count at rest.
 */
async function transformedRows({ page, widget, viewport, state, now }) {
  state.settings.appearance.fontScale = 1; state.reminders = reminders(30, now);
  await reopen(page);
  const rest = await inspect(widget);
  assertMeasured(rest, 30, 'transformed rows at rest');
  const shown = () => widget.evaluate(element => ({ visible: element.querySelectorAll('.ambient-reminder-list > li:not(.reminder-overflow)').length, more: element.querySelector('.reminder-more')?.textContent ?? null, measures: window.__reminderMeasures }));
  for (const transform of ['translate: 0 -100%', 'translate: 0 100%', 'scale: 1 1.6', 'transform: translateY(-150%)']) {
    const style = await page.addStyleTag({ content: `.grid-ambient .ambient-reminder-list > li { ${transform} !important; }` });
    await widget.evaluate(element => {
      window.__reminderMeasures = 0;
      window.__reminderObserver?.disconnect();
      // A record with no old value is a measuring pass starting.
      window.__reminderObserver = new MutationObserver(records => { window.__reminderMeasures += records.filter(record => record.oldValue === null).length; });
      window.__reminderObserver.observe(element.querySelector('.reminders-body'), { attributes: true, attributeOldValue: true, attributeFilter: ['data-measuring'] });
    });
    await resize(page, { width: viewport.width + 1, height: viewport.height });
    await resize(page, viewport);
    const moved = await shown();
    assert.ok(moved.measures >= 1, `${transform}: the list remeasured while the rows were transformed`);
    assert.deepEqual({ visible: moved.visible, more: moved.more }, { visible: rest.visible, more: rest.more }, `${transform}: the count matches the rows at rest`);
    await style.evaluate(node => node.remove());
  }
  assertMeasured(await inspect(widget), 30, 'transformed rows back at rest');
}

/** The offline line uses the shared status tone at full opacity in both accent modes (#223). */
async function offlineStatus({ page, widget, state, now, mode }) {
  const accentMode = state.settings.appearance.accentMode;
  state.settings.appearance.accentMode = mode; state.reminders = reminders(30, now);
  await reopen(page);
  await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic outage' }) }));
  try {
    await page.clock.runFor(30_500);
    await widget.locator('.reminder-offline').waitFor();
    const offline = await inspect(widget);
    assert.equal(offline.offline, 'Saved reminders · offline');
    assertMeasured(offline, 30, `offline ${mode}`);
    const colours = await widget.evaluate(element => {
      const style = node => ({ color: getComputedStyle(node).color, opacity: getComputedStyle(node).opacity });
      return { offline: style(element.querySelector('.reminder-offline')), more: style(element.querySelector('.reminder-more')), date: style(element.querySelector('.ambient-reminder-date')) };
    });
    assert.deepEqual(colours.offline, { color: CAUTION, opacity: '1' }, `${mode}: "Saved reminders · offline" uses the status tone at full opacity`);
    assert.notEqual(colours.more.color, CAUTION, `${mode}: "+N more" keeps the accent`);
    assert.notEqual(colours.date.color, CAUTION, `${mode}: dates keep the accent`);
  } finally {
    await page.unroute('**/api/state');
    state.settings.appearance.accentMode = accentMode;
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
  assert.equal(await overdue.evaluate(element => getComputedStyle(element).color), CAUTION);
  state.settings.clockFormat = '24h';
  await reopen(page);
  assert.match(await widget.locator('.ambient-reminder-date').first().textContent(), /^Overdue · Yesterday · \d{2}:\d{2}$/);
  state.settings.clockFormat = '12h';

  // Completed reminders never appear.
  state.reminders = reminders(2, now).map((reminder, index) => ({ ...reminder, completed: index === 0 }));
  await reopen(page);
  assert.deepEqual((await inspect(widget)).visibleText, [state.reminders[1].text]);

  // Offline with saved pending reminders keeps the list and says so, in the status tone.
  for (const mode of ['native', 'color']) await offlineStatus({ page, widget, state, now, mode });
  // Disconnected with nothing cached is unavailable, never an empty list.
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

/**
 * #233: an enabled Reminders that the display hides (confirmed empty, Hide when empty on) stays on the
 * editor canvas as a dim placeholder at its real span, so adding and resizing it stay visible; the
 * display still hides it.
 */
async function editorPlaceholder({ page, state }) {
  const origin = new URL(page.url()).origin;
  const placement = state.settings.widgetGrid.placements.reminders, { columns, rows } = { columns: 12, rows: 8 };
  assert.equal(state.settings.widgetGrid.density, 'balanced');
  state.reminders = [];
  const canvas = page.locator('.preview-surface [data-widget-id="reminders"]');
  const boxes = {};
  try {
    for (const [name, next, span] of [['small', { column: 0, row: 0, size: 'small' }, [2, 2]], ['medium', { column: 0, row: 0, size: 'medium' }, [4, 2]], ['large', { column: 0, row: 0, size: 'large' }, [4, 4]], ['column', { column: 0, row: 0, size: 'large', span: { columns: 2, rows: 8 } }, [2, 8]]]) {
      state.settings.widgetGrid.placements.reminders = next;
      await page.goto(`${origin}/editor`); await page.locator('.preview-surface').waitFor(); await page.clock.runFor(300);
      await canvas.waitFor();
      const result = await canvas.evaluate(element => {
        const rect = element.getBoundingClientRect(), plane = element.closest('.widget-grid-plane').getBoundingClientRect();
        const placeholder = element.querySelector('.reminders-placeholder');
        const inside = node => { const r = node.getBoundingClientRect(); return r.top >= rect.top - 1 && r.bottom <= rect.bottom + 1 && r.left >= rect.left - 1 && r.right <= rect.right + 1; };
        return {
          text: placeholder?.innerText.replace(/\s+/g, ' ').trim() ?? null,
          inside: placeholder ? [...placeholder.children].every(inside) : false,
          width: rect.width / plane.width, height: rect.height / plane.height,
          opacity: placeholder ? Number(getComputedStyle(placeholder).opacity) : null,
          scale: new DOMMatrix(getComputedStyle(element.querySelector('.widget-content')).transform).a,
          list: element.querySelectorAll('.ambient-reminder-list').length,
        };
      });
      const label = `editor placeholder ${name}`;
      assert.equal(result.text, 'Reminders Hidden when empty · Add a reminder', label);
      assert.equal(result.list, 0, `${label}: no list`);
      assert.ok(result.inside, `${label}: the placeholder stays inside its widget ${JSON.stringify(result)}`);
      assert.ok(result.opacity > 0 && result.opacity < 1, `${label}: dim ${result.opacity}`);
      assert.ok(Math.abs(result.width - span[0] / columns) < 0.01 && Math.abs(result.height - span[1] / rows) < 0.01, `${label}: drawn at its real ${span.join(' × ')} span ${JSON.stringify(result)}`);
      assert.ok(result.scale >= 0.75, `${label}: readable without a deep zoom-out (${result.scale})`);
      boxes[name] = [result.width, result.height];
    }
    assert.notDeepEqual(boxes.small, boxes.medium, 'resizing changes the placeholder');
    assert.notDeepEqual(boxes.medium, boxes.large, 'resizing changes the placeholder');
    // The display is unchanged: a confirmed empty list stays hidden.
    await page.goto(`${origin}/display`); await page.locator('.display-page').waitFor(); await page.clock.runFor(100);
    assert.equal(await page.locator('[data-widget-id="reminders"]').count(), 0, 'the display still hides an empty Reminders');
  } finally {
    state.settings.widgetGrid.placements.reminders = placement;
  }
}
