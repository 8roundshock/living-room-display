// World clocks, Sun & moon and Air quality in production Edge (#78). Own ephemeral loopback
// server and data; synthetic geocoding/forecast/air-quality responses. Screenshots are RAM buffers.
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
import { ACTIVE_WIDGET_IDS, GRID_DENSITIES, WIDGET_IDS } from '../../src/shared/widgets.ts';
import { CITIES } from './widget-checks/worldClocks.mjs';

const GEOCODER = {
  lon: { id: 201, name: 'London', latitude: 51.51, longitude: -0.13, timezone: 'Europe/London', admin1: 'England', country: 'United Kingdom' },
  tok: { id: 202, name: 'Tokyo', latitude: 35.68, longitude: 139.69, timezone: 'Asia/Tokyo', admin1: 'Tokyo', country: 'Japan' },
  van: { id: 203, name: 'Vancouver', latitude: 49.28, longitude: -123.12, timezone: 'America/Vancouver', admin1: 'British Columbia', country: 'Canada' },
  syd: { id: 204, name: 'Sydney', latitude: -33.87, longitude: 151.21, timezone: 'Australia/Sydney', admin1: 'New South Wales', country: 'Australia' },
};
function airPayload(scale) {
  const start = Date.parse('2026-10-18T13:00:00Z') / 1000, time = Array.from({ length: 24 }, (_, index) => start + index * 3600);
  return { timezone: 'America/Toronto', current: { time: start, [`${scale}_aqi`]: scale === 'us' ? 42 : 27, [`${scale}_aqi_pm2_5`]: 42, pm2_5: 12, pm10: 18, uv_index: 3 },
    hourly: { time, [`${scale}_aqi`]: time.map((_, index) => 35 + index % 7), uv_index: time.map((_, index) => Math.max(0, 4 - index)) } };
}

