// Tea the home way (#627): a plain glass in a metal holder with a handle (a podstakannik), amber
// tea with a slice of lemon at the surface and a teaspoon standing in it. The holder's openwork
// is plain repeating arches: no emblem, no lettering.
import { through, tubes, turned } from './new-year-tree-tubes.js';

/** A tea glass in its holder, standing on y = 0; the handle points toward +x. `userData.top` is the rim of the glass. */
export function teaGlass(kit, { radius = .26, height = .7, seed = 0 } = {}) {
  const { T, V, rnd } = kit, group = new T.Group(), sleeve = height * .56;
  // ---------- the tea, drawn first so it is seen through the glass ----------
  const level = height * .84, tea = new T.Mesh(new T.CylinderGeometry(radius * .9, radius * .86, level - .06, 32), kit.mat({ color: 0xa04a0a, roughness: .12, clearcoat: 1, transparent: true, opacity: kit.solidity(.92), emissive: 0xc05a14, emissiveIntensity: .7 }, .8));
  tea.position.y = .06 + (level - .06) / 2; group.add(tea);
  const lemon = kit.canvasTexture(128, 128, g => {
    g.translate(64, 64); g.fillStyle = '#e9b820'; g.beginPath(); g.arc(0, 0, 62, 0, 7); g.fill(); g.fillStyle = '#fbf2c8'; g.beginPath(); g.arc(0, 0, 54, 0, 7); g.fill();
    for (let i = 0; i < 9; i++) { g.save(); g.rotate(i / 9 * Math.PI * 2 + rnd(i, seed) * .1); g.fillStyle = i % 2 ? '#f4d23c' : '#f0c82c'; g.beginPath(); g.moveTo(0, -6); g.quadraticCurveTo(17, -30, 13, -49); g.quadraticCurveTo(0, -54, -13, -49); g.quadraticCurveTo(-17, -30, 0, -6); g.fill(); g.restore(); }
    g.fillStyle = '#fbf2c8'; g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill();
  });
  const slice = new T.Mesh(new T.CylinderGeometry(radius * .62, radius * .62, .02, 28), kit.mat({ map: lemon, roughness: .4, clearcoat: .5, emissive: 0xf2d24a, emissiveIntensity: .25 }, .6));
  slice.position.set(-radius * .2, level + .012, radius * .1); slice.rotation.set(.12, .6, -.1); group.add(slice);
  // ---------- the glass: straight, thin, a little wider at the rim ----------
  const wall = k => radius * (.92 + .08 * k), outer = [[0, 0], [wall(0), 0]], inner = [];
  for (let i = 1; i <= 10; i++) outer.push([wall(i / 10), height * i / 10]);
  for (let i = 10; i >= 1; i--) inner.push([wall(i / 10) - .018, height * i / 10 + (i === 10 ? .003 : 0)]);
  inner.push([wall(0) - .03, .05], [0, .05]);
  const glass = new T.Mesh(turned(kit, [...outer, ...inner], 48), kit.mat({ color: 0x1c262c, roughness: .04, clearcoat: 1, clearcoatRoughness: .03, side: T.DoubleSide, depthWrite: false, emissive: 0xcfe6ef, emissiveIntensity: .05 }, 2.4)); glass.renderOrder = 2; group.add(glass);
  // ---------- the holder: a foot, a pierced sleeve between two solid bands, a handle ----------
  const silver = () => kit.mat({ color: 0xd4d7de, metalness: 1, roughness: .32, emissive: 0xc9ccd6, emissiveIntensity: .1 }, 1.5, false);
  const arches = kit.canvasTexture(256, 64, g => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#000';
    for (let i = 0; i < 8; i++) { const x = i * 32 + 16; g.beginPath(); g.moveTo(x - 10, 50); g.lineTo(x - 10, 28); g.quadraticCurveTo(x, 6, x + 10, 28); g.lineTo(x + 10, 50); g.closePath(); g.fill(); g.beginPath(); g.arc(i * 32, 16, 4.5, 0, 7); g.fill(); }
  }, { srgb: false });
  arches.wrapS = T.RepeatWrapping; arches.repeat.x = 2;
  const pierced = kit.mat({ color: 0xd4d7de, metalness: 1, roughness: .32, emissive: 0xc9ccd6, emissiveIntensity: .1, alphaMap: arches, alphaTest: .5, side: T.DoubleSide }, 1.5, false);
  const cage = new T.Mesh(new T.CylinderGeometry(wall(.56) + .012, wall(.06) + .012, sleeve, 48, 1, true), pierced); cage.position.y = .06 + sleeve / 2; cage.renderOrder = 3; group.add(cage);
  const foot = new T.Mesh(turned(kit, [[0, 0], [radius * 1.08, 0], [radius * 1.1, .02], [radius * .98, .045], [wall(0) + .014, .075]], 48), silver()); group.add(foot);
  for (const [y, k] of [[.06 + sleeve, .56], [.085, .04]]) { const band = new T.Mesh(new T.TorusGeometry(wall(k) + .014, .016, 8, 48), silver()); band.rotation.x = Math.PI / 2; band.position.y = y; group.add(band); }
  const grip = tubes(kit, 8).add(through(kit, [[wall(.5) + .01, .06 + sleeve * .92, 0], [wall(.5) + .15, .06 + sleeve * .98, 0], [wall(.5) + .23, .06 + sleeve * .62, 0], [wall(.3) + .17, .06 + sleeve * .2, 0], [wall(.1) + .01, .06 + sleeve * .1, 0]], 18), .022, .02).mesh(silver());
  grip.scale.z = 1.6; group.add(grip);
  // ---------- a teaspoon standing in the glass, leaning on the rim ----------
  const spoon = tubes(kit, 6).add([V(-radius * .5, .1, radius * .2), V(-radius * .1, height * .6, radius * .05), V(radius * .55, height + .28, -radius * .1)], .012, .016, undefined, undefined, (k, r) => r * (1 + 1.6 * Math.pow(k, 8))).mesh(silver());
  group.add(spoon);
  group.userData.top = height;
  return group;
}
