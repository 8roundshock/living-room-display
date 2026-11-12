// Sugar maple for Autumn (#664): one leaf on its long stalk, in the colours of an Ontario or
// Quebec October. Five lobes with a few large teeth and rounded sinuses between them, five
// veins that leave the stalk together, a little darker than the blade (#683); yellow at the
// stalk, turning to orange and red-orange toward the rim. Every leaf is its own geometry: its own lobes, teeth,
// lean, curl and colour. Orange and yellow only: the pure red leaf belongs to Canada Day.
// A part: call maple(kit) once and build with what it returns. See ../README.md.
import { ramp } from './spring-blade.js';
import { leafLook, leafOn, leafTextures } from './autumn-leaf.js';

/** The right half of a sugar-maple blade, tip up, from the tip round to the stalk at the origin:
 * [x, y] for a blade of length 1. Seen from the stalk every point lies at a larger angle than
 * the one before, so the outline can be spread around the stalk as a fan of rays. */
const HALF = [[0, 1], [.06, .85], [.18, .82], [.16, .7], [.18, .6], [.21, .54], [.27, .52], [.34, .56], [.46, .72], [.47, .61], [.57, .63], [.76, .6], [.63, .44], [.72, .33], [.56, .25], [.46, .14], [.48, .06], [.54, .02], [.68, -.07], [.5, -.1], [.47, -.21], [.28, -.14], [.13, -.11], [.03, -.05], [0, -.03]];
/** Which lobe each point of the half belongs to (0 the middle one, 1 the side one, 2 the small basal one, 3 a sinus between two), and the points that are teeth. */
const LOBE = [0, 0, 0, 0, 0, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2], TEETH = [2, 8, 13, 20], TIPS = [0, 11, 18], MIDDLE = HALF.length - 1, AROUND = MIDDLE * 2;

