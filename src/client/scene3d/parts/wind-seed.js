// Downy seeds on the wind (Wind, #621): a small seed hanging under a tuft of fine hairs, sailing
// from the right edge to the left at one of three depths. Far ones are small and sharp, near ones
// large and soft. The seed trails behind its tuft; each tuft has its own number of hairs, size and
// tilt. No drawn wind lines: the wind shows only in what it carries.

/** The plan gives speeds in real seconds; the scene clock runs at an eighth of real time (README). */
const REAL = 8;
// Depth range, speed in units per real second, size, strength of the hairs.
const TIERS = { far: { z: [-9, -4], speed: [.1, .16], size: .95, hair: .5 }, middle: { z: [-3, .5], speed: [.2, .3], size: 1, hair: .5 }, near: { z: [2, 6], speed: [.4, .55], size: 1.1, hair: .22 } };

/**
 * count seeds, as one group. depths: the tiers they take in turn ('far', 'middle', 'near').
 * lanes: heights as seen on the screen plane, taken in turn. behind: keep every seed behind the
 * plane the scene's own objects stand on (for an overlay). gust: from wind-gust.js.
 * hub: colour of the faint light where the hairs meet. Nothing on quiet dates.
 */
export function downySeeds(kit, { count, depths = ['far', 'middle', 'far', 'near', 'middle', 'far'], lanes = [3.15, -3.25, 3.7, -3.75, 2.95, -3], behind = false, gust, hub = 0xeef0e6, salt = 0 }) {
  const { T, V, C, rnd, view, tick, ctx } = kit, group = new T.Group(), n = Math.round(count), S = ctx.size;
  if (ctx.quiet || n < 1) return group;
  const body = kit.mat({ color: 0x6b5a48, roughness: .7, metalness: 0 }, .5, false);
  for (let i = 0; i < n; i++) {
    const r = k => rnd(i, salt + 50 + k), name = depths[i % depths.length], tier = TIERS[name] ?? TIERS.middle, z = Math.min(behind ? -1.4 : 9, tier.z[0] + r(1) * (tier.z[1] - tier.z[0])), k = 1 - z / view.depth;
    const size = tier.size * (.78 + (i * .37 % 1) * .5) * S, seed = new T.Group(), hairs = 14 + Math.floor(r(2) * 7), stalk = (.2 + r(3) * .1) * size, points = [];
    // The tuft: fine hairs in a shallow cone, each drooping a little toward its end.
    for (let h = 0; h < hairs; h++) {
      const around = (h + r(10 + h) * .7) / hairs * 6.283, open = (56 + rnd(h, salt + i * 7 + 4) * 22) * Math.PI / 180, long = (.18 + rnd(h, salt + i * 7 + 5) * .22) * size;
      const out = V(Math.sin(open) * Math.cos(around), Math.cos(open), Math.sin(open) * Math.sin(around)), bend = out.clone().multiplyScalar(long * .55), tip = out.clone().multiplyScalar(long).add(V(0, -long * .14, 0));
      points.push(V(), bend, bend, tip);
    }
    points.push(V(), V(0, -stalk, 0));
    const tuft = new T.LineSegments(new T.BufferGeometry().setFromPoints(points), new T.LineBasicMaterial({ color: C(0xeef0e6), transparent: true, opacity: tier.hair }));
    const grain = new T.Mesh(kit.ballGeo, body); grain.scale.set(.02 * size, .05 * size, .02 * size); grain.position.y = -stalk - .045 * size;
    const light = kit.glow(hub, .4 * size, .08, { twinkle: .15 }); seed.add(tuft, grain, light);
    // Close to the glass the tuft is out of focus: its hairs are faint inside a soft haze.
    if (name === 'near') { const haze = kit.glow(hub, 1.5 * size, .1, { twinkle: .1 }); haze.position.y = .05 * size; seed.add(haze); }
    seed.rotation.order = 'ZYX'; group.add(seed);
    const span = view.halfWAt(z) * 2 + 3, speed = (tier.speed[0] + r(6) * (tier.speed[1] - tier.speed[0])) * REAL, lane = lanes[i % lanes.length] * k, start = r(7) * span, rise = (15 + r(8) * 10) / REAL, phase = r(9) * 6.283, lean = .45 + r(11) * .3;
    tick(t => {
      const gone = (start + speed * (gust ? gust.travel(t) : t)) % span, sway = Math.sin(t / rise * 2 * Math.PI + phase);
      seed.position.set(span / 2 - gone, lane + sway * .4, z);
      // The seed trails behind its tuft, rocking a little, and the tuft turns slowly about its own stalk.
      seed.rotation.set(.25 * Math.sin(t * .7 + phase), t * (.25 + r(12) * .3) + phase, lean + .14 * Math.cos(t / rise * 2 * Math.PI + phase));
    });
  }
  return group;
}
