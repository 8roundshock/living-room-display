// Thin botanical surfaces as real geometry: petals, leaf blades, funnels and teardrops whose
// outline is in the mesh, so an edge stays crisp at any size and each side of a surface can
// carry its own colour. Introduced by Spring (#613); used by the four season scenes.
// A part: plain functions of the kit, no state at module level. See ../README.md.

/** A colour ramp. `stops` are [position 0-1, sRGB colour] in rising order; returns at(t), which
 * gives the linear [r, g, b] a vertex colour needs. */
export function ramp(kit, stops) {
  const colours = stops.map(([, colour]) => new kit.T.Color(colour)), c = new kit.T.Color();
  return t => {
    let i = 0; while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const a = stops[i][0], b = stops[i + 1][0], k = Math.min(1, Math.max(0, (t - a) / (b - a || 1)));
    c.copy(colours[i]).lerp(colours[i + 1], k).convertSRGBToLinear(); return [c.r, c.g, c.b];
  };
}

/** A collector of grid surfaces that become one geometry, so a whole flower is one draw call.
 * Colours are per vertex: give the mesh a material with `vertexColors: true`. */
export function sheets(kit) {
  const { T } = kit, position = [], uv = [], colour = [], index = [], seams = [], at = new T.Vector3();
  const api = {
    /** A grid of `cols` x `rows` cells. `point(u, v, out)` writes the position for u and v in 0-1
     * into the vector `out`. The front is the side from which u runs to the right and v runs up.
     * `tint(u, v, back)` returns linear [r, g, b]. Options: `matrix` places the grid; `back` adds
     * the other side as faces of its own, for a FrontSide material whose two sides differ;
     * `wrap` joins u = 0 to u = 1 smoothly (a tube, a funnel); `map(u, v)` returns texture
     * coordinates when they are not simply u and v. */
    add(cols, rows, point, tint, { matrix = null, back = false, wrap = false, map = null } = {}) {
      for (const flip of back ? [false, true] : [false]) {
        const first = position.length / 3;
        for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
          const u = i / cols, v = j / rows; point(u, v, at); if (matrix) at.applyMatrix4(matrix);
          position.push(at.x, at.y, at.z);
          const st = map ? map(u, v) : [u, v], rgb = tint(u, v, flip); uv.push(st[0], st[1]); colour.push(rgb[0], rgb[1], rgb[2]);
        }
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const p = first + j * (cols + 1) + i, q = p + cols + 1;
          if (flip) index.push(p, q, p + 1, p + 1, q, q + 1); else index.push(p, p + 1, q, p + 1, q + 1, q);
        }
        if (wrap) for (let j = 0; j <= rows; j++) seams.push(first + j * (cols + 1), first + j * (cols + 1) + cols);
      }
      return api;
    },
    /** A surface of revolution about the y axis, facing outward when y rises with v.
     * `profile(v)` returns [radius, y]; `swell(angle, v)` may scale the radius around the turn;
     * `bend(v)` may shift the ring sideways (a bud with a leaning tip). */
    turn(cols, rows, profile, tint, { swell = null, bend = null, ...options } = {}) {
      return api.add(cols, rows, (u, v, out) => {
        const a = u * Math.PI * 2, [radius, y] = profile(v), r = radius * (swell ? swell(a, v) : 1);
        out.set(Math.sin(a) * r + (bend ? bend(v) : 0), y, Math.cos(a) * r);
      }, tint, { ...options, wrap: true });
    },
    get triangles() { return index.length / 3; },
    geometry() {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3)); geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geometry.setAttribute('color', new T.Float32BufferAttribute(colour, 3)); geometry.setIndex(index); geometry.computeVertexNormals();
      // A wrapped grid has two columns in the same place: give both the same normal, or the join shows as a crease.
      const normal = geometry.attributes.normal, sum = new T.Vector3();
      for (let k = 0; k < seams.length; k += 2) {
        const a = seams[k], b = seams[k + 1]; sum.set(normal.getX(a) + normal.getX(b), normal.getY(a) + normal.getY(b), normal.getZ(a) + normal.getZ(b)).normalize();
        normal.setXYZ(a, sum.x, sum.y, sum.z); normal.setXYZ(b, sum.x, sum.y, sum.z);
      }
      return geometry;
    },
  };
  return api;
}

/** Turn `object` so that its +y points along `tip` and its +z as nearly toward `face` as that
 * allows: a leaf or flower is built tip-up and face-forward, then aimed. Returns the object. */
export function aim(kit, object, tip, face) {
  const { T } = kit, y = tip.clone().normalize(), z = face.clone().addScaledVector(y, -face.dot(y));
  if (z.lengthSq() < 1e-6) { z.set(Math.abs(y.z) < .9 ? 0 : 1, 0, Math.abs(y.z) < .9 ? 1 : 0); z.addScaledVector(y, -z.dot(y)); }
  z.normalize(); object.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3().crossVectors(y, z), y, z)); return object;
}

/** A leaf blade spread around the point where its stalk joins it (the origin), tip toward +y,
 * face toward +z. `reach(angle)` is the outline: the distance to the edge at an angle measured
 * from the tip, from -spread to +spread (pi for a heart leaf, less for a fan). `lift(x, y, r, angle)`
 * gives the relief, with r the 0-1 share of the way to the edge. `tint(u, v)` colours it as in
 * sheets().add. Texture coordinates are polar (u across the spread, v out to the edge) unless
 * `flat` gives the [left, bottom, width, height] of the blade's own plane to map instead. */
export function blade(kit, collector, { spread = Math.PI, reach, lift = () => 0, tint, cols = 36, rows = 8, flat = null, matrix = null, back = false }) {
  const place = (u, v) => { const a = (u * 2 - 1) * spread, r = v * reach(a); return [Math.sin(a) * r, Math.cos(a) * r, a]; };
  return collector.add(cols, rows, (u, v, out) => { const [x, y] = place(u, v); out.set(x, y, lift(x, y, v, (u * 2 - 1) * spread)); }, tint,
    { matrix, back, map: flat ? (u, v) => { const [x, y] = place(u, v); return [(x - flat[0]) / flat[2], (y - flat[1]) / flat[3]]; } : null });
}