export function maple(kit) {
  const { rnd } = kit;
  // Five veins run straight from the stalk to the lobe tips; a side vein forks off to each tooth; a net of
  // short veinlets lies between. Drawn in the blade's coordinates: across is the outline point, up is the way out.
  const veins = (g, w, h, colour, width) => {
    const X = point => point / AROUND * w, Y = out => (1 - out) * h;
    const line = (p0, o0, p1, o1, thick) => { g.lineWidth = thick * width; g.beginPath(); g.moveTo(X(p0), Y(o0)); g.lineTo(X(p1), Y(o1)); g.stroke(); };
    g.strokeStyle = colour; g.lineCap = 'round';
    for (const side of [-1, 1]) {
      for (const tip of TIPS) { if (side < 0 && !tip) continue; const at = MIDDLE + side * tip, strong = tip === 18 ? .7 : 1; line(at, 0, at, .99, 1.5 * strong); line(at, 0, at, .6, 3 * strong); line(at, 0, at, .28, 6.5 * strong); }
      for (const [from, start, tooth] of [[0, .5, 2], [0, .3, 4], [11, .46, 8], [11, .5, 13], [11, .26, 10], [11, .28, 12], [18, .42, 20], [18, .4, 17]]) line(MIDDLE + side * from, start, MIDDLE + side * tooth, .97, tooth % 2 ? 1 : 1.2);
    }
    for (let i = 0; i < 70; i++) { const at = rnd(i, 71) * AROUND, out = .25 + rnd(i, 72) * .7; line(at, out, at + (rnd(i, 73) - .5) * 2.4, out + (rnd(i, 74) - .5) * .16, .55); }
  };
  // A maple leaf's own light: a little more than the birch's, so that most of the tree shows its colours at full
  // strength and the leaves the key light also falls on are brighter still, as sunlit ones are.
  const GLOW = 1.1, textures = leafTextures(kit, veins, { salt: 80 }), leaves = leafLook(kit, textures, GLOW);

  // From the stalk and the veins out to the rim, for a golden yellow, a gold, a fire-orange and a red-orange
  // leaf; a leaf's `tone` (0-1) blends between them. A leaf skips the tone curve (see autumn-leaf.js), so these
  // are nearly the colours on screen (about 5 degrees redder there, from the veins and mottling of the texture).
  // They follow photos of sugar maples in an Ontario and Quebec October (#671): red-orange at a hue of about 17
  // degrees, orange at about 28, golden yellow at 40 to 45, all vivid (saturation 0.8 to 0.9). Nothing is redder
  // than red-orange (the pure red leaf is Canada Day's), and the yellow end stops at a golden yellow: a lemon
  // yellow dimmed on black reads olive.
  const TONES = [ramp(kit, [[0, '#ffe430'], [.5, '#ffd424'], [1, '#ffc41c']]), ramp(kit, [[0, '#ffd020'], [.5, '#ffb818'], [1, '#ff9e14']]), ramp(kit, [[0, '#ffa012'], [.5, '#ff780c'], [1, '#fa560a']]), ramp(kit, [[0, '#ff8a0e'], [.5, '#f85a0a'], [1, '#e83c08']])];
  const STALKS = ramp(kit, [[0, '#e08018'], [.5, '#c8541a'], [1, '#b03c14']]), mixed = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  // How near each outline point is to a vein that runs to a lobe tip: 1 on it, 0 three points away.
  const ON_VEIN = Array.from({ length: AROUND + 1 }, (_, i) => { const at = Math.abs(i - MIDDLE); return Math.max(0, 1 - Math.min(...TIPS.map(tip => Math.abs(at - tip))) / 3); });

  /** One leaf (see leafOn in autumn-leaf.js for where its origin is and how it is drawn).
   * `size` is the blade's length, `stalk` the stalk's, `tone` 0 (clear yellow) to 1 (red-orange);
   * `own` gives it a material of its own, `userData.fade(k)` and `userData.turn(green)`, for a
   * leaf that fades out by itself and can change colour while it is out of sight. */
  function leaf({ size = .4, stalk = .32, tone = .5, seed = 0, own = false, about = 0 } = {}) {
    const r = n => rnd(seed, n), long = [.9 + r(1) * .2, .86 + r(2) * .22, .82 + r(3) * .3, .86 + r(4) * .22, .82 + r(5) * .3], sinus = .84 + r(6) * .3, tooth = .93 + r(7) * .16, lean = (r(8) - .5) * .16;
    // The outline of this leaf: each lobe a little longer or shorter, the teeth sharper or blunter, the sinuses deeper or shallower, the whole leaning to one side.
    const outline = Array.from({ length: AROUND + 1 }, (_, i) => {
      const side = i < MIDDLE ? -1 : 1, j = Math.abs(i - MIDDLE), [x, y] = HALF[j], lobe = LOBE[j], angle = Math.atan2(x, y), turned = angle * (1 + side * lean * (1 - angle / Math.PI));
      const reach = Math.hypot(x, y) * (lobe === 3 ? sinus : long[lobe ? (side < 0 ? lobe : lobe + 2) : 0]) * (TEETH.includes(j) ? tooth : 1);
      return [side * turned, reach];
    });
    const k = Math.min(2.999, Math.max(0, tone * 3)), low = TONES[Math.floor(k)], high = TONES[Math.floor(k) + 1], share = k - Math.floor(k), blush = (r(9) - .5) * .5, pale = .75 + r(10) * .5;
    const fold = .1 + r(11) * .16, droop = .08 + r(12) * .2, wave = .03 + r(13) * .04, p1 = r(14) * 6, twist = (r(15) - .5) * .2;
    const material = own ? leafLook(kit, textures, GLOW) : leaves, group = leafOn(kit, material, {
      outline, size, stalk, about, girth: .006 + size * .012, bow: (r(16) - .5) * .5, turn: (r(17) - .5) * .7, pitch: -.15 - r(18) * .45,
      // A shallow fold along the middle vein, lobes that droop toward their tips, a wavy rim and a slight twist.
      lift: (x, y, out, i) => size * (fold * Math.abs(x / size) * out - droop * out * out * (.4 + .6 * Math.abs(x / size)) + wave * out * out * Math.sin(i * .9 + p1) + twist * x * y / (size * size)),
      // Yellow at the stalk, deeper toward the rim, only a shade yellower along the main veins (more read as bright bands, #683); one half often redder than the other.
      tint: (i, out) => { const at = Math.min(1, Math.max(0, Math.pow(out, pale) * (1 - .12 * ON_VEIN[i] * (1 - out * .6)) + blush * (i < MIDDLE ? -1 : 1) * out * .4)); return mixed(low(at), high(at), share); },
      stalkTint: STALKS(tone),
    });
    const lit = material.color.r;
    group.userData.fade = own ? value => kit.fade(material, value) : null;
    // For a leaf with a material of its own: `green` (0-1) is the share of its green it keeps. 1 leaves it as it was made; less turns it toward orange and red-orange.
    group.userData.turn = own ? green => { material.color.setRGB(lit, lit * green, lit); material.emissive.setRGB(1, green, 1); } : null;
    return group;
  }

  return { leaf };
}
