// The horn of plenty of the Thanksgiving scene (#607): a woven wicker horn lying on its side,
// its mouth turned a little toward the room, curling up and back to a thin tip, with a twisted
// rope rim. Modelled at its on-screen size (about 3.5 long and 2.1 high); the caller scales it.
// See ../README.md, "Shared parts".
import { loft, through } from './thanksgiving-loft.js';

/** The spine from the centre of the mouth to the tip: x to the left, y above the ground, z toward the room. */
const SPINE = [[0, .9, .7], [-.85, .78, .22], [-1.85, .62, 0], [-2.65, .78, -.08], [-3.1, 1.28, -.1], [-3.02, 1.8, -.06], [-2.62, 2.02, 0]];
const MOUTH = .95, TIP = .06;

/** A wicker horn. The group's origin is the ground under its mouth; the mouth opens toward +x.
 * `rise` is how much the bottom edge of the view climbs per unit toward the camera
 * (`view.halfH / view.depth`), so the horn lies on that edge along its whole length.
 * `group.userData.mouth` is the centre of the mouth and `group.userData.facing` the way it opens. */
export function horn(kit, { rise = 0 } = {}) {
  const { T, V, rnd } = kit, group = new T.Group(), shade = k => `rgb(${Math.round(Math.min(255, 196 * k))},${Math.round(Math.min(255, 146 * k))},${Math.round(Math.min(255, 82 * k))})`;
  // Plain weave: each cell shows the strand that passes over, lit along its crown and dark where it dives under its neighbours.
  const weave = kit.canvasTexture(256, 256, g => {
    g.fillStyle = '#2e1e0d'; g.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
      const tone = .84 + rnd(column + row * 4, 3) * .3;
      g.save(); g.translate(column * 64 + 32, row * 64 + 32); if ((column + row) % 2) g.rotate(Math.PI / 2);
      g.beginPath(); g.rect(-32, -32, 64, 64); g.clip();
      const across = g.createLinearGradient(0, -27, 0, 27);
      across.addColorStop(0, shade(.34 * tone)); across.addColorStop(.3, shade(1.02 * tone)); across.addColorStop(.55, shade(.9 * tone)); across.addColorStop(1, shade(.3 * tone));
      g.fillStyle = across; g.fillRect(-32, -27, 64, 54);
      const along = g.createLinearGradient(-32, 0, 32, 0);
      along.addColorStop(0, 'rgba(24,14,5,.85)'); along.addColorStop(.3, 'rgba(24,14,5,0)'); along.addColorStop(.7, 'rgba(24,14,5,0)'); along.addColorStop(1, 'rgba(24,14,5,.85)');
      g.fillStyle = along; g.fillRect(-32, -27, 64, 54);
      // Fine fibres along the strand.
      g.strokeStyle = 'rgba(60,36,12,.22)'; g.lineWidth = 1;
      for (let fibre = 0; fibre < 5; fibre++) { const y = -20 + fibre * 10 + rnd(fibre + column * 5 + row * 20, 7) * 6; g.beginPath(); g.moveTo(-32, y); g.lineTo(32, y + (rnd(fibre, row + column * 4 + 9) - .5) * 5); g.stroke(); }
      g.restore();
    }
  }, { repeat: true, anisotropy: 8 });
  const spine = through(kit, SPINE.map(([x, y, z]) => [x, y + z * rise, z])), radiusAt = u => TIP + (MOUTH - TIP) * Math.pow(1 - u, 1.25);
  const body = loft(kit, spine, radiusAt, { rings: 60, sides: 28, repeat: [13, 14] });
  const wicker = kit.mat({ map: weave, bumpMap: weave, bumpScale: .04, roughness: .55, clearcoat: .3, clearcoatRoughness: .4, see: .55 }, .7);
  // The inside is the same weave, darker, seen through the mouth.
  const inside = new T.Mesh(body, kit.mat({ map: weave, color: 0x8a6c4c, roughness: .85, side: T.BackSide, see: .45 }, .25, false)); inside.renderOrder = -1;
  group.add(inside, new T.Mesh(body, wicker));
  const tip = new T.Mesh(kit.ballGeo, wicker); tip.scale.setScalar(TIP * 1.05); tip.position.copy(spine.getPointAt(1)); group.add(tip);

  // A twisted rope finishes the mouth.
  const rope = kit.canvasTexture(64, 64, g => {
    g.fillStyle = '#4a3418'; g.fillRect(0, 0, 64, 64);
    // Strands run diagonally and repeat every 32 pixels, so the tile wraps; three strokes shade each one round.
    for (const [width, colour] of [[19, '#7d5a2e'], [11, '#a98248'], [4, '#c9a266']]) { g.strokeStyle = colour; g.lineWidth = width; for (let strand = -3; strand < 4; strand++) { g.beginPath(); g.moveTo(strand * 32 - 64, -64); g.lineTo(strand * 32 + 128, 128); g.stroke(); } }
  }, { repeat: true, anisotropy: 4 });
  rope.repeat.set(34, 1);
  const facing = spine.getTangentAt(0).negate(), mouth = spine.getPointAt(0);
  const rim = new T.Mesh(new T.TorusGeometry(MOUTH + .02, .085, 12, 80), kit.mat({ map: rope, bumpMap: rope, bumpScale: .05, roughness: .6, clearcoat: .25, see: .5 }, .7));
  rim.position.copy(mouth); rim.quaternion.setFromUnitVectors(V(0, 0, 1), facing); group.add(rim);
  group.userData = { mouth, facing };
  return group;
}
