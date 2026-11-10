import { LIVING_SCENE_BUDGET } from '../shared/theme-registry.ts';
import type { GroundKind, ParticleKind, SceneDressing, TopKind } from '../shared/living-scene-dressing.ts';
import type { LivingSceneArt } from '../shared/living-scene-art.ts';
import type { ThemeRect } from './ambient-theme.ts';

/** Procedural edge dressing for #586 (owner direction, 2026-11-09): a continuous
 * ground band along the whole bottom edge, a second band or swag along the top,
 * and depth-scaled particles. Everything here is pure geometry computed at
 * layout boundaries. The renderer draws it under the same reading mask as the
 * authored patches, so it can sit in widget whitespace but never on reading ink. */
export interface DressPath { d: string; tone: 0 | 1 | 2; fill?: number; stroke?: number; opacity?: number; light?: boolean }
export interface DressSegment { pivot: readonly [number, number]; phase: number; paths: DressPath[] }
export interface Pendant { x: number; y: number; length: number; period: number; phase: number; swing: number; paths: DressPath[] }
export interface EdgeBand { sway: number; segments: DressSegment[]; front: DressSegment[]; pendants: Pendant[]; lit: number }

const STEP = 6, OVERHANG = 30;
export const PENDANT_MAX = 12;
/** Deterministic unit noise; no random clock, so still previews and tests are stable. */
export const unit = (index: number, salt: number) => { const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453; return value - Math.floor(value); };
const wave = (x: number, seed: number) => .5 + .5 * (Math.sin(x * .011 + seed) * .5 + Math.sin(x * .027 + seed * 2.3) * .3 + Math.sin(x * .061 + seed * .7) * .2);
const n = (value: number) => Math.round(value * 10) / 10;

/** Usable depth of scenery in every column measured inward from one edge. Columns
 * under a reading area keep only the strip between that area and the edge; free
 * columns rise to the varied target. A slope limit turns the steps into ramps. */
export function edgeProfile(width: number, height: number, holes: readonly ThemeRect[], side: 'bottom' | 'top', low: number, high: number, seed: number, slope = 1.5) {
  const count = Math.ceil(width / STEP) + 1, pad = 26, gap = 8, profile = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const x = index * STEP;
    let cap = height * .5;
    for (const hole of holes) if (hole.left - pad < x && hole.right + pad > x) cap = Math.min(cap, side === 'bottom' ? height - hole.bottom - gap : hole.top - gap);
    const target = low + (high - low) * wave(x, seed) ** 1.4;
    profile[index] = cap < 12 ? 0 : Math.min(cap, target);
  }
  // Two passes bound the slope, so scenery ramps down toward a widget instead of ending in a wall.
  for (let index = 1; index < count; index++) profile[index] = Math.min(profile[index]!, profile[index - 1]! + STEP * slope);
  for (let index = count - 2; index >= 0; index--) profile[index] = Math.min(profile[index]!, profile[index + 1]! + STEP * slope);
  return profile;
}
const at = (profile: Float32Array, x: number) => profile[Math.max(0, Math.min(profile.length - 1, Math.round(x / STEP)))]!;
export const litColumns = (profile: Float32Array) => profile.reduce((sum, value) => sum + (value >= 12 ? 1 : 0), 0) / profile.length;

