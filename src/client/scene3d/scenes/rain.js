// Rain (design plan #617). Slow, slanted threads of rain at three depths down both sides of the
// screen (small and sharp far away, in focus in the middle distance, a few large soft ones close
// to the glass), a few beads of water clinging to the glass in the top-left corner with one that
// now and then runs down, and rings spreading on a small still pool in the bottom-right corner.
// One quiet density: it follows the amount setting, never a light or heavy weather code. No
// cloud, no bolt, no umbrella, no teardrop, no blue wash; the middle and the rest of the bottom
// edge stay black. Art rules: ../README.md.
import { paneBeads } from '../parts/rain-beads.js';
import { cornerPool } from '../parts/rain-pool.js';
import { rainFall } from '../parts/rain-threads.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { stage } = kit, A = ctx.amount, S = ctx.size, seed = ctx.seed;
  stage.add(rainFall(kit, { amount: A, salt: seed }));
  stage.add(paneBeads(kit, { count: Math.min(36, 16 + 20 * A), reach: 3.4, side: -1, seed }));
  // One new ring every 2.6 - 1.6 A real seconds: about three alive at a time.
  stage.add(cornerPool(kit, { side: 1, radius: 2.2 * S, every: 2.6 - 1.6 * A, seed }));
}
