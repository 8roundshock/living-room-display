// New Year · Russia (design plan #622). The top of a sparse spruce rises out of the bottom-left
// corner, dressed the way a household dressed it in the Soviet decades: a glass spire on the
// leader instead of a star, twisted icicles, glass cones, a pyramid drop, one "reflector" ball,
// a clip-on bird, a thread of glass beads and three wisps of foil "rain". A small pile of
// tangerines, one half peeled, lies in the opposite corner. No wreath, swag, string lights,
// bows or snow: those are the Western Christmas scene. The scene is on screen for twelve days,
// so nothing blinks and the top of the screen stays empty. The sparkler of 31 December and
// 1 January waits for the day-of lift (#632). Art rules: ../README.md.
import { beadThread, clipBird, foilRain, glassCone, icicle, pyramidDrop, reflectorBall, spire } from '../parts/new-year-tree-glass.js';
import { spruceTop } from '../parts/new-year-tree-spruce.js';
import { citrus } from '../parts/new-year-tree-tangerine.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed, unit = S * 1.18;

  // ---------- the spruce top with its spire, bottom-left corner ----------
  const tree = spruceTop(kit, { seed });
  tree.group.position.set(-W + Math.max(1.8, W * .183), -view.halfH, 0);   // its lowest ornaments clear of the float's crop (#675) tree.group.scale.setScalar(unit); stage.add(tree.group);
  const crown = spire(kit); crown.position.copy(tree.top).add(V(0, -.15, 0)); crown.rotation.z = .025; tree.group.add(crown);
  const on = (whorl, index, along) => tree.boughs.find(bough => bough.whorl === whorl && !index--).pt(along);

  // ---------- the glass: six hanging pieces and a clip-on bird, no two alike, each on its own bough ----------
  // [maker, whorl, bough in the whorl from the left, place along it, depth nudge, how far it turns on its thread]
  const GLASS = [
    [() => icicle(kit, { length: .78, colour: 0xdfe5ee, turns: 1.4, thread: .14 }), 2, 4, .82, .05, 3],
    [() => glassCone(kit, { length: .4, colour: 0xd9a441, thread: .12 }), 1, 3, .72, .1, 3],
    [() => reflectorBall(kit, { radius: .21, thread: .1 }), 2, 2, .78, .12, .3],
    [() => icicle(kit, { length: .52, colour: 0x7fc9c0, turns: 2.6, thread: .16 }), 2, 0, .8, .05, 3],
    [() => pyramidDrop(kit, { length: .38, thread: .13 }), 1, 1, .7, .08, 3],
    [() => glassCone(kit, { length: .32, colour: 0xb5324f, frost: .8, thread: .14 }), 3, 3, .78, .1, 3],
  ];
  GLASS.slice(0, Math.max(3, Math.round(2 + A * 17))).forEach(([make, whorl, index, along, nudge, turn], i) => {
    const piece = make(), phase = rnd(i, seed + 11) * 6;
    piece.position.copy(on(whorl, index, along)).add(V(0, -.02, nudge)); tree.group.add(piece);
    tick(t => { piece.rotation.z = Math.sin(t * .45 + phase) * .035; piece.rotation.x = Math.sin(t * .33 + phase) * .02; piece.userData.body.rotation.y = turn > 1 ? t * .09 + phase : Math.sin(t * .2 + phase) * turn; });
  });
  // The clip-on bird stands upright on a bough of its own.
  if (A > .1) { const bird = clipBird(kit, { size: .56 }); bird.position.copy(on(1, 4, .5)).add(V(0, .02, .04)); bird.rotation.y = -.35; tree.group.add(bird); }

  // ---------- one thread of glass beads between two boughs, and three wisps of foil rain ----------
  tree.group.add(beadThread(kit, kit.catenary(on(1, 2, .9).add(V(0, .03, .05)), on(1, 4, .93).add(V(0, .03, .05)), .26, 40)));
  [[3, 0, .95, 1], [2, 3, .95, 1.2], [1, 0, .9, .9]].slice(0, Math.max(1, Math.round(A * 12))).forEach(([whorl, index, along, length], i) => {
    const wisp = foilRain(kit, { strands: 12, length, salt: seed + i * 31 }), phase = i * 2.1;
    wisp.position.copy(on(whorl, index, along)); tree.group.add(wisp);
    tick(t => { wisp.rotation.z = Math.sin(t * .4 + phase) * .012; wisp.rotation.x = Math.sin(t * .31 + phase) * .01; });
  });

  // ---------- tangerines in the bottom-right corner: four fruits in four states ----------
  const fruit = citrus(kit), z = .3, pile = new T.Group(); pile.position.set(W - 1.6, -view.halfHAt(z) + .28, z);   // clear of the band the float's zoom crops (#675) pile.scale.setScalar(unit); stage.add(pile);
  const lay = (piece, x, y, depth, turn) => { piece.position.set(x, y, depth); piece.userData.fruit.rotation.set(...turn); pile.add(piece); };
  lay(fruit.whole({ radius: .36, leaves: 2, salt: 1.3 }), .5, 0, -.3, [.1, .6, -.12]);
  lay(fruit.whole({ radius: .31, salt: 4.1 }), -.16, 0, .12, [.9, .3, .75]);
  lay(fruit.peeled({ radius: .33, salt: 2.2 }), -.98, 0, .2, [.32, .25, .1]);
  if (A > .1) lay(fruit.whole({ radius: .3, leaves: 1, salt: 7.7 }), .2, .5, -.08, [-.15, 2.4, .2]);
  const warmth = kit.glow(0xf29a2e, 3.4 * S, .1, { twinkle: .08 }); warmth.position.set(W - 1.6, -view.halfH + .2, -1.2); stage.add(warmth);
}
