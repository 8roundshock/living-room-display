// Wind over a scene (Combined mode; overlay rules of #621). Wind shows mainly through the scene
// underneath (its own cloth, cords and hanging things; a scene reads ctx.weather === 'wind').
// The overlay adds only a few downy seeds, half the standalone count, at the far and middle
// depths and always behind the scene's own objects, sailing right to left on the shared gust.
// Dropped: the bowed branch, the loose leaves, the near seeds and the backlight. Over a holiday
// the faint light at each tuft's hub takes that scene's lightest colour.
import { windGust } from '../parts/wind-gust.js';
import { downySeeds } from '../parts/wind-seed.js';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function overlay(kit, ctx) {
  const { T, stage } = kit, salt = ctx.seed + 31;
  const light = colour => { const c = new T.Color(colour); return .2126 * c.r + .7152 * c.g + .0722 * c.b; }, lightest = [...ctx.palette].sort((a, b) => light(b) - light(a))[0];
  stage.add(downySeeds(kit, { count: Math.max(2, Math.round((4 + 9 * ctx.amount) / 2)), depths: ['far', 'middle'], behind: true, lanes: [3, -3.1, 3.8, -3.85], gust: windGust(kit, { salt }), hub: SEASONS.includes(ctx.id) ? 0xeef0e6 : lightest, salt }));
}
