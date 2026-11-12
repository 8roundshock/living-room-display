// The persimmon branch of Chuseok (#629): fruit still turning from yellow to orange under a large
// four-lobed calyx, among broad glossy leaves with a first orange flush. (The bare branch with
// deep-orange fruit is November, not Chuseok.) See ../README.md.
import { smooth } from './seollal-forms.js';

/** A persimmon hanging under the group's origin on a short stalk, about `size` across.
 * `ripe` (0-1) moves it from green-yellow toward orange. */
export function persimmon(kit, { size = .46, ripe = .6, salt = 1, stalk = .12 } = {}) {
  const { T, C, rnd, mat, mix, canvasTexture } = kit, group = new T.Group(), r = size / 2, css = colour => `#${new T.Color(colour).getHexString()}`;
  const skin = canvasTexture(64, 256, g => {
    const tone = g.createLinearGradient(0, 0, 0, 256); tone.addColorStop(0, css(mix(0x9fae4c, 0xd8862a, ripe))); tone.addColorStop(.3, css(mix(0xd6ac3c, 0xe8701c, ripe))); tone.addColorStop(.7, css(mix(0xe29a32, 0xe66216, ripe))); tone.addColorStop(1, css(mix(0xe69030, 0xe05812, ripe))); g.fillStyle = tone; g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${rnd(i, salt) < .5 ? '255,236,170' : '150,70,10'},${(.04 + rnd(i, salt + 1) * .06).toFixed(3)})`; g.beginPath(); g.arc(rnd(i, salt + 2) * 64, rnd(i, salt + 3) * 256, 1 + rnd(i, salt + 4) * 5, 0, 7); g.fill(); }
  });
  // A flattened globe with four soft shoulders and a dimple under the calyx.
  const geometry = new T.SphereGeometry(1, 48, 32), p = geometry.attributes.position, turn = rnd(salt, 5) * 1.5;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = (1 + .04 * Math.cos(4 * Math.atan2(z, x) + turn) * (1 - y * y)) * (1 + .05 * y);
    p.setXYZ(i, x * k * r, (Math.sign(y) * Math.abs(y) ** .9 * .86 - .1 * smooth(y, .72, 1) + .04 * smooth(-y, .85, 1)) * r, z * k * r);
  }
  geometry.computeVertexNormals();
  const fruit = new T.Mesh(geometry, mat({ map: skin, roughness: .32, clearcoat: .6, clearcoatRoughness: .2, emissive: C(0xe8621a).multiplyScalar(.1), see: .8 }, .7)); fruit.position.y = -stalk - r * .78;
  // The calyx: four broad pointed lobes lying on the shoulders of the fruit, their tips lifting.
  const sepals = new T.RingGeometry(.03, 1, 64, 6), q = sepals.attributes.position;
  for (let i = 0; i < q.count; i++) {
    const x = q.getX(i), y = q.getY(i), ring = Math.hypot(x, y), a = Math.atan2(y, x), reach = (.3 + .7 * Math.abs(Math.cos(2 * a + turn * 2)) ** .7) * ring * r * 1.08;
    q.setXYZ(i, Math.cos(a) * reach, Math.sin(a) * reach, -.46 * reach * reach / r + .12 * (reach / r) ** 4 * r);
  }
  sepals.rotateX(-Math.PI / 2); sepals.computeVertexNormals();
  const calyx = new T.Mesh(sepals, mat({ color: 0x7d8f4e, roughness: .65, side: T.DoubleSide, see: 0 }, .4, false)); calyx.position.y = -stalk + r * .03;
  const stem = new T.Mesh(new T.CylinderGeometry(.016, .02, stalk + .04, 6), mat({ color: 0x5a4a32, roughness: .85 }, .3, false)); stem.position.y = -stalk / 2;
  group.add(fruit, calyx, stem);
  return group;
}

/** Returns leaf(scale, variant, tint): a broad, pointed, glossy persimmon leaf growing along +y
 * from the group's origin, about 1 x 1.5 times `scale`, in one of three curls. */
export function persimmonLeaves(kit) {
  const { T, rnd, mat, canvasTexture } = kit, PX = 256, PY = 384, X = x => (x + .5) * PX, Y = y => (1 - y / 1.5) * PY;
  // Rounded at the base, widest below the middle, drawn out to a point.
  const half = v => .5 * Math.sin(Math.PI * Math.min(1, v * 1.06) ** .8) ** .85 * (1 - .35 * smooth(v, .7, 1));
  const outline = g => { g.beginPath(); for (let i = 0; i <= 40; i++) { const v = i / 40; g[i ? 'lineTo' : 'moveTo'](X(half(v) * .96), Y(v * 1.5)); } for (let i = 40; i >= 0; i--) { const v = i / 40; g.lineTo(X(-half(v) * .96), Y(v * 1.5)); } g.closePath(); };
  const veins = (g, colour, k) => {
    g.strokeStyle = colour; g.lineCap = 'round'; g.lineWidth = 4.5 * k; g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(0), Y(1.46)); g.stroke();
    for (let i = 0; i < 7; i++) for (const side of [-1, 1]) { const v = .1 + i * .11, reach = half(v + .12) * .9; g.lineWidth = (2.4 - i * .18) * k; g.beginPath(); g.moveTo(X(0), Y(v * 1.5)); g.quadraticCurveTo(X(side * reach * .55), Y((v + .05) * 1.5), X(side * reach), Y((v + .17) * 1.5)); g.stroke(); }
  };
  const map = canvasTexture(PX, PY, g => {
    g.fillStyle = '#5f8f4a'; g.fillRect(0, 0, PX, PY);
    for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(${rnd(i, 1) < .5 ? '120,170,80' : '40,80,36'},${(.05 + rnd(i, 2) * .08).toFixed(3)})`; g.beginPath(); g.arc(rnd(i, 3) * PX, rnd(i, 4) * PY, 5 + rnd(i, 5) * 18, 0, 7); g.fill(); }
    // The first flush of autumn starts at the margin and the tip.
    for (const [width, strength] of [[70, .2], [42, .28], [20, .4]]) { g.strokeStyle = `rgba(201,106,43,${strength})`; g.lineWidth = width; outline(g); g.stroke(); }
    const tip = g.createLinearGradient(0, 0, 0, PY * .4); tip.addColorStop(0, 'rgba(201,106,43,.6)'); tip.addColorStop(1, 'rgba(201,106,43,0)'); g.fillStyle = tip; g.fillRect(0, 0, PX, PY * .4);
    // The veins a deeper green than the blade, faint and never lighter (#683), laid on whole at one strength.
    const lines = document.createElement('canvas'); lines.width = PX; lines.height = PY; veins(lines.getContext('2d'), '#2a4a1e', .85);
    g.globalAlpha = .3; g.drawImage(lines, 0, 0); g.globalAlpha = 1;
  }, { anisotropy: 8 });
  const alpha = canvasTexture(PX, PY, g => { g.fillStyle = '#000'; g.fillRect(0, 0, PX, PY); g.fillStyle = '#fff'; outline(g); g.fill(); }, { srgb: false });
  const bump = canvasTexture(PX, PY, g => { g.fillStyle = '#707070'; g.fillRect(0, 0, PX, PY); veins(g, '#5a5a5a', 1.5); }, { srgb: false });   // shallow grooves, not ridges that catch the light (#683)
  const geometries = [1, 2.6, 4.3].map(seed => {
    const geometry = new T.PlaneGeometry(1, 1.5, 10, 16); geometry.translate(0, .75, 0);
    const p = geometry.attributes.position;
    // Folded a little along the midrib, arched along its length, with a wavy margin.
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), v = p.getY(i) / 1.5; p.setZ(i, (.2 + .1 * Math.sin(seed)) * Math.abs(x) - (.28 + .1 * Math.cos(seed * 1.3)) * v * v + .05 * Math.sin(v * 9 + seed * 2) * Math.abs(x) * 2 + .06 * x * Math.sin(seed * 3 + v * 2)); }
    geometry.computeVertexNormals(); return kit.own(geometry);
  });
  const materials = new Map();
  return (scale, variant = 0, tint = 0xffffff) => {
    if (!materials.has(tint)) materials.set(tint, mat({ map, alphaMap: alpha, bumpMap: bump, bumpScale: .025, alphaTest: .5, side: T.DoubleSide, roughness: .42, clearcoat: .6, clearcoatRoughness: .3, color: tint }, .9));
    const group = new T.Group(), blade = new T.Mesh(geometries[((variant % 3) + 3) % 3], materials.get(tint)); blade.scale.setScalar(scale); blade.position.y = .1 * scale;
    group.add(kit.line([kit.V(), kit.V(0, .12 * scale, 0)], 0x7a8a4a, .9), blade);
    return group;
  };
}