export async function runCatalogSkyQa({ playwright, edge } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-catalog-sky-'));
  const now = Date.parse('2026-10-18T13:00:00Z');
  const airRequests = [];
  const app = await createApplication({
    dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), now: () => now,
    fetcher: async input => {
      const url = new URL(input);
      if (url.hostname === 'geocoding-api.open-meteo.com') {
        const city = GEOCODER[url.searchParams.get('name').slice(0, 3).toLowerCase()];
        return Response.json({ results: city ? [city] : [] });
      }
      if (url.hostname === 'air-quality-api.open-meteo.com') { airRequests.push(url); return Response.json(airPayload(url.searchParams.get('hourly').split('_aqi')[0])); }
      return Response.json(forecastFixture());
    },
  });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const errors = [], images = [], checks = [];
  // The catalog board (the default before #435) has room to add these widgets; the #435 default board is full.
  async function reset(update = () => {}) {
    await app.store.update(data => {
      data.settings = catalogBoardDefaults(); data.settings.locationSource = 'manual'; data.reminders = []; data.photoAsset = null;
      update(data.settings);
    });
  }
  async function open({ viewport = { width: 1440, height: 1000 }, route = '/editor', reducedMotion = 'no-preference' } = {}) {
    const context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', reducedMotion });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
    await page.clock.install({ time: new Date(now) });
    await page.goto(base + route);
    await page.locator(route === '/editor' ? '.preview-surface' : '.display-page').waitFor();
    await page.clock.runFor(500);
    return { context, page };
  }
  const tab = async (page, name) => { await page.getByRole('tab', { name, exact: true }).click(); await page.clock.runFor(200); };
  const save = page => page.getByRole('button', { name: 'Save changes', exact: true });
  const cancel = page => page.getByRole('button', { name: 'Cancel', exact: true });
  const clean = page => page.locator('.studio-savebar').waitFor({ state: 'detached' });
  const canvas = (page, id) => page.locator(`.preview-surface [data-widget-id="${id}"]`);
  async function addWidget(page, name) {
    await page.getByRole('button', { name: 'Add widget', exact: true }).click();
    await page.getByRole('button', { name: `Preview ${name}`, exact: true }).click();
    await page.getByRole('button', { name: `Add ${name}`, exact: true }).click();
    await page.clock.runFor(300);
  }
  async function addCity(page, query, expected) {
    const input = page.getByRole('combobox', { name: 'Add a city' });
    await input.focus(); await page.keyboard.type(query);
    await page.clock.runFor(300);
    const option = page.getByRole('listbox', { name: 'Cities' }).getByRole('option').first();
    await option.waitFor();
    await page.keyboard.press('ArrowDown');
    assert.equal(await input.getAttribute('aria-activedescendant'), await option.getAttribute('id'));
    await page.keyboard.press('Enter');
    await page.locator('.world-clock-label').last().waitFor();
    assert.equal(await page.locator('.world-clock-label').last().inputValue(), expected);
  }
  const labels = page => page.locator('.world-clock-label').evaluateAll(inputs => inputs.map(input => input.value));
  const focused = page => page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  try {
    // World clocks: add by keyboard, cap at four, reorder, remove, label validation, persistence.
    await reset();
    let { context, page } = await open();
    // The grouped picker (#157) files the three widgets by catalog category: World clocks under Time,
    // Air quality and Sun & moon under Weather & sky, beside the other units' widgets.
    await page.getByRole('button', { name: 'Add widget', exact: true }).click();
    const groupItems = name => page.getByRole('group', { name, exact: true }).locator('.catalog-item').evaluateAll(items => items.map(item => item.getAttribute('aria-label').replace(/^Preview /, '').replace(/, on your display$/, '')));
    assert.deepEqual(await groupItems('Time'), ['Clock', 'World clocks', 'Calendar']);
    assert.deepEqual(await groupItems('Weather & sky'), ['Weather', 'Forecast', 'Air quality', 'Sun & moon']);
    assert.deepEqual(await groupItems('Personal'), ['Reminders', 'Countdown', 'Note']);
    await page.getByRole('button', { name: 'Close widget picker', exact: true }).click(); await page.clock.runFor(200);
    checks.push('Grouped picker (#157): World clocks under Time; Air quality and Sun & moon under Weather & sky');
    await addWidget(page, 'World clocks');
    assert.match(await canvas(page, 'worldClocks').innerText(), /Add a city/, 'editor placeholder without cities');
    assert.match(await page.locator('.world-clock-editor').innerText(), /Times follow each city's time zone and daylight saving\./);
    for (const [query, label] of [['Lon', 'London'], ['Tok', 'Tokyo'], ['Van', 'Vancouver'], ['Syd', 'Sydney']]) await addCity(page, query, label);
    assert.deepEqual(await labels(page), ['London', 'Tokyo', 'Vancouver', 'Sydney']);
    assert.equal(await page.getByRole('combobox', { name: 'Add a city' }).isDisabled(), true, 'the add field is disabled at four cities');
    assert.match(await page.locator('.world-clock-editor').innerText(), /Up to 4 cities/);
    assert.match(await page.locator('.world-clock-editor').innerText(), /England, United Kingdom/);
    await page.getByRole('button', { name: 'Move Tokyo up', exact: true }).focus(); await page.keyboard.press('Enter'); await page.clock.runFor(50);
    assert.deepEqual(await labels(page), ['Tokyo', 'London', 'Vancouver', 'Sydney']);
    assert.equal(await focused(page), 'Move Tokyo down', 'focus stays on the moved city when it reaches the top');
    await page.keyboard.press('Enter'); await page.clock.runFor(50);
    assert.deepEqual(await labels(page), ['London', 'Tokyo', 'Vancouver', 'Sydney']); assert.equal(await focused(page), 'Move Tokyo down');
    await page.getByRole('button', { name: 'Remove Vancouver', exact: true }).focus(); await page.keyboard.press('Enter'); await page.clock.runFor(50);
    assert.deepEqual(await labels(page), ['London', 'Tokyo', 'Sydney']); assert.equal(await focused(page), 'Remove Sydney');
    assert.equal(await page.getByRole('combobox', { name: 'Add a city' }).isDisabled(), false);
    // #192: each label field keeps one name while typing or empty; the row's region and time describe it.
    const london = page.getByRole('textbox', { name: 'City 1 label', exact: true });
    assert.equal(await london.inputValue(), 'London');
    const description = await london.getAttribute('aria-describedby');
    assert.match(await page.locator(`[id="${description}"]`).textContent(), /England, United Kingdom/, 'described by its region and current time');
    await london.fill('');
    assert.equal(await save(page).isDisabled(), true, 'an empty label blocks Save');
    assert.match(await page.locator('.save-status').innerText(), /Each world clock needs a label/);
    assert.equal(await london.getAttribute('aria-label'), 'City 1 label', 'the name does not change when the field is cleared');
    assert.equal(await london.getAttribute('aria-invalid'), 'true');
    const [errorId] = (await london.getAttribute('aria-describedby')).split(' ');
    assert.equal(await page.locator(`[id="${errorId}"]`).textContent(), 'Enter a label', 'the error stays associated');
    await london.pressSequentially('Ho');
    assert.equal(await london.getAttribute('aria-label'), 'City 1 label', 'the name does not change while typing');
    await london.fill('Home');
    assert.equal(await london.getAttribute('aria-invalid'), null);
    assert.equal(await save(page).isDisabled(), false);
    assert.deepEqual(await canvas(page, 'worldClocks').locator('.wc-name').allTextContents(), ['Home'], 'canvas follows the draft');
    images.push({ label: 'World clocks editor 1440', bytes: await page.screenshot({ type: 'png', animations: 'disabled' }) });
    await save(page).click(); await clean(page);
    assert.deepEqual(app.store.snapshot().settings.widgetData.worldClocks.map(city => city.label), ['Home', 'Tokyo', 'Sydney']);
    await page.reload(); await page.locator('.preview-surface').waitFor(); await page.clock.runFor(300);
    assert.equal(await page.locator('.studio-savebar').count(), 0, 'Save bar hidden while clean');
    await page.getByRole('button', { name: 'World clocks', exact: true }).click();
    assert.deepEqual(await labels(page), ['Home', 'Tokyo', 'Sydney'], 'persisted after reload');
    // An edit and its reversal is not dirty.
    await page.getByRole('textbox', { name: 'City 1 label', exact: true }).fill('Homes'); await page.locator('.studio-savebar').waitFor();
    await page.getByRole('textbox', { name: 'City 1 label', exact: true }).fill('Home'); await clean(page);
    checks.push('World clocks: keyboard city search, max 4, keyboard reorder/remove with focus kept, empty label blocks Save, label fields keep a stable name while typing or empty with the error and row details as descriptions (#192), editor placeholder, Save bar only while dirty, reload persists');

    // Built-in and saved styles change visuals only; the cities stay.
    await tab(page, 'Style');
    await page.getByRole('button', { name: 'Night', exact: true }).click();
    await save(page).click(); await clean(page);
    assert.equal(app.store.snapshot().settings.widgetData.worldClocks.length, 3, 'a built-in style keeps world clocks');
    await page.locator('summary', { hasText: 'Saved styles' }).click();
    await page.getByRole('textbox', { name: 'Style name' }).fill('Synthetic evening');
    await page.getByRole('button', { name: 'Add style', exact: true }).click();
    await save(page).click(); await clean(page);
    await page.getByRole('combobox', { name: 'Saved style' }).selectOption({ label: 'Synthetic evening' });
    await page.getByRole('button', { name: 'Room', exact: true }).click();
    if (await page.locator('.studio-savebar').count()) { await save(page).click(); await clean(page); }
    assert.equal(app.store.snapshot().settings.widgetData.worldClocks.length, 3, 'saved styles keep world clocks');
    assert.equal(JSON.stringify(app.store.snapshot().settings.savedPresets).includes('Tokyo'), false, 'styles never contain world clock content');
    checks.push('Built-in and saved styles do not erase or capture world clocks');
    await context.close();

    // Air quality: draft preview through the local API only, Cancel discards it.
    await reset(); airRequests.length = 0;
    ({ context, page } = await open());
    const previews = [];
    page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/api/air-quality') previews.push(url.searchParams.get('scale')); if (url.hostname !== '127.0.0.1') errors.push(`browser reached ${url.hostname}`); });
    assert.equal(airRequests.length, 0, 'no provider request while Air quality is off');
    await addWidget(page, 'Air quality');
    await canvas(page, 'airQuality').getByText('42', { exact: true }).waitFor();
    assert.deepEqual(previews, ['us']);
    assert.match(await canvas(page, 'airQuality').innerText(), /US AQI[\s\S]*Good[\s\S]*Model est\.[\s\S]*CAMS · Open-Meteo/);
    assert.match(await page.locator('.widget-inspector').innerText(), /Model estimate from Copernicus CAMS via Open-Meteo for your weather location\. Canada's AQHI and local sensors are not available\./);
    await page.getByRole('combobox', { name: 'Air quality scale' }).selectOption('european');
    await canvas(page, 'airQuality').getByText('European AQI').waitFor();
    assert.deepEqual(previews, ['us', 'european']);
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/air-quality');
    await page.clock.runFor(5 * 60_000 + 500); await refreshed;
    assert.ok(previews.length >= 3 && previews.at(-1) === 'european', 'the preview refreshes every 5 minutes');
    await cancel(page).click(); await clean(page);
    assert.equal(await canvas(page, 'airQuality').count(), 0, 'Cancel removes the unsaved widget and its preview');
    await addWidget(page, 'Air quality'); await canvas(page, 'airQuality').getByText('US AQI').waitFor();
    await save(page).click(); await clean(page);
    await page.clock.runFor(30_500); // next /api/state poll carries the saved reading
    await canvas(page, 'airQuality').getByText('US AQI').waitFor();
    const beforeScale = previews.length;
    await page.getByRole('combobox', { name: 'Air quality scale' }).selectOption('european');
    await canvas(page, 'airQuality').getByText('European AQI').waitFor();
    assert.equal(previews.length, beforeScale + 1);
    await cancel(page).click(); await clean(page);
    await canvas(page, 'airQuality').getByText('US AQI').waitFor();
    assert.equal(await canvas(page, 'airQuality').getByText('European AQI').count(), 0, 'Cancel discards the scale preview');
    images.push({ label: 'Air quality editor 1440', bytes: await page.screenshot({ type: 'png', animations: 'disabled' }) });
    checks.push('Air quality: no provider call while off, draft preview via /api/air-quality, scale preview and 5-minute refresh, Cancel discards both, saved reading after Save');

    // Sun & moon: hint and calculated times on the canvas.
    await addWidget(page, 'Sun & moon');
    assert.match(await page.locator('.widget-inspector').innerText(), /Uses your weather location \(Toronto\); times are calculated on this computer\./);
    assert.match(await canvas(page, 'sunMoon').innerText(), /Sunset/);
    await cancel(page).click(); await clean(page);
    checks.push('Sun & moon: settings hint with the weather location and a calculated next event');
    await context.close();

    // Phone widths: reflow and focused fields clear of the fixed Save bar.
    await reset(settings => { settings.widgets.worldClocks = true; settings.widgetData.worldClocks = structuredClone(CITIES.slice(0, 2)); });
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 844 }, { width: 320, height: 480 }]) {
      ({ context, page } = await open({ viewport }));
      await page.getByRole('button', { name: 'World clocks', exact: true }).click();
      await page.getByRole('textbox', { name: 'City 1 label', exact: true }).fill('London office');
      await page.locator('.studio-savebar').waitFor();
      // Reach each field with Tab from the control before it, as a keyboard user would.
      for (const [from, target] of [['Remove London office', 'City 2 label'], ['Remove Tokyo', 'Add a city']]) {
        await page.getByRole('button', { name: from, exact: true }).focus();
        await page.keyboard.press('Tab'); await page.clock.runFor(100);
        const position = await page.evaluate(name => {
          const element = document.activeElement, rect = element.getBoundingClientRect(), bar = document.querySelector('.studio-savebar').getBoundingClientRect();
          return { name: element.getAttribute('aria-label'), bottom: rect.bottom, top: rect.top, barTop: bar.top, overflow: document.documentElement.scrollWidth - innerWidth, expected: name };
        }, target);
        assert.equal(position.name, target, JSON.stringify(position));
        assert.ok(position.bottom <= position.barTop - 4 && position.top >= 0, JSON.stringify({ viewport, ...position }));
        assert.ok(position.overflow <= 1, `no horizontal overflow at ${viewport.width}px`);
      }
      images.push({ label: `World clocks panel ${viewport.width}×${viewport.height}`, bytes: await page.screenshot({ type: 'png', animations: 'disabled' }) });
      await context.close();
    }
    checks.push('390/320 px reflow: keyboard-focused World clocks fields stay above the fixed Save bar with no horizontal overflow');

    // Every active widget at small size: relocation phases and black intervals stay collision-free.
    await reset(settings => {
      settings.widgetBehavior.reminders.hideWhenEmpty = false;
      settings.widgetData.worldClocks = structuredClone(CITIES);
      const { columns } = GRID_DENSITIES.balanced;
      ACTIVE_WIDGET_IDS.forEach((id, index) => {
        settings.widgets[id] = true;
        settings.widgetGrid.placements[id] = { column: (index * 2) % columns, row: Math.floor(index * 2 / columns) * 2, size: 'small' };
      });
    });
    for (const reducedMotion of ['no-preference', 'reduce']) for (const viewport of [{ width: 1280, height: 720 }, { width: 3840, height: 2160 }]) {
      ({ context, page } = await open({ route: '/display', viewport, reducedMotion }));
      const phases = [];
      const check = async label => {
        const result = await page.evaluate(() => {
          const boxes = [...document.querySelectorAll('.ambient-widget')].map(element => ({ id: element.dataset.widgetId, r: element.getBoundingClientRect() })), bad = [];
          for (const { id, r } of boxes) if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) bad.push(`${id} outside`);
          for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i].r, b = boxes[j].r;
            if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) bad.push(`${boxes[i].id}/${boxes[j].id} overlap`);
          }
          return { bad, ids: boxes.map(box => box.id), composition: document.querySelector('.ambient').dataset.composition, fading: document.querySelector('.ambient-content').classList.contains('fading') };
        });
        assert.deepEqual(result.bad, [], `${reducedMotion} ${viewport.width} ${label}`);
        phases.push({ label, ...result });
        return result;
      };
      const rest = await check('rest');
      for (const id of ['worldClocks', 'airQuality', 'sunMoon']) assert.ok(rest.ids.includes(id), `${id} renders on the dense board`);
      for (let cycle = 0; cycle < 4; cycle++) {
        await page.clock.runFor(180_000 - (cycle ? 3_200 : 0)); // fade starts
        assert.equal((await check(`cycle ${cycle} fade`)).fading, true);
        await page.clock.runFor(reducedMotion === 'reduce' ? 50 : 2_050); // black: composition changes
        const black = await check(`cycle ${cycle} black`);
        assert.equal(black.fading, true, 'new composition waits behind black'); assert.equal(black.composition, String(cycle + 1));
        await page.clock.runFor(reducedMotion === 'reduce' ? 3_150 : 1_150);
        assert.equal((await check(`cycle ${cycle} revealed`)).fading, false);
      }
      assert.ok(new Set(phases.map(phase => phase.composition)).size >= 5, 'relocation continues, including with reduced motion');
      if (viewport.width === 1280) images.push({ label: `Dense small board ${reducedMotion}`, bytes: await page.screenshot({ type: 'png', animations: 'disabled' }) });
      await context.close();
    }
    checks.push(`All active widgets small (${ACTIVE_WIDGET_IDS.length}): every relocation phase and black interval collision-free at 1280×720 and 4K, with and without reduced motion`);
    assert.deepEqual(errors, []);
    return { checks, images };
  } finally {
    await browser.close(); app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runCatalogSkyQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks, images: 'RAM buffers only; visual inspection is a separate check.' }, null, 2));
}
