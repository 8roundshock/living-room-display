// How a scene responds to the weather drawn over it in Combined mode (#646): "the scene underneath" of the
// weather plans, named after Wind (#621), whose plan introduced it and whose gust it shares. An overlay draws the
// weather itself (weather/<kind>.js) but must not edit the scene under it, so each scene module reads
// this and applies the weather plans' rules for "the scene underneath":
// - Wind (#621): attached things take a steady downwind lean of 2 to 4 degrees toward the left and
//   sway one and a half times as far (the plan's "twice as far" read too strong on the display: coordinator
//   decision on #646), still slowly; the scene's own falling petals, leaves or flakes drift to the left.
//   The gust is parts/wind-gust.js with the overlay's own salt, so scene and seeds move together.
// - Rain (#617) and a storm (#619): the scene stops releasing its own falling petals, leaves and
//   decorative snow, and its backlight is halved; Summer's fireflies go out.
// - Fog (#620): the backlight and far elements keep 60%, glints and twinkles stop; the hero is untouched.
// - Snow (#618): one snowfall, never two: the scene leaves its own decorative snow out.
// Calm is the owner's word for these scenes ("not overbearing", 2026-11-10): never more than these numbers.
// A quiet date is frozen and takes none of the motion. A part: call it once, first in build(), so its
// tick runs before the scene's own. See ../README.md.
import { windGust } from './wind-gust.js';

/** The steady downwind lean in degrees, at the lull and at the peak of the gust (#621: 2 to 4). */
export const LEAN = { lull: 2, peak: 4 };
/** How many times farther things sway in the wind: the plan's twice (#621) was too much on the display; one and a half (coordinator decision on #646, 2026-11-12). */
export const SWAY = 1.5;
/** What a falling piece drifts toward the left in the wind, at most, in world units (about 100 px at 1080p), reached over its first DRIFT_TIME scene seconds. */
export const DRIFT = .9, DRIFT_TIME = 12;
/** How fast an endless fall (a scene's decorative snow) is carried left, in world units per scene second at an average gust. */
export const CARRY = .08;
/** Rain or a storm: the share of the backlight that stays. Fog: the share of the backlight and the far elements that stays. */
export const WET_BACKLIGHT = .5, FOG_KEEPS = .6;
const DEGREE = Math.PI / 180;

/**
 * Returns { kind, wet, fog, snow, windy, backlight, far, glints, falls, ownSnow, wind, sway(calm, hold), drift(age) }:
 * - `backlight`: multiply the scene's halos and soft discs behind its hero by it (1, 0.5 wet, 0.6 fog).
 * - `far`: multiply far elements' strength by it (0.6 in fog).
 * - `glints`: false in fog: no glints, no twinkles.
 * - `falls`: false under rain or a storm: the scene releases none of its own falling petals or leaves.
 * - `ownSnow`: false under snow, rain or a storm: leave the scene's decorative snowfall out (hide it).
 * - `wind`: { lean, sway, gust }, set once per frame by this part's own tick: the lean in radians toward the
 *   left, the sway multiplier, and the gust (0-1). Calm: { 0, 1, 0 }.
 * - `sway(calm, hold)`: the angle (radians, about z) for a piece whose own calm angle is `calm`: its sway
 *   one and a half times as far in the wind, plus the lean. `hold` says which way the piece's free end lies from where it is
 *   held: 1 above it (it stands), -1 below it (it hangs), and a share between for something held at a slant,
 *   so that its free end always moves to the left. 0 for a piece that only sways (a whole bough).
 * - `drift(age)`: how far left (a negative x, world units) a falling piece has been carried `age` scene seconds after it let go.
 * - `carry(t)`: how far left an endless fall (kit.snow's `drift`) has been carried by scene time `t`; 0 without wind.
 * - `farther(object)`: in fog, dims a far element to 60%: its solid surfaces fade over what is behind them
 *   (kit.fade), its lines lose the same share and its halos too. Use it only on materials the element does not
 *   share with near things. Returns the object.
 * `ctx.gust` (0-1), set by tools and tests only, holds the gust.
 */
export function weatherOver(kit, ctx) {
  const kind = ctx.weather ?? null, wet = kind === 'rain' || kind === 'storm', fog = kind === 'fog', snow = kind === 'snow';
  const windy = kind === 'wind' && !ctx.quiet, wind = { lean: 0, sway: 1, gust: 0 }; let gust = null;
  if (windy) {
    // A test may hold the gust above 1 to exaggerate the lean (the edge check's own self-test); nothing else sets ctx.gust.
    gust = windGust(kit, { salt: ctx.seed + 31 }); const hold = typeof ctx.gust === 'number' ? Math.max(0, ctx.gust) : null;
    wind.sway = SWAY;
    kit.tick(t => { const g = hold ?? Math.min(1, Math.max(0, gust.lift(t))); wind.gust = g; wind.lean = (LEAN.lull + (LEAN.peak - LEAN.lull) * g) * DEGREE; });
  }
  return {
    kind, wet, fog, snow, windy, wind,
    backlight: wet ? WET_BACKLIGHT : fog ? FOG_KEEPS : 1,
    far: fog ? FOG_KEEPS : 1,
    glints: !fog,
    falls: !wet,
    ownSnow: !(wet || snow),
    sway: (calm, hold = 1) => calm * wind.sway + wind.lean * hold,
    drift: age => windy ? -DRIFT * (1 - Math.exp(-Math.max(0, age) / DRIFT_TIME)) * (.6 + .4 * wind.gust) : 0,
    carry: t => windy && gust ? -CARRY * gust.travel(t) : 0,
    farther: object => {
      if (!fog) return object;
      const done = new Set();
      object.traverse(item => {
        if (item.isSprite) { if (typeof item.userData.o === 'number') item.userData.o *= FOG_KEEPS; return; }
        for (const material of item.material ? [item.material].flat() : []) {
          if (done.has(material)) continue; done.add(material);
          kit.fade(material, material.opacity * FOG_KEEPS); material.transparent = true;
        }
      });
      return object;
    },
  };
}
