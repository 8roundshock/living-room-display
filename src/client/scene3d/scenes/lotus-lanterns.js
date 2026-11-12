// Buddha's Birthday, Korea (design plan #630): the paper lanterns of Yeondeunghoe. One large pink
// lotus lantern hangs close in the top-right corner with its blank paper tag turning below it;
// three smaller lanterns of different kinds (a white lotus, an eight-sided palmo-deung with jade
// bands, a pale-yellow lotus) recede along one cord across the top left. Everything hangs and
// nothing stands; the bottom third and the middle stay empty. Lanterns only (coordinator decision
// on #630: no temple wind-bell). No red globe lanterns, no sky lanterns, no living lotus, no
// figure, symbol or writing. Art rules: ../README.md.
import { LOTUS_SHORT, LOTUS_TWO_ROWS, LOTUS_WHITE, LOTUS_YELLOW, lanternTag, lotusLantern, palmoLantern } from '../parts/lotus-lanterns-lantern.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  // The plan's sizes are on-screen sizes at the special look; K follows the owner's size setting from there.
  const { T, V, stage, view, tick } = kit, W = view.halfW, A = ctx.amount, K = ctx.size / .935, CORD = 0xcfc8d8;

  /** Hang a lantern from `from` on a cord `drop` long (to the lantern's centre), with its tag, its halo and its own slow sway. */
  const hang = (lantern, from, drop, { tag, halo, sway, turn, phase, parent = stage }) => {
    const pivot = new T.Group(), { top, bottom, breathe } = lantern.userData; pivot.position.copy(from); lantern.position.y = -drop;
    pivot.add(kit.line([V(), V(0, -drop + top, 0)], CORD, .55), lantern);
    if (tag) { const slip = lanternTag(kit, { ...tag, phase }); slip.position.y = -drop + bottom; pivot.add(slip); }
    const light = kit.glow(0xffb766, halo[0], halo[1], { twinkle: .12 }); light.position.set(0, -drop, -.6); pivot.add(light);
    parent.add(pivot);
    tick(t => {
      // Each sways on its cord and turns a little at its own pace; the light breathes, never flickers.
      pivot.rotation.z = Math.sin(t * sway + phase) * .021; lantern.rotation.y = phase + Math.sin(t * turn + phase) * .105; breathe(1 + Math.sin(t * 7.2 + phase * 2.3) * .06);
    });
    return pivot;
  };

  // ---------- the lotus lantern, top right: the only one with a real light inside ----------
  hang(lotusLantern(kit, { size: 1.05 * K, lamp: true, salt: 3 }), V(W - 2.15, 4.95, .5), 2.95, { tag: { width: .26 * K, height: .95 * K, thread: .45 * K, salt: 5 }, halo: [3.4 * K, .3], sway: 2.9, turn: 1.68, phase: .4 });
  // A quiet date keeps the hero only.
  if (ctx.quiet) return;

  // ---------- the lantern line, top left: one cord, three lanterns that differ in kind, colour and size ----------
  {
    const line = new T.Group(), z = -1.5, cord = kit.catenary(V(-view.halfWAt(z) - .5, 4.35, z), V(-W + 6.3, 4.8, z), .7, 40); line.add(kit.line(cord, CORD, .55)); stage.add(line);
    const at = x => cord.reduce((best, point) => Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best);
    const strung = [
      [-W + 1.75, () => lotusLantern(kit, { size: .5 * K, paper: LOTUS_WHITE, rows: LOTUS_TWO_ROWS, leaves: 6, strength: .6, salt: 13 }), .95, { tag: { width: .14 * K, height: .46 * K, thread: .2 * K, salt: 15 }, halo: [1.9 * K, .2], sway: 3.6, turn: 1.5, phase: 1.9 }],
      [-W + 3.65, () => palmoLantern(kit, { size: .95 * K, strength: .62, salt: 23 }), 1.25, { tag: { width: .15 * K, height: .5 * K, thread: .16 * K, salt: 25 }, halo: [2.1 * K, .2], sway: 3.1, turn: 1.9, phase: 3.3 }],
      [-W + 5.2, () => lotusLantern(kit, { size: .46 * K, paper: LOTUS_YELLOW, rows: LOTUS_SHORT, leaves: 7, strength: .66, salt: 31 }), .8, { tag: { width: .12 * K, height: .4 * K, thread: .18 * K, salt: 35 }, halo: [1.6 * K, .2], sway: 3.9, turn: 1.75, phase: 5.1 }],
    ];
    strung.slice(0, Math.min(3, Math.max(1, Math.round(1 + A * 7)))).forEach(([x, make, drop, options]) => hang(make(), at(x), drop, { ...options, parent: line }));
    // The line itself lifts and settles a little.
    tick(t => { line.position.y = Math.sin(t * 1.1) * .03; });
  }
}
