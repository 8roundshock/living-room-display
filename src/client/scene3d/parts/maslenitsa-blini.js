// Blini for Maslenitsa (#624): a stack of thin, wide pancakes with wavy, slightly drooping edges
// and a fried lace on top, butter melting on it, honey running down the near side, and one blin
// folded in quarters. Thin and lacy on purpose: thick small pancakes with syrup would be another
// country's breakfast.
import { merged, tubes } from './new-year-tree-tubes.js';

/** The fried lace of a blin: a brown net left between pale bubbles, darker and crisper toward the rim. Also its bump. */
function lace(kit, salt) {
  const { rnd } = kit;
  return kit.canvasTexture(512, 512, g => {
    g.fillStyle = '#9c5618'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 520; i++) {
      const a = rnd(i, salt + 1) * 6.283, r = Math.sqrt(rnd(i, salt + 2)) * 236, size = 5 + Math.pow(rnd(i, salt + 3), 2) * 30;
      g.fillStyle = `rgba(${226 + Math.round(rnd(i, salt + 4) * 16)},${160 + Math.round(rnd(i, salt + 5) * 26)},${66 + Math.round(rnd(i, salt + 6) * 26)},.9)`;
      g.beginPath(); g.ellipse(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, size, size * (.6 + rnd(i, salt + 7) * .4), rnd(i, salt + 8) * 3, 0, 7); g.fill();
    }
    for (let i = 0; i < 240; i++) { const a = rnd(i, salt + 9) * 6.283, r = Math.sqrt(rnd(i, salt + 10)) * 240; g.fillStyle = `rgba(110,56,16,${.3 + rnd(i, salt + 11) * .4})`; g.beginPath(); g.arc(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 1 + rnd(i, salt + 12) * 2.6, 0, 7); g.fill(); }
    const rim = g.createRadialGradient(256, 256, 190, 256, 256, 256); rim.addColorStop(0, 'rgba(150,84,26,0)'); rim.addColorStop(.75, 'rgba(150,84,26,.5)'); rim.addColorStop(1, 'rgba(120,62,18,.9)'); g.fillStyle = rim; g.fillRect(0, 0, 512, 512);
  }, { anisotropy: 8 });
}

/** One blin as a thin disc lying on y = 0 (its top surface): a wavy rim that droops a little, darker at the edge. */
function blin(kit, { radius, thickness, salt, tone = 1 }) {
  const { T, C, rnd } = kit, around = 56, rings = [0, .36, .66, .86, .95, 1, 1, .93], position = [], colour = [], uv = [], index = [];
  const pale = C(0xfff0d0).multiplyScalar(tone), crust = C(0xa9682a).multiplyScalar(tone), edge = C(0xdca458).multiplyScalar(tone);
  const phases = [rnd(1, salt) * 6, rnd(2, salt) * 6, rnd(3, salt) * 6, rnd(4, salt) * 6];
  rings.forEach((ring, i) => {
    for (let j = 0; j <= around; j++) {
      const a = j / around * Math.PI * 2, wave = 1 + (.04 * Math.sin(a * 3 + phases[0]) + .028 * Math.sin(a * 5 + phases[1]) + .016 * Math.sin(a * 9 + phases[2])) * ring * ring;
      const droop = Math.max(0, ring - .8) / .2 * (.012 + .03 * (.5 + .5 * Math.sin(a * 2 + phases[3]))) * radius, r = radius * ring * wave, under = i >= 6;
      position.push(Math.cos(a) * r, -droop - (under ? thickness : 0), Math.sin(a) * r); uv.push(.5 + Math.cos(a) * ring * .49, .5 + Math.sin(a) * ring * .49);
      const k = i < 3 ? 0 : i === 3 ? .25 : i === 4 ? .7 : 1, shade = i >= 5 ? edge.clone().lerp(crust, .35 + .5 * rnd(j >> 2, salt + 20)) : pale.clone().lerp(crust, k * (.5 + .5 * rnd(j >> 2, salt + 21)));
      colour.push(shade.r, shade.g, shade.b);
    }
    if (i) for (let j = 0; j < around; j++) { const a0 = (i - 1) * (around + 1) + j, b0 = a0 + around + 1; index.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0); }
  });
  const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3)); geometry.setAttribute('color', new T.Float32BufferAttribute(colour, 3)); geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geometry.setIndex(index);
  return geometry;
}

