// Pussy willow in a clay jug (#625): the twigs carried on the Sunday before Pascha, standing in
// an unglazed wheel-thrown jug. Each twig has its own bend and length; the catkins sit alternately
// in dark bud scales, silver-grey with a soft halo of fur, a few near the tips turning yellow-green.
import { tubes, turned } from './new-year-tree-tubes.js';

/** An unglazed clay jug standing on y = 0, `height` tall, with one darker glazed band and the fine rings of the wheel.
 * `userData.mouth` is the height of its rim and `userData.neck` the radius of its opening. */
export function clayJug(kit, { height = 1.3, colour = 0x9a5a3c, band = 0x5a2f22 } = {}) {
  const { T, rnd } = kit, css = value => `#${new T.Color(value).getHexString()}`, profile = [];
  const shape = k => k < .05 ? .26 + .04 * (k / .05) : k < .78 ? .3 + .16 * Math.pow(Math.sin(Math.min(1, (k - .05) / .6) * Math.PI * .92), .8) - .16 * Math.max(0, (k - .5) / .28) ** 2 : k < .93 ? .175 + .018 * Math.cos((k - .78) / .15 * Math.PI) : .157 + .09 * Math.pow((k - .93) / .07, 1.4);
  for (let i = 0; i <= 60; i++) { const k = i / 60; profile.push([shape(k), k]); }
  profile.push([shape(1) - .025, 1.005], [shape(.96) - .03, .93]);
  const last = profile.length - 1, clay = kit.canvasTexture(256, 512, g => {
    g.fillStyle = css(colour); g.fillRect(0, 0, 256, 512);
    const y = k => 512 * (1 - k * 60 / last);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${rnd(i, 1) < .5 ? '222,150,110' : '70,34,20'},${.04 + rnd(i, 2) * .07})`; g.beginPath(); g.arc(rnd(i, 3) * 256, rnd(i, 4) * 512, 2 + rnd(i, 5) * 12, 0, 7); g.fill(); }
    g.fillStyle = css(band); g.fillRect(0, y(.7), 256, y(.6) - y(.7)); g.fillStyle = 'rgba(40,18,10,.5)'; for (const k of [.72, .58, .82]) g.fillRect(0, y(k), 256, 2.5);
    // Rings left by the potter's fingers.
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(${i % 2 ? '255,200,160' : '50,24,14'},${.04 + rnd(i, 6) * .05})`; g.fillRect(0, rnd(i, 7) * 512, 256, 1 + rnd(i, 8) * 2.5); }
    g.fillStyle = 'rgba(30,14,8,.75)'; g.fillRect(0, 0, 256, y(1.002));
  }, { anisotropy: 4 });
  const mesh = new T.Mesh(turned(kit, profile, 56), kit.mat({ map: clay, bumpMap: clay, bumpScale: .006, roughness: .85, emissiveMap: clay, emissive: 0xffffff, emissiveIntensity: .16 }, .3, false));
  mesh.scale.setScalar(height); mesh.userData.mouth = height; mesh.userData.neck = shape(.9) * height;
  return mesh;
}

/**
 * Pussy-willow twigs rising from the group's origin (the mouth of a jug). Returns { group, twigs }:
 * each entry of `twigs` is that twig's own group, pivoted at the origin, for a slight sway.
 * `bends` are [lean x, lean z, length, curl] for each twig.
 */
