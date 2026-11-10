// Winter (design plan #616). The stillest scene: frost ferns grow in from the bottom-left
// corner as on a cold pane, six fronds from three points on the frame edge, thinning to single
// feathers toward the middle, with a few glints on their tips; and a bare forked twig sheathed
// in clear ice enters from the right edge near the top, with short frozen drops under some of
// its nodes. Nothing falls (coordinator decision on #616: still air; falling snow belongs to the
// weather and appears only when the forecast says snow). No fir, berry, ornament, light string,
// snowflake, icicle row or snow bank. One fixed picture for the whole season. Art rules: ../README.md.
import { bark, limb, taper } from '../parts/spring-limb.js';
import { backlight, frostFern, ice } from '../parts/winter-frost.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed;

  // ---------- frost ferns: three seed points on the frame edge (the corner, the bottom edge, the left edge) ----------
  const near = .4, corner = V(-view.halfWAt(near), -view.halfHAt(near), near);
  const fern = frostFern(kit, { corner, across: 4.4, up: 3.8, size: S, density: (260 + 340 * A) / 360, seed,
    fronds: [[-.35, -.35, .75, 4.6, -.16], [-.35, -.35, 1.0, 3.0, -.05], [1.3, -.35, .5, 3.0, -.22], [1.3, -.35, 1.0, 1.1, .3], [-.35, 1.3, 1.2, 2.6, -.2], [-.35, 1.3, .5, 1.6, .3]] });
  // The light moves more than the objects do: small cold lamps behind the ice drift slowly, so its highlights slide.
  stage.add(fern.mesh, backlight(kit, [[V(corner.x + 1.0, corner.y + 3.4, -1.8), 8], [V(corner.x + 3.8, corner.y + .9, -1.6), 8]])); tick(fern.breathe);

  if (ctx.quiet) return;   // a quiet date keeps the frost alone: no twig, no glint, no backlight glow

  // Glints on crystal tips: each rises and falls in its own slot of a slow round, so neighbours are never lit together.
  if (ctx.weather !== 'fog') {
    const ORDER = [0, 3, 1, 4, 2, 5], slot = 1.4, round = slot * 6;
    fern.tips(6).forEach((tip, i) => {
      const glint = kit.glow(0xeaf4ff, .25 * S, 0, { twinkle: 0 }); glint.position.copy(tip); stage.add(glint);
      tick(t => { const age = ((t - ORDER[i] * slot) % round + round) % round; glint.userData.o = age < slot * 1.2 ? .35 * Math.pow(Math.sin(age / (slot * 1.2) * Math.PI), 2) : 0; });
    });
  }
  const cold = kit.glow(0x9db8e8, 6, .05, { twinkle: .2 }); cold.position.set(corner.x + 1.9, corner.y + 1.7, -2.5); stage.add(cold);

  // ---------- a bare forked twig glazed in clear ice, entering from the right edge near the top ----------
  const at = (x, y, z = 0) => V(W - x, y, z);   // measured from the right edge
  const wood = bark(kit, 0x6b5a50, { see: .15, env: .25, salt: 3 }), glaze = ice(kit);
  const root = at(-.55, 3.66, -.3), twig = new T.Group(), body = new T.Group(); twig.position.copy(root); body.position.copy(root).negate(); twig.add(body); stage.add(twig);
  const grow = (points, from, to) => { const mesh = limb(kit, points, taper(from * S, to * S), wood, { sides: 7 }); mesh.renderOrder = 1; body.add(mesh, glaze.sleeve(mesh, { thick: 2.3, skin: .02 * S, salt: points.length + from * 40 })); return mesh; };
  const main = grow([root, at(.5, 3.56, -.12), at(1.1, 3.3, .02), at(1.7, 3.2, .12), at(2.4, 2.78, .24), at(2.9, 2.6, .28), at(3.42, 2.2, .3)], .05, .014);
  const forks = [grow([main.userData.at(.3), at(1.48, 3.72, -.1), at(1.8, 3.78, -.16), at(2.1, 3.98, -.2)], .026, .011), grow([main.userData.at(.52), at(2.2, 2.58, .45), at(2.5, 2.3, .52), at(2.62, 2.0, .56), at(2.8, 1.8, .55)], .028, .011), grow([main.userData.at(.75), at(3.0, 2.82, .2), at(3.3, 2.84, .16), at(3.52, 2.98, .15)], .022, .01)];
  // Nine bud nodes, each with a bead of ice on its tip; a short frozen drop hangs under four of them and under one twig end.
  const NODES = [[main, .22, 1, 0], [main, .36, -1, .13], [main, .5, 1, 0], [main, .64, -1, .16], [main, .8, 1, .07], [main, .93, -1, 0], [forks[0], .6, 1, .09], [forks[1], .55, 1, 0], [forks[2], .6, -1, 0]];
  NODES.forEach(([shoot, share, side, hangs], i) => {
    const base = shoot.userData.at(share), along = shoot.userData.dir(share), thick = shoot.userData.radius(share), way = V(-along.y, along.x, .3).multiplyScalar(side).addScaledVector(along, .7).normalize();
    const bud = new T.Mesh(kit.ballGeo, wood); bud.scale.set(thick * .9, thick * 2.2, thick * .9); bud.quaternion.setFromUnitVectors(V(0, 1, 0), way); bud.position.copy(base).addScaledVector(way, thick * 1.6); bud.renderOrder = 1;
    const bead = glaze.bead((.03 + rnd(i, seed + 3) * .02) * S); bead.position.copy(base).addScaledVector(way, thick * 3.9); body.add(bud, bead);
    if (hangs) { const drop = glaze.drop(hangs * S); drop.position.copy(base).add(V(0, -thick * 1.9 - .006, 0)); body.add(drop); }
  });
  [[main, 0], [forks[1], .14], [forks[0], 0], [forks[2], 0]].forEach(([shoot, hangs], i) => {
    const end = shoot.userData.at(1), bead = glaze.bead((.045 + i * .004) * S); bead.position.copy(end); body.add(bead);
    if (hangs) { const drop = glaze.drop(hangs * S); drop.position.copy(end).add(V(0, -.012 * S, 0)); body.add(drop); }
  });
  stage.add(backlight(kit, [[at(2.6, 3.9, -1.6), 14], [at(1.3, 2.0, -1.5), 14]]));
  tick(t => { twig.rotation.z = Math.sin(t * .838) * .0035; });
}
