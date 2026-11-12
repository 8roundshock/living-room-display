// Easter · Canada (design plan #611). A potted white Easter lily in the left corner, in bloom:
// three leafy stems in a plain celadon pot with four trumpets at different stages and three
// buds; and, across from it, a twig nest wedged in the fork of a budding branch that grows in
// from the right edge, holding four plain eggs that differ in colour and finish (speckled
// blue, satin blush, pearl butter, lilac glass). Soft and pale, nothing hops, hatches or falls.
// No red or patterned eggs, bread, pussy willow or candles (Pascha), no blossom or petals
// (Spring), no bunnies, chicks, baskets or crosses. The plan's daffodils belong to Easter
// Sunday and Monday only and wait for the day-of step (#632, #639). The middle stays empty.
// Art rules: ../README.md.
import { lily } from '../parts/easter-lily.js';
import { branch } from '../parts/easter-branch.js';
import { nest } from '../parts/easter-nest.js';
import { weatherOver } from '../parts/wind-underneath.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { stage, view, tick } = kit, W = view.halfW, A = ctx.amount, seed = ctx.seed;
  // The plan gives on-screen sizes at the everyday size (0.85); U carries the tier's size from there.
  const U = ctx.size / .85;
  // The weather over the scene (#646): wind leans the lily's trumpets left and widens their nod and the branch's stir;
  // rain and a storm halve the pale light behind the lily, fog dims it by 40%. Nothing here falls; the nest stays still.
  const weather = weatherOver(kit, ctx);

  // ---------- the lily: its pot stands on the bottom edge ----------
  const plant = lily(kit, { salt: seed + 1, weather }); plant.scale.setScalar(U); plant.position.set(-W + Math.max(2.5, W * .3), -view.halfH - .08, 0); plant.rotation.y = .25; stage.add(plant);
  const pale = kit.glow(0xf6f3ea, 5.5 * U, .06 * weather.backlight, { twinkle: .06 }); pale.position.set(-W + 2.3, -1.2, -2.2); stage.add(pale);

  // ---------- the branch from the right edge, forking toward the top edge, and the nest in its fork ----------
  const fork = [W - 2.4, 2.45], limb = branch(kit, { buds: 6 + A * 34, salt: seed + 3 }); limb.scale.setScalar(U); limb.position.set(fork[0], fork[1], 0); stage.add(limb);
  const EGGS = [{ length: .4, colour: 0x86c9cd, finish: 'speckled' }, { length: .36, colour: 0xeeb0b8, finish: 'satin' }, { length: .42, colour: 0xf7d674, finish: 'pearl' }, { length: .34, colour: 0xc9aaec, finish: 'glass' }];
  const home = nest(kit, { twigs: 100 + A * 500, eggs: EGGS.slice(0, Math.max(2, Math.round(2 + A * 8))), salt: seed + 5 });
  home.scale.setScalar(U); home.position.set(fork[0] + .04, fork[1] + .36 * U, .28); home.rotation.set(.64, 0, -.05); stage.add(home);
  // The twigs stir very slightly about the fork; the nest does not move.
  tick(t => { limb.rotation.z = weather.sway(Math.sin(t * .3) * .005, 0); });
}
