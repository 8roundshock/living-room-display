// Women's Day · Russia (design plan #626), 6 to 8 March. A generous spray of mimosa, the flower
// of the day, stands in a clear glass vase in the bottom-left corner and rises up the left side:
// small fluffy yellow balls in loose panicles, feathery grey-green leaves, the stems visible
// through the glass and the water. Five tulips, tied with a narrow lilac ribbon, lie along the
// bottom edge on the other side: coral, pink and cream, none yellow, each at its own stage from
// bud to open. A few blossom balls have dropped at the foot of the vase and a few drift down
// under the spray. No numeral, text, hearts or gift boxes. Art rules: ../README.md.
import { glassVase, mimosaSpray } from '../parts/mimosa-spray.js';
import { ribbonTie, tulip } from '../parts/mimosa-tulip.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed, unit = S * 1.07;

  // ---------- the mimosa in its vase, bottom-left corner, leaning a little toward the room ----------
  const depth = -.2, corner = new T.Group(); corner.position.set(-W + 1.75, -view.halfHAt(depth) - .02, depth); corner.scale.setScalar(unit); stage.add(corner);
  const vase = glassVase(kit, { height: 1.7, radius: .42 });
  // [lean sideways, lean in depth, length above the vase, droop]: five stems, the longest nearly upright.
  const STEMS = [[.03, .02, 4.15, .5], [.27, .1, 3.7, .85], [-.2, -.1, 3.4, .7], [.46, -.06, 3.05, 1], [-.3, .12, 2.6, .75]];
  const spray = mimosaSpray(kit, { stems: STEMS.slice(0, Math.max(3, Math.round(2 + A * 10))), panicles: Math.min(8, 2 + A * 13), leaves: Math.min(20, Math.round(5 + A * 30)), inside: 1.5, seed });
  spray.group.position.y = vase.userData.mouth; corner.add(spray.group, vase);
  spray.stems.forEach((stem, i) => { const phase = rnd(i, seed + 3) * 6; tick(t => { stem.rotation.z = Math.sin(t * .45 + phase) * .009; stem.rotation.x = Math.sin(t * .33 + phase) * .006; }); });

  // ---------- shed blossom: a few balls at the foot of the vase, a few drifting down under the spray ----------
  const o = new T.Object3D(), fallen = spray.ball(Math.min(9, Math.max(3, Math.round(1 + A * 20))));
  for (let i = 0; i < fallen.count; i++) { const size = .045 + rnd(i, seed + 5) * .025; o.position.set(-.8 + i * .34 + rnd(i, seed + 6) * .2 + (i > 2 ? .5 : 0), size + .03, -.55 + rnd(i, seed + 7) * .5); o.scale.setScalar(size); o.updateMatrix(); fallen.setMatrixAt(i, o.matrix); }
  corner.add(fallen);
  if (!ctx.quiet && A > .04) {
    const drifting = spray.ball(Math.min(12, Math.round(A * 30))), top = 4.6; corner.add(drifting);
    tick(t => {
      for (let i = 0; i < drifting.count; i++) {
        const fall = (rnd(i, seed + 8) + t * (.07 + rnd(i, seed + 9) * .03)) % 1, phase = rnd(i, seed + 10) * 6, size = .04 + rnd(i, seed + 11) * .022;
        o.position.set(-.7 + rnd(i, seed + 12) * 2.9 + Math.sin(t * .5 + phase) * .12, top * (1 - fall) * (.5 + rnd(i, seed + 13) * .5) + size, -.3 + rnd(i, seed + 14) * .8); o.scale.setScalar(size * Math.min(1, fall * 12)); o.updateMatrix(); drifting.setMatrixAt(i, o.matrix);
      }
      drifting.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------- five tulips tied with a ribbon, lying along the bottom edge on the right ----------
  const bunch = new T.Group(); bunch.position.set(W - 3.45, -view.halfH + .42, .1); bunch.scale.setScalar(unit); stage.add(bunch);
  // [colour, how open, stem length, bend, leaves, lift of the head, fan in depth, turn on its own stem, nudge]
  // The colours are painted deeper than they read: the light lifts coral, pink and cream to the plan's tints.
  const TULIPS = [[0xd6223c, .06, 3.2, .1, 1, -.03, -.12, .4, 0], [0xe4608e, .5, 2.5, -.08, 1, .08, .16, 2.2, .03], [0xe9d8b4, .92, 3.35, .1, 1, .2, .3, 4.1, -.03], [0xd6223c, .42, 2.3, .06, 1, .33, -.26, 1.3, .05], [0xe4608e, 0, 2.45, -.08, 1, .56, .05, 5.2, -.05]];
  TULIPS.slice(0, A > .2 ? 5 : 3).forEach(([colour, open, length, bend, leaves, lift, fan, spin, nudge], i) => {
    const holder = new T.Group(), lying = new T.Group(), flower = tulip(kit, { colour, open, length, bend, leaves, size: 1.25, salt: seed + i * 7 });
    holder.rotation.y = fan; holder.position.set(0, nudge, nudge * .8); lying.rotation.z = -Math.PI / 2 + lift; flower.rotation.y = spin; flower.position.y = -.82; lying.add(flower); holder.add(lying); bunch.add(holder);
  });
  const tie = ribbonTie(kit, { radius: .15, width: .14, tails: [.75, .55] }); tie.rotation.z = -Math.PI / 2 + .1; bunch.add(tie);
}
