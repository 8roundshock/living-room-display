// The potted Easter lily of the Easter scene (#611): three leafy stems in a plain celadon pot,
// carrying white trumpet flowers at different stages and a few buds. A trumpet is six separate
// tepals that form a tube, flare and curl back at their tips, around six stamens and a pistil.
// Modelled at its on-screen size (about 4.4 tall and 2.6 wide); the caller scales it.
// See ../README.md, "Shared parts".
import { loft, through } from './thanksgiving-loft.js';

/** The six tepals of one trumpet as one geometry, opening along +y from the origin. `open` (0-1)
 * is how far the mouth has flared and the tips have curled back. */
function trumpetGeometry(kit, length, open) {
  const { T } = kit, ALONG = 18, ACROSS = 6, position = [], uv = [], index = [];
  // The outline of one tepal's midline: [distance along the flower, distance from its axis].
  const outline = new T.SplineCurve([[0, .045], [.3, .062], [.58, .1], [.8, .1 + .13 * open], [.94, .1 + .27 * open], [1, .1 + .37 * open], [1 - .1 * open, .1 + .47 * open]].map(([along, out]) => new T.Vector2(along * length, out)));
  for (let tepal = 0; tepal < 6; tepal++) {
    const centre = tepal * Math.PI / 3, inner = tepal % 2 === 1, base = position.length / 3;
    for (let i = 0; i <= ALONG; i++) {
      const s = i / ALONG, point = outline.getPointAt(s), flare = Math.min(1, Math.max(0, (s - .5) / .5)), taper = s < .6 ? 1 : 1 - Math.pow((s - .6) / .4, 1.8);
      // Joined into a tube below; above, each tepal narrows to a point, the inner three a little broader.
      const half = Math.PI / 6 * (1.03 + ((inner ? 1.14 : .97) - 1.03) * Math.min(1, flare * 2.5)) * taper + .004;
      for (let j = 0; j <= ACROSS; j++) {
        const q = j / ACROSS * 2 - 1, angle = centre + q * half;
        // The edges roll outward and lag behind the midline, which keeps a shallow groove.
        const out = point.y * (1 + .08 * q * q * flare) + (inner ? -.005 : .005) * flare - .014 * (1 - q * q) * flare, along = point.x - .07 * q * q * flare * length * open;
        position.push(Math.cos(angle) * out, along, Math.sin(angle) * out); uv.push((q + 1) / 2, s);
      }
    }
    for (let i = 0; i < ALONG; i++) for (let j = 0; j < ACROSS; j++) { const a = base + i * (ACROSS + 1) + j, b = a + ACROSS + 1; index.push(a, a + 1, b, b, a + 1, b + 1); }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3)); geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geometry.setIndex(index); geometry.computeVertexNormals();
  return geometry;
}

