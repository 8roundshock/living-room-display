// Spring (design plan #613). One magnolia bough reaches in from the top-left corner: a main
// limb along the top edge, a side limb down the left edge and a short one between them, each
// twig ending in a bloom or a velvet bud. Six blooms at the owner's amount, no two at the same
// opening, size and angle. A spray of young leaves enters low on the right, set back and
// dimmer, and now and then a single petal falls down the left edge. Nothing on the bottom edge,
// nothing in the middle, no lights or ribbons on the bough. One fixed picture for the whole
// season (coordinator decision on #613). Art rules: ../README.md.
import { bark, limb, taper } from '../parts/spring-limb.js';
import { magnolia } from '../parts/spring-magnolia.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed, today = ctx.seed + ctx.day;
  const M = magnolia(kit), wood = bark(kit, 0x54463e), rain = ctx.weather === 'rain', dim = rain || ctx.weather === 'fog' ? .5 : 1;
  const at = (x, y, z = 0) => V(-W + x, y, z);   // measured from the left edge, so the bough keeps its corner on any screen shape

  // ---------- the bough: it rocks as one piece about the point where it leaves the frame ----------
  const root = at(-1.2, 5.6, -.6), bough = new T.Group(), body = new T.Group(); bough.position.copy(root); body.position.copy(root).negate(); bough.add(body); stage.add(bough);
  const grow = (points, from, to, sides = 7) => { const mesh = limb(kit, points, taper(from * S, to * S, .85), wood, { sides }); body.add(mesh); return mesh; };
  // Magnolia wood is angular: every limb changes direction a little at each node and turns up at its tip.
  const main = grow([root, at(-.3, 4.82, -.4), at(.5, 4.36, -.2), at(1.15, 4.14, -.05), at(1.9, 4.04, .15), at(2.45, 3.8, .25), at(3.05, 3.8, .22), at(3.5, 3.58, .2), at(4.1, 3.56, .12), at(4.6, 3.34, .05), at(4.92, 3.4, .02), at(5.08, 3.58, .04)], .12, .03);
  const down = grow([main.userData.at(.17), at(.3, 3.7, -.05), at(.5, 2.8, .16), at(.95, 1.8, .3), at(1.3, 1.02, .38), at(1.6, .62, .43), at(1.84, .7, .46)], .07, .022);
  const short = grow([main.userData.at(.5), at(2.84, 3.4, .36), at(3.2, 3.16, .48), at(3.42, 2.86, .54), at(3.66, 2.84, .56), at(3.78, 2.98, .56)], .046, .02);
  const LIMBS = { main, down, short };

  // Each tip: the limb it leaves and where, the points of its twig, the way its end faces, and
  // what it carries. The first `blooms` tips flower; the rest end in a bud. Most blooms are seen
  // from the side, as goblets; the largest is turned so its pale inside shows behind its pink outside.
  const TIPS = [
    ['main', .4, [[1.58, 3.66, .5], [1.4, 3.2, .82], [1.5, 2.86, .98], [1.7, 2.74, 1.04], [1.8, 2.84, 1.06]], [.3, .82, .5], 'open', .74, 9],
    ['main', 1, [[5.14, 3.7, .05]], [.34, .9, .28], 'goblet', .62, 8],
    ['down', 1, [[1.9, .82, .48]], [.4, .8, .45], 'goblet', .56, 9],
    ['short', 1, [[3.82, 3.1, .56]], [.36, .9, .26], 'break', .52, 6],
    ['down', .64, [[1.42, 1.66, .14], [1.8, 1.6, .12], [1.98, 1.74, .12]], [.3, .9, .3], 'spent', .56, 9],
    ['main', .64, [[3.36, 3.8, .18], [3.42, 3.9, .22]], [.5, .7, .5], 'goblet', .5, 7],
    ['main', .3, [[1.3, 4.3, -.14], [1.4, 4.44, -.16]], [.3, .95, -.1], 'break', .42, 6],
    ['down', .4, [[.3, 2.66, .02], [.2, 2.56, 0]], [-.75, .5, .2], 'goblet', .42, 6],
    ['short', .5, [[3.0, 2.96, .5], [3.04, 2.84, .52]], [.25, -.9, .3], 'break', .38, 6],
    ['main', .8, [[4.26, 3.3, .2], [4.36, 3.2, .22]], [.7, -.6, .3]],
    ['main', .55, [[2.84, 4.02, .1]], [.1, 1, .1]],
    ['down', .2, [[-.08, 3.82, -.2]], [-.8, -.5, 0]],
    ['down', .84, [[1.16, .74, .3]], [-.6, -.75, .1]],
    ['short', .8, [[3.5, 3.06, .62]], [-.1, .9, .4]],
    ['main', .1, [[-.5, 4.5, -.5]], [.5, -.85, 0]],
  ];
  const blooms = Math.min(9, Math.round(5 + 4 * A)), buds = Math.min(TIPS.length - blooms, Math.max(6, Math.min(9, Math.round(5 + 8 * A)))), released = [];
  TIPS.slice(0, blooms + buds).forEach(([from, share, points, face, opening, size, tepals], i) => {
    const parent = LIMBS[from], start = parent.userData.at(share), twig = share === 1 ? null : grow([start, ...points.map(p => at(...p))], Math.max(.016, parent.userData.radius(share) / S * .6), .013, 5);
    const end = twig ? twig.userData.at(1) : at(...points[points.length - 1]), axis = V(...face).normalize();
    if (!twig) grow([start, end], parent.userData.radius(1) / S, .014, 5);
    if (i < blooms) {
      const flower = M.bloom({ size: size * S, stage: opening, tepals, blush: .85 + rnd(i, seed + 3) * .25, seed: seed + i * 13, axis, turn: rnd(i, seed + 4) * 6 }); flower.position.copy(end); body.add(flower);
      const pace = 1.12 + rnd(i, seed + 5) * .56, phase = rnd(i, seed + 6) * 6;
      tick(t => { flower.rotation.z = Math.sin(t * pace + phase) * .0175; flower.rotation.x = Math.sin(t * pace * .8 + phase) * .01; });
      if (end.x < -W + 2.4) released.push(end.clone().addScaledVector(axis, size * S * .5));
    } else { const closed = M.bud({ length: (.16 + rnd(i, seed + 7) * .11) * S, seed: seed + i, axis }); closed.position.copy(end); body.add(closed); }
  });
  tick(t => { bough.rotation.z = Math.sin(t * 1.047) * .0052; });

  if (ctx.quiet) return;   // a quiet date keeps the bough alone: no spray, no petal, no backlight

  // ---------- light through a canopy behind the bough, never a sun ----------
  const haze = kit.glow(0xffd3e2, 7, .06 * dim, { twinkle: .24 }); haze.position.copy(at(2.3, 2.7, -2.5)); stage.add(haze);
  [[.9, 3.6, -6.5, 1.3, .05], [1.9, 1.3, -8, .9, .04], [3.3, 4.4, -9.5, 1.1, .03], [.3, 5.2, -7.5, .6, .06]].forEach(([x, y, z, size, strength]) => {
    const disc = kit.bokeh(0xffd3e2, size * S * (1 - z / view.depth), strength * dim, .2); disc.position.set((-W + x) * (1 - z / view.depth), y * (1 - z / view.depth) * .8, z); stage.add(disc);
  });

  // ---------- a spray of young leaves, low on the right and set back ----------
  {
    const z = -2, edge = view.halfWAt(z), spray = new T.Group(), inner = new T.Group(), hold = V(edge + .5, -1.25, z); spray.position.copy(hold); inner.position.copy(hold).negate(); spray.add(inner); stage.add(spray);
    const stem = limb(kit, [hold, V(edge - .5, -1.6, z), V(edge - 1.5, -2.3, z + .1), V(edge - 2.3, -3.1, z + .15), V(edge - 2.75, -3.62, z + .1)], taper(.03 * S, .008 * S), wood, { sides: 5 }); inner.add(stem);
    // New leaves come in a tuft at the tip and in ones and twos behind it, the youngest still folded:
    // [share along the twig, side (0 ends the twig), length, how far it is still folded].
    const LEAVES = [[1, 0, .5, .5], [.36, -1, .62, .12], [.97, 1, .4, .7], [.64, 1, .54, .28], [.95, -1, .3, .85], [.8, -1, .46, .4], [.64, -1, .36, .55], [.5, 1, .44, .22], [.88, 1, .32, .6]];
    LEAVES.slice(0, Math.max(5, Math.min(9, Math.round(6 + 8 * A)))).forEach(([share, side, length, fold], i) => {
      const along = stem.userData.dir(share), young = M.leaf({ length: length * S, fold, seed: seed + i * 7 });
      // A leaf leaves its node forward and to one side, and hangs a little under its own weight.
      const way = side ? along.clone().multiplyScalar(.5 + fold * .5).add(V(-along.y, along.x, 0).multiplyScalar(side * (.9 - fold * .4))).add(V(0, -.3 + fold * .3, .3 * side)).normalize() : along.clone().add(V(0, .1, .1)).normalize();
      young.position.copy(stem.userData.at(share)); young.quaternion.setFromUnitVectors(V(0, 1, 0), way); young.rotateY((rnd(i, seed + 24) - .5) * 1.2); inner.add(young);
    });
    [.5, .78].forEach((share, k) => { const closed = M.bud({ length: (.13 + k * .03) * S, seed: seed + 40 + k, axis: V(k ? .4 : -.5, .8, .2) }); closed.position.copy(stem.userData.at(share)); inner.add(closed); });
    tick(t => { spray.rotation.z = Math.sin(t * 1.396 + 2) * .0087; });
  }

  // ---------- a petal lets go of a bloom on the left and leaves through the bottom edge ----------
  if (!rain && released.length) for (let i = 0; i < Math.min(6, Math.round(2 + 4 * A)); i++) {
    const from = released[i % released.length], z = [-1.6, .9, -3, .2, -2.2, 1.4][i], size = (.3 + rnd(i, seed + 31) * .2) * S, speed = .16 + rnd(i, seed + 32) * .16, floor = -view.halfHAt(z) - .6;
    const fall = (from.y - floor) / speed, pause = 1.25 + rnd(i, today + 33) * 2.5, cycle = fall + pause, offset = cycle * (([.42, .12, .74, .28, .6, .9][i] + rnd(i, today + 34) * .2) % 1) - 13;
    const petal = M.petal(size), turn = .72 + rnd(i, seed + 35) * .5, phase = rnd(i, seed + 36) * 6, sway = .35 + rnd(i, seed + 37) * .15; stage.add(petal);
    tick(t => {
      const age = ((t + offset) % cycle + cycle) % cycle, falling = age < fall, drop = age * speed, ease = Math.min(1, drop / .8);
      petal.visible = falling; if (!falling) return;
      petal.position.set(Math.min(-W + 2.9, from.x + (Math.sin(age * .42 + phase) * sway - .25 * Math.min(1, drop / 3)) * ease), from.y - drop, from.z + (z - from.z) * Math.min(1, drop / 2.5));
      petal.rotation.set(age * turn + phase, age * turn * .6 + phase * 2, Math.sin(age * .5 + phase) * .9);
    });
  }
}
