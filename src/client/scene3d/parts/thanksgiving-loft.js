// Lofted shapes: a tube whose radius changes along a curve (a horn, a stem, a branch, a tendril)
// and the seam repair for a displaced sphere or lathe. Introduced by Thanksgiving (#607) for the
// horn of plenty and used by the other Western-occasion scenes. See ../README.md, "Shared parts".

/** A tube along `curve` (any three.js curve). `radiusAt(u)` is its radius at 0-1 along the curve.
 * `rings` and `sides` are the mesh density, `twist` turns the cross-section from end to end (in
 * turns), `repeat` is how often the UVs repeat [along, around], and `squash` flattens the
 * cross-section along the curve's binormal. Returns a geometry with position, normal and uv. */
export function loft(kit, curve, radiusAt, { rings = 40, sides = 10, twist = 0, repeat = [1, 1], squash = 1 } = {}) {
  const { T, V } = kit, frames = curve.computeFrenetFrames(rings, false), length = curve.getLength() || 1;
  const position = [], normal = [], uv = [], index = [], point = V(), out = V();
  for (let i = 0; i <= rings; i++) {
    const u = i / rings, radius = radiusAt(u), ahead = Math.min(1, u + .01), behind = Math.max(0, u - .01), slope = (radiusAt(ahead) - radiusAt(behind)) / (length * (ahead - behind));
    curve.getPointAt(u, point);
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides + twist * u) * Math.PI * 2;
      out.copy(frames.normals[i]).multiplyScalar(Math.cos(angle)).addScaledVector(frames.binormals[i], Math.sin(angle) * squash);
      position.push(point.x + out.x * radius, point.y + out.y * radius, point.z + out.z * radius);
      out.addScaledVector(frames.tangents[i], -slope).normalize(); normal.push(out.x, out.y, out.z);
      uv.push(u * repeat[0], j / sides * repeat[1]);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) { const a = i * (sides + 1) + j, b = a + sides + 1; index.push(a, a + 1, b, b, a + 1, b + 1); }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3)); geometry.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geometry.setIndex(index);
  return geometry;
}

/** A smooth curve through points given as [x, y, z] triples. */
export const through = (kit, points) => new kit.T.CatmullRomCurve3(points.map(([x, y, z = 0]) => kit.V(x, y, z)));

/** Recompute the normals of a sphere geometry whose vertices were moved, and make them agree
 * along the seam, where the first and last vertex of each row are the same point. `columns` is
 * the number of segments around. Returns the geometry. */
export function smoothSeam(kit, geometry, columns) {
  geometry.computeVertexNormals();
  const normal = geometry.attributes.normal, rows = normal.count / (columns + 1);
  for (let row = 0; row < rows; row++) {
    const a = row * (columns + 1), b = a + columns, x = normal.getX(a) + normal.getX(b), y = normal.getY(a) + normal.getY(b), z = normal.getZ(a) + normal.getZ(b), length = Math.hypot(x, y, z) || 1;
    normal.setXYZ(a, x / length, y / length, z / length); normal.setXYZ(b, x / length, y / length, z / length);
  }
  return geometry;
}
