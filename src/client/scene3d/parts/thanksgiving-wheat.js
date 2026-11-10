// The bound wheat sheaf of the Thanksgiving scene (#607): bearded wheat tied at the waist with
// twine, the stalks fanning out below the tie and the ears nodding outward above it. Stalks,
// kernels and awns are three instanced meshes. Modelled at its on-screen size (about 3.8 tall,
// 1.6 wide at the head); the caller scales it. See ../README.md, "Shared parts".

const WAIST = 1.35;

/** A wheat sheaf standing on the group's origin. `stalks` is how many; the ears nod very
 * slightly in three groups, out of step. */
export function sheaf(kit, { stalks = 46, salt = 0 } = {}) {
  const { T, V, C, rnd, mix, tick } = kit, group = new T.Group(), count = Math.max(8, Math.round(stalks));
  const up = V(0, 1, 0), depth = V(0, 0, 1), turn = new T.Quaternion(), span = V();
  const list = () => ({ matrices: [], colours: [] });
  /** A piece from a to b: a stalk segment or an awn (unit geometry rising from its base). */
  const rod = (into, a, b, radius, colour) => { span.copy(b).sub(a); const length = span.length(); turn.setFromUnitVectors(up, span.normalize()); into.matrices.push(new T.Matrix4().compose(a, turn, V(radius, length, radius))); into.colours.push(colour); };
  /** A kernel centred at `at`, lying along `along`. */
  const kernel = (into, at, along, radius, half, colour) => { turn.setFromUnitVectors(up, along); into.matrices.push(new T.Matrix4().compose(at, turn, V(radius, half, radius * 1.25))); into.colours.push(colour); };
  const lower = list(), upper = [0, 1, 2].map(() => ({ stalks: list(), kernels: list(), awns: list() }));

  for (let i = 0; i < count; i++) {
    const angle = i * 2.39996 + rnd(i, salt + 1) * .6, spread = Math.sqrt((i + .5) / count), out = V(Math.cos(angle), 0, Math.sin(angle) * .62), set = upper[i % 3];
    const straw = mix(mix(0xd6b160, 0xb58f48, rnd(i, salt + 2)), 0xe3c27a, rnd(i, salt + 3) * .5);
    const waist = V(out.x * spread * .17, WAIST, out.z * spread * .2), foot = V(out.x * (.16 + spread * .56), -.45, out.z * (.16 + spread * .56));
    rod(lower, foot, waist, .0135, straw);
    // Above the tie the stalk bends outward; the outer ones lean further and stand a little shorter.
    const rise = (1.42 + rnd(i, salt + 4) * .62) * (1 - .14 * spread), lean = spread * (.3 + rnd(i, salt + 5) * .42);
    const bend = waist.clone().add(V(out.x * lean * .12, rise * .58, out.z * lean * .12)), top = waist.clone().add(V(out.x * lean, rise, out.z * lean));
    const along = u => waist.clone().multiplyScalar((1 - u) * (1 - u)).addScaledVector(bend, 2 * u * (1 - u)).addScaledVector(top, u * u);
    for (let k = 0; k < 4; k++) rod(set.stalks, along(k / 4), along((k + 1) / 4), .0125 - k * .001, straw);
    // The ear: kernels in two rows, each leaning out from the axis, and long awns beyond them.
    const axis = top.clone().sub(bend).normalize().addScaledVector(out, .3 * spread).add(V(0, -.1 - rnd(i, salt + 6) * .22, 0)).normalize(), length = .5 + rnd(i, salt + 7) * .16;
    const side = V().crossVectors(axis, depth); if (side.lengthSq() < .01) side.set(1, 0, 0); side.normalize();
    for (let k = 0; k < 22; k++) {
      const sign = k % 2 ? 1 : -1, at = ((k >> 1) + (sign > 0 ? .5 : 0)) / 11.5, slim = 1 - .4 * at, gold = mix(mix(0xd29c3c, 0xeaa930, rnd(i * 22 + k, salt + 8)), 0xa06c22, rnd(i * 22 + k, salt + 9) * .45);
      const centre = top.clone().addScaledVector(axis, (at + .03) * length).addScaledVector(side, sign * .021 * slim), tilt = axis.clone().multiplyScalar(.88).addScaledVector(side, sign * .46).normalize();
      kernel(set.kernels, centre, tilt, .027 * slim, .054 * slim, gold);
      if ((k + i) % 2 === 0) {
        const reach = axis.clone().addScaledVector(side, sign * (.12 + rnd(i * 22 + k, salt + 10) * .16)).add(V(0, 0, (rnd(i * 22 + k, salt + 11) - .5) * .25)).normalize(), start = centre.clone().addScaledVector(tilt, .045 * slim);
        rod(set.awns, start, start.clone().addScaledVector(reach, .3 + rnd(i * 22 + k, salt + 12) * .32), .0062, mix(0xe8d08a, 0xcfa85c, rnd(i * 22 + k, salt + 13)));
      }
    }
  }

  const segment = new T.CylinderGeometry(1, 1, 1, 5, 1, true); segment.translate(0, .5, 0);
  const awn = new T.ConeGeometry(1, 1, 3, 1, true); awn.translate(0, .5, 0);
  const grain = new T.SphereGeometry(1, 6, 4);
  const strawMaterial = kit.mat({ color: 0xffffff, roughness: .62 }, .5, false), grainMaterial = kit.mat({ color: 0xffffff, roughness: .42, clearcoat: .35, clearcoatRoughness: .4 }, .8), awnMaterial = kit.mat({ color: 0xffffff, roughness: .5 }, .6, false);
  const instanced = (geometry, material, { matrices, colours }) => {
    const mesh = new T.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((matrix, i) => { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, C(colours[i])); });
    mesh.frustumCulled = false; return mesh;
  };
  group.add(instanced(segment, strawMaterial, lower));
  const heads = upper.map(set => { const pivot = new T.Group(); pivot.position.y = WAIST; for (const mesh of [instanced(segment, strawMaterial, set.stalks), instanced(grain, grainMaterial, set.kernels), instanced(awn, awnMaterial, set.awns)]) { mesh.position.y = -WAIST; pivot.add(mesh); } group.add(pivot); return pivot; });
  tick(t => heads.forEach((pivot, k) => { pivot.rotation.z = Math.sin(t * .45 + k * 2.1) * .0105; }));

  // Twine wound three times round the waist, knotted in front, two loose ends.
  const twine = kit.mat({ color: 0xa98c5a, roughness: .78 }, .4, false);
  for (let k = 0; k < 3; k++) {
    const band = new T.Mesh(new T.TorusGeometry(.2, .017, 6, 30), twine);
    band.scale.set(1, .74, 1); band.rotation.set(Math.PI / 2 + (rnd(k, salt + 20) - .5) * .2, 0, (rnd(k, salt + 21) - .5) * .14); band.position.y = WAIST + (k - 1) * .036; group.add(band);
  }
  const knot = new T.Mesh(kit.ballGeo, twine); knot.scale.set(.034, .028, .028); knot.position.set(.03, WAIST, .16); group.add(knot);
  for (const [dx, drop] of [[-.09, .42], [.13, .6]]) {
    const points = []; for (let k = 0; k <= 10; k++) { const u = k / 10; points.push(V(.03 + dx * Math.sin(u * 1.7), WAIST - drop * u, .165 + Math.sin(u * 3) * .025)); }
    group.add(new T.Mesh(kit.ribbonGeo(points, .028, V(1, 0, 0)), kit.mat({ color: 0xa98c5a, roughness: .78, side: T.DoubleSide }, .4, false)));
  }
  return group;
}
