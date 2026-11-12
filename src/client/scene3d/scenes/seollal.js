// Seollal, Korean Lunar New Year (design plan #628). One hanji shield kite (bangpae-yeon) rides
// high in the top-left corner on a taut line that leaves the frame at the bottom-left corner; a
// round and an eared silk lucky pouch (bokjumeoni) hang on their cords in the top-right corner;
// a thrown set of four yut sticks lies at the bottom right. White paper carries the scene and
// colour stays in small areas. No lettering, no red envelopes or lanterns, no red disc on the
// white kite, no tail on it. The far ray kite belongs to the three holiday days: it is drawn
// only when the engine gives the scene the special tier (#632). The middle stays empty.
// Art rules: ../README.md.
import { rayKite, shieldKite } from '../parts/seollal-kite.js';
import { earedPouch, roundPouch } from '../parts/seollal-pouch.js';
import { yutStick } from '../parts/seollal-yut.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  // The plan's sizes are on-screen sizes at the everyday look; K follows the owner's size setting from there.
  const { T, V, stage, view, tick } = kit, W = view.halfW, K = ctx.size / .85;
  const RED = 0xd8433b, JADE = 0x5fbfa0, YELLOW = 0xf5cf52, THREAD = 0xe8e0cc;

  // ---------- the shield kite, top left: rolled, turned toward the middle, leaning back ----------
  {
    const kite = shieldKite(kit, { scale: K }), home = V(-W + 2.1, 2.2, -.4); stage.add(kite);
    const sky = kit.glow(0xbfd4ff, 6.5 * K, .1, { twinkle: .1 }); sky.position.set(home.x + .2, home.y, -3); stage.add(sky);
    // The flying line runs down the left edge toward the viewer, as if flown from just off the screen.
    const hand = V(-view.halfWAt(2) - .4, -view.halfHAt(2) - .4, 2), n = 28, position = new Float32Array((n + 1) * 3), geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(position, 3));
    const flying = new T.Line(geometry, new T.LineBasicMaterial({ color: kit.C(THREAD), transparent: true, opacity: .5 })); flying.frustumCulled = false; stage.add(flying);
    const tow = V();
    tick(t => {
      // A slow figure of eight, a small roll, and the line re-tensions with it.
      kite.position.set(home.x + Math.sin(t * 1.9) * .12, home.y + Math.sin(t * 3.8) * .07, home.z); kite.rotation.set(-.21, .38, -.17 + Math.sin(t * 1.9 + .8) * .035); kite.updateMatrix();
      tow.copy(kite.userData.tow).applyMatrix4(kite.matrix);
      const sag = .22 + Math.sin(t * 1.9) * .04;
      for (let i = 0; i <= n; i++) { const u = i / n; position[i * 3] = tow.x + (hand.x - tow.x) * u; position[i * 3 + 1] = tow.y + (hand.y - tow.y) * u - sag * 4 * u * (1 - u); position[i * 3 + 2] = tow.z + (hand.z - tow.z) * u; }
      geometry.attributes.position.needsUpdate = true;
    });
  }
  // A quiet date keeps the hero only.
  if (ctx.quiet) return;

  // ---------- two lucky pouches on one hook, top right: one round, one eared ----------
  {
    const hook = V(W - 2.1, 4.95, 0);   // clear of the right edge, so the float never cuts what hangs here (#675)
    const round = roundPouch(kit, { size: 1.12 * K, drop: 2.55, colour: RED, cord: [YELLOW, JADE], lean: -.12, phase: 0 }); round.position.copy(hook);
    const eared = earedPouch(kit, { size: .98 * K, drop: 3.95, colour: JADE, cord: [RED, YELLOW], lean: .1, phase: 2.2 }); eared.position.copy(hook).add(V(0, 0, .24));
    stage.add(round, eared);
  }

  // ---------- four yut sticks as they fell, bottom right: both faces show, one lies across another ----------
  {
    // Above the band the float's zoom crops (#675).
    const floor = new T.Group(), z = .2; floor.position.set(W - 2.3, -view.halfHAt(z) + .7, z); floor.rotation.x = .5; stage.add(floor);
    // [x, z, turn on the floor, belly up, lift, tilt along its length]
    const THROW = [[-.8, -.1, .22, true, 0, 0], [.2, .32, -.5, false, 0, 0], [.84, -.28, 1.15, true, 0, 0], [.02, -.3, -1.05, false, .13, .2]];
    THROW.forEach(([x, depth, turn, bellyUp, lift, tilt], i) => {
      const width = (.3 - i % 2 * .03) * K, stick = yutStick(kit, { length: (1.4 - [0, .08, .14, .04][i]) * K, width, bend: [.02, .035, .012, .026][i] * K, salt: 17 + i * 9 });
      const turned = new T.Group(); turned.position.set(x * K, lift * K + (bellyUp ? width * .5 : 0), depth * K); turned.rotation.set(0, turn, tilt);
      if (bellyUp) stick.rotation.x = Math.PI;
      turned.add(stick); floor.add(turned);
    });
  }

  // ---------- holiday days only: a ray kite far off in the same sky ----------
  if (ctx.tier === 'special') {
    const far = rayKite(kit, { scale: .7 * K }), z = -7, at = V(-2.9 * (1 - z / view.depth), 3.6 * (1 - z / view.depth) - .6, z); far.rotation.set(-.2, .3, .25); stage.add(far);
    stage.add(kit.line([at, V(-view.halfWAt(-3) - .5, .4, -3)], THREAD, .3));
    tick(t => { far.position.set(at.x + Math.sin(t * 1.48) * .2, at.y + Math.sin(t * 2.2) * .08, z); });
  }
}
