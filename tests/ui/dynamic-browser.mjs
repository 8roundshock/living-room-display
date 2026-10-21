// Dynamic (#437) in production Edge: official warnings, focus, the calm rotation, the latch, every honest
// state and the editor panel. Each scenario owns an ephemeral loopback server with a temporary data folder,
// a mutable server clock and a synthetic fetcher standing in for Open-Meteo, MSC GeoMet (api.weather.gc.ca)
// and the NWS (api.weather.gov); any other host fails the suite. Pages answer every request outside the app
// with an empty response (#315) and run on an installed page clock. Images stay in RAM unless --capture
// names a folder (for a person to inspect; delete it afterwards).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { WIDGET_IDS } from '../../src/shared/widgets.ts';
import { keepPagesLocal } from './lib/local-only.mjs';

const NOW = Date.parse('2026-10-18T13:00:00Z'); // Sunday 9 AM in Toronto
const MINUTE = 60_000, HOUR = 60 * MINUTE;
const SIZES = ['small', 'medium', 'large'];
const VIEWPORTS = [{ width: 1280, height: 720 }, { width: 3840, height: 2160 }];
const ZONES = { type: 'FeatureCollection', features: [{ id: 'fea1-1185', properties: { FEATURE_ID: 'fea1-1185', NAME: 'City of Toronto' } }] };
function ecccAlert(id, name, type = 'warning', hours = 8) {
  return { id: `${id}_fea1-1185`, properties: {
    alert_type: type, alert_name_en: name, feature_id: 'fea1-1185', feature_name_en: 'City of Toronto', status_en: 'new', risk_colour_en: 'red',
    publication_datetime: new Date(NOW - HOUR).toISOString(), validity_datetime: new Date(NOW - 30 * MINUTE).toISOString(),
    event_end_datetime: new Date(NOW + hours * HOUR).toISOString(), expiration_datetime: new Date(NOW + (hours - 1) * HOUR).toISOString(),
  } };
}
/** The shared forecast with today's code, and each local hour's chance and rain (the hour ending at that time). */
function forecast({ todayCode = 3, wetHours = [], chance = 0 } = {}) {
  const payload = forecastFixture();
  payload.daily.weather_code[0] = todayCode;
  const start = payload.hourly.time[0];
  payload.hourly.precipitation_probability = payload.hourly.time.map(time => wetHours.includes(Math.round((time - start) / 3600)) ? 80 : chance);
  payload.hourly.precipitation = payload.hourly.time.map(time => wetHours.includes(Math.round((time - start) / 3600)) ? 1.2 : 0);
  payload.hourly.rain = payload.hourly.time.map(time => wetHours.includes(Math.round((time - start) / 3600)) ? 1 : 0);
  payload.hourly.showers = payload.hourly.time.map(() => 0);
  payload.daily.precipitation_probability_max = payload.daily.time.map(() => 10);
  return payload;
}
/** Hour indexes of the fixture (index 0 ends at local midnight) whose interval ends between `from` and `to` local hours. */
const localHours = (from, to) => Array.from({ length: to - from }, (_, index) => from + 1 + index);
function airPayload(aqi = 42) {
  const start = Date.parse('2026-10-18T13:00:00Z') / 1000, time = Array.from({ length: 24 }, (_, index) => start + index * 3600);
  return { timezone: 'America/Toronto', current: { time: start, us_aqi: aqi, us_aqi_pm2_5: aqi, pm2_5: 12, pm10: 18, uv_index: 3 }, hourly: { time, us_aqi: time.map(() => aqi), uv_index: time.map((_, index) => Math.max(0, 4 - index)) } };
}
const synthetic = (id, text, dueAt) => ({ id, text, completed: false, dueAt, createdAt: new Date(NOW - 86_400_000).toISOString(), updatedAt: new Date(NOW - 86_400_000).toISOString() });

