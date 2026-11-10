// The Russian birthday's flowers and cloth (#627): a bunch of seven daisy-form flowers (an odd
// number, as flowers are given) wrapped in plain kraft paper and tied with a ribbon; and a linen
// runner with one red band of small stepped diamonds near each end. The band is an original
// small diamond row in the manner of counted-thread embroidery, not a copy of any museum textile.
import { ribbonTie } from './mimosa-tulip.js';
import { tubes, turned } from './new-year-tree-tubes.js';

/**
 * A wrapped bunch standing on its point at the origin, the flowers toward +y. `heads` are
 * [kind, diameter, petals, x, z, height, tilt x, tilt z] with kind 'daisy' or 'gerbera'.
 * Returns { group, knot }: `knot` is where the ribbon is tied (in the group's own space), for tying something to it.
 */
export function wrappedBunch(kit, { heads, paper = 0xc9a877, ribbon = 0xc8365e, seed = 0 } = {}) {
  const { T, V, C, rnd } = kit, group = new T.Group(), up = V(0, 1, 0), waist = .62;
  // ---------- the paper: a cone open at the top, higher at the back, a little crumpled ----------
  const rows = 22, around = 48, cone = k => .05 + .64 * Math.pow(k, 1.25), profile = []; for (let i = 0; i <= rows; i++) profile.push([cone(i / rows), 1.62 * i / rows]);
  const wrap = turned(kit, profile, around), p = wrap.attributes.position;
  for (let i = 0; i <= around; i++) for (let j = 0; j <= rows; j++) {
    const v = i * (rows + 1) + j, k = j / rows, phi = i / around * Math.PI * 2, crumple = 1 + .04 * Math.sin(phi * 5 + k * 9 + seed) * k + .025 * Math.sin(phi * 11 - k * 6), rise = k * k * (.3 * Math.cos(phi - Math.PI) + .1 * Math.sin(phi * 3 + seed));
    p.setXYZ(v, p.getX(v) * crumple, p.getY(v) + rise, p.getZ(v) * crumple);
  }
  wrap.computeVertexNormals();
  const kraft = kit.canvasTexture(256, 256, g => { g.fillStyle = `#${new T.Color(paper).getHexString()}`; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 700; i++) { g.strokeStyle = `rgba(${rnd(i, seed + 1) < .5 ? '255,236,200' : '90,60,30'},${.04 + rnd(i, seed + 2) * .07})`; g.lineWidth = .6 + rnd(i, seed + 3); g.beginPath(); const x = rnd(i, seed + 4) * 256, y = rnd(i, seed + 5) * 256; g.moveTo(x, y); g.lineTo(x + (rnd(i, seed + 6) - .5) * 30, y + (rnd(i, seed + 7) - .5) * 8); g.stroke(); } });
  group.add(new T.Mesh(wrap, kit.mat({ map: kraft, bumpMap: kraft, bumpScale: .01, roughness: .9, side: T.DoubleSide, emissive: paper, emissiveIntensity: .14 }, .3, false)));
  const tie = ribbonTie(kit, { colour: ribbon, radius: cone(waist / 1.62) + .012, width: .1, tails: [.7, .5] }); tie.position.y = waist; group.add(tie);

  // ---------- the flowers: a domed centre ringed by narrow petals, on stems that gather at the ribbon ----------
  const petal = new T.PlaneGeometry(1, .26, 6, 2), q = petal.attributes.position;
  for (let i = 0; i < q.count; i++) { const x = q.getX(i) + .5, y = q.getY(i), width = Math.pow(Math.sin(Math.PI * Math.pow(x, .7) * .94 + .06), .55); q.setXYZ(i, x, .16 * x * x - .3 * Math.abs(y) * Math.abs(y) * 4 * .1, y * width); }
  petal.computeVertexNormals();
  const KINDS = { daisy: { petals: 0xe6e2d6, glow: 0xf8f6ee, centre: 0xd89a10, rings: 1 }, gerbera: { petals: 0xb81848, glow: 0xc82a58, centre: 0x4a2a1c, rings: 2 } };
  const stems = tubes(kit, 6), STEM = C(0x5f9a50), dots = kit.canvasTexture(64, 64, g => { g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, 64, 64); for (let i = 0; i < 300; i++) { g.fillStyle = rnd(i, seed + 8) < .5 ? '#d8d8d8' : '#303030'; g.beginPath(); g.arc(rnd(i, seed + 9) * 64, rnd(i, seed + 10) * 64, 1.3, 0, 7); g.fill(); } }, { srgb: false, repeat: true });
  dots.repeat.set(3, 2);
  const o = new T.Object3D(), matrix = new T.Matrix4(), frame = new T.Object3D();
  for (const kind of Object.keys(KINDS)) {
    const style = KINDS[kind], list = heads.filter(head => head[0] === kind), total = list.reduce((sum, head) => sum + head[2] * style.rings, 0); if (!list.length) continue;
    const rays = new T.InstancedMesh(petal, kit.mat({ color: style.petals, roughness: .55, side: T.DoubleSide, emissive: style.glow, emissiveIntensity: .22 }, .4, false), total), centres = kit.mat({ color: style.centre, roughness: .7, bumpMap: dots, bumpScale: .02, emissive: style.centre, emissiveIntensity: .3 }, .3, false);
    let n = 0;
    list.forEach(([, diameter, petals, x, z, height, tiltX, tiltZ], h) => {
      const at = V(x, height, z), radius = diameter / 2;
      frame.position.copy(at); frame.rotation.set(tiltX, h * 1.7, tiltZ); frame.updateMatrix();
      for (let ring = 0; ring < style.rings; ring++) for (let i = 0; i < petals; i++) {
        const a = (i + ring * .5) / petals * Math.PI * 2 + rnd(i, seed + h) * .06, reach = radius * (ring ? .68 : 1) * (.92 + rnd(i + ring * 50, seed + h + 20) * .14);
        o.position.set(Math.cos(a) * radius * .16, ring * .012, -Math.sin(a) * radius * .16); o.rotation.set(0, a, (ring ? .34 : .1) + (kind === 'daisy' ? -.04 : .1) + rnd(i, seed + h + 40) * .1, 'YZX'); o.scale.set(reach * .86, reach * .86, reach * (kind === 'daisy' ? .9 : .72)); o.updateMatrix();
        rays.setMatrixAt(n++, matrix.multiplyMatrices(frame.matrix, o.matrix));
      }
      const disc = new T.Mesh(kit.sphereGeo, centres); disc.scale.set(radius * (kind === 'daisy' ? .27 : .22), radius * .12, radius * (kind === 'daisy' ? .27 : .22)); disc.position.copy(at); disc.rotation.copy(frame.rotation); group.add(disc);
      // The stem runs from under the head down into the throat of the paper.
      const down = V(0, -1, 0).applyEuler(frame.rotation), neck = at.clone().addScaledVector(down, .05);
      stems.add(new T.CatmullRomCurve3([neck, neck.clone().addScaledVector(down, .25).lerp(V(x * .5, height - .4, z * .5), .5), V(x * .3, waist + .5, z * .3), V(x * .08, waist, z * .08), V(0, waist - .4, 0)]).getPoints(16), .02, .024, STEM, STEM);
    });
    rays.frustumCulled = false; group.add(rays);
  }
  group.add(stems.mesh(kit.mat({ color: 0xffffff, vertexColors: true, roughness: .55, emissive: 0x4f8a40, emissiveIntensity: .25 }, .4, false)));
  return { group, knot: V(0, waist, cone(waist / 1.62) + .03) };
}

