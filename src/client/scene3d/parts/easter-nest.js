// The twig nest of the Easter scene (#611): a bowl woven from thin curved twigs with a paler
// lining and a few loose ends, holding plain eggs that each differ in colour and finish. No
// bands, patterns or motifs on the eggs. Modelled at its on-screen size (about 1.5 wide);
// the caller scales it. See ../README.md, "Shared parts".

/** Egg finishes: matte speckled, satin, pearl and glass. */
const SHELLS = {
  speckled: (kit, colour, salt) => {
    const css = `#${new kit.T.Color(colour).getHexString()}`;
    const speckle = kit.canvasTexture(256, 256, g => { g.fillStyle = css; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${96 + Math.round(kit.rnd(i, salt + 1) * 40)},${62 + Math.round(kit.rnd(i, salt + 2) * 24)},34,${.25 + kit.rnd(i, salt + 3) * .5})`; g.beginPath(); g.arc(kit.rnd(i, salt + 4) * 256, kit.rnd(i, salt + 5) * 256, .5 + Math.pow(kit.rnd(i, salt + 6), 3) * 3.2, 0, 7); g.fill(); } });
    return kit.mat({ map: speckle, roughness: .82 }, .4, false);
  },
  satin: (kit, colour) => kit.mat({ color: colour, roughness: .44, metalness: .12 }, .9),
  pearl: (kit, colour) => kit.mat({ color: colour, roughness: .24, metalness: .1, clearcoat: 1, clearcoatRoughness: .14 }, 1),
  glass: (kit, colour) => kit.mat({ color: colour, roughness: .05, metalness: 0, clearcoat: 1, clearcoatRoughness: .04 }, 1.4),
};

/** One plain egg, `length` long, blunt end down, centred on the group's origin. */
export function egg(kit, { length = .4, colour = 0x9fd3d6, finish = 'speckled', salt = 0 } = {}) {
  const { T } = kit, points = [];
  for (let i = 0; i <= 36; i++) { const t = i / 36 * Math.PI; points.push(new T.Vector2(Math.max(.0001, Math.sin(t) * (1 + .17 * Math.cos(t)) * .37), -Math.cos(t) * .5)); }
  const mesh = new T.Mesh(new T.LatheGeometry(points, 36), (SHELLS[finish] ?? SHELLS.satin)(kit, colour, salt)); mesh.scale.setScalar(length);
  return mesh;
}

/** Where each egg lies in the bowl: [x, y, z, lean, turn]. */
const BEDS = [[-.22, .3, .06, .95, .3], [.2, .31, .1, -1.1, 1.2], [-.02, .29, -.22, .5, 2.2], [.02, .36, .3, 1.35, .7]];

/** A twig nest sitting on the group's origin, its bowl opening upward. `twigs` is how many twigs
 * it is woven from; `eggs` are options for `egg`, at most four. Tilt the group to show the eggs. */
export function nest(kit, { twigs = 220, eggs = [], salt = 0 } = {}) {
  const { T, C, rnd, mix } = kit, group = new T.Group(), count = Math.max(40, Math.round(twigs)), o = new T.Object3D();
  // Each twig is an arc of a ring lying around the bowl, tipped a little out of level.
  const weave = new T.InstancedMesh(new T.TorusGeometry(1, .017, 4, 14, 2.3), kit.mat({ color: 0xffffff, roughness: .8 }, .35, false), count);
  for (let i = 0; i < count; i++) {
    const lining = i % 4 === 0, height = lining ? .04 + rnd(i, salt + 1) * .1 : Math.pow(rnd(i, salt + 1), .8) * .38;
    const ring = lining ? .12 + rnd(i, salt + 2) * .26 : .33 + .41 * Math.pow(height / .38, .7) + (rnd(i, salt + 2) - .5) * .1, wild = rnd(i, salt + 3) < .12 ? 2.4 : 1;
    o.position.set((rnd(i, salt + 4) - .5) * .07, height, (rnd(i, salt + 5) - .5) * .07);
    o.rotation.set(Math.PI / 2 + (rnd(i, salt + 6) - .5) * .42 * wild, rnd(i, salt + 7) * Math.PI * 2, (rnd(i, salt + 8) - .5) * .42 * wild, 'YZX'); o.scale.setScalar(ring); o.updateMatrix(); weave.setMatrixAt(i, o.matrix);
    weave.setColorAt(i, C(lining ? mix(0xc9b07a, 0xe0d0a0, rnd(i, salt + 9)) : mix(mix(0x8a6f4e, 0x5f4a32, rnd(i, salt + 9)), 0xc9b07a, rnd(i, salt + 10) < .3 ? .7 : .08)));
  }
  weave.instanceColor.needsUpdate = true; weave.frustumCulled = false; group.add(weave);
  // A few loose ends stick out past the rim.
  const stick = new T.CylinderGeometry(.006, .009, 1, 4, 1, true); stick.translate(0, .5, 0);
  const ends = new T.InstancedMesh(stick, weave.material, 16);
  for (let i = 0; i < 16; i++) {
    const angle = rnd(i, salt + 11) * Math.PI * 2, ring = .62 + rnd(i, salt + 12) * .14;
    o.position.set(Math.cos(angle) * ring, .24 + rnd(i, salt + 13) * .2, Math.sin(angle) * ring);
    o.rotation.set((rnd(i, salt + 14) - .5) * 1.4, -angle + (rnd(i, salt + 15) - .5) * 1.2, -Math.PI / 2 + (rnd(i, salt + 16) - .5) * 1.1, 'YZX'); o.scale.set(1, .22 + rnd(i, salt + 17) * .3, 1); o.updateMatrix(); ends.setMatrixAt(i, o.matrix);
    ends.setColorAt(i, C(mix(0x8a6f4e, 0xc9b07a, rnd(i, salt + 18))));
  }
  ends.instanceColor.needsUpdate = true; ends.frustumCulled = false; group.add(ends);
  eggs.slice(0, BEDS.length).forEach((options, i) => { const [x, y, z, lean, turn] = BEDS[i], laid = egg(kit, { ...options, salt: salt + 20 + i }); laid.position.set(x, y, z); laid.rotation.set(.25, turn, lean); group.add(laid); });
  return group;
}
