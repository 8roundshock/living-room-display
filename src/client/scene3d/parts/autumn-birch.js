// Paper birch for Autumn (#664): the companion of the maple. White bark with dark lenticels
// for a slender stem, a thin curl of bark peeling from it, and one small leaf on its thin
// stalk: egg-shaped with a drawn-out tip and a saw-toothed rim, straight side veins, clear
// yellow to gold. Every leaf is its own geometry.
// A part: call birch(kit) once and build with what it returns. See ../README.md.
import { ramp, sheets } from './spring-blade.js';
import { leafLook, leafOn, leafTextures } from './autumn-leaf.js';

/** The right half of a birch blade from the tip round to the stalk: [angle from the tip in
 * degrees, distance from the stalk] for a blade of length 1, before its teeth. */
const HALF = [[0, 1], [5, .9], [10, .84], [16, .8], [23, .74], [31, .66], [40, .57], [50, .48], [61, .4], [73, .33], [86, .27], [101, .21], [119, .15], [141, .1], [180, .05]];
/** Points along half a rim (every second one is a tooth), and so around the whole leaf. */
const POINTS = 20, AROUND = POINTS * 2;

export function birch(kit) {
  const { T, rnd } = kit;
  // A midrib and straight side veins, each running out to a tooth: across is the outline point, up is the way out.
  const veins = (g, w, h, colour, width) => {
    const X = point => point / AROUND * w, Y = out => (1 - out) * h;
    const line = (p0, o0, p1, o1, thick) => { g.lineWidth = thick * width; g.beginPath(); g.moveTo(X(p0), Y(o0)); g.lineTo(X(p1), Y(o1)); g.stroke(); };
    g.strokeStyle = colour; g.lineCap = 'round'; line(POINTS, 0, POINTS, .99, 1.6); line(POINTS, 0, POINTS, .5, 3.4);
    for (const side of [-1, 1]) for (let k = 0; k < 7; k++) line(POINTS, .06 + k * .1, POINTS + side * (14 - k * 2), .97, 1.1);   // the lowest vein to the lowest tooth
  };
  const textures = leafTextures(kit, veins, { mottle: '170,120,20', specks: 26, salt: 90 }), leaves = leafLook(kit, textures);
  // From the stalk out to the rim, for a clear yellow and a gold leaf; `tone` (0-1) blends between them. A dry one
  // has a brown rim. Paints, deeper and redder than they read on screen (see the maple part).
  const TONES = [ramp(kit, [[0, '#ffc400'], [.5, '#ffaa00'], [1, '#f89400']]), ramp(kit, [[0, '#ffaa00'], [.5, '#f28a00'], [1, '#e06c00']])], DRY = new T.Color('#795000').convertSRGBToLinear();
  const STALK = ramp(kit, [[0, '#b07000'], [1, '#8a5200']]), mixed = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const reachAt = degrees => { let i = 0; while (i < HALF.length - 2 && degrees > HALF[i + 1][0]) i++; const [a0, r0] = HALF[i], [a1, r1] = HALF[i + 1]; return r0 + (r1 - r0) * (degrees - a0) / (a1 - a0); };

  /** One leaf (see leafOn in autumn-leaf.js for where its origin is and how it is drawn).
   * `size` is the blade's length, `stalk` the stalk's, `tone` 0 (clear yellow) to 1 (gold),
   * `dry` gives it a brown rim. */
  function leaf({ size = .26, stalk = .1, tone = .5, dry = false, seed = 0 } = {}) {
    const r = n => rnd(seed, n), wide = .92 + r(1) * .2, lean = (r(2) - .5) * .14, sharp = .04 + r(3) * .035, cup = .1 + r(4) * .25, wave = .02 + r(5) * .03, p1 = r(6) * 6, curl = r(7) * .25;
    // Points crowd toward the tip, where most of the rim is; every second one stands out as a tooth.
    const outline = Array.from({ length: AROUND + 1 }, (_, i) => {
      const side = i < POINTS ? -1 : 1, j = Math.abs(i - POINTS), degrees = 180 * Math.pow(j / POINTS, 1.8), angle = degrees * Math.PI / 180, widened = 1 + (wide - 1) * Math.sin(angle);
      return [side * angle * (1 + side * lean * (1 - angle / Math.PI)), reachAt(degrees) * widened * (j > 0 && j < POINTS - 2 ? (j % 2 ? 1 - sharp : 1 + sharp) : 1)   /* even points are teeth */];
    });
    const group = leafOn(kit, leaves, {
      outline, size, stalk, rows: 4, girth: .004 + size * .008, bow: (r(8) - .5) * .6, turn: (r(9) - .5) * .5, pitch: (r(10) - .5) * .5,
      // Cupped a little about the midrib, the tip curled back, the rim slightly wavy.
      lift: (x, y, out, i) => size * (cup * (x / size) * (x / size) - curl * Math.pow(Math.max(0, y / size - .5), 2) + wave * out * out * Math.sin(i * 1.3 + p1)),
      tint: (i, out) => { const at = Math.min(1, out * (.8 + .2 * Math.abs(i - POINTS) / POINTS)), colour = mixed(TONES[0](at), TONES[1](at), tone), rim = dry ? Math.min(1, Math.max(0, (out - .72) / .2)) * .8 : 0; return rim ? mixed(colour, [DRY.r, DRY.g, DRY.b], rim) : colour; },
      stalkTint: STALK(tone),
    });
    return group;
  }

  // White bark, drawn along the stem (across the canvas) and around it (up): chalk white with warmer and greyer
  // patches, lenticels as short dark dashes across the stem, and a dark chevron or two where a twig once left.
  const paper = kit.canvasTexture(512, 64, (g, w, h) => {
    g.fillStyle = '#e4e2da'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${rnd(i, 41) < .5 ? '170,176,172' : '240,228,206'},${.1 + rnd(i, 42) * .14})`; g.beginPath(); g.ellipse(rnd(i, 43) * w, rnd(i, 44) * h, 14 + rnd(i, 45) * 40, 5 + rnd(i, 46) * 14, 0, 0, 7); g.fill(); }
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const x = rnd(i, 47) * w, y = rnd(i, 48) * h, length = 4 + Math.pow(rnd(i, 49), 2.2) * 26;
      g.strokeStyle = `rgba(70,62,56,${.4 + rnd(i, 50) * .5})`; g.lineWidth = 1 + rnd(i, 51) * 2.2;
      for (const wrap of [0, -h]) { g.beginPath(); g.moveTo(x, y + wrap); g.lineTo(x + (rnd(i, 52) - .5) * 3, y + wrap + length); g.stroke(); }
    }
    for (let i = 0; i < 3; i++) { const x = (.14 + i * .31 + rnd(i, 53) * .1) * w, y = (.3 + rnd(i, 54) * .4) * h; g.fillStyle = 'rgba(48,42,38,.85)'; g.beginPath(); g.moveTo(x - 9, y); g.quadraticCurveTo(x, y - 9, x + 9, y); g.quadraticCurveTo(x, y + 5, x - 9, y); g.fill(); }
  }, { repeat: true, anisotropy: 4 });
  /** The white bark of the stem, for a limb. White is the brightest thing a scene can show, so it is lit dimly and stays a line, not a bar of light. */
  const bark = kit.mat({ map: paper, bumpMap: paper, bumpScale: .012, color: 0xa4a49e, roughness: .9, metalness: 0, see: .5 }, .2, false);
  /** The fine dark twigs that carry the leaves. */
  const twig = kit.mat({ color: 0x705446, roughness: .8, metalness: 0, see: .55 }, .25, false);
  const curls = kit.mat({ color: 0xb8b0a4, vertexColors: true, roughness: .9, metalness: 0, see: .5 }, .1, false);

  /** A thin strip of bark peeling from the stem and rolling up: its origin is where it is
   * still attached, it peels toward +x and rolls toward +z. White outside, tan inside. */
  function curl({ length = .14, width = .05, seed = 0 } = {}) {
    const S = sheets(kit), outside = ramp(kit, [[0, '#d8d4c8'], [1, '#c8beac']]), inside = ramp(kit, [[0, '#c09a68'], [1, '#a87c4c']]), tight = 3.4 + rnd(seed, 61) * 1.6, skew = (rnd(seed, 62) - .5) * .5;
    S.add(10, 2, (u, v, out) => { const a = u * tight, radius = length / tight * (1 - u * .35); out.set(Math.sin(a) * radius + u * length * .25, (v - .5) * width * (1 - u * .3) + u * skew * width, (1 - Math.cos(a)) * radius); },
      (u, v, back) => (back ? inside : outside)(u), { back: true });
    return new T.Mesh(S.geometry(), curls);
  }

  return { leaf, curl, bark, twig };
}
