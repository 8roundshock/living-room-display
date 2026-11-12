// Edge check for the 3D scenes (#675): builds every scene and every weather overlay in Node with the
// real three.js r128 and the real kit (2D canvases and the environment map are stubbed: nothing here
// draws), samples the scene clock, and measures how far each element that sits at a frame edge
// reaches beyond it. The scene float moves and zooms the picture (settings.ts SCENE_FLOAT); an
// element anchored at an edge keeps its cut end (or its base on the bottom edge) out of sight only
// if zoom × (1 + reach) − travel ≥ 1 on that axis. src/client/scene3d/float.test.ts runs it.
//
//   node tests/scene3d/edge-check.mjs            a table of every scene and overlay at 16:9 and 21:9
//
// Measured in normalised device coordinates (NDC): the frame is −1 to 1 on each axis, so a reach of
// 0.01 is half a per cent of the display's width (x) or height (y).
import * as THREE from 'three';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createKit } from '../../src/client/scene3d/kit/index.js';
import { CAMERA, SCENE_FLOAT, sceneLook, sceneSeed } from '../../src/client/scene3d/settings.ts';
import { sceneTier } from '../../src/client/scene3d/tier.ts';
import { previewTheme } from '../../src/client/ambient-theme.ts';

const folder = name => fileURLToPath(new URL(`../../src/client/scene3d/${name}/`, import.meta.url));
const modules = name => readdirSync(folder(name)).filter(file => file.endsWith('.js') && !file.startsWith('_')).map(file => file.slice(0, -3)).sort();
export const SCENE_IDS = modules('scenes'), WEATHER_KINDS = modules('weather');
export const ASPECTS = { '16:9': 16 / 9, '21:9': 64 / 27 };
/** Within this of the bottom or top edge (NDC) an element counts as standing on it or hanging from it:
 * about 1 px at 1080p. On the side edges only an element that crosses the edge is anchored there: things
 * enter from the sides (boughs, cords, branches), while a whole object merely near a side edge may show
 * more of itself when the picture moves. */
export const TOUCH = .002;
/** Scene-clock seconds sampled: the start, the still instant and the next hour of real time. */
const TIMES = [12, 14, 19, 27, 38, 52, 70, 95, 130, 180, 250, 340, 450];
/** Scenes that arrange themselves by the day are measured on a week of days. */
const DAYS = [20404, 20405, 20406, 20407, 20408, 20409, 20410];

// ---------- stubs: a 2D canvas that records nothing, and an environment map that is never rendered ----------
const gradient = { addColorStop() {} };
const context2d = new Proxy({}, {
  get: (target, key) => key in target ? target[key] : key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern' ? () => gradient
    : key === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : key === 'createImageData' ? (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) : key === 'measureText' ? () => ({ width: 0 }) : () => {},
  set: (target, key, value) => { target[key] = value; return true; },
});
const canvas = () => ({ width: 0, height: 0, style: {}, getContext: () => context2d, addEventListener() {} });
if (typeof globalThis.document === 'undefined') globalThis.document = { createElement: canvas };
class Environment { fromScene() { return new THREE.WebGLRenderTarget(4, 4); } dispose() {} }
const T = { ...THREE, PMREMGenerator: Environment };
const renderer = { capabilities: { getMaxAnisotropy: () => 1 } };

const load = async (kind, id) => (await import(pathToFileURL(`${folder(kind)}${id}.js`).href)).default;

/** The NDC extent of every element of one build at every sampled instant. */
function sample(made, camera) {
  const extents = new Map(), matrix = new THREE.Matrix4(), instance = new THREE.Matrix4();
  for (const t of TIMES) {
    made.animate(t); made.kit.stage.updateMatrixWorld(true);
    made.kit.stage.traverse(object => {
      if (!(object.isMesh || object.isLine) || object.isPoints || object.isSprite || !object.geometry?.attributes?.position) return;
      for (let up = object; up; up = up.parent) if (!up.visible) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      // A shader material places its own vertices (rain threads, flakes, fog bands, the storm cloud): its geometry says nothing about the screen.
      if (materials.some(material => material.isShaderMaterial || material.isRawShaderMaterial)) return;
      const position = object.geometry.attributes.position, count = object.isInstancedMesh ? object.count : 1, box = [Infinity, -Infinity, Infinity, -Infinity];
      for (let i = 0; i < count; i++) {
        if (object.isInstancedMesh) { object.getMatrixAt(i, instance); matrix.multiplyMatrices(object.matrixWorld, instance); } else matrix.copy(object.matrixWorld);
        matrix.premultiply(camera.matrixWorldInverse).premultiply(camera.projectionMatrix);
        const e = matrix.elements;
        for (let v = 0; v < position.count; v++) {
          const x = position.getX(v), y = position.getY(v), z = position.getZ(v), w = e[3] * x + e[7] * y + e[11] * z + e[15];
          if (!(w > 0)) continue;
          const sx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w, sy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
          if (sx < box[0]) box[0] = sx; if (sx > box[1]) box[1] = sx; if (sy < box[2]) box[2] = sy; if (sy > box[3]) box[3] = sy;
        }
      }
      if (!(box[0] <= box[1])) return;
      const colour = materials[0]?.color ? `#${materials[0].color.clone().convertLinearToSRGB().getHexString()}` : '';
      const name = `${object.type}:${object.geometry.type}(${position.count}${count > 1 ? `x${count}` : ''})${colour}${object.name ? ` "${object.name}"` : ''}`;
      const key = object.uuid, entry = extents.get(key) ?? { name, boxes: [] };
      entry.boxes.push(box); extents.set(key, entry);
    });
  }
  return [...extents.values()].filter(entry => entry.boxes.length === TIMES.length);
}

