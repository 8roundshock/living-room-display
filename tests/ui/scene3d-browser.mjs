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
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height), total = data.length / 4; let lit = 0, coloured = 0;
      for (let i = 0; i < data.length; i += 4) { if (data[i] + data[i + 1] + data[i + 2] > 36) lit++; if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 40) coloured++; }
      return { lit: lit / total, coloured: coloured / total };
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

    // ---------- failures leave the flat scene on screen ----------
    await page.evaluate(() => { const element = document.querySelector('canvas.scene3d-canvas'); (element.getContext('webgl2') ?? element.getContext('webgl')).getExtension('WEBGL_lose_context').loseContext(); });
    await flat('birthday'); assert.equal(await canvas().count(), 0); assert.deepEqual(await stages(), []);
    // WebGL that answers the probe and then refuses: the renderer cannot be created.
    await open({ scene: 'canada-day', prepare: target => target.addInitScript(() => { const real = HTMLCanvasElement.prototype.getContext; let asked = 0;
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return /webgl/.test(kind) && asked++ > 0 ? null : real.call(this, kind, ...rest); }; }) });
    await flat('canada-day'); assert.equal(await canvas().count(), 0); assert.deepEqual(await stages(), []);
    record('A lost context, or WebGL that fails when the renderer is created, leaves the flat scene on screen and throws nothing to the page');

    // ---------- weather without an overlay module ----------
    await open({ scene: 'christmas', weather: 'wind' }); await flat('wind', 'christmas');
    assert.equal(await canvas().count(), 0); assert.deepEqual(await stages(), []);
    record('Weather over a 3D scene without an overlay module stays with the flat renderer, which draws that weather');

    // ---------- a quiet date, asked of the engine itself (no reference scene falls on one) ----------
    const quiet = await page.evaluate(async ({ enginePath, scenePath }) => {
      const [engine, scene] = await Promise.all([import(enginePath), import(scenePath)]);
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px'; document.body.append(host);
      let objects = 0, points = 0;
      const stage = engine.createStage(host, { build: (kit, ctx) => { scene.default(kit, ctx); kit.stage.traverse(object => { objects++; if (object.isPoints) points++; }); },
        ctx: { id: 'canada-day', amount: .15 * .4, size: .85, tier: 'special', weather: null, quiet: true, palette: ['#858f94', '#798788', '#858a90'], seed: 1, day: 1 },
        look: { glow: .65, shine: .8, seeThrough: 1, timeScale: 0 }, limits: { maxWidth: 2560, maxHeight: 1440, framesPerSecond: 20 }, clock: { start: 12, still: 14 }, allowSoftware: true });
      await new Promise(done => setTimeout(done, 400));
      const stats = stage.stats(), live = window.__lrdScene3d.size; stage.dispose(); host.remove();
      return { objects, points, frames: stats.frames, running: stats.running, frozen: stats.frozen, time: stats.time, live, left: window.__lrdScene3d.size };
    }, { enginePath: chunks.engine, scenePath: chunks['canada-day'] });
    assert.ok(quiet.frozen && !quiet.running && quiet.frames === 1 && quiet.time === 14, `a quiet scene is one frozen frame: ${JSON.stringify(quiet)}`);
    assert.equal(quiet.points, 0, 'nothing is in the air on a quiet date: no fireworks or other particle field'); assert.ok(quiet.objects > 20, 'the reduced scene is still a scene');
    assert.deepEqual([quiet.live, quiet.left], [1, 0]);
    record('On a quiet date the engine draws one frozen frame with nothing in the air');

    // ---------- the editor's still preview: one frame, no loop ----------
    await open({ scene: 'canada-day', path: '/editor' }); await ready();
    const still = await attributes(), [stillStage] = await stages();
    assert.equal(still.themeStill, 'true'); assert.equal(still.sceneFrames, '1'); assert.ok(stillStage.frozen && !stillStage.running && stillStage.frames === 1, JSON.stringify(stillStage));
    assert.ok(still.opacity > 0 && still.opacity <= still.brightness + .0005, `the preview stays within its brightness: ${still.opacity} of ${still.brightness}`);
    assert.equal(await canvas().evaluate(element => element.getAnimations().length), 0, 'a still preview does not fade in');
    await page.waitForTimeout(900); assert.equal((await stages())[0].frames, 1, 'no loop runs behind a still preview');
    const preview = await drawnShare({ clip: await canvas().boundingBox() });
    assert.ok(preview.lit > .01 && preview.coloured > .002, `the single still frame is on screen: ${JSON.stringify(preview)}`);
    record('The editor still preview draws exactly one frame, runs no loop and shows it');

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
