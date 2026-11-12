// Winter (#665, the owner's direction of 2026-11-11: "for winter i want like an evergreen with
// some wintery elements"; it overturns the "no fir" decision of the first plan, #616, whose
// frost ferns are gone). The side of a white spruce outdoors, its trunk beyond the left edge:
// three different boughs of the one tree (a short snow-heavy tip in the top corner, the long
// hero below it, and a smaller forked one lower down that hangs steeply and has shed its snow
// along a stretch), sagging under pads of snow that lie along their upper sides and on the
// twigs level enough to hold it, with short blue-green needles showing under and through the
// snow, a few light brown cones hanging under the twigs the way a spruce's cones hang, and
// short icicles of different lengths under two of the bough tips. Low on the right edge, as
// the one light companion, the bare twig glazed in clear ice from #616, smaller, with its
// frozen drops. Nothing falls by itself:
// falling snow (or rain, or any weather) is drawn over the scene only when the forecast says
// so (#655). The boughs breathe a fraction of a degree, each as one piece; a few glints on the
// snow rise and fall in turn; nothing else moves. A quiet date keeps the evergreen alone.
// Not Christmas and not the New Year tree: no ornament, light, ribbon, star, wreath, garland
// or berry; no snowman, snowflake shape or snow bank. One fixed picture for the whole season;
// the middle of the screen stays black. Art rules: ../README.md.
import { bark, limb, taper } from '../parts/spring-limb.js';
import { spruceBough } from '../parts/winter-spruce.js';
import { snowLook, snowPads } from '../parts/winter-snow.js';
import { spruceCone } from '../parts/winter-cone.js';
import { backlight, ice } from '../parts/winter-ice.js';
import { fused, settle } from '../parts/winter-order.js';
import { weatherOver } from '../parts/wind-underneath.js';

/** Drawing order (#663). Every mesh of a bough has its origin where the bough leaves the trunk, at the bough's
 * depth plus one of these: wood is drawn first, then needles, snow, cones and ice, so needles show through the
 * snow that lies on them and a cone or an icicle is hidden where it passes behind a pad. The boughs' own depths
 * are further apart than these steps, so a farther bough is drawn whole before a nearer one. Nothing here moves
 * in depth: a bough only turns in the plane of the screen. */
const ORDER = { wood: -.08, needles: -.06, snow: 0, core: .02, scales: .03, ice: .045, glint: .06 };
/** How solid the snow's body is against its rim. Autumn's leaves are moving to about 0.7 (#664); white at 0.7 reads as grey on black, so the snow keeps a little more. */
const SNOW_BODY = .8;
/** Three different boughs of one tree, from the top down: where each leaves the trunk (height, depth), how far it
 * reaches, how far it sinks, how far its tip swings toward the room and turns back up, the length of its longest
 * twigs, how far the spray is turned to face the room, how many side twigs, and its snow.
 * The top one is only a short tip in the corner, heavy with snow. The middle one is the hero: the longest and
 * nearest, with the snow slipping on one twig. The lowest is smaller and of another habit: it hangs steeply and
 * turns up at its tip, it has shed its snow along a stretch, and a lighter secondary branch forks from it. */
