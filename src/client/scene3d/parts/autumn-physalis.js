// Chinese lantern (physalis) for Autumn (#653): a papery husk hanging on its short stalk, and a
// drying leaf. A husk is an inflated teardrop with a round shoulder, five ribs and a pointed
// tip, netted with veins in colour and relief; every husk is its own geometry (size, lean,
// crumple, the way its ribs face) and its own ripeness, from green-gold through orange to deep
// orange-red. It is a thin shell: its ribs and net are solid, its panels see-through, and its
// far wall shows through its near one. One kind is worn to a lace of veins, with its berry
// showing inside.
// A part: call physalis(kit) once and build with what it returns. See ../README.md.
import { blade, ramp, sheets } from './spring-blade.js';
import { limb, taper } from './spring-limb.js';

export function physalis(kit) {
  const { T, V, rnd } = kit, TURN = Math.PI * 2;
  // The net of a husk, in its own coordinates (around it, then from the tip up to the stalk): five ribs, five
  // lesser ones between them, rungs across each of the ten panels and short links from rung to rung.
  const net = (g, w, h, colour, width) => {
    g.strokeStyle = colour; g.lineCap = 'round';
    const line = (x0, y0, x1, y1, thick) => { g.lineWidth = thick * width; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + (y1 - y0) * .2, (y0 + y1) / 2 + h * .012, x1, y1); g.stroke(); };
    for (let k = 0; k <= 10; k++) line(k / 10 * w, h, k / 10 * w, 0, k % 2 ? 1.5 : 2.6);
    for (let panel = 0; panel < 10; panel++) {
      const left = panel / 10 * w, right = (panel + 1) / 10 * w; let before = null;
      for (let j = 0; j < 9; j++) {
        const y = h * (j + .2 + rnd(panel * 9 + j, 11) * .7) / 9, tilt = (rnd(panel * 9 + j, 12) - .5) * h * .07, middle = [(left + right) / 2 + (rnd(panel * 9 + j, 13) - .5) * w * .03, y + tilt / 2];
        line(left, y, right, y + tilt, 1);
        if (before && rnd(panel * 9 + j, 14) < .7) line(before[0], before[1], middle[0], middle[1], .8);
        before = middle;
      }
    }
  };
  const softened = (w, h, draw, blur) => g => { const sharp = document.createElement('canvas'); sharp.width = w; sharp.height = h; draw(sharp.getContext('2d')); try { g.filter = `blur(${blur}px)`; } catch { /* no canvas filter: sharp veins */ } g.drawImage(sharp, 0, 0); try { g.filter = 'none'; } catch { /* no canvas filter */ } };
  const map = kit.canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) { g.fillStyle = `rgba(${rnd(i, 15) < .5 ? '170,60,10' : '255,236,200'},${.03 + rnd(i, 16) * .05})`; g.beginPath(); g.ellipse(rnd(i, 17) * w, rnd(i, 18) * h, 4 + rnd(i, 19) * 10, 8 + rnd(i, 20) * 22, 0, 0, 7); g.fill(); }
    net(g, w, h, 'rgba(150,52,10,.42)', 1);
  }, { anisotropy: 8 });
  const relief = kit.canvasTexture(512, 256, (g, w, h) => { g.fillStyle = '#6c6c6c'; g.fillRect(0, 0, w, h); softened(w, h, s => net(s, w, h, '#ffffff', 1.8), 1.4)(g); }, { srgb: false });
  // How solid the paper is, place by place: thin panels (PANEL is their share), solid ribs and net. And what is
  // left of a worn husk: the net alone, and a little cap where the stalk holds it.
  const PANEL = .42;
  const sheer = kit.canvasTexture(512, 256, (g, w, h) => { const body = Math.round(PANEL * 255); g.fillStyle = `rgb(${body},${body},${body})`; g.fillRect(0, 0, w, h); softened(w, h, s => net(s, w, h, '#ffffff', 2), 1)(g); }, { srgb: false, anisotropy: 8 });
  const lace = kit.canvasTexture(512, 256, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); softened(w, h, s => { net(s, w, h, '#ffffff', 3); s.fillStyle = '#fff'; s.fillRect(0, 0, w, h * .05); }, .8)(g); }, { srgb: false, anisotropy: 8 });
  // Paper is matt: a sheen would grey its orange. A husk is a thin shell, so its far wall is drawn first, from
  // inside (`lining`), and its near wall over it (`paper`): the ribs behind show through the panels in front.
  // The worn husk is an open lace: both sides in one pass, holes cut out.
  const shell = side => kit.mat({ color: 0xd4d4d4, vertexColors: true, map, alphaMap: sheer, bumpMap: relief, bumpScale: .014, emissive: 0xe05a00, emissiveMap: map, emissiveIntensity: .08, roughness: 1, metalness: 0, side, see: .3 }, 0, false);
  const paper = shell(T.FrontSide), lining = shell(T.BackSide);
  const worn = kit.mat({ color: 0xffffff, vertexColors: true, alphaMap: lace, alphaTest: .4, bumpMap: relief, bumpScale: .01, roughness: .8, metalness: 0, side: T.DoubleSide, see: .25 }, .1, false);
  const leafLook = kit.mat({ color: 0xd0d0d0, vertexColors: true, map, bumpMap: relief, bumpScale: .012, roughness: 1, metalness: 0, side: T.DoubleSide, see: .5 }, 0, false);
  const fruit = kit.mat({ color: 0xea560c, roughness: .22, metalness: 0, clearcoat: .9, clearcoatRoughness: .15, see: .45 }, .9);
  const stem = kit.mat({ color: 0x9a7c2c, roughness: .8, metalness: 0, see: .8 }, .2, false);

  // From the stalk down to the tip, for a green-gold, an orange and a deep orange-red husk; `ripe` (0-1) blends between them.
  const TONES = [ramp(kit, [[0, '#b4c400'], [.5, '#ecc800'], [1, '#ffba00']]), ramp(kit, [[0, '#d68c0a'], [.45, '#ee7a06'], [1, '#e25c04']]), ramp(kit, [[0, '#de6608'], [.4, '#e64604'], [1, '#cc3408']])];
  const STRAW = ramp(kit, [[0, '#b08c50'], [1, '#8e6e40']]), mixed = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const outline = s => Math.pow(Math.sin(Math.PI * Math.pow(s, .58)), .8);   // a round shoulder under the stalk, widest a third of the way down, a pointed tip

  /** A lantern hanging from its origin (the node on the stem): a short bowed stalk and the husk
   * under it. `length` is the husk's, `stalk` the stalk's, `ripe` 0 (green-gold) to 1 (deep
   * orange-red). `lace` makes it the worn one: the net of veins alone, with the berry inside.
   * `userData.heart` is the middle of the husk, for a light inside it. */
  function lantern({ length = .45, stalk = .18, ripe = .5, lace: isWorn = false, seed = 0 } = {}) {
    const S = sheets(kit), radius = length * (.37 + rnd(seed, 1) * .05), lean = (rnd(seed, 2) - .5) * .16, crumple = .02 + rnd(seed, 3) * .03, p1 = rnd(seed, 4) * 6, facing = rnd(seed, 5) * TURN;
    const k = Math.min(1.999, Math.max(0, ripe * 2)), low = TONES[Math.floor(k)], high = TONES[Math.floor(k) + 1], share = k - Math.floor(k);
    const down = v => Math.pow(1 - v, 1.6);   // rows gather under the stalk, where the shoulder turns fastest
    S.add(40, 18, (u, v, out) => {
      const s = down(v), a = u * TURN, rib = Math.pow(.5 + .5 * Math.cos(5 * a), 3), lesser = Math.pow(.5 - .5 * Math.cos(5 * a), 4), body = Math.sqrt(Math.sin(Math.PI * Math.min(1, s)));
      const r = radius * outline(s) * (1 + body * (.085 * rib + .03 * lesser - .035 + crumple * Math.sin(3 * a + p1 + s * 5)));
      out.set(Math.sin(a + facing) * r + lean * length * s * s, -length * s, Math.cos(a + facing) * r);
    }, (u, v) => { const s = down(v); if (isWorn) return STRAW(s); const colour = mixed(low(s), high(s), share), deep = 1 - .14 * Math.pow(.5 + .5 * Math.cos(5 * u * TURN), 3); return [colour[0] * deep, colour[1] * deep, colour[2] * deep]; }, { wrap: true });
    const group = new T.Group(), bow = (rnd(seed, 6) - .5) * .5, foot = V(bow * stalk * .5, -stalk, 0), geometry = S.geometry(), husk = new T.Mesh(geometry, isWorn ? worn : paper);
    husk.position.copy(foot); husk.rotation.z = bow * .5; husk.renderOrder = 2;
    group.add(limb(kit, [V(), V(bow * stalk * .55, -stalk * .45, bow * stalk * .2), foot], taper(.012 * (.5 + length), .008 * (.5 + length)), stem, { sides: 5 }), husk);
    if (isWorn) { const berry = new T.Mesh(kit.ballGeo, fruit); berry.scale.setScalar(radius * .46); berry.position.set(0, -length * .42, 0); husk.add(berry); }
    else { const far = new T.Mesh(geometry, lining); far.renderOrder = 1; husk.add(far); }
    group.userData = { husk, length, heart: foot.clone().add(V(0, -length * .4, 0)) };
    return group;
  }

  /** A drying leaf about `size` long: its origin is where its stalk joins it, tip toward +y, face
   * toward +z. An oval with a drawn-out tip and a wavy edge, curled as it dries, ochre with a
   * brown edge. */
  function leaf({ size = .45, seed = 0 } = {}) {
    const S = sheets(kit), p1 = rnd(seed, 7) * 6, p2 = rnd(seed, 8) * 6, curl = .5 + rnd(seed, 9) * .5, twist = (rnd(seed, 10) - .5) * .5, tone = ramp(kit, [[0, '#b09408'], [.45, '#cc8c06'], [.8, '#b06608'], [1, '#8a4a12']]);
    blade(kit, S, { cols: 40, rows: 8, reach: a => size * (Math.pow(Math.cos(a / 2), 14) + .14 * Math.exp(-((a / .16) ** 2))) * (1 + .045 * Math.sin(a * 7 + p1)),
      lift: (x, y, r, a) => curl * (.9 * x * x / size - .45 * y * y / size) + twist * x * y / size + .03 * size * r * r * Math.sin(a * 6 + p2),
      tint: (u, v) => tone(Math.min(1, v * (.85 + .15 * Math.sin(u * 23 + p2)))) });
    return new T.Mesh(S.geometry(), leafLook);
  }

  return { lantern, leaf, stem };
}
