// Fog (design plan #620). Pale birch trunks stand at three depths along the left edge, and one
// far trunk at the right, while slow bands of fog slide between them at several depths; the
// farthest trunk is almost gone. The bands lie mostly in the lower half and thin across the
// middle of the screen, with black between them: never one grey wash. The slowest weather
// scene and the only one with nothing falling: no particles, no lights, nothing spooky (the
// trunks are pale birches, not black trees). Each trunk runs off the top and the bottom edge;
// no ground is drawn. Art rules: ../README.md.
import { birchTrunk, taperedLimb } from '../parts/fog-birch.js';
import { fogBands } from '../parts/fog-veil.js';

// In the order they are kept as the amount falls: far, low and near first, so three depths always show.
// y and height as seen on the screen; speed in units per real second (alternate bands slide the other way, nearer ones faster).
// Opacity is a band's strength where it is thickest. It is higher than the plan's 0.05 to 0.10, chosen beside the
// picker's brighter stand-in layer: the app draws the whole layer at about a third (settings.ts), where those could not be seen.
const BANDS = [
  { z: -7, y: -1.35, height: 2.5, opacity: .3, speed: .02, stretch: 21 },
  { z: 1, y: -3.75, height: 2.1, opacity: .26, speed: -.042, stretch: 17, flip: true },
  { z: -10, y: .55, height: 2.9, opacity: .28, speed: -.015, stretch: 26, flip: true },
  { z: -2, y: -2.65, height: 2.2, opacity: .27, speed: .034, stretch: 19 },
  { z: -4.5, y: -.2, height: 1.9, opacity: .2, speed: -.026, stretch: 23 },
  { z: 3, y: -4.2, height: 1.6, opacity: .2, speed: .05, stretch: 15, flip: true },
  { z: -8.5, y: 2.5, height: 2.2, opacity: .17, speed: .017, stretch: 24 },
  { z: -5.5, y: -3.3, height: 1.8, opacity: .18, speed: -.03, stretch: 20 },
  { z: -3, y: 1.6, height: 1.7, opacity: .14, speed: .03, stretch: 22, flip: true },
  { z: -9, y: -2.2, height: 2.3, opacity: .2, speed: -.018, stretch: 25 },
];

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { V, stage, view, mix } = kit, W = view.halfW, A = ctx.amount, S = ctx.size, seed = ctx.seed;
  // Near bands are paler, far ones greyer; two carry a tenth of the registry's lilac or mint.
  const shade = (band, i) => { const base = mix(0x8fa6b8, 0xb9c9d6, Math.min(1, Math.max(0, (band.z + 10) / 13))); return i === 1 ? mix(base, 0xc9b8ea, .1) : i === 3 ? mix(base, 0xa8dcc8, .1) : base; };
  stage.add(fogBands(kit, BANDS.slice(0, Math.min(10, Math.round(4 + 6 * A))).map((band, i) => ({ ...band, colour: shade(band, i), breathe: 50 + (i * 13) % 30, start: kit.rnd(i, seed + 3) })), { middle: .3, salt: seed }));

  // Four trunks, each with its own bark, bend and depth; farther ones are dimmer, as fog would leave them.
  const near = birchTrunk(kit, { x: -W + .72, z: -1.5, radius: .2 * S, light: 1, detail: 256, salt: seed + 1 });
  stage.add(near, birchTrunk(kit, { x: -W + 1.75, z: -5, radius: .23 * S, light: .55, detail: 128, salt: seed + 2 }), birchTrunk(kit, { x: -W + 2.6, z: -9, radius: .26 * S, light: .26, detail: 128, salt: seed + 3 }), birchTrunk(kit, { x: W - 1.1, z: -8, radius: .25 * S, light: .3, detail: 128, salt: seed + 4 }));
  // Thin bare twigs fork from the nearest trunk, high up, away from the middle.
  const wood = kit.mat({ color: 0x3a3634, roughness: .9, metalness: 0 }, .35, false);
  [[2.35, 1.5, .9, .25, .032], [3.3, 1.15, .75, -.3, .026], [1.55, .8, .32, .2, .02]].slice(0, A > .12 ? 3 : 2).forEach(([y, reach, rise, z, thick]) => {
    const from = near.userData.at(y).add(V(.1 * S, 0, 0)), tip = from.clone().add(V(reach * S, rise * S, z));
    stage.add(taperedLimb(kit, [from, from.clone().lerp(tip, .35).add(V(0, rise * .12 * S, z * .2)), from.clone().lerp(tip, .7).add(V(0, -rise * .05 * S, 0)), tip], thick * S, .006 * S, wood, 6));
  });
}
