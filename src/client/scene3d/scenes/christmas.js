// Christmas (#600 reference scene; design plan #609). Fir and ornaments: a wreath with a red bow
// hung on a ribbon from a short fir swag in the top-left corner, a longer swag in the top-right
// corner carrying a few glass ornaments that all differ, the edge of a lit tree in the
// bottom-right corner (coordinator decision on #609: the owner asked for the side of a tree),
// one snow-dusted bough reaching in low from the left, soft warm lights far behind and a little
// snow. The tree is only an edge, with warm lights and a few ornaments: the whole decorated tree
// with its top belongs to the Russian New Year scene (#622), the star to Orthodox Christmas.
// The middle of the screen and the middle of the top and bottom edges stay empty.
// Art rules: ../README.md.
/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed;
  const N = kit.needles(), pick = (list, i) => list[((i % list.length) + list.length) % list.length];
  const WARM = [0xffd9a0, 0xffd9a0, 0xffb070, 0xffd9a0, 0xffc860];

  // A mixed box: no two neighbours share colour, shape and finish.
  const COLOURS = [0xb3121d, 0xd4a017, 0xe8dcc0, 0x0f6b3c, 0x7a1024, 0xc9ccd6];
  const SHAPES = ['ball', 'drop', 'onion', 'ball', 'finial', 'facet'];
  const FINISHES = ['mirror', 'satin', 'pearl', 'banded', 'glitter'];
  let made = 0;
  function ornament(radius, thread) {
    const i = made++, shape = pick(SHAPES, i), slim = shape === 'finial';
    const group = kit.ornament({ color: pick(COLOURS, i), shape, finish: shape === 'facet' ? 'mirror' : pick(FINISHES, i * 3), radius: radius * (slim ? 1.2 : shape === 'ball' ? 1 : .88), thread });
    const phase = rnd(i, seed + 11) * 6, reach = .012 + thread * .012;
    tick(t => { group.rotation.z = Math.sin(t * .5 + phase) * reach * 2; group.rotation.x = Math.sin(t * .37 + phase) * reach; group.userData.body.rotation.y = t * .1 + phase; });
    return group;
  }

  // ---------- fir swags in the two top corners, thinning toward the middle ----------
  const swag = (corner, reach) => reach.forEach(([offset, length], i) => {
    kit.bough(N, V(corner * (W + offset), 4.62 + i * .03 + rnd(i, seed + 2) * .1, (rnd(i, seed + 3) - .5) * .5), V(-corner, -.07 + i * .01, .12 * (rnd(i, seed + 4) - .5)).normalize(), length, .34 - i * .03, V(0, -.8, .6), .22, 0, 300 + i * 31 + corner * 50, null, .9);
    if (i < reach.length - 1) kit.bough(N, V(corner * (W + offset - 1.5), 4.7, (rnd(i, seed + 5) - .5) * .4), V(corner, -.05, .1 * (rnd(i, seed + 6) - .5)).normalize(), length * .7, .26, V(0, -.8, .6), .21, 0, 700 + i * 17 + corner * 50, null, .8);
  });
  swag(1, [[.9, 2.6], [-.9, 2.5], [-2.7, 2.3], [-4.3, 2.0], [-5.6, 1.5]]);
  swag(-1, [[.9, 2.6], [-.9, 2.3], [-2.5, 1.7]]);
  [[W - .6, .0], [W - 1.5, .22], [W - 2.9, .1], [W - 3.6, .3], [W - 5.0, .16], [-W + .9, .12], [-W + 3.1, .26]].forEach(([x, drop], i) => { const bulb = kit.bulb(pick(WARM, i), .04); bulb.position.set(x, 4.22 - drop, .25); stage.add(bulb); });
  // Ornaments on threads: each on its own stretch of the right swag, the longest nearest the corner.
  const hung = Math.max(2, Math.round(3 + A * 8)), DEPTHS = [-.5, .3, -.8, .1, -.3, .4];
  for (let i = 0; i < hung; i++) {
    const u = (i + .5) / hung, o = ornament((.25 + rnd(i, seed + 8) * .15) * S, .55 + (1 - u) * 1.5 + rnd(i, seed + 9) * .3);
    o.position.set(W - 1.5 - u * 5.1 + (rnd(i, seed + 7) - .5) * .2, 4.45, DEPTHS[i % DEPTHS.length]); stage.add(o);
  }

  // ---------- the wreath, hung on its ribbon from the left swag ----------
  {
    const WN = kit.needles(), R = 1.25 * S, hang = new T.Group(), cy = -2.75; hang.position.set(-W + 2.15, 4.6, 0); stage.add(hang);
    for (let i = 0; i < 110; i++) {
      const a = i / 110 * 6.283 + rnd(i, 1) * .1, rr = R * (.9 + rnd(i, 2) * .2), base = V(Math.cos(a) * rr, cy + Math.sin(a) * rr, (rnd(i, 3) - .5) * .3), tangent = V(-Math.sin(a), Math.cos(a), 0), radial = V(Math.cos(a), Math.sin(a), 0);
      const d = tangent.multiplyScalar(.78).addScaledVector(radial, (rnd(i, 4) - .35) * .7).add(V(0, 0, (rnd(i, 5) - .4) * .55)).normalize(); kit.twig(WN, base, base.clone().addScaledVector(d, (.46 + rnd(i, 6) * .34) * S), .2, rnd(i, 7) < .1 ? .5 : 0, i * 17);
    }
    hang.add(WN.mesh(), new T.Mesh(kit.ribbonGeo([V(0, 0, .02), V(.02, (cy + R) * .5, .05), V(0, cy + R + .1, .08)], .15 * S, V(1, 0, 0)), kit.satin(0x8f1420)));
    // Berries in uneven clusters of two to four, not a ring of triplets.
    const berry = kit.mat({ color: 0xc2101c, roughness: .18, clearcoat: 1, clearcoatRoughness: .1 }, 1.1), clusters = Math.max(3, Math.round(3 + A * 8));
    for (let i = 0; i < clusters; i++) {
      const a = i / clusters * 6.283 + .4 + (rnd(i, 21) - .5) * .7, count = 2 + Math.floor(rnd(i, 22) * 3);
      for (let k = 0; k < count; k++) { const m = new T.Mesh(kit.ballGeo, berry); m.scale.setScalar((.06 + rnd(i * 4 + k, 23) * .03) * S); m.position.set(Math.cos(a) * R + Math.cos(k * 2.1 + i) * .09, cy + Math.sin(a) * R + Math.sin(k * 2.1 + i) * .09, .26 + k * .03); hang.add(m); }
    }
    for (let i = 0; i < Math.round(4 + A * 12); i++) { const a = i * 2.4 + .7, bulb = kit.bulb(0xffd9a0, .036); bulb.position.set(Math.cos(a) * R * (.92 + rnd(i, 7) * .16), cy + Math.sin(a) * R * (.92 + rnd(i, 8) * .16), .32); hang.add(bulb); }
    const bow = kit.puffyBow(0xb3121d, 1.3 * S); bow.position.set(0, cy - R, .42); hang.add(bow);
    tick(t => { hang.rotation.z = Math.sin(t * .35) * .018; });
  }

  // ---------- one snow-dusted bough reaching in low from the left ----------
  {
    const dir = V(1, -.22, .1).normalize(), pt = kit.bough(N, V(-W - .5, -2.2, 0), dir, 3.7 * S, .9, V(dir.y, -dir.x, .22).normalize(), .23, .42, 900, null, .9);
    [.45, .8].forEach((u, k) => { const bulb = kit.bulb(pick(WARM, k * 2), .036); bulb.position.copy(pt(u)).add(V(0, -.06, .1)); stage.add(bulb); });
  }

  // ---------- the edge of a lit tree in the bottom-right corner, to a little over half the height ----------
  {
    const ax = W + .25, foot = -view.halfH - .15, apex = view.halfH * (2 * .68 - 1), tiers = 7;
    const trunk = new T.Mesh(new T.CylinderGeometry(.05, .2, apex - foot, 10), kit.mat({ color: 0x3a2a1c, roughness: .9 }, .2, false)); trunk.position.set(ax, (apex + foot) / 2, 0); stage.add(trunk);
    // Four small ornaments on boughs that face the room, each different, and a handful of warm lights.
    const HUNG = new Map([[1, .72], [5, .6], [7, .76], [10, .64]].slice(0, A > .12 ? 4 : 2));
    for (let k = 0; k < tiers; k++) {
      const h = k / tiers, y = foot + .2 + h * (apex - foot - .3), R = 2.35 * S * Math.pow(1 - h, .7) + .4;
      // Two boughs a tier, turned a little from tier to tier: the rest of the tree is off the screen.
      for (let j = 0; j < 2; j++) {
        const b = k * 2 + j, a = (-30 + j * 38 + (k % 2) * 16 + rnd(b, seed + 41) * 6) * Math.PI / 180, dir = V(-Math.cos(a), -.1, Math.sin(a)).normalize();
        const pt = kit.bough(N, V(ax, y + rnd(b, seed + 42) * .25, 0), dir, R, R * .3, V(Math.sin(a), 0, Math.cos(a)), .2, 0, 1200 + k * 97 + j * 13, null, .3);
        if ((k + j) % 2 === 0 && rnd(b, seed + 43) < .5 + A * 2) { const bulb = kit.bulb(pick(WARM, b), .042); bulb.position.copy(pt(.5 + rnd(b, seed + 44) * .45)).add(V(0, -.07, .06)); stage.add(bulb); }
        if (HUNG.has(b)) { const o = ornament((.16 + rnd(b, seed + 45) * .07) * S, .1 + rnd(b, seed + 46) * .12); o.position.copy(pt(HUNG.get(b))).add(V(0, 0, .12)); stage.add(o); }
      }
    }
  }
  stage.add(N.mesh());

  // ---------- depth and air: a few soft lights far behind, a little snow ----------
  for (let i = 0; i < Math.round(3 + A * 12); i++) {
    const side = i % 3 ? 1 : -1, x0 = side * (W * (1.05 + rnd(i, seed + 31) * .55)), y0 = (rnd(i, seed + 32) - .35) * 8, disc = kit.bokeh(pick(WARM, i), (1 + rnd(i, seed + 33)) * 1.1 * S, .1 + rnd(i, seed + 34) * .1);
    disc.position.set(x0, y0, -12 + rnd(i, seed + 35) * 7); stage.add(disc); const phase = rnd(i, seed + 36) * 6; tick(t => { disc.position.x = x0 + Math.sin(t * .12 + phase) * .25; disc.position.y = y0 + Math.cos(t * .1 + phase) * .18; });
  }
  if (ctx.weather !== 'snow') stage.add(kit.snow(14 + A * 70)); // real snow has its own overlay
}
