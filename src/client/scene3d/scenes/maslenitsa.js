// Maslenitsa · Russia (design plan #624). A tall stack of thin, lacy, golden blini on a plate in
// the bottom-right corner, butter melting on top and honey running down the near side, one blin
// folded beside it; two small bowls to its left, red caviar in cut glass and soured cream in
// glazed clay with a wooden spoon; and the low warm light of a late-winter sun in the opposite
// bottom corner: light only, no disc, rays or face. The week is on screen for seven days, so the
// scene stays calm for all of it (coordinator decision on #624): nothing sways, falls or sparkles,
// only two thin wisps of steam. No effigy, fire, samovar or painted folk props. The table is
// seen a little from above, so the lace on top shows. Art rules: ../README.md.
import { bliniStack, foldedBlin } from '../parts/maslenitsa-blini.js';
import { clayBowl, creamSwirl, cutGlassBowl, plate, steam, woodenSpoon } from '../parts/maslenitsa-tableware.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed, unit = S * 1.07;

  // Everything on the table is one group, tipped toward the viewer and standing on the bottom edge.
  const table = new T.Group(); table.position.set(W - 2.3, -view.halfH + .78, 0); table.rotation.x = .35; table.scale.setScalar(unit); stage.add(table);

  // ---------- the blini stack on its plate ----------
  const dish = plate(kit, { radius: 1.6 }); table.add(dish);
  const stack = bliniStack(kit, { count: Math.min(24, Math.round(12 + A * 27)), drips: A > .2 ? 2 : 1, seed }); stack.group.position.y = dish.userData.top; table.add(stack.group);
  // One blin folded in quarters leans on the stack: its corner on the plate, its curved edge on the stack's shoulder.
  const folded = foldedBlin(kit, { radius: .98, seed }); folded.position.set(-1.5, dish.userData.top + .06, .42); folded.quaternion.setFromUnitVectors(V(0, 1, 0), V(.8, .56, -.22).normalize()); table.add(folded);
  const vapour = steam(kit, { height: 1.5, width: .7, strength: .15, salt: seed }); vapour.position.set(.1, dish.userData.top + stack.top + .1, 0); table.add(vapour);

  // ---------- two small bowls of different make, and a wooden spoon ----------
  const crystal = cutGlassBowl(kit, { radius: .42 }); crystal.position.set(-2.02, 0, -.12); table.add(crystal);
  // Red caviar heaped in the glass: the scene's jewel.
  {
    const count = Math.min(200, Math.round(70 + A * 220)), roe = new T.InstancedMesh(new T.SphereGeometry(1, 10, 8), kit.mat({ color: 0xd22a04, roughness: .12, clearcoat: 1, clearcoatRoughness: .06, emissive: 0xc41e00, emissiveIntensity: .34 }, .6), count), o = new T.Object3D();
    for (let i = 0; i < count; i++) {
      const k = (i + .5) / count, r = Math.sqrt(k) * crystal.userData.inner * .96, a = i * 2.39996, lift = (1 - k * k) * .11 + rnd(i, seed + 1) * .02;
      o.position.set(crystal.position.x + Math.cos(a) * r, crystal.userData.fill - .04 + lift, crystal.position.z + Math.sin(a) * r); o.scale.setScalar(.03 + rnd(i, seed + 2) * .007); o.updateMatrix(); roe.setMatrixAt(i, o.matrix);
    }
    roe.frustumCulled = false; table.add(roe);
  }
  const bowl = clayBowl(kit, { radius: .37 }); bowl.position.set(-2.62, 0, -.95); table.add(bowl);
  const cream = creamSwirl(kit, { radius: bowl.userData.inner }); cream.position.set(bowl.position.x, bowl.userData.fill, bowl.position.z); table.add(cream);
  const spoon = woodenSpoon(kit, { length: .95 }); spoon.position.set(bowl.position.x - .06, bowl.userData.fill + .09, bowl.position.z + .04); spoon.rotation.set(0, 2.55, .42); table.add(spoon);

  // ---------- a low sun in the opposite bottom corner: light, not an emblem ----------
  const core = kit.glow(0xffd27a, 2.6 * S, .5, { twinkle: .1 }), halo = kit.glow(0xf6a23a, 9.5 * S, .17, { twinkle: .1 });
  core.position.set(-W + .8, -view.halfH - .1, -3); halo.position.copy(core.position); stage.add(halo, core);
  tick(t => { const breath = 1 + Math.sin(t * .16) * .05; core.scale.setScalar(2.6 * S * breath); });
}
