// The top of a sparse spruce (#622): a trunk with whorls of boughs, the way a young spruce grows,
// seen from the apex down. Short blue-green needles, clear gaps between the whorls, wood that
// shows, tips that turn up. The Western Christmas scene keeps its dense long-needled fir edge.
import { tubes } from './new-year-tree-tubes.js';

/**
 * A spruce top standing on y = 0, the trunk continuing below it. `whorls` are [height, radius]
 * from the bottom up. Returns { group, boughs, top }: each bough is { pt(t), whorl, angle, length }
 * with pt(0-1) a point along its spine in the group's own units, for hanging things on it; `top`
 * is the tip of the bare leader.
 */
export function spruceTop(kit, { seed = 0, whorls = [[.2, 1.9], [1, 1.5], [1.75, 1.1], [2.4, .75], [2.95, .45]], leader = .42, front = 200 } = {}) {
  const { T, V, C, rnd } = kit, group = new T.Group(), N = kit.needles(), wood = tubes(kit, 5), trunk = tubes(kit, 10), boughs = [];
  const DARK = C(0x1c5638), LIGHT = C(0x4c9a66), BARK = C(0x6b4a32), SHOOT = C(0x9a7a50), p = V(), d = V();

  /** Needles all round a twig from a to b, leaning toward its tip. `fresh` (0-1) lightens them, as at the end of a bough. */
  function sprig(a, b, needle, fresh, salt) {
    const dir = b.clone().sub(a), length = dir.length(); dir.normalize();
    const ref = Math.abs(dir.y) > .9 ? V(1, 0, 0) : V(0, 1, 0), u = V().crossVectors(dir, ref).normalize(), v = V().crossVectors(dir, u).normalize(), steps = Math.max(3, Math.round(length / .03));
    for (let i = 0; i < steps; i++) {
      const t = i / steps; p.copy(a).addScaledVector(dir, length * t);
      for (let k = 0; k < 4; k++) {
        const n = i * 4 + k, phi = i * 2.4 + salt + k * 1.57, tilt = .78 + rnd(n, salt) * .42, shade = Math.min(1, fresh * .55 + rnd(n, salt + 1) * .5 + t * .12);
        d.copy(dir).multiplyScalar(Math.cos(tilt)).addScaledVector(u, Math.sin(tilt) * Math.cos(phi)).addScaledVector(v, Math.sin(tilt) * Math.sin(phi)).normalize();
        N.add(p, d, needle * (1 - .25 * t) * (.8 + rnd(n, salt + 2) * .4), DARK.r + (LIGHT.r - DARK.r) * shade, DARK.g + (LIGHT.g - DARK.g) * shade, DARK.b + (LIGHT.b - DARK.b) * shade);
      }
    }
  }
  /** One bough: a spine that sags a little and turns up over its outer third, with side twigs in a flat spray. */
  function bough(base, angle, length, slope, sag, lift, needle, salt) {
    const out = V(Math.sin(angle), 0, Math.cos(angle)), side = V(Math.cos(angle), 0, -Math.sin(angle));
    const pt = t => base.clone().addScaledVector(out, length * t * (1 - .05 * t)).add(V(0, length * (slope * t - sag * Math.sin(Math.PI * Math.min(1, t * 1.15)) + lift * t * t * t), 0));
    const spine = []; for (let i = 0; i <= 8; i++) spine.push(pt(i / 8));
    wood.add(spine, .011 + length * .011, .004, BARK, SHOOT);
    for (let i = 0; i < 8; i++) sprig(spine[i], spine[i + 1], needle, i / 8, salt + i);
    const twigs = Math.max(2, Math.round(length / .24));
    for (let j = 1; j <= twigs; j++) {
      const t = (j + .2) / (twigs + 1.1), sign = j % 2 ? 1 : -1, reach = length * .46 * (1 - t * .6) + .1, a = pt(t), ahead = pt(Math.min(1, t + .08)).sub(a).normalize();
      const dir = ahead.clone().multiplyScalar(.72).addScaledVector(side, sign * .68).add(V(0, -.08, 0)).normalize(), b = a.clone().addScaledVector(dir, reach).add(V(0, reach * reach * .16, 0));
      wood.add([a, a.clone().lerp(b, .5).add(V(0, -reach * .02, 0)), b], .007, .003, BARK, SHOOT);
      sprig(a, b, needle * .92, t, salt + j * 7);
      if (reach > .4) for (let k = 1; k <= 2; k++) {
        const from = a.clone().lerp(b, k / 3 + .04), turn = (k % 2 ? dir.clone().multiplyScalar(.7).addScaledVector(ahead, .58) : dir.clone().multiplyScalar(.7).addScaledVector(side, sign * .55).addScaledVector(ahead, -.12)).normalize();
        sprig(from, from.clone().addScaledVector(turn, reach * .42), needle * .85, Math.min(1, t + .3), salt + j * 7 + k * 3);
      }
    }
    return pt;
  }

  const top = whorls[whorls.length - 1][0] + leader, tiers = whorls.length;
  const lean = y => V(Math.sin(y * 1.3 + seed) * .025, y, Math.cos(y * 1.1 + seed) * .02);
  const stem = []; for (let i = 0; i <= 16; i++) stem.push(lean(-.7 + (top + .7) * i / 16));
  trunk.add(stem, .11, .026, BARK, SHOOT);
  whorls.forEach(([height, radius], w) => {
    const h = w / Math.max(1, tiers - 1), count = w === tiers - 1 ? 4 : 5, span = front * Math.PI / 180;
    for (let j = 0; j < count; j++) {
      const b = w * 8 + j, angle = (-.5 + (j + .5 + (w % 2 ? .22 : -.22) + (rnd(b, seed + 1) - .5) * .35) / count) * span, length = radius * (.86 + rnd(b, seed + 2) * .26);
      const pt = bough(lean(height + (rnd(b, seed + 3) - .5) * .1), angle, length, -.04 + h * .5 + (rnd(b, seed + 4) - .5) * .06, .1 - h * .08, .17 - h * .1, .145 - h * .03, seed + 40 + b * 13);
      boughs.push({ pt, whorl: w, angle, length });
    }
    // One or two short shoots on the trunk between whorls, so the tiers are not a diagram.
    if (w < tiers - 1) for (let j = 0; j < 2; j++) {
      const b = w * 8 + 6 + j, between = height + (whorls[w + 1][0] - height) * (.38 + j * .3), angle = (rnd(b, seed + 5) - .5) * 2.8;
      bough(lean(between), angle, radius * (.2 + rnd(b, seed + 6) * .12), .25 + h * .3, .02, .1, .12, seed + 300 + b * 11);
    }
  });
  // The young trunk carries needles of its own above the middle whorl; the last stretch of the leader is bare for the topper.
  const mid = whorls[Math.floor(tiers / 2)][0];
  for (let i = 0; i < 6; i++) { const a = mid + (top - .2 - mid) * i / 6, b = mid + (top - .2 - mid) * (i + 1) / 6; sprig(lean(a), lean(b), .11, i / 6, seed + 500 + i); }
  group.add(trunk.mesh(kit.mat({ color: 0xffffff, vertexColors: true, roughness: .85 }, .3, false)), wood.mesh(kit.mat({ color: 0xffffff, vertexColors: true, roughness: .8 }, .3, false)), N.mesh());
  return { group, boughs, top: lean(top) };
}
