// Morning glory for Summer (#614): a heart-shaped leaf with palmate veins, an open flower (a
// funnel that widens into a nearly flat, five-lobed face, pale inside the throat and rayed like
// a star), a furled bud twisted on itself, a tendril that ends in a tightening spiral, and the
// stem material. A part: call morningGlory(kit) once and build with what it returns.
// See ../README.md.
import { blade, ramp, sheets } from './spring-blade.js';
import { limb, taper } from './spring-limb.js';

/** The leaf's own plane as [left, bottom, width, height] for a leaf of size 1: what its texture covers. */
const PLANE = Object.freeze([-.6, -.36, 1.2, 1.48]);
/** The heart: a cardioid from the notch where the stalk joins, a drawn-out tip, two full lobes behind the notch. */
const heart = a => .68 * Math.pow((1 + Math.cos(a)) / 2, .62) + .36 * Math.exp(-((a / .42) ** 2)) + .2 * Math.exp(-(((Math.abs(a) - 2.3) / .45) ** 2));

export function morningGlory(kit) {
  const { T, V, rnd } = kit, TURN = Math.PI * 2;
  const stem = kit.mat({ color: 0x4f8a5a, roughness: .6, metalness: 0, see: .55 }, .5, false);
  const plain = kit.mat({ color: 0xe8e8e8, vertexColors: true, roughness: .5, metalness: 0, clearcoat: .25, clearcoatRoughness: .4, see: .6 }, .4);

  // ---------- leaf ----------
  const leafLook = (() => {
    let made;
    const TW = 384, TH = Math.round(384 * PLANE[3] / PLANE[2]), X = x => (x - PLANE[0]) / PLANE[2] * TW, Y = y => (1 - (y - PLANE[1]) / PLANE[3]) * TH;
    // Palmate veins: the midrib and three pairs of main veins leave the notch; side veins and veinlets branch off them.
    const veins = (g, colour, k) => {
      const curve = (a, b, bow) => { const cx = (a[0] + b[0]) / 2 + bow[0], cy = (a[1] + b[1]) / 2 + bow[1]; return t => [(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * cx + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * cy + t * t * b[1]]; };
      const stroke = (point, from, to) => { for (let i = 0; i < 12; i++) { const [x0, y0] = point(i / 12), [x1, y1] = point((i + 1) / 12); g.lineWidth = (from + (to - from) * i / 12) * k; g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1)); g.stroke(); } };
      g.strokeStyle = colour; g.lineCap = 'round';
      const midrib = curve([0, 0], [0, 1.0], [0, 0]); stroke(midrib, 6, 1.2);
      for (const side of [1, -1]) {
        const mains = [curve([0, 0], [side * .33, .6], [side * .1, -.06]), curve([0, 0], [side * .46, .16], [side * .04, -.08]), curve([0, 0], [side * .3, -.24], [side * .1, .02])];
        mains.forEach((vein, n) => stroke(vein, 4.4 - n * .5, 1));
        for (let n = 0; n < 4; n++) { const from = midrib(.3 + n * .15); stroke(curve(from, [side * (.3 - n * .06), from[1] + .2 - n * .012], [side * .03, -.04]), 3, .8); }
        mains.forEach((vein, n) => { for (let m = 0; m < 4; m++) { const t = .3 + m * .17, from = vein(t), ahead = vein(t + .06), dx = ahead[0] - from[0], dy = ahead[1] - from[1], length = Math.hypot(dx, dy) || 1, turn = (m % 2 ? 1 : -1) * .9, far = .1 + .04 * ((m + n) % 3);
          stroke(curve(from, [from[0] + (dx * Math.cos(turn) - dy * Math.sin(turn)) / length * far, from[1] + (dx * Math.sin(turn) + dy * Math.cos(turn)) / length * far], [0, 0]), 1.8, .6); } });
      }
    };
    return () => made ?? (made = (() => {
      const colour = kit.canvasTexture(TW, TH, g => {
        const wash = g.createRadialGradient(X(0), Y(.1), 8, X(0), Y(.2), TW * .62); wash.addColorStop(0, '#2f8a50'); wash.addColorStop(.55, '#4aa85e'); wash.addColorStop(1, '#84d277'); g.fillStyle = wash; g.fillRect(0, 0, TW, TH);
        for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${rnd(i, 41) < .5 ? '150,210,120' : '10,60,40'},${.03 + rnd(i, 42) * .05})`; g.beginPath(); g.arc(rnd(i, 43) * TW, rnd(i, 44) * TH, 4 + rnd(i, 45) * 16, 0, 7); g.fill(); }
        veins(g, 'rgba(159,217,160,.75)', 1);
      }, { anisotropy: 8 });
      const relief = kit.canvasTexture(TW, TH, g => {
        g.fillStyle = '#707070'; g.fillRect(0, 0, TW, TH);
        const sharp = document.createElement('canvas'); sharp.width = TW; sharp.height = TH; veins(sharp.getContext('2d'), '#ffffff', 1.6);
        try { g.filter = 'blur(2px)'; } catch { /* no canvas filter: sharp veins */ }
        g.drawImage(sharp, 0, 0); try { g.filter = 'none'; } catch { /* no canvas filter */ }
      }, { srgb: false });
      return kit.mat({ color: 0xe4e4e4, vertexColors: true, map: colour, bumpMap: relief, bumpScale: .022, roughness: .5, metalness: 0, clearcoat: .45, clearcoatRoughness: .35, side: T.DoubleSide }, .7);
    })());
  })();
  /** Three ways a leaf holds itself: nearly flat, folded along its midrib, and tip-down with a rippled edge. */
  const HOLDS = [{ fold: .14, arch: .1, lobes: .25, ripple: .02 }, { fold: .34, arch: .16, lobes: .1, ripple: .03 }, { fold: .2, arch: .34, lobes: .4, ripple: .06 }];
  /** A heart leaf about `size` long. Its origin is the notch where the stalk joins; tip toward
   * +y, face toward +z. `hold` picks one of three curvatures; `yellow` (0-1) turns it toward yellow-green. */
  function leaf({ size = .6, hold = 0, seed = 0, yellow = 0 } = {}) {
    const S = sheets(kit), shape = HOLDS[((hold % 3) + 3) % 3], fold = shape.fold + rnd(seed, 46) * .08, arch = shape.arch + rnd(seed, 47) * .08, phase = rnd(seed, 48) * 6, skew = (rnd(seed, 49) - .5) * .16;
    const shade = .86 + rnd(seed, 50) * .2, tone = [shade * (1 + yellow * .5), shade * (1 + yellow * .12), shade * (1 - yellow * .35)];
    blade(kit, S, { reach: a => heart(a) * size, cols: 44, rows: 7, flat: PLANE.map(value => value * size), tint: () => tone,
      lift: (x, y, r, a) => fold * Math.abs(x) + skew * x - arch * y * y / size + shape.lobes * Math.max(0, -y) + shape.ripple * size * r * r * r * Math.sin(a * 5 + phase) });
    return new T.Mesh(S.geometry(), leafLook());
  }

  // ---------- open flower ----------
  const corolla = (() => {
    let made;
    // The key light bleaches anything pale, so the blues are deeper and purer here than they read on screen.
    return () => made ?? (made = (() => {
      const face = kit.canvasTexture(640, 256, (g, w, h) => {
        // v runs from the throat (bottom) to the rim (top): a warm white throat, then periwinkle deepening to the rim.
        const wash = g.createLinearGradient(0, h, 0, 0); wash.addColorStop(0, '#fffbe6'); wash.addColorStop(.2, '#f6f8ff'); wash.addColorStop(.36, '#b9c6fc'); wash.addColorStop(.56, '#6f8cf8'); wash.addColorStop(1, '#3f66f2'); g.fillStyle = wash; g.fillRect(0, 0, w, h);
        // Five rays, one along the middle of each lobe: thin where they leave the throat, widest two thirds of the
        // way out, closing at the rim. Drawn sharp and softened in one pass.
        const sharp = document.createElement('canvas'); sharp.width = w; sharp.height = h; const s = sharp.getContext('2d'); s.fillStyle = '#2c49d6';
        for (let k = 0; k <= 5; k++) { const x = k / 5 * w; s.beginPath(); s.moveTo(x, h * .6); s.quadraticCurveTo(x - w * .024, h * .22, x, h * .02); s.quadraticCurveTo(x + w * .024, h * .22, x, h * .6); s.fill(); }
        try { g.filter = 'blur(2.5px)'; } catch { /* no canvas filter: sharp rays */ }
        g.globalAlpha = .6; g.drawImage(sharp, 0, 0); g.globalAlpha = 1; try { g.filter = 'none'; } catch { /* no canvas filter */ }
      }, { anisotropy: 8 });
      // Blue thins to slate when a surface is see-through on black, so a flower takes half of that look, is matt
      // (a sheen would grey it) and holds a little light of its own, which also keeps its throat pale.
      return kit.mat({ color: 0xffffff, vertexColors: true, map: face, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: .25, roughness: .62, metalness: 0, clearcoat: .1, clearcoatRoughness: .5, see: .5 }, .25);
    })());
  })();
  const sepal = ramp(kit, [[0, '#3c8a50'], [1, '#6fbf73']]);
  const calyx = (S, radius, height) => S.turn(15, 4, v => [radius * (1 + .35 * Math.sin(v * 2.6)), height * v], (u, v) => sepal(v), { swell: (a, v) => 1 + .3 * v * v * Math.cos(5 * a) });
  /** An open flower with a face of `radius`. Its origin is the foot of its tube and it opens toward +y. */
  function flower({ radius = .44, seed = 0 } = {}) {
    const S = sheets(kit), deep = radius * .78, spin = rnd(seed, 91) * 1.2, outside = [.7, .74, .9], inside = [1, 1, 1];
    S.add(60, 18, (u, v, out) => {
      const lobe = Math.cos(5 * u * TURN), a = u * TURN + spin, r = radius * (.07 + .93 * Math.pow(v, 2.6)) * (1 + .035 * lobe * v * v * v);
      out.set(Math.sin(a) * r, deep * (1 - Math.pow(1 - v, 2.4)) - .06 * deep * Math.pow(v, 10) + .22 * radius * lobe * v * v * (1 - v) * (1 - v), Math.cos(a) * r);
    }, (u, v, back) => back ? inside : outside, { back: true, wrap: true });
    const group = new T.Group(), cup = sheets(kit); calyx(cup, radius * .085, radius * .2);
    group.add(new T.Mesh(cup.geometry(), plain), new T.Mesh(S.geometry(), corolla())); group.userData = { deep, radius };
    return group;
  }

  // ---------- furled bud ----------
  const furl = ramp(kit, [[0, '#c3cefc'], [1, '#4668ee']]);
  /** A furled bud of `length`, twisted one and a half turns; origin at its foot, pointing toward +y. */
  function bud({ length = .35, seed = 0 } = {}) {
    const S = sheets(kit), twist = 9.4 * (rnd(seed, 93) < .5 ? 1 : -1);
    S.add(30, 14, (u, v, out) => {
      const ridge = Math.cos(5 * u * TURN), a = u * TURN + twist * v, r = length * (.13 * Math.pow(Math.sin(Math.PI * Math.pow(v, .75)), .8) * (1 - .35 * v) + .02 * (1 - v)) * (1 + .17 * ridge * Math.sin(Math.PI * v));
      out.set(Math.sin(a) * r, length * (.1 + .9 * v), Math.cos(a) * r);
    }, (u, v) => furl(Math.min(1, (.5 - .5 * Math.cos(5 * u * TURN)) * .75 + v * .3)), { wrap: true });
    calyx(S, length * .055, length * .2);
    return new T.Mesh(S.geometry(), plain);
  }

  /** A tendril from `from` along `way` that ends in a spiral tightening toward `side` (+1 or -1). */
  function tendril({ from, way, reach = .5, coil = .09, turns = 2.5, side = 1, thick = .011 }) {
    const d = way.clone().normalize(), e = V(-d.y, d.x, .25).multiplyScalar(side); e.addScaledVector(d, -e.dot(d)).normalize();
    const w = V().crossVectors(d, e), points = [];
    for (let i = 0; i <= 8; i++) { const k = i / 8; points.push(from.clone().addScaledVector(d, k * reach).addScaledVector(e, -Math.sin(k * Math.PI) * reach * .14)); }
    const centre = points[8].clone().addScaledVector(e, coil);
    for (let i = 1; i <= 36; i++) { const c = i / 36, angle = c * turns * TURN, rho = coil * Math.pow(1 - c, .7) + .004 * c; points.push(centre.clone().addScaledVector(e, -rho * Math.cos(angle)).addScaledVector(d, rho * Math.sin(angle)).addScaledVector(w, c * coil * .9)); }
    return limb(kit, points, taper(thick, thick * .4), stem, { sides: 5, steps: 110 });
  }

  return { leaf, flower, bud, tendril, stem };
}
