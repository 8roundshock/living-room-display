// The one gust that drives everything in a windy scene (Wind, #621): a value between 0.6 and 1
// that rises and falls over about 38 real seconds, with a slower second swell so it never repeats
// exactly. The wind always blows from right to left: an art choice, not a claim about the real
// wind (the forecast data the scene is given carries no direction).

/** The plan gives times in real seconds; the scene clock runs at an eighth of real time (README). */
const REAL = 8;

/** Returns { strength(t): 0.6-1, lift(t): the same as 0-1, travel(t): scene seconds of travel at a speed that follows the gust by ±25% }. */
export function windGust(kit, { period = 38, salt = 0 } = {}) {
  const w = 2 * Math.PI * REAL / period, w2 = w * .37, phase = kit.rnd(1, salt + 3) * 6.283;
  const lift = t => .5 + .37 * Math.sin(t * w + phase) + .13 * Math.sin(t * w2 + phase * 2);
  return {
    lift, strength: t => .6 + .4 * lift(t),
    // The integral of 1 + 0.5 x (lift - 0.5): where something carried by the wind has got to.
    travel: t => t - .5 * (.37 * Math.cos(t * w + phase) / w + .13 * Math.cos(t * w2 + phase * 2) / w2),
  };
}
