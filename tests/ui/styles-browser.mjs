// Top-of-editor style transactions with synthetic settings and a private loopback server.
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
import { getVisual } from '../../src/client/model.ts';
import { keepPagesLocal } from './lib/local-only.mjs';

export async function runStylesQa({ playwright, edge, capture = false } = {}) {
  const startedAt = Date.now();
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-styles-'));
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  checks.push = (...items) => { for (const item of items) console.log(`PASS: ${item}`); return Array.prototype.push.apply(checks, items); };
  let context, page;
  const button = name => page.getByRole('button', { name, exact: true });
  const choice = () => page.getByRole('combobox', { name: 'Style', exact: true });
  const brightness = () => page.getByRole('slider', { name: 'Brightness', exact: true });
  const saved = () => app.store.snapshot().settings;
  async function clean() { await page.locator('.studio-savebar').waitFor({ state: 'detached' }); }
  async function nudge() { await brightness().focus(); await page.keyboard.press('ArrowLeft'); return Number(await brightness().inputValue()) / 100; }
  function settings() {
    const value = defaultSettings();
    const second = getVisual(value); second.appearance.brightness = 0.3;
    value.savedPresets = [{ id: 'alpha:imported/id', name: 'Evening', visual: getVisual(value) }, { id: 'beta', name: 'Reading', visual: second }];
    return value;
  }
  async function open(value = settings(), options = {}, controlledClock = false) {
    await context?.close();
    await app.store.update(data => { data.settings = structuredClone(value); data.reminders = []; });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce', ...options });
    await keepPagesLocal(context, base);
    await context.route('**/api/windows/status', route => route.fulfill({ json: { available: false, isLivingRoomDisplay: false, power: { available: false } } }));
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    // Install before the app creates its polling interval, not after mounting it.
    if (controlledClock) await page.clock.install();
    await page.goto(base + '/editor'); await choice().waitFor();
    await page.getByRole('tab', { name: 'Style', exact: true }).click();
  }
  async function select(id) { await choice().selectOption(`saved:${id}`); }
  try {
    await open(); await select('alpha:imported/id');
    const manage = () => page.locator('.style-management');
    const manageTrigger = () => page.locator('#manage-style-trigger');
    const isManaged = () => manage().evaluate(element => element.open);
    for (let cycle = 0; cycle < 3; cycle++) {
      await manageTrigger().click(); assert.equal(await isManaged(), true);
      await page.locator('.style-management > div').click({ position: { x: 4, y: 20 } });
      assert.equal(await isManaged(), true, 'inside padding does not dismiss the panel');
      await button('Rename').focus(); await page.keyboard.press('Tab');
      assert.equal(await button('Delete style…').evaluate(element => element === document.activeElement), true);
      assert.equal(await isManaged(), true, 'internal keyboard navigation stays open');
      await page.getByRole('heading', { name: 'Your display', exact: true }).click();
      assert.equal(await isManaged(), false, 'outside non-control clicks dismiss repeatedly');
    }
    await manageTrigger().click(); await brightness().click();
    assert.equal(await isManaged(), false);
    assert.equal(await brightness().evaluate(element => element === document.activeElement), true, 'outside pointer dismissal preserves destination focus');
    await manageTrigger().click(); await button('Delete style…').focus(); await page.keyboard.press('Tab');
    assert.equal(await isManaged(), false, 'tabbing to the next control dismisses');
    assert.equal(await manageTrigger().evaluate(element => element === document.activeElement), false, 'focus leaving the panel is not redirected');
    await manageTrigger().focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
    assert.equal(await button('Rename').evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Escape'); assert.equal(await isManaged(), false);
    assert.equal(await manageTrigger().evaluate(element => element === document.activeElement), true, 'Escape returns to the disclosure trigger');
    await page.keyboard.press('Space'); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    assert.equal(await isManaged(), true, 'returning to the summary stays inside the disclosure');
    await page.keyboard.press('Shift+Tab'); assert.equal(await isManaged(), false, 'backward tabbing out dismisses');
    checks.push('Manage style repeatedly dismisses on outside clicks or focus changes, preserves internal navigation and destination focus, and returns focus on Escape');

    await manageTrigger().click(); await button('About styles').click();
    assert.equal(await isManaged(), false); await page.getByRole('tooltip').waitFor();
    await page.keyboard.press('Escape'); await page.getByRole('tooltip').waitFor({ state: 'detached' });
    assert.equal(await button('About styles').evaluate(element => element === document.activeElement), true);
    await manageTrigger().click(); await button('Rename').click();
    await page.getByRole('textbox', { name: 'Style name', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Style name', exact: true }).evaluate(element => element === document.activeElement), true);
    await button('Keep editing').click();
    await manageTrigger().click(); await button('Delete style…').click();
    assert.equal(await isManaged(), false);
    assert.equal(await button('Keep style').evaluate(element => element === document.activeElement), true);
    await manageTrigger().click(); await page.keyboard.press('Escape');
    assert.equal(await isManaged(), false);
    assert.equal(await page.getByRole('group', { name: 'Delete style', exact: true }).count(), 1, 'menu Escape does not dismiss the separate confirmation');
    await button('Keep style').focus(); await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('group', { name: 'Delete style', exact: true }).count(), 0);
    assert.equal(await manageTrigger().evaluate(element => element === document.activeElement), true);
    await manageTrigger().click(); await button('Delete style…').click(); await button('Keep style').click();
    assert.equal(await manageTrigger().evaluate(element => element === document.activeElement), true);
    assert.equal(saved().savedPresets.length, 2, 'dismissal and cancelled confirmation never delete a style');
    checks.push('Manage actions retain rename focus and safe delete confirmation; Escape is scoped to the active disclosure, confirmation or help');

    await open(settings(), { viewport: { width: 390, height: 700 }, hasTouch: true }); await select('alpha:imported/id');
    await manageTrigger().tap(); assert.equal(await isManaged(), true);
    await page.getByRole('tab', { name: 'Widgets', exact: true }).tap(); assert.equal(await isManaged(), false);
    await manageTrigger().tap(); assert.equal(await isManaged(), true);
    await button('Add widget to display').tap(); assert.equal(await isManaged(), false);
    await page.keyboard.press('Escape');
    await page.locator('.widget-picker').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Add widget to display');
    assert.equal(await button('Add widget to display').evaluate(element => element === document.activeElement), true, 'picker keeps its own Escape/focus behavior');
    checks.push('Touch dismissal permits switching editor controls and opening a picker whose Escape behavior remains independent');

    await open();
    assert.equal(await choice().inputValue(), '');
    assert.equal(await page.locator('.preset-list').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Phone', exact: true }).count(), 0);
    await select('alpha:imported/id'); const updated = await nudge();
    assert.equal(await page.getByText('Modified', { exact: true }).count(), 1);
    await button('Save changes').click(); await clean();
    assert.equal(saved().savedPresets[0].id, 'alpha:imported/id');
    assert.equal(saved().savedPresets[0].visual.appearance.brightness, updated);
    await page.reload(); await choice().waitFor(); assert.equal(await choice().inputValue(), 'saved:alpha:imported/id');
    await page.getByRole('tab', { name: 'Style', exact: true }).click();
    const original = structuredClone(saved().savedPresets[0]);
    const next = await nudge(); await button('Save as new…').click();
    await page.getByRole('textbox', { name: 'New style', exact: true }).fill('  evening  ');
    assert.equal(await button('Save new style').getAttribute('aria-disabled'), 'true');
    assert.match(await page.locator('#preset-name-error').innerText(), /already exists/);
    await page.getByRole('textbox', { name: 'New style', exact: true }).fill('Cinema');
    await button('Save new style').click(); await clean();
    assert.deepEqual(saved().savedPresets[0], original);
    const added = saved().savedPresets.find(item => item.name === 'Cinema');
    assert.ok(added && added.id !== original.id); assert.equal(added.visual.appearance.brightness, next);
    await page.reload(); await choice().waitFor(); assert.equal(await choice().inputValue(), `saved:${added.id}`);
    checks.push('Top selector and one Save group; stable update ID; duplicate validation; Save as new preserves original; explicit identity and saved visual survive reload');

    await open(); await select('alpha:imported/id'); const dirtyValue = await nudge();
    await select('beta'); await page.getByRole('group', { name: 'Switch style' }).waitFor();
    await button('Keep editing').click(); assert.equal(Number(await brightness().inputValue()) / 100, dirtyValue);
    await select('beta'); await button('Discard and switch').click(); assert.equal(Number(await brightness().inputValue()) / 100, 0.3);
    await button('Save changes').click(); await clean();
    assert.equal(saved().appearance.brightness, 0.3); assert.equal(saved().savedPresets[1].visual.appearance.brightness, 0.3);
    await nudge(); await select('alpha:imported/id');
    let reject = true;
    await page.route('**/api/settings', route => route.request().method() === 'PATCH' && reject ? route.fulfill({ status: 503, json: { error: 'Synthetic save refusal' } }) : route.continue());
    await button('Save and switch').click(); await page.getByText('Synthetic save refusal', { exact: true }).waitFor();
    assert.equal(await choice().inputValue(), 'saved:beta'); assert.equal(await page.getByRole('group', { name: 'Switch style' }).count(), 1);
    reject = false; await button('Save and switch').click();
    await page.waitForFunction(() => document.querySelector('#saved-style-select').value === 'saved:alpha:imported/id');
    assert.equal(saved().appearance.brightness, 0.29, 'saved old draft before switching');
    assert.equal(Number(await brightness().inputValue()) / 100, 0.55, 'new choice is an explicit unsaved display draft');
    await button('Cancel').click(); await clean();
    checks.push('Dirty switching keeps or explicitly discards visual edits; failed Save-and-switch stays put; retry saves before switching; Cancel restores saved display');

    await open(); await select('alpha:imported/id'); const submittedValue = await nudge();
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    await page.route('**/api/settings', async route => { if (route.request().method() === 'PATCH') { entered(); await gate; } await route.continue(); });
    await button('Save changes').click(); await started;
    const later = await nudge(); assert.equal(await choice().isDisabled(), true, 'save target cannot be retargeted during request');
    release(); await page.waitForFunction(() => !document.querySelector('#saved-style-select').disabled);
    assert.equal(saved().savedPresets[0].visual.appearance.brightness, submittedValue);
    assert.equal(Number(await brightness().inputValue()) / 100, later); assert.equal(await page.locator('.studio-savebar').count(), 1);
    await button('Cancel').click(); await clean();
    checks.push('In-flight save retains its captured target and snapshot; later visual edits survive the acknowledgement');

    await open(); await select('alpha:imported/id'); await nudge();
    let retryCount = 0;
    await page.route('**/api/settings', async route => {
      if (route.request().method() === 'PATCH' && ++retryCount === 1)
        await app.store.update(data => { data.settings.appearance.clockStyle = 'digital'; });
      await route.continue();
    });
    await button('Save changes').click(); await clean();
    assert.equal(retryCount, 2); assert.equal(saved().appearance.clockStyle, 'digital');
    assert.equal(saved().savedPresets[0].visual.appearance.clockStyle, 'digital');
    assert.equal(await page.locator('.studio-savebar').count(), 0);
    checks.push('409 retry merges an untouched remote visual field into both display and style snapshot without leaving generated metadata dirty');

    for (const mode of ['update', 'rename']) {
      await open(); await select('alpha:imported/id'); const before = structuredClone(saved().savedPresets[0]); const value = await nudge();
      if (mode === 'rename') {
        await page.locator('.style-management > summary').click(); await button('Rename').click();
        await page.getByRole('textbox', { name: 'Style name', exact: true }).fill('Failed rename');
      }
      let refused = true;
      await page.route('**/api/settings', route => route.request().method() === 'PATCH' && refused ? route.fulfill({ status: 503, json: { error: 'Synthetic refused update' } }) : route.continue());
      await button('Save changes').click(); await page.getByText('Synthetic refused update', { exact: true }).waitFor();
      await button('Save as new\u2026').click(); await page.getByRole('textbox', { name: 'New style', exact: true }).fill('Recovered new');
      refused = false; await button('Save new style').click(); await clean();
      assert.deepEqual(saved().savedPresets[0], before, `${mode}: original unchanged after failure then Save as new`);
      assert.equal(saved().savedPresets.find(item => item.name === 'Recovered new').visual.appearance.brightness, value);
    }
    checks.push('Failed selected update and failed rename followed by Save as new preserve the original record byte-for-byte');

    for (const mode of ['new', 'rename']) {
      await open(); await select('alpha:imported/id'); const before = structuredClone(saved().savedPresets); await nudge();
      if (mode === 'new') await button('Save as new\u2026').click();
      else { await page.locator('.style-management > summary').click(); await button('Rename').click(); }
      await page.getByRole('textbox', { name: mode === 'new' ? 'New style' : 'Style name', exact: true }).fill('Abandoned name');
      let refused = true;
      await page.route('**/api/settings', route => route.request().method() === 'PATCH' && refused ? route.fulfill({ status: 503, json: { error: 'Synthetic refused name' } }) : route.continue());
      await button(mode === 'new' ? 'Save new style' : 'Save changes').click(); await page.getByText('Synthetic refused name', { exact: true }).waitFor();
      await choice().selectOption(''); await page.getByRole('group', { name: 'Switch style' }).waitFor();
      await button('Discard and switch').click(); await clean(); assert.equal(await choice().inputValue(), '');
      await nudge(); refused = false; await button('Save changes').click(); await clean();
      assert.deepEqual(saved().savedPresets, before, `${mode}: abandoned metadata cannot leak into a later ordinary save`);
    }
    await open(); await select('alpha:imported/id'); const beforeRevert = structuredClone(saved().savedPresets); await nudge();
    await page.route('**/api/settings', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, json: { error: 'Synthetic revert refusal' } }) : route.continue());
    await button('Save changes').click(); await page.getByText('Synthetic revert refusal', { exact: true }).waitFor();
    await brightness().focus(); await page.keyboard.press('ArrowRight'); await clean();
    assert.deepEqual(saved().savedPresets, beforeRevert);
    checks.push('Failed new/rename intent can be discarded through Current display with no hidden record; reversing a failed visual edit returns to a clean draft');

    await open(); await select('alpha:imported/id'); const savedBeforeCurrent = await nudge();
    await choice().selectOption(''); await button('Save and switch').click(); await clean();
    assert.equal(await choice().inputValue(), ''); assert.equal(saved().savedPresets[0].visual.appearance.brightness, savedBeforeCurrent);
    await select('alpha:imported/id'); await nudge(); await select('beta');
    let releaseSwitch, startedSwitch;
    const switchGate = new Promise(resolve => { releaseSwitch = resolve; }), switchStart = new Promise(resolve => { startedSwitch = resolve; });
    await page.route('**/api/settings', async route => { if (route.request().method() === 'PATCH') { startedSwitch(); await switchGate; } await route.continue(); });
    await button('Save and switch').click(); await switchStart; const laterSwitch = await nudge(); releaseSwitch();
    await page.getByText('New edits are still unsaved. Keep editing or discard them to switch.', { exact: true }).waitFor();
    assert.equal(await choice().inputValue(), 'saved:alpha:imported/id'); assert.equal(Number(await brightness().inputValue()) / 100, laterSwitch);
    await button('Keep editing').click(); await button('Cancel').click(); await clean();
    checks.push('Current display supports Save-and-switch; later edits during a held Save-and-switch prevent the requested switch and remain editable');

    await open(); await button('Save as new\u2026').click(); await page.getByRole('textbox', { name: 'New style', exact: true }).fill('New concurrent name');
    let duplicateCount = 0;
    await page.route('**/api/settings', async route => {
      if (route.request().method() === 'PATCH' && ++duplicateCount === 1)
        await app.store.update(data => { data.settings.savedPresets.push({ id: 'remote-name', name: ' NEW CONCURRENT NAME ', visual: getVisual(data.settings) }); });
      await route.continue();
    });
    await button('Save new style').click(); await page.locator('#preset-name-error').waitFor();
    assert.equal(duplicateCount, 1); assert.equal(saved().savedPresets.length, 3);
    await page.getByRole('textbox', { name: 'New style', exact: true }).fill('Unique retry'); await button('Save new style').click(); await clean();
    assert.equal(saved().savedPresets.length, 4);
    checks.push('409 revalidates a newly conflicting name and retains the naming draft for a unique retry');

    await open(); await select('alpha:imported/id'); await nudge();
    await app.store.update(data => { data.settings.units = 'imperial'; });
    assert.equal(await page.locator('.style-save-scope').count(), 0, 'visual Save contains no hidden weather draft');
    await button('Save changes').click(); await clean(); assert.equal(saved().units, 'imperial');
    await page.getByRole('tab', { name: 'Style', exact: true }).click();
    const beforeResetNew = structuredClone(saved().savedPresets[0]);
    await button('Save as new\u2026').click(); await page.getByRole('textbox', { name: 'New style', exact: true }).fill('Reset as new');
    await page.locator('summary', { hasText: 'Reset appearance & layout' }).click(); await button('Reset appearance\u2026').click();
    await page.getByRole('group', { name: 'Reset appearance' }).getByRole('button', { name: 'Reset', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'New style', exact: true }).inputValue(), 'Reset as new');
    await button('Save new style').click(); await clean(); assert.deepEqual(saved().savedPresets[0], beforeResetNew);
    assert.equal(saved().savedPresets.find(item => item.name === 'Reset as new').visual.appearance.brightness, 0.55);
    checks.push('Visual Save preserves preferences saved elsewhere without a hidden weather draft; Reset appearance retains a new-style intent and preserves its original');

    await open(settings(), {}, true); await select('alpha:imported/id'); await nudge();
    await app.store.update(data => { data.settings.savedPresets[0].visual.appearance.brightness = 0.8; data.settings.units = 'imperial'; });
    await page.clock.runFor(30_000);
    await button('Reload style').waitFor(); await button('Reload style').click(); await button('Discard and switch').click();
    assert.equal(Number(await brightness().inputValue()) / 100, 0.8);
    assert.equal(await page.locator('.style-save-scope').count(), 0, 'remote preferences are not hidden editor drafts');
    await button('Save changes').click(); await clean(); assert.equal(saved().units, 'imperial'); assert.equal(saved().appearance.brightness, 0.8);
    checks.push('Changed selected style offers Reload style with explicit visual discard, while unrelated preferences saved elsewhere survive');

    await open(); await select('alpha:imported/id'); await nudge();
    let conflictInjected = false, patchCount = 0;
    await page.route('**/api/settings', async route => {
      if (route.request().method() === 'PATCH') { patchCount++; if (!conflictInjected) { conflictInjected = true; await app.store.update(data => { data.settings.savedPresets[0].visual.appearance.brightness = 0.8; }); } }
      await route.continue();
    });
    await button('Save changes').click(); await page.getByText('This style changed elsewhere. Reload it or save as new.', { exact: true }).first().waitFor();
    assert.equal(patchCount, 1); assert.equal(saved().savedPresets[0].visual.appearance.brightness, 0.8);
    await button('Save as new…').click(); await page.getByRole('textbox', { name: 'New style', exact: true }).fill('Recovered');
    await button('Save new style').click(); await clean();
    assert.equal(saved().savedPresets[0].visual.appearance.brightness, 0.8); assert.equal(saved().savedPresets.length, 3);
    checks.push('409 on a remotely changed selected style preserves the remote record and local visual; Save as new recovers without overwriting');

    await open(settings(), {}, true); await select('alpha:imported/id'); await nudge();
    await app.store.update(data => { data.settings.savedPresets = data.settings.savedPresets.filter(item => item.id !== 'alpha:imported/id'); });
    await page.clock.runFor(30_000);
    await page.getByText('This style was deleted elsewhere. Save as new to keep your changes.', { exact: true }).waitFor();
    assert.equal(await button('Save changes').getAttribute('aria-disabled'), 'true');
    await button('Save as new…').click(); await page.getByRole('textbox', { name: 'New style', exact: true }).fill('Recovered deletion');
    await button('Save new style').click(); await clean();
    assert.equal(saved().savedPresets.some(item => item.id === 'alpha:imported/id'), false);
    checks.push('Polling a deleted selected ID never recreates it; the unsaved look can be saved under a new ID');

    const imported = settings(); imported.savedPresets[1].name = 'Evening'; imported.savedPresets[1].id = 'builtin:room';
    await open(imported); await select('alpha:imported/id'); await nudge(); await button('Save changes').click(); await clean();
    assert.equal(saved().savedPresets.length, 2); assert.equal(saved().savedPresets[1].id, 'builtin:room');
    await choice().selectOption('builtin:night');
    assert.equal(await choice().inputValue(), 'builtin:night'); assert.equal(saved().savedPresets.length, 2);
    await button('Cancel').click(); await clean();
    checks.push('Imported duplicate names and arbitrary IDs survive unchanged-name updates; virtual starter choices cannot collide or consume saved slots');

    await open(settings(), { viewport: { width: 640, height: 300 } }); await nudge();
    const longError = 'Synthetic save refusal: the selected style could not be stored. Your current look and every unsaved setting are retained so you can review them and retry safely.';
    await page.route('**/api/settings', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, json: { error: longError } }) : route.continue());
    await button('Save changes').click(); await page.getByRole('alert').filter({ hasText: longError }).waitFor();
    await brightness().scrollIntoViewIfNeeded();
    const placements = await page.evaluate(async () => {
      const frames = [];
      for (let i = 0; i < 16; i++) { await new Promise(requestAnimationFrame); const alert = document.querySelector('.studio-error'); frames.push({ floating: alert.classList.contains('studio-error-floating'), height: alert.getBoundingClientRect().height }); }
      return frames;
    });
    assert.equal(new Set(placements.slice(-8).map(item => `${item.floating}:${item.height}`)).size, 1, 'long errors settle instead of oscillating between inline and floating heights');
    checks.push('Long save errors settle in a short viewport without a floating/inline height loop or lost draft');

    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 700 }, { width: 320, height: 640 }, { width: 640, height: 360 }]) {
      await open(settings(), { viewport, hasTouch: viewport.width < 700 });
      await choice().focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
      await nudge();
      const selectedBox = await choice().boundingBox();
      assert.ok(selectedBox.width >= 140, `the selected style name remains readable with Modified/actions at ${viewport.width}px: ${JSON.stringify(selectedBox)}`);
      await button('Save as new…').click(); await page.getByRole('textbox', { name: 'New style', exact: true }).fill('Synthetic portable style');
      for (const target of [choice(), button('Save new style'), button('Cancel')]) {
        const box = await target.boundingBox(); assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= viewport.width + 1, JSON.stringify({ viewport, box }));
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.locator('.studio-savebar').count(), 1);
      if (capture) images.push({ name: `styles-${viewport.width}`, bytes: await page.screenshot() });
      await button('Cancel').click(); await clean();
    }
    checks.push('Keyboard selection and inline naming; one Save group with 44 px controls at 1280/390/320/640 px; Cancel and no horizontal overflow');
    assert.deepEqual(errors, []); return { checks, images, seconds: Math.round((Date.now() - startedAt) / 1000) };
  } catch (error) {
    console.log(JSON.stringify({ checksCompleted: checks.length, errors, editor: await page.locator('body').innerText().catch(() => '') }));
    throw error;
  } finally { await browser.close(); app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runStylesQa(values); console.log(JSON.stringify({ passed: result.checks.length, seconds: result.seconds, checks: result.checks }, null, 2));
}
