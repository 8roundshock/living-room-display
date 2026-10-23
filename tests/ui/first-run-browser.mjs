import { mockWindowsStatus } from './lib/windows-fixture.mjs';
// First-run location setup (#252), bounded editor rows (#310/#349), Settings time/units (#235) and Home count (#241)
// in the production build. Own ephemeral loopback server and data; synthetic location, geocoding and
// reminders; screenshots stay in RAM.
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
import { defaultWidgetGrid, defaultWidgetVisibility } from '../../src/shared/widgets.ts';

const CITIES = { results: [{ id: 201, name: 'London', latitude: 51.5, longitude: -0.1, timezone: 'Europe/London', admin1: 'England', country: 'United Kingdom' }] };

export async function runFirstRunQa({ playwright, edge } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-first-run-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const now = Date.parse('2026-10-18T13:00:00Z'); // Sunday 09:00 in Toronto
  const app = await createApplication({
    dataDirectory: directory, clientDirectory: join(root, 'dist/client'), now: () => now,
    fetcher: async input => new URL(input).hostname === 'geocoding-api.open-meteo.com' ? Response.json(CITIES) : Response.json(forecastFixture()),
  });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  let context, page;
  const button = name => page.getByRole('button', { name, exact: true });
  const savebar = () => page.locator('.settings-savebar');
  const at = new Date(now).toISOString();
  const synthetic = [
    { id: '00000000-0000-4000-8000-000000000001', text: 'Water the plants', completed: false, dueAt: '2026-10-18T22:00:00.000Z', createdAt: at, updatedAt: at },
    { id: '00000000-0000-4000-8000-000000000002', text: 'Call a friend', completed: false, dueAt: null, createdAt: at, updatedAt: at },
    { id: '00000000-0000-4000-8000-000000000003', text: 'Plan the weekend', completed: false, dueAt: null, createdAt: at, updatedAt: at },
  ];
  async function reset(update = () => {}) {
    await app.store.update(data => { data.settings = defaultSettings(); data.reminders = structuredClone(synthetic); update(data.settings); });
  }
  /** `geo` answers an explicit lookup: success, denied, or none (permission is "prompt" either way). */
  async function open({ viewport = { width: 1280, height: 720 }, geo = 'success', fresh = true, route = '/editor' } = {}) {
    if (fresh) { await context?.close(); context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', locale: 'en-US', reducedMotion: 'reduce' }); await mockWindowsStatus(context); }
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(geo => {
      Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } });
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (success, failure) => geo === 'denied' ? failure({ code: 1 }) : success({ coords: { latitude: 43.71234, longitude: -79.41234, accuracy: 50 } }) } });
    }, geo);
    await page.clock.install({ time: new Date(now) });
    await page.goto(base + route); await page.locator(route.startsWith('/settings') ? '.settings-page' : route === '/' ? '.home-page' : '.editor-with-styles').waitFor(); await page.clock.runFor(500);
  }
  async function tab(name) { await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click(); await page.clock.runFor(200); }
  const panelFit = () => page.locator('.inspector-panel').evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
  try {
    // Location belongs Settings; entering any page must never silently ask for GPS.
    await reset(); await open();
    assert.deepEqual(await page.getByRole('tab').allTextContents(), ['Style', 'Widgets']);
    assert.equal(await page.locator('.first-run-card').count(), 0);
    let fit = await panelFit();
    assert.ok(fit.scroll <= fit.client + 1, `Widgets fits at 1280x720: ${JSON.stringify(fit)}`);
    await page.goto(base + '/'); await page.locator('.home-page').waitFor();
    await page.locator('.home-first-run').getByRole('link', { name: 'Choose your city' }).click();
    await page.waitForURL(`${base}/settings?focus=city`);
    await page.waitForFunction(() => document.activeElement?.id === 'city-search');
    let city = page.getByRole('combobox', { name: 'City', exact: true });
    assert.match(await page.locator(`[id="${await city.getAttribute('aria-describedby')}"]`).textContent(), /search/i);
    assert.equal(await savebar().count(), 0);
    checks.push('Home location setup opens Settings with City focused; Editor is visual-only and has no location card');

    await button('Use device location').click(); await page.clock.runFor(100);
    await savebar().waitFor();
    assert.equal(await page.locator('.current-location strong').innerText(), 'Device area');
    assert.equal(app.store.snapshot().settings.locationSource, 'fallback');
    await button('Cancel').click(); await savebar().waitFor({ state: 'detached' });
    assert.equal(await page.locator('.current-location strong').innerText(), 'Toronto');
    await open({ route: '/settings', geo: 'denied' });
    await button('Use device location').click(); await page.clock.runFor(100);
    await page.getByText('Location blocked. Choose a city instead.', { exact: true }).waitFor();
    assert.equal(await savebar().count(), 0);
    assert.equal(app.store.snapshot().settings.locationSource, 'fallback');
    checks.push('Explicit device area is rounded and stays an unsaved cancellable draft; denied lookup keeps the saved city');

    city = page.getByRole('combobox', { name: 'City', exact: true });
    await city.fill('Lon'); await page.clock.runFor(300);
    await page.getByRole('option').first().waitFor();
    await city.press('ArrowDown'); await city.press('Enter');
    await savebar().waitFor();
    assert.equal(app.store.snapshot().settings.location.name, 'Toronto');
    await button('Save changes').click(); await savebar().waitFor({ state: 'detached' });
    assert.equal(app.store.snapshot().settings.locationSource, 'manual');
    assert.equal(app.store.snapshot().settings.location.name, 'London');
    await page.reload(); await page.locator('.settings-page').waitFor();
    assert.equal(await page.locator('.current-location strong').innerText(), 'London');
    await page.goto(base + '/'); await page.locator('.home-page').waitFor();
    assert.equal(await page.locator('.home-first-run').count(), 0);
    await page.goto(base + '/editor?focus=city');
    await page.waitForURL(`${base}/settings?focus=city`);
    await page.waitForFunction(() => document.activeElement?.id === 'city-search');
    checks.push('Keyboard-selected city persists only on Save; Home tip disappears after saving; legacy city links redirect to Settings with focus');

    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await open({ viewport, route: '/settings' });
      for (const control of [page.getByRole('combobox', { name: 'City', exact: true }), button('Use device location')]) {
        await control.scrollIntoViewIfNeeded();
        const geometry = await control.evaluate(element => { const r = element.getBoundingClientRect(); return { width:r.width, height:r.height, left:r.left, right:r.right, viewport:innerWidth, hit:element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)) }; });
        assert.ok(geometry.height >= 44 && geometry.left >= 0 && geometry.right <= geometry.viewport && geometry.hit, JSON.stringify(geometry));
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      images.push({ name: `settings-location-${viewport.width}`, bytes: await page.screenshot() });
    }
    checks.push('City/device controls retain 44 px targets and reachable pointer hit areas at 1280, 390 and 320 px without horizontal overflow');

    // Preserve the original short-desktop board/row reachability guard after removing the card.
    for (const currentBoard of [true, false]) {
      await reset(settings => { if (!currentBoard) { settings.widgets=defaultWidgetVisibility(); settings.widgetGrid=defaultWidgetGrid(); } });
      for (const viewport of [{width:1280,height:600},{width:1024,height:600},{width:760,height:600}]) {
        await open({ viewport }); fit=await panelFit();
        const rows=page.locator('.widget-option');
        assert.equal(await rows.count(), currentBoard ? 6 : 5);
        const rowPitch=await rows.evaluateAll(elements => elements[1].getBoundingClientRect().top-elements[0].getBoundingClientRect().top);
        assert.ok(fit.scroll <= fit.client+(currentBoard ? rowPitch : 0)+1, `${viewport.width}x600: ${JSON.stringify(fit)}`);
        for (const control of await page.locator('.widget-row button, .add-widget').all()) {
          await control.focus(); await control.scrollIntoViewIfNeeded();
          const box=await control.boundingBox(), panel=await page.locator('.inspector-panel').boundingBox();
          const minimum=await control.evaluate(element => element.classList.contains('add-widget') ?40:44);
          assert.ok(box.width>=minimum && box.height>=minimum && box.y>=panel.y-1 && box.y+box.height<=panel.y+panel.height+1, JSON.stringify({box,panel}));
          assert.equal(await control.evaluate(element => { const r=element.getBoundingClientRect(); return element===document.activeElement && element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }), true);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1), true);
      }
    }
    checks.push('Five-row board still fits; six-row default has at most one extra row of internal scroll at 1280/1024/760x600; every row action retains its original 44 px target and unobscured focus');

    await reset(settings => { settings.widgets.clock=false; settings.locationSource='manual'; });
    await open({ route:'/settings' });
    assert.equal(await page.getByRole('combobox',{name:'Units',exact:true}).count(),1);
    const format=page.getByRole('combobox',{name:'Time format',exact:true});
    await format.selectOption('24h'); await savebar().waitFor();
    assert.equal(app.store.snapshot().settings.clockFormat,'12h');
    await button('Cancel').click(); await savebar().waitFor({state:'detached'});
    assert.equal(await format.inputValue(),'12h');
    await format.selectOption('24h'); await button('Save changes').click(); await savebar().waitFor({state:'detached'});
    assert.equal(app.store.snapshot().settings.clockFormat,'24h');
    await page.goto(base+'/'); await page.locator('.home-page').waitFor();
    assert.equal(await page.getByRole('button',{name:/^All reminders/}).textContent().then(text=>text.trim()),'All reminders · 3');
    await page.getByRole('button',{name:/^All reminders/}).click();
    assert.match(await page.locator('.reminders-panel').innerText(),/Today · 18:00/);
    await page.getByRole('button',{name:'Close All reminders',exact:true}).click();
    await page.goto(base+'/editor'); await page.locator('.preview-frame [data-widget-id="reminders"]').waitFor();
    assert.match(await page.locator('.preview-frame [data-widget-id="reminders"]').innerText(),/18:00/);
    checks.push('With Clock off, Settings units/time format remains available; Cancel restores, Save persists, Home count and reminder list plus editor canvas reflect 24-hour time');

    assert.deepEqual(errors, []);
    return { checks, images };
  } finally {
    await context?.close(); await browser.close();
    app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runFirstRunQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks }, null, 2));
}
