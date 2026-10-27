import { mockWindowsStatus, mockScreenWakeLock } from './lib/windows-fixture.mjs';
// Actual production Edge grid/photo interactions. Synthetic data and RAM images only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { catalogBoardDefaults, forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { repackGrid } from '../../src/shared/widgets.ts';

export async function runGridQa({ playwright, edge } = {}) {
  const { chromium } = createRequire(import.meta.url)(
    playwright ?? 'playwright',
  );
  const directory = await mkdtemp(join(tmpdir(), 'lrd-grid-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const now = Date.parse('2026-10-18T13:00:00Z');
  const app = await createApplication({
    dataDirectory: directory,
    clientDirectory: join(root, 'dist/client'),
    now: () => now,
    fetcher: async () => Response.json(forecastFixture()),
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({
    executablePath: edge,
    headless: true,
  });
  const errors = [],
    checks = [],
    images = [];
  let context, page;
  // The editing flows were written for the catalog board (the default before #435), which has free
  // cells; the display check at the end renders the #435 default board.
  async function open(settings = catalogBoardDefaults(), options = {}) {
    await context?.close();
    await app.store.update((data) => {
      data.settings = structuredClone(settings);
      data.reminders = [];
      data.photoAsset = null;
    });
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      timezoneId: 'America/Toronto',
      ...options,
    }); await mockWindowsStatus(context); await mockScreenWakeLock(context);
    page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('500'))
        errors.push(message.text());
    });
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: { query: async () => ({ state: 'prompt' }) },
      }),
    );
    await page.clock.install({ time: new Date(now) });
    await page.goto(base + '/editor');
    await page.getByRole('tab', { name: 'Widgets', exact: true }).waitFor();
    await page.clock.runFor(300);
  }
  const save = () =>
    page.getByRole('button', { name: 'Save changes', exact: true });
  const cancel = () =>
    page.getByRole('button', { name: 'Cancel', exact: true });
  const clean = async () => {
    await page.locator('.studio-savebar').waitFor({ state: 'detached' });
  };
  const dirty = async () => {
    await save().waitFor();
  };
  async function tab(name) {
    await page.getByRole('tab', { name, exact: true }).click();
  }
  async function layout() {
    await page
      .getByRole('button', { name: 'Edit layout', exact: true })
      .click();
  }
  async function gridPoint(locator) {
    const r = await locator.boundingBox();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  async function drag(locator, dx, dy, finish = 'up') {
    const p = await gridPoint(locator),
      box = await page.locator('.grid-editor').boundingBox();
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(
      p.x + (box.width / 12) * dx,
      p.y + (box.height / 8) * dy,
      { steps: 4 },
    );
    if (finish === 'escape') await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.clock.runFor(220);
  }
  function onlyClock() {
    const s = catalogBoardDefaults();
    for (const id of Object.keys(s.widgets)) s.widgets[id] = id === 'clock';
    return s;
  }
  async function png(color = '#293e4e') {
    const base64 = await page.evaluate((color) => {
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = color;
      g.fillRect(0, 0, 96, 64);
      return c.toDataURL('image/png').split(',')[1];
    }, color);
    return {
      name: 'synthetic.png',
      mimeType: 'image/png',
      buffer: Buffer.from(base64, 'base64'),
    };
  }
  async function bounds() {
    const bad = await page.evaluate(() => {
      // Each widget's cell: its box without the #436 float translation (its content floats inside it).
      const cell = (e) => {
        const r = e.getBoundingClientRect(),
          [x, y] = getComputedStyle(e).translate.split(' ').map((value) => parseFloat(value) || 0);
        return { left: r.left - (x ?? 0), top: r.top - (y ?? 0), right: r.right - (x ?? 0), bottom: r.bottom - (y ?? 0) };
      };
      const boxes = [...document.querySelectorAll('.ambient-widget')].map(
          (e) => ({ id: e.dataset.widgetId, r: cell(e) }),
        ),
        bad = [];
      for (const { id, r } of boxes)
        if (
          r.left < -1 ||
          r.top < -1 ||
          r.right > innerWidth + 1 ||
          r.bottom > innerHeight + 1
        )
          bad.push(`${id} outside viewport`);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i],
            b = boxes[j];
          if (
            Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left) > 1 &&
            Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > 1
          )
            bad.push(`${a.id}/${b.id} overlap`);
        }
      return bad;
    });
    assert.deepEqual(bad, []);
  }
  try {
    await open();
    await clean();
    await tab('Widgets');
    await page.getByRole('button', { name: 'Clock', exact: true }).click();
    await clean();
    await page.getByRole('button', { name: 'Add widget', exact: true }).click();
    await clean();
    // Rain is part of Weather (#74): the picker never offers it.
    assert.equal(await page.getByRole('button', { name: 'Preview Rain', exact: true }).count(), 0);
    assert.equal(
      await page
        .getByRole('button', { name: 'Close widget picker' })
        .evaluate((e) => document.activeElement === e),
      true,
    );
    // The picker opens on the first unadded widget in grouped order (#154), so choose Photo.
    await page.getByRole('button', { name: 'Preview Photo', exact: true }).click();
    await page
      .getByRole('button', { name: 'Photo medium', exact: true })
      .click();
    await clean();
    await page.getByRole('button', { name: 'Close widget picker' }).click();
    assert.equal(
      await page
        .getByRole('button', { name: 'Add widget', exact: true })
        .evaluate((e) => document.activeElement === e),
      true,
    );
    await page.goto(base + '/settings');
    await page.getByRole('combobox', { name: 'City', exact: true }).fill('Tor');
    assert.equal(await page.locator('.settings-savebar').count(), 0, 'query text alone is not a settings edit');
    await open(onlyClock());
    await layout();
    await clean();
    const move = () =>
      page.getByRole('button', { name: 'Move Clock', exact: true });
    await drag(move(), 1, 0, 'escape');
    await clean();
    await drag(move(), 1, 0);
    await dirty();
    await drag(move(), -1, 0);
    await clean();
    await drag(move(), 8, 0);
    await dirty();
    await cancel().click();
    await clean();
    await move().focus();
    await page.keyboard.press('ArrowRight');
    await dirty();
    await page.keyboard.press('ArrowLeft');
    await clean();
    const resize = () =>
      page.getByRole('button', { name: 'Resize Clock', exact: true });
    await drag(resize(), -4, -2);
    await dirty();
    await drag(resize(), 4, 2);
    await clean();
    await resize().focus();
    await page.keyboard.press('ArrowLeft');
    await dirty();
    await page.keyboard.press('ArrowRight');
    await clean();
    checks.push(
      'effective dirty only: tabs/picker/query/selection/drag cancellation, pointer+keyboard move/resize and full reverts',
    );

    await open();
    await layout();
    await page
      .getByRole('combobox', { name: 'Grid density' })
      .selectOption('spacious');
    await page
      .getByRole('status')
      .filter({ hasText: /fit/i })
      .waitFor();
    assert.equal(
      await page.getByRole('combobox', { name: 'Grid density' }).inputValue(),
      'spacious',
    );
    await dirty();
    assert.equal(await page.locator('.grid-widget-frame').count(), 5, 'five catalog-board widgets; Rain is part of Weather (#74)');
    assert.equal(await page.locator('.ambient-clock').getAttribute('data-widget-size'), 'medium');
    const fittedFrames = await page.locator('.grid-widget-frame').evaluateAll(es => es.map(e => e.getAttribute('style')));
    await move().focus(); await page.keyboard.press('Tab');
    assert.equal(await resize().evaluate(element => element === document.activeElement), true, 'focusing a widget reveals its accessible resize handle');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.ambient-clock').getAttribute('data-widget-size'), 'medium');
    assert.deepEqual(await page.locator('.grid-widget-frame').evaluateAll(es => es.map(e => e.getAttribute('style'))), fittedFrames, 'impossible family changes leave every current placement intact');
    await page.getByRole('combobox', { name: 'Grid density' }).selectOption('balanced');
    await clean();
    const cornerClock = onlyClock(); cornerClock.widgetGrid.placements.clock = { column: 6, row: 6, size: 'small' };
    await open(cornerClock);
    await layout();
    for (const density of ['spacious', 'fine', 'balanced'])
      await page
        .getByRole('combobox', { name: 'Grid density' })
        .selectOption(density);
    await clean();
    await page
      .getByRole('combobox', { name: 'Grid density' })
      .selectOption('fine');
    await cancel().click();
    await clean();
    checks.push(
      'density fits every enabled widget as a visible draft; returning restores exact authored corner placement and families; Cancel restores full grid',
    );

    // #341: keyboard results say where the widget went or what size it became, and the one layout
    // live region announces every press, even when the text repeats.
    await open();
    await layout();
    const announcer = page.locator('.layout-announcer');
    assert.equal(await announcer.getAttribute('role'), 'status');
    await page.evaluate(() => {
      window.__announced = [];
      new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) window.__announced.push(node.textContent);
      }).observe(document.querySelector('.layout-announcer'), { childList: true, subtree: true });
    });
    const announced = () => page.evaluate(() => window.__announced.splice(0));
    const lastScreen = () => page.getByRole('button', { name: 'Move Last screen', exact: true });
    const describe = async (locator) => page.locator(`[id="${(await locator.getAttribute('aria-describedby')).split(' ')[0]}"]`).textContent();
    assert.equal(await describe(lastScreen()), 'Column 9, row 5 · Medium', 'each move target is described by its place and size');
    await lastScreen().focus();
    for (let press = 0; press < 3; press++) await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await announced(), ['Last screen moved to column 8, row 5', 'Last screen moved to column 7, row 5', 'Last screen moved to column 6, row 5'], 'three presses, three distinct announcements');
    assert.equal(await page.locator('.grid-status').textContent(), 'Last screen moved to column 6, row 5');
    assert.equal(await describe(lastScreen()), 'Column 6, row 5 · Medium');
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
    assert.deepEqual(await announced(), ['No room above', 'No room above'], 'a repeated refusal is announced again');
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'Resize Last screen', exact: true }).evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await announced(), ['Last screen resized to Small'], 'a family resize names the family');
    await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await announced(), ['Last screen cannot get any smaller']);
    const liveCopies = await page.locator('[role="status"], [aria-live], [role="alert"]').evaluateAll((nodes) => nodes.filter((node) => node.textContent.includes('Last screen')).length);
    assert.equal(liveCopies, 1, 'one live region carries layout messages');
    await cancel().click();
    await clean();
    checks.push('#341: three ArrowLeft presses announce “Last screen moved to column 8/7/6, row 5” in the one layout live region; two refused moves (“No room above”) are both announced; a family resize says “Last screen resized to Small”; move targets are described by place and size (“Column 9, row 5 · Medium”)');

    // #346: a refused density names itself and the widget count, once; when hiding one widget lets it
    // fit, that is offered as one draft edit that Cancel restores.
    const FULL_BOARD = {
      clock: { column: 0, row: 0, size: 'medium' }, worldClocks: { column: 4, row: 0, size: 'medium' }, weather: { column: 8, row: 0, size: 'large' },
      sunMoon: { column: 0, row: 2, size: 'large' }, calendar: { column: 4, row: 2, size: 'medium' }, airQuality: { column: 4, row: 4, size: 'medium' },
      reminders: { column: 8, row: 4, size: 'medium' }, forecast: { column: 0, row: 6, size: 'medium' }, countdown: { column: 4, row: 6, size: 'small' },
      note: { column: 6, row: 6, size: 'small' }, preview: { column: 8, row: 6, size: 'small' }, photo: { column: 10, row: 6, size: 'small' },
    };
    const fullBoard = (without = []) => {
      const settings = defaultSettings();
      for (const id of Object.keys(settings.widgets)) settings.widgets[id] = id in FULL_BOARD && !without.includes(id);
      settings.preview.enabled = !without.includes('preview');
      Object.assign(settings.widgetGrid.placements, structuredClone(FULL_BOARD));
      return settings;
    };
    const densitySelect = () => page.getByRole('combobox', { name: 'Grid density' });
    const refusalRegions = (text) => page.locator('[role="status"], [aria-live], [role="alert"]').evaluateAll((nodes, text) => nodes.filter((node) => node.textContent.includes(text)).length, text);
    await open(fullBoard());
    await layout();
    await densitySelect().selectOption('spacious');
    const full = "Spacious (8 × 6) can't fit these 12 widgets. Make some smaller or remove one, then try again.";
    assert.equal(await page.locator('.grid-status').textContent(), full);
    assert.equal(await refusalRegions('can\'t fit'), 1, 'announced from one live region');
    assert.equal(await densitySelect().inputValue(), 'balanced', 'the grid stays');
    assert.equal(await page.locator('.density-fix').count(), 0, 'no single removal makes room here');
    await clean();
    await open(fullBoard(['photo']));
    await layout();
    await densitySelect().selectOption('spacious');
    assert.equal(await page.locator('.grid-status .density-fix').textContent(), 'Make room: remove Last screen');
    assert.match(await page.locator('.grid-status').textContent(), /^Spacious \(8 × 6\) can't fit these 11 widgets\./);
    await clean();
    // The fix belongs to its refusal, not to the board: a later message on the same board (a refused
    // keyboard move here) replaces both, and the offer never comes back beside unrelated text.
    await page.getByRole('button', { name: 'Move Clock', exact: true }).focus();
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator('.grid-status').textContent(), 'No room above');
    assert.equal(await page.locator('.density-fix').count(), 0, 'no density fix beside a refused move');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator('.density-fix').count(), 0, 'nor beside a repeated refusal');
    await clean();
    await densitySelect().selectOption('spacious');
    assert.equal(await page.locator('.grid-status .density-fix').textContent(), 'Make room: remove Last screen', 'refusing the density again offers the fix again');
    await page.getByRole('button', { name: 'Make room: remove Last screen', exact: true }).focus();
    await page.keyboard.press('Enter');
    await dirty();
    assert.equal(await densitySelect().inputValue(), 'spacious');
    assert.equal(await page.locator('[data-frame-id="preview"]').count(), 0, 'Last screen is hidden in the draft');
    assert.match(await page.locator('.grid-status').textContent(), /^Last screen removed and the grid switched to Spacious\./);
    assert.equal(await densitySelect().evaluate((element) => element === document.activeElement), true, 'focus returns to the density control');
    await cancel().click();
    await clean();
    assert.equal(await densitySelect().inputValue(), 'balanced');
    assert.equal(await page.locator('[data-frame-id="preview"]').count(), 1, 'Cancel restores Last screen');
    checks.push(`#346: the full 12-widget board refuses Spacious with “${full}” from one live region; without Photo, “Make room: remove Last screen” switches to Spacious as one draft that Cancel restores, with focus back on the density control`);

    // Pure geometry: Animation Off, so the #76 release settle (real-time CSS) cannot be mid-flight.
    const stillClock = onlyClock(); stillClock.appearance.animation = 'off';
    await open(stillClock, { viewport: { width: 390, height: 480 } });
    await layout();
    await page.evaluate(() => scrollTo(0, 110));
    const position = () => page.evaluate(() => {
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return { scroll: scrollY, canvas: rect(document.querySelector('.grid-editor')), widget: rect(document.querySelector('.ambient-clock')), handle: rect(document.querySelector('button[aria-label="Move Clock"]').parentElement) };
    });
    const anchored = await position(), grip = await gridPoint(move());
    await page.mouse.move(grip.x, grip.y); await page.mouse.down();
    await page.mouse.move(grip.x + 9, grip.y + 2, { steps: 3 });
    const moving = await position();
    assert.deepEqual(moving.canvas, anchored.canvas); assert.equal(moving.scroll, anchored.scroll);
    assert.ok(Math.abs(moving.handle.x - anchored.handle.x - 9) < 1);
    assert.ok(Math.abs(moving.widget.x - anchored.widget.x - 9) < 1);
    assert.ok(Math.abs(moving.handle.y - anchored.handle.y - 2) < 1);
    await clean(); await page.keyboard.press('Escape'); await page.mouse.up();
    await page.clock.runFor(200); await clean();
    assert.deepEqual(await position(), anchored);
    await page.clock.runFor(185000);
    assert.deepEqual((await position()).canvas, anchored.canvas);
    assert.equal(await page.locator('.ambient').getAttribute('data-composition'), '0');
    checks.push('fractional pointer movement anchors content and handle pixel-for-pixel while canvas/scroll stay fixed; Escape rolls back and authored editor never drifts');

    await open(); await layout();
    const beforeNeighbors = await page.locator('.grid-widget-frame').evaluateAll(es => es.map(e => e.getAttribute('style')));
    await drag(move(), 1, 0, 'escape'); await clean();
    assert.deepEqual(await page.locator('.grid-widget-frame').evaluateAll(es => es.map(e => e.getAttribute('style'))), beforeNeighbors);
    await drag(move(), 1, 0); await dirty();
    assert.notDeepEqual(await page.locator('.grid-widget-frame').evaluateAll(es => es.map(e => e.getAttribute('style'))), beforeNeighbors);
    await cancel().click(); await clean();
    assert.deepEqual(await page.locator('.grid-widget-frame').evaluateAll(es => es.map(e => e.getAttribute('style'))), beforeNeighbors);
    checks.push('neighbor displacement previews and commits as one draft; Escape and global Cancel restore every affected placement');

    const concurrent = onlyClock(); concurrent.widgetGrid.placements.clock.size = 'medium';
    concurrent.widgets.weather = true;
    concurrent.widgetGrid.placements.weather = { column: 8, row: 0, size: 'medium' };
    for (const collision of [false, true]) {
      await open(concurrent);
      await layout();
      const start = await gridPoint(move()),
        plane = await page.locator('.grid-editor').boundingBox();
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + plane.width / 12, start.y);
      const response = await page.request.patch(base + '/api/settings', {
        headers: { Origin: base },
        data: {
          widgetGrid: {
            placements: { weather: collision ? { column: 4 } : { row: 5 } },
          },
        },
      });
      assert.equal(response.status(), 200);
      await page.clock.runFor(31000);
      await page.waitForFunction((collision) => {
        const frame = document.querySelector(
          'button[aria-label="Move Weather"]',
        ).parentElement;
        return collision
          ? parseFloat(frame.style.left) > 34 && parseFloat(frame.style.left) < 66
          : frame.style.top === '62.5%';
      }, collision);
      await page.mouse.up();
      if (collision) {
        await dirty();
        await cancel().click();
        await clean();
        assert.equal(
          app.store.snapshot().settings.widgetGrid.placements.clock.column,
          0,
        );
      } else {
        await dirty();
        await save().click();
        await clean();
        assert.equal(
          app.store.snapshot().settings.widgetGrid.placements.weather.row,
          5,
        );
        assert.equal(
          app.store.snapshot().settings.widgetGrid.placements.clock.column,
          1,
        );
      }
    }
    checks.push(
      'held drag preserves unrelated incoming placements and reflows neighbors against the latest polled board; Cancel discards reflow',
    );

    await open(onlyClock(), { hasTouch: true });
    await layout();
    const touch = await context.newCDPSession(page),
      p = await gridPoint(move()),
      plane = await page.locator('.grid-editor').boundingBox();
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: p.x, y: p.y }],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: p.x + plane.width / 12, y: p.y }],
    });
    await clean();
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    });
    await clean();
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: p.x, y: p.y }],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: p.x + plane.width / 12, y: p.y }],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await dirty();
    await cancel().click();
    await clean();
    checks.push(
      'real touch pointer capture: preview/cancel stays clean; drop commits and global Cancel restores',
    );

    await open();
    await tab('Widgets');
    await page.getByRole('button', { name: 'Clock', exact: true }).click();
    await page.getByRole('button', { name: 'Digital', exact: true }).click();
    await dirty();
    assert.equal(await page.locator('.clock-digital').count(), 1);
    await page.getByRole('button', { name: 'Analog', exact: true }).click();
    assert.equal(await page.locator('.analog-clock').count(), 1);
    await page.getByRole('button', { name: 'Outline', exact: true }).click();
    await clean();
    for (const name of [
      'Clock',
      'Weather',
      'Forecast',
      'Reminders',
      'Last screen',
    ])
      await page
        .getByRole('button', { name: `Remove ${name}`, exact: true })
        .click();
    assert.equal(await page.locator('.ambient-widget').count(), 0);
    await dirty();
    await cancel().click();
    await clean();
    await page.getByRole('button', { name: 'Add widget', exact: true }).click();
    await page.getByRole('button', { name: 'Preview Photo', exact: true }).click();
    await page.getByRole('button', { name: 'Add Photo', exact: true }).click();
    await dirty();
    await page
      .getByRole('button', { name: 'Remove Photo', exact: true })
      .click();
    await clean();
    checks.push(
      'all modules optional including independent weather and clock; styles render distinctly; add/remove returns clean',
    );

    const settings = catalogBoardDefaults();
    settings.widgets.photo = true;
    // Repack a smaller visible board to leave room for the local image.
    for (const id of ['reminders', 'preview', 'forecast'])
      settings.widgets[id] = false;
    await open(settings);
    await tab('Widgets');
    await page.getByRole('button', { name: 'Photo', exact: true }).click();
    const file = await png(),
      other = await png('#41334a');
    const upload = () => page.getByLabel('Choose local photo', { exact: true });
    await upload().setInputFiles(file);
    await page.locator('.ambient-photo-image').waitFor();
    await dirty();
    assert.equal(app.store.snapshot().photoAsset, null);
    assert.ok(
      (
        await page.locator('.ambient-photo-image').getAttribute('src')
      ).startsWith('data:image/png;base64,'),
    );
    await cancel().click();
    await clean();
    assert.equal(await page.locator('.ambient-photo-image').count(), 0);
    await upload().setInputFiles(file);
    await dirty();
    await page.route('**/api/settings', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Synthetic save failure' }),
          })
        : route.continue(),
    );
    await save().click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Synthetic save failure' })
      .waitFor();
    await dirty();
    assert.equal(app.store.snapshot().photoAsset, null);
    await page.unroute('**/api/settings');
    await save().click();
    await clean();
    const id = app.store.snapshot().photoAsset.id;
    assert.ok(id);
    await upload().setInputFiles(file);
    await page
      .getByText('Preparing…', { exact: true })
      .waitFor({ state: 'detached' });
    await clean();
    await upload().setInputFiles(other);
    await dirty();
    await cancel().click();
    await clean();
    assert.equal(app.store.snapshot().photoAsset.id, id);
    await page
      .getByRole('button', { name: 'Clear photo', exact: true })
      .click();
    await dirty();
    await upload().setInputFiles(file);
    await page
      .getByText('Preparing…', { exact: true })
      .waitFor({ state: 'detached' });
    await clean();
    const exported = await page.request.get(base + '/api/export');
    assert.ok(!JSON.stringify(await exported.json()).includes('pngBase64'));
    checks.push(
      'actual canvas PNG photo draft: CSP-safe preview, cancel, failed/successful atomic save, same-byte no-op, clear/reselect and export privacy',
    );

    await page.evaluate(() => {
      const original = window.createImageBitmap;
      window.__holdDecode = true;
      window.createImageBitmap = async (...args) => {
        const result = await original(...args);
        if (window.__holdDecode)
          await new Promise((resolve) => {
            window.__releaseDecode = resolve;
          });
        return result;
      };
    });
    await upload().setInputFiles(other);
    await page.getByRole('button', { name: 'Cancel photo' }).waitFor();
    await page.waitForFunction(() => Boolean(window.__releaseDecode));
    await page.getByRole('button', { name: 'Cancel photo' }).click();
    await page.evaluate(() => {
      window.__holdDecode = false;
      window.__releaseDecode();
    });
    await page.clock.runFor(300);
    await clean();
    assert.equal(app.store.snapshot().photoAsset.id, id);
    checks.push('late photo decoder result cannot resurrect a cancelled draft');

    const tooLarge = Buffer.from(file.buffer);
    tooLarge.writeUInt32BE(20000, 16);
    tooLarge.writeUInt32BE(20000, 20);
    await page.evaluate(() => {
      window.__decodeCalls = 0;
      const original = window.createImageBitmap;
      window.createImageBitmap = (...args) => {
        window.__decodeCalls++;
        return original(...args);
      };
    });
    await upload().setInputFiles({ ...file, buffer: tooLarge });
    await page
      .getByRole('alert')
      .filter({ hasText: 'Choose a smaller image' })
      .waitFor();
    assert.equal(await page.evaluate(() => window.__decodeCalls), 0);
    await clean();
    checks.push(
      'oversized raster dimensions rejected before browser decoder allocation',
    );

    for (const type of ['image/jpeg', 'image/webp']) {
      const encoded = await page.evaluate((type) => {
        const c = document.createElement('canvas');
        c.width = 1600;
        c.height = 900;
        const g = c.getContext('2d');
        g.fillStyle = '#253142';
        g.fillRect(0, 0, 1600, 900);
        return c.toDataURL(type).split(',')[1];
      }, type);
      await upload().setInputFiles({
        name: type === 'image/jpeg' ? 'synthetic.jpg' : 'synthetic.webp',
        mimeType: type,
        buffer: Buffer.from(encoded, 'base64'),
      });
      await page
        .getByText('Preparing…', { exact: true })
        .waitFor({ state: 'detached' });
      await dirty();
      await page.waitForFunction(() => {
        const img = document.querySelector('.ambient-photo-image');
        return (
          img?.complete &&
          img.naturalWidth === 1280 &&
          img.src.startsWith('data:image/png;base64,')
        );
      });
      await cancel().click();
      await clean();
    }
    checks.push(
      'real JPEG/WebP browser decode and 1280px normalized PNG downsample stay cancellable',
    );

    for (const id of ['weather']) {
      const settings = onlyClock();
      settings.widgets.clock = false;
      settings.widgets[id] = true;
      await open(settings);
      await page.goto(base + '/display');
      await page.getByText('Forecast by Open-Meteo', { exact: true }).waitFor();
      assert.equal(
        await page
          .locator(`.ambient-${id}`)
          .getByText('Forecast by Open-Meteo', { exact: true })
          .count(),
        1,
      );
    }
    checks.push(
      'provider credit remains inside the relocating Weather widget without Forecast',
    );

    for (const id of ['weather', 'forecast'])
      for (const size of ['small', 'medium', 'large']) {
        const settings = onlyClock();
        settings.widgets.clock = false;
        settings.widgets[id] = true;
        settings.units = 'imperial';
        settings.location.name = 'Review City';
        settings.locationSource = 'manual';
        settings.widgetGrid.placements[id] = { column: 0, row: 0, size };
        await open(settings);
        await page.goto(base + '/display');
        const widget = page.locator(`.ambient-${id}`);
        await widget.waitFor();
        assert.match(await widget.innerText(), /Review City/);
        if (id === 'weather')
          assert.match(
            await widget.locator('.ambient-label').innerText(),
            /°F/,
          );
        if (id === 'forecast')
          assert.match(
            await widget.locator('.weather-context').innerText(),
            /°F/,
          );
        // The fixture rains, so Weather is elevated; wider families show the amount in inches (#74).
        if (id === 'weather' && size !== 'small')
          assert.match(
            await widget.locator('.rain-detail').innerText(),
            / in rain$/,
          );
      }
    checks.push(
      'each independently enabled weather module retains actual place and visible relevant units in every family',
    );

    for (const density of ['spacious', 'balanced', 'fine'])
      for (const size of ['small', 'medium']) {
        const settings = onlyClock();
        settings.widgets.clock = false;
        settings.widgets.forecast = true;
        settings.widgetGrid = repackGrid(
          settings.widgetGrid,
          density,
          settings.widgets,
        );
        settings.widgetGrid.placements.forecast = { column: 0, row: 0, size };
        await open(settings, { viewport: { width: 1920, height: 1080 } });
        await page.goto(base + '/display');
        await page.locator('.forecast-day-label').first().waitFor();
        await page.clock.runFor(500);
        const labels = await page
          .locator('.forecast-day-label')
          .evaluateAll((es) =>
            es.map((e) => {
              const range = document.createRange();
              range.selectNodeContents(e);
              const text = range.getBoundingClientRect(),
                cell = e.closest('.forecast-day').getBoundingClientRect();
              return {
                text: e.textContent,
                full: e.getAttribute('aria-label'),
                lines: range.getClientRects().length,
                width: text.width,
                available: cell.width,
              };
            }),
          );
        assert.ok(
          labels.some(
            (label) =>
              // Compact labels name tomorrow by its weekday (#256); assistive text keeps Tomorrow.
              label.full.startsWith('Tomorrow, ') &&
              label.text ===
                new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(
                  new Date(`${label.full.slice(-10)}T12:00:00Z`),
                ),
          ),
        );
        for (const label of labels) {
          assert.equal(label.lines, 1);
          assert.ok(
            label.width <= label.available + 1,
            JSON.stringify({ density, size, ...label }),
          );
        }
        images.push({
          label: `Compact forecast ${density}/${size}`,
          bytes: await page.screenshot({ type: 'png', animations: 'disabled' }),
        });
      }
    checks.push(
      'small/medium forecast labels remain one line at every grid density with full accessible civil dates',
    );

    // #435: the full default board at the owner's 1280 × 720 TV, 1080p and 4K. Every shown widget
    // moves as part of the whole board in every composition.
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 },
    ]) {
      await open(defaultSettings(), { viewport });
      await page.goto(base + '/display');
      await page.locator('.clock-time').waitFor();
      const places = () => page.locator('.ambient-widget').evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
        const r = element.getBoundingClientRect(); return [element.dataset.widgetId, `${Math.round(r.left)},${Math.round(r.top)}`];
      })));
      let previous = null;
      for (let cycle = 0; cycle < 5; cycle++) {
        await page.clock.runFor(cycle ? 180000 : 1000);
        await page.clock.runFor(4000);
        await bounds();
        const current = await places();
        assert.deepEqual(Object.keys(current).sort(), ['calendar', 'clock', 'forecast', 'preview', 'weather'], `${viewport.width}: the default board keeps the enabled Last screen waiting state visible`);
        await page.getByText('Waiting for screenshot', { exact: true }).waitFor();
        assert.equal(await page.locator('.preview-image, .preview-caption').count(), 0);
        if (previous) for (const [id, place] of Object.entries(current)) assert.notEqual(place, previous[id], `${viewport.width} cycle ${cycle}: ${id} moves with the board`);
        previous = current;
      }
      assert.equal(await page.locator('html.native-display').count(), 0);
      assert.notEqual(await page.locator('html').evaluate(element => getComputedStyle(element).cursor), 'none');
      images.push({
        label: `Grid ambient ${viewport.width}`,
        bytes: await page.screenshot({ type: 'png', animations: 'disabled' }),
      });
    }
    checks.push(
      '#435 default board at 1280×720, 1080p and 4K: actual rendered widget bounds and pairwise non-overlap over varied compositions, every shown widget moving in every composition; visible browser cursor',
    );
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
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: { playwright: { type: 'string' }, edge: { type: 'string' } },
  });
  const result = await runGridQa(values);
  console.log(
    JSON.stringify(
      {
        passed: result.checks.length,
        checks: result.checks,
        images: 'RAM buffers only; visual inspection is a separate check.',
      },
      null,
      2,
    ),
  );
}
