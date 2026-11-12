// Developer tool, not part of any CI set: look at living scenes as the built app draws them.
// It starts an isolated source server with synthetic data (never the installed app or port 4318), opens
// /display for each scene on its own date and weather, and writes one PNG per scene to a folder YOU name.
// The project keeps no screenshots: name a temporary folder outside the checkout, look, then delete it.
//
//   node tests/ui/tools/scene-sheet.mjs --playwright <module> --edge <msedge.exe> --out <temp folder> christmas canada-day birthday
//   ... christmas+snow          a scene with weather over it (Combined mode)
//   ... --full                  scene at full opacity (default is the app's real opacity at --brightness)
//   ... --no-fade               without the fade-to-middle mask
//   ... --empty                 no widgets
//   ... --size 3840x2160        viewport (default 1920x1080)
//   ... --brightness 0.36       saved brightness (default 0.36)
//   ... --transparency 80       saved Transparency, 0-100 (#670; default none: the standard 50)
//   ... --float 1,-1            hold the float (#675) at a track position in [-1, 1] on each axis: 1,1 is the far
//                               right and top of its travel, -1,-1 the far left and bottom (default: where it is)
//   ... --seconds 20            let the scene run this long before the capture (default 3)
//   ... --measure               print build, frame and main-thread times instead of only capturing
//   ... --webgl gpu|software|off   real GPU (default), SwiftShader as on the CI runner, or the flat fallback
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openScene, startSceneServer, WEBGL_ARGS } from '../lib/scene-cases.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  playwright: { type: 'string' }, edge: { type: 'string' }, out: { type: 'string' }, size: { type: 'string', default: '1920x1080' }, brightness: { type: 'string', default: '0.36' }, transparency: { type: 'string' }, float: { type: 'string' },
  seconds: { type: 'string', default: '3' }, webgl: { type: 'string', default: 'gpu' }, full: { type: 'boolean' }, 'no-fade': { type: 'boolean' }, empty: { type: 'boolean' }, measure: { type: 'boolean' },
} });
const fail = message => { console.error(message); process.exit(1); };
if (!values.out) fail('Name a temporary folder with --out; this tool never chooses where images go.');
if (!positionals.length) fail('Name at least one scene, for example: christmas canada-day birthday christmas+snow');
if (!WEBGL_ARGS[values.webgl]) fail(`--webgl takes one of: ${Object.keys(WEBGL_ARGS).join(', ')}`);
const out = resolve(values.out), checkout = fileURLToPath(new URL('../../..', import.meta.url));
if (!relative(checkout, out).startsWith('..')) fail('Choose a folder outside the checkout: screenshots are never kept in the repository.');
const [width, height] = values.size.split('x').map(Number);
const transparency = values.transparency === undefined ? undefined : Number(values.transparency);
const held = values.float === undefined ? null : values.float.split(',').map(Number);
if (held && !(held.length === 2 && held.every(value => value >= -1 && value <= 1))) fail('--float takes two numbers from -1 to 1, for example 1,-1');
if (transparency !== undefined && !(Number.isInteger(transparency) && transparency >= 0 && transparency <= 100)) fail('--transparency takes a whole number from 0 to 100');
if (!(width > 0 && height > 0)) fail('--size takes WIDTHxHEIGHT, for example 1920x1080');
await mkdir(out, { recursive: true });