/** A soft-edged puddle lying on y = 0: melted butter, honey. */
function puddle(kit, radius, salt, height = .012) {
  const { T, rnd } = kit, geometry = new T.CircleGeometry(1, 40, 0, Math.PI * 2), p = geometry.attributes.position, phase = rnd(1, salt) * 6;
  geometry.rotateX(-Math.PI / 2);
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z), a = Math.atan2(z, x), wave = 1 + .2 * Math.sin(a * 2 + phase) + .12 * Math.sin(a * 3 + phase * 2) + .07 * Math.sin(a * 5 + phase * 3); p.setXYZ(i, x * radius * wave, r < .5 ? height : 0, z * radius * wave); }
  geometry.computeVertexNormals(); return geometry;
}

/**
 * The stack, standing on y = 0. Returns { group, top }: `top` is the height of the top blin, for steam.
 * `drips` is how many runs of honey come down the near side (+z).
 */
export function bliniStack(kit, { count = 20, radius = 1.2, thickness = .034, drips = 2, seed = 0 } = {}) {
  const { T, V, C, rnd } = kit, group = new T.Group(), tones = [], uvs = [], top = count * thickness;
  // All blini are one mesh: each is turned, nudged and a little differently browned.
  const position = [], index = [];
  for (let i = 0; i < count; i++) {
    const last = i === count - 1, geometry = blin(kit, { radius: radius * (last ? 1 : .96 + rnd(i, seed + 1) * .08), thickness, salt: seed + i * 7, tone: last ? 1 : .86 + rnd(i, seed + 2) * .16 });
    geometry.rotateY(rnd(i, seed + 3) * 6.283); geometry.translate((rnd(i, seed + 4) - .5) * .09 + i * .0025, (i + 1) * thickness, (rnd(i, seed + 5) - .5) * .09);
    const base = position.length / 3, p = geometry.attributes.position, c = geometry.attributes.color, t = geometry.attributes.uv, order = geometry.index;
    for (let v = 0; v < p.count; v++) { position.push(p.getX(v), p.getY(v), p.getZ(v)); tones.push(c.getX(v), c.getY(v), c.getZ(v)); uvs.push(t.getX(v), t.getY(v)); }
    for (let v = 0; v < order.count; v++) index.push(base + order.getX(v));
    geometry.dispose();
  }
  const all = new T.BufferGeometry(); all.setAttribute('position', new T.Float32BufferAttribute(position, 3)); all.setAttribute('color', new T.Float32BufferAttribute(tones, 3)); all.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); all.setIndex(index); all.computeVertexNormals();
  const fried = lace(kit, seed), crumb = kit.mat({ map: fried, bumpMap: fried, bumpScale: .012, vertexColors: true, roughness: .55, clearcoat: .35, clearcoatRoughness: .45, emissive: 0xd08a2a, emissiveIntensity: .1 }, .45);
  group.add(new T.Mesh(all, crumb));

  // ---------- butter: a soft block slumping into its own melted pool ----------
  const block = new T.SphereGeometry(1, 24, 16), p = block.attributes.position, soft = value => Math.sign(value) * Math.pow(Math.abs(value), .42);
  for (let i = 0; i < p.count; i++) { const y = soft(p.getY(i)), slump = 1 + .16 * (1 - y) * .5; p.setXYZ(i, soft(p.getX(i)) * .17 * slump, y * .065 + .06, soft(p.getZ(i)) * .12 * slump); }
  block.computeVertexNormals();
  const butter = kit.mat({ color: 0xfbe9a4, roughness: .22, clearcoat: 1, clearcoatRoughness: .12, emissive: 0xf2d060, emissiveIntensity: .2 }, .9), melted = kit.mat({ color: 0xf2c84a, roughness: .08, clearcoat: 1, clearcoatRoughness: .05, transparent: true, opacity: kit.solidity(.6), emissive: 0xe8b030, emissiveIntensity: .15 }, 1);
  const pat = new T.Mesh(block, butter), pool = new T.Mesh(puddle(kit, .34, seed + 31), melted);
  pat.position.set(-.12, top, .1); pat.rotation.y = .5; pool.position.set(-.08, top + .004, .14); group.add(pool, pat);

  // ---------- honey: a pool beside the butter that runs over the near edge in drips of different lengths ----------
  const amber = kit.mat({ color: 0xc86400, roughness: .1, clearcoat: 1, clearcoatRoughness: .06, transparent: true, opacity: kit.solidity(.92), emissive: 0xb85000, emissiveIntensity: .4 }, .8);
  const honey = new T.Mesh(puddle(kit, .42, seed + 37, .014), amber); honey.position.set(.36, top + .006, .5); group.add(honey);
  const runs = tubes(kit, 8), white = C(0xffffff);
  [[1.3, .58, .05], [1.72, .32, .04], [1.05, .2, .034]].slice(0, drips).forEach(([angle, fall, width], i) => {
    const out = V(Math.cos(angle), 0, Math.sin(angle)), edge = radius * 1.02, points = [V(.36, top + .012, .5).lerp(out.clone().multiplyScalar(edge * .7).setY(top + .012), .5), out.clone().multiplyScalar(edge * .8).setY(top + .014), out.clone().multiplyScalar(edge * .98).setY(top + .008)];
    for (let j = 1; j <= 6; j++) points.push(out.clone().multiplyScalar(edge + .012 + Math.sin(j * 1.7 + i) * .012).setY(top - fall * j / 6).add(V(Math.sin(j * 1.3 + i * 2) * .015, 0, 0)));
    runs.add(points, width * .8, width, white, white, (k, r) => r * (k > .82 ? 1 + 1.1 * Math.sin((k - .82) / .18 * Math.PI * .75) : 1) * (k > .97 ? .6 : 1));
  });
  group.add(runs.mesh(amber));
  return { group, top };
}

