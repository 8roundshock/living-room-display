// The budding branch of the Easter scene (#611): a bare limb that grows in from a side edge
// and forks into two twigs that run on past the top edge, carrying glossy leaf buds and a few
// leaves that have just opened. No blossom. Modelled at its on-screen size; the caller scales
// it. See ../README.md, "Shared parts".
import { loft, through } from './thanksgiving-loft.js';

/** A forked branch. The group's origin is the fork; the limb comes in from +x (beyond the right
 * edge) and the two twigs leave upward. `buds` is how many leaf buds it carries. */
export function branch(kit, { buds = 14, salt = 0 } = {}) {
  const { T, V, C, rnd, mix } = kit, group = new T.Group(), o = new T.Object3D(), up = V(0, 1, 0);
  // Bark: long broken streaks, used as colour and as relief.
  const bark = kit.canvasTexture(256, 128, g => {
    g.fillStyle = '#4a3c33'; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 240; i++) { const y = rnd(i, salt + 1) * 128, x = rnd(i, salt + 2) * 256, length = 14 + rnd(i, salt + 3) * 60; g.strokeStyle = rnd(i, salt + 4) < .5 ? `rgba(28,20,16,${.2 + rnd(i, salt + 5) * .4})` : `rgba(132,110,92,${.12 + rnd(i, salt + 5) * .25})`; g.lineWidth = 1 + rnd(i, salt + 6) * 2.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + length, y + (rnd(i, salt + 7) - .5) * 5); g.stroke(); g.beginPath(); g.moveTo(x - 256, y); g.lineTo(x - 256 + length, y); g.stroke(); }
  }, { repeat: true, anisotropy: 4 });
  const wood = kit.mat({ map: bark, bumpMap: bark, bumpScale: .03, roughness: .9, see: .7 }, .3, false);
  const LIMBS = [
    // The limb from beyond the right edge to the fork, then two twigs and three twiglets: [points, radius at start, radius at end].
    [[[3.4, -.62, -.1], [2.3, -.3, -.05], [1.2, -.22, .02], [.4, -.12, .02], [0, 0, 0]], .17, .105],
    [[[0, 0, 0], [-.3, .55, .04], [-.75, 1.25, .08], [-1.05, 2.05, .06], [-1.5, 2.9, 0]], .1, .03],
    [[[0, 0, 0], [.34, .5, -.04], [.6, 1.2, -.1], [1.05, 1.9, -.12], [1.3, 2.9, -.1]], .092, .03],
    [[[1.5, -.24, 0], [1.42, .2, .1], [1.62, .66, .16], [1.56, 1.02, .2]], .045, .012],
    [[[-.62, 1.05, .07], [-1.02, 1.18, .16], [-1.4, 1.5, .2], [-1.62, 1.56, .22]], .035, .01],
    [[[.57, 1.12, -.1], [.2, 1.5, -.02], [.12, 1.92, .04]], .03, .01],
  ].map(([points, from, to]) => ({ curve: through(kit, points), from, to }));
  LIMBS.forEach(({ curve, from, to }, i) => group.add(new T.Mesh(loft(kit, curve, u => (from + (to - from) * u) * (i > 2 ? Math.min(1, Math.sqrt((1 - u) / .04)) : 1), { rings: i < 3 ? 36 : 16, sides: i < 3 ? 10 : 6, repeat: [curve.getLength() * 1.4, 1] }), wood)));

  const joint = new T.Mesh(kit.ballGeo, wood); joint.scale.setScalar(.108); group.add(joint);
  // Leaf buds: small glossy pointed drops, alternate along the twigs, pointing along the wood and a little out.
  const count = Math.max(4, Math.round(buds)), drop = new T.LatheGeometry(Array.from({ length: 13 }, (_, i) => { const s = i / 12; return new T.Vector2(Math.max(.0001, Math.sin(Math.PI * Math.pow(s, .62)) * (1 - .35 * s)), s * 3); }), 10);
  const bud = new T.InstancedMesh(drop, kit.mat({ color: 0xffffff, roughness: .22, clearcoat: 1, clearcoatRoughness: .15 }, 1), count);
  const SPOTS = [[1, .3], [2, .34], [1, .55], [2, .6], [1, .8], [2, .84], [0, .5], [3, .55], [4, .5], [5, .6], [1, .98], [2, .98], [3, .98], [4, .98], [5, .98], [0, .78], [0, .28], [1, .12]];
  const leafSpots = [];
  for (let i = 0; i < count; i++) {
    const [limb, along] = SPOTS[i % SPOTS.length], { curve, from, to } = LIMBS[limb], at = curve.getPointAt(along), way = curve.getTangentAt(along), tip = along > .95;
    const side = V().crossVectors(way, V(0, 0, 1)).multiplyScalar(i % 2 ? 1 : -1).add(V(0, 0, (rnd(i, salt + 11) - .3) * .6)).normalize(), aim = tip ? way.clone() : way.clone().multiplyScalar(.75).addScaledVector(side, .66).normalize(), size = (tip ? .034 : .026) * (.85 + rnd(i, salt + 12) * .4);
    o.position.copy(at).addScaledVector(side, tip ? 0 : (from + (to - from) * along) * .8); o.quaternion.setFromUnitVectors(up, aim); o.scale.setScalar(size); o.updateMatrix(); bud.setMatrixAt(i, o.matrix);
    bud.setColorAt(i, C(mix(0xb6e04a, 0x8fd672, rnd(i, salt + 13))));
    if (i % 3 === 1 && leafSpots.length < 6) leafSpots.push([o.position.clone().addScaledVector(aim, size * 2.4), aim]);
  }
  bud.instanceColor.needsUpdate = true; bud.frustumCulled = false; group.add(bud);
  // A few buds have just opened: two tiny folded leaves each.
  const blade = new T.PlaneGeometry(1, 1, 6, 2), bp = blade.attributes.position;
  for (let i = 0; i < bp.count; i++) { const x = bp.getX(i) + .5, edge = bp.getY(i) * 2; bp.setXYZ(i, edge * .3 * Math.sin(Math.PI * Math.pow(x, .8)), x, Math.abs(edge) * .12 + .25 * x * x); }
  blade.computeVertexNormals();
  const opened = new T.InstancedMesh(blade, kit.mat({ color: 0xffffff, roughness: .4, clearcoat: .4, side: T.DoubleSide }, .8), leafSpots.length * 2), spin = new T.Quaternion();
  leafSpots.forEach(([at, aim], i) => [0, 1].forEach(k => {
    o.position.copy(at); o.quaternion.setFromUnitVectors(up, aim).multiply(spin.setFromAxisAngle(V(0, 1, 0), i * 1.3 + (k ? Math.PI : 0))).multiply(spin.setFromAxisAngle(V(1, 0, 0), .5 + rnd(i * 2 + k, salt + 14) * .3)); o.scale.setScalar(.13 + rnd(i * 2 + k, salt + 15) * .07); o.updateMatrix(); opened.setMatrixAt(i * 2 + k, o.matrix);
    opened.setColorAt(i * 2 + k, C(mix(0x9fd672, 0xc4e86a, rnd(i * 2 + k, salt + 16))));
  }));
  if (opened.instanceColor) opened.instanceColor.needsUpdate = true;
  opened.frustumCulled = false; group.add(opened);
  return group;
}
