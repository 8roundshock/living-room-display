// Magnolia for Spring (#613): a bloom of six to nine waxy tepals in three whorls at one of four
// openings, the velvet bud scales it broke out of, a closed velvet bud, a young leaf and a loose
// petal. A tepal is a cupped surface with its own outline; its outside is flushed pink from the
// base and its inside is nearly white, as on a saucer magnolia.
// A part: call magnolia(kit) once and build with what it returns. See ../README.md.
import { ramp, sheets } from './spring-blade.js';

/** Openings: tilt of the outer whorl (radians), cupping, outward belly, curl of the tip (inward
 * when negative), tepals already fallen and how far the rest have slumped. */
const STAGES = Object.freeze({
  break: { open: .21, cup: .66, belly: .13, curl: -.17, missing: 0, slump: 0, heart: false },
  goblet: { open: .49, cup: .56, belly: .2, curl: -.1, missing: 0, slump: 0, heart: true },
  open: { open: .87, cup: .42, belly: .15, curl: .06, missing: 0, slump: .08, heart: true },
  spent: { open: 1.2, cup: .26, belly: .06, curl: .2, missing: 2, slump: .16, heart: true },
});

export function magnolia(kit) {
  const { T, V, rnd } = kit, UP = V(0, 1, 0);
  // Nine lengthwise veins. A tepal's texture runs across its own width, so they close at base and tip by themselves.
  const veins = (g, w, h, colour, width) => {
    g.strokeStyle = colour; g.lineCap = 'round';
    for (let k = 0; k < 9; k++) {
      const x = (k + .5) / 9 * w, lean = (rnd(k, 51) - .5) * w * .03; g.lineWidth = width * (k === 4 ? 1.7 : 1);
      g.beginPath(); g.moveTo(x, h); g.bezierCurveTo(x + lean, h * .66, x - lean, h * .33, x, 0); g.stroke();
    }
  };
  const map = kit.canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 240; i++) { g.fillStyle = `rgba(${rnd(i, 52) < .5 ? '200,140,165' : '255,255,255'},${.03 + rnd(i, 53) * .04})`; g.beginPath(); g.ellipse(rnd(i, 54) * w, rnd(i, 55) * h, 3 + rnd(i, 56) * 9, 12 + rnd(i, 57) * 40, 0, 0, 7); g.fill(); }
    veins(g, w, h, 'rgba(176,104,138,.14)', 2.2);
  }, { anisotropy: 4 });
  const bump = kit.canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#787878'; g.fillRect(0, 0, w, h);
    const sharp = document.createElement('canvas'); sharp.width = w; sharp.height = h; veins(sharp.getContext('2d'), w, h, '#ffffff', 5);
    try { g.filter = 'blur(2.5px)'; } catch { /* no canvas filter: sharp veins */ }
    g.drawImage(sharp, 0, 0); try { g.filter = 'none'; } catch { /* no canvas filter */ }
  }, { srgb: false });
  const fuzz = kit.canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const value = Math.round(60 + rnd(i, 58) * 190); g.fillStyle = `rgb(${value},${value},${value})`; g.fillRect(rnd(i, 59) * w, rnd(i, 60) * h, 1.5, 3 + rnd(i, 61) * 5); }
  }, { srgb: false, repeat: true });
  // The key light is strong and the tone curve bleaches anything pale, so the wax is a mid tone and its colours are deeper than they read.
  const wax = kit.mat({ color: 0xdcdcdc, vertexColors: true, map, bumpMap: bump, bumpScale: .007, roughness: .45, metalness: 0, clearcoat: .3, clearcoatRoughness: .35, emissive: 0xc98aa6, emissiveIntensity: .05 }, .6);
  const velvet = kit.mat({ color: 0xd0d0d0, vertexColors: true, bumpMap: fuzz, bumpScale: .014, roughness: .9, metalness: 0, see: .7 }, .35, false);

  // ---------- one tepal: obovate, cupped across, bellied along, the tip curled in or back ----------
  const along = g => 1 - Math.pow(1 - g, 1.5);   // rows gather toward the tip, so it is round and not a polygon
  const outline = v => Math.max(Math.pow(Math.sin(Math.PI * Math.pow(v, 1.3)), .7), .17 * (1 - v));
  const tepal = ({ length, width, cup, belly, curl, wave = 0, phase = 0 }) => (u, g, out) => {
    const v = along(g), s = u * 2 - 1, x = s * outline(v) * width;
    out.set(x, v * length, -cup * x * x / width + belly * length * Math.sin(Math.PI * Math.pow(v, .8)) + curl * length * v * v * v + wave * width * s * Math.sin(v * 4 + phase));
  };
  const outside = ramp(kit, [[0, '#f7e4ec'], [.4, '#eaa0c0'], [1, '#b23c78']]), inside = ramp(kit, [[0, '#f8eef2'], [1, '#e39cba']]);
  /** Outside: the flush climbs from the base and is deepest along the middle. Inside: nearly white. */
  const flush = blush => (u, g, back) => { const v = along(g), s = u * 2 - 1; return back ? inside(Math.min(1, Math.pow(1 - v, 2.4) * blush)) : outside(Math.min(1, Math.pow(1 - v, 1.2) * (.6 + .4 * (1 - s * s)) * 1.15 * blush)); };
  const span = (u, g) => [u, along(g)];
  const felt = ramp(kit, [[0, '#8c9478'], [1, '#b7b99a']]);

  /** One bloom; its origin is its base, where the twig ends. `size` is the length of a tepal,
   * `stage` one of break, goblet, open and spent, `axis` the way it faces, `turn` a rotation
   * about that axis, `blush` the strength of the pink (about 0.85 to 1.1). The orientation is
   * built into the geometry so the tepals can be drawn from the back to the front. */
  function bloom({ size = .6, stage = 'goblet', tepals = 9, blush = 1, seed = 0, axis = UP, turn = 0 } = {}) {
    const look = STAGES[stage] ?? STAGES.goblet, group = new T.Group(), items = [];
    const base = new T.Matrix4().makeRotationFromQuaternion(new T.Quaternion().setFromUnitVectors(UP, axis.clone().normalize()).multiply(new T.Quaternion().setFromAxisAngle(UP, turn)));
    const placed = (azimuth, out, tilt) => base.clone().multiply(new T.Matrix4().makeRotationY(azimuth)).multiply(new T.Matrix4().makeTranslation(0, 0, out)).multiply(new T.Matrix4().makeRotationX(tilt));
    const count = Math.max(6, Math.min(9, Math.round(tepals))), gone = new Set();
    for (let k = 0; k < look.missing; k++) gone.add(k * 3 + Math.floor(rnd(k, seed + 71) * 3));
    for (let i = 0; i < count; i++) {
      if (gone.has(i)) continue;
      const whorl = Math.floor(i / 3), azimuth = (i % 3) * 2.094 + [0, 1.047, .524][whorl] + (rnd(i, seed + 72) - .5) * .3;
      const tilt = look.open * [1, .8, .58][whorl] * (.92 + rnd(i, seed + 73) * .16) + rnd(i, seed + 74) * look.slump;
      const length = size * [1, .96, .86][whorl] * (.95 + rnd(i, seed + 75) * .1), width = length * (.32 + rnd(i, seed + 76) * .05), matrix = placed(azimuth, size * .04, tilt);
      const shape = tepal({ length, width, cup: look.cup * (.9 + rnd(i, seed + 77) * .2), belly: look.belly, curl: look.curl * (.7 + rnd(i, seed + 78) * .6), wave: .05 + look.slump * .3, phase: rnd(i, seed + 79) * 6 });
      items.push([V(0, length * .55, 0).applyMatrix4(matrix).z, S => S.add(8, 14, shape, flush(blush * (.92 + rnd(i, seed + 80) * .16)), { matrix, back: true, map: span })]);
    }
    // The heart of an open flower: a ring of stamens under a small pale cone.
    if (look.heart) {
      const heart = ramp(kit, [[0, '#e2c56e'], [.45, '#e2c56e'], [.6, '#c9cf8e'], [1, '#dfe2b4']]);
      items.push([V(0, size * .12, 0).applyMatrix4(base).z, S => S.turn(18, 8, v => [size * (.058 - .04 * v) * Math.min(1, v * 12 + .5), size * (.03 + .2 * v)], (u, v) => heart(v), { matrix: base, swell: (a, v) => 1 + (v < .5 ? .2 * Math.cos(a * 9) : .06 * Math.cos(a * 5 + v * 9)) })]);
    }
    const petals = sheets(kit); items.sort((a, b) => a[0] - b[0]).forEach(([, add]) => add(petals));
    // The two velvet scales the flower broke out of stay at its base.
    const scales = sheets(kit);
    for (let k = 0; k < 2; k++) scales.add(5, 7, tepal({ length: size * (.3 + rnd(k, seed + 83) * .08), width: size * .13, cup: .75, belly: .14, curl: .12 }), (u, g) => felt(along(g) * .8), { matrix: placed(k * Math.PI + .7 + seed, size * .035, .45 + look.open * .35 + rnd(k, seed + 84) * .25), back: true });
    group.add(new T.Mesh(scales.geometry(), velvet), new T.Mesh(petals.geometry(), wax));
    group.userData = { size, stage };
    return group;
  }

  /** A closed velvet bud, a teardrop with a leaning tip; its origin is its base. */
  function bud({ length = .16, seed = 0, axis = UP } = {}) {
    const S = sheets(kit), lean = (rnd(seed, 81) - .5) * .7, pale = rnd(seed, 82) * .35;
    S.turn(12, 10, v => [length * (.3 * Math.pow(Math.sin(Math.PI * Math.pow(v, .6)), .85) * (1 - v * .2) + .03 * (1 - v)), v * length], (u, v) => felt(Math.min(1, v * .75 + pale)), { bend: v => lean * length * v * v });
    const mesh = new T.Mesh(S.geometry(), velvet); mesh.quaternion.setFromUnitVectors(UP, axis.clone().normalize()); return mesh;
  }

  // ---------- a young leaf: lance-shaped, folded along its midrib ----------
  const leafLook = (() => {
    let made;
    const ribs = (g, w, h, colour, width) => {
      g.strokeStyle = colour; g.lineCap = 'round'; g.lineWidth = width * 1.8; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke(); g.lineWidth = width;
      for (let k = 0; k < 6; k++) for (const side of [-1, 1]) { const y = h * (.9 - k * .14); g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + side * w * .3, y - h * .05, w / 2 + side * w * .5, y - h * .13); g.stroke(); }
    };
    return () => made ?? (made = (() => {
      const colour = kit.canvasTexture(128, 256, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); ribs(g, w, h, 'rgba(226,246,196,.5)', 1.6); });
      const relief = kit.canvasTexture(128, 256, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); ribs(g, w, h, 'rgba(255,255,255,.8)', 2.4); }, { srgb: false });
      return kit.mat({ color: 0xd0d0d0, vertexColors: true, map: colour, bumpMap: relief, bumpScale: .012, roughness: .5, metalness: 0, clearcoat: .45, clearcoatRoughness: .3, side: T.DoubleSide }, .6);
    })());
  })();
  const green = ramp(kit, [[0, '#52b85c'], [1, '#b4e668']]);
  /** A young leaf of `length`, base at its origin, tip toward +y, face toward +z. `fold` is how
   * far it is still folded along its midrib (0 flat, 1 nearly shut). */
  function leaf({ length = .4, fold = .5, seed = 0 } = {}) {
    const S = sheets(kit), width = length * (.2 + rnd(seed, 85) * .05), arch = .1 + rnd(seed, 86) * .2, twist = (rnd(seed, 87) - .5) * .8, tone = (rnd(seed, 88) - .5) * .3;
    S.add(8, 12, (u, g, out) => {
      const v = along(g), s = u * 2 - 1, half = Math.pow(Math.sin(Math.PI * Math.pow(v, .78)), 1.15) * width, x = s * half, turn = twist * v;
      const z = fold * 1.1 * Math.abs(x) - arch * length * v * v;
      out.set(x * Math.cos(turn) - z * Math.sin(turn) * .4, v * length, z + x * Math.sin(turn));
    }, (u, g) => green(Math.min(1, Math.max(0, along(g) * .9 + tone + Math.abs(u * 2 - 1) * .12))), { map: span });
    return new T.Mesh(S.geometry(), leafLook());
  }

  // ---------- a loose petal for the air: every one shares a geometry ----------
  let loose = null;
  /** A fallen-away tepal of length `size`, with its origin in its middle so it can turn as it falls. */
  function petal(size = .4) {
    loose ??= kit.own((() => { const S = sheets(kit); S.add(8, 12, tepal({ length: 1, width: .31, cup: .4, belly: .1, curl: .14, wave: .06 }), flush(.8), { back: true, map: span }); const geometry = S.geometry(); geometry.translate(0, -.5, -.06); return geometry; })());
    const mesh = new T.Mesh(loose, wax); mesh.scale.setScalar(size); return mesh;
  }

  return { bloom, bud, leaf, petal };
}
