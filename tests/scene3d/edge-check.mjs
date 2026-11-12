// Edge check for the 3D scenes (#675): builds every scene and every weather overlay in Node with the
// real three.js r128 and the real kit (2D canvases and the environment map are stubbed: nothing here
// draws), samples the scene clock, and checks two things against the scene float (settings.ts
// SCENE_FLOAT), which moves and zooms the picture:
// - Cut ends: an element anchored at an edge keeps its cut end (or its base on the bottom edge) out of
//   sight only if zoom × (1 + reach) − travel ≥ 1 on that axis.
// - Crop: a piece that was wholly in the frame before the float (float 0, no zoom) must stay whole at
//   every float position. A piece resting near the bottom edge sits on the visible bottom at the centre
//   position (or on whatever it rests on), never above it by more than 0.3% of the height; one taller
//   than twice the vertical travel is whole at the centre and keeps 60% in view at every position, while
//   flat litter (a fallen leaf, a petal) keeps 60% at the centre and may be cut further at the low extreme
//   (owner decision on #675, 2026-11-12).
// src/client/scene3d/float.test.ts runs it.
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
import { floatPath, SCENE_TRACK } from '../../src/shared/float.ts';
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
/** A piece whose lowest point is this close to the bottom edge (NDC; the lowest 7.5% of the height) rests on it. */
export const RESTING = .15;
/** A piece taller than this (NDC, 40% of the height) is a composition anchored low (a balloon bunch on its string), not a resting piece. */
const RESTING_TALL = .8;
/** A resting piece keeps at least this share of its area in view at every float position (flat litter: at the centre). */
export const RESTING_SHARE = .6;
/** At the centre position a resting piece that stands on nothing else sits on the visible bottom: no higher than this (NDC, 0.3% of the height). */
export const RESTING_GAP = .006;
/** A resting piece at most this tall (NDC, twice the vertical travel) is flat litter. */
const LITTER = () => 4 * SCENE_FLOAT.travelY;
/** A piece whose middle moves further than this (NDC) over the sampled instants travels, and is not checked for crop. */
const MOVING = .05;
/** Slack for "whole" (NDC): half a pixel at 1080p. */
const WHOLE = .001;

const grow = (box, other) => { box[0] = Math.min(box[0], other[0]); box[1] = Math.max(box[1], other[1]); box[2] = Math.min(box[2], other[2]); box[3] = Math.max(box[3], other[3]); return box; };
const empty = () => [Infinity, -Infinity, Infinity, -Infinity];
const inside = box => box[0] >= -1 && box[1] <= 1 && box[2] >= -1 && box[3] <= 1;
/** A piece smaller than this on both axes (NDC: 1.5% of the width and of the height) is a speck: a bulb, a bead, a flower's eye. */
const tiny = box => box[1] - box[0] < .03 && box[3] - box[2] < .03;
const touching = (a, b, slack = .01) => a[0] <= b[1] + slack && b[0] <= a[1] + slack && a[2] <= b[3] + slack && b[2] <= a[3] + slack;

/** The NDC extent of every element of one build at every sampled instant: `elements` (a mesh, a line or a
 * whole instanced mesh) for the cut-end rule, and `pieces` for the crop rule (see below). */
