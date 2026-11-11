// Autumn (design plan #615; reworked from the owner's verdict on the TV, #653: "more
// transparent, a little smaller, and something else on the other side", and a leaf only every
// few minutes). A ginkgo branch enters from the left edge and climbs toward the top-left: a
// main branch, two side branches and stubby spur shoots, some bare, the others holding gold
// fans on long stalks; wood, stalks and fans are thin glass that keeps its rims and veins. A few
// fans that have already fallen rest in the bottom-left corner under the branch. Low on the
// right edge, as a lighter and smaller companion, a Chinese-lantern stem (physalis) arches in
// with a few papery husks hanging under it, from green-gold at its tip to deep orange-red, one
// worn to a lace of veins round its berry. One fan at a time lets go and swings down the left
// edge; then the air is empty for three to six minutes. Gold and amber on the ginkgo side (red
// leaves belong to Canada Day); no maple, pumpkin, fruit bowl or grain; the middle of the
// screen and the middle of the bottom edge stay black. One fixed picture for the whole season
// (coordinator decision on #615). Art rules: ../README.md.
import { aim } from '../parts/spring-blade.js';
import { bark, limb, taper } from '../parts/spring-limb.js';
import { ginkgo } from '../parts/autumn-ginkgo.js';
import { physalis } from '../parts/autumn-physalis.js';

