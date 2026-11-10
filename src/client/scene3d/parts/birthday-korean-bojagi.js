// Bojagi-wrapped gifts for the Korean-accent birthday (#631): a square of silk drawn up around
// the gift and tied on top by its own corners, so there is no ribbon and no bow. The reverse of
// the knotted corners shows the lining. Saekdong, the many-coloured stripe of children's festive
// sleeves, appears only as the lining of one bundle: a glimpse, never a main motif. See ../README.md.

/** Saekdong without black, muted for the screen. */
const SAEKDONG = ['#d8433b', '#f5cf52', '#f6efe2', '#3f8f6a', '#f08fb0', '#3f6fc0', '#f6efe2', '#e98a3a'];

/** A cloth corner standing out of the knot: one unit long along +y, gathered at its base, wide
 * below the middle and drawn to a point; its outer face is +z. `droop` bends it over. */
function earGeometry(kit, droop, seed) {
  const { T } = kit, geometry = new T.PlaneGeometry(1, 1, 6, 12), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2, v = p.getY(i) + .5, x = u * .5 * (v < .28 ? .3 + .7 * (v / .28) ** .8 : 1 - ((v - .28) / .72) ** 1.25);
    p.setXYZ(i, x, v - droop * .35 * v * v * v, -.5 * x * x + .07 * Math.cos(u * 3.4 + seed) * (1 - v) + droop * v * v + .05 * Math.sin(v * 5 + seed) * u);
  }
  geometry.computeVertexNormals(); return geometry;
}

/** A wrapped bundle standing on y = 0, `width` x `height` x `depth`. `ears` is 'upright' (four
 * corners standing around the knot) or 'lying' (two long corners lying over to the sides).
 * `striped` gives the lining saekdong stripes instead of the plain `lining` colour. */
export function bojagiGift(kit, { width = 1.6, height = 1.05, depth = 1.6, colour = 0x2fc9a3, lining = 0xff7f9c, ears = 'upright', striped = false, salt = 1 } = {}) {
  const { T, V, rnd, mat, canvasTexture } = kit, group = new T.Group(), css = `#${new T.Color(colour).getHexString()}`, unit = Math.min(width, depth);
  // The texture runs once around the bundle and from its foot to the knot, so every fold that
  // reaches the top edge of the canvas runs into the knot.
  const folds = (g, raised) => {
    g.lineCap = 'round';
    const fold = (from, to, start, strength, width, i) => { g.strokeStyle = raised ? `rgba(${i % 2 ? '255,255,255' : '0,0,0'},${strength * 2.4})` : `rgba(${i % 2 ? '255,255,255' : '0,26,20'},${strength * .55})`; g.lineWidth = width; g.beginPath(); g.moveTo(from, 256 * start); g.quadraticCurveTo((from + to) / 2, 256 * start * .5, to, 0); g.stroke(); };
    for (let c = 0; c < 4; c++) {
      // The cloth is pulled hardest from each corner of the gift; softer folds cross each face.
      const corner = (.125 + c * .25) * 512, face = c * .25 * 512;
      for (let i = 0; i < 6; i++) fold(corner + (i - 2.5) * 22 + (rnd(c * 6 + i, salt) - .5) * 12, corner + (i - 2.5) * 8, .8, .13, 2.5 + rnd(c * 6 + i, salt + 1) * 3.5, i);
      for (let i = 0; i < 3; i++) fold(face + (i - 1) * 26 + (rnd(c * 3 + i, salt + 2) - .5) * 14, face + (i - 1) * 16, .5, .07, 2 + rnd(c * 3 + i, salt + 3) * 2, i);
    }
    fold(-10, -6, .5, .07, 3, 1); fold(522, 518, .5, .07, 3, 0);
  };
  const map = canvasTexture(512, 256, g => { g.fillStyle = css; g.fillRect(0, 0, 512, 256); for (let x = 0; x < 512; x += 2) { g.fillStyle = `rgba(${x % 4 ? '255,255,255' : '0,20,16'},.025)`; g.fillRect(x, 0, 1, 256); } folds(g, false); }, { anisotropy: 8 });
  const bump = canvasTexture(512, 256, g => { g.fillStyle = '#787878'; g.fillRect(0, 0, 512, 256); folds(g, true); }, { srgb: false });
  const silk = { metalness: .2, roughness: .5, clearcoat: .3, clearcoatRoughness: .45, see: .75 };
  // The body: a box with soft corners, its top drawn up toward the knot.
  const geometry = new T.SphereGeometry(1, 56, 36), p = geometry.attributes.position, power = 4.5;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = (Math.abs(x) ** power + Math.abs(y) ** power + Math.abs(z) ** power) ** (-1 / power), middle = Math.max(0, 1 - Math.hypot(x * k, z * k));
    p.setXYZ(i, x * k * width / 2, (y * k * (1 + (y > 0 ? .24 * middle * middle : 0)) + 1) * height / 2, z * k * depth / 2);
  }
  geometry.computeVertexNormals();
  group.add(new T.Mesh(geometry, mat({ map, bumpMap: bump, bumpScale: .022, ...silk }, .7)));
  // The knot, and the corners of the cloth that come out of it.
  const top = height * 1.1, outer = mat({ color: colour, ...silk, side: T.FrontSide }, 1);
  const stripes = striped ? canvasTexture(64, 256, g => { const band = 256 / 14; for (let i = 0; i < 14; i++) { g.fillStyle = SAEKDONG[i % SAEKDONG.length]; g.fillRect(0, i * band, 64, band + 1); } }) : null;
  const inner = mat({ ...(stripes ? { map: stripes } : { color: lining }), ...silk, side: T.BackSide }, 1);
  const knot = new T.Mesh(kit.sphereGeo, mat({ color: colour, bumpMap: bump, bumpScale: .03, ...silk }, 1)); knot.scale.set(.13 * unit, .09 * unit, .13 * unit); knot.position.y = top; group.add(knot);
  const basis = new T.Matrix4(), x = V(), along = V(), out = V();
  const LAYOUT = ears === 'lying' ? [[.15, 1.32, .74, .34, .45], [3.3, 1.38, .82, .36, .5]] : [[.75, .5, .46, .3, .12], [2.3, .62, .5, .32, .16], [3.85, .55, .42, .28, .1], [5.45, .7, .48, .3, .2]];
  LAYOUT.forEach(([around, lean, length, breadth, droop], i) => {
    along.set(Math.sin(lean) * Math.cos(around), Math.cos(lean), Math.sin(lean) * Math.sin(around)); out.set(Math.cos(lean) * Math.cos(around), -Math.sin(lean), Math.cos(lean) * Math.sin(around)); x.crossVectors(along, out);
    const shape = earGeometry(kit, droop, salt + i * 2.1), ear = new T.Group(); ear.add(new T.Mesh(shape, outer), new T.Mesh(shape, inner));
    basis.makeBasis(x, along, out); ear.quaternion.setFromRotationMatrix(basis); ear.scale.set(breadth * unit, length * unit, length * unit); ear.position.set(Math.cos(around) * .07 * unit, top - .02 * unit, Math.sin(around) * .07 * unit); group.add(ear);
  });
  group.userData.knot = V(0, top, 0);
  return group;
}
