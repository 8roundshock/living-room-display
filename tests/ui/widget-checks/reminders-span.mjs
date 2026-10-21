import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS, familyForSpan, freeSpanLimits, getWidgetRect, normalizePlacement, resizeWidgetSpan } from '../../../src/shared/widgets.ts';

// Free-size Reminders (#73). Runs through the `sweep` hook, once per viewport after the family sweep:
// the measured list holds in every custom span shape (complete rows inside the box, overflow rows
// taking no layout, an exact "+N more"), a wider span never shows fewer rows than a narrower one (#359),
// and a full-height column, or a tall span with little vertical travel (#175), alternates top and bottom
// anchoring while relocating. Synthetic reminders only.
export const id = 'reminders-span';

const TITLES = ['Read a chapter', 'Water the plants', 'Plan the weekend', 'Call a friend', 'A later reminder'];

function reminders(count, now) {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    text: `${TITLES[index % TITLES.length]}${index >= TITLES.length ? ` ${index + 1}` : ''}`,
    completed: false,
    // Dated and undated rows mix both row heights.
    dueAt: index % 3 === 1 ? new Date(now + (index + 2) * 3_600_000).toISOString() : null,
    createdAt: new Date(now - index * 60_000).toISOString(),
    updatedAt: new Date(now - index * 60_000).toISOString(),
  }));
}

/** The #254 example: six pending reminders, one with a title that needs three or four lines in a narrow column. */
const LONG_TITLE = 'Renew passport — photos first, then the online form';
function longList(now) {
  return reminders(6, now).map((reminder, index) => index === 2 ? { ...reminder, text: LONG_TITLE } : reminder);
}

/** #359: eight pending reminders whose second one has the long title from the ticket, or eight short ones. */
const LONG_SECOND = 'Call Mom about Sunday dinner plans and the cake';
const SHORT_TITLES = ['Read a chapter', 'Water plants', 'Plan the weekend', 'Call a friend', 'Groceries', 'Library books', 'Recycling', 'Laundry'];
function widthList(now, long) {
  return reminders(8, now).map((reminder, index) => ({ ...reminder, text: long ? (index === 1 ? LONG_SECOND : reminder.text) : SHORT_TITLES[index] }));
}
/** Widths for the #359 sweep: small, medium and wider, up to the free-size maximum. */
function widths(density) {
  const max = freeSpanLimits('reminders', density).max.columns;
  return [...new Set([2, 3, 4, 6, max])].filter(columns => columns <= max).sort((a, b) => a - b);
}

/** 2×2, 4×2, 4×4, Column, 4 × full height, max width × 2 and 3×5 in one density. */
function shapes(density) {
  const { rows } = GRID_DENSITIES[density], max = freeSpanLimits('reminders', density).max;
  return { '2x2': { columns: 2, rows: 2 }, '4x2': { columns: 4, rows: 2 }, '4x4': { columns: 4, rows: 4 }, column: { columns: 2, rows },
    '4xfull': { columns: 4, rows }, 'max-widthx2': { columns: max.columns, rows: 2 }, '3x5': { columns: 3, rows: 5 } };
}

async function reopen(page) {
  await page.reload();
  await page.locator('.display-page').waitFor();
  await page.clock.runFor(100);
}