/** A potted Easter lily standing on the group's origin. Its flowers nod very slightly, each on its own time. */
export function lily(kit, { salt = 0 } = {}) {
  const { T, V, C, rnd, mix, tick } = kit, group = new T.Group(), up = V(0, 1, 0);

  // ---------- the pot: a plain cylinder with a rolled rim, matte celadon glaze, dark soil ----------
  const pot = new T.Mesh(new T.LatheGeometry([[.0001, 0], [.45, 0], [.5, .035], [.6, .77], [.645, .8], [.66, .845], [.63, .885], [.575, .86], [.56, .78]].map(([x, y]) => new T.Vector2(x, y)), 56), kit.mat({ color: 0x8fa898, roughness: .72, clearcoat: .18, clearcoatRoughness: .6 }, .5));
  const soil = new T.Mesh(new T.CircleGeometry(.565, 32), kit.mat({ color: 0x2a2018, roughness: 1 }, .1, false)); soil.rotation.x = -Math.PI / 2; soil.position.y = .8;
  group.add(pot, soil);

  // ---------- three stems and their lance leaves, set in a spiral ----------
  const STEMS = [[[0, .8, 0], [.05, 1.8, .02], [-.05, 3, 0], [.06, 3.75, .03]], [[-.12, .8, .05], [-.3, 1.7, .08], [-.52, 2.6, .1], [-.62, 3.2, .12]], [[.14, .8, -.04], [.34, 1.6, -.06], [.58, 2.5, -.02], [.74, 3.05, .04]]].map(points => through(kit, points));
  const green = kit.mat({ color: 0x5f9a55, roughness: .5, clearcoat: .2 }, .6);
  STEMS.forEach(stem => group.add(new T.Mesh(loft(kit, stem, u => .046 - .02 * u, { rings: 28, sides: 8 }), green)));
  // One blade: base at the origin, running along +x, arching, folded a little along its midrib.
  const blade = new T.PlaneGeometry(1, 1, 10, 2), bp = blade.attributes.position;
  for (let i = 0; i < bp.count; i++) { const x = bp.getX(i) + .5, side = bp.getY(i) * 2, wide = .105 * Math.pow(Math.sin(Math.PI * Math.pow(x, .62)), .8) + .004; bp.setXYZ(i, x, .3 * x - .42 * x * x + Math.abs(side) * .018, side * wide); }
  blade.computeVertexNormals();
  const perStem = [22, 16, 16], total = perStem.reduce((sum, count) => sum + count, 0), leaves = new T.InstancedMesh(blade, kit.mat({ color: 0xffffff, roughness: .48, clearcoat: .3, clearcoatRoughness: .4, side: T.DoubleSide }, .7), total), o = new T.Object3D();
  let placed = 0;
  STEMS.forEach((stem, s) => {
    for (let k = 0; k < perStem[s]; k++, placed++) {
      const u = .06 + .86 * (k + rnd(placed, salt + 1) * .6) / perStem[s], size = (1.02 - .5 * u) * (.85 + rnd(placed, salt + 2) * .3);
      o.position.copy(stem.getPointAt(u)); o.rotation.set(0, k * 2.4 + s * 1.3 + rnd(placed, salt + 3) * .5, .2 + .55 * u + (rnd(placed, salt + 4) - .5) * .25, 'YZX'); o.scale.setScalar(size); o.updateMatrix();
      leaves.setMatrixAt(placed, o.matrix); leaves.setColorAt(placed, C(mix(mix(0x4f8a4a, 0x6faa5c, rnd(placed, salt + 5)), 0x8fd672, rnd(placed, salt + 6) * .35)));
    }
  });
  leaves.instanceColor.needsUpdate = true; leaves.frustumCulled = false; group.add(leaves);

  // ---------- flowers and buds ----------
  // The tepal: white, a pale green throat, a faint midrib and veins.
  const tepal = kit.canvasTexture(128, 256, g => {
    const body = g.createLinearGradient(0, 256, 0, 0); body.addColorStop(0, '#b4cf86'); body.addColorStop(.3, '#dfe9c2'); body.addColorStop(.55, '#f6f3ea'); body.addColorStop(1, '#fbf9f2'); g.fillStyle = body; g.fillRect(0, 0, 128, 256);
    for (const [x, alpha, width] of [[64, .32, 3], [44, .12, 1.5], [84, .12, 1.5], [26, .08, 1], [102, .08, 1]]) { const vein = g.createLinearGradient(0, 256, 0, 0); vein.addColorStop(0, `rgba(120,160,80,${alpha * 1.6})`); vein.addColorStop(.75, `rgba(170,190,130,${alpha})`); vein.addColorStop(1, 'rgba(200,210,170,0)'); g.strokeStyle = vein; g.lineWidth = width; g.beginPath(); g.moveTo(x, 256); g.quadraticCurveTo(64 + (x - 64) * 1.15, 120, 64 + (x - 64) * .5, 6); g.stroke(); }
  }, { anisotropy: 4 });
  const white = kit.mat({ map: tepal, roughness: .5, clearcoat: .25, clearcoatRoughness: .5, side: T.DoubleSide }, .6);
  const thread = new T.CylinderGeometry(1, 1, 1, 5, 1, true); thread.translate(0, .5, 0);
  const filament = kit.mat({ color: 0xd9e6b8, roughness: .6 }, .4, false), pollen = kit.mat({ color: 0xffffff, roughness: .55 }, .6, false);
  const turn = new T.Quaternion(), span = V();
  function trumpet(length, open) {
    const flower = new T.Group(), threads = new T.InstancedMesh(thread, filament, 7), heads = new T.InstancedMesh(kit.ballGeo, pollen, 7), from = V(0, length * .2, 0);
    for (let k = 0; k < 7; k++) {
      // Six stamens with golden anthers around one longer pistil with a pale green stigma.
      const pistil = k === 6, angle = k * Math.PI / 3 + .4, reach = pistil ? .02 : .05 + .07 * open, to = V(Math.cos(angle) * reach, length * (pistil ? 1 : .86 + rnd(k, salt + 7) * .05), Math.sin(angle) * reach);
      span.copy(to).sub(from); const long = span.length(); turn.setFromUnitVectors(up, span.normalize());
      o.position.copy(from); o.quaternion.copy(turn); o.scale.set(pistil ? .011 : .007, long, pistil ? .011 : .007); o.updateMatrix(); threads.setMatrixAt(k, o.matrix);
      o.position.copy(to); o.rotation.set(rnd(k, salt + 8) * 3, rnd(k, salt + 9) * 3, 0); o.scale.set(pistil ? .034 : .024, pistil ? .026 : .024, pistil ? .034 : .07); o.updateMatrix(); heads.setMatrixAt(k, o.matrix); heads.setColorAt(k, C(pistil ? 0xcfe0a8 : 0xe3a02a));
    }
    heads.instanceColor.needsUpdate = true; threads.frustumCulled = heads.frustumCulled = false;
    flower.add(new T.Mesh(trumpetGeometry(kit, length, open), white), threads, heads);
    return flower;
  }
  function bud(length, radius, colour) {
    const points = []; for (let i = 0; i <= 24; i++) { const s = i / 24; points.push(new T.Vector2(Math.max(.0001, radius * Math.pow(Math.sin(Math.PI * Math.pow(s, .8)), .85) * (1 - .3 * s)), s * length)); }
    return new T.Mesh(new T.LatheGeometry(points, 16), kit.mat({ color: colour, roughness: .5, clearcoat: .3, clearcoatRoughness: .5 }, .6));
  }
  // [stem, the way it faces, length of its stalk, flower length or 0 for a bud, openness or bud radius, bud colour]
  const HEADS = [
    [0, [.74, .08, .66], .36, 1.1, 1], [0, [-.8, .22, .4], .34, 1, .86], [0, [.12, 1, .12], .22, 0, .07, 0xa9c77a],
    [1, [-.34, -.08, .94], .32, 1.05, 1], [1, [-.62, .76, -.1], .34, 0, .1, 0xe4ecc8],
    [2, [.9, .3, .14], .34, .95, .7], [2, [.5, .82, .3], .3, 0, .085, 0xc9dba0],
  ];
  const nodding = [];
  HEADS.forEach(([stem, facing, stalk, length, measure, colour], i) => {
    const top = STEMS[stem].getPointAt(1), way = V(...facing).normalize(), neck = top.clone().addScaledVector(way, stalk * .75).add(V(0, stalk * .45, 0));
    group.add(new T.Mesh(loft(kit, new T.QuadraticBezierCurve3(top, top.clone().add(V(way.x * stalk * .2, stalk * .5, way.z * stalk * .2)), neck), () => .02, { rings: 8, sides: 6 }), green));
    const head = length ? trumpet(length, measure) : bud(measure * 7.2, measure, colour), pivot = new T.Group();
    pivot.position.copy(neck); head.quaternion.setFromUnitVectors(up, way); pivot.add(head); group.add(pivot); nodding.push([pivot, i * 1.7]);
  });
  tick(t => nodding.forEach(([pivot, phase]) => { pivot.rotation.z = Math.sin(t * .4 + phase) * .014; pivot.rotation.x = Math.sin(t * .31 + phase) * .008; }));
  return group;
}