/** For each edge, the elements anchored there at every sampled instant and how far each reaches beyond it at least. */
function anchored(elements) {
  const edges = { left: [], right: [], bottom: [], top: [] };
  for (const { name, boxes } of elements) {
    const reach = (pick, sign) => Math.min(...boxes.map(box => sign * pick(box) - 1));
    const sides = { left: reach(box => box[0], -1), right: reach(box => box[1], 1), bottom: reach(box => box[2], -1), top: reach(box => box[3], 1) };
    for (const [edge, value] of Object.entries(sides)) if (edge === 'left' || edge === 'right' ? value > 0 : value >= -TOUCH) edges[edge].push({ name, reach: value });
  }
  for (const list of Object.values(edges)) list.sort((a, b) => a.reach - b.reach);
  return edges;
}

/**
 * Builds `id` (a scene, or with `overlay` the weather kind drawn alone over an empty stage) at `aspect`
 * and returns the elements anchored at each edge with the least reach first.
 */
export async function measure(id, { aspect = ASPECTS['16:9'], overlay = null, day = DAYS[0] } = {}) {
  const sceneId = id, build = overlay ? null : await load('scenes', id), over = overlay ? await load('weather', overlay) : null;
  const shown = previewTheme(sceneId), tier = sceneTier(shown, 2026);
  const look = sceneLook(sceneId, tier), depth = CAMERA.halfHeight / Math.tan(CAMERA.fov / 2 * Math.PI / 180);
  const view = Object.freeze({ halfW: CAMERA.halfHeight * aspect, halfH: CAMERA.halfHeight, aspect, depth, halfWAt: z => CAMERA.halfHeight * aspect * (1 - z / depth), halfHAt: z => CAMERA.halfHeight * (1 - z / depth) });
  const ctx = Object.freeze({ id: sceneId, amount: look.amount, size: look.size, tier, weather: overlay, quiet: false, palette: Object.freeze([shown.tint, shown.companion, shown.accent]), seed: sceneSeed(sceneId), day, width: Math.round(1080 * aspect), height: 1080 });
  const made = createKit(T, renderer, ctx, look, view);
  build?.(made.kit, ctx); over?.(made.kit, ctx);
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, .1, 120); camera.position.set(0, 0, depth); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  const edges = anchored(sample(made, camera));
  made.dispose();
  return edges;
}

/** The least reach on each axis among anchored elements (Infinity when none sits at that axis's edges). */
export function leastReach(edges) {
  const least = list => list.length ? list[0].reach : Infinity;
  return { x: Math.min(least(edges.left), least(edges.right)), y: Math.min(least(edges.bottom), least(edges.top)) };
}
/** How far the picture may travel on an axis (NDC) at `zoom` before an element with `reach` shows its end. */
export const travelAllowed = (reach, zoom) => zoom * (1 + reach) - 1;
/** Every element anchored at an edge whose end (or base) the float's extremes would bring into view, with the gap in NDC. */
export function exposed(edges, { zoom, x, y } = floatExtremes()) {
  const out = [];
  for (const [edge, list] of Object.entries(edges)) for (const item of list) {
    const clearance = zoom * (1 + item.reach) - (edge === 'left' || edge === 'right' ? x : y) - 1;
    if (clearance < -1e-9) out.push({ edge, ...item, clearance });
  }
  return out;
}
/** The float's extremes in NDC: SCENE_FLOAT holds them as shares of the display. */
export const floatExtremes = () => ({ zoom: SCENE_FLOAT.zoom, x: 2 * SCENE_FLOAT.travelX, y: 2 * SCENE_FLOAT.travelY });

/** Every case: each scene on a week of days where it varies by day, and each overlay over a season and a holiday. */
export async function measureAll() {
  const rows = [], daily = new Set(['autumn', 'spring', 'summer', 'winter']);
  for (const [label, aspect] of Object.entries(ASPECTS)) {
    for (const id of SCENE_IDS) for (const day of daily.has(id) ? DAYS : DAYS.slice(0, 1)) rows.push({ case: id, aspect: label, day, edges: await measure(id, { aspect, day }) });
    for (const kind of WEATHER_KINDS) for (const over of ['summer', 'christmas']) rows.push({ case: `${kind} over ${over}`, aspect: label, day: DAYS[0], edges: await measure(over, { aspect, overlay: kind }) });
  }
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = await measureAll(), { zoom, x, y } = floatExtremes();
  console.log(`float: zoom ${zoom}, travel ±${x.toFixed(3)} x, ±${y.toFixed(3)} y (NDC)`);
  const worst = new Map();
  for (const row of rows) {
    const key = `${row.case} ${row.aspect}`, least = leastReach(row.edges), previous = worst.get(key);
    if (!previous || least.x < previous.least.x || least.y < previous.least.y) worst.set(key, { row, least: { x: Math.min(least.x, previous?.least.x ?? Infinity), y: Math.min(least.y, previous?.least.y ?? Infinity) } });
  }
  for (const [key, { row, least }] of worst) {
    const ax = travelAllowed(least.x, zoom), ay = travelAllowed(least.y, zoom);
    const name = edge => row.edges[edge][0] ? `${edge} ${row.edges[edge][0].reach.toFixed(3)} ${row.edges[edge][0].name}` : '';
    console.log(`${key.padEnd(30)} reach x ${least.x === Infinity ? '  -  ' : least.x.toFixed(3)} y ${least.y === Infinity ? '  -  ' : least.y.toFixed(3)}  allows x ${ax === Infinity ? ' - ' : ax.toFixed(3)} y ${ay === Infinity ? ' - ' : ay.toFixed(3)} ${ax < x || ay < y ? 'FAIL' : 'ok'}  ${['left', 'right', 'bottom', 'top'].map(name).filter(Boolean).join(' | ')}`);
  }
}
