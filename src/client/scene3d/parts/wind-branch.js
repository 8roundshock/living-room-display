// The bowed branch (Wind, #621): one long, whippy branch bent over by the wind, its bend growing
// from nothing at the foot to about 55 degrees at the tip, with three side twigs swept the same
// way and a few slim leaves streaming in the lee. It is a chain of short tapered pieces, each
// turned a little against the last, so the gust can flex it without rebuilding any geometry.
import { taperedLimb } from './fog-birch.js';

/** The plan gives times in real seconds; the scene clock runs at an eighth of real time (README). */
const REAL = 8;

/**
 * at: where the branch leaves the frame. heading: degrees, the way its foot points (180 is left, 270 down).
 * bend: [calm, gust] degrees at the tip, turning toward `lee` (the heading the wind blows toward).
 * leaves: how many; leaf: the factory from wind-leaf.js; gust: from wind-gust.js. Returns a group.
 */
export function bowedBranch(kit, { at, heading = 222, lee = 180, length = 5.2, bend = [45, 60], leaves = 9, leaf, gust, seed = 0 }) {
  const { T, V, rnd, tick, ctx } = kit, S = ctx.size, rad = Math.PI / 180, N = 12, step = length / N, turn = Math.sign(lee - heading) || -1;
  const bark = kit.mat({ color: 0x5c5448, roughness: .8, metalness: 0 }, .6, false), root = new T.Group(), joints = [];
  const radiusAt = s => (.07 * Math.pow(1 - s, 1.25) + .011) * S, shareAt = i => Math.pow(i / (N - 1), 2);
  root.position.copy(at); root.rotation.z = (heading - 90) * rad;
  for (let i = 0, parent = root; i < N; i++) {
    const joint = new T.Group(); if (i) joint.position.y = step; parent.add(joint); joints.push(joint); parent = joint;
    const wood = new T.Mesh(new T.CylinderGeometry(radiusAt((i + 1) / N), radiusAt(i / N), step * 1.03, 8, 1, true), bark); wood.position.y = step / 2; joint.add(wood);
  }
  // A direction in a joint's own frame, as degrees turned from the way the branch runs there.
  const aim = (degrees, reach, z = 0) => V(-Math.sin(degrees * rad) * reach, Math.cos(degrees * rad) * reach, z);
  const headingAt = (i, tip) => heading + turn * tip * shareAt(i), rest = (bend[0] + bend[1]) / 2, hung = [];
  // A leaf hangs from a holder that is turned every frame so the leaf keeps streaming in the lee, whatever the branch does.
  const hang = (joint, i, spot, n) => {
    const holder = new T.Group(), r = k => rnd(n, seed + 30 + k), long = (.45 + r(1) * .45) * S, stalk = (.05 + r(2) * .06) * S;
    // Half show their paler underside; two in eight are straw.
    const blade = leaf({ tone: ['sage', 'pale', 'sage', 'straw', 'pale', 'sage', 'pale', 'straw'][n % 8], length: long, width: (.1 + r(3) * .06) * S, variant: n });
    blade.position.y = stalk; blade.rotation.set((r(4) - .5) * .5, (n % 2 ? Math.PI : 0) + (r(5) - .5) * .9, 0);
    holder.position.copy(spot); holder.add(blade, kit.line([V(), V(0, stalk, 0)], 0x6a6250, .8)); joint.add(holder);
    hung.push({ holder, blade, i, way: lee + (r(6) - .5) * 24, roll: blade.rotation.y, phase: r(7) * 6.283, quick: 5 + r(8) * 4 });
  };
  // Three side twigs, each leaving the branch at an angle and sweeping round to the lee.
  let made = 0;
  [[3, 1, .95], [6, -1, .8], [8, 1, .6]].forEach(([i, side, long], n) => {
    const toLee = lee - headingAt(i, rest), reach = long * S, z = (n % 2 ? -1 : 1) * (.12 + rnd(n, seed + 11) * .16), start = V(0, step * .5, 0);
    const middle = start.clone().add(aim(side * 38 + toLee * .3, reach * .4, z * .5)), far = middle.clone().add(aim(toLee * .8 + side * 10, reach * .35, z * .3)), tip = far.clone().add(aim(toLee + side * 3, reach * .3, z * .2));
    joints[i].add(taperedLimb(kit, [start, middle, far, tip], radiusAt(i / N) * .55, .008 * S, bark, 6));
    if (made < leaves) hang(joints[i], i, tip, made++);
    if (made < leaves - 3) hang(joints[i], i, far, made++);
  });
  // The rest along the outer half of the branch, the last one at its very tip.
  const along = Math.max(0, leaves - made);
  for (let n = 0; n < along; n++) { const i = n === 0 ? N - 1 : Math.min(N - 2, Math.round(N * .45 + (n - 1) / Math.max(1, along - 1) * N * .5)); hang(joints[i], i, V(0, n === 0 ? step : step * (.2 + rnd(n, seed + 12) * .6), (rnd(n, seed + 13) - .5) * .1), made++); }

  tick(t => {
    const lift = gust ? gust.lift(t) : .5, tip = bend[0] + (bend[1] - bend[0]) * lift;
    for (let i = 1; i < N; i++) joints[i].rotation.z = turn * tip * (shareAt(i) - shareAt(i - 1)) * rad;
    for (const item of hung) {
      // Within twelve degrees of the wind, fluttering by four about the stalk and rolling a little.
      const flutter = Math.sin(t * REAL / item.quick * 2 * Math.PI + item.phase) * (2.5 + 1.5 * lift);
      item.holder.rotation.z = (item.way + flutter - headingAt(item.i, tip)) * rad;
      item.blade.rotation.y = item.roll + Math.sin(t * REAL / (item.quick * 1.7) * 2 * Math.PI + item.phase) * .3;
    }
  });
  return root;
}
