// The birthday table of the Korean-accent birthday (#631): a Naju-type soban (나주반 소반), the
// small lacquered table of the Korean home, with a brass bowl of seaweed soup (미역국), the
// birthday food, and a brass spoon and chopsticks. Serving a birthday cake on a soban is a design
// choice, not a claimed custom. See ../README.md.
import { taperTube } from './seollal-forms.js';

const BRASS = 0xc9a45a;

/** The soban standing on y = 0: a rectangular top with softly rounded corners inside a thicker
 * rim, an apron with a shallow scalloped edge, four slender legs that flare a little and turn
 * back in at the foot, and a rail on all four sides at mid-leg. `userData.top` is the surface. */
export function soban(kit, { width = 3.2, depth = 2, height = 1.2 } = {}) {
  const { T, V, rnd, mat, canvasTexture } = kit, group = new T.Group(), k = height / 1.2;
  const rounded = (w, d, r, shape = new T.Shape()) => { const x = w / 2, y = d / 2; shape.moveTo(-x + r, -y); shape.lineTo(x - r, -y); shape.quadraticCurveTo(x, -y, x, -y + r); shape.lineTo(x, y - r); shape.quadraticCurveTo(x, y, x - r, y); shape.lineTo(-x + r, y); shape.quadraticCurveTo(-x, y, -x, y - r); shape.lineTo(-x, -y + r); shape.quadraticCurveTo(-x, -y, -x + r, -y); return shape; };
  // Ottchil lacquer over zelkova: deep red-brown, high gloss, the grain only just showing.
  const grain = canvasTexture(512, 256, g => {
    g.fillStyle = '#6c2216'; g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 46; i++) { const y = rnd(i, 3) * 256, sweep = 6 + rnd(i, 4) * 18; g.strokeStyle = `rgba(${rnd(i, 5) < .6 ? '40,8,4' : '190,90,50'},${(.1 + rnd(i, 6) * .16).toFixed(3)})`; g.lineWidth = 1 + rnd(i, 7) * 3; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(170, y - sweep, 340, y + sweep, 512, y + (rnd(i, 8) - .5) * 14); g.stroke(); }
  }, { repeat: true, anisotropy: 4 });
  grain.repeat.set(1 / width, 1 / depth); grain.offset.set(.5, .5);
  const lacquer = mat({ map: grain, roughness: .22, clearcoat: 1, clearcoatRoughness: .12, see: .6 }, 1.1), flat = { bevelEnabled: false, curveSegments: 8 };
  const lay = (mesh, y) => { mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; return mesh; };
  const band = rounded(width, depth, .28 * k); band.holes.push(rounded(width - .2 * k, depth - .2 * k, .2 * k, new T.Path()));
  group.add(lay(new T.Mesh(new T.ExtrudeGeometry(rounded(width - .14 * k, depth - .14 * k, .22 * k), { depth: .05 * k, ...flat }), lacquer), height - .05 * k), lay(new T.Mesh(new T.ExtrudeGeometry(band, { depth: .11 * k, ...flat }), lacquer), height - .05 * k));
  // The apron sits in under the top; its lower edge is two shallow curves that meet in the middle.
  const inset = .3 * k, drop = .17 * k;
  const apron = span => { const s = new T.Shape(), x = span / 2; s.moveTo(-x, 0); s.lineTo(x, 0); s.lineTo(x, -drop * 1.25); s.quadraticCurveTo(x / 2, -drop * .45, 0, -drop); s.quadraticCurveTo(-x / 2, -drop * .45, -x, -drop * 1.25); s.closePath(); return new T.ExtrudeGeometry(s, { depth: .03 * k, ...flat }); };
  for (const [span, x, z, turn] of [[width - inset * 2, 0, depth / 2 - inset, 0], [width - inset * 2, 0, -depth / 2 + inset, Math.PI], [depth - inset * 2, width / 2 - inset, 0, Math.PI / 2], [depth - inset * 2, -width / 2 + inset, 0, -Math.PI / 2]]) {
    const panel = new T.Mesh(apron(span), lacquer); panel.position.set(x, height - .05 * k, z); panel.rotation.y = turn; panel.translateZ(-.015 * k); group.add(panel);
  }
  // Legs: each flares outward on its diagonal and returns at the foot, with two faint joints like bamboo.
  const joint = (u, at) => Math.exp(-(((u - at) / .035) ** 2)), girth = u => .062 * k * (1 - .16 * u + .13 * joint(u, .34) + .13 * joint(u, .7) + .3 * Math.max(0, (u - .93) / .07));
  const flare = u => .09 * k * Math.sin(Math.PI * u ** .85), railAt = .56, feet = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (width / 2 - inset), z = sz * (depth / 2 - inset), points = []; for (let i = 0; i <= 8; i++) { const u = i / 8, out = flare(u) * .707; points.push(V(x + sx * out, (height - .05 * k) * (1 - u), z + sz * out)); }
    group.add(new T.Mesh(taperTube(kit, new T.CatmullRomCurve3(points), girth, 30, 10), lacquer));
    const out = flare(railAt) * .707; feet.push(V(x + sx * out, (height - .05 * k) * (1 - railAt), z + sz * out));
  }
  // The rail joins the legs on all four sides.
  for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]]) { const from = feet[a], to = feet[b], rail = new T.Mesh(new T.CylinderGeometry(.034 * k, .034 * k, from.distanceTo(to), 10), lacquer); rail.position.copy(from).lerp(to, .5); rail.quaternion.setFromUnitVectors(V(0, 1, 0), to.clone().sub(from).normalize()); group.add(rail); }
  group.userData.top = height; group.userData.rail = feet;
  return group;
}

