// Autumn (design plan #615). A ginkgo branch enters from the left edge and climbs to the
// top-left: a main branch, two side branches and stubby spur shoots, some bare, the others
// holding two to four gold fans on long stalks. A few fans that have already fallen rest in the
// bottom-left corner under the branch, as on a sill, and now and then one more swings down the
// left edge to join them. Gold and amber only (red leaves belong to Canada Day); no maple,
// pumpkin, fruit or grain; the rest of the bottom edge and the whole right half stay black.
// One fixed picture for the whole season (coordinator decision on #615). Art rules: ../README.md.
import { aim } from '../parts/spring-blade.js';
import { bark, limb, taper } from '../parts/spring-limb.js';
import { ginkgo } from '../parts/autumn-ginkgo.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed, today = ctx.seed + ctx.day;
  const G = ginkgo(kit), wood = bark(kit, 0x5e5248, { salt: 7 }), rain = ctx.weather === 'rain', dim = rain || ctx.weather === 'fog' ? .5 : 1;
  const at = (x, y, z = 0) => V(-W + x, y, z);   // measured from the left edge

  // ---------- the branch: it rocks as one piece about the point where it leaves the frame ----------
  const root = at(-.55, -1.62, -.2), branch = new T.Group(), body = new T.Group(); branch.position.copy(root); body.position.copy(root).negate(); branch.add(body); stage.add(branch);
  const grow = (points, from, to, sides = 7) => { const mesh = limb(kit, points, taper(from * S, to * S, .9), wood, { sides }); body.add(mesh); return mesh; };
  const main = grow([root, at(.3, -.72, 0), at(.92, .3, .15), at(1.42, 1.42, .2), at(1.96, 2.46, .15), at(2.42, 3.3, .05), at(2.82, 3.92, -.05)], .13, .036);
  const inner = grow([main.userData.at(.34), at(.56, .92, .25), at(.48, 1.8, .35), at(.74, 2.7, .3), at(.7, 3.52, .2)], .07, .03);
  const outer = grow([main.userData.at(.62), at(2.2, 2.04, .3), at(2.78, 2.56, .4), at(3.18, 3.3, .3)], .062, .03);
  const LIMBS = { main, inner, outer };

  // Spur shoots: the limb, where along it, which side, and how many leaves it holds (0 is a bare spur).
  const SPURS = [['main', .2, 1, 0], ['main', .44, -1, 3], ['main', .56, 1, 2], ['main', .78, -1, 2], ['main', 1, 1, 2], ['inner', .42, -1, 2], ['inner', .7, 1, 0], ['inner', 1, -1, 2], ['outer', .5, 1, 0], ['outer', 1, 1, 2], ['main', .9, 1, 0]];
  // Fifteen leaves at the owner's amount. More or fewer are added to or taken from the leafy spurs in turn (four at most, one at least); bare spurs stay bare.
  const wanted = Math.min(26, Math.round(12 + 14 * A)), counts = SPURS.map(spur => spur[3]), TINTS = [.5, .12, .8, .34, 1], released = [];
  for (let pass = 0, spare = wanted - counts.reduce((sum, count) => sum + count, 0); spare && pass < 60; pass++) { const s = pass * 3 % counts.length; if (spare > 0 && counts[s] && counts[s] < 4) { counts[s]++; spare--; } else if (spare < 0 && counts[s] > 1) { counts[s]--; spare++; } }
  let index = 0;
  SPURS.forEach(([from, share, side], s) => {
    const parent = LIMBS[from], base = parent.userData.at(share), along = parent.userData.dir(share), tip = share === 1;
    // A spur leaves its branch sideways and a little forward; the one at a branch tip simply ends the branch.
    const way = tip ? along.clone() : V(-along.y, along.x, 0).multiplyScalar(side).add(V(0, .25, .5 * (s % 2 ? 1 : -.6))).addScaledVector(along, .35).normalize(), reach = (tip ? .12 : .17 + rnd(s, seed + 2) * .1) * S;
    const end = base.clone().addScaledVector(way, reach), girth = Math.max(.034, parent.userData.radius(share) / S * .7);
    grow([base, base.clone().addScaledVector(way, reach * .55), end], girth, girth * .8, 6);
    const knob = new T.Mesh(kit.ballGeo, wood); knob.scale.setScalar(girth * S * .95); knob.position.copy(end); body.add(knob);
    const count = counts[s];
    for (let k = 0; k < count; k++) {
      const i = index++, size = (.46 + rnd(i, seed + 3) * .42) * S, stalk = (.28 + rnd(i, seed + 4) * .24) * S, fan = (k - (count - 1) / 2) * 1.15 + (rnd(i, seed + 5) - .5) * .4;
      const leaf = G.leaf({ size, stalk, tint: TINTS[i % 5] + (rnd(i, seed + 6) - .5) * .12, hold: i + s, brown: i === 4 || i === 11, seed: seed + i * 17 });
      // Each stalk leaves the spur in its own direction and the fan hangs: mostly down, a little out to its side and toward the room.
      const hang = V(Math.sin(fan) * .8 + way.x * .3, -1 + Math.abs(Math.sin(fan)) * .45, .15 + Math.cos(fan * 1.7) * .3 + way.z * .2), face = V(Math.sin(fan * .7 + (rnd(i, seed + 7) - .5) * .9), .1, Math.cos(fan * .7));
      const pivot = new T.Group(); pivot.position.copy(end); aim(kit, leaf, hang, face); pivot.add(leaf); body.add(pivot);
      const pace = 1.43 + rnd(i, seed + 8) * 1.05, phase = rnd(i, today + 9) * 6;
      tick(t => { pivot.rotation.z = Math.sin(t * pace + phase) * .044; pivot.rotation.x = Math.sin(t * pace * .63 + phase) * .02; });
    }
    if (count && end.x < -W + 2.6) released.push(end.clone().add(V(0, -.5 * S, .1)));
  });
  tick(t => { branch.rotation.z = Math.sin(t * 1.005) * .0052; });

  if (ctx.quiet) return;   // a quiet date keeps the branch alone: nothing fallen, nothing falling, no backlight

  // ---------- backlight behind the upper branch ----------
  const haze = kit.glow(0xf2b65a, 7, .06 * dim, { twinkle: .24 }); haze.position.copy(at(1.9, 2.5, -2.5)); stage.add(haze);
  [[.8, 3.9, 1.2, .05], [2.6, 1.6, .9, .04], [3.4, 4.3, 1.4, .03]].forEach(([x, y, size, strength]) => { const z = -7, scale = 1 - z / view.depth, disc = kit.bokeh(0xf2b65a, size * S * scale, strength * dim, .2); disc.position.set((-W + x) * scale, y * scale * .8, z); stage.add(disc); });

  // ---------- fans that have fallen: in the corner under the branch, resting on the bottom edge ----------
  // [x from the left edge, depth, how far it is laid back, turn in its own plane]: a loose overlapping group, not a row.
  const fallen = Math.min(8, Math.round(4 + 4 * A)), LIE = [[.75, -.3, -1.1, .5], [1.45, .3, -1.0, 2.0], [2.2, -.1, -1.16, -1.0], [1.12, .62, -.55, .3], [2.7, .45, -1.05, .9], [.25, .1, -1.0, -1.2], [1.85, -.5, -1.15, 1.6], [3.2, -.2, -1.2, -.6]];
  const glow = kit.glow(0xf2b65a, 4.2, .04 * dim, { twinkle: .1 }); glow.position.set(-W + 1.8, -view.halfH + .1, -.6); stage.add(glow);
  LIE.slice(0, fallen).forEach(([x, z, tilt, turn], i) => {
    const leaf = G.leaf({ size: (.42 + rnd(i, seed + 41) * .28) * S, stalk: (.16 + rnd(i, seed + 42) * .12) * S, tint: TINTS[(i + 2) % 5], hold: i + 1, brown: i === 2, seed: seed + 300 + i * 11 }), holder = new T.Group();
    // The fan is turned in its own plane, then laid back; one leans on its neighbour instead of lying flat.
    leaf.rotation.z = turn; holder.add(leaf); holder.rotation.set(tilt, (rnd(i, seed + 43) - .5) * .6, 0);
    holder.position.set(-W + x, -view.halfHAt(z) + .02 + (tilt > -.9 ? .14 : 0) + rnd(i, seed + 44) * .05, z); stage.add(holder);
  });

  // ---------- a fan lets go of a spur, swings down the left edge and fades into the fallen ones ----------
  if (!rain && released.length) for (let i = 0; i < Math.min(4, Math.round(1 + 3 * A)); i++) {
    const from = released[(i * 2 + 1) % released.length], z = [.5, -1.4, 1.1, -2.4][i], floor = -view.halfHAt(z) + .3, speed = .24 + rnd(i, seed + 51) * .16, fall = (from.y - floor) / speed, pause = 2.5 + rnd(i, today + 52) * 3.75, cycle = fall + pause;
    const offset = cycle * (([.38, .7, .1, .55][i] + rnd(i, today + 53) * .2) % 1) - 13, swing = 4.2 + rnd(i, seed + 54) * 1.4, reach = .32 + rnd(i, seed + 55) * .14, phase = rnd(i, seed + 56) * 6;
    const leaf = G.leaf({ size: (.44 + rnd(i, seed + 57) * .2) * S, stalk: .2 * S, tint: TINTS[(i * 2 + 1) % 5], hold: i + 2, seed: seed + 500 + i * 13, own: true }), holder = new T.Group();
    leaf.position.y = -.3 * S; holder.add(leaf); stage.add(holder);
    tick(t => {
      const age = ((t + offset) % cycle + cycle) % cycle, falling = age < fall, drop = age * speed, ease = Math.min(1, drop / .7), beat = age * swing + phase;
      holder.visible = falling; if (!falling) return;
      holder.position.set(Math.min(-W + 3.3, Math.max(-W + .5, from.x + .3 * ease + Math.sin(beat) * reach * ease)), from.y - drop + Math.abs(Math.cos(beat)) * .07 * ease, from.z + (z - from.z) * Math.min(1, drop / 2));
      holder.rotation.set(-.35 + Math.cos(beat) * .25, Math.sin(age * .35 + phase) * 1.1, Math.sin(beat) * .55 * ease);   // stalk first, the fan trailing above it and turning slowly on the stalk
      leaf.userData.fade(Math.min(1, drop / .3, (from.y - drop - floor) / .5));
    });
  }
}