function sample(made, camera) {
  const extents = new Map(), leaves = new Map(), matrix = new THREE.Matrix4(), instance = new THREE.Matrix4();
  for (const t of TIMES) {
    made.animate(t); made.kit.stage.updateMatrixWorld(true);
    made.kit.stage.traverse(object => {
      if (!(object.isMesh || object.isLine) || object.isPoints || object.isSprite || !object.geometry?.attributes?.position) return;
      for (let up = object; up; up = up.parent) if (!up.visible) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      // A shader material places its own vertices (rain threads, flakes, fog bands, the storm cloud): its geometry says nothing about the screen.
      if (materials.some(material => material.isShaderMaterial || material.isRawShaderMaterial)) return;
      const position = object.geometry.attributes.position, count = object.isInstancedMesh ? object.count : 1, box = [Infinity, -Infinity, Infinity, -Infinity], each = [];
      for (let i = 0; i < count; i++) {
        if (object.isInstancedMesh) { object.getMatrixAt(i, instance); matrix.multiplyMatrices(object.matrixWorld, instance); } else matrix.copy(object.matrixWorld);
        matrix.premultiply(camera.matrixWorldInverse).premultiply(camera.projectionMatrix);
        const e = matrix.elements, own = [Infinity, -Infinity, Infinity, -Infinity];
        for (let v = 0; v < position.count; v++) {
          const x = position.getX(v), y = position.getY(v), z = position.getZ(v), w = e[3] * x + e[7] * y + e[11] * z + e[15];
          if (!(w > 0)) continue;
          const sx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w, sy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
          if (sx < own[0]) own[0] = sx; if (sx > own[1]) own[1] = sx; if (sy < own[2]) own[2] = sy; if (sy > own[3]) own[3] = sy;
        }
        if (own[0] <= own[1]) { each.push(own); box[0] = Math.min(box[0], own[0]); box[1] = Math.max(box[1], own[1]); box[2] = Math.min(box[2], own[2]); box[3] = Math.max(box[3], own[3]); }
      }
      if (!(box[0] <= box[1])) return;
      const colour = materials[0]?.color ? `#${materials[0].color.clone().convertLinearToSRGB().getHexString()}` : '';
      const name = `${object.type}:${object.geometry.type}(${position.count}${count > 1 ? `x${count}` : ''})${colour}${object.name ? ` "${object.name}"` : ''}`;
      const key = object.uuid, entry = extents.get(key) ?? { name, boxes: [] };
      entry.boxes.push(box); extents.set(key, entry);
      const leaf = leaves.get(object) ?? { name, box: empty(), each: each.map(() => empty()), times: 0, at: [], z: object.getWorldPosition(new THREE.Vector3()).z };
      grow(leaf.box, box); each.forEach((own, i) => { if (leaf.each[i]) grow(leaf.each[i], own); }); leaf.times++; leaf.at.push(box); leaves.set(object, leaf);
    });
  }
  const steady = list => [...list.values()].filter(entry => entry.boxes.length === TIMES.length);
  return { elements: steady(extents), pieces: pieces(made.kit.stage, leaves), supports: [...leaves.values()].filter(leaf => leaf.times === TIMES.length).map(leaf => leaf.box) };
}

/** Whether something else holds `piece` up: a drawn element whose top is at the piece's bottom (a napkin under an
 * egg, a table under a cake, a neighbour a leaf leans on), overlapping it sideways. A tall element behind it (a
 * tree, a branch) is not a support: its top is far above the piece's bottom. */
/** Whether nothing else is drawn lower than `piece` across its width: it lies on the bare bottom (a fallen leaf, a
 * vase on the ground), not at the end of something that reaches lower (a bud on a runner, an ornament on a tree). */
function grounded(piece, boxes) {
  const [left, right, bottom] = piece.box, width = right - left;
  return !boxes.some(box => box[2] < bottom - .005 && Math.min(right, box[1]) - Math.max(left, box[0]) > width * .3);
}
function supported(piece, boxes) {
  const [left, right, bottom, top] = piece.box, width = right - left, height = top - bottom;
  return boxes.some(box => box[2] < bottom - .002 && box[3] >= bottom - .01 && box[3] <= bottom + Math.max(.02, height * .5)
    && Math.min(right, box[1]) - Math.max(left, box[0]) > width * .3);
}

/**
 * Pieces for the crop rule, from each drawn leaf's extent over every sampled instant. A piece is a whole
 * subtree of the scene (a cake, a gift, an egg, a lantern) that lies inside the frame before the float
 * (float 0, no zoom), and the largest such subtree: a group that reaches past an edge is split into its
 * children; an instanced mesh that reaches past an edge into its instances, which are that element's own
 * parts (needles, grains) and go with it. A piece that touches an element crossing an edge (a cone on a bough,
 * a bulb on a garland, a lantern on its cord) is attached to it and may be cropped with it, unless it rests
 * near the bottom edge: an egg on a napkin or a gift on a table must still keep to the resting rule.
 */
