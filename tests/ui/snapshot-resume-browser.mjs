// #556: real source HTTP recovery, synthetic state/devices, no display or capture operations.
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
import { keepPagesLocal } from './lib/local-only.mjs';
import { mockScreenWakeLock } from './lib/windows-fixture.mjs';

export async function runSnapshotResumeQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const root = await mkdtemp(join(tmpdir(), 'lrd-snapshot-resume-'));
  const clock = { mono: 0 };
  const app = await createApplication({ dataDirectory: join(root, 'data'), snapshotDirectory: join(root, 'cache'),
    clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)),
    preparationMonotonic: () => clock.mono, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const setupAction = async action => {
    const response = await fetch(base + '/api/preview/display', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-LRD-Display': '1', Origin: base,
      'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty',
    }, body: JSON.stringify(action) });
    assert.ok(response.ok); await response.arrayBuffer();
  };
  const paused = async () => (await (await fetch(base + '/api/preview')).json()).pipeline.display.paused;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  let context, page, sent = [];
  const details = () => page.locator('details.home-card-waiting');
  const trigger = () => details().locator(':scope > button');
  const dialog = () => page.getByRole('dialog', { name: 'Resume snapshots?', exact: true });
  const confirm = () => dialog().getByRole('button', { name: 'Resume snapshots', exact: true });
  async function open(viewport = { width: 1280, height: 720 }) {
    await context?.close();
    await setupAction({ action: 'resume', confirmedAllClosed: true });
    await setupAction({ action: 'start' }); clock.mono += 21_000;
    context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await keepPagesLocal(context, base); await mockScreenWakeLock(context);
    page = await context.newPage(); sent = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async native => { errors.push(`Unexpected browser-native ${native.type()} dialog`); await native.dismiss(); });
    page.on('request', request => {
      if (request.url() === base + '/api/preview/display' && request.postDataJSON()?.action === 'resume') sent.push(request);
    });
    await page.clock.install();
    await page.goto(base); await details().locator('summary').click(); await trigger().waitFor();
  }
  async function show() { await trigger().click(); await dialog().waitFor(); }
  async function closed() { await dialog().waitFor({ state: 'detached' }); }
  async function inView(locator) {
    const box = await locator.boundingBox(), view = page.viewportSize();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width + 1 && box.y + box.height <= view.height + 1, JSON.stringify(box));
  }
  try {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 320, height: 480 }, { width: 640, height: 300 }]) {
      await open(viewport); await show();
      await inView(dialog()); await inView(confirm());
      const cancel = dialog().getByRole('button', { name: 'Cancel', exact: true });
      assert.equal(await cancel.evaluate(element => element === document.activeElement), true);
      assert.match(await dialog().innerText(), /Close every browser display before resuming desktop snapshots/);
      await trigger().evaluate(element => element.focus());
      assert.equal(await dialog().evaluate(element => element.contains(document.activeElement)), true, 'background remains inert');
      for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert.equal(await dialog().evaluate(element => element.contains(document.activeElement)), true); }
      if (capture) images.push({ name: `confirm-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
      await cancel.focus(); await page.keyboard.press('Enter'); await closed();
      assert.equal(await trigger().evaluate(element => element === document.activeElement), true);
      await show(); await page.keyboard.press('Escape'); await closed();
      await show(); await dialog().getByRole('button', { name: 'Close snapshot confirmation' }).click(); await closed();
      await show(); await page.mouse.click(4, 4); await closed();
      assert.equal(sent.length, 0); assert.equal(await paused(), true);
      checks.push(`${viewport.width}×${viewport.height}: labelled modal, initial Cancel, Tab containment, inert background, Cancel/Enter/Escape/Close/backdrop send nothing and return focus`);
    }
    await open(); await show();
    let finish, ready;
    const gate = new Promise(resolve => { finish = resolve; });
    const started = new Promise(resolve => { ready = resolve; });
    await page.route('**/api/preview/display', async route => { ready(); await gate; await route.continue(); });
    await confirm().evaluate(element => { element.click(); element.click(); }); await started;
    await dialog().getByRole('status').filter({ hasText: 'Resuming snapshots' }).waitFor();
    assert.equal(sent.length, 1, 'same-turn activation sends only one POST');
    assert.equal(await confirm().getAttribute('aria-disabled'), 'true');
    await page.keyboard.press('Escape'); await closed();
    await trigger().evaluate(element => element.click());
    assert.equal(await dialog().count(), 0, 'pending dismissal cannot reopen or duplicate the request');
    assert.equal(await trigger().getAttribute('aria-disabled'), 'true');
    finish(); await details().getByRole('status').filter({ hasText: 'Snapshots resumed.' }).waitFor();
    assert.equal(sent.length, 1); assert.deepEqual(sent[0].postDataJSON(), { action: 'resume', confirmedAllClosed: true });
    assert.equal(sent[0].headers()['x-lrd-display'], '1'); assert.equal(await paused(), false);
    checks.push('same-turn double activation and pending dismissal keep one explicit authorized resume request');

    await open(); await show();
    let fail = true;
    await page.route('**/api/preview/display', route => fail ? route.fulfill({ status: 503, json: { error: 'Synthetic refusal' } }) : route.continue());
    await confirm().click(); await dialog().getByRole('alert').waitFor();
    assert.equal(await paused(), true); assert.equal(await confirm().getAttribute('aria-disabled'), null);
    assert.equal(await dialog().evaluate(element => element.contains(document.activeElement)), true);
    if (capture) images.push({ name: 'resume-error', bytes: await page.screenshot() });
    fail = false; await confirm().click(); await closed();
    await details().getByRole('status').filter({ hasText: 'Snapshots resumed.' }).waitFor();
    assert.equal(sent.length, 2); assert.equal(await paused(), false);
    assert.equal(await details().locator('summary').evaluate(element => element === document.activeElement), true, 'success focuses Last screen when its opener disappears');
    checks.push('failed POST stays retryable with visible focus; explicit retry succeeds and focuses the summary');

    await open(); await show();
    let posted = false;
    page.on('request', request => { if (request.url() === base + '/api/preview/display') posted = true; });
    await page.route('**/api/preview', route => posted ? route.abort() : route.continue());
    await confirm().click(); await closed();
    await details().getByRole('status').filter({ hasText: 'Snapshots resumed.' }).waitFor();
    await page.clock.runFor(10_000);
    assert.equal(sent.length, 1); assert.equal(await trigger().count(), 0);
    assert.equal(await details().getByText('Could not resume snapshots. Try again.', { exact: true }).count(), 0);
    checks.push('successful POST stays successful and cannot resubmit when status refresh fails');

    await open(); await show();
    let releaseOld, heldReady, first = true, oldRequest;
    const oldGate = new Promise(resolve => { releaseOld = resolve; });
    const held = new Promise(resolve => { heldReady = resolve; });
    await page.route('**/api/preview', async route => {
      if (!first) return route.continue();
      first = false; oldRequest = route.request();
      const response = await route.fetch(), json = await response.json();
      heldReady(); await oldGate; await route.fulfill({ response, json });
    });
    await page.clock.runFor(5_000); await held;
    await confirm().click(); await closed(); await details().getByRole('status').filter({ hasText: 'Snapshots resumed.' }).waitFor();
    const oldFinished = page.waitForEvent('requestfinished', { predicate: request => request === oldRequest });
    releaseOld(); await oldFinished; await page.clock.runFor(100);
    assert.equal(await trigger().count(), 0); assert.equal(await paused(), false); assert.equal(sent.length, 1);
    checks.push('a pre-submit status response arriving after success cannot restore stale Resume controls');

    await open(); await show();
    await setupAction({ action: 'resume', confirmedAllClosed: true }); await page.clock.runFor(5_000);
    await trigger().waitFor({ state: 'detached' });
    assert.equal(await dialog().count(), 1, 'polling does not unmount an open confirmation');
    await page.keyboard.press('Escape'); await closed();
    assert.equal(await details().locator('summary').evaluate(element => element === document.activeElement), true);
    assert.equal(sent.length, 0);
    checks.push('remote recovery preserves the open confirmation and supplies a logical focus fallback on dismissal');
    assert.deepEqual(errors, []);
    return { checks, images };
  } finally {
    await context?.close(); await browser.close(); app.closePreparation();
    app.server.closeAllConnections(); const stopped = once(app.server, 'close'); app.server.close(); await stopped;
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')));
    await rm(root, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runSnapshotResumeQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks }, null, 2));
}
