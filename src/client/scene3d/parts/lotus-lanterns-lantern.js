// Lanterns of Yeondeunghoe, the lantern festival of Buddha's Birthday (#630). The lotus lantern
// (연꽃등) is built the traditional way: an eight-sided frame covered in white hanji, then rows of
// creased, dyed petals glued on one by one, each row between the petals above, their tips
// twisted to a point by hand, and green leaves to finish the bottom. The palmo-deung (팔모등)
// is the plain eight-sided hanji lantern. Each carries a blank paper tag. No lettering, no
// symbol, no figure. See ../README.md.
import { hanjiFibres, hanjiPaper } from './seollal-hanji.js';

const WARM = 0xffa850, WIRE = 0x4a4238;
/** Petal papers as [glued end, middle, tip]. */
export const LOTUS_PINK = ['#fff3ea', '#f8c6d6', '#e8528c'], LOTUS_WHITE = ['#fbf6ea', '#f6efe2', '#f1d9d2'], LOTUS_YELLOW = ['#fff6dc', '#f9dc8c', '#f7c452'], LOTUS_LEAF = ['#b9d99a', '#6fae68', '#4f9a5a'];

/** Dyed, creased hanji for a petal: colour, the light that comes through it (strongest at the glued end, near the candle), and the creases as height. */
function petalPaper(kit, [glued, middle, tip], salt) {
  const { rnd, canvasTexture } = kit, PX = 128, PY = 512, CREASES = 20;
  const crease = (g, light, dark) => { for (let i = 0; i < CREASES; i++) { const x = (i + .5) / CREASES * PX + (rnd(i, salt) - .5) * 3; g.strokeStyle = i % 2 ? light : dark; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rnd(i, salt + 1) - .5) * 4, PY); g.stroke(); } };
  const paint = (g, lit) => {
    const tone = g.createLinearGradient(0, PY, 0, 0); tone.addColorStop(0, glued); tone.addColorStop(.45, middle); tone.addColorStop(1, tip); g.fillStyle = tone; g.fillRect(0, 0, PX, PY);
    crease(g, 'rgba(255,255,255,.2)', 'rgba(96,58,52,.14)'); hanjiFibres(kit, g, PX, PY, { count: 70, salt, strength: .12 });
    if (!lit) return;
    g.globalCompositeOperation = 'multiply'; const fall = g.createLinearGradient(0, PY, 0, 0); fall.addColorStop(0, '#ffffff'); fall.addColorStop(.5, '#a0a0a0'); fall.addColorStop(1, '#404040'); g.fillStyle = fall; g.fillRect(0, 0, PX, PY); g.globalCompositeOperation = 'source-over';
  };
  return { map: canvasTexture(PX, PY, g => paint(g, false), { anisotropy: 4 }), light: canvasTexture(PX, PY, g => paint(g, true)), bump: canvasTexture(PX, PY, g => { g.fillStyle = '#808080'; g.fillRect(0, 0, PX, PY); crease(g, 'rgba(255,255,255,.55)', 'rgba(0,0,0,.5)'); }, { srgb: false }) };
}

/** One petal growing along +y from the origin, one unit long and about one wide, its outer face
 * toward +z: cupped around the lantern, and twisted to a point over its last fifth. */
function petalGeometry(kit, seed) {
  const { T } = kit, geometry = new T.PlaneGeometry(1, 1, 8, 16), p = geometry.attributes.position, hand = Math.sin(seed * 5) > 0 ? 1 : -1;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2, v = p.getY(i) + .5, x = u * .5 * Math.sin(Math.PI * (.1 + .9 * v)) ** .7 * (1 + .06 * Math.sin(v * 3 + seed));
    const rib = -.3 * v * v + .1 * Math.sin(Math.PI * v), dip = -.5 * x * x * (1 + .3 * Math.sin(seed * 2)), turn = hand * 2.44 * Math.max(0, (v - .8) / .2) ** 1.2;
    p.setXYZ(i, x * Math.cos(turn) - dip * Math.sin(turn), v, rib + x * Math.sin(turn) + dip * Math.cos(turn));
  }
  geometry.computeVertexNormals(); return geometry;
}

/** A ring of petals glued around the frame. `lean` is the angle from upright, outward. */
function petalRing(kit, geometry, material, { count, radius, height, lean, length, width, offset = 0, salt = 0 }) {
  const { T, V, rnd } = kit, mesh = new T.InstancedMesh(geometry, material, count), m = new T.Matrix4(), x = V(), along = V(), out = V(), size = V();
  for (let k = 0; k < count; k++) {
    // Hand-made: no petal sits exactly where the next one does.
    const around = (k + offset) / count * 6.283 + (rnd(k, salt) - .5) * .14, tilt = lean + (rnd(k, salt + 1) - .5) * .16, reach = length * (.93 + rnd(k, salt + 2) * .14);
    along.set(Math.sin(tilt) * Math.cos(around), Math.cos(tilt), Math.sin(tilt) * Math.sin(around)); out.set(Math.cos(tilt) * Math.cos(around), -Math.sin(tilt), Math.cos(tilt) * Math.sin(around)); x.crossVectors(along, out);
    m.makeBasis(x, along, out).scale(size.set(width, reach, reach * .62)).setPosition(radius * Math.cos(around), height, radius * Math.sin(around)); mesh.setMatrixAt(k, m);
  }
  mesh.frustumCulled = false; return mesh;
}

