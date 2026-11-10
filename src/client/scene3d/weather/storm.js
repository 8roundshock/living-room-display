// A storm over a scene (Combined mode; overlay rules of #619; today only Summer lists storms).
// Driven rain in the far and middle depth bands at 60% of the standalone count, and a reduced
// cloud of five volumes in the top-left corner, which Summer leaves free, with the inner glow at
// 60% of its peak and no echo. Dropped: the travelling sheets and the near rain band. The glow
// is slow and soft, inside the cloud, with no bolt (coordinator decision on #619). Over a
// holiday or birthday the rain takes 35% of that scene's colour; the cloud stays slate.
import { rainFall } from '../parts/rain-threads.js';
import { stormCloud } from '../parts/storm-cloud.js';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function overlay(kit, ctx) {
  const tone = colour => SEASONS.includes(ctx.id) ? colour : kit.mix(colour, ctx.palette[0], .35);
  kit.stage.add(stormCloud(kit, { count: 5, ragged: 0, side: -1, length: 5.6, hang: 2, peak: .68 * .6, echo: false, salt: ctx.seed + 23 }));
  kit.stage.add(rainFall(kit, { amount: ctx.amount, share: 1.3 * .6, dim: .8, near: false, colours: [tone(0x8fa6d8), tone(0xb9c6ec), tone(0x8fa6d8)], lean: 16, spread: 2, breathe: [3, 25], stretch: 1.25, haste: 1.2, salt: ctx.seed + 23 }));
}