function pieces(stage, leaves) {
  const out = [], boxes = new Map(), paths = new Map();
  /** Where the middle of a node is at each sampled instant: a piece that travels (a seed on the wind, a drifting
   * leaf) passes through the edges as it goes and is not cropped by the float alone. */
  const path = node => {
    if (paths.has(node)) return paths.get(node);
    const at = TIMES.map(() => empty()), leaf = leaves.get(node);
    if (leaf && leaf.times === TIMES.length) leaf.at.forEach((box, i) => grow(at[i], box));
    for (const child of node.children) path(child).forEach((box, i) => { if (box[0] <= box[1]) grow(at[i], box); });
    paths.set(node, at); return at;
  };
  const travels = node => { const middles = path(node).filter(box => box[0] <= box[1]).map(box => [(box[0] + box[1]) / 2, (box[2] + box[3]) / 2]);
    return middles.length > 1 && (Math.max(...middles.map(m => m[0])) - Math.min(...middles.map(m => m[0])) > MOVING || Math.max(...middles.map(m => m[1])) - Math.min(...middles.map(m => m[1])) > MOVING); };
  const extent = node => {
    if (boxes.has(node)) return boxes.get(node);
    const leaf = leaves.get(node), box = leaf && leaf.times === TIMES.length ? [...leaf.box] : empty();
    for (const child of node.children) { const own = extent(child); if (own[0] <= own[1]) grow(box, own); }
    boxes.set(node, box); return box;
  };
  const crossing = []; stage.traverse(item => { const leaf = leaves.get(item); if (leaf && leaf.times === TIMES.length && !inside(leaf.box)) crossing.push(leaf.box); });
  const add = (name, box, part, z) => out.push({ name, box, z, resting: box[2] <= -1 + RESTING && box[3] - box[2] <= RESTING_TALL, part, attached: part || crossing.some(anchor => touching(box, anchor)) });
  const depth = node => { let z = 0, size = -1; node.traverse(item => { const leaf = leaves.get(item); if (leaf) { const area = (leaf.box[1] - leaf.box[0]) * (leaf.box[3] - leaf.box[2]); if (area > size) { size = area; z = leaf.z; } } }); return z; };
  const split = node => {
    const box = extent(node);
    if (!(box[0] <= box[1])) return;
    if (inside(box)) { if (!travels(node) && !tiny(box)) add(describe(node, leaves), box, false, depth(node)); return; }
    const leaf = leaves.get(node);
    // The instances of an instanced mesh that reaches past an edge are that element's own parts (needles, grains).
    if (leaf && leaf.times === TIMES.length && leaf.each.length > 1) leaf.each.forEach((each, i) => { if (inside(each) && !tiny(each)) add(`${leaf.name} [${i}]`, each, true, leaf.z); });
    for (const child of node.children) split(child);
  };
  for (const child of stage.children) split(child);
  return out;
}
const describe = (node, leaves) => {
  const names = []; node.traverse(item => { const leaf = leaves.get(item); if (leaf) names.push(leaf.name); });
  return names.length === 1 ? names[0] : `${node.type}${node.name ? ` "${node.name}"` : ''} of ${names.length}: ${names.slice(0, 2).join(', ')}${names.length > 2 ? ', ...' : ''}`;
};

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
 * and returns the elements anchored at each edge with the least reach first. `weather` builds the scene as it
 * is under that weather (ctx.weather, #646) with its overlay drawn over it, and `gust` (0-1) holds the wind's gust.
 */
export async function measure(id, { aspect = ASPECTS['16:9'], overlay = null, weather = null, gust = null, day = DAYS[0] } = {}) {
  const sceneId = id, build = overlay ? null : await load('scenes', id), over = overlay || weather ? await load('weather', overlay ?? weather) : null;
  const shown = previewTheme(sceneId), tier = sceneTier(shown, 2026);
  const look = sceneLook(sceneId, tier), depth = CAMERA.halfHeight / Math.tan(CAMERA.fov / 2 * Math.PI / 180);
  const view = Object.freeze({ halfW: CAMERA.halfHeight * aspect, halfH: CAMERA.halfHeight, aspect, depth, halfWAt: z => CAMERA.halfHeight * aspect * (1 - z / depth), halfHAt: z => CAMERA.halfHeight * (1 - z / depth) });
  const ctx = Object.freeze({ id: sceneId, amount: look.amount, size: look.size, tier, weather: overlay ?? weather, ...(gust === null ? {} : { gust }), quiet: false, palette: Object.freeze([shown.tint, shown.companion, shown.accent]), seed: sceneSeed(sceneId), day, width: Math.round(1080 * aspect), height: 1080 });
  const made = createKit(T, renderer, ctx, look, view);
  build?.(made.kit, ctx); over?.(made.kit, ctx);
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, .1, 120); camera.position.set(0, 0, depth); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  const { elements, pieces, supports } = sample(made, camera);
  made.dispose();
  return Object.assign(anchored(elements), { pieces: pieces.map(piece => ({ ...piece, supported: supported(piece, supports), grounded: grounded(piece, supports) })) });
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
  for (const edge of ['left', 'right', 'bottom', 'top']) for (const item of edges[edge]) {
    const clearance = zoom * (1 + item.reach) - (edge === 'left' || edge === 'right' ? x : y) - 1;
    if (clearance < -1e-9) out.push({ edge, ...item, clearance });
  }
  return out;
}
/** The float's extremes in NDC: SCENE_FLOAT holds them as shares of the display. */
export const floatExtremes = (float = SCENE_FLOAT) => ({ zoom: float.zoom, x: 2 * float.travelX, y: 2 * float.travelY });

