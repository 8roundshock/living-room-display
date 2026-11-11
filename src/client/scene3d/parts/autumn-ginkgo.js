// Ginkgo for Autumn (#615): a fan leaf on its long stalk. The fan has a wavy outer edge and a
// notch in the middle, veins that fork toward the rim, and colour that runs from green-gold at
// the stalk to gold at the rim; every leaf is its own geometry, so no two share an outline,
// a curl or a tint. Gold and amber only: red leaves belong to Canada Day. Since #653 a fan is
// thin glass: its body is see-through and its veins, rim and edges stay.
// A part: call ginkgo(kit) once and build with what it returns. See ../README.md.
import { blade, ramp, sheets } from './spring-blade.js';
import { limb, taper } from './spring-limb.js';

export function ginkgo(kit) {
  const { T, V, rnd } = kit;
  // Veins leave the stalk together and fork three times on the way out. The texture is polar (across the fan,
  // then out to the rim), so a straight line here is a straight vein on the leaf.
  const veins = (g, w, h, colour, width) => {
    g.strokeStyle = colour; g.lineCap = 'round';
    [[14, 0, 1.5], [14, .26, 1.2], [28, .52, 1], [56, .76, .8]].forEach(([count, from, thick], level) => {
      for (let k = 0; k < count; k++) { const x = (k + (level ? .5 : .25)) / count * w + (rnd(k, 31 + level) - .5) * w / count * .5; g.lineWidth = thick * width; g.beginPath(); g.moveTo(x, h * (1 - from)); g.lineTo(x + (rnd(k, 35 + level) - .5) * 3, 0); g.stroke(); }
    });
  };
  const softened = (w, h, draw, blur) => g => { const sharp = document.createElement('canvas'); sharp.width = w; sharp.height = h; draw(sharp.getContext('2d')); try { g.filter = `blur(${blur}px)`; } catch { /* no canvas filter: sharp veins */ } g.drawImage(sharp, 0, 0); try { g.filter = 'none'; } catch { /* no canvas filter */ } };
  const map = kit.canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${rnd(i, 21) < .5 ? '150,100,30' : '255,250,220'},${.03 + rnd(i, 22) * .05})`; g.beginPath(); g.ellipse(rnd(i, 23) * w, rnd(i, 24) * h, 3 + rnd(i, 25) * 8, 10 + rnd(i, 26) * 30, 0, 0, 7); g.fill(); }
    veins(g, w, h, 'rgba(140,98,30,.14)', 1.3);
  }, { anisotropy: 8 });
  const relief = kit.canvasTexture(512, 256, (g, w, h) => { g.fillStyle = '#787878'; g.fillRect(0, 0, w, h); softened(w, h, s => veins(s, w, h, '#ffffff', 2.4), 1.6)(g); }, { srgb: false });
  // How solid a fan is, place by place (#653: "more transparent"): its body between the veins is thin, and what
  // stays is what a leaf is seen by against the light: the veins, which crowd toward the rim, the rim itself and
  // the two straight edges that run out from the stalk. THIN is the body's share; 1 is solid.
  const THIN = .55;
  const solid = kit.canvasTexture(512, 256, (g, w, h) => {
    const body = Math.round(THIN * 255); g.fillStyle = `rgb(${body},${body},${body})`; g.fillRect(0, 0, w, h);
    softened(w, h, s => { veins(s, w, h, '#ffffff', 3); s.fillStyle = '#fff'; s.fillRect(0, 0, w, h * .05); s.fillRect(0, 0, w * .012, h); s.fillRect(w * .988, 0, w * .012, h); }, 1.2)(g);
  }, { srgb: false, anisotropy: 8 });
  // A dimmed yellow is gold only while it has no blue and no grey in it, and the engine's key light and tone
  // curve put both into anything bright (a fan lit at full strength comes out straw, and straw thinned on black
  // is khaki). So a fan is lit at about half strength (DEPTH), is matt, has tones without blue and
  // holds a little amber light of its own. A fan that dark would all but vanish under the kit's see-through
  // look, which thins a surface by how dark it is; so the fan takes only GLASS of that look, and its thinness
  // is drawn by `solid` above instead.
  const DEPTH = 0xbcbcbc, GLASS = .15;
  const fanLook = () => kit.mat({ color: DEPTH, vertexColors: true, map, alphaMap: solid, bumpMap: relief, bumpScale: .014, emissive: 0xe08a00, emissiveMap: map, emissiveIntensity: .2, roughness: 1, metalness: 0, side: T.DoubleSide, see: GLASS }, 0, false);
  const stalkLook = () => kit.mat({ color: 0xb07c10, roughness: .6, metalness: 0, see: .7 }, .3, false);
  const fans = fanLook(), stalks = stalkLook();

  // From the stalk out to the rim, for a green-gold, a gold and an amber leaf; a leaf's `tint` (0-1) blends between them.
  // (Deeper and more orange than they read on screen: the key light and the tone curve bleach a yellow toward straw.)
  const TONES = [ramp(kit, [[0, '#a89a00'], [.5, '#d8a400'], [1, '#f2b800']]), ramp(kit, [[0, '#b88c00'], [.5, '#e89c00'], [1, '#f6b000']]), ramp(kit, [[0, '#b87c00'], [.5, '#e08400'], [1, '#f09800']])];
  const BROWN = kit.C(0x8a5a2b), mixed = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  /** Three ways a fan holds itself: nearly flat, cupped, and with a ruffled edge. */
  const HOLDS = [{ cup: .04, ruffle: .015, curl: .05 }, { cup: .3, ruffle: .02, curl: .1 }, { cup: .1, ruffle: .07, curl: .18 }];

  /** One leaf. The origin is the foot of its stalk, where it joins the spur; the stalk runs
   * toward +y and the fan opens beyond it, facing +z. `size` is the fan's width, `stalk` the
   * stalk's length, `tint` 0 (green-gold) to 1 (amber), `hold` one of three curvatures,
   * `brown` gives it a dry brown rim. `own` gives it materials of its own and
   * `userData.fade(k)`, for a leaf that must fade out by itself.
   *
   * Drawing order. three.js draws see-through meshes from the farthest origin to the nearest,
   * and a nearer fan drawn first hides the one behind it. So the fan's own origin is the foot
   * of the stalk too, the point a hanging leaf sways about, and the fan is placed at the end
   * of the stalk inside its geometry: sway does not move that origin, so two overlapping fans
   * never trade places (with the origin on the fan, they did so every few seconds). Leaves
   * hung from one point share one origin and are drawn in the order they were made: make the
   * farthest first. */
  function leaf({ size = .6, stalk = .35, tint = .5, hold = 0, brown = false, seed = 0, own = false } = {}) {
    const S = sheets(kit), shape = HOLDS[((hold % 3) + 3) % 3], radius = size * .55, spread = 1.12 + rnd(seed, 1) * .34, notch = .1 + rnd(seed, 2) * .3, gap = .07 + rnd(seed, 3) * .04;
    const p1 = rnd(seed, 4) * 6, p2 = rnd(seed, 5) * 6, p3 = rnd(seed, 6) * 6, lopsided = (rnd(seed, 7) - .5) * .12, cup = shape.cup * (.7 + rnd(seed, 8) * .6), k = Math.min(1.999, Math.max(0, tint * 2)), low = TONES[Math.floor(k)], high = TONES[Math.floor(k) + 1], share = k - Math.floor(k);
    const reach = a => radius * (1 - notch * Math.exp(-(((a - lopsided) / gap) ** 2))) * (1 + .03 * Math.sin(a * 9 + p1) + .018 * Math.sin(a * 21 + p2)) * (1 - .2 * Math.pow(Math.abs(a) / spread, 6)) * (1 + lopsided * a);
    blade(kit, S, { spread, reach, cols: 56, rows: 9,
      lift: (x, y, r, a) => size * (cup * r * r * (a / spread) ** 2 + shape.ruffle * Math.pow(r, 2.5) * Math.sin(a * 6 + p3) - shape.curl * r * r - .05 * r * Math.exp(-((a / .3) ** 2))),
      tint: (u, v) => { const a = (u * 2 - 1) * spread, colour = mixed(low(v), high(v), share), dry = brown ? Math.min(1, Math.max(0, (v - (.8 + .06 * Math.sin(a * 9 + p2) + .03 * Math.sin(a * 23 + p1))) / .1)) : 0; return dry ? mixed(colour, [BROWN.r, BROWN.g, BROWN.b], dry * .85) : colour; } });
    const group = new T.Group(), bow = (rnd(seed, 9) - .5) * .5, fanMaterial = own ? fanLook() : fans, stalkMaterial = own ? stalkLook() : stalks;
    const geometry = S.geometry(); geometry.rotateZ(-bow * .9); geometry.translate(0, stalk, 0);   // the fan sits at the end of the stalk; its mesh stays at the foot
    const fan = new T.Mesh(geometry, fanMaterial);
    if (stalk > 0) group.add(limb(kit, [V(), V(bow * stalk * .45, stalk * .5, bow * stalk * .2), V(0, stalk, 0)], taper(.011 * (.6 + size), .008 * (.6 + size)), stalkMaterial, { sides: 5 }));
    group.add(fan); group.userData = { fan, size, fade: own ? value => { fanMaterial.opacity = stalkMaterial.opacity = value; } : null };
    return group;
  }

  return { leaf };
}
