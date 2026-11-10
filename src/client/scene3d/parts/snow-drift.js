// A low snow drift in a bottom corner (Snow, #618): a mound that starts high on the side edge
// and falls in one long S-curve to the bottom edge, its top rolling away from the eye. Matte
// snow under the see-through look: the flank thins to a blue shadow and the crest stays as a
// soft luminous line, with a few slow sparkles on it and a faint lilac light behind.
import { softNoise } from './fog-noise.js';

/** The plan gives times in real seconds; the scene clock runs at an eighth of real time (README). */
const REAL = 8;

/** A drift in the bottom corner on `side` (-1 left, 1 right), `width` along the bottom edge and `height` up the side edge. Returns a group. */
export function snowDrift(kit, { side = -1, width = 4.4, height = 1.15, sparkles = 3, salt = 0 }) {
  const { T, C, rnd, view, tick, ctx } = kit, group = new T.Group(), NX = 60, NZ = 18, BACK = -1.7, FRONT = 1.2, OVER = .7;
  const clamp = k => Math.min(1, Math.max(0, k)), ease = k => { const u = clamp(k); return u * u * (3 - 2 * u); };
  // Height along the bottom edge: full at the side edge, one long S down to nothing, with a slight second swell so it is not a ruled curve.
  const along = u => Math.pow(1 - ease(u), 1.15) + .05 * Math.sin(u * 8 + salt) * clamp(u) * (1 - clamp(u)) * 2;
  // Height from front to back: the crest sits a little behind the middle and the top rolls away from the eye.
  const across = v => Math.pow(Math.sin(Math.PI * Math.pow(clamp(v), .85)), .75);
  const point = (u, v) => { const z = FRONT + (BACK - FRONT) * v; return [u * width, view.halfH * z / view.depth - .16 + height * along(u) * across(v), z]; };

  // The flank is a dim blue shadow that the see-through look thins to almost nothing; only the top of the mound, where it rolls over, is white.
  const position = [], colour = [], uv = [], index = [], shadow = C(0x8fb0d8).multiplyScalar(.16), crest = C(0xeef4fb), tone = new T.Color();
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    const u = -OVER / width + i / NX * (1 + OVER / width), v = j / NZ, lit = Math.pow(across(v), 13) * (.3 + .7 * Math.min(1, along(u) * 1.6));
    position.push(...point(u, v)); uv.push(u * 2.2, v * 1.4); tone.copy(shadow).lerp(crest, lit); colour.push(tone.r, tone.g, tone.b);
    if (i < NX && j < NZ) { const a = j * (NX + 1) + i, b = a + NX + 1; index.push(a, a + 1, b, a + 1, b + 1, b); }
  }
  const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3)); geometry.setAttribute('color', new T.Float32BufferAttribute(colour, 3)); geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geometry.setIndex(index); geometry.computeVertexNormals();
  // Soft dimples, so the surface is not a blank sheet where the light grazes it.
  const dimples = kit.canvasTexture(128, 128, (g, w, h) => {
    const image = g.createImageData(w, h), broad = softNoise(kit, 6, salt + 3), fine = softNoise(kit, 16, salt + 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const value = Math.round((.62 * broad(x / w * 6, y / h * 6) + .38 * fine(x / w * 16, y / h * 16)) * 255), o = (y * w + x) * 4; image.data[o] = image.data[o + 1] = image.data[o + 2] = value; image.data[o + 3] = 255; }
    g.putImageData(image, 0, 0);
  }, { srgb: false, repeat: true });
  const mound = new T.Mesh(geometry, kit.mat({ color: 0xffffff, vertexColors: true, roughness: .95, metalness: 0, bumpMap: dimples, bumpScale: .012, side: T.DoubleSide }, .35, false));
  group.add(mound); group.position.set(side * view.halfW, -view.halfH, 0); group.scale.x = -side;

  if (!ctx.quiet) {
    // The registry's violet as a faint rim light behind the crest.
    const rim = kit.glow(0xc9a8f2, width * 1.1, .055, { twinkle: .1 }); rim.position.set(width * .3, height * .75, BACK - 1.5); group.add(rim);
    // Sparkles on the crest rise and fall over 10 to 16 real seconds; neighbours are half a turn apart, so never two together.
    for (let i = 0; i < sparkles; i++) {
      const u = .1 + (i + .2 + rnd(i, salt + 8) * .6) / sparkles * .62, [x, y, z] = point(u, .52), glint = kit.glow(0xf4f8ff, .3 * ctx.size, 0, { twinkle: 0 });
      glint.position.set(x, y + .02, z); group.add(glint);
      const turn = (26 + rnd(i, salt + 9) * 10) / REAL, phase = i * Math.PI + rnd(i, salt + 10) * .8;
      tick(t => { glint.userData.o = .55 * Math.pow(Math.max(0, Math.sin(t / turn * 2 * Math.PI + phase)), 3); });
    }
  }
  return group;
}