export async function runDynamicQa({ playwright, edge, capture } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], errors = [], images = [], outside = new Set();
  if (capture) await mkdir(capture, { recursive: true });
  const keep = async (name, bytes) => { images.push({ name, bytes }); if (capture) await writeFile(join(capture, `${name}.png`), bytes); };

  /** One scenario: its own server, data folder, clock and providers. */
  async function scenario(providers, settingsEdit = () => {}, reminders = []) {
    const directory = await mkdtemp(join(tmpdir(), 'lrd-dynamic-'));
    const counts = {};
    const server = { now: NOW, providers };
    const app = await createApplication({
      dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), now: () => server.now,
      fetcher: async (input, init = {}) => {
        const url = new URL(input), key = url.hostname.includes('air-quality') ? 'air' : url.hostname === 'api.open-meteo.com' ? 'forecast' : url.hostname === 'api.weather.gc.ca' ? (url.pathname.includes('zones') ? 'zones' : 'eccc') : url.hostname === 'api.weather.gov' ? 'nws' : 'unexpected';
        counts[key] = (counts[key] ?? 0) + 1;
        if (key === 'unexpected') { errors.push(`unexpected provider host ${url.hostname}`); throw new Error('unexpected host'); }
        if (key === 'eccc' || key === 'zones' || key === 'nws') assert.match(new Headers(init.headers).get('user-agent') ?? '', /^LivingRoomDisplay\//, 'alerts requests carry the User-Agent');
        const answer = server.providers[key];
        return typeof answer === 'function' ? answer(url) : answer === undefined ? new Response('missing', { status: 500 }) : answer instanceof Response ? answer.clone() : Response.json(answer);
      },
    });
    await app.store.update(data => {
      data.settings = defaultSettings(); data.settings.locationSource = 'manual';
      data.settings.widgets = Object.fromEntries(WIDGET_IDS.map(id => [id, id === 'dynamic']));
      data.settings.appearance.motionEnabled = false;
      data.reminders = reminders;
      settingsEdit(data.settings);
    });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    const base = `http://127.0.0.1:${app.server.address().port}`;
    return {
      app, base, server, counts,
      async place(size) { await app.store.update(data => { data.settings.widgetGrid.placements.dynamic = { column: 0, row: 0, size }; }); },
      async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); },
    };
  }
  async function open(world, { viewport = VIEWPORTS[0], route = '/display', reducedMotion = 'reduce', time = NOW } = {}) {
    const context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', reducedMotion });
    const answered = await keepPagesLocal(context, world.base);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
    await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
    await page.clock.install({ time: new Date(time) });
    await page.goto(world.base + route);
    await page.locator(route === '/editor' ? '.preview-surface' : '.display-page').waitFor();
    await page.clock.runFor(500);
    return { context, page, async close() { for (const url of answered) outside.add(url); await context.close(); } };
  }
  const widgetOf = page => page.locator('[data-widget-id="dynamic"]');
  const attr = (page, name) => widgetOf(page).locator('.dynamic-body, .dynamic-placeholder').getAttribute(name);
  /** Fit scale, headline clipping, bounds, the number of cards, running animations and colours. */
  const facts = page => widgetOf(page).evaluate(section => {
    const outer = section.getBoundingClientRect(), headline = section.querySelector('.dynamic-headline');
    const probe = document.createElement('span'); probe.style.color = 'var(--ambient-caution)'; section.append(probe);
    const caution = getComputedStyle(probe).color; probe.remove();
    return {
      fit: new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a,
      // A line clamp hides at least a whole line; glyphs taller than the 1.2 line height overflow by a fraction of an em (as in Reminders).
      headlineClipped: headline ? headline.scrollHeight - headline.clientHeight > parseFloat(getComputedStyle(headline).fontSize) * 0.5 : null,
      outside: [...section.querySelectorAll('.dynamic-card *')].filter(element => element.checkVisibility() && (() => { const rect = element.getBoundingClientRect(); return rect.width && (rect.top < outer.top - 1 || rect.bottom > outer.bottom + 1 || rect.left < outer.left - 1 || rect.right > outer.right + 1); })()).map(element => element.className.baseVal ?? element.className),
      cards: section.querySelectorAll('.dynamic-card').length,
      animations: section.getAnimations({ subtree: true }).map(animation => animation.transitionProperty ?? animation.animationName),
      cardTransition: (() => { const card = section.querySelector('.dynamic-card'); return card ? { swapped: card.hasAttribute('data-swapped'), property: getComputedStyle(card).transitionProperty, duration: getComputedStyle(card).transitionDuration } : null; })(),
      kickerCaution: (() => { const kicker = section.querySelector('.dynamic-kicker'); return kicker ? getComputedStyle(kicker).color === caution : null; })(),
      cautions: [...section.querySelectorAll('.status-caution')].map(element => [element.textContent, getComputedStyle(element).color === caution]),
      text: section.innerText.replace(/ /g, ' '),
    };
  });
  const withinBox = (result, label) => {
    assert.ok(result.fit >= 0.995, `${label}: fit 1 (${result.fit})`);
    assert.equal(result.headlineClipped, false, `${label}: the headline is not cut`);
    assert.deepEqual(result.outside, [], `${label}: nothing leaves the widget`);
    assert.equal(result.cards, 1, `${label}: exactly one card`);
  };

  try {
    // ---- A. Official warnings lead, with the caution "Warning", the provider's words and their source; two take turns.
    {
      const world = await scenario({ forecast: forecast(), air: airPayload(), zones: ZONES, eccc: { type: 'FeatureCollection', features: [ecccAlert('1001', 'winter storm warning')] } });
      try {
        for (const viewport of VIEWPORTS) for (const size of SIZES) {
          await world.place(size);
          const view = await open(world, { viewport });
          const result = await facts(view.page);
          assert.equal(await attr(view.page, 'data-dynamic-mode'), 'alert'); assert.equal(await attr(view.page, 'data-dynamic-id'), 'alert:1001');
          assert.equal(await widgetOf(view.page).locator('.dynamic-kicker').innerText(), 'Warning'); assert.equal(result.kickerCaution, true, 'only "Warning" uses the caution tone');
          assert.equal(await widgetOf(view.page).locator('.dynamic-headline').innerText(), 'Winter storm warning', 'the provider\'s name, only its first letter capitalised');
          assert.match(result.text, /Until 5 PM/);
          assert.match(result.text, size === 'small' ? /Environment Canada/ : /Environment and Climate Change Canada/, `${size}: the source`);
          assert.equal(await widgetOf(view.page).locator('.dynamic-source svg').count(), 1, 'the alert icon beside the level word');
          withinBox(result, `A ${size} ${viewport.width}`);
          await keep(`A-warning-${size}-${viewport.width}`, await widgetOf(view.page).screenshot());
          await view.close();
        }
        world.server.providers.eccc = { type: 'FeatureCollection', features: [ecccAlert('1001', 'winter storm warning'), ecccAlert('2002', 'wind warning', 'warning', 9)] };
        world.server.now += 6 * MINUTE; await world.place('medium');
        const view = await open(world, { reducedMotion: 'no-preference', time: world.server.now });
        const first = await attr(view.page, 'data-dynamic-id');
        assert.match(await widgetOf(view.page).locator('.dynamic-more').innerText(), /^· [12] of 2$/);
        const seconds = await view.page.evaluate(() => 60 - (Date.now() / 1000) % 60);
        await view.page.clock.runFor(Math.ceil(seconds * 1000) + 1_500); // past the boundary and the next one-second tick
        const second = await attr(view.page, 'data-dynamic-id');
        assert.notEqual(second, first, 'the next wall-clock slot shows the other warning');
        assert.deepEqual([first, second].sort(), ['alert:1001', 'alert:2002']);
        await view.close();
        checks.push('A. An official ECCC warning leads in every family at 720p and 4K: "Warning" in the caution tone with the alert icon, the verbatim name, "Until 5 PM", the source named in full (small: "Environment Canada"), fit 1; two warnings show "1 of 2" and take turns on the next slot');
      } finally { await world.close(); }
    }

    // ---- B. Focus: today's thunderstorm code with a wet 2–6 PM, rain soon and a reminder due in 30 minutes.
    {
      const world = await scenario({ forecast: forecast({ todayCode: 95, wetHours: localHours(14, 18) }), air: airPayload(), zones: ZONES, eccc: { type: 'FeatureCollection', features: [] } }, () => {},
        [synthetic('00000000-0000-4000-8000-000000000001', 'Synthetic call', new Date(NOW + 30 * MINUTE).toISOString())]);
      try {
        for (const viewport of VIEWPORTS) for (const size of SIZES) {
          await world.place(size);
          const view = await open(world, { viewport, reducedMotion: 'no-preference' });
          await view.page.clock.runFor(3_000);
          const result = await facts(view.page);
          assert.equal(await attr(view.page, 'data-dynamic-mode'), 'focus'); assert.equal(await attr(view.page, 'data-dynamic-kind'), 'storm-today');
          assert.equal(await widgetOf(view.page).locator('.dynamic-headline').innerText(), size === 'small' ? 'Storms today' : 'Thunderstorms in today’s forecast');
          if (size === 'large') {
            const rows = await widgetOf(view.page).locator('.dynamic-also li:not(.dynamic-overflow)').allInnerTexts();
            assert.ok(rows.length >= 2 && rows.length <= 3, `large rows: ${rows.join(' | ')}`);
            assert.match(rows[0], /Rain likely/); assert.match(rows[1], /Synthetic call/);
          } else assert.equal(await widgetOf(view.page).locator('.dynamic-more').innerText(), '· +2 more');
          withinBox(result, `B ${size} ${viewport.width}`);
          assert.deepEqual(result.animations, [], 'no animation runs at rest');
          await keep(`B-focus-${size}-${viewport.width}`, await widgetOf(view.page).screenshot());
          await view.close();
        }
        checks.push('B. Focus: "Thunderstorms in today\'s forecast" (small "Storms today") pinned with "+2 more" (rain soon and a reminder due in 30 min) in small and medium and as rows in large, at 720p and 4K: fit 1, no cut headline, nothing outside the widget, one card, no running animation at rest');
      } finally { await world.close(); }
    }

    // ---- C and D. The calm rotation across slots, one card at a time; the latch, and an immediate switch.
    {
      const world = await scenario({ forecast: forecast(), air: airPayload(), zones: ZONES, eccc: { type: 'FeatureCollection', features: [] } });
      const ROTATION = ['weather:conditions', 'weather:high-low', 'weather:dry', 'sky:sun', 'sky:moon', 'air:calm'];
      try {
        for (const [viewport, reducedMotion] of [[VIEWPORTS[0], 'no-preference'], [VIEWPORTS[0], 'reduce'], [VIEWPORTS[1], 'reduce']]) {
          await world.place('medium');
          const view = await open(world, { viewport, reducedMotion, time: NOW + 5_000 });
          const seen = [];
          for (let slot = 0; slot < ROTATION.length + 1; slot++) {
            seen.push(await attr(view.page, 'data-dynamic-id'));
            assert.equal(await attr(view.page, 'data-dynamic-mode'), 'rotate');
            await view.page.clock.runFor(MINUTE);
            const swap = await facts(view.page);
            assert.equal(swap.cards, 1, 'never two cards in the box, even mid-swap');
            assert.equal(swap.cardTransition.swapped, true, 'every card after the first is a swap');
            if (reducedMotion === 'reduce') assert.match(swap.cardTransition.duration, /^0s/, 'instant with reduced motion');
            else assert.deepEqual([swap.cardTransition.property, swap.cardTransition.duration], ['opacity', '0.42s'], 'the incoming card fades in by opacity at Subtle');
            await view.page.clock.runFor(1_500);
          }
          const start = ROTATION.indexOf(seen[0]);
          assert.deepEqual(seen, Array.from({ length: ROTATION.length + 1 }, (_, index) => ROTATION[(start + index) % ROTATION.length]), `calm order across slots: ${seen.join(' → ')}`);
          if (viewport.width === 1280 && reducedMotion === 'reduce') await keep('C-rotation-medium-1280', await widgetOf(view.page).screenshot());
          await view.close();
        }
        checks.push(`C. Calm rotation with Weather and Sun & moon off the board: ${ROTATION.join(' → ')} one per wall-clock minute, wrapping, at Subtle (the new card fades in by opacity) and with reduced motion (instant), at 720p and 4K; exactly one .dynamic-card at every sample`);

        // D: a countdown for tomorrow arriving mid-slot waits for the next slot; a reminder due in 20 minutes switches at once.
        await world.place('large');
        const view = await open(world, { reducedMotion: 'reduce', time: NOW + 5_000 });
        const before = await attr(view.page, 'data-dynamic-id');
        const poll = async () => { const answered = view.page.waitForResponse(response => response.url().endsWith('/api/state')); await view.page.clock.runFor(30_000); await answered; await view.page.clock.runFor(200); };
        await world.app.store.update(data => { data.settings.widgetData.countdowns = [{ id: '7a1c0d4e-0000-4000-8000-000000000001', title: 'Synthetic trip', date: '2026-10-19', repeatsYearly: false }]; });
        await poll();
        assert.equal(await attr(view.page, 'data-dynamic-id'), before, 'the lead holds until the slot ends (the latch)');
        const leads = [];
        for (let slot = 0; slot < 8; slot++) { await view.page.clock.runFor(MINUTE); leads.push(await attr(view.page, 'data-dynamic-id')); }
        assert.notEqual(leads[0], before, 'the next slot moves on');
        assert.ok(leads.includes('countdown:7a1c0d4e-0000-4000-8000-000000000001'), `the countdown joined the rotation: ${leads.join(' → ')}`);
        const pageNow = await view.page.evaluate(() => Date.now());
        await world.app.store.update(data => { data.reminders = [synthetic('00000000-0000-4000-8000-000000000002', 'Synthetic soon', new Date(pageNow + 20 * MINUTE).toISOString())]; });
        await poll();
        assert.equal(await attr(view.page, 'data-dynamic-mode'), 'focus'); assert.equal(await attr(view.page, 'data-dynamic-kind'), 'reminder-soon', 'a reminder due in 20 minutes replaces the lead at the next poll, mid-slot');
        await keep('D-reminder-large-1280', await widgetOf(view.page).screenshot());
        await view.close();
        checks.push('D. A countdown for tomorrow that arrives mid-slot joins the rotation but the lead holds until the next slot (latch); a reminder due in 20 minutes takes the lead at the next poll');
      } finally { await world.close(); }
    }

    // ---- E. Honest states.
    {
      const ok = { forecast: forecast(), air: airPayload(), zones: ZONES, eccc: { type: 'FeatureCollection', features: [] } };
      const statusIn = async (world, size, expected, label, setup = async () => {}) => {
        await world.place(size);
        const view = await open(world, { time: world.server.now });
        await setup(view);
        const result = await facts(view.page);
        assert.match(result.text, expected, `${label} ${size}: ${result.text}`);
        withinBox(result, `${label} ${size}`);
        return { view, result };
      };
      // Weather failing from the start: no weather card, "Weather unavailable" in the caution tone.
      let world = await scenario({ ...ok, forecast: new Response('down', { status: 500 }) });
      try {
        for (const size of SIZES) {
          const { view, result } = await statusIn(world, size, /Weather unavailable/, 'weather failing');
          assert.notEqual(await attr(view.page, 'data-dynamic-source'), 'weather');
          assert.ok(result.cautions.some(([text, caution]) => /Weather unavailable/.test(text) && caution), 'in the caution tone');
          if (size === 'medium') await keep('E-weather-unavailable-medium', await widgetOf(view.page).screenshot());
          await view.close();
        }
      } finally { await world.close(); }
      // Stale after the 15-minute cache: the saved forecast says so; no "Dry" card; "As of", never "Now".
      world = await scenario(ok);
      try {
        await world.place('large'); await (await open(world)).close();
        world.server.providers.forecast = new Response('down', { status: 500 }); world.server.now += 16 * MINUTE;
        for (const size of ['medium', 'large']) {
          const { view, result } = await statusIn(world, size, /Saved forecast/, 'stale forecast');
          assert.doesNotMatch(result.text, /Dry for/); assert.doesNotMatch(result.text, /· Now\b/);
          if (size === 'large') await keep('E-stale-large', await widgetOf(view.page).screenshot());
          await view.close();
        }
        // Offline: /api/state aborted after a good load.
        for (const size of SIZES) {
          const { view } = await statusIn(world, size, /Offline/i, 'offline', async ({ page }) => {
            await page.route('**/api/state', route => route.abort());
            await page.clock.runFor(30_000);
            for (let attempt = 0; attempt < 60 && !/Offline/i.test(await widgetOf(page).innerText()); attempt++) await page.waitForTimeout(40);
          });
          await view.close();
        }
      } finally { await world.close(); }
      // Air returning 500, Air & UV off (no request), alerts returning 500, alerts stale, a European city.
      world = await scenario({ ...ok, air: new Response('down', { status: 500 }) });
      try { for (const size of ['medium', 'large']) await (await statusIn(world, size, /Air quality unavailable/, 'air failing')).view.close(); } finally { await world.close(); }
      world = await scenario(ok, settings => { settings.widgetData.dynamic.air = false; });
      try {
        const { view, result } = await statusIn(world, 'large', /./, 'air off');
        assert.equal(world.counts.air ?? 0, 0, 'no air-quality request while Air & UV is off'); assert.doesNotMatch(result.text, /Air quality|CAMS/);
        await view.close();
      } finally { await world.close(); }
      world = await scenario({ ...ok, eccc: new Response('down', { status: 500 }) });
      try { for (const size of SIZES) await (await statusIn(world, size, /Weather alerts unavailable/, 'alerts failing')).view.close(); } finally { await world.close(); }
      world = await scenario(ok);
      try {
        await world.place('large'); await (await open(world)).close();
        world.server.providers.eccc = new Response('down', { status: 500 }); world.server.now += 16 * MINUTE;
        const { view, result } = await statusIn(world, 'large', /Saved alerts · checked 9 AM/, 'alerts stale');
        assert.doesNotMatch(result.text, /No alerts/, 'no "No alerts" claim while saved');
        await view.close();
      } finally { await world.close(); }
      world = await scenario(ok, settings => { settings.location = { name: 'Paris', latitude: 48.8566, longitude: 2.3522, timezone: 'Europe/Paris' }; });
      try {
        for (const size of SIZES) {
          const { view, result } = await statusIn(world, size, /./, 'Europe');
          assert.doesNotMatch(result.text, /alerts/i, 'unsupported says nothing, never "no alerts"');
          await view.close();
        }
        assert.equal((world.counts.zones ?? 0) + (world.counts.eccc ?? 0) + (world.counts.nws ?? 0), 0, 'no alert request for a place neither provider covers');
      } finally { await world.close(); }
      checks.push('E. Honest states at fit 1: forecast failing from the start ("Weather unavailable" in the caution tone, no weather card), stale after the 15-minute cache ("Saved forecast", no Dry card, never "Now"), /api/state aborted ("Offline"), air 500 ("Air quality unavailable"), Air & UV off (no air request), alerts 500 ("Weather alerts unavailable"), alerts stale ("Saved alerts · checked 9 AM", no "No alerts"), Paris (no alert request, nothing said)');
    }

    // ---- F. Editor: the picker sample, the panel, the draft contract, Save and reload; the canvas holds its first card.
    {
      const world = await scenario({ forecast: forecast(), air: airPayload(), zones: ZONES, eccc: { type: 'FeatureCollection', features: [] } }, settings => {
        settings.widgets.dynamic = false; settings.widgets.clock = true; settings.widgets.weather = true;
      });
      try {
        for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
          const view = await open(world, { viewport, route: '/editor', reducedMotion: 'reduce' });
          const { page } = view;
          await page.getByRole('tab', { name: 'Widgets', exact: true }).click(); await page.clock.runFor(200);
          await page.getByRole('button', { name: 'Add widget', exact: true }).click();
          const group = await page.getByRole('group', { name: 'Weather & sky', exact: true }).locator('.catalog-item').evaluateAll(items => items.map(item => item.getAttribute('aria-label')));
          assert.ok(group.includes('Preview Dynamic'), 'Dynamic in Weather & sky');
          await page.getByRole('button', { name: 'Preview Dynamic', exact: true }).click();
          assert.equal(await page.locator('.picker-detail-heading p').innerText(), 'What matters now, or a calm rotation');
          for (const size of SIZES) {
            await page.getByRole('button', { name: `Dynamic ${size}`, exact: true }).click(); await page.clock.runFor(100);
            const sample = (await page.locator('.picker-sample').innerText()).replace(/\u00a0/g, ' ').replace(/\u2060/g, '');
            assert.match(sample, size === 'small' ? /Rain likely 11 AM–3 PM|Rain likely from/ : /Rain likely 11 AM–3 PM/, `${size} sample: ${sample}`);
            assert.doesNotMatch(sample, /Warning|Reminder|Countdown/, 'never a fake official alert, a reminder or a countdown');
            if (size === 'large') { assert.match(sample, /Sunset 6:29 PM/); assert.match(sample, /Full moon (Mon|Oct 26)/); }
          }
          if (viewport.width === 1280) await keep('F-picker-large-1280', await page.locator('.picker-detail').screenshot());
          await page.getByRole('button', { name: 'Dynamic medium', exact: true }).click();
          await page.getByRole('button', { name: 'Add Dynamic', exact: true }).click(); await page.clock.runFor(300);
          if (await page.getByRole('button', { name: 'Dynamic', exact: true }).getAttribute('aria-expanded') !== 'true') await page.getByRole('button', { name: 'Dynamic', exact: true }).click();
          const panel = page.locator('.widget-option.selected');
          const labels = await panel.locator('.dynamic-sources label.toggle-row > span').allInnerTexts();
          assert.deepEqual(labels, ['Weather', 'Official weather alerts', 'Air & UV', 'Sun & moon', 'Reminders & countdowns']);
          for (const label of labels) {
            const box = await panel.getByRole('checkbox', { name: label, exact: true }).boundingBox();
            assert.ok(box.width >= 44 && box.height >= 44, `${label} toggle is a 44 px target`);
          }
          assert.match(await panel.innerText(), /Environment Canada or the US National Weather Service\. Data Source: Environment and Climate Change Canada\./);
          assert.match(await panel.innerText(), /Uses your weather location \(Toronto\)/);
          assert.match(await panel.locator('.dynamic-alerts-status').innerText(), /Alerts are checked after you save\./);
          assert.match(await panel.locator('.dynamic-summary').innerText(), /^Now showing: /);
          if (viewport.width === 390) await keep('F-panel-390', await panel.screenshot());
          // The canvas holds its first card while time passes.
          const canvas = page.locator('.preview-surface [data-widget-id="dynamic"] .dynamic-body');
          const firstCard = await canvas.getAttribute('data-dynamic-id');
          await page.clock.runFor(2 * MINUTE + 1_000);
          assert.equal(await canvas.getAttribute('data-dynamic-id'), firstCard, 'the editor canvas holds slot 0');
          // A toggle and its reversal; all off blocks Save with its reason; Cancel; Save.
          const save = page.getByRole('button', { name: 'Save changes', exact: true });
          const airToggle = panel.getByRole('checkbox', { name: 'Air & UV', exact: true });
          await airToggle.uncheck(); await page.clock.runFor(100); await airToggle.check(); await page.clock.runFor(100);
          assert.equal(await save.isDisabled(), false, 'adding Dynamic is itself a change');
          for (const label of labels) await panel.getByRole('checkbox', { name: label, exact: true }).uncheck();
          await page.clock.runFor(100);
          assert.equal(await save.isDisabled(), true); assert.match(await page.locator('.save-status').innerText(), /Dynamic needs at least one thing to show/);
          await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
          assert.equal(world.app.store.snapshot().settings.widgets.dynamic, false, 'Cancel saved nothing');
          await view.close();
        }
        // Add, change one source, Save, reload: persisted, and the alerts line reports the saved state.
        const view = await open(world, { route: '/editor' });
        const { page } = view;
        await page.getByRole('tab', { name: 'Widgets', exact: true }).click();
        await page.getByRole('button', { name: 'Add widget', exact: true }).click();
        await page.getByRole('button', { name: 'Preview Dynamic', exact: true }).click();
        await page.getByRole('button', { name: 'Add Dynamic', exact: true }).click(); await page.clock.runFor(300);
        if (await page.getByRole('button', { name: 'Dynamic', exact: true }).getAttribute('aria-expanded') !== 'true') await page.getByRole('button', { name: 'Dynamic', exact: true }).click();
        await page.locator('.widget-option.selected').getByRole('checkbox', { name: 'Reminders & countdowns', exact: true }).uncheck();
        await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await page.locator('.studio-savebar').waitFor({ state: 'detached' });
        assert.equal(world.app.store.snapshot().settings.widgets.dynamic, true);
        assert.deepEqual(world.app.store.snapshot().settings.widgetData.dynamic, { weather: true, alerts: true, air: true, sky: true, personal: false });
        await page.reload(); await page.locator('.preview-surface').waitFor(); await page.clock.runFor(500);
        await page.getByRole('tab', { name: 'Widgets', exact: true }).click();
        await page.getByRole('button', { name: 'Dynamic', exact: true }).click();
        const panel = page.locator('.widget-option.selected');
        assert.equal(await panel.getByRole('checkbox', { name: 'Reminders & countdowns', exact: true }).isChecked(), false, 'persisted after reload');
        assert.match(await panel.locator('.dynamic-alerts-status').innerText(), /^Covers City of Toronto · no alerts now · checked/);
        assert.equal(await page.locator('.studio-savebar').count(), 0, 'clean after reload');
        await keep('F-panel-saved-1280', await panel.screenshot());
        await view.close();
        checks.push('F. Editor at 1280×720 and 390 px: Dynamic in the Weather & sky picker group with its description and a synthetic sample ("Rain likely 11 AM–3 PM"; large adds "Sunset 6:29 PM" and the full moon; no alert, reminder or countdown); five labelled 44 px toggles with their hints and the city; "Alerts are checked after you save." before Save and "Covers City of Toronto · no alerts now · checked …" after; the summary line; a toggle and its reversal; all off blocks Save with "Dynamic needs at least one thing to show"; Cancel saves nothing; Save and reload persist; the canvas holds its first card');
      } finally { await world.close(); }
    }
    assert.deepEqual(errors, []);
    return { checks, images: images.map(image => `${image.name} (${image.bytes.length} bytes, RAM)`), outside: [...outside] };
  } finally { await browser.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' }, capture: { type: 'string' } } });
  const result = await runDynamicQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks, images: result.images, answeredOutsideTheApp: result.outside }, null, 2));
}