/**
 * A linen runner lying on y = 0, `length` along x and `width` along z, falling a little over its front edge.
 * Near each short end: two thin lines, a row of small stepped diamonds between them, and a short fringe.
 */
export function linenRunner(kit, { length = 4.5, width = 1.5, fall = .5, colour = '#e3dac6', thread = '#c8283c', seed = 0 } = {}) {
  const { T, rnd } = kit, depth = width + fall, geometry = new T.PlaneGeometry(length, depth, 72, 26); geometry.rotateX(-Math.PI / 2); geometry.translate(0, 0, fall / 2);
  const p = geometry.attributes.position, edge = width / 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), over = Math.max(0, z - edge), folds = Math.sin(x * 4.1 + seed) * .05 + Math.sin(x * 9.3 + seed * 2) * .018;
    // Flat under the plate with a little life in it; past the front edge it turns down and hangs in soft folds.
    p.setXYZ(i, x, over ? -over * .95 + .012 : .012 + .01 * Math.sin(x * 2.3 + z * 3 + seed) + .008 * Math.sin(x * 5.1 - z * 2), over ? edge + over * .18 + folds * Math.min(1, over / .15) : z);
  }
  geometry.computeVertexNormals();
  // One stitch is `cu` by `cv` pixels, so that it is square on the cloth (the texture is not).
  const W = 2048, H = 512, band = W * .085, cv = 5, cu = cv * (W / length) / (H / depth);
  const diamonds = (g, ink) => {
    g.fillStyle = ink;
    for (const side of [0, 1]) {
      const x0 = side ? W - band : band, count = 11, pitch = H / count;
      for (const [offset, thick] of [[5.4, .5], [6.6, .25]]) for (const sign of [-1, 1]) g.fillRect(x0 + sign * offset * cu - thick * cu / 2, 0, thick * cu, H);
      for (let n = 0; n < count; n++) {
        const cy = (n + .5) * pitch;
        for (let row = -4; row <= 4; row++) { const half = (4 - Math.abs(row) + .5) * cu; g.fillRect(x0 - half, cy + (row - .5) * cv, half * 2, cv); }
        g.clearRect(x0 - cu * 1.5, cy - cv * 1.5, cu * 3, cv * 3); g.fillRect(x0 - cu / 2, cy - cv / 2, cu, cv);
      }
    }
  };
  const linen = kit.canvasTexture(W, H, g => {
    g.fillStyle = colour; g.fillRect(0, 0, W, H);
    g.globalAlpha = .1; g.fillStyle = '#5a4a30'; for (let i = 0; i < W; i += 4) g.fillRect(i, 0, 1, H); for (let i = 0; i < H; i += 4) g.fillRect(0, i, W, 1); g.globalAlpha = 1;
    for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(130,110,80,${.05 + rnd(i, seed + 1) * .07})`; g.lineWidth = 1; g.beginPath(); const y = rnd(i, seed + 2) * H, x = rnd(i, seed + 3) * W; g.moveTo(x, y); g.lineTo(x + 40 + rnd(i, seed + 4) * 160, y + (rnd(i, seed + 5) - .5) * 3); g.stroke(); }
    // The cut-out centre of each diamond is cleared by the stamp: repaint the cloth under it.
    const stamp = document.createElement('canvas'); stamp.width = W; stamp.height = H; diamonds(stamp.getContext('2d'), thread); g.drawImage(stamp, 0, 0);
  }, { anisotropy: 8 });
  // The fringe: the last threads of the weave left loose at both ends.
  const comb = kit.canvasTexture(W, 8, g => { g.fillStyle = '#fff'; g.fillRect(0, 0, W, 8); g.fillStyle = '#000'; g.fillRect(0, 0, 36, 8); g.fillRect(W - 36, 0, 36, 8); }, { srgb: false });
  const fringe = kit.canvasTexture(64, 512, g => { g.fillStyle = '#000'; g.fillRect(0, 0, 64, 512); g.fillStyle = '#fff'; for (let i = 0; i < 64; i++) g.fillRect(0, i * 8 + 1, 64 - rnd(i, seed + 6) * 16, 4.5); }, { srgb: false });
  const cloth = new T.Mesh(geometry, kit.mat({ map: linen, bumpMap: linen, bumpScale: .004, alphaMap: comb, alphaTest: .5, roughness: .9, side: T.DoubleSide, emissiveMap: linen, emissive: 0xffffff, emissiveIntensity: .08 }, .3, false));
  const group = new T.Group(); group.add(cloth);
  for (const side of [-1, 1]) {
    const tassel = new T.Mesh(new T.PlaneGeometry(length * 36 / W, width, 1, 8), kit.mat({ color: colour, alphaMap: fringe, alphaTest: .5, roughness: .9, side: T.DoubleSide }, .3, false));
    tassel.rotation.x = -Math.PI / 2; tassel.rotation.z = side < 0 ? Math.PI : 0; tassel.position.set(side * (length / 2 - length * 18 / W), .012, 0); group.add(tassel);
  }
  return group;
}