const BOUGHS = [
  { y: 4.3, z: -.25, reach: 1.9, drop: .62, swing: .1, spread: .4, tilt: .95, twigs: 8, load: 1 },
  { y: 2.3, z: .3, reach: 3.85, drop: 1.7, swing: .25, spread: .78, tilt: 1.2, twigs: 15, load: 1, slip: [3] },
  { y: .25, z: -.6, reach: 1.95, drop: 2.5, curl: .46, swing: .05, spread: .38, tilt: 1.1, twigs: 8, load: .75, shed: [.36, .7], slip: [1],
    fork: { at: .3, reach: 1.12, drop: .45, swing: .22, spread: .32, tilt: 1, twigs: 6, load: .6 } },
];
/** Cones, in order of who stays when there are few: [bough, which near twig (counted outward), length, girth, how open, tone]. No two alike. */
const CONES = [[1, 1, .42, .13, .25, .35], [2, 2, .34, .12, .6, .7], [1, 3, .3, .105, .1, .15], [0, 1, .36, .125, .4, .55]];
/** Icicles: [bough, share along its spine or -1 for the end of its outermost near twig, sideways, length, girth]. Different lengths, unevenly spaced. */
const ICICLES = [[1, .965, 0, .46, .042], [1, -1, .02, .26, .032], [2, .955, 0, .34, .038], [1, .87, .03, .6, .05], [2, -1, -.02, .2, .028]];

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed;
  // The weather over the scene (#646): wind doubles each bough's breathing and leans the cones that hang under it to the
  // left (the ice is stiff and keeps still); rain and a storm halve the glints and the lamps behind the ice; fog dims the
  // lamps by 40% and takes the glints away.
  const weather = weatherOver(kit, ctx), dim = weather.backlight;
  const snow = snowLook(kit, { body: SNOW_BODY }), glaze = ice(kit);

  // ---------- the evergreen: three snow-laden boughs from the left edge ----------
  const cones = Math.min(CONES.length, Math.max(2, Math.round(1.6 + A * 10))), drips = ctx.quiet ? 0 : Math.min(ICICLES.length, Math.round(1 + A * 17)), glints = [];
  BOUGHS.forEach(({ y, z, fork, ...shape }, b) => {
    const from = V(-W - .6, y, z), group = new T.Group(); group.position.set(from.x, from.y, 0); stage.add(group);
    const hold = (object, order) => { settle(kit, object, V(from.x, from.y, z + order)); object.position.sub(group.position); group.add(object); };
    const bough = spruceBough(kit, { from, ...shape, needle: .12 * S, girth: .052 * S, seed: seed + b * 31 }), pads = snowPads(kit, bough.segments, { material: snow, thick: S / .85, seed: seed + b * 7 });
    hold(bough.wood, ORDER.wood); hold(bough.needles, ORDER.needles); hold(pads.mesh, ORDER.snow);
    // A secondary branch leaves the bough part of the way along it and goes its own way. Its meshes share the bough's
    // origins and are made after the bough's, so all the wood is still drawn before all the needles, and those before all the snow.
    if (fork) {
      const { at: share, ...branch } = fork, second = spruceBough(kit, { from: bough.at(share), ...branch, needle: .12 * S, girth: .03 * S, seed: seed + b * 31 + 17 });
      hold(second.wood, ORDER.wood); hold(second.needles, ORDER.needles); hold(snowPads(kit, second.segments, { material: snow, thick: S / .85, seed: seed + b * 7 + 3 }).mesh, ORDER.snow);
    }
    // Each cone hangs from its own point, so the wind can lean it (#646); it is solid, so its origin no longer orders it.
    const hanging = [];
    CONES.slice(0, cones).forEach(([on, twig, length, girth, open, tone], i) => {
      if (on !== b) return;
      const hang = bough.hangs[Math.min(twig, bough.hangs.length - 1)].point, top = hang.clone().add(V(-.05, -.02 * S, 0)), cone = spruceCone(kit, { at: top, length: length * S / .85, girth: girth * S / .85, open, tone, lean: (rnd(i, seed + 21) - .5) * .22, turn: rnd(i, seed + 22) * 6, seed: seed + 60 + i * 9 });
      const pivot = new T.Group(); pivot.position.copy(top).sub(group.position); group.add(pivot); hanging.push(pivot);
      for (const part of [cone.core, cone.scales]) { settle(kit, part, top); part.position.set(0, 0, 0); pivot.add(part); }
    });
    const hung = ICICLES.slice(0, drips).filter(([on]) => on === b).map(([, share, aside, length, girth]) => [(share < 0 ? bough.hangs[bough.hangs.length - 1].point.clone() : bough.at(share)).add(V(aside, -.035 * S, .02)), length * S / .85, girth * S / .85]);
    if (hung.length) hold(glaze.icicles(hung, seed + b * 5), ORDER.ice);
    // Where glints may sit: on top of this bough's snow, seen from the room at the depth that draws them after everything of the bough.
    pads.crests(b === 1 ? 3 : b === 0 ? 2 : 1).forEach(point => { const depth = z + ORDER.glint, seen = (view.depth - depth) / (view.depth - point.z); glints.push([group, V(point.x * seen, point.y * seen, depth).sub(group.position), seen]); });
    // Each bough breathes as one piece about the point where it leaves the trunk, in the plane of the screen.
    tick(t => { group.rotation.z = weather.sway(Math.sin(t * (.72 + b * .11) + b * 2.1) * .0038, 0); for (const pivot of hanging) pivot.rotation.z = weather.sway(0, -1); });
  });

  if (ctx.quiet) return;   // a quiet date keeps the evergreen alone: no icicles, no glints, no lamps, no twig

  // Glints on the snow: each rises and falls in its own slot of a slow round, so no two neighbours are lit together.
  {
    const ROUND = [0, 3, 1, 4, 2, 5], slot = 1.4, round = slot * ROUND.length;
    glints.forEach(([group, place, seen], i) => {
      const glint = kit.glow(0xeaf4ff, .2 * S * seen, 0, { twinkle: 0 }); glint.position.copy(place); glint.visible = weather.glints; group.add(glint);   // fog takes the glints away
      tick(t => { const age = ((t - ROUND[i % ROUND.length] * slot) % round + round) % round; glint.userData.o = age < slot * 1.2 ? .95 * dim * Math.pow(Math.sin(age / (slot * 1.2) * Math.PI), 2) : 0; });
    });
  }
  // Two small still lamps behind the icicles: clear ice is seen by what lights it from behind.
  stage.add(backlight(kit, [[V(-W + 3.1, .5, -1.3), 3.5 * dim], [V(-W + 2.4, -1.5, -1.9), 3 * dim]], { range: 6, sweep: 0 }));

  // ---------- the companion: a bare forked twig glazed in clear ice, low on the right edge, with a few frozen drops ----------
  {
    const SMALLER = .8, at = (x, y, z = 0) => V(W - x * SMALLER, -1.72 + (y - 3.66) * SMALLER, z), R = S * SMALLER;   // the twig of #616, measured from the right edge, moved down and made smaller about the point where it enters
    const wood = bark(kit, 0x6b5a50, { see: .15, env: .25, salt: 3 }), root = at(-.55, 3.66, -.3), woods = [], ices = [];
    const grow = (points, from, to) => { const mesh = limb(kit, points, taper(from * R, to * R), wood, { sides: 7 }); woods.push(mesh); ices.push(glaze.sleeve(mesh, { thick: 2.3, skin: .02 * R, salt: points.length + from * 40 })); return mesh; };
    const main = grow([root, at(.5, 3.56, -.12), at(1.1, 3.3, .02), at(1.7, 3.2, .12), at(2.4, 2.78, .24), at(2.9, 2.6, .28), at(3.42, 2.2, .3)], .05, .014);
    const forks = [grow([main.userData.at(.3), at(1.48, 3.72, -.1), at(1.8, 3.78, -.16), at(2.1, 3.98, -.2)], .026, .011), grow([main.userData.at(.52), at(2.2, 2.58, .45), at(2.5, 2.3, .52), at(2.62, 2, .56), at(2.8, 1.8, .55)], .028, .011), grow([main.userData.at(.75), at(3, 2.82, .2), at(3.3, 2.84, .16), at(3.52, 2.98, .15)], .022, .01)];
    // Nine bud nodes, each with a bead of ice on its tip; a short frozen drop hangs under four of them and under one twig end.
    const NODES = [[main, .22, 1, 0], [main, .36, -1, .13], [main, .5, 1, 0], [main, .64, -1, .16], [main, .8, 1, .07], [main, .93, -1, 0], [forks[0], .6, 1, .09], [forks[1], .55, 1, 0], [forks[2], .6, -1, 0]];
    NODES.forEach(([shoot, share, side, hangs], i) => {
      const base = shoot.userData.at(share), along = shoot.userData.dir(share), thick = shoot.userData.radius(share), way = V(-along.y, along.x, .3).multiplyScalar(side).addScaledVector(along, .7).normalize();
      const bud = new T.Mesh(kit.ballGeo, wood); bud.scale.set(thick * .9, thick * 2.2, thick * .9); bud.quaternion.setFromUnitVectors(V(0, 1, 0), way); bud.position.copy(base).addScaledVector(way, thick * 1.6); woods.push(bud);
      const bead = glaze.bead((.03 + rnd(i, seed + 3) * .02) * R); bead.position.copy(base).addScaledVector(way, thick * 3.9); ices.push(bead);
      if (hangs) { const drop = glaze.drop(hangs * R); drop.position.copy(base).add(V(0, -thick * 1.9 - .006, 0)); ices.push(drop); }
    });
    [[main, 0], [forks[1], .14], [forks[0], 0], [forks[2], 0]].forEach(([shoot, hangs], i) => {
      const end = shoot.userData.at(1), bead = glaze.bead((.045 + i * .004) * R); bead.position.copy(end); ices.push(bead);
      if (hangs) { const drop = glaze.drop(hangs * R); drop.position.copy(end).add(V(0, -.012 * R, 0)); ices.push(drop); }
    });
    // Two meshes: the wood, and all the ice. The wood's origin is behind the ice's, so the twig is drawn first and shows inside its glaze.
    const twig = new T.Group(); twig.position.set(root.x, root.y, 0); stage.add(twig);
    [[fused(kit, woods, wood), -.08], [fused(kit, ices, glaze.material), 0]].forEach(([mesh, order]) => { settle(kit, mesh, V(root.x, root.y, .1 + order)); mesh.position.sub(twig.position); twig.add(mesh); });
    stage.add(backlight(kit, [[at(2.6, 3.9, -1.6), 14 * dim], [at(1.3, 2, -1.5), 14 * dim]], { sweep: 0 }));
    tick(t => { twig.rotation.z = weather.sway(Math.sin(t * .838) * .0035, 0); });
  }
}
