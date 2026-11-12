// Thanksgiving · Canada (design plan #607). A harvest still life in glass: a woven horn of
// plenty lying on the bottom edge in the left corner with orchard fruit spilling from its mouth
// (two apples that differ, a pear, a bunch of dark grapes, a few cranberries), and a bound
// sheaf of bearded wheat standing in the right corner. Nothing falls and almost nothing moves.
// No pumpkins (Halloween may start the next day), no maple or falling leaves, no table or cloth.
// The plan's dried flint corn hung from the top edge belongs to Thanksgiving Monday only and
// waits for the day-of step (#632, #639). The middle stays empty. Art rules: ../README.md.
import { horn } from '../parts/thanksgiving-horn.js';
import { apple, pear, grapes, cranberries } from '../parts/thanksgiving-fruit.js';
import { sheaf } from '../parts/thanksgiving-wheat.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { V, rnd, stage, view } = kit, W = view.halfW, A = ctx.amount, seed = ctx.seed;
  // The plan gives on-screen sizes at the everyday size (0.85); U carries the tier's size from there.
  const U = ctx.size / .85;
  // Everything rests a little below the bottom edge at its own depth, so the stage's slow drift never lifts it off the edge.
  const floor = z => -view.halfHAt(z) - .06, rest = (object, x, z, height) => { object.position.set(x, floor(z) + height + .28, z); stage.add(object); return object; };   // fruit sits clear of the band the float's zoom crops (#675)

  // ---------- the horn of plenty, lying on the bottom edge, its mouth toward the middle ----------
  const basket = horn(kit, { rise: view.halfH / view.depth }); basket.scale.setScalar(U); basket.position.set(-W + 3.75, floor(0), 0); stage.add(basket);
  const warm = kit.glow(0xffb060, 6.5 * U, .1, { twinkle: .06 }); warm.position.set(-W + 3.3, -view.halfH + .3, -1.6); stage.add(warm);

  // ---------- the spill: no two neighbours alike ----------
  // A golden apple still inside the mouth, grapes draped over the lip, a red apple on the edge and a pear leaning on it.
  const golden = rest(apple(kit, { radius: .37 * U, skin: 'gold', salt: seed + 3 }), -W + 3.42, .5, .5 * U); golden.rotation.set(.45, .3, -.6);
  const bunch = grapes(kit, { size: .8 * U, salt: seed + 5 }); bunch.position.set(-W + 3.78, floor(1.1) + .66 * U, 1.1);
  bunch.quaternion.setFromUnitVectors(V(0, -1, 0), V(.8, -.42, .43).normalize()); bunch.scale.z = .86; stage.add(bunch);
  const red = rest(apple(kit, { radius: .43 * U, skin: 'red', salt: seed + 1 }), -W + 4.95, .5, .37 * U); red.rotation.set(.18, 1.9, .2);
  const leaning = rest(pear(kit, { radius: .34 * U, salt: seed + 7 }), -W + 5.62, .1, .33 * U); leaning.rotation.set(.1, .5, .3);
  // Cranberries rolled out in a loose scatter, never a row, thinning toward the middle.
  const BERRIES = [[4.46, 1.56, .09], [4.64, 1.38, .078], [5.36, 1.62, .094], [6.14, 1.3, .086], [6.3, .5, .074], [6.86, 1.1, .07], [3.2, 1.75, .08]];
  stage.add(cranberries(kit, BERRIES.slice(0, Math.max(3, Math.round(3 + A * 17))).map(([dx, z, radius], i) => [-W + dx + (rnd(i, seed + 9) - .5) * .08, floor(z) + radius * U * .85, z, radius * U])));

  // ---------- the wheat sheaf, standing in the other corner, leaning a little inward ----------
  const wheat = sheaf(kit, { stalks: 28 + A * 75, salt: seed + 11 }); wheat.scale.setScalar(U); wheat.position.set(W - 1.55, floor(-.2), -.2); wheat.rotation.z = .105; stage.add(wheat);
  const straw = kit.glow(0xf0b23a, 4.5 * U, .07, { twinkle: .06 }); straw.position.set(W - 1.6, -view.halfH + 1.6, -1.8); stage.add(straw);
}
