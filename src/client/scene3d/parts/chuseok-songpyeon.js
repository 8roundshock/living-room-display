// The Chuseok tray (#629): half-moon songpyeon (송편) as they come off the steam, still on their
// bed of paired pine needles, on a chaeban (채반), the flat, rimless tray woven from bush clover.
// Served songpyeon are needle-free and oiled; showing them on the needles on the woven tray joins
// two sourced steaming methods and is a design choice. See ../README.md.
import { cordMaterial, smooth } from './seollal-forms.js';

/** One songpyeon resting on y = 0 with its plump belly down and its pinched seam up, long axis
 * on x: about 0.62 x 0.34 x 0.3 times `size`. `seed` shapes it; `dimples` presses finger marks in. */
export function songpyeon(kit, { size = 1, colour = 0xf1ece0, seed = 1, dimples = 0 } = {}) {
  const { T, C, mat } = kit, geometry = new T.SphereGeometry(1, 40, 24), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ax = Math.abs(x), taper = 1 - .22 * ax ** 3;
    // The seam is pinched thin and stands up as a low fin; the horns of the half moon are drawn down.
    const Y = (y < 0 ? y * .55 : y) + .16 * smooth(y, .5, 1) * (1 - ax * ax) - (.34 + .08 * Math.sin(seed * 2.3)) * x * x;
    let Z = z * (1 - .66 * smooth(y, -.2, .95)) * (1 + .1 * Math.sin(x * 2.2 + seed * 1.7));
    for (let d = 0; d < dimples; d++) { const centre = -.35 + d * .5 + .1 * Math.sin(seed + d); Z -= Z * .32 * Math.exp(-(((x - centre) / .17) ** 2) - ((y + .05) / .3) ** 2); }
    p.setXYZ(i, x * .31 * (1 + .05 * Math.sin(seed * 3.1)) * size, (Y * taper + .55) * .2 * size, Z * taper * .155 * size);
  }
  geometry.computeVertexNormals();
  // The soft gloss of the sesame-oil coat over a rice cake that holds a little light.
  return new T.Mesh(geometry, mat({ color: colour, roughness: .4, clearcoat: .45, clearcoatRoughness: .3, emissive: C(colour).multiplyScalar(.1), see: .6 }, .6));
}

/** The chaeban: a round, almost flat woven tray lying in the x-z plane, with a bound edge and no rim. */
export function chaeban(kit, { radius = 1.6 } = {}) {
  const { T, rnd, canvasTexture, mat } = kit, group = new T.Group(), PX = 1024, PY = 256, RIBS = 60, ROWS = 15, cw = PX / RIBS, ch = PY / ROWS;
  // Radial ribs and a weft that passes over and under them, drawn once and read three ways:
  // colour, height, and how much is cloth (the gaps of the open weave stay nearly clear).
  const weave = mode => (g => {
    g.fillStyle = mode === 'map' ? '#33230f' : mode === 'alpha' ? '#2c2c2c' : '#303030'; g.fillRect(0, 0, PX, PY);
    const strand = (x, y, w, h, along, tone, over) => {
      const shade = along ? g.createLinearGradient(x, 0, x + w, 0) : g.createLinearGradient(0, y, 0, y + h);
      const [lo, hi] = mode === 'map' ? [`rgb(${Math.round(84 * tone)},${Math.round(62 * tone)},${Math.round(32 * tone)})`, `rgb(${Math.round(158 * tone)},${Math.round(124 * tone)},${Math.round(74 * tone)})`] : mode === 'alpha' ? ['#ffffff', '#ffffff'] : over ? ['#707070', '#f0f0f0'] : ['#505050', '#909090'];
      shade.addColorStop(0, lo); shade.addColorStop(.5, hi); shade.addColorStop(1, lo); g.fillStyle = shade; g.fillRect(x, y, w, h);
    };
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < RIBS; i++) {
      const over = (i + j) % 2 === 0, tone = .8 + rnd(j * RIBS + i, 7) * .35, rowTone = .85 + rnd(j, 9) * .3;
      const weft = () => strand(i * cw - 1, j * ch + ch * .12, cw + 2, ch * .76, true, tone * rowTone, over), rib = () => strand(i * cw + cw * .27, j * ch - 1, cw * .46, ch + 2, false, .9 + rnd(i, 11) * .2, !over);
      if (over) { rib(); weft(); } else { weft(); rib(); }
    }
  });
  const map = canvasTexture(PX, PY, weave('map'), { anisotropy: 8 }), alpha = canvasTexture(PX, PY, weave('alpha'), { srgb: false, anisotropy: 8 }), bump = canvasTexture(PX, PY, weave('bump'), { srgb: false });
  // A lathe maps the texture around and outward, so the ribs become spokes; the tray dips a little in the middle.
  const profile = []; for (let i = 0; i <= 12; i++) { const r = radius * (.1 + .9 * i / 12); profile.push(new T.Vector2(r, .05 * radius * (r / radius) ** 2)); }
  const tray = new T.Mesh(new T.LatheGeometry(profile, 96), mat({ map, alphaMap: alpha, bumpMap: bump, bumpScale: .03, roughness: .7, side: T.DoubleSide, see: .8 }, .4, false));
  const bound = new T.Mesh(new T.TorusGeometry(radius, radius * .034, 8, 96), cordMaterial(kit, 0xb08a52, 0x7d5f33, 70)); bound.rotation.x = Math.PI / 2; bound.scale.z = .75; bound.position.y = .05 * radius;
  group.add(tray, bound);
  return group;
}

/** Lay pine needles on a tray of `radius` into a needle collector (kit.needles): `pairs` pairs,
 * each joined at a small brown sheath, nearly flat, in two greens. Some overhang the edge. */
export function pineBed(kit, needles, { radius = 1.3, pairs = 250, salt = 5 } = {}) {
  const { V, C, rnd } = kit, deep = C(0x2f5d3a), fresh = C(0x4f8a4c), sheath = C(0x6a4a2a), at = V(), d = V();
  for (let i = 0; i < pairs; i++) {
    const a = rnd(i, salt) * 6.283, r = radius * .8 * Math.sqrt(rnd(i, salt + 1)), yaw = rnd(i, salt + 2) * 6.283, length = (.55 + rnd(i, salt + 3) * .4) * radius / 1.3;
    const tone = rnd(i, salt + 5) < .55 ? deep : fresh, shade = .8 + rnd(i, salt + 6) * .5;
    at.set(Math.cos(a) * r - Math.cos(yaw) * length / 2, .03 + rnd(i, salt + 4) * .1, Math.sin(a) * r - Math.sin(yaw) * length / 2);
    for (const side of [-1, 1]) { d.set(Math.cos(yaw + side * .06), (rnd(i, salt + 7) - .45) * .12, Math.sin(yaw + side * .06)).normalize(); needles.add(at, d, length * (side < 0 ? 1 : .93), tone.r * shade, tone.g * shade, tone.b * shade); }
    d.set(Math.cos(yaw), 0, Math.sin(yaw)); at.addScaledVector(d, -.05); needles.add(at, d, .07, sheath.r, sheath.g, sheath.b);
  }
}
