// Birthday · Russian accents (design plan #627, with the coordinator's decision on it: mainly a
// birthday, themed a little). The birthday core: a candle-lit cake in the bottom-right corner and
// three balloons, all different, tied down in the bottom-left. The accent: the cake is a honey
// layer cake with a slice already cut, so its thin layers show; it stands on a low-footed plate
// on a linen runner with a red band of small stepped diamonds; beside it, tea in a glass holder
// and the cut slice on a saucer; and the balloons are tied to a paper-wrapped bunch of seven
// flowers (an odd number, none with yellow petals). One low tier, no pedestal, presents or
// bunting: those are the classic scene's. No dolls, flags, text, numerals or age. The table is
// seen a little from above so the cut cake and the embroidery show. Art rules: ../README.md.
import { linenRunner, wrappedBunch } from '../parts/birthday-russian-bouquet.js';
import { cakeSlice, honeyCake } from '../parts/birthday-russian-medovik.js';
import { teaGlass } from '../parts/birthday-russian-tea.js';
import { plate, steam } from '../parts/maslenitsa-tableware.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick, shift } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed, unit = S * 1.07;
  const [cranberry] = ctx.palette, GLAZE = 0xf6f2ea, GOLD = 0xd9b25a;

  // ---------- the table: everything on the runner is one group, tipped toward the viewer ----------
  // The table and the bunch keep clear of the corners the float's zoom crops (#675).
  const table = new T.Group(); table.position.set(W - Math.max(3.05, W * .36), -view.halfH + .95, 0); table.rotation.x = .42; table.scale.setScalar(unit); stage.add(table);
  table.add(linenRunner(kit, { length: 4.5, width: 1.5, fall: .5, seed }));

  // ---------- the honey cake with its candles, on a low-footed plate ----------
  const stand = plate(kit, { radius: 1.75, foot: .17, colour: GLAZE, line: GOLD }); stand.position.set(.72, .012, -.2); table.add(stand);
  const cake = honeyCake(kit, { candles: Math.min(9, 4 + A * 10), colours: [...ctx.palette], seed }); cake.group.position.set(stand.position.x, stand.position.y + stand.userData.top, stand.position.z); table.add(cake.group);

  // ---------- tea in a glass holder, and the slice that was cut ----------
  const tea = teaGlass(kit, { seed }); tea.position.set(-1.42, .012, -.42); tea.rotation.y = 2.5; table.add(tea);
  const vapour = steam(kit, { height: .9, width: .34, strength: .13, wisps: 1, salt: seed }); vapour.position.set(tea.position.x, tea.userData.top + .05, tea.position.z); table.add(vapour);
  if (A > .15) {
    const saucer = plate(kit, { radius: .62, colour: GLAZE, line: GOLD }); saucer.position.set(-1.0, .012, .66); table.add(saucer);
    const slice = cakeSlice(kit, { seed }); slice.scale.setScalar(.66); slice.rotation.y = .55; slice.position.set(saucer.position.x - .02, saucer.position.y + saucer.userData.top, saucer.position.z - .12); table.add(slice);
  }

  // ---------- a wrapped bunch of seven flowers leaning in the bottom-left corner ----------
  // [kind, diameter, petals, x, z, height, tilt toward the viewer, tilt sideways]
  const HEADS = [['daisy', .62, 21, -.5, .12, 2.12, .95, .35], ['gerbera', .78, 34, .02, .2, 2.42, .8, -.05], ['daisy', .7, 34, .62, .1, 2.2, .9, -.45], ['gerbera', .64, 21, -.22, .4, 1.8, 1.15, .15], ['daisy', .52, 21, .42, .44, 1.74, 1.2, -.25], ['gerbera', .56, 34, -.78, -.02, 1.66, .75, .7], ['daisy', .58, 34, .2, -.12, 2.86, .5, -.12]];
  const bunch = wrappedBunch(kit, { heads: HEADS.slice(0, A > .2 ? 7 : 5), seed });
  bunch.group.position.set(-W + 1.9, -view.halfH - .5, .1); bunch.group.rotation.set(.14, .2, .44); bunch.group.scale.setScalar(unit * 1.06); stage.add(bunch.group);

  // ---------- three balloons, each different, tied to the bunch's ribbon ----------
  bunch.group.updateMatrixWorld(true);
  const tie = bunch.group.localToWorld(bunch.knot.clone());
  // [colour, radius, kit balloon options, where it floats from the knot]
  const BALLOONS = [[shift(cranberry, 0, -.05, -.1), .52, { skin: 'pearl' }, [.6, 3.1, .2]], [0xe3dac6, .45, { skin: 'latex' }, [-.3, 4.15, -.4]], [0xd9a441, .56, { skin: 'foil' }, [1.4, 3.95, .3]]];
  BALLOONS.slice(0, Math.max(2, Math.round(1 + A * 7))).forEach(([colour, radius, options, at], i) => {
    const group = new T.Group(), float = V(...at), size = radius * S, balloon = kit.balloon(colour, size, options); group.position.copy(tie); balloon.position.copy(float);
    balloon.quaternion.slerp(new T.Quaternion().setFromUnitVectors(V(0, -1, 0), float.clone().negate().normalize()), .45);
    const knot = float.clone().add(V(0, -1.2 * size, 0).applyQuaternion(balloon.quaternion));
    group.add(balloon, kit.line(new T.QuadraticBezierCurve3(knot, knot.clone().multiplyScalar(.5).add(V(.1, -.4, 0)), V()).getPoints(24))); stage.add(group);
    const phase = rnd(i, seed + 3) * 6; tick(t => { group.rotation.z = Math.sin(t * .45 + phase) * .03; group.rotation.x = Math.sin(t * .33 + phase) * .018; });
  });
}
