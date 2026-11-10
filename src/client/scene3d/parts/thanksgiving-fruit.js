// Orchard fruit of the Thanksgiving scene (#607): apples with a dimpled stem end and a painted
// streaked skin, a freckled pear, a bunch of glass grapes and cranberries. Each piece is built
// around its own centre at the size asked for. See ../README.md, "Shared parts".
import { loft, through } from './thanksgiving-loft.js';

const rgba = (kit, colour, alpha) => { const c = new kit.T.Color(colour); return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`; };
/** Draw the same thing three times, one texture width apart, so it wraps around the fruit without a seam. */
const around = (g, width, draw) => { for (const shift of [-width, 0, width]) { g.save(); g.translate(shift, 0); draw(); g.restore(); } };
const stemMaterial = kit => kit.mat({ color: 0x5a3b22, roughness: .8 }, .3, false);

/** An apple, `radius` across its widest half. `skin` is 'red' (deep red with a gold blush) or
 * 'gold' (golden with red streaks). The group's origin is the apple's centre, stem up. */
export function apple(kit, { radius = .42, skin = 'red', salt = 0 } = {}) {
  const { T, rnd } = kit, group = new T.Group(), profile = [];
  // From the calyx up to the stem: widest above the middle, a shallow basin below and a deep cavity above.
  for (let i = 0; i <= 44; i++) {
    const t = i / 44 * Math.PI, s = Math.sin(t), c = -Math.cos(t);
    const y = c - (c > 0 ? .42 * Math.exp(-Math.pow(s / .34, 2)) : -.2 * Math.exp(-Math.pow(s / .3, 2)));
    profile.push(new T.Vector2(Math.max(s * (1 + .1 * s * c), .0001), y * .9));
  }
  const [low, high, blush, streak] = skin === 'red' ? ['#c9903e', '#a81f26', '#e8b24a', '110,10,22'] : ['#c2ad4a', '#dba632', '#c8432b', '196,58,30'];
  const paint = kit.canvasTexture(512, 256, g => {
    const body = g.createLinearGradient(0, 0, 0, 256); body.addColorStop(0, high); body.addColorStop(.62, high); body.addColorStop(1, low); g.fillStyle = body; g.fillRect(0, 0, 512, 256);
    // The side that saw less sun.
    around(g, 512, () => { const patch = g.createRadialGradient(170, 150, 8, 170, 150, 165); patch.addColorStop(0, rgba(kit, blush, .85)); patch.addColorStop(1, rgba(kit, blush, 0)); g.fillStyle = patch; g.fillRect(-10, 0, 380, 256); });
    // Streaks run from the stem to the calyx; pale lenticels dot the skin.
    for (let i = 0; i < 110; i++) {
      const x = rnd(i, salt + 1) * 512, drift = (rnd(i, salt + 5) - .5) * 26;
      around(g, 512, () => { g.strokeStyle = `rgba(${streak},${.05 + rnd(i, salt + 2) * .17})`; g.lineWidth = 1 + rnd(i, salt + 3) * 5; g.beginPath(); g.moveTo(x, 6 + rnd(i, salt + 4) * 70); g.bezierCurveTo(x + drift * .3, 90, x + drift, 170, x + drift * .8, 250 - rnd(i, salt + 6) * 50); g.stroke(); });
    }
    for (let i = 0; i < 150; i++) { g.fillStyle = `rgba(255,238,196,${.2 + rnd(i, salt + 7) * .35})`; g.beginPath(); g.arc(rnd(i, salt + 8) * 512, 18 + rnd(i, salt + 9) * 224, .6 + rnd(i, salt + 10) * 1.1, 0, 7); g.fill(); }
  }, { anisotropy: 4 });
  const body = new T.Mesh(new T.LatheGeometry(profile, 44), kit.mat({ map: paint, roughness: .22, clearcoat: 1, clearcoatRoughness: .12 }, 1));
  const stem = new T.Mesh(loft(kit, through(kit, [[0, .46, 0], [.02, .74, 0], [.12, 1, .04]]), u => .035 + .03 * u * u, { rings: 8, sides: 6 }), stemMaterial(kit));
  const whole = new T.Group(); whole.add(body, stem); whole.scale.setScalar(radius); group.add(whole);
  return group;
}

/** A pear, `radius` across its bowl and about 2.6 radii tall. The group's origin is the centre of the bowl, stem up. */
export function pear(kit, { radius = .36, salt = 0 } = {}) {
  const { T, rnd } = kit, group = new T.Group(), profile = [];
  // A round bowl below and a smaller round shoulder above, blended into one outline.
  for (let i = 0; i <= 48; i++) {
    const y = -1 + 2.55 * (1 - Math.cos(Math.PI * i / 48)) / 2, bowl = Math.abs(y) < 1 ? Math.sqrt(1 - y * y) : 0, neck = Math.abs(y - 1.05) < .5 ? Math.sqrt(.25 - Math.pow(y - 1.05, 2)) : 0;
    profile.push(new T.Vector2(Math.max(Math.cbrt(bowl ** 3 + neck ** 3), .0001), y));
  }
  const paint = kit.canvasTexture(512, 256, g => {
    const body = g.createLinearGradient(0, 0, 0, 256); body.addColorStop(0, '#a3ad4a'); body.addColorStop(.55, '#93a044'); body.addColorStop(1, '#b3a340'); g.fillStyle = body; g.fillRect(0, 0, 512, 256);
    around(g, 512, () => { const patch = g.createRadialGradient(330, 160, 10, 330, 160, 150); patch.addColorStop(0, 'rgba(196,88,48,.7)'); patch.addColorStop(1, 'rgba(196,88,48,0)'); g.fillStyle = patch; g.fillRect(170, 0, 330, 256); });
    for (let i = 0; i < 420; i++) { g.fillStyle = `rgba(96,66,24,${.16 + rnd(i, salt + 1) * .3})`; g.beginPath(); g.arc(rnd(i, salt + 2) * 512, rnd(i, salt + 3) * 256, .5 + rnd(i, salt + 4) * 1.2, 0, 7); g.fill(); }
  }, { anisotropy: 4 });
  const body = new T.Mesh(new T.LatheGeometry(profile, 44), kit.mat({ map: paint, roughness: .5, clearcoat: .25, clearcoatRoughness: .55 }, .7));
  const stem = new T.Mesh(loft(kit, through(kit, [[0, 1.5, 0], [.03, 1.8, 0], [.14, 2.08, .03]]), u => .04 + .03 * u * u, { rings: 8, sides: 6 }), stemMaterial(kit));
  const whole = new T.Group(); whole.add(body, stem); whole.scale.setScalar(radius); group.add(whole);
  return group;
}

/** Rings of a hanging bunch, from the stalk down: [distance down, grapes, ring radius]. */
const BUNCH = [[.1, 3, .13], [.3, 5, .24], [.52, 6, .28], [.74, 5, .25], [.95, 4, .19], [1.14, 3, .12], [1.3, 1, .02], [1.44, 1, 0]];

/** A bunch of dark glass grapes about 1.5 x `size` long, hanging down from the group's origin
 * (the top of its stalk). Turn the group to lay the bunch down. */
export function grapes(kit, { size = 1, salt = 0 } = {}) {
  const { T, C, rnd, mix } = kit, group = new T.Group(), spots = [];
  BUNCH.forEach(([down, count, ring], level) => {
    for (let k = 0; k < count; k++) {
      const i = spots.length, angle = (k + (level % 2) * .5 + (rnd(i, salt + 1) - .5) * .3) / count * Math.PI * 2;
      spots.push([Math.cos(angle) * ring, -down + (rnd(i, salt + 2) - .5) * .05, Math.sin(angle) * ring, .118 + rnd(i, salt + 3) * .03]);
    }
  });
  const mesh = new T.InstancedMesh(new T.SphereGeometry(1, 24, 16), kit.mat({ color: 0xffffff, roughness: .1, clearcoat: 1, clearcoatRoughness: .08, emissive: 0x1c0a30, emissiveIntensity: .3, see: .7 }, 1.3), spots.length), o = new T.Object3D();
  spots.forEach(([x, y, z, radius], i) => {
    o.position.set(x * size, y * size, z * size); o.scale.set(radius * size, radius * size * 1.08, radius * size); o.rotation.set(rnd(i, salt + 4), rnd(i, salt + 5) * 6, 0); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
    mesh.setColorAt(i, C(mix(mix(0x4b2a5e, 0x62367c, rnd(i, salt + 6) * .7), 0x2a1838, rnd(i, salt + 7) * .6)));
  });
  mesh.instanceColor.needsUpdate = true; mesh.frustumCulled = false;
  const stalk = new T.Mesh(loft(kit, through(kit, [[.02, -.2 * size, 0], [0, .05 * size, 0], [-.06 * size, .3 * size, .02 * size]]), u => (.03 + .015 * u) * size, { rings: 8, sides: 6 }), stemMaterial(kit));
  group.add(mesh, stalk);
  return group;
}

/** Cranberries as one mesh: `spots` are [x, y, z, radius] of each berry's centre. Three reds, cycled. */
export function cranberries(kit, spots) {
  const { T, C } = kit, REDS = [0x9e1b32, 0xb8243c, 0x7f1228];
  const mesh = new T.InstancedMesh(kit.ballGeo, kit.mat({ color: 0xffffff, roughness: .14, clearcoat: 1, clearcoatRoughness: .1 }, 1.1), spots.length), o = new T.Object3D();
  spots.forEach(([x, y, z, radius], i) => { o.position.set(x, y, z); o.scale.set(radius, radius * .9, radius); o.rotation.set(i * 1.7, i * .9, i * 2.3); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix); mesh.setColorAt(i, C(REDS[i % REDS.length])); });
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}
