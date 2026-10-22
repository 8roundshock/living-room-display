// Follow daylight brightness (#439) in the production build: display renders at three times of day,
// the minute step and glide, Fixed unchanged, polar days and nights, and the Style tab's Brightness
// mode. Own ephemeral loopback server and temporary data; synthetic location, forecast and settings;
// screenshots stay in RAM.
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
import { keepPagesLocal } from './lib/local-only.mjs';

const TORONTO = { name: 'Toronto', latitude: 43.6532, longitude: -79.3832, timezone: 'America/Toronto' };
const TROMSO = { name: 'Tromsø', latitude: 69.6492, longitude: 18.9553, timezone: 'Europe/Oslo' };
const RANGE = { dimmest: 0.2, brightest: 0.8 };
// Toronto, Tuesday 2026-10-20 (EDT): 2 AM, 10 AM and the solar noon at 13:02.
const TIMES = { night: '2026-10-20T06:00:00Z', morning: '2026-10-20T14:00:00Z', noon: '2026-10-20T17:02:00Z' };

export async function runDaylightQa({ playwright, edge } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-daylight-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  let current = Date.parse(TIMES.noon);
  const app = await createApplication({
    dataDirectory: directory, clientDirectory: join(root, 'dist/client'), now: () => current,
    fetcher: async () => Response.json(forecastFixture()),
  });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [], answeredLists = [];
  let context, page;
  async function reset(update = () => {}) {
    await app.store.update(data => {
      data.settings = defaultSettings();
      data.settings.locationSource = 'manual'; data.settings.location = { ...TORONTO };
      data.reminders = [];
      update(data.settings);
    });
  }
  async function open(path, { time, viewport = { width: 1280, height: 720 }, reducedMotion = 'reduce' } = {}) {
    current = Date.parse(time);
    await context?.close();
    context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', locale: 'en-US', reducedMotion });
    // Requests outside the suite's server (a filtering proxy's script, #315) get an empty answer.
    answeredLists.push(await keepPagesLocal(context, base));
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.clock.install({ time: new Date(time) });
    await page.goto(base + path);
    if (path.startsWith('/editor')) await page.getByRole('button', { name: 'Edit layout', exact: true }).waitFor();
    else await page.locator('.display-page .grid-ambient').waitFor();
    await page.clock.runFor(1500);
  }
  const ambient = (scope = '.display-page') => page.locator(`${scope} .grid-ambient`).first();
  const brightness = async (scope) => ambient(scope).evaluate(element => ({
    value: Number(getComputedStyle(element).getPropertyValue('--ambient-brightness')),
    mode: element.dataset.brightness,
    filter: getComputedStyle(element.querySelector('.ambient-content')).filter,
    transition: getComputedStyle(element.querySelector('.ambient-content')).transition,
  }));
  /** Lit-pixel statistics of a RAM screenshot, decoded in a blank page (no Sharp needed). */
  async function pixels(bytes) {
    const probe = await context.newPage();
    try {
      return await probe.evaluate(async source => {
        const image = new Image(); image.src = source; await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height); const draw = canvas.getContext('2d');
        draw.drawImage(image, 0, 0);
        const data = draw.getImageData(0, 0, image.width, image.height).data;
        let max = 0, lit = 0, sum = 0, nonBlackCorner = 0;
        for (let index = 0; index < data.length; index += 4) {
          const value = Math.max(data[index], data[index + 1], data[index + 2]);
          if (value > max) max = value;
          if (value > 8) { lit++; sum += value; }
        }
        // The top-left 40 px stay exactly black.
        for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) { const index = (y * image.width + x) * 4; if (data[index] || data[index + 1] || data[index + 2]) nonBlackCorner++; }
        return { max, mean: lit ? sum / lit : 0, lit, nonBlackCorner };
      }, `data:image/png;base64,${bytes.toString('base64')}`);
    } finally { await probe.close(); }
  }
  const button = name => page.getByRole('button', { name, exact: true });
  const slider = name => page.getByRole('slider', { name, exact: true });
  const savebar = () => page.locator('.studio-savebar');
  async function styleTab() { await page.getByRole('tab', { name: /^Style/ }).click(); await page.clock.runFor(300); }
  const status = () => page.locator('.daylight-status').innerText();
  const canvas = () => brightness('.preview-frame');

  try {
    // 1. The display at three times of day, against Fixed renders at the expected levels.
    const measured = {};
    for (const [label, time] of Object.entries(TIMES)) {
      await reset(settings => { settings.appearance.daylightBrightness = RANGE; });
      await open('/display', { time });
      const shown = await brightness();
      assert.equal(shown.mode, 'daylight');
      assert.equal(shown.filter, `brightness(${shown.value})`, `${label}: the content filter uses the effective value`);
      const shot = await page.screenshot();
      measured[label] = { ...shown, ...(await pixels(shot)) };
      images.push({ name: `daylight-${label}-1280x720`, bytes: shot });
      // The same instant in Fixed at the measured value paints the same pixels.
      await reset(settings => { settings.appearance.brightness = shown.value; });
      await open('/display', { time });
      const fixed = await brightness();
      assert.equal(fixed.mode, 'fixed'); assert.equal(fixed.value, shown.value);
      const reference = await pixels(await page.screenshot());
      assert.ok(Math.abs(reference.max - measured[label].max) <= 1 && Math.abs(reference.mean - measured[label].mean) <= 0.5,
        `${label}: Follow daylight paints like Fixed at ${shown.value}: ${JSON.stringify([measured[label], reference])}`);
      assert.equal(measured[label].nonBlackCorner, 0, `${label}: unused pixels stay #000`);
    }
    assert.equal(measured.night.value, 0.2, '2 AM is Dimmest');
    assert.ok(measured.noon.value >= 0.799, `solar noon is Brightest: ${measured.noon.value}`);
    assert.ok(measured.morning.value > 0.4 && measured.morning.value < 0.75, `10 AM is in between: ${measured.morning.value}`);
    assert.ok(measured.night.max < measured.morning.max && measured.morning.max < measured.noon.max, `lit pixels brighten through the day: ${JSON.stringify(Object.fromEntries(Object.entries(measured).map(([key, value]) => [key, value.max])))}`);
    checks.push(`display at 2 AM, 10 AM and the 13:02 solar noon in Toronto: --ambient-brightness ${measured.night.value}, ${measured.morning.value}, ${measured.noon.value}; brightest lit pixel ${measured.night.max} < ${measured.morning.max} < ${measured.noon.max}; each render paints like a Fixed render at the same value; unused pixels #000`);

    // 2. The value steps once a minute and the display glides; Fixed has no glide.
    await reset(settings => { settings.appearance.daylightBrightness = RANGE; });
    await open('/display', { time: TIMES.morning });
    const start = await brightness();
    assert.match(start.transition, /filter 10s/, `the display glides: ${start.transition}`);
    await page.clock.runFor(30_000);
    assert.equal((await brightness()).value, start.value, 'no change within the minute');
    await page.clock.runFor(31_000);
    const next = await brightness();
    assert.ok(next.value > start.value && next.value - start.value < 0.01, `the next minute rises a little: ${start.value} → ${next.value}`);
    // Reduced motion and Drift and fade off keep the glide (brightness is not motion).
    await reset(settings => { settings.appearance.daylightBrightness = RANGE; settings.appearance.motionEnabled = false; });
    await open('/display', { time: TIMES.morning, reducedMotion: 'no-preference' });
    assert.match((await brightness()).transition, /filter 10s/, 'Drift and fade off keeps the glide');
    await reset();
    await open('/display', { time: TIMES.morning });
    const fixedDisplay = await brightness();
    assert.deepEqual([fixedDisplay.mode, fixedDisplay.value, fixedDisplay.filter], ['fixed', 0.55, 'brightness(0.55)'], 'Fixed renders the saved level');
    assert.doesNotMatch(fixedDisplay.transition, /filter/, `Fixed has no brightness glide: ${fixedDisplay.transition}`);
    await page.clock.runFor(61_000);
    assert.equal((await brightness()).value, 0.55, 'Fixed never changes with the time');
    checks.push(`the value changes once a minute (${start.value} → ${next.value} at 10 AM) and the display glides over 10 s, also with reduced motion and with Drift and fade off; Fixed renders the saved 0.55 with no glide at any time`);

    // 3. Polar night and polar day at Tromsø.
    await reset(settings => { settings.location = { ...TROMSO }; settings.appearance.daylightBrightness = RANGE; });
    await open('/display', { time: '2026-12-21T10:45:00Z' });
    assert.equal((await brightness()).value, 0.2, 'polar night noon stays Dimmest');
    await open('/display', { time: '2026-06-21T22:45:00Z' });
    const midnightSun = (await brightness()).value;
    assert.ok(midnightSun > 0.2 && midnightSun < 0.4, `midnight sun stays above Dimmest: ${midnightSun}`);
    await open('/display', { time: '2026-06-21T10:44:00Z' });
    assert.ok((await brightness()).value >= 0.799, 'polar day noon is Brightest');
    checks.push(`Tromsø: Dimmest at noon in the polar night; ${midnightSun} at the June solar midnight (never down to Dimmest) and Brightest at its solar noon`);

    // 4. 4K render of the morning display for inspection.
    await reset(settings => { settings.appearance.daylightBrightness = RANGE; });
    await open('/display', { time: TIMES.morning, viewport: { width: 3840, height: 2160 } });
    const fourK = await brightness();
    const fourKShot = await page.screenshot();
    const fourKPixels = await pixels(fourKShot);
    assert.equal(fourKPixels.nonBlackCorner, 0);
    assert.equal(fourK.value, measured.morning.value, '4K shows the same value');
    images.push({ name: 'daylight-morning-3840x2160', bytes: fourKShot });
    checks.push(`3840×2160 at 10 AM: the same ${fourK.value}, black corners`);

    // 5. Style tab: Fixed is the default and keeps the tab's height; Follow daylight is a draft.
    await reset();
    await open('/editor', { time: '2026-10-20T17:05:00Z' });
    await styleTab();
    const modes = page.getByRole('group', { name: 'Brightness mode', exact: true });
    assert.deepEqual(await modes.getByRole('button').evaluateAll(buttons => buttons.map(item => [item.textContent, item.getAttribute('aria-pressed')])), [['Fixed', 'true'], ['Follow daylight', 'false']]);
    assert.equal(await slider('Brightness').inputValue(), '55');
    // In Fixed the mode group sits in no <label> (#466 review): each button keeps its own name, in
    // Playwright's lookup and in Chromium's accessibility tree, and the line's name and value press
    // nothing.
    assert.equal(await button('Fixed').count(), 1, 'Fixed is found by its name while pressed');
    assert.equal(await button('Fixed').getAttribute('aria-pressed'), 'true');
    assert.equal(await button('Follow daylight').getAttribute('aria-pressed'), 'false');
    assert.equal(await modes.evaluate(group => group.closest('label') === null), true, 'the mode group is in no label');
    const cdp = await context.newCDPSession(page);
    const axName = async selector => {
      const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
      return nodes[0]?.name?.value;
    };
    assert.deepEqual([await axName('#brightness-mode-fixed'), await axName('#brightness-mode-daylight'), await axName('input[aria-label="Brightness"]')], ['Fixed', 'Follow daylight', 'Brightness'], 'Chromium names each control on its own');
    await cdp.detach();
    const fixedLine = page.locator('.control-block', { has: slider('Brightness') }).locator('.control-label');
    await fixedLine.locator('> span:first-child').click();
    await fixedLine.locator('output').click(); await page.clock.runFor(200);
    assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'brightness-mode-fixed', 'clicking the name or value does not press Fixed');
    assert.equal(await savebar().count(), 0);
    const fit = await page.locator('.inspector-panel').evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
    assert.ok(fit.scroll <= fit.client + 1, `the default Style tab still fits at 1280×720: ${JSON.stringify(fit)}`);
    // The mode buttons sit on the label line, with a taller hit area that never covers the slider.
    const geometry = await page.evaluate(() => {
      const range = document.querySelector('input[aria-label="Brightness"]').getBoundingClientRect();
      return [...document.querySelectorAll('.brightness-mode > button')].map(item => {
        const box = item.getBoundingClientRect(), x = box.left + box.width / 2;
        return { width: box.width, top: document.elementFromPoint(x, box.top - 8) === item, bottom: document.elementFromPoint(x, box.bottom + 2) === item, overSlider: document.elementFromPoint(x, range.top + range.height / 2) === item, clear: box.bottom <= range.top };
      });
    });
    for (const item of geometry) assert.ok(item.top && item.bottom && !item.overSlider && item.clear && item.width >= 44, JSON.stringify(geometry));
    images.push({ name: 'style-fixed-1280x720', bytes: await page.screenshot() });
    assert.equal((await canvas()).value, 0.55);

    await button('Follow daylight').click(); await page.clock.runFor(200);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'brightness-mode-daylight', 'focus stays on the pressed mode');
    await savebar().waitFor();
    assert.equal(await slider('Brightness').count(), 0);
    assert.deepEqual([await slider('Dimmest').inputValue(), await slider('Brightest').inputValue()], ['28', '70'], 'starts at Night’s 28% and Phone’s 70%');
    assert.match(await status(), /Now 70% · brightest at 1:02\sPM/);
    assert.match(await status(), /weather location \(Toronto\)/);
    const followed = await canvas();
    assert.deepEqual([followed.mode, followed.value], ['daylight', 0.7], 'the canvas shows the current value at once');
    assert.doesNotMatch(followed.transition, /filter [1-9]/, 'the editor canvas has no glide');
    images.push({ name: 'style-daylight-1280x720', bytes: await page.screenshot() });
    // Moving Dimmest past Brightest carries it along, and back.
    await slider('Dimmest').focus();
    await slider('Dimmest').fill('85'); await page.clock.runFor(100);
    assert.deepEqual([await slider('Dimmest').inputValue(), await slider('Brightest').inputValue()], ['85', '85']);
    assert.match(await page.locator('.brightness-daylight > .control-label output').innerText(), /^85%$/);
    await slider('Brightest').fill('30'); await page.clock.runFor(100);
    assert.deepEqual([await slider('Dimmest').inputValue(), await slider('Brightest').inputValue()], ['30', '30']);
    await slider('Dimmest').fill('25'); await slider('Brightest').fill('75'); await page.clock.runFor(100);
    assert.match(await page.locator('.brightness-daylight > .control-label output').innerText(), /^25–75%$/);
    // Fixed again is the saved state: no Save bar. Returning restores this session's range.
    await button('Fixed').click(); await page.clock.runFor(200);
    await savebar().waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'brightness-mode-fixed');
    await button('Follow daylight').click(); await page.clock.runFor(200);
    assert.deepEqual([await slider('Dimmest').inputValue(), await slider('Brightest').inputValue()], ['25', '75'], 'the last range comes back');
    // Built-in styles keep the mode.
    await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('builtin:night');
    await page.getByRole('group', { name: 'Switch style', exact: true }).getByRole('button', { name: 'Save and switch', exact: true }).click();
    await page.getByRole('group', { name: 'Switch style', exact: true }).waitFor({ state: 'detached' }); await page.clock.runFor(200);
    assert.equal(await slider('Dimmest').inputValue(), '25', 'Night keeps Follow daylight');
    assert.equal((await canvas()).value, 0.75, 'and the daylight value');
    await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('builtin:room');
    await page.getByRole('group', { name: 'Switch style', exact: true }).getByRole('button', { name: 'Save and switch', exact: true }).click();
    await page.getByRole('group', { name: 'Switch style', exact: true }).waitFor({ state: 'detached' }); await page.clock.runFor(200);
    await button('Save changes').click(); await savebar().waitFor({ state: 'detached' });
    assert.deepEqual(app.store.snapshot().settings.appearance.daylightBrightness, { dimmest: 0.25, brightest: 0.75 });
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).settings.appearance.daylightBrightness, { dimmest: 0.25, brightest: 0.75 });
    await page.reload(); await button('Edit layout').waitFor(); await page.clock.runFor(500); await styleTab();
    assert.equal(await button('Follow daylight').getAttribute('aria-pressed'), 'true', 'saved through reload');
    // Cancel restores the saved range.
    await slider('Brightest').fill('90'); await savebar().waitFor();
    await button('Cancel').click(); await savebar().waitFor({ state: 'detached' });
    assert.equal(await slider('Brightest').inputValue(), '75');
    // The time follows the Time format.
    await page.getByRole('tab', { name: /^Weather/ }).click(); await page.getByRole('combobox', { name: 'Time format', exact: true }).selectOption('24h');
    await styleTab();
    assert.match(await status(), /Now 75% · brightest at 13:02/);
    await button('Cancel').click(); await savebar().waitFor({ state: 'detached' });
    // An hour later, in the afternoon, the status follows.
    await page.clock.fastForward(60 * 60_000); await page.clock.runFor(1000);
    const afternoon = Number((await status()).match(/Now (\d+)%/)[1]);
    assert.ok(afternoon < 75 && afternoon > 25, `an hour after noon the status falls: ${afternoon}%`);
    checks.push('Style tab: Fixed is pressed by default, named “Fixed” (Playwright and Chromium) in no label, and clicking the line’s name or value presses nothing; the tab still fits at 1280×720; the mode buttons sit on the label line with a hit area above and below that never covers the slider; Follow daylight is a draft starting at 28–70% with “Now 70% · brightest at 1:02 PM” and the canvas at 0.7 at once (no glide); Dimmest and Brightest carry each other; Fixed again hides the Save bar and keeps focus; the session range returns; Night and Room keep the mode; Save persists through reload; Cancel restores; 24-hour time; the status follows the clock');

    // 6. Polar status lines.
    await reset(settings => { settings.location = { ...TROMSO }; settings.appearance.daylightBrightness = RANGE; });
    await open('/editor', { time: '2026-12-21T10:45:00Z' }); await styleTab();
    assert.match(await status(), /Now 20% · the sun stays down today/);
    assert.match(await status(), /Stays at Dimmest while the sun is down/);
    await open('/editor', { time: '2026-06-21T22:45:00Z' }); await styleTab();
    assert.match(await status(), /The sun is up all day/);
    checks.push('polar night reads “Now 20% · the sun stays down today”; polar day says the sun is up all day');

    // 7. 390 and 320 px: no horizontal overflow in either mode.
    for (const width of [390, 320]) {
      await reset(settings => { settings.appearance.daylightBrightness = width === 390 ? RANGE : null; });
      await open('/editor', { time: '2026-10-20T17:05:00Z', viewport: { width, height: 844 } }); await styleTab();
      for (const mode of ['first', 'second']) {
        const overflow = await page.evaluate(() => {
          const panel = document.querySelector('.inspector-panel').getBoundingClientRect();
          const group = document.querySelector('.brightness-mode').getBoundingClientRect();
          return { page: document.documentElement.scrollWidth, width: innerWidth, inside: group.left >= panel.left && group.right <= panel.right };
        });
        assert.ok(overflow.page <= overflow.width && overflow.inside, `${width} px (${mode}): ${JSON.stringify(overflow)}`);
        if (width === 390 && mode === 'first') { await page.locator('.brightness-mode').scrollIntoViewIfNeeded(); images.push({ name: 'style-daylight-390', bytes: await page.screenshot() }); }
        await button(mode === 'first' ? (width === 390 ? 'Fixed' : 'Follow daylight') : (width === 390 ? 'Follow daylight' : 'Fixed')).click(); await page.clock.runFor(200);
      }
    }
    checks.push('390 and 320 px: the Brightness mode stays inside the panel in both modes with no horizontal scroll');

    assert.deepEqual(errors, []);
    return { checks, images, outside: [...new Set(answeredLists.flat())] };
  } finally {
    await context?.close(); await browser.close();
    app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runDaylightQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks, outside: result.outside }, null, 2));
}