/** Measured-list facts plus where the visible group sits inside the body. */
async function inspect(widget) {
  return widget.evaluate(element => {
    const body = element.querySelector('.reminders-body');
    const box = body.getBoundingClientRect();
    const rows = [...element.querySelectorAll('.ambient-reminder-list > li')];
    const visible = rows.filter(row => !row.classList.contains('reminder-overflow'));
    const inside = node => { const rect = node.getBoundingClientRect(); return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 && rect.left >= box.left - 1 && rect.right <= box.right + 1; };
    const shown = [...body.children].filter(child => getComputedStyle(child).display !== 'none' && child.getBoundingClientRect().height > 0);
    const label = body.querySelector('.ambient-label');
    const more = element.querySelector('.reminder-more');
    return {
      span: element.getAttribute('data-widget-span'),
      fullHeight: element.hasAttribute('data-full-height'),
      total: rows.length,
      visible: visible.length,
      outside: visible.filter(row => !inside(row)).length,
      overflowRendered: rows.filter(row => row.classList.contains('reminder-overflow') && (getComputedStyle(row).display !== 'none' || row.getBoundingClientRect().height > 0)).length,
      more: more ? more.textContent : null,
      moreInside: more ? inside(more) : true,
      labelInside: inside(label),
      horizontal: visible.filter(row => { const title = row.querySelector('.ambient-reminder-title'); return title.scrollWidth > title.clientWidth + 1; }).length,
      titles: visible.map(row => {
        const title = row.querySelector('.ambient-reminder-title'), style = getComputedStyle(title);
        return { text: title.textContent, size: parseFloat(style.fontSize), clamp: Number(style.webkitLineClamp), lines: Math.round(title.offsetHeight / (parseFloat(style.fontSize) * 1.2)), cut: (() => { const clamped = title.offsetHeight; title.style.webkitLineClamp = 'none'; const full = title.offsetHeight; title.style.webkitLineClamp = ''; return full > clamped + 1; })() };
      }),
      alternate: body.hasAttribute('data-alternate-anchor'),
      displayHeight: element.closest('.ambient').getBoundingClientRect().height,
      top: shown[0].getBoundingClientRect().top - box.top,
      bottom: box.bottom - Math.max(...shown.map(child => child.getBoundingClientRect().bottom)),
      justify: getComputedStyle(body).justifyContent,
      scale: new DOMMatrix(getComputedStyle(element.querySelector('.widget-content')).transform).a,
      composition: element.closest('.ambient').getAttribute('data-composition'),
    };
  });
}

function assertMeasured(result, expectedTotal, label) {
  assert.ok(result.visible >= 1, `${label}: at least one row`);
  assert.equal(result.outside, 0, `${label}: every visible row is complete inside the box ${JSON.stringify(result)}`);
  assert.equal(result.overflowRendered, 0, `${label}: overflow rows take no layout`);
  const hidden = expectedTotal - result.visible;
  assert.equal(result.more, hidden > 0 ? `+${hidden} more` : null, `${label}: honest remaining count`);
  assert.ok(result.moreInside && result.labelInside, `${label}: the label and footer stay inside the box`);
  assert.equal(result.horizontal, 0, `${label}: titles never overflow sideways`);
  // The first title keeps its clamp; the rows after it share it or, when that shows more rows, one line (#359).
  const [first, ...rest] = result.titles;
  assert.ok(first.clamp >= 2 && first.lines <= first.clamp, `${label}: the first title keeps its clamp ${JSON.stringify(first)}`);
  assert.ok(new Set(rest.map(title => title.clamp)).size <= 1 && rest.every(title => (title.clamp === first.clamp || title.clamp === 1) && title.lines <= title.clamp), `${label}: the rows after the first share one clamp ${JSON.stringify(result.titles)}`);
}

/** Reminders plus Clock, Weather and Calendar (small), for compositions that move the whole board. */
function board(state, density, span) {
  single(state, density, span);
  for (const id of ['clock', 'weather', 'calendar']) state.settings.widgets[id] = true;
  Object.assign(state.settings.widgetGrid.placements, { clock: { column: 4, row: 0, size: 'small' }, weather: { column: 8, row: 0, size: 'small' }, calendar: { column: 8, row: 4, size: 'small' } });
}

function assertAnchor(result, bottom, label) {
  assert.ok(result.top >= -0.5 && result.bottom >= -0.5, `${label}: the group is never clipped ${JSON.stringify(result)}`);
  if (bottom) assert.ok(result.bottom <= 1.5, `${label}: bottom-anchored ${JSON.stringify(result)}`);
  else assert.ok(result.top <= 1.5, `${label}: top-anchored ${JSON.stringify(result)}`);
}

/** Only Reminders, at the top-left origin, in a custom or family shape. */
function single(state, density, span) {
  state.settings.appearance.motionEnabled = false;
  state.settings.widgetGrid.density = density;
  state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'reminders']));
  state.settings.widgetGrid.placements.reminders = normalizePlacement('reminders', { column: 0, row: 0, size: familyForSpan('reminders', span), span });
}

