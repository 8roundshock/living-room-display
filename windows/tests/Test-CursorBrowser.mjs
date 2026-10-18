// Optional production-browser regression. Uses an existing Playwright/Edge
// installation and an isolated running source server; never changes app data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { defaultSettings } from '../../src/shared/defaults.ts';

const { values } = parseArgs({ options: {
  'base-url': { type: 'string' }, playwright: { type: 'string' }, edge: { type: 'string' },
} });
const base = new URL(values['base-url'] ?? 'http://127.0.0.1:4318');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Use a loopback test server.');
const { chromium } = createRequire(import.meta.url)(values.playwright ?? 'playwright');
const browser = await chromium.launch({ executablePath: values.edge, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, permissions: [] });
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(10_000);
  const settings = defaultSettings();
  const state = { settings, reminders: [], preview: { available: false, capturedAt: null, width: null, height: null },
    weather: { status: 'unavailable', updatedAt: null, error: 'Synthetic offline weather', source: 'Open-Meteo',
      sourceUrl: 'https://open-meteo.com/', location: settings.location, units: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' },
      current: null, daily: [], hourly: [] } };
  let releaseLoading;
  const loading = new Promise(resolve => { releaseLoading = resolve; });
  let mode = 'loading';
  await context.route('**/api/state', async route => {
    if (mode === 'loading') await loading;
    await route.fulfill({ status: mode === 'error' ? 503 : 200, contentType: 'application/json',
      body: JSON.stringify(mode === 'error' ? { error: 'Synthetic unavailable state' } : state) });
  });
  const page = await context.newPage();
  const exceptions = [];
  page.on('pageerror', error => exceptions.push(error.message));
  const cursors = (target, selectors) => target.evaluate(selectors => selectors.map(selector => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing actual rendered element: ${selector}`);
    return getComputedStyle(element).cursor;
  }), selectors);
  await page.goto(new URL('/display', base).href, { waitUntil: 'domcontentloaded' });
  await page.locator('.loading-page').waitFor({ state: 'visible' });
  assert.deepEqual(await cursors(page, ['html', 'body', '.loading-page', '.loading-orbit']), ['none', 'none', 'none', 'none']);
  mode = 'error'; releaseLoading();
  await page.getByRole('button', { name: 'Try again' }).waitFor({ state: 'visible' });
  assert.deepEqual(await cursors(page, ['html', '.loading-page button']), ['none', 'none']);
  mode = 'ready';
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.locator('.display-page').waitFor({ state: 'visible' });
  await page.mouse.move(100, 100);
  await page.getByRole('link', { name: 'Editor · Esc' }).waitFor({ state: 'visible' });
  assert.deepEqual(await cursors(page, ['html', 'body', '.display-page', '.ambient-widget', '.display-help button', '.display-help a', '.display-help svg']), Array(7).fill('none'));
  assert.equal(await page.evaluate(() => getComputedStyle(document.elementFromPoint(0, 0)).cursor), 'none', 'Viewport edges must also hide the cursor.');
  await page.getByRole('link', { name: 'Editor · Esc' }).click();
  await page.locator('.preview-surface').waitFor({ state: 'visible' });
  assert.equal(await page.locator('html').evaluate(element => element.classList.contains('standalone-display')), false, 'Display document state must be removed on editor navigation.');
  const editorCursors = await cursors(page, ['html', '.preview-surface', '.preview-surface .ambient-widget', '.topbar-actions a']);
  assert.ok(editorCursors.slice(0, 3).every(cursor => cursor !== 'none'), 'Editor and embedded preview must retain normal cursors.');
  assert.equal(editorCursors[3], 'pointer', 'Editor action must retain its usable pointer.');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open display' }).click();
  const popup = await popupPromise;
  await popup.locator('.display-page').waitFor({ state: 'visible' });
  assert.deepEqual(await cursors(popup, ['html', '.ambient-widget']), ['none', 'none']);
  assert.equal((await cursors(page, ['.topbar-actions a']))[0], 'pointer', 'Opening the display must not hide its editor parent cursor.');
  await popup.close();
  assert.deepEqual(exceptions, [], 'No page exceptions are expected.');
  console.log('Production Edge cursor regression PASS: loading/error, viewport, widgets/controls, editor navigation, embedded preview and new display tab. No native cursor claim, capture or saved-state mutation.');
} finally { await browser.close(); }
