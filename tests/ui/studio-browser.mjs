// Production Edge interaction regressions. Own ephemeral loopback server/data;
// synthetic provider and device responses only. Screenshots are RAM buffers.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';

export async function runStudioQa({ playwright, edge } = {}) {
  const { chromium } = createRequire(import.meta.url)(
    playwright ?? 'playwright',
  );
  const directory = await mkdtemp(join(tmpdir(), 'lrd-studio-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const now = Date.parse('2026-10-18T13:00:00Z');
  const app = await createApplication({
    dataDirectory: directory,
    clientDirectory: join(root, 'dist/client'),
    now: () => now,
    fetcher: async (input) => {
      const url = new URL(input);
      if (
        url.hostname === 'geocoding-api.open-meteo.com' &&
        url.searchParams.get('name') === 'Long'
      )
        return Response.json({
          results: [
            {
              id: 103,
              name: 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch',
              latitude: 53.22,
              longitude: -4.2,
              timezone: 'Europe/London',
              admin1: 'AdministrativeRegion'.repeat(4),
              country: 'CountryName'.repeat(8),
            },
            {
              id: 104,
              name: 'London',
              latitude: 51.5,
              longitude: -0.1,
              timezone: 'Europe/London',
              admin1: 'England',
              country: 'United Kingdom',
            },
          ],
        });
      if (new URL(input).hostname === 'geocoding-api.open-meteo.com')
        return Response.json({
          results: [
            {
              id: 101,
              name: 'London',
              latitude: 51.5,
              longitude: -0.1,
              timezone: 'Europe/London',
              admin1: 'England',
              country: 'United Kingdom',
            },
            {
              id: 102,
              name: 'London',
              latitude: 42.98,
              longitude: -81.25,
              timezone: 'America/Toronto',
              admin1: 'Ontario',
              country: 'Canada',
            },
          ],
        });
      return Response.json(forecastFixture());
    },
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({
    executablePath: edge,
    headless: true,
  });
  const errors = [],
    images = [],
    checks = [];
  async function reset() {
    await app.store.update((data) => {
      data.settings = defaultSettings();
      data.reminders = [];
    });
  }
  async function open({
    viewport = { width: 1440, height: 1000 },
    permission = 'prompt',
    geo = 'deferred',
    route = '/editor',
    reducedMotion = 'no-preference',
  } = {}) {
    const context = await browser.newContext({
      viewport,
      timezoneId: 'America/Toronto',
      reducedMotion,
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        !message.text().includes('500') &&
        !message.text().includes('503') &&
        // A Save from an outdated settings revision is refused with 409, merged and retried (#287).
        !(message.text().includes('status of 409') && message.location().url.endsWith('/api/settings'))
      )
        errors.push(message.text());
    });
    await page.addInitScript(
      ({ permission, geo }) => {
        window.__geoCalls = 0;
        window.__permissionCalls = 0;
        Object.defineProperty(navigator, 'permissions', {
          configurable: true,
          value: {
            query: async () => {
              window.__permissionCalls++;
              return { state: permission };
            },
          },
        });
        Object.defineProperty(navigator, 'geolocation', {
          configurable: true,
          value: {
            getCurrentPosition: (success, failure) => {
              window.__geoCalls++;
              window.__finishGeo = () =>
                geo === 'denied'
                  ? failure({ code: 1 })
                  : geo === 'unavailable'
                    ? failure({ code: 2 })
                    : success({
                        coords: {
                          latitude: 12.34567,
                          longitude: 45.67891,
                          accuracy: 123,
                        },
                      });
              if (geo !== 'deferred') window.__finishGeo();
            },
          },
        });
      },
      { permission, geo },
    );
    await page.clock.install({ time: new Date(now) });
    await page.goto(base + route);
    await page.locator('.clock-time').waitFor();
    await page.clock.runFor(2000);
    return { context, page };
  }
  async function tab(page, name) {
    await page.getByRole('tab', { name, exact: true }).click();
    await page.clock.runFor(300);
  }
  const save = (page) =>
    page.getByRole('button', { name: 'Save changes', exact: true });
  const cancel = (page) =>
    page.getByRole('button', { name: 'Cancel', exact: true });
  async function saved(page) {
    await page.locator('.studio-savebar').waitFor({ state: 'detached' });
  }
  async function range(page, name, key = 'ArrowRight') {
    await page.getByRole('slider', { name, exact: true }).focus();
    await page.keyboard.press(key);
  }
  async function selectCity(page) {
    await tab(page, 'Weather');
    const input = page.getByRole('combobox', { name: 'City', exact: true });
    await input.fill('Lon');
    await page.clock.runFor(300);
    await page.getByRole('option').first().waitFor();
    await input.press('ArrowDown');
    // Option ids are unique per combobox instance (useId); the first option is active.
    assert.equal(
      await input.getAttribute('aria-activedescendant'),
      await page.getByRole('option').first().getAttribute('id'),
    );
    assert.equal(
      await input.evaluate((e) => document.activeElement === e),
      true,
    );
    await input.press('Enter');
    await page
      .locator('.current-location strong')
      .filter({ hasText: 'London' })
      .waitFor();
  }
  async function bounds(page) {
    const result = await page.evaluate(() => {
      const bad = [],
        box = (e) => {
          const r = e.getBoundingClientRect();
          return { l: r.left, t: r.top, r: r.right, b: r.bottom };
        };
      for (const widget of document.querySelectorAll('.ambient-widget')) {
        const outer = box(widget),
          content = box(widget.querySelector('.widget-content'));
        if (
          outer.l < -1 ||
          outer.t < -1 ||
          outer.r > innerWidth + 1 ||
          outer.b > innerHeight + 1
        )
          bad.push(widget.className + ' viewport');
        if (
          content.l < outer.l - 2 ||
          content.t < outer.t - 2 ||
          content.r > outer.r + 2 ||
          content.b > outer.b + 2
        )
          bad.push(widget.className + ' content');
      }
      return {
        bad,
        black: getComputedStyle(document.querySelector('.ambient'))
          .backgroundColor,
        audio: document.querySelectorAll('audio,video').length,
      };
    });
    assert.deepEqual(result.bad, []);
    assert.equal(result.black, 'rgb(0, 0, 0)');
    assert.equal(result.audio, 0);
  }
  try {
    await reset();
    let { page, context } = await open();
    assert.equal(await save(page).count(), 0);
    assert.equal(await cancel(page).count(), 0);
    await tab(page, 'Style');
    await page.getByRole('button', { name: 'Night', exact: true }).click();
    await selectCity(page);
    assert.equal(app.store.snapshot().settings.location.name, 'Toronto');
    assert.match(
      await page.locator('.canvas-note').innerText(),
      /preview still shows Toronto/,
    );
    await cancel(page).click();
    assert.equal(
      await page.locator('.current-location strong').innerText(),
      'Toronto',
    );
    assert.equal(
      await page
        .getByRole('combobox', { name: 'City', exact: true })
        .inputValue(),
      '',
    );
    await tab(page, 'Style');
    assert.equal(
      await page
        .getByRole('slider', { name: 'Brightness', exact: true })
        .inputValue(),
      '55',
    );
    checks.push(
      'global Cancel restores appearance/city and clears search without saving',
    );

    await tab(page, 'Weather');
    const input = page.getByRole('combobox', { name: 'City', exact: true });
    await input.fill('Lon');
    await page.clock.runFor(300);
    await page.getByRole('option').first().waitFor();
    await input.press('ArrowDown');
    await input.press('Escape');
    assert.equal(await input.getAttribute('aria-expanded'), 'false');
    assert.equal(
      await page.locator('.current-location strong').innerText(),
      'Toronto',
    );
    await input.press('ArrowDown');
    await input.press('Enter');
    await save(page).click();
    await saved(page);
    assert.equal(app.store.snapshot().settings.location.name, 'London');
    await page.reload();
    await page.locator('.clock-time').waitFor();
    await tab(page, 'Weather');
    assert.equal(
      await page.locator('.current-location strong').innerText(),
      'London',
    );
    checks.push(
      'debounced keyboard city combobox, Escape, explicit selection and reload persistence',
    );

    // A slow response for an older query cannot replace the newer options.
    const old = {
      id: 1,
      name: 'Old result',
      latitude: 1,
      longitude: 2,
      timezone: 'UTC',
      admin1: 'QA',
      country: 'Test',
    };
    let releaseOld;
    const oldGate = new Promise((r) => {
      releaseOld = r;
    });
    await page.route('**/api/locations?*', async (route) => {
      const query = new URL(route.request().url()).searchParams.get('q');
      if (query === 'Ol') await oldGate;
      await route
        .fulfill({
          json: [
            { ...old, name: query === 'Ol' ? 'Old result' : 'New result' },
          ],
        })
        .catch(() => {});
    });
    await input.fill('Ol');
    await page.clock.runFor(300);
    await input.fill('New');
    await page.clock.runFor(300);
    await page.getByRole('option').filter({ hasText: 'New result' }).waitFor();
    releaseOld();
    await page.clock.runFor(50);
    assert.equal(
      await page.getByRole('option').filter({ hasText: 'Old result' }).count(),
      0,
    );
    await page.unroute('**/api/locations?*');
    await page
      .getByRole('button', { name: 'Clear city search', exact: true })
      .click();
    checks.push('older city responses cannot replace current dropdown');

    await tab(page, 'Style');
    await range(page, 'Brightness');
    await page.route('**/api/settings', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 500,
            json: { error: 'Synthetic save failure' },
          })
        : route.continue(),
    );
    await save(page).click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Synthetic save failure' })
      .waitFor();
    assert.equal(await save(page).isEnabled(), true);
    assert.equal(
      await page
        .getByRole('slider', { name: 'Brightness', exact: true })
        .inputValue(),
      '56',
    );
    await page.unroute('**/api/settings');
    await cancel(page).click();
    checks.push('failed Save retains draft for retry or Cancel');

    // Keep a later change while the earlier Save's response is in flight.
    let releaseSave, responseReady;
    const gate = new Promise((r) => {
        releaseSave = r;
      }),
      ready = new Promise((r) => {
        responseReady = r;
      });
    await page.route('**/api/settings', async (route) => {
      const response = await route.fetch();
      responseReady();
      await gate;
      await route.fulfill({ response });
    });
    await range(page, 'Brightness');
    await save(page).click();
    await ready;
    await range(page, 'Text size');
    releaseSave();
    await page
      .locator('.save-status')
      .filter({ hasText: 'Unsaved changes' })
      .waitFor();
    assert.equal(
      await page
        .getByRole('slider', { name: 'Text size', exact: true })
        .inputValue(),
      '101',
    );
    await page.unroute('**/api/settings');
    await save(page).click();
    await saved(page);
    assert.equal(app.store.snapshot().settings.appearance.fontScale, 1.01);
    checks.push('Save acknowledgement preserves edits made during request');

    await range(page, 'Brightness');
    await app.store.patchSettings({ appearance: { fontScale: 1.2 } });
    await page.clock.runFor(30001);
    await page
      .getByRole('slider', { name: 'Text size', exact: true })
      .filter({ visible: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('input[aria-label="Text size"]').value === '120',
    );
    assert.equal(
      await page
        .getByRole('slider', { name: 'Brightness', exact: true })
        .inputValue(),
      '57',
    );
    await cancel(page).click();
    checks.push('poll rebases untouched fields without erasing local changes');

    await page.getByText('Saved styles', { exact: true }).click();
    await page
      .getByLabel('Style name', { exact: true })
      .fill('Synthetic style');
    await page.getByRole('button', { name: 'Add style', exact: true }).click();
    await cancel(page).click();
    assert.equal(app.store.snapshot().settings.savedPresets.length, 0);
    await page
      .getByLabel('Style name', { exact: true })
      .fill('Synthetic style');
    await page.getByRole('button', { name: 'Add style', exact: true }).click();
    await save(page).click();
    await saved(page);
    assert.equal(app.store.snapshot().settings.savedPresets.length, 1);
    checks.push('saved-style edits participate in global Save and Cancel');

    await tab(page, 'Widgets');
    await page.getByRole('button', { name: 'Reminders', exact: true }).click();
    await page
      .getByRole('checkbox', { name: 'Hide when empty', exact: true })
      .uncheck();
    await cancel(page).click();
    assert.equal(
      await page
        .getByRole('checkbox', { name: 'Hide when empty', exact: true })
        .isChecked(),
      true,
    );
    await tab(page, 'Reminders');
    await page
      .getByRole('button', { name: 'Add reminder', exact: true })
      .click();
    await page
      .getByLabel('Reminder', { exact: true })
      .fill('Synthetic reminder');
    await page
      .getByRole('button', { name: 'Save reminder', exact: true })
      .click();
    await page.getByText('Reminder saved', { exact: true }).waitFor();
    assert.equal(await save(page).count(), 0);
    await page
      .getByRole('button', { name: 'Edit: Synthetic reminder', exact: true })
      .click();
    await page
      .getByLabel('Reminder', { exact: true })
      .fill('Synthetic changed');
    await page
      .getByRole('button', { name: 'Save reminder', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Complete: Synthetic changed', exact: true })
      .click();
    // The empty list hides on the display; the editor canvas keeps its placeholder (#233).
    await page.locator('.ambient-reminders .reminders-placeholder').waitFor();
    await page
      .getByRole('button', { name: 'History (1)', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Delete: Synthetic changed', exact: true })
      .click();
    await page.getByText('Deleted from history', { exact: true }).waitFor();
    assert.equal(app.store.snapshot().reminders.length, 0);
    checks.push(
      'independent reminder add/edit/complete/delete; confirmed-empty widget hides',
    );
    const dated = [];
    for (const [index, dueAt] of [
      '2026-11-01T05:30:00.000Z',
      '2026-11-01T06:30:00.000Z',
      '2026-10-19T18:45:39.876+05:45',
      null,
    ].entries()) {
      const response = await fetch(`${base}/api/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `Date preservation ${index}`, dueAt }),
      });
      assert.equal(response.status, 201);
      dated.push(await response.json());
    }
    await context.close();
    ({ page, context } = await open());
    await page.locator('#tab-Reminders').click();
    await page.clock.runFor(300);
    for (const reminder of dated) {
      await page.getByRole('button', { name: `Edit: ${reminder.text}`, exact: true }).click();
      await page.getByLabel('Reminder', { exact: true }).fill(`${reminder.text} renamed`);
      const request = page.waitForRequest(request => request.method() === 'PATCH' && request.url().endsWith(`/api/reminders/${reminder.id}`));
      await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
      assert.equal(Object.hasOwn((await request).postDataJSON(), 'dueAt'), false);
      await page.getByText('Reminder saved', { exact: true }).waitFor();
      assert.equal(app.store.snapshot().reminders.find(item => item.id === reminder.id).dueAt, reminder.dueAt);
    }
    const concurrent = dated[3];
    await page.getByRole('button', { name: `Edit: ${concurrent.text} renamed`, exact: true }).click();
    await fetch(`${base}/api/reminders/${concurrent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueAt: '2026-11-03T19:00:00.000Z' }),
    });
    await page.getByLabel('Reminder', { exact: true }).fill('Concurrent date preserved');
    await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
    await page.getByText('Reminder saved', { exact: true }).waitFor();
    assert.equal(app.store.snapshot().reminders.find(item => item.id === concurrent.id).dueAt, '2026-11-03T19:00:00.000Z');
    const first = dated[0];
    await page.getByRole('button', { name: `Edit: ${first.text} renamed`, exact: true }).click();
    await page.locator('.reminder-form input[type="datetime-local"]').fill('2026-11-02T13:45');
    await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
    await page.getByText('Reminder saved', { exact: true }).waitFor();
    assert.equal(app.store.snapshot().reminders.find(item => item.id === first.id).dueAt, '2026-11-02T18:45:00.000Z');
    await page.getByRole('button', { name: `Edit: ${first.text} renamed`, exact: true }).click();
    await page.locator('.reminder-form input[type="datetime-local"]').fill('');
    await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
    await page.getByText('Reminder saved', { exact: true }).waitFor();
    assert.equal(app.store.snapshot().reminders.find(item => item.id === first.id).dueAt, null);
    await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
    await page.getByLabel('Reminder', { exact: true }).fill('New dated reminder');
    await page.locator('.reminder-form input[type="datetime-local"]').fill('2026-11-02T13:45');
    await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
    await page.getByText('Reminder saved', { exact: true }).waitFor();
    assert.equal(app.store.snapshot().reminders.find(item => item.text === 'New dated reminder').dueAt, '2026-11-02T18:45:00.000Z');
    checks.push('title-only reminder edits preserve both DST-hour instants, imported seconds/offsets and undated state; date changes, clearing and creation work');
    images.push({
      label: 'Studio desktop',
      bytes: await page.screenshot({ type: 'png', animations: 'disabled' }),
    });
    await context.close();

    await reset();
    ({ page, context } = await open());
    await tab(page, 'Weather');
    await page
      .getByRole('button', { name: 'Use device location', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Cancel lookup', exact: true })
      .click();
    await page.evaluate(() => window.__finishGeo());
    await page.clock.runFor(100);
    assert.equal(app.store.snapshot().settings.locationSource, 'fallback');
    assert.equal(
      await page.locator('.current-location strong').innerText(),
      'Toronto',
    );
    await page
      .getByRole('button', { name: 'Use device location', exact: true })
      .click();
    await page.evaluate(() => window.__finishGeo());
    await page.getByText('Area ready to save', { exact: true }).waitFor();
    assert.equal(app.store.snapshot().settings.locationSource, 'fallback');
    await save(page).click();
    await saved(page);
    assert.equal(app.store.snapshot().settings.location.latitude, 12.3);
    checks.push(
      'Cancel invalidates a late device callback; explicit device selection waits for Save and rounds',
    );
    await context.close();

    await reset();
    ({ page, context } = await open({ permission: 'granted', geo: 'success' }));
    await page.getByText('Unsaved changes', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__geoCalls), 1);
    await app.store.patchSettings({
      location: {
        name: 'Other editor city',
        latitude: 40,
        longitude: 50,
        timezone: 'UTC',
      },
    });
    await save(page).click();
    await saved(page);
    assert.equal(
      app.store.snapshot().settings.location.name,
      'Other editor city',
    );
    checks.push(
      'automatic device draft cannot replace a concurrent saved manual city',
    );
    await context.close();

    // Every failed explicit lookup must guard its fallback against another editor.
    for (const geo of ['denied', 'unavailable']) {
      await reset();
      await app.store.patchSettings({
        locationSource: 'device',
        location: {
          name: 'Device area',
          latitude: 12.3,
          longitude: 45.7,
          timezone: 'auto',
        },
      });
      ({ page, context } = await open({ geo }));
      await tab(page, 'Weather');
      await page
        .getByRole('button', { name: 'Use device location', exact: true })
        .click();
      await page
        .locator('.current-location strong')
        .filter({ hasText: 'Toronto' })
        .waitFor();
      await app.store.patchSettings({
        location: {
          name: 'Concurrent manual city',
          latitude: 40,
          longitude: 50,
          timezone: 'UTC',
        },
      });
      const requestPromise = page.waitForRequest(
        (request) =>
          request.url().endsWith('/api/settings') &&
          request.method() === 'PATCH',
      );
      await save(page).click();
      const submitted = (await requestPromise).postDataJSON();
      assert.equal(
        submitted.automaticLocation,
        true,
        'explicit failure fallback must send guarded request intent',
      );
      assert.equal(submitted.locationSource, 'fallback');
      await saved(page);
      assert.equal(
        app.store.snapshot().settings.location.name,
        'Concurrent manual city',
      );
      await context.close();
    }
    checks.push(
      'explicit denied/unavailable lookup fallbacks send guarded intent and preserve a concurrent manual city',
    );

    await reset();
    await app.store.patchSettings({
      appearance: { motionIntervalSeconds: 30, fadeSeconds: 0.2 },
    });
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 },
    ]) {
      ({ page, context } = await open({ route: '/display', viewport }));
      for (let composition = 0; composition < 4; composition++) {
        await page.locator('.composition-' + composition).waitFor();
        await bounds(page);
        await page.clock.runFor(30001);
        await page.clock.runFor(800);
      }
      assert.equal(
        await page.evaluate(() => window.__geoCalls + window.__permissionCalls),
        0,
      );
      assert.notEqual(
        await page.locator('html').evaluate((e) => getComputedStyle(e).cursor),
        'none',
      );
      images.push({
        label: 'Ambient ' + viewport.width,
        bytes: await page.screenshot({ type: 'png', animations: 'disabled' }),
      });
      await context.close();
    }
    checks.push(
      'four timed compositions fit 1080p and 4K; true black, no audio or ambient geolocation, visible browser cursor',
    );
    ({ page, context } = await open({
      route: '/display',
      reducedMotion: 'reduce',
    }));
    assert.equal(
      await page
        .locator('.ambient')
        .evaluate((e) => e.classList.contains('static')),
      true,
    );
    assert.equal(
      await page
        .locator('.clock-digits')
        .evaluate((e) => getComputedStyle(e).animationName),
      'none',
    );
    await page.clock.runFor(90000);
    assert.ok(
      Number(await page.locator('.ambient').getAttribute('data-composition')) >
        0,
      'Reduced motion retains discrete relocation',
    );
    await context.close();
    for (const width of [390, 320]) {
      ({ page, context } = await open({
        viewport: { width, height: 844 },
        reducedMotion: 'reduce',
      }));
      for (const name of ['Style', 'Widgets', 'Weather', 'Reminders']) {
        await tab(page, name);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
      }
      await tab(page, 'Style');
      assert.equal(
        await page
          .locator('.canvas-column')
          .evaluate((e) => getComputedStyle(e).position),
        'static',
      );
      assert.equal(
        await page
          .getByRole('tab', { name: 'Style', exact: true })
          .evaluate((e) => getComputedStyle(e).transitionDuration),
        '0s',
      );
      await page.getByRole('tab', { name: 'Style', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(
        await page
          .getByRole('tab', { name: 'Widgets', exact: true })
          .getAttribute('aria-selected'),
        'true',
      );
      images.push({
        label: 'Studio mobile ' + width,
        bytes: await page.screenshot({
          type: 'png',
          fullPage: true,
          animations: 'disabled',
        }),
      });
      await context.close();
    }
    checks.push(
      'reduced motion, keyboard section navigation, 390px/320px reflow and nonsticky mobile preview',
    );
    await reset();
    for (const width of [320, 390, 1440]) {
      ({ page, context } = await open({
        viewport: { width, height: 844 },
      }));
      await tab(page, 'Weather');
      const input = page.getByRole('combobox', { name: 'City', exact: true });
      await input.fill('Long');
      await page.clock.runFor(300);
      const options = page.locator('[role="option"]');
      await options.first().waitFor();
      assert.equal(await save(page).count(), 0);
      await input.press('ArrowDown');
      const content = await options.evaluateAll((elements) =>
        elements.map((element) => {
          const option = element.getBoundingClientRect();
          return {
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
            height: option.height,
            text: [...element.querySelectorAll('strong, span')].map((text) => {
              const range = document.createRange();
              range.selectNodeContents(text);
              const lines = [...range.getClientRects()];
              return {
                lines: lines.length,
                contained: lines.every(
                  (line) =>
                    line.left >= option.left - 1 &&
                    line.right <= option.right + 1 &&
                    line.top >= option.top - 1 &&
                    line.bottom <= option.bottom + 1,
                ),
              };
            }),
          };
        }),
      );
      for (const option of content) {
        assert.ok(option.height >= 60);
        assert.ok(
          option.scrollWidth <= option.width + 1,
          JSON.stringify({ viewportWidth: width, ...option }),
        );
        assert.ok(option.text.every((text) => text.contained));
      }
      assert.ok(content[1].text.every((text) => text.lines === 1));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
      );
      assert.equal(await input.evaluate((e) => document.activeElement === e), true);
      images.push({
        label: `Long city option ${width}`,
        bytes: await page.screenshot({ type: 'png', animations: 'disabled' }),
      });
      await input.press('Enter');
      assert.equal(
        await page.locator('.current-location strong').innerText(),
        'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch',
      );
      assert.equal(await input.evaluate((e) => document.activeElement === e), true);
      await cancel(page).click();
      await saved(page);
      assert.equal(await page.locator('.current-location strong').innerText(), 'Toronto');
      assert.equal(await input.inputValue(), '');
      await context.close();
    }
    checks.push(
      'long city/region/country options fully wrap at 320px/390px/desktop; short results stay tidy, keyboard selection and Cancel work',
    );
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 844 },
      { width: 390, height: 480 },
      { width: 320, height: 480 },
    ]) {
      ({ page, context } = await open({ viewport }));
      await tab(page, 'Style');
      await page.getByRole('button', { name: 'Night', exact: true }).click();
      await tab(page, 'Reminders');
      await page
        .getByRole('button', { name: 'Add reminder', exact: true })
        .click();
      const text = page.getByLabel('Reminder', { exact: true });
      await text.fill('Synthetic focus clearance');
      await text.press('Tab');
      await page.clock.runFor(100);
      const focus = await page.evaluate(() => {
        const input = document.querySelector(
          '.reminder-form input[type="datetime-local"]',
        );
        const field = input.getBoundingClientRect(),
          label = input.closest('label').getBoundingClientRect(),
          bar = document
            .querySelector('.studio-savebar')
            .getBoundingClientRect();
        return {
          active: document.activeElement === input,
          fieldTop: field.top,
          fieldBottom: field.bottom,
          labelTop: label.top,
          barTop: bar.top,
        };
      });
      assert.equal(focus.active, true);
      assert.ok(
        focus.fieldBottom <= focus.barTop - 8,
        JSON.stringify({ viewport, ...focus }),
      );
      assert.ok(focus.labelTop >= 0, JSON.stringify({ viewport, ...focus }));
      images.push({
        label: `Focused reminder field ${viewport.width}×${viewport.height}`,
        bytes: await page.screenshot({ type: 'png', animations: 'disabled' }),
      });
      await context.close();
    }
    checks.push(
      'keyboard-focused reminder field and label stay above fixed Save bar at 390/320px and compact keyboard heights',
    );

    // #83: a later Style save must not reset the saved clock style.
    await reset();
    ({ page, context } = await open());
    await tab(page, 'Widgets');
    await page.getByRole('button', { name: 'Clock', exact: true }).click();
    await page.getByRole('button', { name: 'Analog', exact: true }).click();
    await save(page).click();
    await saved(page);
    assert.equal(app.store.snapshot().settings.appearance.clockStyle, 'analog');
    await tab(page, 'Style');
    await range(page, 'Brightness');
    await save(page).click();
    await saved(page);
    assert.equal(app.store.snapshot().settings.appearance.clockStyle, 'analog');
    assert.notEqual(app.store.snapshot().settings.appearance.brightness, 0.55);
    await page.reload();
    await page.locator('.analog-clock').first().waitFor();
    await page.clock.runFor(500);
    await tab(page, 'Widgets');
    await page.getByRole('button', { name: 'Clock', exact: true }).click();
    assert.equal(
      await page
        .getByRole('button', { name: 'Analog', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await context.close();
    checks.push(
      '#83 clock style Analog survives a later Brightness save and reload',
    );

    // #153, #110, #226: built-in styles are looks only. A personal board (Note added, Drift and
    // fade off, Analog, Text size 125%) survives Night, Room and Phone; Save follows effective changes.
    await reset();
    ({ page, context } = await open());
    const pressedPreset = () =>
      page.locator('.preset-button[aria-pressed="true"]').evaluateAll((els) =>
        els.map((el) => el.querySelector('.preset-label').textContent.trim()),
      );
    await tab(page, 'Widgets');
    await page.getByRole('button', { name: 'Add widget', exact: true }).click();
    await page.getByRole('button', { name: 'Preview Note', exact: true }).click();
    await page.getByRole('button', { name: 'Add Note', exact: true }).click();
    await page.locator('.widget-picker').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Clock', exact: true }).click();
    await page.getByRole('button', { name: 'Analog', exact: true }).click();
    await tab(page, 'Style');
    await page.getByRole('slider', { name: 'Text size', exact: true }).fill('125');
    await page.locator('summary', { hasText: 'Motion' }).click();
    await page
      .getByRole('checkbox', { name: 'Drift and fade between moves', exact: true })
      .uncheck();
    await save(page).click();
    await saved(page);
    const board = structuredClone(app.store.snapshot().settings);
    assert.deepEqual(
      [board.widgets.note, board.appearance.clockStyle, board.appearance.fontScale, board.appearance.motionEnabled],
      [true, 'analog', 1.25, false],
    );
    assert.deepEqual(await pressedPreset(), ['Room'], 'the default look shows Room pressed');
    await page.getByRole('button', { name: 'Night', exact: true }).click();
    await page.locator('.studio-savebar').waitFor();
    assert.deepEqual(await pressedPreset(), ['Night']);
    assert.equal(await page.locator('.preview-frame [data-widget-id="note"]').count(), 1, 'Night keeps the added Note on the canvas');
    assert.equal(await page.locator('.preview-frame .analog-clock').count(), 1, 'Night keeps Analog');
    assert.equal(await page.getByRole('slider', { name: 'Text size', exact: true }).inputValue(), '125', 'Night keeps Text size');
    assert.equal(await page.getByRole('checkbox', { name: 'Drift and fade between moves', exact: true }).isChecked(), false, 'Night keeps Drift and fade off');
    await page.getByRole('button', { name: 'Room', exact: true }).click();
    await saved(page);
    assert.deepEqual(await pressedPreset(), ['Room'], 'back to the saved look: no Save bar');
    await range(page, 'Brightness');
    await page.locator('.studio-savebar').waitFor();
    assert.deepEqual(await pressedPreset(), [], 'a different brightness is no built-in look');
    await range(page, 'Brightness', 'ArrowLeft');
    await saved(page);
    assert.deepEqual(await pressedPreset(), ['Room'], 'reverting the brightness presses Room again');
    await page.getByRole('button', { name: 'Phone', exact: true }).click();
    await save(page).click();
    await saved(page);
    const phone = app.store.snapshot().settings;
    assert.deepEqual(phone.widgets, board.widgets, 'Phone keeps the widget set');
    assert.deepEqual(phone.widgetGrid, board.widgetGrid, 'Phone keeps the layout');
    assert.deepEqual(phone.widgetData, board.widgetData);
    assert.deepEqual(
      { ...phone.appearance, brightness: board.appearance.brightness, accentColor: board.appearance.accentColor, preset: board.appearance.preset },
      board.appearance,
      'Phone changes only its look',
    );
    assert.equal(phone.appearance.brightness, 0.7);
    assert.equal(phone.appearance.motionIntervalSeconds, 180, 'Phone no longer sets a 2-minute interval');
    await page.reload();
    await page.locator('.clock-time, .analog-clock').first().waitFor();
    await tab(page, 'Style');
    assert.deepEqual(await pressedPreset(), ['Phone'], 'the saved look shows Phone pressed after reload');
    checks.push(
      '#153 #110 #226 built-in styles change only the look: Note, Analog, Text size 125% and Drift and fade off survive Night, Room and Phone; the card pressed follows the look (also after a reverted brightness nudge and reload); Save appears only for effective changes; Phone keeps the 3-minute interval',
    );

    // #240: plain Motion wording, with the stable structure other suites rely on.
    await page.locator('summary', { hasText: 'Motion' }).click();
    const motionBody = page.locator('.motion-disclosure .disclosure-body');
    await motionBody.getByRole('checkbox', { name: 'Drift and fade between moves', exact: true }).waitFor();
    await motionBody.getByRole('slider', { name: 'Move widgets every', exact: true }).waitFor();
    assert.match(await motionBody.locator('.motion-hint').innerText(), /^Widgets always move to a new place through black\. With Drift and fade off, or with Animation effects off in Windows Settings › Accessibility › Visual effects on the display PC, they appear without a fade and nothing drifts\.$/);
    assert.equal(await page.getByText(/Soft motion|New arrangement|Reduced motion removes/).count(), 0, 'the old wording is gone');
    checks.push('#240 Motion reads "Drift and fade between moves", "Move widgets every" and a hint naming Windows Animation effects');
    await context.close();

    // #234: Restore from backup. A real export restores after confirmation; unsaved edits, an invalid
    // file, a server-rejected file and "Don't restore" change nothing; the replaced state becomes the
    // recovery backup; Reset appearance asks first.
    await reset();
    const created = new Date(now).toISOString();
    await app.store.update((data) => {
      data.settings.appearance.brightness = 0.4;
      data.settings.savedPresets = [{ id: 'backup-style', name: 'Synthetic backup style', visual: { appearance: data.settings.appearance, widgets: data.settings.widgets, widgetOverrides: data.settings.widgetOverrides, widgetBehavior: data.settings.widgetBehavior, widgetGrid: data.settings.widgetGrid, preview: data.settings.preview } }];
      data.reminders = [
        { id: '00000000-0000-4000-8000-000000000234', text: 'Synthetic backup reminder', completed: false, dueAt: null, createdAt: created, updatedAt: created },
        { id: '00000000-0000-4000-8000-000000000235', text: 'Synthetic done reminder', completed: true, dueAt: null, createdAt: created, updatedAt: created },
      ];
    });
    const backupText = await (await fetch(`${base}/api/export`)).text();
    await reset();
    await app.store.patchSettings({ appearance: { brightness: 0.7 } });
    const current = () => JSON.parse(JSON.stringify(app.store.snapshot()));
    const before = current();
    const stateFile = async (name) => JSON.parse(await readFile(join(directory, name), 'utf8'));
    ({ page, context } = await open());
    await tab(page, 'Style');
    await page.locator('summary', { hasText: 'Data & recovery' }).click();
    const status = page.locator('.data-status');
    const restore = page.getByRole('button', { name: 'Restore from backup…', exact: true });
    let choosers = 0;
    page.on('filechooser', () => { choosers++; });
    const choose = async (text) => {
      const chooser = page.waitForEvent('filechooser');
      await restore.click();
      await (await chooser).setFiles({ name: 'living-room-display-backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    };
    await page.locator('.data-hint').waitFor();
    assert.match(await page.locator('.data-hint').innerText(), /^A backup holds your saved settings, styles and reminders\. Your photo isn't included\.$/);
    assert.equal(await page.getByText(/idle activation|installed helper/).count(), 0, 'the idle-helper sentence is gone');
    // Unsaved edits are refused before any file is chosen.
    await range(page, 'Brightness');
    await restore.click();
    await status.filter({ hasText: 'Save or cancel your changes before restoring a backup.' }).waitFor();
    assert.equal(choosers, 0, 'no file picker while edits are unsaved');
    await cancel(page).click();
    await saved(page);
    // A file that is not an export.
    await choose('{"not":"a backup"}');
    await status.filter({ hasText: "That file isn't a backup. Choose one made with Export saved data." }).waitFor();
    assert.equal(await page.getByRole('group', { name: 'Restore backup' }).count(), 0);
    // A real export: summary, then Don't restore changes nothing.
    await choose(backupText);
    const confirm = page.getByRole('group', { name: 'Restore backup' });
    await confirm.waitFor();
    assert.match((await confirm.innerText()).replace(/\s+/g, ' '), /Restore the backup from Oct 18, 2026, 9:00 AM\? It replaces your saved settings, styles and reminders with the backup's: 2 reminders \(1 completed\) and 1 saved style\. Your photo stays as it is\. What's saved now is kept as this computer's recovery backup until your next save\./);
    await confirm.getByRole('button', { name: "Don't restore", exact: true }).click();
    await confirm.waitFor({ state: 'detached' });
    await status.filter({ hasText: 'Nothing was restored.' }).waitFor();
    assert.deepEqual(current(), before, "Don't restore changes nothing");
    // A file the server rejects changes nothing either.
    const invalid = JSON.parse(backupText); invalid.settings.appearance.brightness = 5;
    await choose(JSON.stringify(invalid));
    await confirm.getByRole('button', { name: 'Restore', exact: true }).click();
    await status.filter({ hasText: /^Could not restore the backup\. settings\.appearance\.brightness/ }).waitFor();
    assert.deepEqual(current(), before, 'a rejected backup changes nothing');
    // The browser logs that expected 400 response; it is the only console error this check allows.
    for (let attempt = 0; attempt < 40 && !errors.some((text) => /status of 400/.test(text)); attempt++) await new Promise((done) => setTimeout(done, 50));
    const rejectedLog = errors.findIndex((text) => /status of 400/.test(text));
    assert.ok(rejectedLog >= 0, 'the rejected import was a 400 response');
    errors.splice(rejectedLog, 1);
    // Restore: the data, the draft and the recovery backup.
    const previousState = await stateFile('state.json');
    await choose(backupText);
    const announcedBefore = await page.locator('.save-announcer').textContent();
    await confirm.getByRole('button', { name: 'Restore', exact: true }).click();
    await status.filter({ hasText: 'Backup restored: 2 reminders (1 completed) and 1 saved style.' }).waitFor();
    const restored = app.store.snapshot(), exported = JSON.parse(backupText);
    assert.equal(restored.settings.appearance.brightness, 0.4);
    assert.deepEqual(restored.reminders, exported.reminders);
    assert.deepEqual(restored.settings.savedPresets.map((style) => style.name), ['Synthetic backup style']);
    assert.deepEqual(await stateFile('state.backup.json'), previousState, 'the replaced state is kept as the recovery backup');
    await page.waitForFunction(() => document.querySelector('input[aria-label="Brightness"]')?.value === '40');
    assert.equal(await page.locator('.studio-savebar').count(), 0, 'the refreshed draft is clean');
    assert.equal(await page.locator('.save-announcer').textContent(), announcedBefore, 'a restore discards no edits, so the Save announcer says nothing new (#229)');
    assert.match(await page.getByRole('tab', { name: /^Reminders/ }).innerText(), /1/, 'the restored reminders reach the editor');
    // Reset appearance asks first; keeping changes nothing.
    await page.getByRole('button', { name: 'Reset appearance…', exact: true }).click();
    const reset234 = page.getByRole('group', { name: 'Reset appearance' });
    assert.match(await reset234.innerText(), /Reset brightness, colours, typeface, Text size and motion to the defaults\? Widgets, their layout, the clock style and saved styles stay\./);
    await reset234.getByRole('button', { name: 'Keep my appearance', exact: true }).click();
    await reset234.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.studio-savebar').count(), 0);
    await page.getByRole('button', { name: 'Reset appearance…', exact: true }).click();
    await reset234.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.locator('.studio-savebar').waitFor();
    await status.filter({ hasText: 'Appearance reset. Save changes to keep it.' }).waitFor();
    assert.equal(await page.getByRole('slider', { name: 'Brightness', exact: true }).inputValue(), '55');
    await cancel(page).click();
    await saved(page);
    await context.close();
    checks.push(
      "#234 Restore from backup: refused with unsaved edits (no file picker), an invalid file and a server-rejected file change nothing, the summary names the date and contents, Don't restore changes nothing, Restore replaces data and reminders, refreshes a clean draft and keeps the replaced state.json as state.backup.json; Reset appearance asks inline and Keep changes nothing",
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
  const result = await runStudioQa(values);
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
