// The cobweb of the Halloween scene (#608): a quarter of an orb web spun into a corner, in
// hair-fine threads that sag a little under small beads of dew. No spider. One line mesh, one
// instanced mesh of beads and a few glints. See ../README.md, "Shared parts".

/** A quarter web. The group's origin is the hub, which belongs just outside a top corner; the
 * web spreads toward -x and -y (mirror the group for the other corner). `reach` is how far it
 * runs along the two edges, `dew` the number of beads. It sways very slightly as one piece. */
export function cobweb(kit, { radials = 9, rows = 11, reach = 4, dew = 70, salt = 0 } = {}) {
  const { T, V, C, rnd, tick } = kit, group = new T.Group(), segments = [], spans = [];
  const thread = (a, b) => { segments.push(a.x, a.y, a.z, b.x, b.y, b.z); };
  /** A thread that sags under its own weight: `at(u)` is the point at 0-1 along it. */
  const hang = (a, b, sag) => { const middle = a.clone().add(b).multiplyScalar(.5).add(V(0, -sag * 2, 0)); return u => a.clone().multiplyScalar((1 - u) * (1 - u)).addScaledVector(middle, 2 * u * (1 - u)).addScaledVector(b, u * u); };
  const strung = (at, steps = 5) => { for (let k = 0; k < steps; k++) thread(at(k / steps), at((k + 1) / steps)); };

  // Radial threads fan through the quarter; each ends on the frame thread, which the web pulls a little inward.
  const spokes = [];
  for (let i = 0; i < radials; i++) {
    const angle = Math.PI + (i + (i && i < radials - 1 ? (rnd(i, salt + 1) - .5) * .5 : 0)) / (radials - 1) * Math.PI / 2, direction = V(Math.cos(angle), Math.sin(angle), 0);
    const length = reach / (Math.abs(direction.x) + Math.abs(direction.y)) * (.93 + rnd(i, salt + 2) * .1);
    spokes.push({ direction, length, tip: direction.clone().multiplyScalar(length) }); thread(V(), spokes[i].tip);
  }
  for (let i = 0; i < radials - 1; i++) strung(hang(spokes[i].tip, spokes[i + 1].tip, .03));
  // Rows of cross-threads, each a short sagging span between two neighbouring spokes. Irregular on purpose.
  const node = (i, j) => spokes[i].direction.clone().multiplyScalar((.42 + (reach - .5) * Math.pow((j + 1 + i * .09) / rows, 1.12)) * (1 + (rnd(i * 31 + j, salt + 3) - .5) * .06));
  const MISSING = new Set(['3:5', '5:8', '2:9']);
  for (let j = 0; j < rows; j++) for (let i = 0; i < radials - 1; i++) {
    const a = node(i, j), b = node(i + 1, j);
    if (a.length() > spokes[i].length - .1 || b.length() > spokes[i + 1].length - .1 || MISSING.has(`${i}:${j}`)) continue;
    const at = hang(a, b, .03 + rnd(i * 17 + j, salt + 4) * .045); strung(at); if (j >= 3) spans.push(at);
  }
  // One loose thread hangs where a span broke.
  { const from = node(3, 5), loose = hang(from, from.clone().add(V(.16, -.62, 0)), -.05); strung(loose, 8); }
  const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(segments, 3));
  group.add(new T.LineSegments(geometry, new T.LineBasicMaterial({ color: C(0xcfd6e6), transparent: true, opacity: .5 })));

  // Dew: clear beads strung under the outer spans, and a few of them catching the light.
  const count = Math.min(Math.round(dew), spans.length * 3), beads = new T.InstancedMesh(kit.ballGeo, kit.mat({ color: 0xffffff, roughness: 0, metalness: 0, clearcoat: 1, clearcoatRoughness: 0 }, 2.4), count), o = new T.Object3D();
  for (let i = 0; i < count; i++) {
    const at = spans[Math.floor(rnd(i, salt + 5) * spans.length)](.12 + rnd(i, salt + 6) * .76), radius = .012 + Math.pow(rnd(i, salt + 7), 2) * .02;
    o.position.set(at.x, at.y - radius * .7, at.z); o.scale.set(radius, radius * 1.12, radius); o.updateMatrix(); beads.setMatrixAt(i, o.matrix);
    if (i % Math.max(1, Math.floor(count / 6)) === 0) { const glint = kit.glow(0xe8f0ff, .2 + radius * 4, .5, { twinkle: .7 }); glint.position.copy(o.position); group.add(glint); }
  }
  beads.frustumCulled = false; group.add(beads);
  tick(t => { group.rotation.z = Math.sin(t * .3) * .007; });
  return group;
}
