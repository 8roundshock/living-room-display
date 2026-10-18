// Production Edge interaction regressions. Own ephemeral loopback server/data;
// synthetic provider and device responses only. Screenshots are RAM buffers.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
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
        !message.text().includes('503')
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
    const input = page.getByRole('combobox', { name: 'Search for a city' });
    await input.fill('Lon');
    await page.clock.runFor(300);
    await page.getByRole('option').first().waitFor();
    await input.press('ArrowDown');
    assert.equal(
      await input.getAttribute('aria-activedescendant'),
      'city-option-0',
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
        .getByRole('combobox', { name: 'Search for a city' })
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
    const input = page.getByRole('combobox', { name: 'Search for a city' });
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
    await page.locator('.ambient-reminders').waitFor({ state: 'detached' });
    await page
      .getByRole('button', { name: 'Show completed (1)', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Delete: Synthetic changed', exact: true })
      .click();
    await page.getByText('Reminder deleted', { exact: true }).waitFor();
    assert.equal(app.store.snapshot().reminders.length, 0);
    checks.push(
      'independent reminder add/edit/complete/delete; confirmed-empty widget hides',
    );
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
      assert.equal(
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
      'four timed compositions fit 1080p and 4K; true black, no audio or ambient geolocation/cursor',
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
