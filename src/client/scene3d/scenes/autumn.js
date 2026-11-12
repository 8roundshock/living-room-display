// Autumn (#664, from the owner's verdict on the ginkgo of #653: "more canadian, with like a
// maple tree ... orange and yellow", "less transparent", a leaf every "1.5-2 minutes"). A
// sugar-maple branch enters from the left edge and climbs toward the top-left, branching in
// opposite pairs; its leaves gather in sprays at the shoot tips, clear yellow and gold inside,
// fire orange and red-orange toward the outer shoots, and a few twig ends are bare. A few
// leaves that have already fallen rest in the bottom-left corner. Low on the right edge, as a
// lighter and smaller companion from the same wood, a slender paper-birch twig leans in:
// white bark with dark lenticels and a curl of peeling bark, fine dark side twigs, small
// yellow leaves, some already gone. One maple leaf at a time lets go and rocks down the left
// edge; then the air is empty for one and a half to two minutes. Orange and yellow only (the
// pure red leaf belongs to Canada Day); no flag, pumpkin, fruit or grain; the middle of the
// screen and the middle of the bottom edge stay black. One fixed picture for the whole
// season (coordinator decision on #615). Art rules: ../README.md.
import { aim } from '../parts/spring-blade.js';
import { bark, limb, taper } from '../parts/spring-limb.js';
import { maple } from '../parts/autumn-maple.js';
import { birch } from '../parts/autumn-birch.js';
import { weatherOver } from '../parts/wind-underneath.js';