export function willowTwigs(kit, { bends, seed = 0, inside = .7 } = {}) {
  const { T, V, C, rnd } = kit, group = new T.Group(), twigs = [], up = V(0, 1, 0);
  const BARK = C(0x8a4a34), TIP = C(0x9a6a3c), SILVER = C(0xd8dce0), POLLEN = C(0xd6e09a);
  const fur = kit.mat({ color: 0xffffff, roughness: 1, emissive: 0xd8dce0, emissiveIntensity: .22 }, .25, false);
  const stipple = kit.canvasTexture(64, 64, g => { for (let i = 0; i < 420; i++) { g.fillStyle = `rgba(255,255,255,${.25 + rnd(i, seed + 3) * .6})`; g.fillRect(rnd(i, seed + 1) * 64, rnd(i, seed + 2) * 64, 1.3, 2.6); } }, { srgb: false, repeat: true });
  const halo = new T.MeshBasicMaterial({ color: C(0xe6ecf4), alphaMap: stipple, transparent: true, opacity: .32, depthWrite: false, blending: T.AdditiveBlending });
  const scaleMat = kit.mat({ color: 0x5a3020, roughness: .45, clearcoat: .5, emissive: 0x5a3020, emissiveIntensity: .25 }, .6), tuft = new T.SphereGeometry(1, 12, 9);
  bends.forEach(([leanX, leanZ, length, curl], index) => {
    const own = new T.Group(), salt = seed + index * 17, spine = t => V(leanX * length * Math.pow(t, 1.5) + Math.sin(t * 3.4 + salt) * curl * t, length * t - inside, leanZ * length * Math.pow(t, 1.4) + Math.cos(t * 2.7 + salt) * curl * .8 * t);
    const points = []; for (let i = 0; i <= 28; i++) points.push(spine(i / 28));
    const wood = tubes(kit, 6).add(points, .024, .008, BARK, TIP), shoots = [];
    // One or two side shoots fork off the upper half.
    for (let k = 0; k < 1 + (index % 2); k++) {
      const at = .42 + k * .2 + rnd(k, salt + 1) * .1, from = spine(at), ahead = spine(at + .04).sub(from).normalize(), side = V(rnd(k, salt + 2) - .5, .1, rnd(k, salt + 3) - .5).normalize(), reach = length * (.2 + rnd(k, salt + 4) * .12), shoot = [];
      for (let i = 0; i <= 10; i++) { const u = i / 10; shoot.push(from.clone().addScaledVector(ahead, reach * u).addScaledVector(side, reach * .45 * Math.sin(u * 1.4))); }
      wood.add(shoot, .013, .006, BARK, TIP); shoots.push(shoot);
    }
    own.add(wood.mesh(kit.mat({ color: 0xffffff, vertexColors: true, roughness: .4, clearcoat: .5, clearcoatRoughness: .3, emissive: 0x5a2f22, emissiveIntensity: .2 }, .6)));
    // Catkins alternate up the twig, the largest in the middle of it, each leaning out of its bud scale.
    const places = [], along = (path, from, step, size) => { for (let s = from, n = 0; s < path.length - 1.5; s += step * (.8 + rnd(n, salt + 5) * .4), n++) { const i = Math.floor(s), k = s - i, at = path[i].clone().lerp(path[i + 1], k), dir = path[i + 1].clone().sub(path[i]).normalize(); places.push([at, dir, n, size * (.75 + .5 * Math.sin(Math.min(1, s / path.length + .15) * Math.PI)), s / path.length]); } };
    along(points, 9, 2.3, 1); shoots.forEach(shoot => along(shoot, 2.5, 2.4, .82));
    const bodies = new T.InstancedMesh(tuft, fur, places.length), shells = new T.InstancedMesh(tuft, halo, places.length), buds = new T.InstancedMesh(tuft, scaleMat, places.length), o = new T.Object3D();
    places.forEach(([at, dir, n, size, where], i) => {
      const ref = Math.abs(dir.y) > .9 ? V(1, 0, 0) : up, a = V().crossVectors(dir, ref).normalize(), b = V().crossVectors(dir, a), phi = n * 2.6 + salt, out = a.multiplyScalar(Math.cos(phi)).addScaledVector(b, Math.sin(phi)), axis = dir.clone().multiplyScalar(.86).addScaledVector(out, .5).normalize();
      const base = at.clone().addScaledVector(out, .02), long = .058 * size, wide = .036 * size;
      o.quaternion.setFromUnitVectors(up, axis);
      o.position.copy(base).addScaledVector(axis, long * .95); o.scale.set(wide, long, wide); o.updateMatrix(); bodies.setMatrixAt(i, o.matrix); bodies.setColorAt(i, where > .78 && n % 2 ? POLLEN : SILVER);
      o.scale.set(wide * 1.45, long * 1.3, wide * 1.45); o.updateMatrix(); shells.setMatrixAt(i, o.matrix);
      o.position.copy(base).addScaledVector(axis, long * .2); o.scale.set(wide * .82, long * .45, wide * .82); o.updateMatrix(); buds.setMatrixAt(i, o.matrix);
    });
    for (const mesh of [bodies, shells, buds]) { mesh.frustumCulled = false; own.add(mesh); }
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    twigs.push(own); group.add(own);
  });
  return { group, twigs };
}
