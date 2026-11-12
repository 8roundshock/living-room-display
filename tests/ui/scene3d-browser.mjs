// 3D living scenes (#600): isolated source server, synthetic data, RAM-only images, WebGL enabled.
// The themes suite launches Edge without WebGL and covers the flat fallback; this one covers the 3D path.
// By default it allows a software rasteriser (SwiftShader) so it also runs on a runner without a GPU;
// --gpu uses the machine's real GPU and adds the frame-rate floor. It fails, loudly, if the browser
// gives the page no WebGL context at all.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openScene, SCENE_CASES, startSceneServer, WEATHER_IDS, WEBGL_ARGS } from './lib/scene-cases.mjs';
import { FLOAT_TRAVEL, SCENE_TRACK, stepPath, trackPosition } from '../../src/shared/float.ts';
import { floatOffset, SCENE_CLOCK, sceneLook } from '../../src/client/scene3d/settings.ts';

const VIEWPORT = { width: 640, height: 360 }, BRIGHTNESS = .36, READY = 120_000;
// A season or holiday scene that has no file under scenes/ yet (and borrows none), read from the folder so that
// adding a scene never breaks this suite. Null once every such scene has its module: nothing is left to show.
const SCENE_MODULES = readdirSync(fileURLToPath(new URL('../../src/client/scene3d/scenes/', import.meta.url))).filter(file => file.endsWith('.js') && !file.startsWith('_')).map(file => file.slice(0, -3));
const FLAT_SCENE = SCENE_CASES.map(([id]) => id).find(id => !SCENE_MODULES.includes(id) && !WEATHER_IDS.includes(id) && !id.startsWith('birthday')) ?? null;
// [scene, weather over it, tier, source, share of brightness]. settings.ts: share 0.95, everyday x0.9, special x1.15 clamped at 1.
// Christmas is shown under Combined snow, so its module and the snow overlay are drawn together on the display.
const CASES = [['christmas', 'snow', 'everyday', 'weather', .95 * .9], ['canada-day', null, 'special', 'holiday', 1], ['birthday', null, 'special', 'birthday', 1]];
const CHUNK = /\/assets\/(engine|christmas|canada-day|birthday|snow)-/;

