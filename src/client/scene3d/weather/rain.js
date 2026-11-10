// Rain over a scene (Combined mode; overlay rules of #617). Threads only: the far and middle
// depth bands at half the standalone count and 70% of its strength, in the same 3D space as the
// scene, so they pass behind its near objects. Dropped: the out-of-focus near band (it would
// smear across the scene's hero), the pane beads and the pool. Over a holiday or birthday the
// threads take 35% of that scene's colour; over a plain season they keep their own.
import { rainFall } from '../parts/rain-threads.js';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function overlay(kit, ctx) {
  const tone = colour => SEASONS.includes(ctx.id) ? colour : kit.mix(colour, ctx.palette[0], .35);
  kit.stage.add(rainFall(kit, { amount: ctx.amount, share: .5, dim: .7, near: false, colours: [tone(0xa9cdea), tone(0xcfe3f5), tone(0x8fb8dc)], salt: ctx.seed + 17 }));
}
