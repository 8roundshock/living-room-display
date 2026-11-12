// Orthodox Christmas (design plan #623), 7 January only. A carollers' star stands at the right
// edge: hand-made on a sieve hoop, its paper drum lit from inside by a candle, eight paper rays
// with foil edges, ribbons tied under it, on a pole planted in a drift of snow. The first star of
// the evening answers it from the opposite upper corner, and a little snow falls. It is the only
// star in the Russian family (the New Year tree carries a spire) and it is not a tree topper.
// No tree, bauble, wreath or gift; no picture on the drum. Art rules: ../README.md.
import { carolStar, firstStar, hangingRibbons, snowDrift } from '../parts/orthodox-christmas-star.js';
import { weatherOver } from '../parts/wind-underneath.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, unit = S * 1.14;
  // The weather over the scene (#646): wind blows the ribbons to the left and doubles the swing of the pole and the turn
  // of the star, and carries the snow left; rain, a storm or real snow leave the scene's own snow out; fog dims the first
  // star by 40% and takes the glints on the drift away.
  const weather = weatherOver(kit, ctx);

  // ---------- the star on its pole, right edge ----------
  const foot = V(W - 1.05, -view.halfH - .2, 0), centre = V(W - 2.05, 1.35, 0), lean = Math.atan2(foot.x - centre.x, centre.y - foot.y), height = centre.distanceTo(foot);
  const mast = new T.Group(); mast.position.copy(foot); mast.rotation.z = lean; stage.add(mast);
  const peeled = kit.mat({ color: 0xdccba2, roughness: .75 }, .35, false);
  // The pole ends in a wooden collar at the bottom of the hoop: nothing crosses the lit drum.
  const reach = height - .6 * unit, pole = new T.Mesh(new T.CylinderGeometry(.034, .042, reach + .3, 12), peeled); pole.position.set(0, (reach - .3) / 2, -.02); mast.add(pole);
  const collar = new T.Mesh(new T.CylinderGeometry(.06 * unit, .05 * unit, .14 * unit, 12), kit.mat({ color: 0xc9b48a, roughness: .8 }, .3, false)); collar.position.set(0, reach - .05 * unit, -.02); mast.add(collar);
  const star = carolStar(kit), turned = new T.Group(); star.group.scale.setScalar(unit); turned.position.set(0, height, 0); turned.rotation.y = -.32; turned.add(star.group); mast.add(turned);
  // Three ribbons tied to the pole under the drum, each a different colour and length; they hang plumb while the pole leans.
  const ribbons = hangingRibbons(kit, [[0xc8363f, 1.5 * unit], [0xe0b85a, 1.1 * unit], [0xa9bfe0, .85 * unit]].slice(0, A > .2 ? 3 : 2), { width: .14 * unit, salt: ctx.seed });
  ribbons.position.set(0, height - 1.5 * unit, .03); mast.add(ribbons);
  tick(t => {
    mast.rotation.z = lean + weather.sway(Math.sin(t * .3) * .007, 0); star.wheel.rotation.z = Math.sin(t * .22) * .1 * weather.wind.sway;
    ribbons.rotation.z = -mast.rotation.z + weather.sway(Math.sin(t * .4 + 1) * .03, -1); ribbons.rotation.x = Math.sin(t * .27) * .03 * weather.wind.sway;
    star.lamp.intensity = 2 * (1 + .06 * Math.sin(t * 1.1));
  });

  // ---------- snow: the drift the pole is planted in ----------
  const drift = snowDrift(kit, { width: 4.4 * unit, depth: 2, height: .78 * unit, salt: ctx.seed }); drift.position.set(W - 1.2, -view.halfH - .06, -.1); stage.add(drift);
  // A few grains catch the candle and the star.
  for (let i = 0; i < Math.min(8, Math.round(2 + A * 12)); i++) { const glint = kit.glow(i % 2 ? 0xffe2b0 : 0xeaf2ff, .16 + rnd(i, ctx.seed + 3) * .1, .5, { twinkle: .7 }); glint.position.set(W - 3 + rnd(i, ctx.seed + 1) * 2.8, -view.halfH + .18 + rnd(i, ctx.seed + 2) * .4, .5); glint.visible = weather.glints; stage.add(glint); }

  // ---------- the first star, top-left corner: steady, and the only star in the sky ----------
  const first = firstStar(kit, .95 * S); first.position.set(-W + 1.15, 3.7, -1); first.userData.o *= weather.far; stage.add(first);

  // ---------- a slow, thin fall of snow; real snow has its own overlay ----------
  // One snowfall, never two, and no snow with the rain (#646): the scene's own snow stays built and hidden.
  const own = kit.snow(10 + A * 66, { size: .15, opacity: .75, drift: weather.carry }); own.visible = weather.ownSnow; stage.add(own);
}