const { chromium } = createRequire(import.meta.url)(values.playwright ?? 'playwright');
const server = await startSceneServer();
const browser = await chromium.launch({ executablePath: values.edge, headless: true, args: WEBGL_ARGS[values.webgl] });
try {
  for (const spec of positionals) {
    const [scene, weather = null] = spec.split('+'), errors = [];
    const { context, page } = await openScene(browser, server, { scene, weather, viewport: { width, height }, brightness: Number(values.brightness), transparency, empty: values.empty, allowSoftware: values.webgl === 'software', pageErrors: errors });
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 300)); });
    const layer = page.locator('.ambient-theme');
    await layer.waitFor({ timeout: 15_000 });
    await page.waitForFunction(() => { const node = document.querySelector('.ambient-theme'); return node?.dataset.sceneRenderer === 'flat' || node?.dataset.sceneState === 'ready'; }, null, { timeout: 30_000 });
    const renderer = await layer.getAttribute('data-scene-renderer');
    if (held && renderer === '3d') await page.evaluate(([x, y]) => [...window.__lrdScene3d][0].holdFloat({ x, y }), held);
    if (values.full || values['no-fade']) await page.addStyleTag({ content: `${values.full ? '.ambient-theme{opacity:1!important}' : ''}${values['no-fade'] ? '.ambient-theme{mask-image:none!important;-webkit-mask-image:none!important}' : ''}` });
    await page.waitForTimeout(Number(values.seconds) * 1000);
    const report = { scene: spec, renderer, tier: await layer.getAttribute('data-scene-tier'), opacity: Number(await layer.evaluate(node => getComputedStyle(node).opacity)) };
    if (renderer === '3d') Object.assign(report, await page.evaluate(() => {
      const stage = [...window.__lrdScene3d][0], probe = document.createElement('canvas').getContext('webgl2'), info = probe?.getExtension('WEBGL_debug_renderer_info');
      const stats = stage.stats(), gpu = info ? probe.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown'; probe?.getExtension('WEBGL_lose_context')?.loseContext();
      return { gpu, stages: window.__lrdScene3d.size, backing: stats.backing.join('x'), buildMs: Math.round(stats.buildMs), triangles: stats.triangles, drawCalls: stats.calls, float: stats.float, zoom: stats.zoom };
    }));
    if (values.measure && renderer === '3d') {
      // Main-thread task time over five seconds of the real 20-frames-a-second loop, then frames drawn back to back.
      const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
      const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
      const framesAt = () => page.evaluate(() => [...window.__lrdScene3d][0].stats().frames);
      const before = await metrics(), framesBefore = await framesAt(); await page.waitForTimeout(5000); const after = await metrics(), drawn = await framesAt() - framesBefore;
      const burst = await page.evaluate(() => { const stage = [...window.__lrdScene3d][0]; stage.measure(5); return stage.measure(40); });
      Object.assign(report, { loop: { seconds: 5, frames: drawn, mainThreadMsPerSecond: Math.round((after.TaskDuration - before.TaskDuration) * 1000 / 5), scriptMsPerSecond: Math.round((after.ScriptDuration - before.ScriptDuration) * 1000 / 5) },
        frame: { scriptMs: Number(burst.script.toFixed(2)), withGpuMs: Number(burst.finished.toFixed(2)) } });
      await cdp.detach();
    }
    const shot = await page.screenshot();
    // How much of the captured frame is lit and how bright (widgets included; add --empty for the scene alone).
    Object.assign(report, await page.evaluate(async base64 => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), character => character.charCodeAt(0))], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height), luminance = []; let lit = 0;
      for (let i = 0; i < data.length; i += 4) { const value = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2]; if (value > 6) { lit++; luminance.push(value); } }
      luminance.sort((a, b) => a - b);
      return { litPercent: Number((lit / (data.length / 4) * 100).toFixed(1)), medianLuminance: Math.round(luminance[Math.floor(luminance.length / 2)] ?? 0), p99Luminance: Math.round(luminance[Math.floor(luminance.length * .99)] ?? 0) };
    }, shot.toString('base64')));
    const file = join(out, `${spec.replace('+', '-with-')}-${width}x${height}${transparency === undefined ? '' : `-t${transparency}`}${held ? `-float${held.join('_')}` : ''}${values.full ? '-full' : ''}${values['no-fade'] ? '-nofade' : ''}${values.empty ? '-empty' : ''}.png`);
    await writeFile(file, shot);
    console.log(JSON.stringify({ ...report, file, ...(errors.length ? { errors } : {}) }));
    await context.close();
  }
  console.log(`Images are in ${out}. Look at them, then delete the folder: the project keeps no screenshots.`);
} finally { await browser.close(); await server.close(); }
