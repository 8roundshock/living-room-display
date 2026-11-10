// Snow (design plan #618). Snowfall in deep focus down both sides of the screen: many tiny sharp
// flakes far away, fewer soft ones in focus, a handful of large out-of-focus discs close to the
// glass, and a few clear hexagonal plates that turn through the light as they fall. It settles
// as two low rim-lit drifts in the bottom corners, the left one larger, with slow sparkles on
// their crests. One quiet density: it follows the amount setting, never a light or heavy weather
// code. Every flake is a round soft dot or a plain plate: no drawn six-armed snowflake, no
// snowman, no fir, no lights. The middle of the screen and of the bottom edge stay black.
// Art rules: ../README.md.
import { snowDrift } from '../parts/snow-drift.js';
import { snowfall, snowPlates } from '../parts/snow-fall.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { stage } = kit, A = ctx.amount, S = ctx.size, seed = ctx.seed;
  stage.add(snowfall(kit, { amount: A, salt: seed }), snowPlates(kit, { count: Math.min(8, 2 + 6 * A), salt: seed }));
  // Together under 45% of the bottom edge.
  stage.add(snowDrift(kit, { side: -1, width: 4.4 * S, height: 1.15 * S, sparkles: 3, salt: seed }), snowDrift(kit, { side: 1, width: 2.8 * S, height: .7 * S, sparkles: 2, salt: seed + 5 }));
}
