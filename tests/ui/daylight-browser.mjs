// Follow daylight brightness (#439, curve and dim time #591) in the production build: display renders
// at four times of day, the minute step and glide, Fixed unchanged, the dim time, polar days and
// nights, and the Style tab's Brightness mode. Own ephemeral loopback server and temporary data; synthetic location, forecast and settings;
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
const RANGE = { dimmest: 0.2, brightest: 0.8, dimTime: '23:00' };
// Toronto, Tuesday 2026-10-20 (EDT; sunrise 7:37 AM, sunset 6:26 PM): 2 AM, 7:35 AM in the dawn,
// 10 AM and 8 PM.
const TIMES = { night: '2026-10-20T06:00:00Z', dawn: '2026-10-20T11:35:00Z', day: '2026-10-20T14:00:00Z', evening: '2026-10-21T00:00:00Z' };

export async function runDaylightQa({ playwright, edge } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-daylight-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  let current = Date.parse(TIMES.day);
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
  const status = () => page.locator('.daylight-now').innerText();
  const canvas = () => brightness('.preview-frame');

  try {
    // 1. The display at four times of day, against Fixed renders at the expected levels.
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
    assert.ok(measured.dawn.value > 0.35 && measured.dawn.value < 0.55, `just before sunrise is part of the way up: ${measured.dawn.value}`);
    assert.equal(measured.day.value, 0.8, '10 AM is already Brightest');
    assert.equal(measured.evening.value, 0.59, '8 PM holds the evening level, 0.65 of the range');
    assert.ok(measured.night.max < measured.dawn.max && measured.dawn.max < measured.evening.max && measured.evening.max < measured.day.max, `lit pixels follow the levels: ${JSON.stringify(Object.fromEntries(Object.entries(measured).map(([key, value]) => [key, value.max])))}`);
    checks.push(`display at 2 AM, 7:35 AM, 10 AM and 8 PM in Toronto: --ambient-brightness ${measured.night.value}, ${measured.dawn.value}, ${measured.day.value}, ${measured.evening.value}; brightest lit pixel ${measured.night.max} < ${measured.dawn.max} < ${measured.evening.max} < ${measured.day.max}; each render paints like a Fixed render at the same value; unused pixels #000`);

    // 2. The value steps once a minute and the display glides; Fixed has no glide.
    await reset(settings => { settings.appearance.daylightBrightness = RANGE; });
    await open('/display', { time: TIMES.dawn });
    const start = await brightness();
    assert.match(start.transition, /filter 10s/, `the display glides: ${start.transition}`);
    await page.clock.runFor(30_000);
    assert.equal((await brightness()).value, start.value, 'no change within the minute');
    await page.clock.runFor(31_000);
    const next = await brightness();
    assert.ok(next.value > start.value && next.value - start.value < 0.025, `the next minute of dawn rises a little: ${start.value} → ${next.value}`);
    // Reduced motion and Drift and fade off keep the glide (brightness is not motion).
    await reset(settings => { settings.appearance.daylightBrightness = RANGE; settings.appearance.motionEnabled = false; });
    await open('/display', { time: TIMES.dawn, reducedMotion: 'no-preference' });
    assert.match((await brightness()).transition, /filter 10s/, 'Drift and fade off keeps the glide');
    await reset();
    await open('/display', { time: TIMES.dawn });
    const fixedDisplay = await brightness();
    assert.deepEqual([fixedDisplay.mode, fixedDisplay.value, fixedDisplay.filter], ['fixed', 0.55, 'brightness(0.55)'], 'Fixed renders the saved level');
    assert.doesNotMatch(fixedDisplay.transition, /filter/, `Fixed has no brightness glide: ${fixedDisplay.transition}`);
    await page.clock.runFor(61_000);
    assert.equal((await brightness()).value, 0.55, 'Fixed never changes with the time');
    checks.push(`the value changes once a minute (${start.value} → ${next.value} in the dawn) and the display glides over 10 s, also with reduced motion and with Drift and fade off; Fixed renders the saved 0.55 with no glide at any time`);

    // 3. Polar night and polar day at Tromsø.
    await reset(settings => { settings.location = { ...TROMSO }; settings.appearance.daylightBrightness = RANGE; });
    await open('/display', { time: '2026-12-21T10:45:00Z' });
    const polarNoon = (await brightness()).value;
    assert.ok(polarNoon >= 0.59 && polarNoon < 0.66, `polar night noon: the evening level plus a little twilight: ${polarNoon}`);
    await open('/display', { time: '2026-12-21T06:00:00Z' });
    assert.equal((await brightness()).value, 0.2, 'the polar night morning rests at Dimmest');
    await open('/display', { time: '2026-06-21T22:45:00Z' });
    const midnightSun = (await brightness()).value;
    assert.ok(midnightSun > 0.7 && midnightSun < 0.8, `the midnight sun, 3° up after the dim time, stays near Brightest: ${midnightSun}`);
    await open('/display', { time: '2026-06-21T10:44:00Z' });
    assert.ok((await brightness()).value >= 0.799, 'polar day noon is Brightest');
    checks.push(`Tromsø: Dimmest in the polar night's morning and ${polarNoon} at its noon; ${midnightSun} at the June solar midnight, after the dim time, and Brightest at its solar noon`);

    // 3b. The dim time (#591), also after midnight: 11:40 PM in Toronto.
    const late = {};
    for (const dimTime of ['23:00', '00:00', '00:30']) {
      await reset(settings => { settings.appearance.daylightBrightness = { ...RANGE, dimTime }; });
      await open('/display', { time: '2026-10-21T03:40:00Z' });
      late[dimTime] = (await brightness()).value;
    }
    assert.deepEqual(late, { '23:00': 0.2, '00:00': 0.59, '00:30': 0.59 }, 'Dimmest once the 11 PM ramp has finished; still the evening level with a dim time after midnight');
    await open('/display', { time: '2026-10-21T04:45:00Z' });
    const ramp = (await brightness()).value;
    assert.equal(ramp, 0.395, '12:45 AM is half way down the 12:30 AM ramp');
    await open('/display', { time: '2026-10-21T05:00:00Z' });
    assert.equal((await brightness()).value, 0.2, '1 AM is Dimmest');
    // A range saved before #591 has no dim time: it dims at 11 PM.
    await reset(settings => { settings.appearance.daylightBrightness = { dimmest: 0.2, brightest: 0.8 }; });
    await open('/display', { time: '2026-10-21T02:00:00Z' });
    assert.equal((await brightness()).value, 0.59, 'a range without the key holds the evening level at 10 PM');
    await open('/display', { time: '2026-10-21T03:40:00Z' });
    assert.equal((await brightness()).value, 0.2, 'and is at Dimmest by 11:40 PM');
    checks.push(`dim time at 11:40 PM in Toronto: ${JSON.stringify(late)}; 12:45 AM is half way down the 12:30 AM ramp (${ramp}) and 1 AM is Dimmest; a range without the key dims at 11 PM`);

    // 4. 4K render of the dawn display for inspection.
    await reset(settings => { settings.appearance.daylightBrightness = RANGE; });
    await open('/display', { time: TIMES.dawn, viewport: { width: 3840, height: 2160 } });
    const fourK = await brightness();
    const fourKShot = await page.screenshot();
    const fourKPixels = await pixels(fourKShot);
    assert.equal(fourKPixels.nonBlackCorner, 0);
    assert.equal(fourK.value, measured.dawn.value, '4K shows the same value');
    images.push({ name: 'daylight-dawn-3840x2160', bytes: fourKShot });
    checks.push(`3840×2160 at 7:35 AM: the same ${fourK.value}, black corners`);

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
    await fixedLine.locator('> label:first-child').click();
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
    assert.match(await status(), /^Now 70% · brightest since 8:1\d\sAM · dims at 11:00\sPM$/);
    // #591: the dim time, 11 PM by default, half hours from 8 PM to 3 AM with midnight named.
    const dimAt = page.getByRole('combobox', { name: 'Dim at', exact: true });
    assert.equal(await dimAt.inputValue(), '23:00');
    const dimOptions = await dimAt.locator('option').evaluateAll(options => options.map(option => [option.value, option.textContent]));
    assert.equal(dimOptions.length, 15);
    assert.deepEqual([dimOptions[0], dimOptions[6], dimOptions[8], dimOptions[14]], [['20:00', '8:00 PM'], ['23:00', '11:00 PM'], ['00:00', '12:00 AM (midnight)'], ['03:00', '3:00 AM']]);
    await button('How daylight brightness works').click();
    assert.match(await page.getByRole('tooltip').innerText(), /weather location \(Toronto\)/);
    assert.match(await page.getByRole('tooltip').innerText(), /reaches Brightest soon after sunrise and stays there while it is light\. After sunset it eases to an evening level \(55%\) for a lit room, glides to Dimmest over 30 minutes from the dim time/);
    assert.match(await page.getByRole('tooltip').innerText(), /Starter looks keep this daylight range/);
    await page.keyboard.press('Escape');
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
    // The dim time is part of the draft, and moving a slider keeps it.
    await dimAt.selectOption('00:00'); await page.clock.runFor(100);
    assert.match(await status(), /dims at 12:00\sAM$/);
    await slider('Brightest').fill('76'); await slider('Brightest').fill('75'); await page.clock.runFor(100);
    assert.equal(await dimAt.inputValue(), '00:00', 'a slider keeps the dim time');
    // Fixed again is the saved state: no Save bar. Returning restores this session's range.
    await button('Fixed').click(); await page.clock.runFor(200);
    await savebar().waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'brightness-mode-fixed');
    await button('Follow daylight').click(); await page.clock.runFor(200);
    assert.deepEqual([await slider('Dimmest').inputValue(), await slider('Brightest').inputValue()], ['25', '75'], 'the last range comes back');
    assert.equal(await dimAt.inputValue(), '00:00', 'with its dim time');
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
    assert.deepEqual(app.store.snapshot().settings.appearance.daylightBrightness, { dimmest: 0.25, brightest: 0.75, dimTime: '00:00' });
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).settings.appearance.daylightBrightness, { dimmest: 0.25, brightest: 0.75, dimTime: '00:00' });
    await page.reload(); await button('Edit layout').waitFor(); await page.clock.runFor(500); await styleTab();
    assert.equal(await button('Follow daylight').getAttribute('aria-pressed'), 'true', 'saved through reload');
    assert.equal(await dimAt.inputValue(), '00:00', 'the dim time too');
    // Save and Cancel appear only for an effective change: another time is one, the saved time again is none.
    assert.equal(await savebar().count(), 0);
    await dimAt.selectOption('23:30'); await savebar().waitFor();
    await dimAt.selectOption('00:00'); await savebar().waitFor({ state: 'detached' });
    await dimAt.selectOption('01:00'); await savebar().waitFor();
    await button('Cancel').click(); await savebar().waitFor({ state: 'detached' });
    assert.equal(await dimAt.inputValue(), '00:00', 'Cancel restores the saved dim time');
    // Cancel restores the saved range.
    await slider('Brightest').fill('90'); await savebar().waitFor();
    await button('Cancel').click(); await savebar().waitFor({ state: 'detached' });
    assert.equal(await slider('Brightest').inputValue(), '75');
    // The time follows the Time format.
    await app.store.update(data => { data.settings.clockFormat = '24h'; });
    await page.clock.runFor(30_000);
    assert.match(await status(), /^Now 75% · brightest since 08:1\d · dims at 00:00$/);
    assert.deepEqual(await dimAt.locator('option').evaluateAll(options => [options[6].textContent, options[8].textContent]), ['23:00', '00:00 (midnight)']);
    assert.equal(await savebar().count(), 0, 'a time format saved elsewhere is not an editor draft');
    // Seven hours later, at 8:05 PM, the status shows the evening level and the next morning.
    await page.clock.fastForward(7 * 60 * 60_000); await page.clock.runFor(1000);
    const evening = Number((await status()).match(/Now (\d+)%/)[1]);
    assert.ok(evening === 57 || evening === 58, `the evening level of 25–75% is 57.5%: ${evening}%`);
    assert.match(await status(), /· brightest from 08:1\d · dims at 00:00$/);
    checks.push('Style tab: Fixed is pressed by default, named “Fixed” (Playwright and Chromium) in no label, and clicking the line’s name or value presses nothing; the tab still fits at 1280×720; the mode buttons sit on the label line with a hit area above and below that never covers the slider; Follow daylight is a draft starting at 28–70%, dimming at 11 PM, with “Now 70% · brightest since 8:1x AM · dims at 11:00 PM” and the canvas at 0.7 at once (no glide); Dim at lists 15 half hours from 8 PM to 3 AM with midnight named; Dimmest and Brightest carry each other and keep the dim time; Fixed again hides the Save bar and keeps focus; the session range and dim time return; Night and Room keep the mode; Save persists the range with dimTime 00:00 through reload; another dim time shows Save, the saved one hides it, Cancel restores; 24-hour time; at 8:05 PM the status shows the evening level and the next morning');

    // 6. Polar status lines.
    await reset(settings => { settings.location = { ...TROMSO }; settings.appearance.daylightBrightness = RANGE; });
    await open('/editor', { time: '2026-12-21T10:45:00Z' }); await styleTab();
    assert.match(await status(), /^Now 6\d% · the sun stays down today · dims at 11:00\sPM$/);
    await button('How daylight brightness works').click();
    assert.match(await page.getByRole('tooltip').innerText(), /While the sun stays down it rises only to the evening level, late in the morning/);
    await page.keyboard.press('Escape');
    await open('/editor', { time: '2026-06-21T22:45:00Z' }); await styleTab();
    assert.match(await status(), /^Now 7\d% · brightest from \d:\d\d\sAM · light all night$/);
    await button('How daylight brightness works').click();
    assert.match(await page.getByRole('tooltip').innerText(), /While it is still light at the dim time, it dims with the dusk instead/);
    await page.keyboard.press('Escape');
    await open('/editor', { time: '2026-06-21T10:44:00Z' }); await styleTab();
    assert.match(await status(), /^Now 80% · brightest since \d:\d\d\sAM · light all night$/);
    checks.push('polar night reads “Now 6x% · the sun stays down today · dims at 11:00 PM”; the polar day reads “brightest from/since … · light all night” and says it dims with the dusk instead');

    // 7. 390 and 320 px: no horizontal overflow in either mode.
    for (const width of [390, 320]) {
      await reset(settings => { settings.appearance.daylightBrightness = width === 390 ? RANGE : null; });
      await open('/editor', { time: '2026-10-20T17:05:00Z', viewport: { width, height: 844 } }); await styleTab();
      for (const mode of ['first', 'second']) {
        const overflow = await page.evaluate(() => {
          const panel = document.querySelector('.inspector-panel').getBoundingClientRect();
          const group = document.querySelector('.brightness-mode').getBoundingClientRect();
          const dim = document.querySelector('.daylight-dim')?.getBoundingClientRect();
          const now = document.querySelector('.daylight-status')?.getBoundingClientRect();
          return { page: document.documentElement.scrollWidth, width: innerWidth, inside: [group, dim, now].every(box => !box || (box.left >= panel.left && box.right <= panel.right)) };
        });
        assert.ok(overflow.page <= overflow.width && overflow.inside, `${width} px (${mode}): ${JSON.stringify(overflow)}`);
        if (width === 390 && mode === 'first') { await page.locator('.brightness-mode').scrollIntoViewIfNeeded(); images.push({ name: 'style-daylight-390', bytes: await page.screenshot() }); }
        await button(mode === 'first' ? (width === 390 ? 'Fixed' : 'Follow daylight') : (width === 390 ? 'Follow daylight' : 'Fixed')).click(); await page.clock.runFor(200);
      }
    }
    checks.push('390 and 320 px: the Brightness mode, the dim time and the status line stay inside the panel in both modes with no horizontal scroll');

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