/** Row layouts for a unit frame (0.62 across the top, 0.8 high): the large lantern, a small one of two rows, one of three short rows. */
export const LOTUS_FULL = [{ count: 10, radius: .6, height: .2, lean: .56, length: .95, width: .52 }, { count: 10, radius: .54, height: -.03, lean: .91, length: .86, width: .5, offset: .5 }, { count: 10, radius: .47, height: -.25, lean: 1.22, length: .76, width: .46 }];
export const LOTUS_TWO_ROWS = [{ count: 8, radius: .6, height: .15, lean: .6, length: .92, width: .58 }, { count: 8, radius: .5, height: -.16, lean: 1.05, length: .8, width: .54, offset: .5 }];
export const LOTUS_SHORT = [{ count: 9, radius: .6, height: .22, lean: .5, length: .7, width: .5 }, { count: 9, radius: .55, height: 0, lean: .82, length: .62, width: .48, offset: .5 }, { count: 9, radius: .48, height: -.22, lean: 1.12, length: .55, width: .44 }];

/** A lotus lantern centred on the group's origin. `userData.top` and `userData.bottom` are where
 * its handle and its base are; `userData.breathe(k)` sets how strongly it is lit (1 = full). */
export function lotusLantern(kit, { size = 1, paper = LOTUS_PINK, rows = LOTUS_FULL, leaves = 8, strength = .8, lamp = false, salt = 1 } = {}) {
  const { T, V, mat } = kit, group = new T.Group(), sheet = hanjiPaper(kit, 256, 128, { salt: salt + 3, fibres: 90 }), dyed = petalPaper(kit, paper, salt), green = petalPaper(kit, LOTUS_LEAF, salt + 9);
  const lit = [];
  const litPaper = (options, share) => { const material = mat({ color: 0xd2c8c4, roughness: .95, side: T.DoubleSide, emissive: WARM, see: .45, ...options }, .25, false); lit.push([material, strength * share]); return material; };
  // The frame: eight sides of white hanji, a wire at each rim and a wire handle over the top.
  const wire = mat({ color: WIRE, metalness: .8, roughness: .5 }, .6, false), rim = radius => { const ring = new T.Mesh(new T.TorusGeometry(radius, .013, 6, 8), wire); ring.rotation.x = Math.PI / 2; return ring; };
  const top = rim(.62), foot = rim(.42); top.position.y = .4; foot.position.y = -.4;
  const handle = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([V(-.62, .4, 0), V(-.42, .72, 0), V(0, .9, 0), V(.42, .72, 0), V(.62, .4, 0)]), 24, .013, 5), wire);
  group.add(new T.Mesh(new T.CylinderGeometry(.62, .42, .8, 8, 1, true), litPaper({ map: sheet.map, bumpMap: sheet.bump, bumpScale: .01, flatShading: true, emissiveMap: sheet.map }, 1.15)), top, foot, handle);
  // The petals: each row is its own cut of paper, so the rows differ as well as the petals.
  const petal = litPaper({ map: dyed.map, bumpMap: dyed.bump, bumpScale: .018, emissiveMap: dyed.light }, 1);
  rows.forEach((row, i) => group.add(petalRing(kit, petalGeometry(kit, 1 + i * 1.7 + salt), petal, { ...row, salt: salt + i * 11 })));
  // Green leaves finish the bottom, facing outward and down.
  group.add(petalRing(kit, petalGeometry(kit, 4.4 + salt), litPaper({ map: green.map, bumpMap: green.bump, bumpScale: .018, emissiveMap: green.light }, .5), { count: leaves, radius: .43, height: -.37, lean: 1.9, length: .5, width: .3, offset: .25, salt: salt + 40 }));
  if (lamp) { const candle = new T.PointLight(0xffb060, 1.4, 5, 2); group.add(candle); lit.push([candle, 1.4]); }
  group.scale.setScalar(size);
  group.userData = { top: .9 * size, bottom: -.42 * size, breathe: k => { for (const [item, base] of lit) item[item.isLight ? 'intensity' : 'emissiveIntensity'] = base * k; } };
  group.userData.breathe(1);
  return group;
}

