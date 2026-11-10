// Tapered tubes and merged geometry (#622). Branch wood, twigs, flower stems, drips: many thin
// round things along a path, kept in one mesh so a plant costs one draw call, not one per twig.
// Used by the Russian scene family (#622 to #627); nothing here is specific to an occasion.

/** A collector of tapered round tubes. add() as many as needed, then mesh(material) or geometry() once.
 * Colours are linear (kit.C); a material shows them when it has `vertexColors: true`. */
export function tubes(kit, sides = 6) {
  const { T, V } = kit, position = [], normal = [], colour = [], uv = [], index = [];
  const tangent = V(), side = V(), other = V(), white = new T.Color(1, 1, 1);
  const collector = {
    /** One tube along `points`, radius `from` at its start to `to` at its end. `radiusAt(k, radius)` may reshape it along 0-1. */
    add(points, from, to = from, start = white, end = start, radiusAt = null) {
      const last = points.length - 1, base = position.length / 3;
      for (let i = 0; i <= last; i++) {
        tangent.copy(points[Math.min(last, i + 1)]).sub(points[Math.max(0, i - 1)]).normalize();
        if (!i) { side.set(0, 0, 1).cross(tangent); if (side.lengthSq() < 1e-4) side.set(1, 0, 0); side.normalize(); }
        else side.addScaledVector(tangent, -side.dot(tangent)).normalize();
        other.crossVectors(tangent, side);
        const k = i / last, straight = from + (to - from) * k, radius = radiusAt ? radiusAt(k, straight) : straight, at = points[i];
        for (let j = 0; j < sides; j++) {
          const a = j / sides * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), nx = side.x * c + other.x * s, ny = side.y * c + other.y * s, nz = side.z * c + other.z * s;
          normal.push(nx, ny, nz); position.push(at.x + nx * radius, at.y + ny * radius, at.z + nz * radius); uv.push(j / sides, k);
          colour.push(start.r + (end.r - start.r) * k, start.g + (end.g - start.g) * k, start.b + (end.b - start.b) * k);
        }
        if (i) for (let j = 0; j < sides; j++) { const a0 = base + (i - 1) * sides + j, a1 = base + (i - 1) * sides + (j + 1) % sides, b0 = a0 + sides, b1 = a1 + sides; index.push(a0, a1, b0, a1, b1, b0); }
      }
      return collector;
    },
    geometry() {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3)); geometry.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
      geometry.setAttribute('color', new T.Float32BufferAttribute(colour, 3)); geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geometry.setIndex(index);
      return geometry;
    },
    mesh(material) { const mesh = new T.Mesh(collector.geometry(), material); mesh.frustumCulled = false; return mesh; },
  };
  return collector;
}

/** Several indexed geometries with position (and optionally uv) as one geometry with fresh normals. The sources are released. */
export function merged(kit, geometries) {
  const { T } = kit, position = [], uv = [], index = [];
  for (const geometry of geometries) {
    const base = position.length / 3, p = geometry.attributes.position, t = geometry.attributes.uv, order = geometry.index;
    for (let i = 0; i < p.count; i++) { position.push(p.getX(i), p.getY(i), p.getZ(i)); uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0); }
    if (order) for (let i = 0; i < order.count; i++) index.push(base + order.getX(i)); else for (let i = 0; i < p.count; i++) index.push(base + i);
    geometry.dispose();
  }
  const result = new T.BufferGeometry();
  result.setAttribute('position', new T.Float32BufferAttribute(position, 3)); result.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); result.setIndex(index); result.computeVertexNormals();
  return result;
}

/** Smooth points through a few [x, y, z] triples (a Catmull-Rom curve), for tubes and ribbons. */
export function through(kit, triples, count = 24) { return new kit.T.CatmullRomCurve3(triples.map(([x, y, z]) => kit.V(x, y, z))).getPoints(count); }

/** A lathe from [radius, y] pairs listed from the bottom up (outer faces) or the top down (inner faces). */
export function turned(kit, profile, segments = 48) { return new kit.T.LatheGeometry(profile.map(([radius, y]) => new kit.T.Vector2(Math.max(radius, .0001), y)), segments); }

/** Fresh smooth normals for a sphere-like grid that was reshaped: `columns` is its width segments. Hides the seam. */
export function resmooth(geometry, columns) {
  geometry.computeVertexNormals();
  const n = geometry.attributes.normal, row = columns + 1;
  for (let i = 0; i + columns < n.count; i += row) {
    const x = n.getX(i) + n.getX(i + columns), y = n.getY(i) + n.getY(i + columns), z = n.getZ(i) + n.getZ(i + columns), length = Math.hypot(x, y, z) || 1;
    n.setXYZ(i, x / length, y / length, z / length); n.setXYZ(i + columns, x / length, y / length, z / length);
  }
  return geometry;
}

/** The same for a full-turn lathe that was reshaped: `profile` is the number of points in its profile. */
export function relathe(geometry, profile) {
  geometry.computeVertexNormals();
  const n = geometry.attributes.normal, last = n.count - profile;
  for (let j = 0; j < profile; j++) {
    const x = n.getX(j) + n.getX(last + j), y = n.getY(j) + n.getY(last + j), z = n.getZ(j) + n.getZ(last + j), length = Math.hypot(x, y, z) || 1;
    n.setXYZ(j, x / length, y / length, z / length); n.setXYZ(last + j, x / length, y / length, z / length);
  }
  return geometry;
}