/** One blin folded in quarters: a doubled quarter-circle, its corner at the origin and its curved edge toward +y. */
export function foldedBlin(kit, { radius = 1.1, seed = 0 } = {}) {
  const { T, C, rnd } = kit, layers = [], fried = lace(kit, seed + 5);
  for (let layer = 0; layer < 2; layer++) {
    const sector = new T.CircleGeometry(radius * (1 - layer * .04), 16, Math.PI / 4 + layer * .03, Math.PI / 2 - layer * .04), p = sector.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), r = Math.hypot(x, y) / radius; p.setXYZ(i, x * (1 + .03 * Math.sin(Math.atan2(y, x) * 9 + seed) * r), y * (1 + .03 * Math.sin(Math.atan2(y, x) * 7 + seed) * r), layer * -.05 + .1 * r * r * (layer ? 1 : .8) + .02 * Math.sin(x * 6 + layer)); }
    layers.push(sector);
  }
  const geometry = merged(kit, layers);
  const mesh = new T.Mesh(geometry, kit.mat({ map: fried, bumpMap: fried, bumpScale: .012, color: C(0xfff0d8).multiplyScalar(.92 + rnd(1, seed) * .06), roughness: .5, clearcoat: .4, clearcoatRoughness: .4, side: T.DoubleSide, emissive: 0xe0a84a, emissiveIntensity: .12 }, .6));
  return mesh;
}
