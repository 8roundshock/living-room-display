// Pumpkins of the Halloween scene (#608): a ribbed, dimpled body with a twisted stem, optionally
// carved with a calm face and lit from inside. Until #691 they were clear-coated art glass; the
// owner found them "too shiny" (2026-11-12), so the skin is now a pumpkin's: matte and waxy, with
// fine streaks along the ribs, and the stem is dry. See ../README.md, "Shared parts".
import { loft, through, smoothSeam } from './thanksgiving-loft.js';

/** The carved face on the body's alpha map (1024 x 512, the face centred on the side that faces
 * +z): two upright triangle eyes, a small triangle nose and a plain crescent smile with two teeth. */
function face(g) {
  const cx = 256, cy = 232, k = 1.22, X = x => cx + x * k, Y = y => cy + y * k;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 1024, 512); g.fillStyle = '#000';
  const shape = points => { g.beginPath(); points.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); g.fill(); };
  for (const side of [-1, 1]) shape([[side * 62 - 27, -34], [side * 62 + 27, -34], [side * 58, -82]]);
  shape([[-13, 12], [13, 12], [0, -11]]);
  g.beginPath(); g.moveTo(X(-98), Y(34)); g.quadraticCurveTo(X(0), Y(128), X(98), Y(34)); g.quadraticCurveTo(X(0), Y(72), X(-98), Y(34)); g.closePath(); g.fill();
  g.fillStyle = '#fff'; g.fillRect(X(-40), Y(44), 22 * k, 17 * k); g.fillRect(X(16), Y(62), 22 * k, 20 * k);
}

/** A glass pumpkin standing on the group's origin, `width` across and `height` tall, with `ribs`
 * lobes. `carved` cuts the face into the side that faces +z and lights the pumpkin from inside
 * with one small warm light that breathes slowly. `stem` is [lean, length] (lean -1 to 1: which
 * way it bends), `tendril` adds a thin curl beside it, `see` is the share of the see-through look. */
