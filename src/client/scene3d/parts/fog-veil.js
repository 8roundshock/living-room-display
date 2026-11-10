// Fog bands (Fog, #620): long soft veils at several depths that slide sideways, each one a
// plane wider than the view whose wispy texture scrolls, so a band has no end and no straight
// edge anywhere. Soft alpha, not light: overlapping bands never build a bright patch. Each band
// thins across the quiet middle of the screen.
import { softNoise } from './fog-noise.js';

/** The plan gives speeds in real seconds; the scene clock runs at an eighth of real time (README). */
const REAL = 8;

const VERTEX = `
uniform float uRepeat, uScroll;
varying vec2 vUv; varying vec2 vScreen;
void main() {
  vUv = vec2(uv.x * uRepeat + uScroll, uv.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vScreen = gl_Position.xy / gl_Position.w;
}`;
const FRAGMENT = `
uniform sampler2D uMap; uniform vec3 uColour; uniform float uOpacity, uMiddle, uFlip;
varying vec2 vUv; varying vec2 vScreen;
void main() {
  float density = texture2D(uMap, vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uFlip))).r;
  // Thin inside the quiet middle (an ellipse of 60% by 55% of the screen), full toward the edges.
  float quiet = mix(uMiddle, 1.0, smoothstep(0.8, 1.5, length(vScreen / vec2(0.6, 0.55))));
  float a = density * uOpacity * quiet;
  gl_FragColor = vec4(uColour * a, a);
}`;

/**
 * Fog bands as one group. Each band: y (centre, as seen on the screen plane), z, height (as seen),
 * colour, opacity, speed (units per real second; negative slides left), stretch (world units one
 * turn of the texture covers), breathe (real seconds), start (0-1 along the texture), flip.
 * `middle` is the share of a band's strength left inside the quiet middle of the screen.
 */
export function fogBands(kit, bands, { middle = .3, salt = 0 } = {}) {
  const { T, view, tick } = kit, group = new T.Group();
  // One wispy strip that tiles sideways: a band whose middle wanders and whose thickness changes, broken into wisps, soft at top and bottom.
  const strip = kit.canvasTexture(512, 128, (g, w, h) => {
    const image = g.createImageData(w, h), broad = softNoise(kit, 5, salt), fine = softNoise(kit, 12, salt + 1), line = softNoise(kit, 4, salt + 2);
    const step = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    for (let x = 0; x < w; x++) {
      const u = x / w, centre = .5 + (line(u * 4, .5) - .5) * .36, thick = .15 + broad(u * 5, 3.5) * .17;
      for (let y = 0; y < h; y++) {
        const v = y / h, off = (v - centre) / thick, wisps = step(.22, .74, .6 * broad(u * 5, v * 2.2) + .4 * fine(u * 12, v * 5));
        const density = Math.exp(-off * off * 1.5) * (.22 + .78 * wisps) * step(0, .14, v) * step(1, .86, v), o = (y * w + x) * 4;
        image.data[o] = image.data[o + 1] = image.data[o + 2] = Math.round(density * 255); image.data[o + 3] = 255;
      }
    }
    g.putImageData(image, 0, 0);
  }, { srgb: false, repeat: true });
  const live = bands.map((band, i) => {
    const k = 1 - band.z / view.depth, width = view.halfWAt(band.z) * 2 + 1.4, stretch = band.stretch ?? 18;
    const uniforms = { uMap: { value: strip }, uColour: { value: new T.Color(band.colour) }, uOpacity: { value: band.opacity }, uMiddle: { value: middle }, uFlip: { value: band.flip ? 1 : 0 }, uRepeat: { value: width / stretch }, uScroll: { value: 0 } };
    const mesh = new T.Mesh(new T.PlaneGeometry(width, band.height * k), new T.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, transparent: true, premultipliedAlpha: true, depthWrite: false }));
    mesh.position.set(0, band.y * k, band.z); group.add(mesh);
    return { uniforms, opacity: band.opacity, rate: band.speed * REAL / stretch, start: band.start ?? i * .37, turn: (band.breathe ?? 60) / REAL, phase: i * 2.1 };
  });
  tick(t => {
    for (const band of live) {
      band.uniforms.uScroll.value = (((band.start - t * band.rate) % 1) + 1) % 1;
      // Each band's strength breathes by a fifth over about a minute.
      band.uniforms.uOpacity.value = band.opacity * (1 + .2 * Math.sin(t / band.turn * 2 * Math.PI + band.phase));
    }
  });
  return group;
}
