// Storms (design plan #619). A dark, slow cloud mass fills the top-left corner and thins along
// the top edge, lit from inside now and then by a soft, slow glow, with wind-slanted rain under
// it at three depths and, once in a while, a wider sheet of heavier rain crossing the screen.
// Coordinator decision on #619: the glow is slow (1.6 s to rise) and soft, stays inside the
// cloud, is never brighter than widget text, and has no bolt; nothing outside the cloud
// brightens. No pool, no beads (they are Rain's), no bent trees or debris: decoration, not a
// warning. The bottom edge and the middle stay black. Art rules: ../README.md.
import { rainFall } from '../parts/rain-threads.js';
import { stormCloud } from '../parts/storm-cloud.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { stage } = kit, A = ctx.amount, seed = ctx.seed;
  stage.add(stormCloud(kit, { count: Math.min(18, 8 + 10 * A), side: -1, length: 7.5, hang: 2.6, salt: seed }));
  // Rain's threads, driven: leaning 16 degrees, a third more of them, longer, faster and cooler.
  stage.add(rainFall(kit, { amount: A, share: 1.3, dim: .92, colours: [0x8fa6d8, 0xb9c6ec, 0x8fa6d8], lean: 16, spread: 2, breathe: [3, 25], stretch: 1.25, haste: 1.2, sheets: true, salt: seed }));
}
