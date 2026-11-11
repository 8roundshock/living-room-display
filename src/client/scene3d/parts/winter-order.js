// A fixed drawing order for pieces that keep still (#663, introduced by Winter, #665).
// three.js draws see-through meshes from the farthest origin to the nearest, and with the
// kit's look every mesh is see-through: what is drawn first hides what is drawn later behind
// it. So the order of two overlapping pieces is decided by where their origins are, not by
// where the pieces are. A piece is built where it belongs, in world coordinates, and then
// given the origin the scene wants for it; no renderOrder is used, which would also lift a
// piece over weather that passes in front of it (#662). A part: plain functions of the kit.

/** Give `object` (a mesh or an instanced mesh built in world coordinates) the origin `about`,
 * without moving anything it draws. Returns the object. */
export function settle(kit, object, about) {
  const { T } = kit;
  if (object.isInstancedMesh) {
    const shift = new T.Matrix4().makeTranslation(-about.x, -about.y, -about.z), one = new T.Matrix4();
    for (let i = 0; i < object.count; i++) { object.getMatrixAt(i, one); object.setMatrixAt(i, one.premultiply(shift)); }
    object.instanceMatrix.needsUpdate = true;
  } else object.geometry.translate(-about.x, -about.y, -about.z);
  object.position.copy(about);
  return object;
}

/** Several still meshes that share one look, as a single mesh in world coordinates: each
 * mesh's place, turn and size go into the geometry and its own normals are kept. The meshes
 * are drawn in the order given, every time. */
export function fused(kit, meshes, material) {
  const { T } = kit, position = [], normal = [], uv = [], index = [], at = new T.Vector3(), turn = new T.Matrix3();
  for (const mesh of meshes) {
    mesh.updateMatrix(); turn.getNormalMatrix(mesh.matrix);
    const { position: p, normal: n, uv: t } = mesh.geometry.attributes, order = mesh.geometry.index, base = position.length / 3;
    for (let i = 0; i < p.count; i++) {
      at.fromBufferAttribute(p, i).applyMatrix4(mesh.matrix); position.push(at.x, at.y, at.z);
      at.fromBufferAttribute(n, i).applyMatrix3(turn).normalize(); normal.push(at.x, at.y, at.z);
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    if (order) for (let i = 0; i < order.count; i++) index.push(base + order.getX(i)); else for (let i = 0; i < p.count; i++) index.push(base + i);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3)); geometry.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geometry.setIndex(index);
  const one = new T.Mesh(geometry, material); one.frustumCulled = false;
  return one;
}
