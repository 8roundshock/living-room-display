// Snow over a scene (Combined mode; overlay rules of #618). The far and middle flake bands at
// half the standalone count, and two large out-of-focus discs that keep to the lanes between the
// widgets and the corners. The flakes share the scene's 3D space and pass behind its near
// objects. Dropped: the corner drifts, and over a holiday or birthday the plate crystals, which
// could be taken for ornaments or sparkle (they stay over a plain season: Winter, and since #655
// a snowy day in Spring or Autumn too). Over a holiday the white takes a
// quarter of that scene's lightest colour. One snowfall, never two: a scene with decorative
// snow of its own leaves it out while ctx.weather is 'snow'.
import { snowfall, snowPlates } from '../parts/snow-fall.js';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function overlay(kit, ctx) {
  const { T, stage, mix } = kit, A = ctx.amount, season = SEASONS.includes(ctx.id);
  const light = colour => { const c = new T.Color(colour); return .2126 * c.r + .7152 * c.g + .0722 * c.b; }, lightest = [...ctx.palette].sort((a, b) => light(b) - light(a))[0];
  const tone = colour => season ? colour : mix(colour, lightest, .25);
  // A special occasion's layer is drawn brighter than an everyday one: the flakes are held back so none is brighter than widget text.
  stage.add(snowfall(kit, { amount: A, share: .5, dim: ctx.tier === 'special' ? .8 : 1, near: 2, colours: [tone(0xe6f1ff), tone(0xf4f8ff), tone(0xcfe0f5)], lanes: [.5, .68], salt: ctx.seed + 40 }));
  if (season) stage.add(snowPlates(kit, { count: Math.min(8, 2 + 6 * A), salt: ctx.seed + 40 }));
}