/** A brass daejeop of seaweed soup standing on y = 0: a foot ring, a wide bowl flaring slightly, dark broth with a few ribbons of seaweed. */
export function soupBowl(kit, { radius = .4 } = {}) {
  const { T, V, rnd, mat } = kit, group = new T.Group(), r = radius;
  const wall = [[.3, 0], [.43, 0], [.44, .09], [.52, .12], [.8, .3], [.95, .5], [1, .64], [.97, .64], [.9, .5], [.74, .31], [.42, .17], [.001, .15]].map(([x, y]) => new T.Vector2(x * r, y * r));
  group.add(new T.Mesh(new T.LatheGeometry(new T.SplineCurve(wall).getPoints(60).map(point => point.set(Math.max(.001, point.x), point.y)), 64), mat({ color: BRASS, metalness: 1, roughness: .3, side: T.DoubleSide }, 1.2, false)));
  const broth = new T.Mesh(new T.CircleGeometry(.9 * r, 48), mat({ color: 0x2a3a22, roughness: .1, clearcoat: 1, see: .3 }, 1)); broth.rotation.x = -Math.PI / 2; broth.position.y = .53 * r; group.add(broth);
  const weed = mat({ color: 0x1c4a2c, roughness: .45, clearcoat: .3, side: T.DoubleSide, see: .2 }, .3);
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26 + rnd(i, 3), reach = (.25 + rnd(i, 4) * .4) * r, bend = (rnd(i, 5) - .5) * 2.2, points = [];
    for (let j = 0; j <= 10; j++) { const u = j / 10 - .5, turn = a + bend * u; points.push(V(Math.cos(a) * reach * .5 + Math.cos(turn) * u * .7 * r, .535 * r + Math.sin(j * 1.3 + i) * .012 * r, Math.sin(a) * reach * .5 + Math.sin(turn) * u * .7 * r)); }
    group.add(new T.Mesh(kit.ribbonGeo(points, (.1 + rnd(i, 6) * .08) * r, V(Math.sin(a), 0, -Math.cos(a))), weed));
  }
  group.userData.surface = .55 * r;
  return group;
}

/** Sujeo: a brass spoon with a long straight handle and a round bowl, and a pair of chopsticks,
 * lying on y = 0 along x with the handles toward +x. About `length` long. */
export function sujeo(kit, { length = 1 } = {}) {
  const { T, mat } = kit, group = new T.Group(), brass = mat({ color: BRASS, metalness: 1, roughness: .28, side: T.DoubleSide }, 1.2, false);
  const dish = new T.Mesh(new T.SphereGeometry(1, 24, 10, 0, 6.283, Math.PI / 2, Math.PI / 2), brass); dish.scale.set(.13 * length, .04 * length, .095 * length); dish.position.set(-.37 * length, .045 * length, 0);
  const handle = new T.Mesh(new T.BoxGeometry(.72 * length, .012 * length, .036 * length), brass); handle.position.set(.1 * length, .04 * length, 0); handle.rotation.z = .02;
  group.add(dish, handle);
  for (const side of [0, 1]) { const stick = new T.Mesh(new T.CylinderGeometry(.008 * length, .012 * length, .95 * length, 4), brass); stick.rotation.z = Math.PI / 2; stick.rotation.y = side * .05; stick.position.set(0, .012 * length, (.12 + side * .055) * length); group.add(stick); }
  return group;
}