export async function sweep({ page, viewport, state, base, now }) {
  const widget = page.locator('[data-widget-id="reminders"]');
  const fourK = viewport.width > 2000, authored = structuredClone(state.settings.widgetGrid);
  // Every shape × density × 1, 5 and 30 pending at this viewport.
  for (const density of Object.keys(GRID_DENSITIES)) {
    const counts = {};
    for (const [name, span] of Object.entries(shapes(density))) for (const count of [1, 5, 30]) {
      single(state, density, span); state.reminders = reminders(count, now);
      await reopen(page);
      const label = `${name} ${span.columns}x${span.rows}/${density}/${viewport.width}p × ${count}`;
      const result = await inspect(widget);
      assert.equal(result.span, `${span.columns}x${span.rows}`, label);
      assert.equal(result.fullHeight, span.rows === GRID_DENSITIES[density].rows, `${label}: data-full-height`);
      assertMeasured(result, count, label);
      assert.equal(result.scale, 1, `${label}: normal text fits without zooming out`);
      assertAnchor(result, false, `${label} at rest`);
      counts[`${name}/${count}`] = result.visible;
    }
    // The #73 request: a tall box lists more reminders, never one item plus "+29 more".
    assert.ok(counts['column/30'] > counts['2x2/30'] && counts['column/30'] >= 4, `${density}/${viewport.width}p: a Column shows more rows ${JSON.stringify(counts)}`);
    assert.ok(counts['4xfull/30'] > counts['4x2/30'], `${density}/${viewport.width}p: 4 × full height shows more rows than 4×2 ${JSON.stringify(counts)}`);
  }

  // #254: when every pending reminder fits a tall column, a long title shows in full (up to four lines)
  // instead of being cut while the column stays half empty, and titles may grow toward the 3.2% cap.
  // 2 × and 3 × full height in every density (2×8 and 3×8 in Balanced), also at 1280×720 from 1080p.
  for (const view of fourK ? [viewport] : [{ width: 1280, height: 720 }, viewport]) {
    if (view !== viewport) await page.setViewportSize(view);
    for (const density of Object.keys(GRID_DENSITIES)) for (const columns of [2, 3]) {
      const span = { columns, rows: GRID_DENSITIES[density].rows };
      single(state, density, span); state.reminders = longList(now);
      await reopen(page);
      const label = `long title ${columns}x${span.rows}/${density}/${view.width}p`;
      const result = await inspect(widget);
      assertMeasured(result, longList(now).length, label);
      assert.equal(result.scale, 1, `${label}: no zoom-out`);
      assertAnchor(result, false, label);
      assert.equal(result.more, null, `${label}: every reminder fits the column ${JSON.stringify(result)}`);
      const long = result.titles.find(title => title.text === LONG_TITLE);
      assert.ok(long, `${label}: the long title is listed`);
      assert.equal(long.cut, false, `${label}: the long title shows in full ${JSON.stringify(long)}`);
      assert.ok(long.lines <= 4 && long.clamp >= long.lines, `${label}: up to four lines ${JSON.stringify(long)}`);
      // A two-cell column is too narrow for the title in two lines, so only the relaxed clamp shows it.
      if (columns === 2) assert.ok(long.lines > 2 && long.clamp > 2, `${label}: the relaxed clamp shows the title in full ${JSON.stringify(long)}`);
      assert.ok(result.titles.every(title => !title.cut), `${label}: no title is cut`);
      for (const title of result.titles) assert.ok(title.size <= result.displayHeight * 0.032 + 0.5, `${label}: ${title.size}px stays within the display cap`);
    }
    if (view !== viewport) await page.setViewportSize(viewport);
  }

  // #359: when not every reminder fits, a wider box never shows fewer than a narrower one at the same height
  // (so medium shows at least as many as small): with the long title second and with short titles, at 2 and
  // 4 rows in every density, at 720p and 1080p (the 1080p run) and 4K.
  const widthCounts = {};
  for (const view of fourK ? [viewport] : [{ width: 1280, height: 720 }, viewport]) {
    if (view !== viewport) await page.setViewportSize(view);
    for (const density of Object.keys(GRID_DENSITIES)) for (const rows of [2, 4]) for (const long of [true, false]) {
      const counts = [];
      for (const columns of widths(density)) {
        const span = { columns, rows };
        single(state, density, span); state.reminders = widthList(now, long);
        await reopen(page);
        const label = `#359 ${long ? 'long' : 'short'} ${columns}x${rows}/${density}/${view.width}p`;
        const result = await inspect(widget);
        assertMeasured(result, 8, label);
        assert.equal(result.scale, 1, `${label}: no zoom-out`);
        for (const title of result.titles) assert.ok(title.size <= result.displayHeight * 0.032 + 0.5, `${label}: ${title.size}px stays within the display cap`);
        counts.push([columns, result.visible]);
      }
      const name = `${long ? 'long' : 'short'} ×${rows}/${density}/${view.width}p`;
      widthCounts[name] = counts.map(([columns, visible]) => `${columns}:${visible}`).join(' ');
      for (let index = 1; index < counts.length; index++) assert.ok(counts[index][1] >= counts[index - 1][1], `${name}: ${counts[index][0]} columns show at least as many rows as ${counts[index - 1][0]} (${widthCounts[name]})`);
    }
    if (view !== viewport) await page.setViewportSize(viewport);
  }
  // The ticket's evidence: Balanced at 1280×720, one long title no longer halves a medium list.
  if (!fourK) assert.ok(Number(/4:(\d+)/.exec(widthCounts['long ×2/balanced/1280p'])[1]) >= 2, `medium keeps two rows beside a long title (${widthCounts['long ×2/balanced/1280p']})`);

  // Timed compositions on the display: a lone full-height column moves sideways and alternates its anchor.
  for (const count of [1, 30]) {
    single(state, 'balanced', { columns: 2, rows: 8 }); state.reminders = reminders(count, now);
    // #436: compositions change only with Swap places on (opt-in).
    state.settings.appearance.motionIntervalSeconds = 30; state.settings.appearance.rearrange = true;
    await reopen(page);
    const lefts = new Set(), seen = [];
    for (let composition = 0; composition < 4; composition++) {
      if (composition) { await page.clock.runFor(30_000); await page.clock.runFor(1_200); }
      const label = `display column × ${count} composition ${composition}/${viewport.width}p`;
      const result = await inspect(widget);
      assert.equal(result.composition, String(composition), label);
      assertMeasured(result, count, label);
      assertAnchor(result, composition % 2 === 1, label);
      assert.equal(result.justify, composition % 2 ? 'safe flex-end' : 'flex-start', label);
      if (count === 1 && composition % 2) assert.ok(result.top > 100, `${label}: one reminder visibly sits at the bottom (${result.top}px)`);
      // The cell: the box without the #436 float translation (its content floats inside it).
      const rect = await widget.evaluate(element => { const r = element.getBoundingClientRect(), plane = element.closest('.widget-grid-plane').getBoundingClientRect(), [x, y] = getComputedStyle(element).translate.split(' ').map(value => parseFloat(value) || 0); return { left: r.left - (x ?? 0) - plane.left, top: r.top - (y ?? 0) - plane.top, height: r.height, plane: plane.height }; });
      assert.ok(Math.abs(rect.top) <= 1 && Math.abs(rect.height - rect.plane) <= 1, `${label}: stays full height`);
      lefts.add(Math.round(rect.left)); seen.push(result.visible);
    }
    assert.ok(lefts.size >= 2, `display column × ${count}: moves horizontally (${[...lefts].join(', ')})`);
    assert.equal(new Set(seen).size, 1, `display column × ${count}: anchoring never changes the fitted count (${seen.join(', ')})`);
  }

  // #175: a tall span that can barely move vertically (the grid's rows minus its rows under a third of the
  // grid) alternates its anchor too: 2 × 7 in Balanced and 2 × 9 in Fine beside Clock, Weather and Calendar,
  // through timed compositions 0–3, found by composition-N and data-widget-span. A 2 × 5 in Balanced (three
  // rows of travel) stays top-anchored.
  for (const [density, span, alternates] of [['balanced', { columns: 2, rows: 7 }, true], ['fine', { columns: 2, rows: 9 }, true], ['balanced', { columns: 2, rows: 5 }, false]]) {
    for (const count of alternates ? [1, 30] : [1]) {
      board(state, density, span); state.reminders = reminders(count, now);
      state.settings.appearance.motionIntervalSeconds = 30;
      await reopen(page);
      const seen = [];
      for (let composition = 0; composition < 4; composition++) {
        if (composition) { await page.clock.runFor(30_000); await page.clock.runFor(1_200); }
        const label = `#175 ${span.columns}x${span.rows}/${density} × ${count} composition ${composition}/${viewport.width}p`;
        const tall = page.locator(`.ambient.composition-${composition} [data-widget-span="${span.columns}x${span.rows}"]`);
        await tall.waitFor();
        const result = await inspect(tall);
        assert.equal(result.alternate, alternates, `${label}: data-alternate-anchor`);
        assertMeasured(result, count, label);
        const bottom = alternates && composition % 2 === 1;
        assertAnchor(result, bottom, label);
        assert.equal(result.justify, bottom ? 'safe flex-end' : 'flex-start', label);
        if (count === 1 && bottom) assert.ok(result.top > 100, `${label}: one reminder visibly sits at the bottom (${result.top}px)`);
        const rects = await page.locator('.ambient [data-widget-id]').evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { id: element.getAttribute('data-widget-id'), left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }));
        assert.equal(rects.length, 4, `${label}: every enabled widget renders`);
        for (const a of rects) for (const b of rects) if (a.id < b.id) assert.ok(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5, `${label}: ${a.id} and ${b.id} are disjoint`);
        seen.push(result.visible);
      }
      assert.equal(new Set(seen).size, 1, `#175 ${span.columns}x${span.rows}/${density} × ${count}: anchoring never changes the fitted count (${seen.join(', ')})`);
    }
  }

  // compositionOverride 0–3 through the editor's arrangement preview, beside the default widgets. Rain is
  // part of Weather since #74; a medium Weather and a Photo in Rain's old cells keep the earlier geometry,
  // because the default large Weather leaves no room for a column beside Clock and Forecast (#183).
  if (!fourK) {
    state.settings.appearance.motionEnabled = false; state.reminders = reminders(30, now);
    state.settings.appearance.rearrange = true; // the arrangement buttons show only with Swap places on (#436)
    state.settings.widgetGrid = structuredClone(authored);
    state.settings.widgetGrid.placements.weather = { column: 8, row: 0, size: 'medium' };
    state.settings.widgetGrid.placements.photo = { column: 8, row: 2, size: 'medium' };
    state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, ['clock', 'weather', 'photo', 'forecast', 'reminders'].includes(key)]));
    const enabled = { ...state.settings.widgets, preview: state.settings.widgets.preview && state.settings.preview.enabled };
    const board = resizeWidgetSpan(state.settings.widgetGrid, 'reminders', { columns: 2, rows: 8 }, enabled);
    assert.ok(board, 'the board makes room for a 2 × 8 column');
    state.settings.widgetGrid = board;
    await page.goto(`${base}/editor`); await page.locator('.preview-surface').waitFor(); await page.clock.runFor(300);
    await page.getByRole('button', { name: 'Preview movement', exact: true }).click();
    const preview = page.locator('.preview-surface');
    const lefts = new Set();
    for (let composition = 0; composition < 4; composition++) {
      await page.getByRole('button', { name: `Arrangement ${composition + 1}`, exact: true }).click();
      await preview.locator(`.ambient.composition-${composition}`).waitFor(); await page.clock.runFor(100);
      const label = `editor arrangement ${composition + 1}`;
      const rects = await preview.locator('[data-widget-id]').evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { id: element.getAttribute('data-widget-id'), left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }));
      assert.equal(rects.length, 5, `${label}: every enabled widget renders`);
      for (const a of rects) for (const b of rects) if (a.id < b.id) assert.ok(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5, `${label}: ${a.id} and ${b.id} are disjoint`);
      const result = await inspect(preview.locator('[data-widget-id="reminders"]'));
      assert.equal(result.composition, String(composition), label);
      assert.equal(result.fullHeight, true, label);
      assertMeasured(result, 30, label);
      assert.ok(result.visible >= 4, `${label}: the editor canvas lists several reminders in the column (${result.visible})`);
      assertAnchor(result, composition % 2 === 1, label);
      lefts.add(Math.round(rects.find(rect => rect.id === 'reminders').left));
    }
    assert.ok(lefts.size >= 2, `editor arrangements move the column horizontally (${[...lefts].join(', ')})`);
    // The shared rect helper agrees with the authored column.
    assert.equal(getWidgetRect(board, 'reminders').height, 100);
    await page.goto(`${base}/display`); await page.locator('.display-page').waitFor();
  }
  return 'Free-size Reminders: 2×2, 4×2, 4×4, Column, 4 × full, max width × 2 and 3×5 × 3 densities × 1080p/4K × 1, 5 and 30 pending keep the measured list; 2 × and 3 × full-height columns at 720p/1080p/4K show a long title in full when every reminder fits (#254); with eight pending (a long second title, or all short) a wider span never shows fewer rows than a narrower one at 2 and 4 rows in every density at 720p/1080p/4K, and medium keeps two rows at 720p (#359); a full-height column relocates sideways, alternates top/bottom anchoring without clipping or changing "+N more", 2 × 7 Balanced and 2 × 9 Fine alternate too through compositions 0–3 beside three widgets while a 2 × 5 stays top-anchored (#175), and editor arrangements 1–4 stay disjoint';
}
