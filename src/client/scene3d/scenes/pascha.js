// Orthodox Easter (design plan #625). The scene is on screen from Pussy Willow Sunday to Pascha,
// eight days, so it is low-key: a tall kulich under its white glaze stands on a plate on a folded
// linen napkin in the bottom-left corner with five plain dyed eggs, red and onion-skin maroon,
// at its foot; across from it, pussy-willow twigs stand in an unglazed clay jug at the right
// edge, thin and airy. No letters, crosses, candles, patterned or pastel eggs, rabbits, baskets
// or blossom. The brighter Pascha Sunday of the plan waits for the day-of lift (#632).
// Art rules: ../README.md.
import { plate } from '../parts/maslenitsa-tableware.js';
import { dyedEgg, kulich, linenNapkin } from '../parts/pascha-kulich.js';
import { clayJug, willowTwigs } from '../parts/pascha-willow.js';
import { weatherOver } from '../parts/wind-underneath.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed, unit = S * 1.18;
  // The weather over the scene (#646): wind leans the willow twigs left in their jug and widens their stir. Nothing here
  // falls or is backlit; in fog the kit stops the twinkle.
  const weather = weatherOver(kit, ctx);

  // ---------- the kulich on its plate and napkin, bottom-left corner, seen a little from above ----------
  // The napkin lies a little higher, so the eggs on it are not cut by the float's zoom (#675).
  const table = new T.Group(); table.position.set(-W + 2.05, -view.halfH + .62, 0); table.rotation.x = .24; table.scale.setScalar(unit); stage.add(table);
  const napkin = linenNapkin(kit, { width: 3.1, depth: 2.1, seed }); napkin.rotation.y = .16; napkin.position.set(.15, 0, .1); table.add(napkin);
  const dish = plate(kit, { radius: 1.1, colour: 0xf6f3ec, line: 0xdcd6c8 }); dish.position.y = .03; table.add(dish);
  const bread = kulich(kit, { sprinkles: Math.min(110, 30 + A * 170), seed }); bread.position.set(-.08, dish.position.y + dish.userData.top, -.12); table.add(bread);

  // ---------- five eggs, each dyed and lying differently: three on the plate, two on the napkin ----------
  const rest = dish.position.y + dish.userData.top + .125, cloth = .16;
  // [shell, x, y, z, turn about the vertical, tilt of its long axis]
  const EGGS = [['red', .7, rest, .38, .5, 1.42], ['skin-dark', -.74, rest, .3, -.9, 1.5], ['marble', .1, rest + .005, .78, 1.9, 1.62], ['skin-light', 1.38, cloth, .5, -.4, 1.5], ['scarlet', -.55, cloth, .72, 1.1, 1.38]];
  EGGS.slice(0, Math.max(3, Math.round(2 + A * 13))).forEach(([shell, x, y, z, turn, tilt], i) => {
    const egg = dyedEgg(kit, { shell, size: 1.04 - (i % 3) * .04, salt: seed + i * 13 }); egg.position.set(x, y, z); egg.rotation.set(0, turn, tilt, 'YZX'); table.add(egg);
  });

  // ---------- pussy willow in a clay jug, right edge ----------
  const depth = -.3, jug = clayJug(kit, { height: 1.3 }), stand = new T.Group(); stand.position.set(W - 1.15, -view.halfHAt(depth) - .02, depth); stand.scale.setScalar(unit); stand.add(jug); stage.add(stand);
  // [lean sideways, lean in depth, length, curl]: seven twigs, none alike, fanning a little toward the room.
  const BENDS = [[-.2, .05, 3.45, .1], [.06, -.08, 3.1, .07], [-.34, .1, 2.75, .12], [.16, .12, 2.5, .09], [-.08, -.14, 3.9, .08], [-.46, -.04, 2.3, .1], [.24, -.02, 2.9, .06]];
  const willow = willowTwigs(kit, { bends: BENDS.slice(0, Math.max(3, Math.round(2 + A * 21))), seed, inside: .75 }); willow.group.position.y = jug.userData.mouth; stand.add(willow.group);
  willow.twigs.forEach((twig, i) => { const phase = rnd(i, seed + 5) * 6; tick(t => { twig.rotation.z = weather.sway(Math.sin(t * .45 + phase) * .008, 1); twig.rotation.x = Math.sin(t * .31 + phase) * .006 * weather.wind.sway; }); });
}
