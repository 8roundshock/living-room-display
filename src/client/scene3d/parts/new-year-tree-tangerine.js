// Tangerines for the New Year table (#622): the fresh fruit of the Soviet New Year. A flattened,
// dimpled fruit with pored skin, a green calyx and glossy pointed leaves, and one that is half
// peeled: pale segments in a cup of peel, the rest of the peel trailing off in a spiral.
import { resmooth } from './new-year-tree-tubes.js';

/** Makers that share one skin: `whole(options)` and `peeled(options)`. Each returns a group standing
 * on y = 0; its `userData.fruit` is the fruit itself, centred, for turning it where it lies. */
export function citrus(kit) {
  const { T, V, C, rnd } = kit;
  const pores = kit.canvasTexture(256, 256, g => {
    g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1100; i++) { g.fillStyle = `rgba(30,30,30,${.25 + rnd(i, 3) * .4})`; g.beginPath(); g.arc(rnd(i, 1) * 256, rnd(i, 2) * 256, .8 + rnd(i, 4) * 1.5, 0, 7); g.fill(); }
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(215,215,215,${.1 + rnd(i, 7) * .15})`; g.beginPath(); g.arc(rnd(i, 5) * 256, rnd(i, 6) * 256, 5 + rnd(i, 8) * 12, 0, 7); g.fill(); }
  }, { srgb: false, repeat: true });
  pores.repeat.set(3, 2);
  // Deeper than the fruit looks in daylight: the key light and the tone curve lift it to tangerine.
  const skin = kit.mat({ color: 0xe55f08, roughness: .5, clearcoat: .35, clearcoatRoughness: .4, bumpMap: pores, bumpScale: .006, emissive: 0xd94a00, emissiveIntensity: .28 }, .5);
  const pith = kit.mat({ color: 0xf6e2b8, roughness: .85, side: T.BackSide, emissive: 0xf6e2b8, emissiveIntensity: .1 }, .3, false);
  const green = kit.mat({ color: 0xffffff, vertexColors: true, roughness: .85, side: T.DoubleSide, emissive: 0x1f6a30, emissiveIntensity: .35 }, .2, false);
  const stalk = kit.mat({ color: 0x7c8a44, roughness: .7 }, .3, false);

  /** The fruit as a unit shape about its centre: flattened, both ends dimpled, never quite round. */
  function body(salt) {
    const columns = 44, geometry = new T.SphereGeometry(1, columns, 30), p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), phi = Math.atan2(z, x), swell = 1 + .03 * Math.sin(phi * 3 + salt) + .018 * Math.sin(phi * 5 + salt * 2.3);
      p.setXYZ(i, x * swell, y * .82 - Math.sign(y) * (y > 0 ? .15 : .07) * Math.exp(-Math.pow(Math.hypot(x, z) / .3, 2)), z * swell);
    }
    return resmooth(geometry, columns);
  }
  /** A glossy pointed leaf from its stalk along +x, folded along the midrib and arching over. */
  function leaf(length, salt) {
    const along = 12, across = 4, position = [], colour = [], index = [], edge = C(0x1f6a30), rib = C(0x5fae4a);
    for (let i = 0; i <= along; i++) for (let j = 0; j <= across; j++) {
      const u = i / along, v = j / across * 2 - 1, width = length * .27 * Math.pow(Math.sin(Math.PI * Math.pow(u, .75)), .85), tone = rib.clone().lerp(edge, Math.pow(Math.abs(v), .6));
      position.push(u * length, Math.abs(v) * width * .34 - length * .2 * u * u + Math.sin(u * 3 + salt) * .03 * length, v * width); colour.push(tone.r, tone.g, tone.b);
    }
    for (let i = 0; i < along; i++) for (let j = 0; j < across; j++) { const a = i * (across + 1) + j, b = a + across + 1; index.push(a, b, a + 1, b, b + 1, a + 1); }
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3)); geometry.setAttribute('color', new T.Float32BufferAttribute(colour, 3)); geometry.setIndex(index); geometry.computeVertexNormals();
    return new T.Mesh(geometry, green);
  }

  function whole({ radius = .33, leaves = 0, salt = 0 } = {}) {
    const group = new T.Group(), fruit = new T.Group(), top = .68;
    const calyx = new T.Mesh(new T.CylinderGeometry(.07, .11, .04, 5), stalk); calyx.position.y = top; calyx.rotation.y = salt;
    fruit.add(new T.Mesh(body(salt), skin), calyx);
    if (leaves) {
      const stub = new T.Mesh(new T.CylinderGeometry(.022, .03, .2, 6), stalk); stub.position.set(.01, top + .1, 0); stub.rotation.z = -.12; fruit.add(stub);
      for (let k = 0; k < leaves; k++) { const blade = leaf(1.7 - k * .4, salt + k * 2); blade.position.set(.02, top + .19, 0); blade.rotation.set(.3 - k * .9, salt * .7 + k * 2.6, .45 - k * .25, 'YZX'); fruit.add(blade); }
    }
    fruit.scale.setScalar(radius); fruit.position.y = radius * .75; group.add(fruit); group.userData.fruit = fruit;
    return group;
  }

  /** Half peeled: the segments stand in a cup of peel, and the peel that came off trails toward -x in a spiral. */
  function peeled({ radius = .33, segments = 9, salt = 0 } = {}) {
    const group = new T.Group(), fruit = new T.Group();
    const fibres = kit.canvasTexture(256, 128, g => {
      g.fillStyle = '#f08a1e'; g.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 46; i++) { g.strokeStyle = `rgba(255,244,214,${.25 + rnd(i, salt + 3) * .5})`; g.lineWidth = .6 + rnd(i, salt + 4) * 1.6; g.beginPath(); const x = rnd(i, salt + 1) * 256; g.moveTo(x, 0); g.bezierCurveTo(x + (rnd(i, salt + 5) - .5) * 40, 40, x + (rnd(i, salt + 6) - .5) * 40, 90, x + (rnd(i, salt + 7) - .5) * 30, 128); g.stroke(); }
    });
    const juicy = kit.mat({ map: fibres, roughness: .45, clearcoat: .4, clearcoatRoughness: .4, emissive: 0xe86a10, emissiveIntensity: .3 }, .5), lobe = new T.SphereGeometry(1, 18, 12);
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2 + .2, piece = new T.Mesh(lobe, juicy);
      piece.scale.set(.47, .72 - (i % 3) * .025, .3); piece.position.set(Math.cos(a) * .46, .02, -Math.sin(a) * .46); piece.rotation.y = a; fruit.add(piece);
    }
    const core = new T.Mesh(kit.ballGeo, kit.mat({ color: 0xfaf0d8, roughness: .8 }, .3, false)); core.scale.set(.1, .05, .1); core.position.y = .7; fruit.add(core);
    // The cup of peel left on the lower half, torn unevenly along its edge.
    const columns = 40, rows = 10, cup = new T.SphereGeometry(1.03, columns, rows, 0, Math.PI * 2, 1.7, Math.PI - 1.7), p = cup.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const row = Math.floor(i / (columns + 1)), phi = Math.atan2(p.getZ(i), p.getX(i)), torn = Math.max(0, 1 - row / 4) * (.16 * Math.sin(phi * 3 + salt) + .09 * Math.sin(phi * 7 + salt * 2) + .1);
      p.setY(i, p.getY(i) * .82 + torn);
    }
    resmooth(cup, columns); fruit.add(new T.Mesh(cup, skin), new T.Mesh(cup, pith));
    // The spiral of peel: a band wound round a line that runs away from the fruit along the ground.
    const points = [];
    for (let i = 0; i <= 60; i++) { const u = i / 60, a = 1.2 + u * 2.3 * Math.PI * 2, r = .36 - u * .16; points.push(V(-.8 - u * 1.6, .3 - u * .55 + Math.cos(a) * r, .22 - u * .1 + Math.sin(a) * r)); }
    const band = kit.ribbonGeo(points, .3, u => V(1, 0, .12 * Math.sin(u * 9)).normalize());
    fruit.add(new T.Mesh(band, skin), new T.Mesh(band, pith));
    fruit.scale.setScalar(radius); fruit.position.y = radius * .75; group.add(fruit); group.userData.fruit = fruit;
    return group;
  }
  return { whole, peeled };
}
