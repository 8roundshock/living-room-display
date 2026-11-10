// Small form helpers introduced by Seollal (#628) and used by the other Korean scenes (#629 to
// #631): a tapered tube, a twisted two-colour cord, a smooth step. See ../README.md.

/** A tube along `curve` whose radius is `radiusAt(0-1 along it)`: a branch, a table leg, a stalk. */
export function taperTube(kit, curve, radiusAt, segments = 40, radial = 8) {
  const { T, V } = kit, geometry = new T.TubeGeometry(curve, segments, 1, radial), p = geometry.attributes.position, centre = V(), ring = radial + 1;
  for (let i = 0; i <= segments; i++) {
    const k = radiusAt(i / segments); curve.getPointAt(i / segments, centre);
    for (let j = 0; j < ring; j++) { const v = i * ring + j; p.setXYZ(v, centre.x + (p.getX(v) - centre.x) * k, centre.y + (p.getY(v) - centre.y) * k, centre.z + (p.getZ(v) - centre.z) * k); }
  }
  return geometry;
}

/** A twisted two-colour cord as a material: diagonal stripes that repeat `turns` times along a tube or a torus. */
export function cordMaterial(kit, first, second, turns = 12) {
  const { T } = kit, css = colour => `#${new T.Color(colour).getHexString()}`;
  const texture = kit.canvasTexture(32, 32, g => {
    g.fillStyle = css(first); g.fillRect(0, 0, 32, 32); g.strokeStyle = css(second); g.lineWidth = 11;
    for (let i = -1; i < 3; i++) { g.beginPath(); g.moveTo(i * 32 - 4, 36); g.lineTo(i * 32 + 36, -4); g.stroke(); }
  }, { repeat: true });
  texture.repeat.set(turns, 1);
  return kit.mat({ map: texture, roughness: .55, metalness: .1 }, .6, false);
}

/** Smooth 0-1 step of `x` between `from` and `to`. */
export const smooth = (x, from, to) => { const k = Math.min(1, Math.max(0, (x - from) / (to - from))); return k * k * (3 - 2 * k); };
