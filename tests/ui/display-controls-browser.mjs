// Synthetic manual-display controls only; no desktop, installed app or native host.
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

export async function runDisplayControlsQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-display-controls-'));
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-10-18T13:00:00Z') });
    const open = async (path = '/display') => { await page.goto(base + path); await page.locator(path === '/editor' ? '.preview-surface' : '.display-page').waitFor(); };
    const interacting = () => page.locator('.display-page').evaluate(el => el.classList.contains('interacting'));
    const controls = page.getByRole('navigation', { name: 'Display controls' });
    const opacity = () => controls.evaluate(el => Number(getComputedStyle(el).opacity));

    await open(); assert.equal(await opacity(), 0);
    await page.mouse.move(200, 200); await page.clock.runFor(2500);
    await page.mouse.move(250, 220); await page.clock.runFor(2500);
    assert.equal(await interacting(), true, 'Pointer activity restarts the idle deadline instead of hiding after the first movement');
    assert.equal(await opacity(), 1);
    if (capture) images.push({ name: 'ongoing-pointer-controls', bytes: await page.screenshot() });
    await page.clock.runFor(800); assert.equal(await opacity(), 1);
    await page.clock.runFor(300); assert.equal(await interacting(), false); assert.equal(await opacity(), 0);
    checks.push('Pointer controls remain visible for the full interval after the latest activity and hide after inactivity');

    const tabSignal = () => page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    await tabSignal(); await page.clock.runFor(2500); await tabSignal(); await page.clock.runFor(2500);
    assert.equal(await interacting(), true, 'Repeated keyboard activity refreshes the same deadline');
    await controls.getByRole('button', { name: 'Fullscreen' }).focus(); await page.clock.runFor(4000);
    assert.equal(await interacting(), false); assert.equal(await opacity(), 1, 'Focused controls stay visible after idle timeout');
    if (capture) images.push({ name: 'focused-controls-after-idle', bytes: await page.screenshot() });
    await page.locator('body').evaluate(el => { el.tabIndex = -1; el.focus(); }); assert.equal(await opacity(), 0);
    checks.push('Keyboard activity refreshes the deadline; focus remains visible without moving focus on timeout');

    await page.mouse.move(300, 250); await open('/editor'); await page.clock.runFor(4000);
    assert.equal(await page.locator('.display-help').count(), 0);
    await open('/display?native=1'); assert.equal(await controls.count(), 0);
    await page.mouse.move(350, 280); await tabSignal(); await page.clock.runFor(4000);
    assert.equal(await controls.count(), 0); assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).cursor), 'none');
    assert.deepEqual(errors, []);
    checks.push('Editor/navigation and explicit native presentation retain their existing control exclusions; no native helper or fullscreen launch');
    return { checks, images };
  } finally { await browser.close(); await new Promise(resolve => app.server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runDisplayControlsQa(values); console.log(JSON.stringify({ checks: result.checks }, null, 2));
}