/** Float positions in NDC: the real track at a 180 s interval sampled over 300 intervals, the centre and the four corners. */
function positions({ zoom, x, y }) {
  const list = [{ x: 0, y: 0 }];
  for (const [ux, uy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) list.push({ x: ux * x, y: uy * y });
  for (let i = 0; i < 3600; i++) { const unit = floatPath(i * 15, 180, SCENE_TRACK); list.push({ x: unit.x * x, y: unit.y * y }); }
  return { zoom, list, track: list.length - 5 };
}
/** The share of `box` (NDC) in view with the picture zoomed by `zoom` and moved by `at`. */
function inView(box, zoom, at) {
  const left = zoom * box[0] + at.x, right = zoom * box[1] + at.x, bottom = zoom * box[2] + at.y, top = zoom * box[3] + at.y;
  const width = right - left, height = top - bottom;
  const seenX = width > 0 ? Math.max(0, Math.min(1, right) - Math.max(-1, left)) / width : (left >= -1 && left <= 1 ? 1 : 0);
  const seenY = height > 0 ? Math.max(0, Math.min(1, top) - Math.max(-1, bottom)) / height : (bottom >= -1 && bottom <= 1 ? 1 : 0);
  const whole = left >= -1 - WHOLE && right <= 1 + WHOLE && bottom >= -1 - WHOLE && top <= 1 + WHOLE;
  return { share: seenX * seenY, whole };
}
/**
 * Every piece that was wholly in the frame before the float and is cut by it, or floats above the bottom:
 * - not resting: cut at any position (unless attached to an element that crosses an edge);
 * - resting near the bottom edge and standing on nothing else: more than RESTING_GAP above the visible bottom at
 *   the centre position;
 * - resting and taller than flat litter: cut at the centre, or less than RESTING_SHARE of it in view at some position;
 * - flat litter: less than RESTING_SHARE in view at the centre (it may be cut further at the low extreme).
 * Each comes with the share of the track's time it is whole, its least share in view and its gap at the centre.
 */
export function crops(pieces, float = floatExtremes()) {
  const { zoom, list, track } = positions(float), out = [];
  for (const piece of pieces) {
    let whole = 0, least = 1, centre = true, centreShare = 1;
    list.forEach((at, index) => {
      const seen = inView(piece.box, zoom, at);
      if (index === 0) { centre = seen.whole; centreShare = seen.whole ? 1 : seen.share; }
      if (index >= 5 && seen.whole) whole++;
      least = Math.min(least, seen.whole ? 1 : seen.share);
    });
    // The gap between the piece's lowest point and the visible bottom at the centre position (screen NDC; negative is below it).
    const gap = zoom * piece.box[2] + 1, litter = piece.box[3] - piece.box[2] <= LITTER(), floats = !piece.supported && gap > RESTING_GAP;
    let fails;
    // Near the bottom but held by an element that enters from an edge (a bud on its runner, an ornament on its tree)
    // and standing on nothing: it hangs, it does not rest.
    // Near the bottom, held by an element that enters from an edge and with something of it reaching lower (a bud on
    // its runner, an ornament on its tree): it hangs there, it does not rest on the bottom.
    if (!piece.resting || piece.part || (piece.attached && !piece.supported && !piece.grounded)) fails = !piece.attached && least < 1;
    else if (litter) fails = floats || centreShare < RESTING_SHARE;
    else fails = floats || !centre || least < RESTING_SHARE;
    if (fails) out.push({ ...piece, wholeShare: whole / track, least, centre, centreShare, gap, litter });
  }
  return out;
}

/** Every case: each scene on a week of days where it varies by day, and each overlay over a season and a holiday. */
export async function measureAll() {
  const rows = [], daily = new Set(['autumn', 'spring', 'summer', 'winter']);
  for (const [label, aspect] of Object.entries(ASPECTS)) {
    for (const id of SCENE_IDS) for (const day of daily.has(id) ? DAYS : DAYS.slice(0, 1)) rows.push({ case: id, aspect: label, day, edges: await measure(id, { aspect, day }) });
    for (const kind of WEATHER_KINDS) for (const over of ['summer', 'christmas']) rows.push({ case: `${kind} over ${over}`, aspect: label, day: DAYS[0], edges: await measure(over, { aspect, overlay: kind }) });
    // Every scene in the wind (#646), with the gust held at its lull and at its peak: the lean turns pieces about where they
    // are held, and the sway is twice as wide, so a cut end could show or a piece reach the cropped band.
    for (const id of SCENE_IDS.filter(id => !WEATHER_KINDS.includes(id))) for (const gust of [0, 1]) rows.push({ case: `${id} in wind (gust ${gust})`, aspect: label, day: DAYS[0], edges: await measure(id, { aspect, weather: 'wind', gust }) });
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
