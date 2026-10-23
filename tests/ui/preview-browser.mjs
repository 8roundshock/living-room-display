// Production preview optics and lifecycle: synthetic desktop PNG, RAM screenshots only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { repackGrid } from '../../src/shared/widgets.ts';

export async function runPreviewQa({ playwright, edge, sharp } = {}) {
  const require = createRequire(import.meta.url),
    { chromium } = require(playwright ?? 'playwright'),
    decode = require(sharp ?? 'sharp');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-preview-'));
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
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    reducedMotion: 'reduce',
  });
  await context.route('**/api/windows/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: false, selectedScreenSaver: null, active: null, timeoutSeconds: null, secure: null, isLivingRoomDisplay: false, power: { available: false, scheme: null, displayOffSeconds: null, sleepSeconds: null } }) }));
  const page = await context.newPage(),
    errors = [],
    checks = [],
    images = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.clock.install({ time: new Date(now) });
  function native(path, method, headers, body) {
    return new Promise((resolve, reject) => {
      const req = request(base + path, { method, headers }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, body: Buffer.concat(chunks) }),
        );
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  async function settings({
    size = 'medium',
    density = 'balanced',
    opacity = 0.24,
    widthPercent = 20,
    brightness = 0.55,
  } = {}) {
    const s = defaultSettings();
    for (const id of Object.keys(s.widgets)) s.widgets[id] = id === 'preview';
    s.widgetGrid = repackGrid(s.widgetGrid, density, s.widgets);
    s.widgetGrid.placements.preview = { column: 0, row: 0, size };
    s.preview.opacity = opacity;
    s.preview.widthPercent = widthPercent;
    s.appearance.brightness = brightness;
    await app.store.update((d) => {
      d.settings = s;
    });
  }
  async function open() {
    await page.goto(base + '/display');
    await page.locator('.preview-image').waitFor();
    await page.waitForFunction(
      () => document.querySelector('.preview-image')?.naturalWidth === 640,
    );
    await page.clock.runFor(200);
  }
  async function opticalSamples() {
    const rect = await page.locator('.preview-image').evaluate((e) => {
      const r = e.getBoundingClientRect(),
        width = Math.min(
          r.width,
          (r.height * e.naturalWidth) / e.naturalHeight,
        ),
        height = (width * e.naturalHeight) / e.naturalWidth;
      return {
        x: r.x + (r.width - width) / 2,
        y: r.y + (r.height - height) / 2,
        width,
        height,
        boxWidth: r.width,
        regionWidth: e.closest('.ambient-widget').getBoundingClientRect().width,
        // #225: the image takes the cell's limiting dimension, with its caption below it (the frame
        // keeps 0.15em of the caption size free for the text's overflow).
        fillsCell:
          width >= e.closest('.snapshot-body').getBoundingClientRect().width - 1 ||
          e.closest('.ambient-widget').querySelector('.preview-caption').getBoundingClientRect().bottom >=
            e.closest('.snapshot-body').getBoundingClientRect().bottom -
              parseFloat(getComputedStyle(e.closest('.ambient-widget').querySelector('.preview-caption')).fontSize) * 0.15 - 1.5,
      };
    });
    const shot = await decode(
      await page.screenshot({ type: 'png', animations: 'disabled' }),
    )
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sample = (sourceX) => {
      const x = Math.floor(rect.x + (sourceX / 640) * rect.width),
        y = Math.floor(rect.y + (15 / 360) * rect.height),
        offset = (y * shot.info.width + x) * shot.info.channels;
      return [...shot.data.subarray(offset, offset + 3)];
    };
    return {
      ...rect,
      black: sample(40),
      dark: sample(280),
      middle: sample(440),
      white: sample(600),
    };
  }
  try {
    const source = Buffer.from(
      await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 640;
        c.height = 360;
        const g = c.getContext('2d');
        g.fillStyle = '#000';
        g.fillRect(0, 0, 640, 360);
        [0, 8, 16, 32, 64, 128, 192, 255].forEach((v, i) => {
          g.fillStyle = `rgb(${v},${v},${v})`;
          g.fillRect(i * 80, 0, 80, 32);
        });
        g.fillStyle = '#242933';
        g.fillRect(20, 52, 380, 280);
        g.fillStyle = '#4b5361';
        g.fillRect(20, 52, 380, 28);
        g.fillStyle = '#bdc7d7';
        g.font = '14px sans-serif';
        g.fillText('SYNTHETIC NOTES', 34, 72);
        g.fillStyle = '#999fab';
        g.font = '18px sans-serif';
        g.fillText('Weekend plans', 40, 115);
        g.fillStyle = '#626a78';
        g.font = '12px sans-serif';
        for (let i = 0; i < 6; i++)
          g.fillText('A quiet synthetic line of local text', 40, 145 + i * 24);
        g.fillStyle = '#171c26';
        g.fillRect(420, 82, 200, 250);
        g.fillStyle = '#3c4654';
        g.fillRect(420, 82, 200, 28);
        g.fillStyle = '#a6b2c5';
        g.fillText('SYNTHETIC PLAYER', 435, 101);
        g.fillStyle = '#71869f';
        g.fillRect(438, 130, 164, 95);
        g.fillStyle = '#abb3c2';
        g.fillRect(438, 250, 115, 4);
        return c.toDataURL('image/png').split(',')[1];
      }),
      'base64',
    );
    const session = await native('/api/host/session', 'GET', {
      'X-LRD-Native': '1',
    });
    assert.equal(session.status, 200);
    const token = JSON.parse(session.body.toString()).token;
    const upload = async () => {
      const r = await native(
        '/api/preview',
        'POST',
        {
          'X-LRD-Token': token,
          'Content-Type': 'image/png',
          'X-Captured-At': new Date(now).toISOString(),
        },
        source,
      );
      assert.equal(r.status, 201);
    };
    await upload();
    const raw = await fetch(base + '/api/preview/image');
    assert.equal(raw.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await raw.arrayBuffer()), source);
    checks.push(
      'native-token synthetic PNG remains byte-for-byte unchanged in RAM/no-store endpoint',
    );

    for (const density of ['spacious', 'balanced', 'fine'])
      for (const size of ['small', 'medium', 'large']) {
        await settings({ size, density });
        await open();
        const samples = await opticalSamples();
        assert.deepEqual(samples.black, [0, 0, 0]);
        assert.ok(
          samples.white.every((v) => v >= 32 && v <= 35),
          JSON.stringify(samples),
        );
        assert.ok(
          samples.middle.every((v) => v >= 20 && v < samples.white[0]),
          JSON.stringify(samples),
        );
        assert.ok(
          samples.dark.every((v) => v >= 8 && v < samples.middle[0]),
          JSON.stringify(samples),
        );
        assert.ok(samples.fillsCell, JSON.stringify(samples));
        await settings({ size, density, widthPercent: 35 });
        await open();
        const changedLegacyWidth = await opticalSamples();
        assert.ok(
          Math.abs(changedLegacyWidth.width - samples.width) < 1,
          'legacy width no longer shrinks grid family',
        );
        if (density === 'balanced')
          images.push({
            label: `Dim snapshot ${size}`,
            bytes: await page.screenshot({
              type: 'png',
              animations: 'disabled',
            }),
          });
      }
    checks.push(
      'all families/densities: true black source stays black, midtones remain recognizable and white peaks stay capped; legacy width does not shrink grid',
    );

    const levels = [];
    for (const opacity of [0.02, 0.08, 0.24, 0.3]) {
      await settings({ opacity });
      await open();
      const samples = await opticalSamples();
      levels.push(samples.white[0]);
      assert.deepEqual(samples.black, [0, 0, 0]);
    }
    assert.ok(levels.every((v, i) => i === 0 || v > levels[i - 1]));
    assert.ok(levels.at(-1) <= 43);
    assert.equal(app.store.snapshot().settings.preview.opacity, 0.3);
    checks.push(
      'opacity remains effective and bounded from2–30%; no hidden minimum overrides a customized value',
    );

    // Native colours (#75) must not light the panel more than one accent colour.
    // #220: every mode is shown at the same clock minute (identical digits and ages), and each
    // measurement waits until the lit board has revealed and settled: weather and forecast show
    // their fixture values, fonts and images are ready, nothing but loops is running, every widget
    // has settled. Two consecutive measurements must agree before modes are compared, so a
    // half-rendered frame cannot read as a palette difference.
    async function settledBoard() {
      for (let attempt = 0; attempt < 200; attempt++) {
        const ready = await page.evaluate(async () => {
          await document.fonts.ready;
          const plane = document.querySelector('.widget-grid-plane');
          if (!plane || plane.classList.contains('fading') || plane.classList.contains('revealing')) return false;
          if (!/\d°/.test(plane.querySelector('.ambient-weather .current-temperature')?.textContent ?? '')) return false;
          if (!plane.querySelector('.ambient-forecast .forecast-day')) return false;
          for (const image of plane.querySelectorAll('img')) {
            if (!image.complete || !image.naturalWidth) return false;
            await image.decode();
          }
          if (document.getAnimations().some((running) => running.playState === 'running' && running.effect?.getTiming().iterations !== Infinity)) return false;
          return [...plane.querySelectorAll('.ambient-widget')].every((widget) => widget.dataset.settled === 'true');
        });
        if (ready) return;
        await page.waitForTimeout(25);
      }
      throw new Error('the lit board never settled');
    }
    async function luminance() {
      const shot = await decode(
        await page.screenshot({ type: 'png', animations: 'disabled' }),
      )
        .raw()
        .toBuffer({ resolveWithObject: true });
      const linear = (v) =>
        v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
      let max = 0,
        sum = 0,
        count = 0;
      for (let i = 0; i < shot.data.length; i += shot.info.channels) {
        const [r, g, b] = shot.data.subarray(i, i + 3);
        if (!r && !g && !b) continue;
        const y = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
        max = Math.max(max, y);
        sum += y;
        count++;
      }
      assert.deepEqual([...shot.data.subarray(0, 3)], [0, 0, 0]);
      return { max, mean: sum / count };
    }
    const agree = (a, b) =>
      Math.abs(a.max - b.max) <= b.max * 0.005 &&
      Math.abs(a.mean - b.mean) <= b.mean * 0.005;
    const sameMinute = await page.evaluate(() => Date.now() - (Date.now() % 60_000) + 61_000);
    const luminanceLevels = {};
    for (const brightness of [0.55, 0.28]) {
      for (const accentMode of ['color', 'native']) {
        const s = defaultSettings();
        Object.assign(s.appearance, { accentMode, brightness, motionEnabled: false });
        await app.store.update((d) => {
          d.settings = s;
        });
        await page.clock.setSystemTime(sameMinute);
        await open();
        // #330: agreement is tracked explicitly. `previous` and `measured` stay two distinct
        // measurements, so a board that never settles fails here and not at the parity check below.
        let previous = null,
          measured = null,
          agreed = false;
        for (let attempt = 0; attempt < 6; attempt++) {
          await settledBoard();
          if (measured) previous = measured;
          measured = await luminance();
          if (previous && agree(previous, measured)) {
            agreed = true;
            break;
          }
        }
        assert.ok(
          agreed,
          `${accentMode} at ${brightness}: two consecutive settled measurements agree within 0.5% (the last two of 6: ${JSON.stringify([previous, measured])})`,
        );
        luminanceLevels[`${accentMode}-${brightness}`] = measured;
      }
      const color = luminanceLevels[`color-${brightness}`],
        native = luminanceLevels[`native-${brightness}`];
      assert.ok(
        Math.abs(native.max - color.max) / color.max <= 0.05 &&
          Math.abs(native.mean - color.mean) / color.mean <= 0.05,
        `native luminance parity at ${brightness}: ${JSON.stringify(luminanceLevels)}`,
      );
    }
    checks.push(
      'native default composition keeps max/mean lit-pixel luminance within 5% of color mode at 55% and 28% brightness, each from two agreeing measurements of the settled board at one clock minute; exact black kept',
    );

    await settings();
    await page.goto(base + '/editor');
    await page.getByRole('tab', { name: 'Widgets', exact: true }).click();
    await page
      .getByRole('button', { name: 'Last screen', exact: true })
      .click();
    const slider = page.getByRole('slider', {
      name: 'Snapshot opacity',
      exact: true,
    });
    assert.equal(await slider.inputValue(), '24');
    await slider.fill('8');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    assert.equal(await slider.inputValue(), '24');
    await slider.fill('8');
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    await page.reload();
    await page.getByRole('tab', { name: 'Widgets', exact: true }).click();
    await page
      .getByRole('button', { name: 'Last screen', exact: true })
      .click();
    assert.equal(await slider.inputValue(), '8');
    checks.push(
      'new24% default and explicit8% saved preference survive Save/Cancel/reload without migration override',
    );

    const exported = JSON.stringify(
      await (await fetch(base + '/api/export')).json(),
    );
    assert.ok(!exported.includes(source.toString('base64')));
    for (const name of await readdir(directory))
      assert.ok(
        !(await readFile(join(directory, name), 'utf8')).includes(
          source.toString('base64'),
        ),
      );
    await page
      .getByRole('button', { name: 'Remove Last screen', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    assert.equal((await fetch(base + '/api/preview/image')).status, 404);
    await page.goto(base + '/display');
    assert.equal(await page.locator('.preview-image').count(), 0);
    checks.push(
      'RAM snapshot excluded from saved state/export and removing widget clears the endpoint',
    );
    assert.deepEqual(errors, []);
    return { checks, images, levels };
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
    options: {
      playwright: { type: 'string' },
      edge: { type: 'string' },
      sharp: { type: 'string' },
    },
  });
  const result = await runPreviewQa(values);
  console.log(
    JSON.stringify(
      {
        passed: result.checks.length,
        checks: result.checks,
        whiteLevels: result.levels,
        images: 'RAM only; actual visual inspection remains separate.',
      },
      null,
      2,
    ),
  );
}
