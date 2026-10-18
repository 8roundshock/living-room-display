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
import { forecastFixture } from '../../src/server/fixtures.ts';
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
  async function open(settings = defaultSettings(), options = {}) {
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
    });
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
  }
  function onlyClock() {
    const s = defaultSettings();
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
      const boxes = [...document.querySelectorAll('.ambient-widget')].map(
          (e) => ({ id: e.dataset.widgetId, r: e.getBoundingClientRect() }),
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
    assert.equal(
      await page
        .getByRole('button', { name: 'Close widget picker' })
        .evaluate((e) => document.activeElement === e),
      true,
    );
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
    await tab('Weather');
    await page.getByRole('combobox', { name: 'Search for a city' }).fill('Tor');
    await clean();
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
    await clean();
    await move().focus();
    await page.keyboard.press('ArrowRight');
    await dirty();
    await page.keyboard.press('ArrowLeft');
    await clean();
    const resize = () =>
      page.getByRole('button', { name: 'Resize Clock', exact: true });
    await drag(resize(), -2, 0);
    await dirty();
    await drag(resize(), 2, 0);
    await clean();
    await resize().focus();
    await page.keyboard.press('ArrowLeft');
    await dirty();
    await page.keyboard.press('ArrowRight');
    await clean();
    checks.push(
      'effective dirty only: tabs/picker/query/selection/drag cancellation, pointer+keyboard move/resize and full reverts',
    );

    await page
      .getByRole('combobox', { name: 'Grid density' })
      .selectOption('spacious');
    await page
      .getByRole('status')
      .filter({ hasText: /room|fit/i })
      .waitFor();
    assert.equal(
      await page.getByRole('combobox', { name: 'Grid density' }).inputValue(),
      'balanced',
    );
    await clean();
    await open(onlyClock());
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
      'density changes retain enabled widgets/families or reject without dirtying; Cancel restores full grid',
    );

    const concurrent = onlyClock();
    concurrent.widgets.weather = true;
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
            placements: { weather: collision ? { column: 6 } : { row: 5 } },
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
          ? frame.style.left === '50%'
          : frame.style.top === '62.5%';
      }, collision);
      await page.mouse.up();
      if (collision) {
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
      'held drag preserves unrelated incoming placements and rejects collisions against the latest polled board',
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
      'Rain',
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
    await page.getByRole('button', { name: 'Add Photo', exact: true }).click();
    await dirty();
    await page
      .getByRole('button', { name: 'Remove Photo', exact: true })
      .click();
    await clean();
    checks.push(
      'all modules optional including independent rain and clock; styles render distinctly; add/remove returns clean',
    );

    const settings = defaultSettings();
    settings.widgets.photo = true;
    // Repack a smaller visible board to leave room for the local image.
    for (const id of ['rain', 'reminders', 'preview', 'forecast'])
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

    for (const id of ['weather', 'rain']) {
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
      'provider credit remains inside the relocating current-weather or rain widget without Forecast',
    );

    for (const id of ['weather', 'rain', 'forecast'])
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
        if (id === 'rain')
          assert.match(
            await widget.locator('.ambient-description').innerText(),
            /\bin\b/,
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
              label.text === 'Tom.' && label.full.startsWith('Tomorrow, '),
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

    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 },
    ]) {
      await open(defaultSettings(), { viewport });
      await page.goto(base + '/display');
      await page.locator('.clock-time').waitFor();
      for (let cycle = 0; cycle < 5; cycle++) {
        await page.clock.runFor(cycle ? 180000 : 1000);
        await page.clock.runFor(4000);
        await bounds();
      }
      assert.equal(await page.locator('html.standalone-display').count(), 1);
      images.push({
        label: `Grid ambient ${viewport.width}`,
        bytes: await page.screenshot({ type: 'png', animations: 'disabled' }),
      });
    }
    checks.push(
      '1080p/4K actual rendered widget bounds and pairwise non-overlap over varied compositions; standalone cursor scope',
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
