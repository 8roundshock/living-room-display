// Tulips for 8 March (#626): from the 1970s as popular as the mimosa. A head of six petals, three
// inner and three outer, pale at the base and saturated at the tip, at any stage from closed bud to
// open; a gently curved stem; one or two long clasping leaves. Never yellow: yellow is the mimosa's.
import { tubes } from './new-year-tree-tubes.js';

/**
 * One tulip growing along +y from the cut end of its stem at the origin. `open` is 0 (closed bud) to 1 (open).
 * `bend` curves the stem in x. The group's `userData.head` is the point where the head sits.
 */
export function tulip(kit, { colour = 0xe8455a, open = .3, length = 2.3, bend = .25, leaves = 1, size = 1, salt = 0 } = {}) {
  const { T, V, C, rnd } = kit, group = new T.Group(), up = V(0, 1, 0);
  const spine = t => V(bend * Math.sin(t * Math.PI * .8) * length * .5, length * t, Math.sin(t * 2.2 + salt) * .05 * length * t);
  const points = []; for (let i = 0; i <= 20; i++) points.push(spine(i / 20));
  group.add(tubes(kit, 8).add(points, .034 * size, .028 * size, C(0x86bc60), C(0x6fae50)).mesh(kit.mat({ color: 0xffffff, vertexColors: true, roughness: .5, clearcoat: .2, emissive: 0x5f9a40, emissiveIntensity: .25 }, .4)));

  // ---------- the head: six petals as sections of one cup ----------
  const tip = C(colour), base = C(kit.mix(colour, 0xf0f2d8, .6)), along = 12, across = 6, position = [], tones = [], index = [];
  const height = .52 * size, girth = .2 * size;
  for (let petal = 0; petal < 6; petal++) {
    const inner = petal % 2, turn = petal * Math.PI / 3 + salt, spread = open * (inner ? .8 : 1) * (.9 + rnd(petal, salt + 1) * .2), start = position.length / 3;
    for (let i = 0; i <= along; i++) for (let j = 0; j <= across; j++) {
      const u = i / along, v = j / across * 2 - 1;
      // The cup: out from the stem, full at two fifths of its height, drawn in to a point; an opening flower leans its tips outward.
      const cup = girth * (inner ? .86 : 1) * (.16 * (1 - u) + Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(u, .75) * .82)), .7) * (.84 - .7 * Math.pow(u, 2.2) * (1 - spread)) + spread * 1.35 * u * u);
      const wide = (1.02 - .42 * spread) * Math.pow(Math.sin(Math.PI * Math.pow(u, .62) * .96 + .04), .75) * (1 - .25 * u), angle = turn + v * wide, crease = 1 - .1 * (1 - Math.abs(v)) * Math.sin(u * Math.PI);
      position.push(Math.cos(angle) * cup * crease, height * (u - .04 - .1 * v * v * u) * (1 - spread * .22 * u), Math.sin(angle) * cup * crease);
      const tone = base.clone().lerp(tip, Math.min(1, Math.pow(u * 2.1, 1.2))).multiplyScalar(inner ? .85 : 1); tones.push(tone.r, tone.g, tone.b);
    }
    for (let i = 0; i < along; i++) for (let j = 0; j < across; j++) { const a = start + i * (across + 1) + j, b = a + across + 1; index.push(a, a + 1, b, a + 1, b + 1, b); }
  }
  const cup = new T.BufferGeometry(); cup.setAttribute('position', new T.Float32BufferAttribute(position, 3)); cup.setAttribute('color', new T.Float32BufferAttribute(tones, 3)); cup.setIndex(index); cup.computeVertexNormals();
  const head = new T.Mesh(cup, kit.mat({ color: 0xd8d8d8, vertexColors: true, roughness: .4, clearcoat: .3, clearcoatRoughness: .35, side: T.DoubleSide, emissive: colour, emissiveIntensity: .22 }, .4));
  const top = spine(1), aim = top.clone().sub(spine(.94)).normalize(); head.position.copy(top); head.quaternion.setFromUnitVectors(up, aim); group.add(head);

  // ---------- long clasping leaves, low on the stem ----------
  const green = kit.mat({ color: 0xffffff, vertexColors: true, roughness: .5, clearcoat: .25, side: T.DoubleSide, emissive: 0x3f7a5a, emissiveIntensity: .25 }, .45), EDGE = C(0x3f7a54), RIB = C(0x6fa87c);
  for (let k = 0; k < leaves; k++) {
    const span = length * (.46 - k * .1) * (.9 + rnd(k, salt + 2) * .2), sign = k % 2 ? -1 : 1, rows = 14, cols = 4, at = [], shade = [], order = [];
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
      const u = i / rows, v = j / cols * 2 - 1, width = .13 * size * Math.pow(Math.sin(Math.PI * Math.pow(u, .55) * .97 + .03), .8) * (1 + .5 * (1 - u));
      // A blade that wraps the stem at its foot, opens into a channel and arches away to a point.
      at.push(sign * (.03 + span * .32 * u * u + Math.abs(v) * width * .5 * (1 - u)), span * u * (1 - .16 * u * u), v * width + Math.sin(u * 4 + k + salt) * .03 * u);
      const tone = RIB.clone().lerp(EDGE, Math.pow(Math.abs(v), .7)); shade.push(tone.r, tone.g, tone.b);
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const a = i * (cols + 1) + j, b = a + cols + 1; order.push(a, a + 1, b, a + 1, b + 1, b); }
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(at, 3)); geometry.setAttribute('color', new T.Float32BufferAttribute(shade, 3)); geometry.setIndex(order); geometry.computeVertexNormals();
    const leaf = new T.Mesh(geometry, green); leaf.position.copy(spine(.3 + k * .14)); leaf.rotation.y = salt + k * 2.2; group.add(leaf);
  }
  group.userData.head = top;
  return group;
}

/** A narrow ribbon tied round a bunch of stems in a plain knot with two tails. The band is a ring about the y axis. */
export function ribbonTie(kit, { colour = 0xd58fe6, radius = .13, width = .09, tails = [.55, .42] } = {}) {
  const { T, V } = kit, group = new T.Group(), satin = kit.satin(colour);
  const band = new T.Mesh(new T.CylinderGeometry(radius, radius, width, 24, 1, true), satin); group.add(band);
  const knot = new T.Mesh(kit.sphereGeo, satin); knot.scale.set(width * .6, width * .55, width * .5); knot.position.set(0, 0, radius + width * .2); group.add(knot);
  tails.forEach((length, i) => {
    const sign = i ? 1 : -1, points = [];
    for (let j = 0; j <= 14; j++) { const u = j / 14; points.push(V(sign * (.04 + u * length * .5 + Math.sin(u * 4 + i) * .02), -u * length * .8 + Math.sin(u * 3) * .03, radius + width * .2 + Math.sin(u * 5 + i * 2) * .03 + u * .05)); }
    group.add(new T.Mesh(kit.ribbonGeo(points, width, u => V(.3 * Math.cos(u * 3 + i), .2, 1).normalize()), satin));
  });
  return group;
}
