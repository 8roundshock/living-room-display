// Census of the 3D scenes (#675 review): builds every scene and weather overlay in Node with the real
// three.js r128 and the real kit (2D canvases and the environment map are stubbed: nothing here draws)
// and counts what each puts on the stage, so a test can catch an edit that silently drops a hero.
// Self-contained on purpose (no float or edge-check code), so it also runs against an older checkout
// to take a baseline. Each scene's baseline is its own file, tests/scene3d/census/<id>.json (an overlay's
// is weather-<kind>.json), so two pull requests never edit the same baseline:
//
//   node tests/scene3d/census.mjs                print every scene and overlay, everyday and quiet, at 16:9
//   node tests/scene3d/census.mjs --write my-scene   write (or replace) tests/scene3d/census/my-scene.json
import * as THREE from 'three';
import { readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createKit } from '../../src/client/scene3d/kit/index.js';
import { sceneLook, sceneSeed } from '../../src/client/scene3d/settings.ts';
import { sceneTier } from '../../src/client/scene3d/tier.ts';
import { previewTheme } from '../../src/client/ambient-theme.ts';

const folder = name => fileURLToPath(new URL(`../../src/client/scene3d/${name}/`, import.meta.url));
const modules = name => readdirSync(folder(name)).filter(file => file.endsWith('.js') && !file.startsWith('_')).map(file => file.slice(0, -3)).sort();
export const SCENE_IDS = modules('scenes'), WEATHER_KINDS = modules('weather');

const gradient = { addColorStop() {} };
const context2d = new Proxy({}, {
  get: (target, key) => key in target ? target[key] : key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern' ? () => gradient
    : key === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : key === 'createImageData' ? (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })
    : key === 'measureText' ? () => ({ width: 0 }) : () => {},
  set: (target, key, value) => { target[key] = value; return true; },
});
if (typeof globalThis.document === 'undefined') globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => context2d, addEventListener() {} }) };
class Environment { fromScene() { return new THREE.WebGLRenderTarget(4, 4); } dispose() {} }
const T = { ...THREE, PMREMGenerator: Environment };
const renderer = { capabilities: { getMaxAnisotropy: () => 1 } };
const FOV = 30, HALF_HEIGHT = 4.5, DEPTH = HALF_HEIGHT / Math.tan(FOV / 2 * Math.PI / 180);

/** What `id` (a scene, or with `overlay` that weather kind drawn alone) puts on the stage at 16:9, after one frame at the still instant. */
export async function census(id, { overlay = null, quiet = false } = {}) {
  const build = (await import(pathToFileURL(`${folder(overlay ? 'weather' : 'scenes')}${overlay ?? id}.js`).href)).default;
  const shown = previewTheme(id), tier = sceneTier(shown, 2026), look = sceneLook(id, tier, quiet), aspect = 16 / 9;
  const view = Object.freeze({ halfW: HALF_HEIGHT * aspect, halfH: HALF_HEIGHT, aspect, depth: DEPTH, halfWAt: z => HALF_HEIGHT * aspect * (1 - z / DEPTH), halfHAt: z => HALF_HEIGHT * (1 - z / DEPTH) });
  const ctx = Object.freeze({ id, amount: look.amount, size: look.size, tier, weather: overlay, quiet, palette: Object.freeze([shown.tint, shown.companion, shown.accent]), seed: sceneSeed(id), day: 20404, width: 1920, height: 1080 });
  const made = createKit(T, renderer, ctx, look, view);
  build(made.kit, ctx); made.animate(14);
  let objects = 0, triangles = 0;
  made.kit.stage.traverse(object => {
    if (!(object.isMesh || object.isLine || object.isPoints || object.isSprite)) return;
    objects++;
    const geometry = object.geometry, count = object.isInstancedMesh ? object.count : 1;
    if (object.isMesh && geometry) triangles += (geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0) / 3 * count;
  });
  made.dispose();
  return { objects, triangles: Math.round(triangles) };
}

/** One baseline file's counts: a scene everyday and quiet, or an overlay (`weather-<kind>`) over a season. */
export async function censusOf(name) {
  if (name.startsWith('weather-')) return { 'over summer': await census('summer', { overlay: name.slice(8) }) };
  return { everyday: await census(name), quiet: await census(name, { quiet: true }) };
}
/** The baseline file names: every scene and every overlay. */
export const CENSUS_NAMES = [...SCENE_IDS, ...WEATHER_KINDS.map(kind => `weather-${kind}`)];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const write = process.argv.indexOf('--write'), names = write < 0 ? CENSUS_NAMES : process.argv.slice(write + 1);
  for (const name of names) {
    if (!CENSUS_NAMES.includes(name)) throw new Error(`${name} is not a scene or weather-<kind>; known: ${CENSUS_NAMES.join(', ')}`);
    const counts = await censusOf(name);
    if (write < 0) { console.log(name, JSON.stringify(counts)); continue; }
    writeFileSync(new URL(`./census/${name}.json`, import.meta.url), JSON.stringify({ taken: 'the pull request that added or reworked it', ...counts }) + '\n');
    console.log(`wrote tests/scene3d/census/${name}.json`, JSON.stringify(counts));
  }
}