/** The eight-sided lantern, 0.85 wide and 1.15 high times `size`, centred on the origin: plain
 * hanji faces lit from inside, narrow bands along its edges and rims, and small paper pennants
 * at its lower corners. */
export function palmoLantern(kit, { size = 1, band = 0x6fd0bc, accent = 0xf8c6d6, strength = .5, salt = 7 } = {}) {
  const { T, V, tick, mat, canvasTexture } = kit, group = new T.Group(), R = .425, sheet = hanjiPaper(kit, 256, 256, { salt, fibres: 130 });
  // The light inside is strongest behind the middle of each face.
  const light = canvasTexture(64, 256, g => { const fall = g.createLinearGradient(0, 0, 0, 256); fall.addColorStop(0, '#6a6258'); fall.addColorStop(.55, '#fff6e6'); fall.addColorStop(1, '#8a8072'); g.fillStyle = fall; g.fillRect(0, 0, 64, 256); });
  const faces = mat({ map: sheet.map, bumpMap: sheet.bump, bumpScale: .012, roughness: .95, side: T.DoubleSide, flatShading: true, emissive: WARM, emissiveMap: light, emissiveIntensity: strength, see: .4 }, .2, false);
  const strip = mat({ color: band, roughness: .8, emissive: band, emissiveIntensity: .14, side: T.DoubleSide }, .3, false);
  // [top y, bottom y, top radius, bottom radius]: a shoulder, the straight body, a foot.
  for (const [high, low, a, b] of [[.575, .4, .29, R], [.4, -.34, R, R], [-.34, -.575, R, .31]]) { const side = new T.Mesh(new T.CylinderGeometry(a, b, high - low, 8, 1, true), faces); side.position.y = (high + low) / 2; group.add(side); }
  for (const [y, radius] of [[.575, .29], [.4, R], [-.34, R], [-.575, .31]]) { const ring = new T.Mesh(new T.TorusGeometry(radius, .017, 6, 8), strip); ring.rotation.x = Math.PI / 2; ring.position.y = y; group.add(ring); }
  const pennant = new T.BufferGeometry(); pennant.setAttribute('position', new T.Float32BufferAttribute([-.05, 0, 0, .05, 0, 0, 0, -.2, 0], 3)); pennant.computeVertexNormals();
  const flag = mat({ color: accent, roughness: .9, side: T.DoubleSide, emissive: accent, emissiveIntensity: .12 }, .3, false);
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * 6.283, edge = new T.Mesh(new T.BoxGeometry(.034, .74, .012), strip); edge.position.set(Math.sin(a) * R, .03, Math.cos(a) * R); edge.rotation.y = a; group.add(edge);
    const hung = new T.Mesh(pennant, k % 2 ? strip : flag); hung.position.set(Math.sin(a) * (R + .012), -.35, Math.cos(a) * (R + .012)); hung.rotation.y = a; group.add(hung);
    tick(t => { hung.rotation.x = Math.sin(t * 2.6 + k * 1.3) * .22; });
  }
  // Four wires gather above the shoulder to the hanging loop.
  for (let k = 0; k < 4; k++) { const a = k / 4 * 6.283 + .393; group.add(kit.line([V(Math.sin(a) * .29, .575, Math.cos(a) * .29), V(0, .82, 0)], WIRE, .8)); }
  group.scale.setScalar(size);
  group.userData = { top: .82 * size, bottom: -.575 * size, breathe: k => { faces.emissiveIntensity = strength * k; } };
  return group;
}

/** A blank slip of hanji on a thread, hanging from the group's origin and turning slowly. */
export function lanternTag(kit, { width = .26, height = .95, thread = .45, salt = 1, phase = 0 } = {}) {
  const { T, V, tick, mat } = kit, group = new T.Group(), sheet = hanjiPaper(kit, 64, 256, { salt, fibres: 60 });
  const geometry = new T.PlaneGeometry(width, height, 4, 14); geometry.translate(0, -height / 2, 0);
  const p = geometry.attributes.position;
  // A slight curl down its length and a slight twist.
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), v = -p.getY(i) / height, turn = .5 * v; p.setXYZ(i, x * Math.cos(turn), p.getY(i), x * Math.sin(turn) + .05 * Math.sin(v * 4.1) * height); }
  geometry.computeVertexNormals();
  const slip = new T.Mesh(geometry, mat({ map: sheet.map, bumpMap: sheet.bump, bumpScale: .01, roughness: .95, side: T.DoubleSide, emissive: 0xffffff, emissiveMap: sheet.map, emissiveIntensity: .16, see: .45 }, .25, false)); slip.position.y = -thread;
  group.add(kit.line([V(), V(0, -thread, 0)], 0xcfc8d8, .55), slip);
  tick(t => { group.rotation.y = phase + Math.sin(t * 2.09 + phase) * 1.9; });
  return group;
}
