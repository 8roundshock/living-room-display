// Fog over a scene (Combined mode; overlay rules of #620). Three bands only: a far one, a middle
// one and one low near band, at 60% of their standalone strength. The far and middle bands lie
// behind the scene's objects and veil only what is far behind them; the near band is the one
// that passes in front, so it is held to 0.04. Dropped: the birch trunks and the other bands.
// Over a holiday the bands take a tenth of that scene's colour. Fog is a soft veil, not a
// particle: on a quiet date it stays, still.
import { fogBands } from '../parts/fog-veil.js';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function overlay(kit, ctx) {
  const tone = colour => SEASONS.includes(ctx.id) ? colour : kit.mix(colour, ctx.palette[0], .1), salt = ctx.seed + 29;
  kit.stage.add(fogBands(kit, [
    { z: -10, y: .6, height: 2.9, opacity: .28 * .6, speed: -.015, stretch: 26, colour: tone(0x8fa6b8), breathe: 70, start: kit.rnd(1, salt), flip: true },
    { z: -4.5, y: -1.5, height: 2.4, opacity: .3 * .6, speed: .024, stretch: 21, colour: tone(0xa3b7c6), breathe: 56, start: kit.rnd(2, salt) },
    { z: 1.5, y: -3.9, height: 1.9, opacity: .04, speed: -.04, stretch: 17, colour: tone(0xb9c9d6), breathe: 62, start: kit.rnd(3, salt) },
  ], { middle: .3, salt }));
}
