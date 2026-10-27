import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture, photoFixture } from '../../src/server/fixtures.ts';
import { mockWindowsStatus } from './lib/windows-fixture.mjs';

/** Real source browser/network flow, synthetic file only; all device/wake APIs are mocked. */
export async function runSharedSnapshotQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const root = await mkdtemp(join(tmpdir(), 'still-shared-browser-'));
  const clock = { now: Date.now(), mono: 0 };
  const app = await createApplication({ dataDirectory: join(root, 'data'), snapshotDirectory: join(root, 'cache'),
    clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), now: () => clock.now,
    preparationMonotonic: () => clock.mono, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const native = (path, method, headers = {}, body) => new Promise((done, reject) => {
    const req = request(base + path, { method, headers }, response => {
      const chunks = []; response.on('data', value => chunks.push(value));
      response.on('end', () => done({ status: response.statusCode, body: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end(body);
  });
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const images = [], checks = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
    await mockWindowsStatus(context);
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
        const sentinel = new EventTarget(); sentinel.released = false;
        sentinel.release = async () => { sentinel.released = true; sentinel.dispatchEvent(new Event('release')); }; return sentinel;
      } } });
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: () => { throw new Error('Unexpected location request'); } } });
    });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const started = page.waitForResponse(response => response.url() === base + '/api/preview/display' && response.request().postDataJSON()?.action === 'start');
    await page.goto(base + '/display');
    const presenceId = (await (await started).json()).id;
    assert.equal(await page.evaluate(async id => (await fetch('/api/preview/display', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-LRD-Display': '1' }, body: JSON.stringify({ action: 'heartbeat', id }) })).status, presenceId), 204);
    await page.getByText('Waiting for screenshot', { exact: true }).waitFor();
    assert.notEqual(await page.locator('html').evaluate(element => getComputedStyle(element).cursor), 'none');
    const paused = await (await fetch(base + '/api/preview')).json();
    assert.equal(paused.pipeline.display.paused, true, 'real browser headers establish pause before board');
    checks.push('Enabled missing image keeps the dim Last screen placeholder; real browser display pauses capture and retains pointer.');
    if (capture) images.push({ label: 'missing', png: await page.screenshot({ type: 'png' }) });

    await page.goto(base + '/');
    await page.getByRole('heading', { name: 'On your display', exact: true }).waitFor();
    for (let i = 0; i < 50 && (await (await fetch(base + '/api/preview')).json()).pipeline.display.paused; i++) await new Promise(done => setTimeout(done, 20));
    assert.equal((await (await fetch(base + '/api/preview')).json()).pipeline.display.paused, false);
    // A synthetic lost close acknowledgement leaves a pause; recovery is a real explicit Home action.
    assert.equal(await page.evaluate(async () => (await fetch('/api/preview/display', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-LRD-Display': '1' }, body: JSON.stringify({ action: 'start' }) })).status), 201);
    clock.mono += 21_000;
    await page.reload(); await page.locator('summary').filter({ hasText: /^Last screen$/ }).waitFor();
    await page.locator('summary').filter({ hasText: /^Last screen$/ }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Resume snapshots', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Snapshots resumed.' }).waitFor();
    assert.equal((await (await fetch(base + '/api/preview')).json()).pipeline.display.paused, false);
    checks.push('Real browser-generated fetch headers accept start, heartbeat, normal release and explicit Home recovery.');
    const session = await native('/api/host/session', 'GET', { 'X-LRD-Native': '1' });
    const token = JSON.parse(session.body.toString()).token, at = new Date(clock.now).toISOString();
    const pixels = Buffer.alloc((640 * 4 + 1) * 360);
    for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) {
      const offset = y * (640 * 4 + 1) + 1 + x * 4;
      const colour = y < 40 ? [180, 180, 180] : x < 210 ? [100, 150, 180] : x < 430 ? [180, 140, 90] : [110, 170, 130];
      pixels.set([...colour, 255], offset);
    }
    const png = photoFixture(640, 360, pixels);
    assert.equal((await native('/api/preview', 'POST', { 'X-LRD-Token': token, 'Content-Type': 'image/png', 'X-Captured-At': at }, png)).status, 201);
    await page.goto(base + '/display');
    await page.locator('.preview-image').waitFor();
    await page.waitForFunction(() => { const image = document.querySelector('.preview-image'); return image?.complete && image.naturalWidth === 640; });
    assert.equal(await page.locator('.preview-caption').count(), 1);
    const browserBytes = await page.evaluate(async () => [...new Uint8Array(await (await fetch(document.querySelector('.preview-image').src)).arrayBuffer())]);
    assert.deepEqual(Buffer.from(browserBytes), png, 'actual origin-less same-origin browser GET reads the canonical PNG');
    assert.equal(await page.locator('.preview-image').evaluate(image => {
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 1, 1); return context.getImageData(0, 0, 1, 1).data[3];
    }), 255, 'the visual fixture must actually paint opaque pixels');
    checks.push('Shared renderer loads the exact canonical synthetic PNG and capture caption through the real same-origin browser GET.');
    if (capture) images.push({ label: 'saved', png: await page.screenshot({ type: 'png' }) });
    await page.keyboard.press('f'); await page.waitForFunction(() => document.fullscreenElement !== null);
    assert.notEqual(await page.locator('html').evaluate(element => getComputedStyle(element).cursor), 'none');
    await page.keyboard.press('f'); await page.waitForFunction(() => document.fullscreenElement === null);
    checks.push('F toggles headless browser presentation and keeps the pointer visible; wake-lock is mocked.');
    assert.deepEqual(errors, []);
    return { checks, images };
  } finally {
    await browser.close(); app.closePreparation(); app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')));
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runSharedSnapshotQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks, images: 'RAM only when explicitly requested through the exported QA function.' }, null, 2));
}
