// Wind (design plan #621). A slender branch in the top-right corner is bowed over by the wind,
// its few slim leaves streaming in the lee; downy seeds sail from right to left along the top
// and bottom of the screen at three depths; a leaf or two torn free tumbles low across it. One
// gust, rising and falling over half a minute, drives all of it, and everything points and
// travels the same way. The wind blows from right to left as an art choice: the forecast data
// the scene is given carries no direction. No drawn wind lines or swirls, no kite, no flag, no
// grass, no maple. The middle stays empty. Art rules: ../README.md.
import { bowedBranch } from '../parts/wind-branch.js';
import { windGust } from '../parts/wind-gust.js';
import { slimLeaves } from '../parts/wind-leaf.js';
import { downySeeds } from '../parts/wind-seed.js';

/** The plan gives speeds in real seconds; the scene clock runs at an eighth of real time (README). */
const REAL = 8;

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, A = ctx.amount, S = ctx.size, seed = ctx.seed;
  const gust = windGust(kit, { salt: seed }), leaf = slimLeaves(kit);

  // ---------- the bowed branch, top-right corner ----------
  stage.add(bowedBranch(kit, { at: V(W + .35, 4.75, 0), heading: 232, lee: 180, length: 5.2 * S, bend: [48, 62], leaves: Math.min(15, Math.round(6 + 9 * A)), leaf, gust, seed }));
  if (!ctx.quiet) { const light = kit.glow(0x7fc0f2, 6, .04, { twinkle: .12 }); light.position.set(W - 2.4, 3.5, -2.5); stage.add(light); }

  // ---------- downy seeds at three depths, along the top and bottom thirds ----------
  stage.add(downySeeds(kit, { count: Math.min(13, 4 + 9 * A), gust, salt: seed }));

  // ---------- a leaf or two torn free, tumbling low across the screen ----------
  if (!ctx.quiet) for (let i = 0; i < Math.min(4, Math.round(1 + 3 * A)); i++) {
    const r = k => rnd(i, seed + 70 + k), z = -2.2 + r(1) * 3, k = 1 - z / view.depth, span = view.halfWAt(z) * 2 + 3, speed = (.25 + r(2) * .2) * REAL, start = r(3) * span, lane = -(2.9 + r(4) * 1.1) * k, phase = r(5) * 6.283;
    const long = (.5 + r(6) * .3) * S, blade = leaf({ tone: i % 2 ? 'pale' : 'sage', length: long, width: (.11 + r(7) * .04) * S, variant: i + 1 }), loose = new T.Group(), turn = (4 + r(8) * 4) / REAL;
    blade.position.y = -long / 2; loose.add(blade); stage.add(loose);
    tick(t => {
      // Shallow arcs, one turn every four to eight real seconds: the fastest things in the family, and never more than four.
      const gone = (start + speed * gust.travel(t)) % span;
      loose.position.set(span / 2 - gone, lane + Math.abs(Math.sin(gone * .55 + phase)) * .55, z);
      loose.rotation.set(t / turn * 2 * Math.PI + phase, t / (turn * 1.6) * 2 * Math.PI, 1.3 + Math.sin(t / turn * 2 + phase) * .6);
    });
  }
}
