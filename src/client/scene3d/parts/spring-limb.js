// Wood and stems: a round limb swept along a curve with its own thickness at every point, and
// matte bark. Introduced by Spring (#613); the four season scenes build their branches, twigs,
// stalks and vine stems with it. A part: plain functions of the kit. See ../README.md.

/** Matte bark with lengthwise streaks in its relief. `see` is the share of the see-through look
 * the wood takes: wood should stay a line that can be followed back to the frame edge. */
export function bark(kit, colour, { see = .45, env = .3, relief = .02, salt = 0 } = {}) {
  const { rnd } = kit;
  const bump = kit.canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = rnd(i, 61 + salt) * w, y = rnd(i, 62 + salt) * h, length = 30 + rnd(i, 63 + salt) * 150, value = rnd(i, 64 + salt) < .5 ? 30 : 225;
      g.fillStyle = `rgba(${value},${value},${value},${.2 + rnd(i, 65 + salt) * .4})`;
      for (const shift of [0, -w]) g.fillRect(x + shift, y, length, 1 + rnd(i, 66 + salt) * 2.5);
    }
  }, { srgb: false, repeat: true });
  return kit.mat({ color: colour, roughness: .85, metalness: 0, bumpMap: bump, bumpScale: relief, see }, env, false);
}

/** A thickness that runs from `from` at the start of a limb to `to` at its tip. */
export const taper = (from, to, ease = 1) => t => from + (to - from) * Math.pow(t, ease);

/** A limb through `points`. `radius(t)` is its thickness at 0-1 along it (see taper).
 * Returns the mesh; `mesh.userData` has `at(t)` and `dir(t)` (point and direction along it),
 * `length` and `radius`. */
export function limb(kit, points, radius, material, { sides = 7, steps = 0 } = {}) {
  const { T, V } = kit, curve = new T.CatmullRomCurve3(points, false, 'centripetal'), length = curve.getLength(), n = steps || Math.max(6, Math.round(length / .08));
  const geometry = new T.TubeGeometry(curve, n, 1, sides, false), p = geometry.attributes.position, uv = geometry.attributes.uv, centre = V();
  // The tube is swept with radius 1, so each ring is scaled about its centre; its normals stay radial.
  for (let ring = 0; ring <= n; ring++) {
    const t = ring / n, r = radius(t); curve.getPointAt(t, centre);
    for (let j = 0; j <= sides; j++) { const v = ring * (sides + 1) + j; p.setXYZ(v, centre.x + (p.getX(v) - centre.x) * r, centre.y + (p.getY(v) - centre.y) * r, centre.z + (p.getZ(v) - centre.z) * r); uv.setX(v, t * length * 1.5); }
  }
  const mesh = new T.Mesh(geometry, material);
  mesh.userData = { at: t => curve.getPointAt(Math.min(1, Math.max(0, t))), dir: t => curve.getTangentAt(Math.min(1, Math.max(0, t))).normalize(), length, radius };
  return mesh;
}
