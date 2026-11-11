// A white-spruce cone (#665): slender, light brown, hanging straight down from under a twig,
// its thin rounded scales in the spirals a cone grows them in, each with a paler papery edge.
// (Fir cones stand upright and fall apart on the tree by winter; a spruce keeps its cones, and
// they hang.) A core and one instanced mesh of scales. A part: plain functions of the kit.
import { sheets } from './spring-blade.js';

/**
 * A cone hanging from `at` (a Vector3, the end of its short stalk). `length` and `girth` are
 * its size, `open` (0-1) how far its scales have opened, `tone` (0-1) runs from pale tan to
 * brown, `lean` and `turn` tip and spin it a little. Returns { core, scales }: two meshes in
 * world coordinates.
 */
export function spruceCone(kit, { at, length = .4, girth = .13, open = .3, tone = .5, lean = 0, turn = 0, seed = 0 } = {}) {
  const { T, V, C, rnd, mix } = kit, stalk = girth * .3, place = new T.Matrix4().makeRotationZ(lean).multiply(new T.Matrix4().makeRotationY(turn)).setPosition(at);
  const TAN = mix(0xd0a56c, 0xa9753f, tone), BROWN = mix(0x9c6c3d, 0x6e4a2b, tone);
  // How full the cone is along its length, from the stalk (0) to its rounded tip (1).
  const full = f => Math.min(1, .3 + f * 5.5) * (f < .6 ? 1 : 1 - .62 * Math.pow((f - .6) / .4, 1.7));

  // ---------- the core and its stalk, which show between the scales ----------
  const dark = C(mix(BROWN, 0x2a1c12, .45)), S = sheets(kit);
  S.turn(10, 14, v => { const f = 1 - v / .9; return v > .9 ? [girth * .07, -stalk * (1 - (v - .9) / .1)] : [Math.max(.002, girth * .34 * full(f) * Math.sqrt(Math.min(1, v * 9))), -stalk - length * .96 * f]; }, () => [dark.r, dark.g, dark.b], { matrix: place });
  const core = new T.Mesh(S.geometry(), kit.mat({ color: 0xffffff, vertexColors: true, roughness: .9, metalness: 0, see: .5 }, .2, false));

  // ---------- the scales ----------
  // One scale: a thin fan, widest toward its rounded end, a little domed. It lies along +y from its base, its outer face toward +z.
  const fan = new T.PlaneGeometry(1, 1, 4, 4), p = fan.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const along = p.getY(i) + .5, across = p.getX(i) * 2, end = along > .72 ? Math.sqrt(Math.max(0, 1 - Math.pow((along - .72) / .28, 2))) : 1, half = .5 * Math.pow(Math.min(1, along * 1.5), .6) * (.25 + .75 * end);
    p.setXYZ(i, across * half, along, .16 * (1 - across * across) * along + .1 * along * along * open);
  }
  fan.computeVertexNormals();
  const paper = kit.canvasTexture(64, 64, (g, w, h) => {
    const body = g.createLinearGradient(0, h, 0, 0); body.addColorStop(0, '#8a8a8a'); body.addColorStop(.55, '#c8c8c8'); body.addColorStop(.86, '#f0f0f0'); body.addColorStop(1, '#ffffff'); g.fillStyle = body; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(70,70,70,.22)'; g.lineWidth = 1; for (let i = 0; i < 11; i++) { g.beginPath(); g.moveTo(w / 2 + (i - 5) * 2, h); g.lineTo(w / 2 + (i - 5) * 6.2, 4); g.stroke(); }
  });
  const count = Math.round(Math.min(90, Math.max(24, length / girth * 17))), scales = new T.InstancedMesh(fan, kit.mat({ color: 0xffffff, map: paper, roughness: .78, metalness: 0, side: T.DoubleSide, see: .5 }, .3, false), count);
  const down = V(0, -1, 0), out = V(), way = V(), face = V(), cross = V(), spot = V(), basis = new T.Matrix4(), size = new T.Matrix4();
  for (let k = 0; k < count; k++) {
    const f = (k + .5) / count, angle = k * 2.39996 + seed, radius = girth * .34 * full(f), gape = .2 + open * (.35 + .5 * Math.sin(Math.PI * f)) + (rnd(k, seed + 1) - .5) * .12;
    out.set(Math.sin(angle), 0, Math.cos(angle));
    way.copy(down).multiplyScalar(Math.cos(gape)).addScaledVector(out, Math.sin(gape)); face.copy(out).multiplyScalar(Math.cos(gape)).addScaledVector(down, -Math.sin(gape)); cross.crossVectors(way, face);
    const wide = girth * (.5 + .34 * Math.sin(Math.PI * Math.min(1, f * 1.15))) * (.9 + rnd(k, seed + 2) * .2);
    spot.set(out.x * radius * .8, -stalk - length * .93 * f, out.z * radius * .8);
    scales.setMatrixAt(k, basis.makeBasis(cross, way, face).setPosition(spot).multiply(size.makeScale(wide, wide * 1.12, wide)).premultiply(place));
    // Paler where the light reaches, a little darker toward the stalk; no two scales quite the same.
    scales.setColorAt(k, C(mix(mix(TAN, BROWN, rnd(k, seed + 3) * .7), 0x5a3c24, Math.max(0, .3 - f) * .9)));
  }
  scales.instanceColor.needsUpdate = true; scales.frustumCulled = false; core.frustumCulled = false;
  return { core, scales };
}