function silhouette(profile: Float32Array, from: number, to: number, base: number, direction: 1 | -1, scale: number, ripple: (x: number) => number) {
  let d = `M${n(from)} ${n(base)}`;
  for (let x = from; x <= to + .01; x += STEP) d += `L${n(Math.min(x, to))} ${n(base - direction * (at(profile, x) * scale + ripple(x)) - direction * 4)}`;
  return `${d}L${n(to)} ${n(base)}Z`;
}
function rim(profile: Float32Array, from: number, to: number, base: number, direction: 1 | -1, scale: number, ripple: (x: number) => number) {
  let d = '', pen = false;
  for (let x = from; x <= to + .01; x += STEP) {
    const depth = at(profile, x) * scale;
    if (depth < 10) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${n(x)} ${n(base - direction * (depth + ripple(x)) - direction * 4)}`; pen = true;
  }
  return d;
}
function leafShape(x: number, y: number, length: number, angle: number) {
  const tx = x + Math.cos(angle) * length, ty = y + Math.sin(angle) * length, mx = (x + tx) / 2, my = (y + ty) / 2;
  const px = -Math.sin(angle) * length * .34, py = Math.cos(angle) * length * .34;
  return `M${n(x)} ${n(y)}Q${n(mx + px)} ${n(my + py)} ${n(tx)} ${n(ty)}Q${n(mx - px)} ${n(my - py)} ${n(x)} ${n(y)}Z`;
}
const disc = (x: number, y: number, r: number) => `M${n(x - r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(r * 2)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-r * 2)} 0Z`;

/** Continuous bottom scenery. `segments` sit behind the authored patches and
 * `front` in front of their bases, so objects stand in the ground. */
export function groundBand(kind: GroundKind, width: number, height: number, holes: readonly ThemeRect[], seed = 1, boost = 1): EdgeBand {
  const short = Math.min(width, height), low = short * .05, high = short * boost * (kind === 'water' || kind === 'cloth' ? .1 : kind === 'grass' ? .19 : .15);
  const profile = edgeProfile(width, height, holes, 'bottom', low, high, seed, kind === 'grass' ? 1.5 : .55), base = height + 4;
  const parts = kind === 'grass' ? 5 : 1, segments: DressSegment[] = [], front: DressSegment[] = [];
  for (let part = 0; part < parts; part++) {
    // The band overhangs both sides, so its slow lateral shift never exposes an end.
    const from = part ? width * part / parts : -OVERHANG, to = part === parts - 1 ? width + OVERHANG : width * (part + 1) / parts, rear: DressPath[] = [], near: DressPath[] = [];
    if (kind === 'grass') {
      let back = '', mid = '', tips = '', heads = '', stems = '';
      for (let x = from, index = part * 400; x < to; index++, x += 7 + unit(index, 3) * 7) {
        const depth = at(profile, x); if (depth < 12) continue;
        const tall = depth * (.55 + .45 * unit(index, 5)), lean = (unit(index, 7) - .35) * tall * .32, half = 3 + unit(index, 9) * 3.5 + tall * .012;
        const blade = (h: number, l: number, w: number, cx: number) => `M${n(cx - w)} ${n(base)}Q${n(cx - w * .4 + l * .35)} ${n(base - h * .6)} ${n(cx + l)} ${n(base - h)}Q${n(cx + w * .6 + l * .35)} ${n(base - h * .55)} ${n(cx + w)} ${n(base)}Z`;
        back += blade(tall, lean, half, x);
        const shortBlade = tall * (.42 + .25 * unit(index, 11)), nearLean = (unit(index, 13) - .4) * shortBlade * .4;
        mid += blade(shortBlade, nearLean, half * 1.15, x + 4);
        if (index % 3 === 0) tips += `M${n(x + lean * .55)} ${n(base - tall * .62)}Q${n(x + lean * .8)} ${n(base - tall * .84)} ${n(x + lean)} ${n(base - tall)}`;
        if (index % 6 === 2 && tall > short * .1) {
          const hx = x + lean * 1.25 + 5, hy = base - tall * 1.12;
          stems += `M${n(x)} ${n(base)}Q${n(x + lean * .4)} ${n(base - tall * .7)} ${n(hx)} ${n(hy)}`;
          for (let seedHead = 0; seedHead < 3; seedHead++) heads += disc(hx - 3 + seedHead * 2.4 + (seedHead % 2) * 5, hy + seedHead * 9, 3.6);
        }
      }
      rear.push({ d: back, tone: 0, fill: .62, stroke: 0 }, { d: stems, tone: 1, stroke: 1.5, opacity: .8 }, { d: heads, tone: 1, fill: 1, stroke: 0 }, { d: tips, tone: 2, stroke: 1.6, opacity: .9 });
      near.push({ d: mid, tone: 0, fill: 1, stroke: 0 }, { d: rim(profile, from, to, base, 1, .2, x => Math.sin(x * .09) * 3), tone: 2, stroke: 1.2, opacity: .45 });
    } else if (kind === 'drift') {
      rear.push({ d: silhouette(profile, from, to, base, 1, 1, x => Math.sin(x * .013 + seed) * 6), tone: 0, fill: .5, stroke: 0 },
        { d: rim(profile, from, to, base, 1, 1, x => Math.sin(x * .013 + seed) * 6), tone: 0, stroke: 2.2, light: true, opacity: .9 });
      near.push({ d: silhouette(profile, from, to, base, 1, .55, x => Math.sin(x * .021 + seed * 3) * 5), tone: 0, fill: .92, stroke: 0, light: true },
        { d: rim(profile, from, to, base, 1, .3, x => Math.sin(x * .034 + seed) * 4), tone: 2, stroke: 1.4, opacity: .5 });
    } else if (kind === 'leaf') {
      rear.push({ d: silhouette(profile, from, to, base, 1, .5, x => Math.sin(x * .05 + seed) * 5), tone: 1, fill: .5, stroke: 0 });
      const leaves = ['', '', ''], veins: string[] = [];
      for (let x = from + 8, index = 0; x < to; index++, x += 15 + unit(index, 2) * 14) {
        const depth = at(profile, x); if (depth < 12) continue;
        const y = base - 10 - unit(index, 4) * depth * .78, length = 20 + unit(index, 6) * 22, angle = -Math.PI * (.15 + unit(index, 8) * .7);
        leaves[index % 3] += leafShape(x, y, length, angle);
        veins.push(`M${n(x)} ${n(y)}L${n(x + Math.cos(angle) * length * .8)} ${n(y + Math.sin(angle) * length * .8)}`);
      }
      near.push({ d: leaves[0]!, tone: 0, fill: 1, stroke: 0 }, { d: leaves[1]!, tone: 1, fill: .95, stroke: 0 }, { d: leaves[2]!, tone: 2, fill: .95, stroke: 0 }, { d: veins.join(''), tone: 2, stroke: 1, opacity: .5, light: true });
    } else if (kind === 'cloth') {
      const scallop = (x: number) => Math.abs(Math.sin(x * .034 + seed)) * 14;
      rear.push({ d: silhouette(profile, from, to, base, 1, .95, scallop), tone: 0, fill: .6, stroke: 0 });
      let dots = '';
      for (let x = from + 20, index = 0; x < to; index++, x += 46) { const depth = at(profile, x); if (depth >= 30) dots += disc(x, base - depth * .42, 4.5); }
      near.push({ d: silhouette(profile, from, to, base, 1, .6, x => Math.abs(Math.sin(x * .034 + seed + 1.2)) * 10), tone: 1, fill: .85, stroke: 0 },
        { d: rim(profile, from, to, base, 1, .6, x => Math.abs(Math.sin(x * .034 + seed + 1.2)) * 10), tone: 2, stroke: 2.4, light: true }, { d: dots, tone: 2, fill: 1, stroke: 0 });
    } else {
      // Water: layered ripples and a low reflective fill rather than a solid bank.
      rear.push({ d: silhouette(profile, from, to, base, 1, .34, x => Math.sin(x * .03 + seed) * 3), tone: 0, fill: .55, stroke: 0 });
      let ripples = '', glints = '';
      for (let row = 0; row < 5; row++) for (let x = from + unit(row, 3) * 60, index = row * 50; x < to; index++, x += 90 + unit(index, 5) * 120) {
        const depth = at(profile, x), y = base - 12 - row * 15; if (depth < base - y + 4) continue;
        const span = 34 + unit(index, 7) * 56;
        ripples += `M${n(x)} ${n(y)}q${n(span / 2)} ${n(-5 - row)} ${n(span)} 0`;
        if (index % 2) glints += `M${n(x + span * .25)} ${n(y + 5)}q${n(span * .25)} ${n(-3)} ${n(span * .5)} 0`;
      }
      near.push({ d: ripples, tone: 0, stroke: 2, light: true, opacity: .85 }, { d: glints, tone: 2, stroke: 1.4, opacity: .75 });
    }
    segments.push({ pivot: [(from + to) / 2, base], phase: part * .42, paths: rear.filter(path => path.d) });
    front.push({ pivot: [(from + to) / 2, base], phase: part * .42 + .2, paths: near.filter(path => path.d) });
  }
  return { sway: kind === 'grass' ? 2.6 : 0, segments, front, pendants: [], lit: litColumns(profile) };
}

/** A second edge for every scene: canopy, garland, bunting, icicles or cloud
 * hanging from the top, deep in free columns and a thin fringe above widgets. */
export function topBand(kind: TopKind, width: number, height: number, holes: readonly ThemeRect[], seed = 2): EdgeBand {
  const short = Math.min(width, height), deep = short * (kind === 'cloud' ? .17 : kind === 'bunting' || kind === 'streamer' || kind === 'lantern' ? .1 : .12);
  const profile = edgeProfile(width, height, holes, 'top', short * .022, deep, seed + 4, kind === 'cloud' ? .6 : 1.5), base = -4;
  const rear: DressPath[] = [], near: DressPath[] = [], pendants: Pendant[] = [];
  const bumps = (size: number, amount: number) => (x: number) => Math.abs(Math.sin(x * Math.PI / size + seed)) * amount;
  // Spacing is a share of the short side (callers pass 8-12% of it) and the count is
  // capped: every pendant is its own pendulum animation, so a sparse ultrawide or 4K
  // board must not multiply them past the scene's animation budget.
  const pendantSlots = (spacing: number, need: number, make: (x: number, index: number, depth: number) => Pendant) => {
    const free: { x: number; index: number; room: number }[] = [];
    for (let x = spacing * .5, index = 0; x < width; index++, x += spacing * (.8 + unit(index, 17) * .4)) {
      let room = height * .5;
      for (const hole of holes) if (hole.left - 30 < x && hole.right + 30 > x) room = Math.min(room, hole.top - 10);
      if (room >= need) free.push({ x, index, room });
    }
    const keep = Math.min(free.length, PENDANT_MAX);
    for (let slot = 0; slot < keep; slot++) { const pick = free[Math.floor((slot + .5) * free.length / keep)]!; pendants.push(make(pick.x, pick.index, Math.min(pick.room, short * .2))); }
  };
  if (kind === 'cloud') {
    rear.push({ d: silhouette(profile, -OVERHANG, width + OVERHANG, base, -1, 1, bumps(150, 16)), tone: 0, fill: .55, stroke: 0 });
    near.push({ d: silhouette(profile, -OVERHANG, width + OVERHANG, base, -1, .62, bumps(96, 12)), tone: 0, fill: .9, stroke: 0 },
      { d: rim(profile, -OVERHANG, width + OVERHANG, base, -1, .62, bumps(96, 12)), tone: 2, stroke: 2, light: true, opacity: .8 });
  } else if (kind === 'icicle') {
    let spikes = '', glint = '';
    for (let x = 6, index = 0; x < width; index++, x += 14 + unit(index, 3) * 16) {
      const depth = at(profile, x) * (.3 + .7 * unit(index, 5)); if (depth < 8) continue;
      const half = 4 + unit(index, 7) * 5;
      spikes += `M${n(x - half)} ${base}L${n(x)} ${n(depth)}L${n(x + half)} ${base}Z`;
      if (index % 2) glint += `M${n(x - half * .3)} ${n(depth * .2)}L${n(x)} ${n(depth * .8)}`;
    }
    rear.push({ d: silhouette(profile, -OVERHANG, width + OVERHANG, base, -1, .16, bumps(70, 5)), tone: 0, fill: .9, stroke: 0, light: true });
    near.push({ d: spikes, tone: 0, fill: .85, stroke: 0 }, { d: glint, tone: 2, stroke: 1.3, light: true, opacity: .9 });
  } else if (kind === 'fir' || kind === 'foliage' || kind === 'blossom') {
    let fringe = '', sprigs = '';
    if (kind === 'fir') for (let x = 0, index = 0; x < width; index++, x += 6 + unit(index, 3) * 6) {
      const depth = at(profile, x) * (.45 + .55 * unit(index, 5)); if (depth < 8) continue;
      const lean = (unit(index, 7) - .5) * depth * .5, half = 3.5 + unit(index, 9) * 3;
      fringe += `M${n(x - half)} ${base}L${n(x + lean)} ${n(depth)}L${n(x + half)} ${base}Z`;
      if (index % 4 === 0) sprigs += `M${n(x)} ${base}L${n(x + lean)} ${n(depth)}`;
    } else for (let x = 4, index = 0; x < width; index++, x += 13 + unit(index, 3) * 12) {
      const depth = at(profile, x); if (depth < 10) continue;
      const y = unit(index, 5) * depth * .55, length = 18 + unit(index, 7) * 24;
      fringe += leafShape(x, y, Math.min(length, depth - y + 6), Math.PI * (.3 + unit(index, 9) * .4));
      if (index % 5 === 0) sprigs += `M${n(x)} ${base}L${n(x + 6)} ${n(y + length * .7)}`;
    }
    rear.push({ d: silhouette(profile, -OVERHANG, width + OVERHANG, base, -1, kind === 'fir' ? .35 : .5, bumps(54, 8)), tone: 0, fill: .55, stroke: 0 });
    near.push({ d: fringe, tone: 0, fill: 1, stroke: 0 }, { d: sprigs, tone: kind === 'fir' ? 0 : 2, stroke: 1.4, light: true, opacity: .6 });
    pendantSlots(short * (kind === 'fir' ? .11 : .08), short * .09, (x, index, depth) => {
      const length = Math.min(depth - 34, 26 + unit(index, 11) * 52), r = kind === 'fir' ? 13 + unit(index, 13) * 8 : 9 + unit(index, 13) * 5, y = length + r;
      const tone = (1 + index % 2) as 1 | 2;
      const paths: DressPath[] = kind === 'fir'
        ? [{ d: `M${n(x)} 0L${n(x)} ${n(length)}`, tone: 2, stroke: 1.4, opacity: .8 }, { d: disc(x, y, r), tone, fill: 1, stroke: 0 }, { d: `M${n(x - r * .5)} ${n(y - r * .35)}q${n(r * .2)} ${n(-r * .4)} ${n(r * .6)} ${n(-r * .45)}`, tone, stroke: 2.2, light: true }, { d: `M${n(x - 4)} ${n(length - 2)}h8v5h-8Z`, tone: 2, fill: 1, stroke: 0 }]
        : [{ d: `M${n(x)} 0L${n(x)} ${n(length)}`, tone: 0, stroke: 1.3, opacity: .8 }, ...(kind === 'blossom' ? [{ d: [0, 1, 2, 3, 4].map(petal => disc(x + Math.cos(petal * 1.257) * r * .8, y + Math.sin(petal * 1.257) * r * .8, r * .62)).join(''), tone: 1 as const, fill: 1, stroke: 0 }, { d: disc(x, y, r * .4), tone: 2 as const, fill: 1, stroke: 0, light: true }]
          : [{ d: leafShape(x, length, r * 3.2, Math.PI * .5) + leafShape(x, length, r * 2.6, Math.PI * .3), tone, fill: 1, stroke: 0 }, { d: leafShape(x, length, r * 2.6, Math.PI * .72), tone: 0 as const, fill: 1, stroke: 0, light: true }])];
      return { x, y: 0, length: y + r, period: [6, 9, 12][index % 3]!, phase: unit(index, 15) * 9, swing: 7 + unit(index, 19) * 5, paths };
    });
  } else {
    // Bunting, streamers and lantern strings: catenaries between posts with hanging forms.
    const posts = Math.max(3, Math.round(width / (short * .36)));
    let string = '', flagsA = '', flagsB = '', ribbon = '';
    for (let post = 0; post < posts; post++) {
      const from = width * post / posts, to = width * (post + 1) / posts, sagAt = (x: number) => { const u = (x - from) / (to - from); return 6 + 4 * u * (1 - u) * Math.min(at(profile, x) * .55, short * .05); };
      for (let x = from; x <= to + .01; x += STEP) string += `${x === from ? 'M' : 'L'}${n(Math.min(x, to))} ${n(sagAt(Math.min(x, to)))}`;
      if (kind === 'bunting') for (let x = from + 26, index = post * 40; x < to - 20; index++, x += 46) {
        const room = at(profile, x) - sagAt(x); if (room < 26) continue;
        const drop = Math.min(room, 44 + unit(index, 3) * 14), flag = `M${n(x - 17)} ${n(sagAt(x - 17))}L${n(x + 17)} ${n(sagAt(x + 17))}L${n(x)} ${n(sagAt(x) + drop)}Z`;
        if (index % 2) flagsA += flag; else flagsB += flag;
      } else if (kind === 'streamer') for (let x = from + 30, index = post * 40; x < to - 20; index++, x += 52) {
        const room = at(profile, x) - sagAt(x); if (room < 30) continue;
        const drop = Math.min(room, 50 + unit(index, 3) * 40), y = sagAt(x);
        ribbon += `M${n(x)} ${n(y)}q${n(12)} ${n(drop * .25)} 0 ${n(drop * .5)}q${n(-12)} ${n(drop * .25)} 0 ${n(drop * .5)}`;
      }
    }
    rear.push({ d: string, tone: 2, stroke: kind === 'streamer' ? 4 : 2, opacity: .9 });
    near.push({ d: flagsA, tone: 0, fill: 1, stroke: 0 }, { d: flagsB, tone: 1, fill: 1, stroke: 0 }, { d: ribbon, tone: 1, stroke: 5.5, opacity: .95 }, { d: ribbon, tone: 1, stroke: 1.6, light: true, opacity: .9 });
    if (kind === 'lantern') pendantSlots(short * .12, short * .12, (x, index, depth) => {
      const length = Math.min(depth - 62, 14 + unit(index, 11) * 30), r = 20 + unit(index, 13) * 9, y = length + r * 1.1, tone = (index % 2) as 0 | 1;
      const petal = (shift: number, w: number) => `M${n(x + shift)} ${n(y + r)}C${n(x + shift - w)} ${n(y + r * .2)} ${n(x + shift - w * .5)} ${n(y - r * .6)} ${n(x + shift)} ${n(y - r)}C${n(x + shift + w * .5)} ${n(y - r * .6)} ${n(x + shift + w)} ${n(y + r * .2)} ${n(x + shift)} ${n(y + r)}Z`;
      return { x, y: 0, length: y + r, period: [6, 9, 12][index % 3]!, phase: unit(index, 15) * 9, swing: 6 + unit(index, 19) * 4,
        paths: [{ d: `M${n(x)} 0L${n(x)} ${n(length)}`, tone: 2, stroke: 1.4, opacity: .8 }, { d: petal(-r * .55, r * .6) + petal(r * .55, r * .6), tone, fill: .8, stroke: 0 }, { d: petal(0, r * .7), tone, fill: 1, stroke: 0, light: true }, { d: `M${n(x)} ${n(y + r)}v${n(r * .5)}`, tone: 2, stroke: 2 }] };
    });
  }
  return { sway: 0, segments: [{ pivot: [width / 2, 0], phase: 0, paths: rear.filter(path => path.d) }], front: [{ pivot: [width / 2, 0], phase: 0, paths: near.filter(path => path.d) }], pendants, lit: litColumns(profile) };
}

export interface ParticleLayer { duration: number; offset: number; wander: boolean; opacity: number; sway: number; travel: readonly [number, number]; paths: DressPath[]; count: number }
function particleShape(kind: ParticleKind, x: number, y: number, size: number, angle: number) {
  const c = Math.cos(angle), s = Math.sin(angle), point = (px: number, py: number) => `${n(x + (px * c - py * s) * size)} ${n(y + (px * s + py * c) * size)}`;
  if (kind === 'flake') return [0, 1, 2].map(arm => { const a = angle + arm * Math.PI / 3, dx = Math.cos(a) * size * .5, dy = Math.sin(a) * size * .5; return `M${n(x - dx)} ${n(y - dy)}L${n(x + dx)} ${n(y + dy)}`; }).join('');
  if (kind === 'firefly') return disc(x, y, size * .2);
  if (kind === 'leaf') return leafShape(x - c * size * .5, y - s * size * .5, size, angle);
  if (kind === 'petal') return `M${point(-.5, 0)}Q${point(-.1, -.48)} ${point(.5, -.08)}Q${point(.1, .5)} ${point(-.5, 0)}Z`;
  if (kind === 'confetti') return `M${point(-.5, -.2)}L${point(.5, -.2)}L${point(.5, .2)}L${point(-.5, .2)}Z`;
  return `M${point(0, -.5)}L${point(.12, -.12)}L${point(.5, 0)}L${point(.12, .12)}L${point(0, .5)}L${point(-.12, .12)}L${point(-.5, 0)}L${point(-.12, -.12)}Z`;
}
export const PARTICLE_LAYERS = 4;
/** Depth-scaled particles that are always in flight, drawn as four depth layers
 * so the whole field costs four transform animations, not one per particle.
 * A falling layer is a tile drawn twice one tile apart and slid by exactly one
 * tile per period, so it never empties or jumps; every period divides the scene life. */
export function particleLayers(kind: ParticleKind, count: number, width: number, height: number, gust = false): ParticleLayer[] {
  const life = LIVING_SCENE_BUDGET.life, wander = kind === 'firefly' || kind === 'sparkle', stroke = kind === 'flake';
  return Array.from({ length: PARTICLE_LAYERS }, (_, layer) => {
    const depth = layer / (PARTICLE_LAYERS - 1), share = Math.max(2, Math.round(count * [.34, .28, .22, .16][layer]!));
    // A gust blows the same falling tile steeply sideways; a full-width horizontal tile would double the layer's raster.
    const tile: readonly [number, number] = gust ? [width * .32, height] : [0, height];
    const tones = ['', '', ''];
    for (let index = 0; index < share; index++) {
      const key = layer * 97 + index, size = (8 + 22 * depth) * (.75 + unit(key, 41) * .5);
      const x = unit(key, 31) * width, y = (wander ? .1 + unit(key, 33) * .78 : unit(key, 33)) * height, angle = unit(key, 43) * Math.PI * 2;
      for (const copy of wander ? [0] : [0, 1]) tones[key % 3] += particleShape(kind, x - copy * tile[0], y - copy * tile[1], size, angle);
    }
    return { duration: life / (gust ? [2, 3, 4, 6][layer]! : wander ? [1, 2, 3, 4][layer]! : [1, 2, 3, 4][layer]!), offset: unit(layer, 35) * 9000, wander, opacity: .5 + .5 * depth, count: share,
      sway: wander ? 26 + depth * 40 : kind === 'flake' ? 10 + depth * 14 : 26 + depth * 44, travel: tile,
      paths: tones.map((d, tone) => ({ d, tone: tone as 0 | 1 | 2, light: kind === 'flake' || kind === 'firefly' || tone === 0 && kind !== 'leaf', ...(stroke ? { stroke: 1.4 + depth * 1.2 } : { fill: 1, stroke: 0 }) })).filter(path => path.d) };
  });
}

/** Soft irregular fog: overlapping ellipses filled with a radial gradient, so no
 * blob has an edge or an end. Three sit in the lower third and two form a top haze. */
export function fogBands(width: number, height: number) {
  return [[.3, .87, .44, .095], [.78, .79, .38, .085], [.52, .67, .42, .075], [.34, .035, .5, .075], [.82, .05, .42, .065]].map(([cx, cy, rx, ry], index) =>
    ({ cx: width * cx!, cy: height * cy!, rx: width * rx!, ry: height * ry!, travel: width * (.045 + index * .01) * (index % 2 ? -1 : 1), tone: (index % 3) as 0 | 1 | 2 }));
}
/** Long curved gust streaks; the renderer slides and fades them. Each streak takes an
 * open lane that its whole slide clears, shortening before it gives up, so a
 * line is never cut by a reading area. */
export function gustStreaks(width: number, height: number, holes: readonly ThemeRect[] = []) {
  const taken: ThemeRect[] = [], streaks: { d: string; tone: 0 | 1 | 2; travel: number; delay: number }[] = [];
  const blocked = (rect: ThemeRect) => [...holes, ...taken].some(hole => hole.left < rect.right && hole.right > rect.left && hole.top < rect.bottom && hole.bottom > rect.top);
  for (let index = 0; index < 4; index++) search: for (const reach of [.34, .24, .16]) for (let attempt = 0; attempt < 14; attempt++) {
    const x = width * (.02 + unit(index * 17 + attempt, 51) * (.9 - reach * 1.6)), y = height * (.08 + unit(index * 17 + attempt, 53) * .8), w = width * reach, h = height * .045, travel = w * .6;
    const swept = { left: x - 6, right: x + w + travel + 6, top: y - h * 1.8, bottom: y + h * 1.6 };
    if (swept.right > width || blocked(swept)) continue;
    taken.push(swept);
    streaks.push({ d: `M${n(x)} ${n(y)}c${n(w * .3)} ${n(-h * 1.6)} ${n(w * .6)} ${n(h)} ${n(w)} ${n(-h * .4)}M${n(x + w * .2)} ${n(y + h * .7)}q${n(w * .3)} ${n(-h)} ${n(w * .6)} ${n(-h * .1)}`, tone: (index % 3) as 0 | 1 | 2, travel, delay: index * 1.5 });
    break search;
  }
  return streaks;
}

/** Upper bound of simultaneously running animations for one scene and board:
 * every sway group, patch fade and appear, one cross-fading generation, band
 * shifts, grass segments, pendants, particle layers and weather. Checked against
 * LIVING_SCENE_BUDGET.animations on empty boards, where the most pendants fit. */
export function sceneAnimationCount(art: LivingSceneArt, dressing: SceneDressing, width: number, height: number, holes: readonly ThemeRect[] = []) {
  const patches = art.patches.filter(patch => !(patch.depth === 'far' && patch.edge.startsWith('bottom')));
  const drawn = patches.reduce((sum, patch) => sum + patch.groups.length + 2, 0) + Math.max(0, ...patches.map(patch => patch.groups.length + 1));
  const unit1080 = Math.min(width, height) / 1080, top = dressing.top ? topBand(dressing.top, width / unit1080, height / unit1080, holes) : null;
  const ground = groundBand(dressing.ground === 'mist' ? 'water' : dressing.ground, width / unit1080, height / unit1080, holes);
  return drawn + 2 + (ground.sway ? ground.segments.length : 0) + (top ? 2 + top.pendants.length : 0) + (dressing.particles ? PARTICLE_LAYERS : 0);
}