/** The ginkgo is drawn at this share of the size it was designed at, positions and sizes together, about the point where it enters the frame (#653). */
const SMALLER = .85;
/** Scene seconds in a real minute: the scene clock runs at an eighth of real time. */
const MINUTE = 60 / 8;
/** The empty air after each falling fan, in real minutes, as a short repeating sequence; the day chooses where it starts. */
const GAPS = [4.5, 3.25, 5.75, 3.75, 5];
/** The scene clock starts at 12: the first fan lets go about three real seconds later, so a still frame (t = 14) shows it just below its spur. */
const FIRST_RELEASE = 12.4;

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed, today = ctx.seed + ctx.day;
  // Rain (and a storm, which is rain) keeps the fans on the tree; rain, a storm and fog halve the glows.
  const wet = ctx.weather === 'rain' || ctx.weather === 'storm', dim = wet || ctx.weather === 'fog' ? .5 : 1;
  const G = ginkgo(kit), wood = bark(kit, 0x66584c, { see: .8, salt: 7 });
  const at = (x, y, z = 0) => V(-W + x, y, z);   // measured from the left edge

  // ---------- the branch: one piece, made smaller about the point where it enters the frame, and rocking about it ----------
  const enter = at(0, -1.04, -.07), shrunk = point => point.clone().sub(enter).multiplyScalar(SMALLER).add(enter);
  const root = at(-.55, -1.62, -.2), branch = new T.Group(), body = new T.Group(); branch.position.copy(enter); branch.scale.setScalar(SMALLER); body.position.copy(enter).negate(); branch.add(body); stage.add(branch);
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
    if (count && end.x < -W + 2.6) released.push(shrunk(end.clone().add(V(0, -.5 * S, .1))));   // where a fan of this spur hangs, as drawn
  });
  tick(t => { branch.rotation.z = Math.sin(t * 1.005) * .0052; });

  // ---------- the companion: a Chinese-lantern stem low on the right edge, lighter and smaller than the ginkgo ----------
  const lit = [];
  {
    const P = physalis(kit), right = (x, y, z = 0) => V(W - x, y, z);   // measured from the right edge
    const foot = right(-.6, -3.78, -.3), plant = new T.Group(), held = new T.Group(); plant.position.copy(foot); held.position.copy(foot).negate(); plant.add(held); stage.add(plant);
    const arch = limb(kit, [foot, right(.3, -2.86, -.1), right(1.1, -2.02, .1), right(1.8, -1.52, .2), right(2.3, -1.44, .2), right(2.62, -1.62, .15)], taper(.034 * S, .009 * S), P.stem, { sides: 6 }); held.add(arch);
    // Lanterns ripen from the foot of the stem toward its tip. In order of who stays when there are few:
    // [share along the stem, husk length, stalk length, ripeness, worn to lace, depth].
    const LANTERNS = [[.38, .6, .2, 1, false, .12], [.52, .64, .3, .9, true, -.1], [.9, .32, .12, .04, false, .05], [.77, .46, .16, .42, false, -.12], [.65, .54, .24, .7, false, .14], [.975, .22, .09, 0, false, -.04]];
    const husks = Math.max(3, Math.min(LANTERNS.length, Math.round(3.5 + 6 * A)));
    LANTERNS.slice(0, husks).forEach(([share, length, stalk, ripe, lace, depth], i) => {
      const pivot = new T.Group(), lantern = P.lantern({ length: length * S, stalk: stalk * S, ripe, lace, seed: seed + 700 + i * 19 });
      pivot.position.copy(arch.userData.at(share)).add(V(0, -arch.userData.radius(share) * .6, depth)); pivot.add(lantern); held.add(pivot);
      if (!lace && ripe > .6) lit.push([pivot, lantern]);
      const pace = 1.1 + rnd(i, seed + 71) * .7, phase = rnd(i, today + 72) * 6;
      tick(t => { pivot.rotation.z = Math.sin(t * pace + phase) * .022; pivot.rotation.x = Math.sin(t * pace * .7 + phase) * .012; });
    });
    // Two drying leaves, no more, both above the stem where the lanterns hang below it: a larger one low down and a small one further up.
    [[.45, .46, V(.25, 1, .3), V(.2, -.2, 1)], [.71, .36, V(-.8, .62, .2), V(-.1, .3, 1)]].forEach(([share, size, way, face], i) => { const leaf = aim(kit, P.leaf({ size: size * S, seed: seed + 760 + i * 7 }), way, face); leaf.position.copy(arch.userData.at(share)); held.add(leaf); });
    tick(t => { plant.rotation.z = Math.sin(t * .9 + 1.3) * .004; });
  }

  if (ctx.quiet) return;   // a quiet date keeps the two plants alone: nothing fallen, nothing falling, no glow

  // ---------- backlight behind the upper branch, and a faint warm light in the two ripest lanterns ----------
  const haze = kit.glow(0xf2b65a, 6, .06 * dim, { twinkle: .24 }); haze.position.copy(shrunk(at(1.9, 2.5, -2.5))); stage.add(haze);
  [[.7, 3.2, 1.0, .05], [2.2, 1.3, .8, .04], [2.9, 3.6, 1.2, .03]].forEach(([x, y, size, strength]) => { const z = -7, scale = 1 - z / view.depth, disc = kit.bokeh(0xf2b65a, size * S * scale, strength * dim, .2); disc.position.set((-W + x) * scale, y * scale * .8, z); stage.add(disc); });
  lit.slice(0, 2).forEach(([pivot, lantern], i) => { const ember = kit.glow(0xff9440, lantern.userData.length * 1.7, (.13 - i * .03) * dim, { twinkle: .15 }); ember.position.copy(lantern.userData.heart); pivot.add(ember); });

  // ---------- fans that have fallen: in the corner under the branch, resting on the bottom edge ----------
  // [x from the left edge, depth, how far it is laid back, turn in its own plane]: a loose overlapping group, not a row.
  const fallen = Math.min(7, Math.round(3 + 4 * A)), LIE = [[.64, -.3, -1.1, .5], [1.24, .3, -1.0, 2.0], [1.88, -.1, -1.16, -1.0], [.96, .62, -.55, .3], [2.3, .45, -1.05, .9], [.22, .1, -1.0, -1.2], [1.58, -.5, -1.15, 1.6]];
  const glow = kit.glow(0xf2b65a, 3.6, .04 * dim, { twinkle: .1 }); glow.position.set(-W + 1.5, -view.halfH + .1, -.6); stage.add(glow);
  LIE.slice(0, fallen).forEach(([x, z, tilt, turn], i) => {
    const leaf = G.leaf({ size: (.42 + rnd(i, seed + 41) * .28) * S * SMALLER, stalk: (.16 + rnd(i, seed + 42) * .12) * S * SMALLER, tint: TINTS[(i + 2) % 5], hold: i + 1, brown: i === 2, seed: seed + 300 + i * 11 }), holder = new T.Group();
    // The fan is turned in its own plane, then laid back; one leans on its neighbour instead of lying flat.
    leaf.rotation.z = turn; holder.add(leaf); holder.rotation.set(tilt, (rnd(i, seed + 43) - .5) * .6, 0);
    holder.position.set(-W + x, -view.halfHAt(z) + .02 + (tilt > -.9 ? .12 : 0) + rnd(i, seed + 44) * .05, z); stage.add(holder);
  });

  // ---------- one fan at a time lets go of a spur, swings down the left edge and fades into the fallen ones; then the air is empty for minutes ----------
  if (!wet && released.length) {
    // A short repeating round of falls. Each has its own fan, spur, depth, pace and swing, and its own empty air after it.
    const falls = []; let round = 0;
    GAPS.forEach((gap, k) => {
      const from = released[(k * 2 + 1) % released.length], z = [.5, -1.4, 1.1, -2.4, -.3][k % 5], floor = -view.halfHAt(z) + .3, speed = .24 + rnd(k, seed + 51) * .16, fall = (from.y - floor) / speed;
      const leaf = G.leaf({ size: (.44 + rnd(k, seed + 57) * .2) * S * SMALLER, stalk: .2 * S * SMALLER, tint: TINTS[(k * 2 + 1) % 5], hold: k + 2, seed: seed + 500 + k * 13, own: true }), holder = new T.Group();
      leaf.position.y = -.3 * S * SMALLER; holder.add(leaf); holder.visible = false; stage.add(holder);
      falls.push({ from, z, floor, speed, fall, start: round, swing: 4.2 + rnd(k, seed + 54) * 1.4, reach: .32 + rnd(k, seed + 55) * .14, phase: rnd(k, seed + 56) * 6, leaf, holder }); round += fall + gap * MINUTE;
    });
    const offset = falls[((today % falls.length) + falls.length) % falls.length].start - FIRST_RELEASE;
    tick(t => {
      const now = ((t + offset) % round + round) % round;
      for (const { from, z, floor, speed, fall, start, swing, reach, phase, leaf, holder } of falls) {
        const age = now - start, falling = age >= 0 && age < fall; holder.visible = falling; if (!falling) continue;
        const drop = age * speed, ease = Math.min(1, drop / .7), beat = age * swing + phase;
        holder.position.set(Math.min(-W + 2.9, Math.max(-W + .45, from.x + .3 * ease + Math.sin(beat) * reach * ease)), from.y - drop + Math.abs(Math.cos(beat)) * .07 * ease, from.z + (z - from.z) * Math.min(1, drop / 2));
        holder.rotation.set(-.35 + Math.cos(beat) * .25, Math.sin(age * .35 + phase) * 1.1, Math.sin(beat) * .55 * ease);   // stalk first, the fan trailing above it and turning slowly on the stalk
        leaf.userData.fade(Math.min(1, drop / .3, (from.y - drop - floor) / .5));
      }
    });
  }
}
