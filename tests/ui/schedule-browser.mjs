import { mockWindowsStatus } from './lib/windows-fixture.mjs';
// #514/#517: Settings owns schedules, Home owns overrides, Editor keeps the manual visual.
// Synthetic data, fake clock, ephemeral loopback server; optional screenshots stay in RAM.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { keepPagesLocal } from './lib/local-only.mjs';

export async function runScheduleQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-schedule-browser-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  let now = new Date(2026, 9, 19, 7, 59, 50).getTime(); // Monday, desktop local time.
  let app;
  const start = async (port = 0) => {
    const started = await createApplication({ dataDirectory: directory, clientDirectory: join(root, 'dist/client'), now: () => now, fetcher: async () => Response.json(forecastFixture(Math.floor(now / 1000))) });
    started.server.listen(port, '127.0.0.1'); await once(started.server, 'listening'); return started;
  };
  app = await start(); const port = app.server.address().port, base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US', reducedMotion: 'reduce' }); await mockWindowsStatus(context);
  const outside = await keepPagesLocal(context, base), errors = [], images = [], checks = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.clock.install({ time: new Date(now) });
  const request = async (path, method = 'GET', data) => {
    const response = await fetch(base + path, { method, ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
    assert.equal(response.ok, true, `${method} ${path}: ${response.status}`); return response.json();
  };
  const advance = async ms => { now += ms; await context.clock.fastForward(ms); };
  const snapshot = () => request('/api/state');
  const settle = async (page, predicate) => page.waitForFunction(predicate, undefined, { timeout: 5000 });
  try {
    await app.store.update(data => {
      const settings = defaultSettings();
      for (const id of Object.keys(settings.widgets)) settings.widgets[id] = id === 'clock';
      settings.preview.enabled = false;
      const { appearance, widgets, widgetGrid, widgetOverrides, widgetBehavior, preview } = settings;
      const visual = { appearance, widgets, widgetGrid, widgetOverrides, widgetBehavior, preview };
      settings.savedPresets = [
        { id: 'legacy-morning', name: 'Synthetic morning', visual: { ...visual, appearance: { ...appearance, brightness: .25, textColor: '#aabbcc' } } },
        { id: 'legacy-evening', name: 'Synthetic evening', visual: { ...visual, appearance: { ...appearance, brightness: .65, textColor: '#ccbbaa' } } },
      ];
      data.settings = settings;
    });
    const manual = app.store.snapshot().settings;
    const settingsPage = await context.newPage(); await settingsPage.goto(base + '/settings');
    await settingsPage.locator('.schedule-disclosure > summary').click();
    const schedule = settingsPage.locator('.schedule-settings');
    assert.match(await schedule.locator('.schedule-status').innerText(), /Schedule off/);
    await schedule.getByRole('button', { name: 'Add schedule row', exact: true }).click();
    const row = schedule.locator('.schedule-row').first();
    assert.equal(await row.getByLabel('From', { exact: true }).inputValue(), '');
    assert.equal(await schedule.getByRole('button', { name: 'Save schedule', exact: true }).isDisabled(), true);
    await row.getByRole('checkbox', { name: 'Monday', exact: true }).check();
    await row.getByLabel('From', { exact: true }).fill('08:00');
    await row.getByLabel('Until', { exact: true }).fill('12:00');
    await schedule.getByLabel('Outside scheduled times').selectOption('legacy-evening');
    await schedule.getByRole('checkbox', { name: 'Enable schedule', exact: true }).check();
    await schedule.getByRole('button', { name: 'Save schedule', exact: true }).click();
    await schedule.getByText('Schedule saved.', { exact: true }).waitFor();
    assert.deepEqual(app.store.snapshot().settings, manual, 'schedule Save cannot save or rewrite manual settings');
    checks.push('Schedule starts off; Add leaves days/times unchosen; native controls save an explicit row and fallback independently of manual settings.');

    await row.getByLabel('Until', { exact: true }).fill('12:30');
    await settingsPage.locator('.schedule-disclosure > summary').click();
    await settingsPage.locator('.schedule-disclosure > summary').click();
    assert.equal(await row.getByLabel('Until', { exact: true }).inputValue(), '12:30');
    const editor = await context.newPage(); await editor.goto(base + '/editor');
    await editor.getByRole('tab', { name: 'Style', exact: true }).click();
    const brightness = editor.getByRole('slider', { name: 'Brightness', exact: true });
    await brightness.focus(); await brightness.press('ArrowLeft');
    await schedule.getByRole('button', { name: 'Save schedule', exact: true }).click();
    await schedule.getByText('Schedule saved.', { exact: true }).waitFor();
    assert.equal(app.store.snapshot().settings.appearance.brightness, manual.appearance.brightness);
    assert.equal(await editor.locator('.studio-savebar').count(), 1, 'schedule Save keeps the separate visual draft');
    await editor.locator('.cancel-settings').click();
    assert.equal((await request('/api/schedule')).config.rules[0].end, '12:30');
    checks.push('Settings schedule drafts survive closing/reopening their section; schedule Save preserves a separate Editor visual draft, and visual Cancel preserves the saved schedule.');

    const home = await context.newPage(); await home.goto(base + '/');
    const display = await context.newPage(); await display.goto(base + '/display');
    await display.locator('.ambient-clock').waitFor();
    await advance(16_000);
    await settle(settingsPage, () => document.querySelector('.schedule-status')?.textContent.includes('scheduled now'));
    await settle(display, () => document.querySelector('.ambient')?.style.getPropertyValue('--ambient-brightness') === '0.25');
    await settle(home, () => document.querySelector('.schedule-home .schedule-status')?.textContent.includes('Synthetic morning'));
    const noBlank = await display.evaluate(() => ({ opacity: getComputedStyle(document.querySelector('.ambient-content')).opacity, background: getComputedStyle(document.querySelector('.display-page')).backgroundColor, count: document.querySelectorAll('.display-page').length }));
    assert.equal(noBlank.opacity, '1'); assert.equal(noBlank.count, 1);
    assert.deepEqual(app.store.snapshot().settings, manual);
    const useManual = home.getByRole('button', { name: 'Use manual style for 1 hour', exact: true });
    const resume = home.getByRole('button', { name: 'Return to schedule', exact: true });
    await useManual.click();
    await resume.waitFor();
    assert.equal((await snapshot()).schedule.selection.source, 'override');
    await resume.click();
    await useManual.waitFor();
    assert.equal((await snapshot()).schedule.selection.source, 'rule');
    await useManual.click();
    await resume.waitFor();
    await advance(3_606_000);
    await useManual.waitFor();
    assert.equal((await snapshot()).schedule.selection.source, 'rule');
    checks.push('A minute boundary updates the live display and Home status without blanking or changing manual settings; Home override/Return and one-hour expiry work.');

    assert.equal(await schedule.locator('.schedule-row').count(), 1, 'the saved schedule still has its first row');
    await schedule.getByRole('button', { name: 'Add schedule row', exact: true }).click();
    await settingsPage.waitForFunction(() => document.querySelectorAll('.schedule-row').length === 2, undefined, { timeout: 3000 });
    const second = schedule.locator('.schedule-row').nth(1);
    await second.getByRole('combobox', { name: 'Saved style', exact: true }).selectOption('legacy-evening');
    await second.getByRole('checkbox', { name: 'Monday', exact: true }).check();
    await second.getByLabel('From', { exact: true }).fill('08:00'); await second.getByLabel('Until', { exact: true }).fill('12:00');
    assert.match(await schedule.innerText(), /Overlapping rows: 1 and 2/);
    await second.getByRole('button', { name: 'Move row 2 up', exact: true }).focus(); await second.getByRole('button', { name: 'Move row 2 up', exact: true }).press('Enter');
    assert.equal(await schedule.locator('.schedule-row').first().getByRole('combobox', { name: 'Saved style', exact: true }).inputValue(), 'legacy-evening');
    assert.equal(await schedule.locator('.schedule-row').first().getByRole('combobox', { name: 'Saved style', exact: true }).evaluate(element => element === document.activeElement), true);
    await schedule.getByRole('button', { name: 'Cancel schedule edits', exact: true }).click();
    const clean = await request('/api/schedule');
    await row.getByLabel('Until', { exact: true }).fill('13:00');
    await request('/api/schedule', 'PUT', { ...clean.config, enabled: false }); await advance(6000);
    await schedule.getByText(/The schedule changed in another window/).waitFor();
    assert.equal(await row.getByLabel('Until', { exact: true }).inputValue(), '13:00');
    assert.equal(await schedule.getByRole('button', { name: 'Save schedule', exact: true }).isDisabled(), true);
    await schedule.getByRole('button', { name: 'Cancel schedule edits', exact: true }).click();
    await request('/api/schedule', 'PUT', clean.config); await advance(6000);
    checks.push('Overlaps identify ordered winners; keyboard reordering preserves focus in the moved row; external edits preserve a stale local draft and block overwrite.');

    const scheduleBackup = await request('/api/schedule/export');
    assert.equal(await schedule.getByRole('link', { name: 'Download saved schedule', exact: true }).getAttribute('href'), '/api/schedule/export');
    const upload = { name: 'synthetic-schedule.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scheduleBackup)) };
    await schedule.getByLabel('Schedule backup file', { exact: true }).setInputFiles(upload);
    await schedule.getByRole('group', { name: 'Restore schedule', exact: true }).waitFor();
    await schedule.getByRole('button', { name: 'Keep current schedule', exact: true }).click();
    assert.deepEqual((await request('/api/schedule')).config, clean.config, 'canceling restoration keeps the saved sidecar');
    await schedule.getByLabel('Schedule backup file', { exact: true }).setInputFiles(upload);
    await schedule.getByRole('button', { name: 'Replace schedule', exact: true }).click();
    await schedule.getByText('Schedule restored.', { exact: true }).waitFor();
    assert.deepEqual((await request('/api/schedule')).config, clean.config);
    checks.push('A separate schedule backup is linked explicitly; restoring requires confirmation, cancel preserves it and confirmed restore keeps the referenced styles.');

    await request('/api/settings', 'PATCH', { savedPresets: manual.savedPresets.filter(item => item.id !== 'legacy-morning') });
    await advance(6000);
    await schedule.getByText(/A scheduled style was deleted or is missing/).waitFor();
    assert.match(await schedule.locator('.schedule-status').innerText(), /Synthetic evening.*outside scheduled times/);
    assert.equal((await snapshot()).schedule.selection.source, 'fallback');
    assert.match(await row.getByRole('combobox', { name: 'Saved style', exact: true }).innerText(), /Missing saved style/);
    const savedSchedule = await readFile(join(directory, 'schedule.json'), 'utf8');
    app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); app = await start(port);
    await advance(6000);
    assert.equal(await readFile(join(directory, 'schedule.json'), 'utf8'), savedSchedule, 'restart and reads do not rewrite schedule');
    assert.equal((await snapshot()).schedule.selection.source, 'fallback');
    checks.push('Deleted styles remain repairable and fall back safely; restart catches up without rewriting the saved schedule.');

    for (const width of [1280, 390, 320]) {
      await settingsPage.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
      await schedule.scrollIntoViewIfNeeded();
      const layout = await schedule.evaluate(element => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        small: [...element.querySelectorAll('button, select, input[type=time], .schedule-weekdays label')].filter(target => target.checkVisibility()).map(target => { const r = target.getBoundingClientRect(); return { text: target.getAttribute('aria-label') ?? target.textContent.slice(0, 20), width: r.width, height: r.height }; }).filter(target => target.width < 43.5 || target.height < 43.5),
      }));
      assert.ok(layout.overflow <= 0, `${width}: no horizontal page overflow`);
      assert.deepEqual(layout.small, [], `${width}: schedule targets at least 44px`);
      if (capture) images.push({ name: `schedule-${width}`, bytes: await settingsPage.screenshot() });
    }
    checks.push('Desktop, 390px and 320px layouts have no horizontal overflow and keep 44px form/reorder/touch targets.');
    for (const manualOn of [true, false]) {
      const value = defaultSettings(); value.preview.enabled = false;
      for (const id of Object.keys(value.widgets)) value.widgets[id] = manualOn && (id === 'clock' || id === 'reminders');
      const { appearance, widgets, widgetGrid, widgetOverrides, widgetBehavior, preview } = value;
      value.savedPresets = [{ id: 'visibility', name: 'Synthetic visibility', visual: { appearance, widgets: { ...widgets, clock: !manualOn, reminders: !manualOn }, widgetGrid, widgetOverrides, widgetBehavior, preview } }];
      await app.store.update(data => { data.settings = value; data.reminders = []; });
      await request('/api/schedule', 'PUT', { enabled: true, fallbackPresetId: 'visibility', rules: [] });
      const current = await context.newPage(); await current.goto(base + '/'); await current.locator('.home-page').waitFor();
      let showWrites = 0; current.on('request', request => { if (/\/api\/widgets\/.*\/show$/.test(request.url())) showWrites++; });
      await current.locator('[data-action="reminder"]').click();
      await current.getByRole('textbox', { name: 'What', exact: true }).fill('Synthetic scheduled reminder');
      await current.getByRole('radio', { name: 'Anytime', exact: true }).check();
      await current.getByRole('button', { name: 'Add reminder', exact: true }).click();
      await current.locator('.home-sheet').waitFor({ state: 'detached' });
      const status = current.locator('.home-main > .home-status');
      if (manualOn) {
        await status.getByText('A scheduled style is active. Use the manual style to show this widget.', { exact: true }).waitFor();
        assert.doesNotMatch(await status.innerText(), /in Reminders on your display/);
      } else await status.getByText(/in Reminders on your display/).waitFor();
      await current.locator('[data-action="timer"]').click();
      assert.equal(await current.getByRole('button', { name: 'Show the clock', exact: true }).count(), manualOn ? 1 : 0);
      await current.getByRole('button', { name: 'Start a 1 min timer', exact: true }).click();
      await current.locator('.home-sheet').waitFor({ state: 'detached' });
      await status.getByText(manualOn ? /Clock is off, so it shows here only/ : /on your display's clock/).waitFor();
      assert.equal(showWrites, 0, 'effective visibility never causes an unnecessary manual-layout write');
      assert.deepEqual(app.store.snapshot().settings.widgets, value.widgets);
      await current.close();
    }
    checks.push('Home reminder/timer results use effective scheduled visibility in both directions; manual layout is preserved and already-shown widgets cause no Show write.');
    assert.deepEqual(errors, []);
    return { checks, images, outside };
  } catch (error) {
    const settingsPage = context.pages().find(page => new URL(page.url()).pathname === '/settings');
    console.log(JSON.stringify({ checksCompleted: checks.length,
      schedule: await settingsPage?.locator('.schedule-settings').innerText().catch(() => '(unavailable)'),
      savedSchedule: await request('/api/schedule').catch(() => '(unavailable)'),
    }));
    throw error;
  } finally {
    await context.close(); await browser.close();
    app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const { checks, outside } = await runScheduleQa(values); console.log(JSON.stringify({ passed: checks.length, checks, outside }, null, 2));
}