/** The maple is drawn at this share of the size it was designed at, positions and sizes together, about the point where it enters the frame (#653, kept in #664). */
const SMALLER = .85;
/** Drawing order (see the note in build): the wood's meshes have their origins this far behind the wood itself; CELL is the grid on which two leaves are compared; overlapping leaves are drawn from origins a STEP apart in depth; a maple leaf is carried a LAYER nearer the room for every level of leaves it lies over. */
const WOOD_BEHIND = .3, CELL = .05, STEP = .012, LAYER = .1;
/** Scene seconds in a real minute: the scene clock runs at an eighth of real time. */
const MINUTE = 60 / 8;
/** The empty air after each falling leaf has landed, in real minutes (#664: "1.5-2 minutes"), as a short repeating sequence; the day chooses where it starts. */
const GAPS = [1.75, 1.5, 2, 1.6, 1.9];
/** The scene clock starts at 12: the first leaf lets go about three real seconds later, so a still frame (t = 14) shows it just below its shoot. */
const FIRST_RELEASE = 12.4;

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed, today = ctx.seed + ctx.day;
  // The weather over the scene (#646): wind leans every leaf to the left and doubles its sway, and the falling leaf
  // drifts left; rain and a storm keep the leaves on the tree and halve the glows; fog dims them by 40% and stops their twinkle.
  const weather = weatherOver(kit, ctx), dim = weather.backlight;
  const M = maple(kit), wood = bark(kit, 0x6a5648, { see: .62, salt: 7 });
  const at = (x, y, z = 0) => V(-W + x, y, z);   // measured from the left edge

  // ---------- drawing order ----------
  // Since #683 every leaf and the wood are solid: the depth buffer decides what hides what, in any order, and nothing
  // shows through a leaf. The order below no longer changes what is seen; it is kept because it is harmless, and the
  // carry() that sets overlapping leaves apart in depth still keeps them from passing through each other as they sway.
  // three.js draws see-through meshes from the farthest origin to the nearest, and what is drawn first hides
  // what is drawn later behind it; an order that changes shows as a jump in brightness where two pieces
  // overlap (#653, #663). So nothing here has an origin that moves in depth: a leaf sways only about its
  // origin, and that origin is put where the order needs it, without moving the leaf (its geometry is moved
  // back by as much). Wood is drawn before every leaf: a leaf is then hidden where it passes behind a branch
  // and shows the branch through it where it passes in front.
  const behind = (mesh, holder) => { mesh.geometry.translate(0, 0, WOOD_BEHIND); mesh.position.z = -WOOD_BEHIND; holder.add(mesh); return mesh; };
  // Leaves that overlap are drawn the right way round. `layers` lays each blade on a fine grid as it hangs,
  // seen from the room; of two blades the nearer one in most of the cells both cover lies over the other; and a
  // leaf's level is one more than the highest level under it. `arrange` sets the origins in depth in the order
  // of those levels, from `from` toward the room.
  const spot = V();
  const layers = leaves => {
    stage.updateMatrixWorld(true);
    const shapes = leaves.map(({ userData: { blade, points } }) => {
      const position = blade.geometry.attributes.position, cells = new Map();
      for (let n = 0; n < points; n++) { spot.fromBufferAttribute(position, n).applyMatrix4(blade.matrixWorld); const key = Math.round(spot.x / CELL) * 4096 + Math.round(spot.y / CELL), cell = cells.get(key); if (cell) { cell[0] += spot.z; cell[1]++; } else cells.set(key, [spot.z, 1]); }
      return cells;
    });
    const level = leaves.map(() => 0), over = [];
    for (let a = 0; a < leaves.length; a++) for (let b = a + 1; b < leaves.length; b++) {
      let shared = 0, score = 0, lead = 0; for (const [key, [depth, n]] of shapes[a]) { const other = shapes[b].get(key); if (other) { const nearer = depth / n - other[0] / other[1]; shared++; score += Math.sign(nearer); lead += nearer; } }
      if (shared) over.push((score || lead) >= 0 ? [a, b] : [b, a]);   // a tie in cells goes to the one that is nearer on the whole
    }
    for (let pass = 0; pass < leaves.length; pass++) for (const [top, under] of over) if (level[top] <= level[under] && level[under] < leaves.length) level[top] = level[under] + 1;
    return level;
  };
  const arrange = (leaves, from) => {
    const level = layers(leaves);
    leaves.map((leaf, i) => i).sort((a, b) => level[a] - level[b] || a - b).forEach((i, slot) => {
      const blade = leaves[i].userData.blade; blade.getWorldPosition(spot); spot.z = from + slot * STEP; blade.parent.worldToLocal(spot);
      blade.geometry.translate(-spot.x, -spot.y, -spot.z); blade.position.copy(spot);
    });
  };
  // Every hanging leaf sways a little about the foot of its stalk: [pivot, pace, phase, how far].
  const swaying = [];
  // `toward` is the way the leaf points from its stalk's foot: the wind leans its free end to the left (#646).
  const hang = (leaf, where, holder, i, salt, far, toward) => { const pivot = new T.Group(); pivot.position.copy(where); pivot.add(leaf); holder.add(pivot); swaying.push([pivot, 1.4 + rnd(i, salt) * 1.05, rnd(i, today + salt + 1) * 6, far, toward.y / toward.length()]); };
  tick(t => { const sway = weather.wind.sway; for (let i = 0; i < swaying.length; i++) { const s = swaying[i]; s[0].rotation.z = weather.sway(Math.sin(t * s[1] + s[2]) * s[3], s[4]); s[0].rotation.x = Math.sin(t * s[1] * .63 + s[2]) * s[3] * .45 * sway; } });

  // ---------- the maple: one piece, made smaller about the point where it enters the frame, and rocking about it ----------
  const enter = at(0, -1.04, -.07), shrunk = point => point.clone().sub(enter).multiplyScalar(SMALLER).add(enter);
  const branch = new T.Group(), body = new T.Group(); branch.position.copy(enter); branch.scale.setScalar(SMALLER); body.position.copy(enter).negate(); branch.add(body); stage.add(branch);
  // A maple branches in opposite pairs. Each shoot: its name, the shoot it leaves and where along it, the points
  // it runs through (from the left edge), its thickness at foot and tip, the leaves at its tip (0 is a bare
  // end), and how far its leaves have turned (0 clear yellow, 1 red-orange): the outer shoots are the reddest.
  const SHOOTS = [
    ['main', null, 0, [[-.55, -1.62, -.2], [.3, -.72, 0], [.92, .3, .14], [1.4, 1.36, .2], [1.9, 2.4, .16], [2.3, 3.2, .08], [2.52, 3.6, .03]], .12, .026, 5, .85],
    ['inner', 'main', .36, [[.62, 1.1, .26], [.42, 1.9, .34], [.56, 2.62, .3]], .056, .02, 4, .4],
    ['low', 'main', .36, [[1.55, .86, .24], [2.1, 1.12, .34], [2.56, 1.52, .3]], .05, .018, 4, .62],
    ['outer', 'main', .66, [[2.3, 2.2, .28], [2.86, 2.6, .34], [3.16, 3.08, .28]], .05, .018, 4, .8],
    ['stub', 'main', .66, [[1.5, 2.5, .08], [1.36, 2.84, .04]], .03, .014, 0, 0],
    ['innerA', 'inner', .55, [[.26, 2.0, .42], [.16, 2.28, .44]], .024, .012, 3, .12],
    ['innerB', 'inner', .55, [[.74, 1.98, .2], [.92, 2.2, .16]], .022, .012, 0, 0],
    ['outerA', 'outer', .5, [[2.78, 2.2, .4], [2.98, 1.98, .44]], .024, .012, 3, .55],
    ['outerB', 'outer', .5, [[2.44, 2.72, .22], [2.4, 3.0, .18]], .022, .012, 2, .95],
    ['lowA', 'low', .5, [[1.86, 1.34, .36], [1.94, 1.6, .4]], .022, .012, 3, .28],
    ['lowB', 'low', .5, [[1.98, .72, .3], [2.14, .5, .3]], .02, .011, 0, 0],
    ['mainA', 'main', .86, [[2.42, 3.0, .16], [2.66, 3.02, .2]], .022, .012, 2, .7],
    ['mainB', 'main', .86, [[1.86, 3.08, .02], [1.7, 3.3, 0]], .022, .012, 2, .5],
  ];
  // Thirty-two leaves at the owner's amount. More or fewer are added to or taken from the leafy shoots in turn (six at most, one at least); bare ends stay bare.
  const wanted = Math.min(44, Math.round(15 + 70 * A)), counts = SHOOTS.map(shoot => shoot[6]), grown = {}, released = [], foliage = [];
  for (let pass = 0, spare = wanted - counts.reduce((sum, count) => sum + count, 0); spare && pass < 90; pass++) { const s = pass * 3 % counts.length; if (spare > 0 && counts[s] && counts[s] < 6) { counts[s]++; spare--; } else if (spare < 0 && counts[s] > 1) { counts[s]--; spare++; } }
  let index = 0;
  SHOOTS.forEach(([name, parent, share, through, from, to, , turned], s) => {
    const points = through.map(([x, y, z]) => at(x, y, z)); if (parent) points.unshift(grown[parent].userData.at(share));
    const shoot = grown[name] = behind(limb(kit, points, taper(from * S, to * S, .9), wood, { sides: parent ? 6 : 7 }), body), end = shoot.userData.at(1), along = shoot.userData.dir(1), count = counts[s];
    if (!count) { behind(new T.Mesh(kit.ballGeo.clone().scale(to * S * 1.3, to * S * 1.3, to * S * 1.3).translate(end.x, end.y, end.z), wood), body); return; }   // a bare end keeps its bud
    for (let k = 0; k < count; k++) {
      // Leaves stand in opposite pairs, each pair a little farther back from the tip and spread wider than the
      // one before; an odd leaf ends the shoot.
      const i = index++, lone = count % 2 && !k, pair = lone ? 0 : Math.floor((k + (count % 2 ? 1 : 0)) / 2), side = lone ? 0 : (k + pair) % 2 ? -1 : 1;
      const node = shoot.userData.at(1 - Math.min(.5, pair * .15 * S / shoot.userData.length)), spread = side * (.62 + pair * .7 + (rnd(i, seed + 5) - .5) * .4) + (rnd(i, seed + 6) - .5) * .3, c = Math.cos(spread), n = Math.sin(spread);
      const way = V(along.x * c - along.y * n, along.x * n + along.y * c - .3 - rnd(i, seed + 7) * .25, .08 + rnd(i, seed + 8) * .3), face = V((rnd(i, seed + 9) - .5) * .9, .28, 1);
      const size = (.36 + rnd(i, seed + 3) * .24) * S, leaf = aim(kit, M.leaf({ size, stalk: size * (.5 + rnd(i, seed + 4) * .4), tone: Math.min(1, Math.max(0, turned + (rnd(i, seed + 10) - .5) * .42)), seed: seed + i * 17 }), way, face);
      hang(leaf, node, body, i, seed + 11, .03 + rnd(i, seed + 12) * .014, way); foliage.push(leaf);
    }
    if (end.x < -W + 2.6) released.push(shrunk(end.clone().add(V(0, -.3 * S, .1))));   // where a leaf of this shoot hangs, as drawn
  });
  tick(t => { branch.rotation.z = weather.sway(Math.sin(t * 1.005) * .0052, 0); });
  // Where two leaves overlap, the one that lies over the other is carried nearer the room on its stalk, a LAYER
  // for every level, so that neither passes through the other as they sway; then the order is taken again from
  // the leaves as they now hang.
  layers(foliage).forEach((level, i) => { const leaf = foliage[i]; leaf.userData.blade.getWorldPosition(spot); spot.z += level * LAYER; leaf.worldToLocal(spot); leaf.userData.carry(spot); });
  arrange(foliage, -.054);   // no origin lands on depth 0, where the snow overlay sorts its plates

  // ---------- the companion: a paper-birch twig low on the right edge, lighter and smaller than the maple ----------
  {
    const B = birch(kit), right = (x, y, z = 0) => V(W - x, y, z), leaves = [];   // measured from the right edge
    const foot = right(-.6, -3.9, -.3), plant = new T.Group(), held = new T.Group(); plant.position.copy(foot); held.position.copy(foot).negate(); plant.add(held); stage.add(plant);
    // The stem is white where it is thick enough to have bark that peels, and a fine dark twig beyond; it steps a little to one side at each node.
    const stem = behind(limb(kit, [foot, right(.15, -3.22, -.16), right(.8, -2.64, -.02), right(1.38, -2.1, .08), right(1.9, -1.8, .14)], taper(.056 * S, .02 * S), B.bark, { sides: 7 }), held);
    const tip = behind(limb(kit, [stem.userData.at(1), right(2.28, -1.6, .17), right(2.6, -1.55, .17), right(2.84, -1.66, .15)], taper(.02 * S, .006 * S), B.twig, { sides: 5 }), held);
    // Side twigs, one at a node and on alternate sides, arching out and drooping at their ends: [where along the stem, the points it runs through, where its leaves hang along it]. One has lost all its leaves.
    const TWIGS = [[.46, [[.66, -2.4, .14], [.98, -2.1, .2], [1.26, -2.1, .22], [1.44, -2.3, .22]], [.45, .72, 1]], [.7, [[1.5, -2.5, .12], [1.82, -2.7, .16], [1.96, -2.98, .16]], [.55, 1]], [.93, [[1.86, -1.52, .2], [2.1, -1.36, .22], [2.32, -1.46, .22]], [.6, 1]], [.24, [[.3, -3.5, .1], [.52, -3.74, .12]], []]];
    const spots = [[tip, .5], [tip, 1]];
    TWIGS.forEach(([share, through, hung]) => { const twig = behind(limb(kit, [stem.userData.at(share), ...through.map(([x, y, z]) => right(x, y, z))], taper(.012 * S, .005 * S), B.twig, { sides: 5 }), held); for (const where of hung) spots.push([twig, where]); });
    // Small leaves on slender stalks, alternately to one side and the other, each hanging tip down and turned its
    // own way about its stalk, so that some show their face and some their edge; fewer on a quiet date, never more
    // than there are places.
    const count = Math.min(spots.length, Math.round(5 + 16 * A));
    spots.slice(0, count).forEach(([twig, where], i) => {
      const size = (.22 + rnd(i, seed + 81) * .14) * S, tilt = (i % 2 ? 1 : -1) * (.12 + rnd(i, seed + 82) * .5), turned = (rnd(i, seed + 85) - .5) * 2.6;
      const down = V(Math.sin(tilt) * .6, -1, .1 + (i % 3) * .1), leaf = aim(kit, B.leaf({ size, stalk: size * (.45 + rnd(i, seed + 83) * .3), tone: rnd(i, seed + 84), dry: i === 3 || i === 6, seed: seed + 800 + i * 13 }), down, V(Math.sin(turned), .12, Math.cos(turned)));
      hang(leaf, twig.userData.at(where), held, i, seed + 86, .03 + rnd(i, seed + 87) * .02, down); leaves.push(leaf);
    });
    // Bark peels from the white stem in thin curls.
    [[.34, 1], [.63, -1]].forEach(([share, side], i) => {
      const along = stem.userData.dir(share), out = V(-along.y, along.x, 0).multiplyScalar(side), peel = aim(kit, B.curl({ length: (.17 + rnd(i, seed + 88) * .06) * S, width: (.06 + rnd(i, seed + 89) * .025) * S, seed: seed + 880 + i }), along, V(0, 0, 1));
      if (side > 0) peel.rotateY(Math.PI); peel.position.copy(stem.userData.at(share)).addScaledVector(out, stem.userData.radius(share) * .8); held.add(peel);   // a curl peels toward its own +x, so one on the other side is turned round
    });
    tick(t => { plant.rotation.z = weather.sway(Math.sin(t * .9 + 1.3) * .004, 0); });
    arrange(leaves, -.054);
  }

  if (ctx.quiet) return;   // a quiet date keeps the two plants alone: nothing fallen, nothing falling, no glow

  // ---------- backlight behind the upper branch, as the low sun through a maple ----------
  const haze = kit.glow(0xf2a04a, 6, .06 * dim, { twinkle: .24 }); haze.position.copy(shrunk(at(1.9, 2.5, -2.5))); stage.add(haze);
  [[.7, 3.2, 1.0, .05], [2.2, 1.3, .8, .04], [2.9, 3.6, 1.2, .03]].forEach(([x, y, size, strength]) => { const z = -7, scale = 1 - z / view.depth, disc = kit.bokeh(0xf2a85a, size * S * scale, strength * dim, .2); disc.position.set((-W + x) * scale, y * scale * .8, z); stage.add(disc); });

  // ---------- leaves that have fallen: in the corner under the branch, resting on the bottom edge ----------
  // [x from the left edge, depth, how far it is laid back, turn in its own plane, how far it has turned colour, a lift so it lies on the
  // visible bottom]: a loose overlapping group, not a row.
  const FLOOR = .9588, fallen = Math.min(7, Math.round(3 + 5 * A)), LIE = [[.62, -.3, -1.1, .5, .75], [1.3, .3, -1.0, 2.0, .15, .03], [1.96, -.1, -1.16, -1.0, .95], [.98, .62, -.6, .3, .45], [2.4, .45, -1.05, .9, .6], [.24, .1, -1.0, -1.2, .3], [1.62, -.5, -1.15, 1.6, .85]], lying = [];
  const glow = kit.glow(0xf2a04a, 3.6, .04 * dim, { twinkle: .1 }); glow.position.set(-W + 1.5, -view.halfH + .1, -.6); stage.add(glow);
  LIE.slice(0, fallen).forEach(([x, z, tilt, turn, tone, lift = 0], i) => {
    const size = (.34 + rnd(i, seed + 41) * .16) * S * SMALLER, leaf = M.leaf({ size, stalk: size * (.3 + rnd(i, seed + 42) * .3), tone, seed: seed + 300 + i * 11 }), holder = new T.Group();
    // The leaf is turned in its own plane, then laid back; one leans on its neighbour instead of lying flat.
    leaf.rotation.z = turn; holder.add(leaf); holder.rotation.set(tilt, (rnd(i, seed + 43) - .5) * .6, 0);
    // A little in from the corner, resting on the visible bottom: the float's zoom crops the lowest 2% at its centre (#675).
    holder.position.set(-W + x + .35, -view.halfHAt(z) * FLOOR + .04 + lift + (tilt > -.9 ? .12 : 0) + rnd(i, seed + 44) * .05, z); stage.add(holder); lying.push(leaf);
  });
  arrange(lying, .5);

  // ---------- one leaf at a time lets go of a shoot, rocks down the left edge and fades into the fallen ones; then the air is empty for a minute or two ----------
  if (released.length) {
    // One leaf does every fall, in a short repeating round. A fall has its own shoot, lane, size, colour, pace and
    // swing, and its own empty air after it. The leaf is a gold one, and each fall keeps a share of its green
    // (TURNS), which makes it gold, amber, orange or red-orange; the share is set as a fall begins, while the leaf
    // is still faded out. A lane is a depth in front of or behind everything the leaf can pass, and
    // the leaf keeps to it from the moment it lets go, turning about its own origin: a leaf that changed depth on
    // the way down would trade places in the drawing order with whatever it passed. So it starts where its shoot
    // is seen from the room (`seen` is that scale), not at the shoot's own depth. In front: nearer than the tree
    // (its leaves are drawn from depths up to about 0.5, its wood from -0.3) and the fallen leaves (up to 0.6),
    // short of the fog's near band (1.5). Behind: farther than the tree, the glow under the fallen leaves (-0.6)
    // and the snow's middle band (-1), short of the wind's seeds (-1.4 and farther).
    const LANES = [1, -1.2, 1.25, -1.1, -1.15], TURNS = [1, .56, .8, .42, .68], long = .4 * S * SMALLER, leaf = M.leaf({ size: long, stalk: long * .55, tone: .2, seed: seed + 500, own: true, about: long }), laid = new T.Group(), holder = new T.Group();
    laid.add(leaf); holder.add(laid); holder.visible = false; stage.add(holder);
    const falls = []; let round = 0;
    GAPS.forEach((gap, k) => {
      const from = released[(k * 2 + 1) % released.length], z = LANES[k % LANES.length], seen = (1 - z / view.depth) / (1 - from.z / view.depth), floor = (-view.halfHAt(z) + .3) / seen, speed = .24 + rnd(k, seed + 51) * .16, fall = (from.y - floor) / speed;
      falls.push({ from, z, seen, floor, speed, fall, start: round, turn: TURNS[k % TURNS.length], size: .82 + rnd(k, seed + 57) * .36, swing: 4.2 + rnd(k, seed + 54) * 1.4, reach: .32 + rnd(k, seed + 55) * .14, phase: rnd(k, seed + 56) * 6 }); round += fall + gap * MINUTE;
    });
    const offset = falls[((today % falls.length) + falls.length) % falls.length].start - FIRST_RELEASE; let showing = null;
    tick(t => {
      const now = ((t + offset) % round + round) % round; let current = null;
      for (let k = 0; k < falls.length; k++) if (now >= falls[k].start && now < falls[k].start + falls[k].fall) current = falls[k];
      // Rain or a storm keeps the leaves on the tree (#646): the leaf stays built and hidden.
      holder.visible = current !== null && weather.falls; if (!holder.visible) return;
      if (current !== showing) { showing = current; leaf.userData.turn(current.turn); }
      const from = current.from, age = now - current.start, drop = age * current.speed, ease = Math.min(1, drop / .7), beat = age * current.swing + current.phase, slide = Math.sin(beat);
      holder.position.set(Math.min(-W + 2.9, Math.max(-W + .45, from.x + .3 * ease + slide * current.reach * ease + weather.drift(age))) * current.seen, (from.y - drop + Math.abs(Math.cos(beat)) * .07 * ease) * current.seen, current.z);
      // A maple leaf does not spin on its stalk: it lies back on the air, banks into each slide from side to side, nods, and turns slowly in its own plane.
      holder.rotation.z = -Math.cos(beat) * .5 * ease; laid.rotation.x = -.7 + Math.cos(beat * 2) * .24 * ease; leaf.rotation.z = current.phase + age * .22;
      holder.scale.setScalar(current.size); leaf.userData.fade(Math.min(1, drop / .3, (from.y - drop - current.floor) / .5));
    });
  }
}