export async function runScene3dQa({ playwright, edge, gpu = false } = {}) {
  const started = Date.now(), { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const server = await startSceneServer(), args = WEBGL_ARGS[gpu ? 'gpu' : 'software'];
  const browser = await chromium.launch({ executablePath: edge, headless: true, args });
  const checks = [], errors = []; let context, page;
  const record = text => { checks.push(text); console.log(`PASS: ${text}`); };
  async function open(options) { await context?.close(); ({ context, page } = await openScene(browser, server, { viewport: VIEWPORT, brightness: BRIGHTNESS, allowSoftware: !gpu, pageErrors: errors, ...options })); }
  const layer = () => page.locator('.ambient-theme'), canvas = () => page.locator('canvas.scene3d-canvas');
  const ready = () => page.locator('.ambient-theme.scene3d[data-scene-state="ready"]').waitFor({ timeout: READY });
  const flat = (motif, habitat = motif) => page.locator(`.living-theme[data-scene-renderer="flat"][data-theme-motif="${motif}"][data-theme-habitat="${habitat}"]`).waitFor({ timeout: READY });
  const stages = () => page.evaluate(() => [...(window.__lrdScene3d ?? [])].map(stage => stage.stats()));
  const framesBeyond = count => page.waitForFunction(seen => [...window.__lrdScene3d][0].stats().frames > seen, count, { timeout: READY });
  const attributes = () => layer().evaluate(node => ({ ...node.dataset, canvases: node.querySelectorAll('canvas.scene3d-canvas').length, flat: document.querySelectorAll('.living-theme').length,
    opacity: Number(getComputedStyle(node).opacity), brightness: parseFloat(getComputedStyle(node).getPropertyValue('--ambient-brightness')), mask: getComputedStyle(node).maskImage || getComputedStyle(node).webkitMaskImage, background: getComputedStyle(node.closest('.ambient')).backgroundColor }));
  /** Lit and coloured shares of one RAM screenshot of the scene layer alone: widgets hidden, layer at full opacity. */
  async function drawnShare({ hideCanvas = false, clip } = {}) {
    const style = await page.addStyleTag({ content: `.ambient-content{visibility:hidden!important}.ambient-theme{opacity:1!important}.scene3d-canvas{animation:none!important${hideCanvas ? ';visibility:hidden!important' : ''}}` });
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const shot = (await page.screenshot(clip ? { clip } : {})).toString('base64'); await style.evaluate(node => node.remove());
    return page.evaluate(async base64 => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), character => character.charCodeAt(0))], { type: 'image/png' }));
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height), context = surface.getContext('2d'); context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height), total = data.length / 4; let lit = 0, coloured = 0, light = 0;
      for (let i = 0; i < data.length; i += 4) { light += data[i] + data[i + 1] + data[i + 2]; if (data[i] + data[i + 1] + data[i + 2] > 36) lit++; if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 40) coloured++; }
      return { lit: lit / total, coloured: coloured / total, mean: light / total / 765 };
    }, shot);
  }
  try {
    // ---------- the browser must give the page WebGL, or this suite has checked nothing ----------
    await open({ scene: FLAT_SCENE ?? 'christmas' });
    const webgl = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl'); if (!gl) return null;
      const info = gl.getExtension('WEBGL_debug_renderer_info'), name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)); gl.getExtension('WEBGL_lose_context')?.loseContext(); return name; });
    if (webgl === null) throw new Error(`NO WEBGL: Edge gave the page no WebGL context with ${JSON.stringify(args)}. None of the 3D scene checks ran. This is a failure of the check, not a pass.`);
    console.log(`SCENE3D_WEBGL ${JSON.stringify({ renderer: webgl, mode: gpu ? 'gpu' : 'software' })}`);
    if (FLAT_SCENE) {
      await flat(FLAT_SCENE); assert.equal(await canvas().count(), 0); assert.deepEqual(await stages(), []);
      record(`WebGL is available (${webgl}); ${FLAT_SCENE}, a scene without a 3D module, is drawn by the flat renderer`);
    } else record(`WebGL is available (${webgl}); every season and holiday scene has a 3D module, so none is left to show the flat renderer for a missing one`);

    // ---------- the three reference scenes ----------
    const timings = {}, chunks = {};
    for (const [scene, weather, tier, source, share] of CASES) {
      const requested = [], opened = Date.now(); await open({ scene, weather, onPage: target => target.on('request', request => requested.push(new URL(request.url()).pathname)) });
      await ready(); timings[scene] = Date.now() - opened;
      const seen = await attributes(), [stage] = await stages();
      assert.deepEqual({ renderer: seen.sceneRenderer, module: seen.sceneModule, tier: seen.sceneTier, motif: seen.themeMotif, habitat: seen.themeHabitat, source: seen.themeSource, quiet: seen.themeQuiet, still: seen.themeStill, weather: seen.sceneWeather },
        { renderer: '3d', module: scene, tier, motif: weather ?? scene, habitat: scene, source, quiet: undefined, still: undefined, weather: weather ?? undefined }, `${scene} data attributes`);
      assert.equal(seen.canvases, 1); assert.equal(seen.flat, 0, 'the flat renderer is not mounted beside the 3D one'); assert.equal(seen.background, 'rgb(0, 0, 0)');
      assert.ok(seen.brightness > 0 && seen.brightness <= BRIGHTNESS + .001, `brightness in effect ${seen.brightness}`);
      assert.ok(seen.opacity > 0 && seen.opacity <= seen.brightness + .0005, `${scene} opacity ${seen.opacity} never exceeds the saved brightness ${seen.brightness}`);
      assert.ok(Math.abs(seen.opacity - seen.brightness * share) < .002, `${scene} opacity ${seen.opacity} is the ${tier} share ${share} of brightness ${seen.brightness}`);
      assert.match(seen.mask, /radial-gradient/, 'fade to middle is a radial mask');
      assert.ok(stage && !stage.disposed && !stage.frozen && stage.frames >= 1, JSON.stringify(stage));
      assert.deepEqual(stage.backing, [VIEWPORT.width, VIEWPORT.height]); assert.ok(stage.triangles > 1000, `${scene} draws geometry (${stage.triangles} triangles)`);
      assert.ok(requested.some(path => /\/assets\/engine-/.test(path)) && requested.some(path => path.includes(`/assets/${scene}-`)), `the engine and the ${scene} module were fetched on demand`);
      assert.equal(requested.some(path => path.includes('/assets/snow-')), weather === 'snow', 'the snow overlay is fetched only when it snows');
      chunks.engine = requested.find(path => /\/assets\/engine-/.test(path)); chunks[scene] = requested.find(path => path.includes(`/assets/${scene}-`));
      const drawn = await drawnShare(), without = scene === 'canada-day' ? await drawnShare({ hideCanvas: true }) : { lit: 0 };
      assert.ok(drawn.lit > .01 && drawn.lit < .6, `${scene} draws pixels and leaves the screen mostly black: ${JSON.stringify(drawn)}`); assert.ok(drawn.coloured > .002, `${scene} is coloured: ${JSON.stringify(drawn)}`);
      assert.equal(without.lit, 0, 'those pixels come from the 3D canvas: without it the scene layer is black');
      console.log(`SCENE3D_SCENE ${JSON.stringify({ scene, readyMs: timings[scene], buildMs: Math.round(stage.buildMs), triangles: stage.triangles, drawCalls: stage.calls, lit: Number(drawn.lit.toFixed(3)) })}`);
    }
    record('Christmas under Combined snow, Canada Day and Birthday mount one 3D canvas with their data attributes, draw coloured pixels on true black, and stay within the saved brightness at their tier share');

    // ---------- the frame loop (Birthday is still open) ----------
    await framesBeyond((await stages())[0].frames);
    const first = (await stages())[0], sampled = Date.now(); await page.waitForTimeout(1500); await framesBeyond(first.frames);
    const later = (await stages())[0], seconds = (Date.now() - sampled) / 1000;
    assert.ok(later.running && later.frames > first.frames, 'the scene keeps drawing');
    assert.ok(later.time > first.time && later.time - first.time <= seconds * .125 + .05, `the scene clock runs at an eighth of real time: ${later.time - first.time}s in ${seconds}s`);
    assert.ok(later.frames - first.frames <= seconds * 20 + 4, `at most about 20 frames a second: ${later.frames - first.frames} in ${seconds}s`);
    if (gpu) assert.ok(later.frames - first.frames >= seconds * 15, `a real GPU keeps about 20 frames a second: ${later.frames - first.frames} in ${seconds}s`);
    // A hidden document stops the loop; showing it again resumes it without a jump.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    const paused = (await stages())[0]; await page.waitForTimeout(700); const stillPaused = (await stages())[0];
    assert.equal(paused.running, false); assert.equal(stillPaused.frames, paused.frames, 'no frame is drawn while the document is hidden');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); await framesBeyond(stillPaused.frames);
    const resumed = (await stages())[0]; assert.ok(resumed.running && resumed.time - stillPaused.time < .3, 'the scene clock does not jump after a pause');
    record('The loop draws at no more than about 20 frames a second on a slow scene clock, stops while the document is hidden and resumes without a jump');
    // ---------- the float (#675): the picture moves on its own track, zoomed, within its travel ----------
    // The synthetic settings have Float gently off, so the display steps once per 180 s interval; ease it on a 2 s interval here.
    const stepping = (await stages())[0];
    assert.equal(stepping.zoom, 1.043); assert.ok(stepping.floating, 'a running scene floats');
    assert.ok(Math.abs(stepping.float.x) <= .04 + 1e-9 && Math.abs(stepping.float.y) <= .04 + 1e-9, `within its travel: ${JSON.stringify(stepping.float)}`);
    const travel = await page.evaluate(async () => {
      const stage = [...window.__lrdScene3d][0], seen = [], wait = ms => new Promise(done => setTimeout(done, ms));
      for (const unit of [{ x: 1, y: 1 }, { x: -1, y: -1 }]) { stage.holdFloat(unit); seen.push(stage.stats().float); }
      stage.holdFloat(null); stage.setFloat({ interval: 2, gentle: true }); await wait(300); const eased = stage.stats().float;
      await wait(1200); const later = stage.stats().float;
      stage.setFloat({ interval: 4, gentle: true }); await wait(100); const slower = stage.stats().float;
      return { seen, eased, later, slower };
    });
    assert.deepEqual(travel.seen.map(point => [+point.x.toFixed(6), +point.y.toFixed(6)]), [[.04, .04], [-.04, -.04]], 'the extremes are ±2% of the display on each axis (NDC ±0.04)');
    assert.ok(Math.hypot(travel.later.x - travel.eased.x, travel.later.y - travel.eased.y) > .005, `with Float gently the picture moves continuously: ${JSON.stringify(travel)}`);
    assert.ok(Math.hypot(travel.slower.x - travel.later.x, travel.slower.y - travel.later.y) < .01, `a new motion interval keeps the position: ${JSON.stringify(travel)}`);
    record('The scene floats on its own track within ±2% of the display on each axis at a 4.3% zoom; a new motion interval keeps its position');

    // ---------- failures leave the flat scene on screen ----------
    await page.evaluate(() => { const element = document.querySelector('canvas.scene3d-canvas'); (element.getContext('webgl2') ?? element.getContext('webgl')).getExtension('WEBGL_lose_context').loseContext(); });
    await flat('birthday'); assert.equal(await canvas().count(), 0); assert.deepEqual(await stages(), []);
    // WebGL that answers the probe and then refuses: the renderer cannot be created.
    await open({ scene: 'canada-day', prepare: target => target.addInitScript(() => { const real = HTMLCanvasElement.prototype.getContext; let asked = 0;
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return /webgl/.test(kind) && asked++ > 0 ? null : real.call(this, kind, ...rest); }; }) });
    await flat('canada-day'); assert.equal(await canvas().count(), 0); assert.deepEqual(await stages(), []);
    record('A lost context, or WebGL that fails when the renderer is created, leaves the flat scene on screen and throws nothing to the page');

    // ---------- solid and clear (#683): every lit surface hides what is behind it unless its scene marks it clear ----------
    const surfaces = {};
    for (const [scene, clear] of [['autumn', 0], ['mimosa', 6]]) {
      await open({ scene }); await ready(); const [stage] = await stages(); surfaces[scene] = stage.surfaces;
      assert.equal(stage.surfaces.clear, clear, `${scene} clear surfaces: ${JSON.stringify(stage.surfaces)}`); assert.ok(stage.surfaces.solid >= 5, `${scene} solid surfaces: ${JSON.stringify(stage.surfaces)}`);
      const drawn = await drawnShare(); assert.ok(drawn.lit > .01 && drawn.coloured > .002, `${scene} draws: ${JSON.stringify(drawn)}`);
    }
    record(`Lit surfaces are solid unless their scene marks them clear: Autumn ${JSON.stringify(surfaces.autumn)}, Women's Day ${JSON.stringify(surfaces.mimosa)} (the vase's glass, water and water line and the feathery fronds), and both draw`);

    // ---------- weather over a scene: every kind has its overlay module (#617 to #621), so it stays in 3D ----------
    // A storm over Canada Day is a pairing that replaced the scene with the standalone Storms scene before #655:
    // in Combined the scene now always stays and the weather is its overlay.
    const overlayRequests = []; await open({ scene: 'canada-day', weather: 'storm', onPage: target => target.on('request', request => overlayRequests.push(new URL(request.url()).pathname)) }); await ready();
    const stormy = await attributes();
    assert.deepEqual([stormy.sceneRenderer, stormy.sceneModule, stormy.sceneWeather, stormy.themeMotif, stormy.themeHabitat, stormy.themeSource, stormy.sceneTier, stormy.canvases, stormy.flat], ['3d', 'canada-day', 'storm', 'storm', 'canada-day', 'weather', 'special', 1, 0]);
    assert.ok(overlayRequests.some(path => path.includes('/assets/canada-day-')), 'the scene keeps its own module under the storm');
    assert.ok(overlayRequests.some(path => path.includes('/assets/storm-')), 'the storm overlay was fetched on demand'); assert.equal((await stages()).length, 1);
    record('Weather over a 3D scene is drawn in 3D with its overlay module, also for a pairing that used to replace the scene (a storm over Canada Day, #655); the flat renderer is not mounted');
    // The next check builds its own stage and counts the live ones: give it a page with WebGL and no scene.
    await open({ scene: 'christmas', mode: 'off' }); assert.deepEqual(await stages(), []);

    // ---------- a quiet date, asked of the engine itself (no reference scene falls on one) ----------
    const quiet = await page.evaluate(async ({ enginePath, scenePath }) => {
      const [engine, scene] = await Promise.all([import(enginePath), import(scenePath)]);
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px'; document.body.append(host);
      let objects = 0, points = 0;
      // A two-second motion interval, so the float moves the quiet picture within the check's 1.5 seconds.
      const stage = engine.createStage(host, { build: (kit, ctx) => { scene.default(kit, ctx); kit.stage.traverse(object => { objects++; if (object.isPoints) points++; }); },
        ctx: { id: 'canada-day', amount: .15 * .4, size: .85, tier: 'special', weather: null, quiet: true, palette: ['#858f94', '#798788', '#858a90'], seed: 1, day: 1 },
        look: { glow: .65, shine: .8, seeThrough: 1, timeScale: 0 }, float: { interval: 2, gentle: true }, limits: { maxWidth: 2560, maxHeight: 1440, framesPerSecond: 20 }, clock: { start: 12, still: 14 }, allowSoftware: true });
      const first = stage.stats().float; await new Promise(done => setTimeout(done, 1500));
      const stats = stage.stats(), live = window.__lrdScene3d.size; stage.dispose(); host.remove();
      return { objects, points, frames: stats.frames, floatFrames: stats.floatFrames, floating: stats.floating, running: stats.running, frozen: stats.frozen, time: stats.time, first, last: stats.float, live, left: window.__lrdScene3d.size };
    }, { enginePath: chunks.engine, scenePath: chunks['canada-day'] });
    assert.ok(quiet.frozen && !quiet.running && quiet.time === 14, `a quiet scene's own clock stays stopped and no frame loop runs: ${JSON.stringify(quiet)}`);
    assert.ok(quiet.floating && quiet.floatFrames >= 1 && quiet.frames === 1 + quiet.floatFrames && quiet.floatFrames <= 7, `the float alone redraws it, at most four times a second: ${JSON.stringify(quiet)}`);
    assert.ok(quiet.last.x !== quiet.first.x || quiet.last.y !== quiet.first.y, 'and moves it');
    assert.equal(quiet.points, 0, 'nothing is in the air on a quiet date: no fireworks or other particle field'); assert.ok(quiet.objects > 20, 'the reduced scene is still a scene');
    assert.deepEqual([quiet.live, quiet.left], [1, 0]);
    // A new stage after a change of interval (a rebuild at midnight, a quiet date beginning) carries on from the same position.
    const handover = await page.evaluate(async ({ enginePath, scenePath }) => {
      const [engine, scene] = await Promise.all([import(enginePath), import(scenePath)]), wait = ms => new Promise(done => setTimeout(done, ms));
      const make = interval => { const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px'; document.body.append(host);
        const stage = engine.createStage(host, { build: scene.default, ctx: { id: 'canada-day', amount: .06, size: .85, tier: 'special', weather: null, quiet: true, palette: ['#858f94', '#798788', '#858a90'], seed: 1, day: 1 },
          look: { glow: .65, shine: .8, seeThrough: 1, timeScale: 0 }, float: { interval, gentle: true }, limits: { maxWidth: 2560, maxHeight: 1440, framesPerSecond: 20 }, clock: { start: 12, still: 14 }, allowSoftware: true });
        return { stage, done: () => { stage.dispose(); host.remove(); } }; };
      const first = make(3); await wait(400); first.stage.setFloat({ interval: 7, gentle: true }); await wait(300); first.stage.holdFloat(null);
      const sample = stage => { const stats = stage.stats(); return { float: stats.float, ...stats.floatSample }; };
      const before = sample(first.stage); first.done();
      const second = make(7), after = sample(second.stage); second.done();
      return { before, after };
    }, { enginePath: chunks.engine, scenePath: chunks['canada-day'] });
    // Real time moves on while the new stage is built (seconds on a software rasteriser), so the picture may have moved
    // between the two frames. Continuity is that the new stage reads the same track: its track time has advanced exactly
    // as far as real time has, and what it drew is the track's position at that time.
    const { before, after } = handover, elapsed = after.real - before.real;
    assert.ok(Math.abs((after.seconds - before.seconds) - elapsed) < .002, `the new stage continues the same track clock (no jump): ${JSON.stringify(handover)}`);
    for (const frame of [before, after]) {
      const expected = floatOffset(trackPosition(frame.seconds, 7, true, SCENE_TRACK));
      assert.ok(Math.abs(frame.float.x - expected.x) < 1e-9 && Math.abs(frame.float.y - expected.y) < 1e-9, `the drawn position is the track's at that time: ${JSON.stringify({ frame, expected })}`);
    }
    console.log(`SCENE3D_HANDOVER ${JSON.stringify({ rebuildSeconds: +elapsed.toFixed(3), moved: +Math.hypot(after.float.x - before.float.x, after.float.y - before.float.y).toFixed(4) })}`);
    record('On a quiet date the scene is frozen with nothing in the air, and the float alone moves it on a low-rate timer; a new stage after an interval change continues the float (#675)');

    // ---------- the movement preview's clock (#678), asked of the engine itself ----------
    const previewed = await page.evaluate(async ({ enginePath, scenePath }) => {
      const [engine, scene] = await Promise.all([import(enginePath), import(scenePath)]), wait = ms => new Promise(done => setTimeout(done, ms));
      const until = async (test, ms = 60_000) => { const end = performance.now() + ms; while (!test()) { if (performance.now() > end) throw new Error('timed out'); await wait(20); } };
      const make = (quiet, preview) => { const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px'; document.body.append(host);
        const stage = engine.createStage(host, { build: scene.default, ctx: { id: 'canada-day', amount: .06, size: .85, tier: 'special', weather: null, quiet, palette: ['#858f94', '#798788', '#858a90'], seed: 1, day: 1 },
          look: { glow: .65, shine: .8, seeThrough: 1, timeScale: quiet ? 0 : .125 }, float: { interval: 7, gentle: true }, preview, limits: { maxWidth: 2560, maxHeight: 1440, framesPerSecond: 20 }, clock: { start: 12, still: 14 }, allowSoftware: true });
        return { stage, done: () => { stage.dispose(); host.remove(); } }; };
      const sample = stage => { const { float, floatSample, time, preview, frames, floatFrames, running, floating, builds } = stage.stats(); return { float, sample: floatSample, time, preview, frames, floatFrames, running, floating, builds }; };
      const at = (stage, seconds) => until(() => stage.stats().floatSample?.seconds === seconds);
      // A running scene made during a preview draws its first frame at the preview's moment, and holds it.
      const live = make(false, 600), first = sample(live.stage); await wait(500); const held = sample(live.stage);
      live.stage.setPreview(607); await at(live.stage, 607); const later = sample(live.stage);
      live.stage.setPreview(600); await at(live.stage, 600); const back = sample(live.stage);
      live.stage.setPreview(null); await until(() => live.stage.stats().floatSample?.preview === false); const real = sample(live.stage), realNow = (performance.timeOrigin + performance.now()) / 1000;
      await wait(300); const runningOn = sample(live.stage); live.done();
      // A quiet date: the scene clock stays frozen and only the float follows the preview, drawn at once with no timer.
      const quiet = make(true, null), quietly = [sample(quiet.stage)];
      quiet.stage.setPreview(300); quietly.push(sample(quiet.stage)); quiet.stage.setPreview(303.5); quietly.push(sample(quiet.stage));
      await wait(700); quietly.push(sample(quiet.stage)); quiet.stage.setPreview(null); quietly.push(sample(quiet.stage)); quiet.done();
      return { first, held, later, back, real, realNow, runningOn, quietly, left: window.__lrdScene3d.size };
    }, { enginePath: chunks.engine, scenePath: chunks['canada-day'] });
    const onTrack = (frame, seconds, gentle = true, interval = 7) => { const expected = floatOffset(trackPosition(seconds, interval, gentle, SCENE_TRACK)); return Math.abs(frame.float.x - expected.x) < 1e-9 && Math.abs(frame.float.y - expected.y) < 1e-9; };
    { const { first, held, later, back, real, realNow, runningOn, quietly, left } = previewed;
      assert.ok(first.preview === 600 && first.sample.preview && first.sample.seconds === 600 && onTrack(first, 600) && first.time === SCENE_CLOCK.start + 600 * .125, `a stage made during a preview starts at its moment, float and scene clock: ${JSON.stringify(first)}`);
      assert.ok(held.running && held.frames === first.frames && held.time === first.time, `a held preview draws nothing new: ${JSON.stringify(held)}`);
      assert.ok(onTrack(later, 607) && later.time === SCENE_CLOCK.start + 607 * .125 && Math.hypot(later.float.x - first.float.x, later.float.y - first.float.y) > .005, `an interval later the scene has moved and lived on: ${JSON.stringify(later)}`);
      assert.deepEqual([back.float, back.time], [first.float, first.time], 'seeking back shows the same moment');
      assert.ok(!real.sample.preview && real.preview === null && Math.abs(real.sample.real - realNow) < 2 && onTrack(real, real.sample.seconds), `after the preview the float is on real time at once: ${JSON.stringify(real)}`);
      assert.ok(real.time >= back.time && runningOn.time > back.time && runningOn.time - back.time < .2, `and the scene clock carries on from the preview's without a jump: ${back.time} then ${real.time}, ${runningOn.time}`);
      assert.equal(new Set([first, held, later, back, real, runningOn].map(frame => frame.builds)).size, 1, 'nothing is rebuilt');
      const [before, three, threeHalf, rested, returned] = quietly;
      assert.ok(before.floating && !before.sample?.preview, `a quiet stage floats on real time on its timer: ${JSON.stringify(before)}`);
      assert.ok(three.sample.preview && three.sample.seconds === 300 && onTrack(three, 300) && three.floatFrames === before.floatFrames + 1 && three.time === SCENE_CLOCK.still && !three.floating, `a preview step redraws a quiet stage at once, with its clock still frozen and no timer: ${JSON.stringify(three)}`);
      assert.ok(threeHalf.sample.seconds === 303.5 && onTrack(threeHalf, 303.5) && rested.floatFrames === threeHalf.floatFrames && rested.time === SCENE_CLOCK.still, `and holds it: ${JSON.stringify([threeHalf, rested])}`);
      assert.ok(returned.floating && returned.preview === null && returned.time === SCENE_CLOCK.still, `back on real time the timer resumes: ${JSON.stringify(returned)}`);
      assert.equal(left, 0);
    }
    record('The engine follows the movement preview (#678): the float reads the preview time and a running scene clock is that time mapped like real time, a held preview draws nothing new, seeking back repeats a moment, a quiet stage moves only its float, at once, and the end of the preview returns the float to real time at once while the scene clock carries on, all without a rebuild');

    // ---------- the editor's still preview: one frame, no loop ----------
    await open({ scene: 'canada-day', path: '/editor' }); await ready();
    const still = await attributes(), [stillStage] = await stages();
    assert.equal(still.themeStill, 'true'); assert.equal(still.sceneFrames, '1'); assert.ok(stillStage.frozen && !stillStage.running && stillStage.frames === 1, JSON.stringify(stillStage));
    assert.ok(!stillStage.floating && stillStage.float.x === 0 && stillStage.float.y === 0 && stillStage.zoom === 1.043, `a still preview does not float; it shows the centre at the display's zoom: ${JSON.stringify(stillStage)}`);
    assert.ok(still.opacity > 0 && still.opacity <= still.brightness + .0005, `the preview stays within its brightness: ${still.opacity} of ${still.brightness}`);
    assert.equal(await canvas().evaluate(element => element.getAnimations().length), 0, 'a still preview does not fade in');
    await page.waitForTimeout(900); assert.equal((await stages())[0].frames, 1, 'no loop runs behind a still preview');
    const preview = await drawnShare({ clip: await canvas().boundingBox() });
    assert.ok(preview.lit > .01 && preview.coloured > .002, `the single still frame is on screen: ${JSON.stringify(preview)}`);
    record('The editor still preview draws exactly one frame, runs no loop and shows it');

    // ---------- Preview movement (#678, #686): the scene follows the hour slider with the board ----------
    // The synthetic settings step once per 180 s interval (Float gently off); the board and the scene step at their own boundaries.
    await open({ scene: 'canada-day', path: '/editor', viewport: { width: 1280, height: 720 } }); await ready();
    await page.getByRole('button', { name: 'Preview movement', exact: true }).click();
    await page.waitForFunction(() => { const stats = [...(window.__lrdScene3d ?? [])][0]?.stats(); return stats && !stats.frozen && stats.preview === 0; }, null, { timeout: READY });
    const previewCanvas = await canvas().elementHandle(), timeScale = sceneLook('canada-day', 'special').timeScale;
    const moment = async seconds => {
      await page.getByRole('slider', { name: 'Movement preview time', exact: true }).evaluate((input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
        input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
      }, seconds);
      await page.waitForFunction(value => { const stats = [...window.__lrdScene3d][0]?.stats(); return stats?.preview === value && stats.floatSample?.seconds === value && document.querySelector('.preview-surface .grid-ambient')?.getAttribute('data-preview-seconds') === value.toFixed(3); }, seconds, { timeout: READY });
      const board = await page.locator('.preview-surface .grid-ambient').evaluate(el => ({ plane: el.querySelector('.widget-grid-plane').style.transform, width: parseFloat(getComputedStyle(el).width), height: parseFloat(getComputedStyle(el).height), dpr: devicePixelRatio || 1 }));
      const step = stepPath(seconds, 180), snap = value => Math.round(value * board.dpr) / board.dpr;
      return { stage: (await stages())[0], plane: board.plane, expectedPlane: `translate(${snap(step.x * FLOAT_TRAVEL * board.width)}px, ${snap(step.y * FLOAT_TRAVEL * board.height)}px)` };
    };
    const seen = {};
    for (const seconds of [600, 780, 1500]) {
      const { stage, plane, expectedPlane } = seen[seconds] = await moment(seconds);
      assert.ok(stage.floatSample.preview && onTrack(stage, seconds, false, 180), `at ${seconds} s the scene is where its track puts it on the preview clock: ${JSON.stringify(stage.float)}`);
      assert.equal(stage.time, SCENE_CLOCK.start + seconds * timeScale, `at ${seconds} s the scene's own clock is that moment's`);
      assert.equal(plane, expectedPlane, `at ${seconds} s the board is where the display would put it`);
    }
    const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    assert.ok(apart(seen[600].stage.float, seen[780].stage.float) > .005 && seen[600].plane !== seen[780].plane, `an interval apart, the scene and the board have both moved: ${JSON.stringify([seen[600].stage.float, seen[780].stage.float, seen[600].plane, seen[780].plane])}`);
    const resting = (await stages())[0]; await page.waitForTimeout(1000); const rested = (await stages())[0];
    assert.ok(rested.running && rested.frames === resting.frames && rested.time === resting.time && apart(rested.float, resting.float) === 0, `a resting slider holds the scene and draws nothing new: ${JSON.stringify([resting.frames, rested.frames])}`);
    const again = await moment(600);
    assert.deepEqual([again.stage.float, again.stage.time, again.plane], [seen[600].stage.float, seen[600].stage.time, seen[600].plane], 'seeking back shows the same moment');
    // The slider follows the draft (#686): Float gently on keeps the moment and eases the scene and the board on it.
    await page.getByRole('tab', { name: 'Style', exact: true }).click(); await page.locator('summary', { hasText: 'Motion' }).click();
    await page.getByRole('checkbox', { name: 'Float gently', exact: true }).check();
    await page.waitForFunction(() => document.querySelector('.preview-surface .grid-ambient')?.getAttribute('data-float') === 'float');
    await page.waitForFunction(({ seconds, expected }) => { const stats = [...window.__lrdScene3d][0]?.stats(); return stats?.floatSample?.seconds === seconds && Math.abs(stats.float.x - expected.x) < 1e-9 && Math.abs(stats.float.y - expected.y) < 1e-9; },
      { seconds: 600, expected: floatOffset(trackPosition(600, 180, true, SCENE_TRACK)) }, { timeout: READY });
    assert.equal(await page.getByRole('slider', { name: 'Movement preview time', exact: true }).inputValue(), '600', 'the slider stays at its moment');
    const eased = (await stages())[0];
    assert.ok(await previewCanvas.evaluate(node => node.isConnected) && (await stages()).length === 1 && eased.builds === 1, `one stage, one canvas and one build for the whole preview: ${JSON.stringify({ stages: (await stages()).length, builds: eased.builds })}`);
    await page.getByRole('button', { name: 'Back to layout', exact: true }).click();
    await page.waitForFunction(() => { const stats = [...(window.__lrdScene3d ?? [])][0]?.stats(); return stats?.frozen && stats.preview === null && stats.float.x === 0 && stats.float.y === 0; }, null, { timeout: READY });
    assert.equal((await stages()).length, 1, 'back to layout: the still preview again, and no context left behind');
    record('Preview movement moves the 3D scene with the board on the hour slider: at each moment the float and the scene clock are that moment’s, an interval apart both have moved, a resting slider draws nothing new, seeking back repeats a moment, a settings change keeps the moment, all in one stage and context; Back to layout returns the still preview');

    // ---------- Transparency (#670): the Style slider retunes the live stage in place ----------
    // At 1280 x 720 the preview and the Style panel are side by side, so the slider and the frame are both on screen.
    await open({ scene: 'canada-day', path: '/editor', viewport: { width: 1280, height: 720 } }); await ready();
    await page.getByRole('tab', { name: 'Style', exact: true }).click();
    const slider = page.getByRole('slider', { name: 'Transparency', exact: true }), sceneBox = await canvas().boundingBox(), sameCanvas = await canvas().elementHandle();
    const built = count => page.waitForFunction(least => [...window.__lrdScene3d][0]?.stats().builds >= least, count, { timeout: READY });
    const light = async () => (await drawnShare({ clip: sceneBox })).mean, held = stage => [stage.textures, stage.geometries, stage.programs];
    const standard = (await stages())[0], atStandard = await light();
    assert.equal(await slider.inputValue(), '50'); assert.equal(standard.seeScale, 1); assert.equal(standard.builds, 1);
    // A drag: three steps inside the 250 ms delay, then a rest. One rebuild, in the same canvas and context.
    await slider.focus(); await page.keyboard.press('End'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
    await built(2); await page.waitForTimeout(700);
    const most = (await stages())[0], atMost = await light();
    assert.equal(most.builds, 2, 'one rebuild for the whole drag'); assert.equal(most.seeScale, 2); assert.equal((await stages()).length, 1, 'no second stage');
    assert.ok(await sameCanvas.evaluate(node => node.isConnected), 'the same canvas, so the same WebGL context');
    // The first build also uploads helper geometry three.js keeps for the environment map, so compare totals with the first build loosely and between rebuilds exactly.
    assert.ok(held(most).every((count, index) => count <= held(standard)[index]) && most.programs === standard.programs, `the rebuild releases what it replaced and compiles no new shader program: ${held(most)} after ${held(standard)}`);
    assert.ok(most.frozen && !most.running && most.frames === standard.frames + 1, `the still preview drew the new frame once and runs no loop: ${JSON.stringify(most)}`);
    await page.keyboard.press('Home'); await built(3);
    const solid = (await stages())[0], atSolid = await light();
    assert.equal(solid.seeScale, 0); assert.deepEqual(held(solid), held(most), 'a second rebuild holds exactly what the first did');
    assert.ok(atSolid > atStandard && atStandard > atMost && atMost > .001, `0% draws more of the scene than 50%, and 50% more than 100%, which still draws it: ${[atSolid, atStandard, atMost].map(value => value.toFixed(4))}`);
    for (let step = 0; step < 5; step++) await page.keyboard.press('PageUp');
    await built(4); const back = (await stages())[0], atBack = await light();
    assert.equal(await slider.inputValue(), '50'); assert.equal(back.seeScale, 1); assert.deepEqual(held(back), held(most), 'and so does a third');
    assert.ok(Math.abs(atBack - atStandard) <= atStandard * .01, `back at 50% the frame is the first one again: ${atBack} and ${atStandard}`);
    console.log(`SCENE3D_TRANSPARENCY ${JSON.stringify({ light: { solid: +atSolid.toFixed(4), standard: +atStandard.toFixed(4), most: +atMost.toFixed(4), back: +atBack.toFixed(4) }, held: { first: held(standard), rebuilt: held(back) }, rebuildMs: Math.round(back.buildMs) })}`);
    record('Transparency retunes the live 3D preview: one rebuild per drag in the same canvas and context, nothing left behind, 0% and 100% build and draw, 0% draws more than 50% and 50% more than 100%');
    // The display takes the saved value when it builds its stage.
    await open({ scene: 'canada-day', transparency: 100 }); await ready();
    const saved = await attributes(), [shown] = await stages(), shownLight = await drawnShare();
    assert.equal(saved.sceneTransparency, '100'); assert.deepEqual([shown.seeScale, shown.builds], [2, 1], 'built once, with the saved value');
    assert.ok(shownLight.lit > .005, `the display draws the scene at 100%: ${JSON.stringify(shownLight)}`);
    record('The display builds its 3D stage with the saved Transparency');
    await open({ scene: 'canada-day', path: '/editor' }); await ready();

    // ---------- unmount and remount: every context is given back ----------
    const canvases = await page.evaluateHandle(() => { window.sceneCanvases = [document.querySelector('canvas.scene3d-canvas')]; return window.sceneCanvases; });
    await page.getByRole('tab', { name: 'Style', exact: true }).click(); const theme = page.getByRole('combobox', { name: 'Theme', exact: true });
    for (let round = 0; round < 2; round++) {
      await theme.selectOption('off'); await layer().waitFor({ state: 'detached' }); assert.deepEqual(await stages(), [], 'Theme Off leaves no stage');
      await theme.selectOption('seasonal'); await ready(); await page.evaluate(() => window.sceneCanvases.push(document.querySelector('canvas.scene3d-canvas')));
      assert.equal((await stages()).length, 1, 'a remount never leaves a second context'); assert.equal(await canvas().count(), 1);
    }
    await theme.selectOption('off'); await layer().waitFor({ state: 'detached' });
    const released = await canvases.evaluate(list => list.map(element => ({ connected: element.isConnected, lost: (element.getContext('webgl2') ?? element.getContext('webgl'))?.isContextLost() ?? true })));
    assert.equal(released.length, 3); assert.ok(released.every(item => !item.connected && item.lost), `every unmounted canvas is detached and its context lost: ${JSON.stringify(released)}`); assert.deepEqual(await stages(), []);
    record('Unmounting releases the WebGL context, and two remounts leave no context behind');

    // ---------- nothing mounts, and nothing 3D is downloaded, when the theme or motion is off ----------
    for (const [label, options] of [['Theme Off', { mode: 'off' }], ['Animation Off', { animation: 'off' }], ['reduced motion', { reduced: 'reduce' }]]) {
      const requested = []; await open({ scene: 'christmas', ...options, onPage: target => target.on('request', request => requested.push(new URL(request.url()).pathname)) });
      await page.waitForTimeout(1200);
      assert.equal(await layer().count(), 0, `${label} mounts no scene`); assert.equal(await canvas().count(), 0); assert.deepEqual(await stages(), []);
      assert.ok(requested.some(path => /\/assets\/index-.*\.js$/.test(path)), 'the dashboard bundle itself was observed');
      assert.deepEqual(requested.filter(path => CHUNK.test(path)), [], `${label} downloads no 3D chunk`);
    }
    record('Theme Off, Animation Off and system reduced motion mount nothing and download no 3D chunk');
    assert.deepEqual(errors, []);
    return { checks, timings, renderer: webgl, seconds: Math.round((Date.now() - started) / 1000) };
  } finally { await browser.close(); await server.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' }, gpu: { type: 'boolean' } } });
  const result = await runScene3dQa(values); console.log(JSON.stringify({ passed: result.checks.length, seconds: result.seconds, renderer: result.renderer, readyMs: result.timings, checks: result.checks }, null, 2));
}