export function pumpkin(kit, { colour = 0xff8a1f, width = 1.5, height = 1.1, ribs = 10, groove = .12, carved = false, stem = [.6, 1], tendril = false, salt = 0, see = 1 } = {}) {
  const { T, rnd, tick } = kit, group = new T.Group(), columns = ribs * 8, rows = 40, TOP = .22, BOTTOM = .14, CROWN = .848;
  const geometry = new T.SphereGeometry(1, columns, rows), p = geometry.attributes.position, tone = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), flat = Math.hypot(x, z), phi = Math.atan2(z, x);
    // Lobes swell between creases; each lobe a little different; the creases fade into the dimples.
    const swell = Math.pow(Math.abs(Math.sin(ribs * phi / 2)), .55), lobe = Math.floor(((phi / (2 * Math.PI) + 1) % 1) * ribs), uneven = .7 + rnd(lobe, salt + 1) * .6;
    const out = Math.pow(flat, .85) * (1 - groove * uneven * (1 - swell) * Math.min(1, flat * 1.8)) / (flat || 1);
    const dimple = (y > 0 ? TOP : -BOTTOM) * Math.exp(-Math.pow(flat / .32, 2));
    p.setXYZ(i, x * out * width / 2, ((y - dimple) / CROWN + 1) * height / 2, z * out * width / 2);
    const shade = .3 + .7 * Math.pow(swell, .8); tone[i * 3] = tone[i * 3 + 1] = tone[i * 3 + 2] = shade;   // darker in the creases, so the ribs read on a matte skin
  }
  geometry.setAttribute('color', new T.BufferAttribute(tone, 3)); smoothSeam(kit, geometry, columns);
  // The skin: fine streaks that run along the ribs and a few small blemishes, in its relief only.
  const skin = kit.canvasTexture(512, 256, g => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 1100; i++) { const value = rnd(i, salt + 44) < .5 ? 96 : 168; g.fillStyle = `rgba(${value},${value},${value},${.2 + rnd(i, salt + 45) * .3})`; g.fillRect(rnd(i, salt + 41) * 512, rnd(i, salt + 42) * 256, 1 + rnd(i, salt + 46) * 1.5, 6 + rnd(i, salt + 43) * 44); }
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(70,70,70,.35)'; g.beginPath(); g.arc(rnd(i, salt + 47) * 512, rnd(i, salt + 48) * 256, 1 + rnd(i, salt + 49) * 2.5, 0, 7); g.fill(); }
  }, { srgb: false, repeat: true });
  // Matte and waxy: a broad soft sheen, no clear coat.
  const glass = { color: colour, vertexColors: true, roughness: .62, metalness: 0, bumpMap: skin, bumpScale: .006, see };
  if (carved) Object.assign(glass, { alphaMap: kit.canvasTexture(1024, 512, face, { srgb: false, anisotropy: 4 }), alphaTest: .5 });
  group.add(new T.Mesh(geometry, kit.mat(glass, 1.15)));

  if (carved) {
    // The lit inside, seen through the cuts and, faintly, through the glass: brighter at the bottom.
    const ember = kit.canvasTexture(8, 128, g => { const fire = g.createLinearGradient(0, 0, 0, 128); fire.addColorStop(0, '#d9700f'); fire.addColorStop(.38, '#ffae2e'); fire.addColorStop(.7, '#ffd264'); fire.addColorStop(1, '#fff0b4'); g.fillStyle = fire; g.fillRect(0, 0, 8, 128); });
    const inside = new T.Mesh(geometry, new T.MeshBasicMaterial({ map: ember, side: T.BackSide })); inside.scale.setScalar(.9); inside.position.y = height * .05;
    const halo = kit.glow(0xffa040, 2.6 * width / 2.3, .35, { twinkle: 0 }); halo.position.set(0, height * .48, -width * .1);
    // A soft bloom in front of the face, so the cuts read as light and not as paint.
    const bloom = kit.glow(0xffb050, 1.9 * width / 2.3, .2, { twinkle: 0 }); bloom.position.set(0, height * .46, width * .52);
    const lamp = new T.PointLight(0xffa040, 1.6, 5 * width / 2.3, 2); lamp.position.set(0, height * .45, 0);
    group.add(inside, halo, bloom, lamp);
    // Two slow waves that never line up: a breath, not a flicker.
    tick(t => { const breath = 1 + .08 * Math.sin(t * 7.2) + .04 * Math.sin(t * 5.1 + 1.3); lamp.intensity = 1.6 * breath; halo.userData.o = .35 * breath; bloom.userData.o = .2 * breath; inside.material.color.setScalar(1.45 * breath); });
  }

  // A twisted five-sided stem rising from the top dimple and bending over.
  const [lean, tall] = stem, crown = height * ((1 - TOP) / CROWN + 1) / 2, w = Math.min(width, height * 1.3) * .5;
  const stalk = through(kit, [[0, crown - .04 * w, 0], [lean * .03 * w, crown + .22 * w * tall, .02 * w], [lean * .16 * w, crown + .42 * w * tall, .05 * w], [lean * .4 * w, crown + .5 * w * tall, .08 * w]]);
  // A dry, ridged stem: grey-green going to tan, matte.
  const bronze = kit.mat({ color: 0x7c7650, roughness: .9, metalness: 0, flatShading: true, own: .12 }, .2, false);
  group.add(new T.Mesh(loft(kit, stalk, u => w * (.085 - .035 * u + .09 * Math.exp(-u * 9)) * Math.min(1, Math.sqrt((1 - u) / .05)), { rings: 22, sides: 5, twist: .7 }), bronze));
  if (tendril) {
    const points = []; for (let k = 0; k <= 60; k++) { const s = k / 60, a = s * Math.PI * 7, r = .07 * w * (1 - .45 * s); points.push([-lean * (.05 + .75 * s) * w + Math.cos(a) * r * .5, crown + .06 * w + s * .12 * w + Math.sin(a) * r, .12 * w + .2 * s * w + Math.cos(a) * r]); }
    group.add(new T.Mesh(loft(kit, through(kit, points), u => w * (.014 - .008 * u), { rings: 120, sides: 5 }), bronze));
  }
  return group;
}
