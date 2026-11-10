// Rain threads (#617; Storms, #619, use them steeper and heavier): slanted streaks of light at
// three depths. Each depth band is one instanced mesh whose threads fall and wrap in the vertex
// shader, so a frame costs three uniforms and no per-thread script. The threads are light:
// their colours are display values, drawn additively, outside the lit-material pipeline.

/** The plans give speeds in real seconds; the scene clock runs at an eighth of real time (README). */
const REAL = 8;
/** The shader clock wraps here. Every thread makes a whole number of falls per LOOP, so the
 * wrap is seamless and float precision does not wear off over a long run. */
const LOOP = 240;

// Far: small, sharp, dim. Middle: in focus. Near: large, soft, faint (out of focus).
// Width, length in world units; speed in units per real second; count at amount A.
// Opacity is the light at a thread's tip as a display value. It is higher than the plan's figures, which
// were chosen beside the picker's brighter stand-in layer: in the app the whole layer is drawn at about
// a third (settings.ts), and a thread at the plan's 0.3 to 0.5 could not be seen. At these values the
// brightest tip is still below widget text.
const BANDS = [
  { z: [-11, -5], width: [.012, .014], length: [.35, .6], opacity: [.32, .55], speed: [.7, 1], count: A => 36 + 110 * A, soft: 0 },
  { z: [-4, 1], width: [.02, .024], length: [.6, 1], opacity: [.58, .86], speed: [1.2, 1.6], count: A => 18 + 54 * A, soft: 0 },
  { z: [3, 7], width: [.07, .12], length: [1.2, 2], opacity: [.1, .16], speed: [2, 2.6], count: A => 2 + 6 * A, soft: 1 },
];

const VERTEX = `
attribute vec4 aPlace;   // x where it crosses mid-height, depth within the band, start 0-1, falls per LOOP
attribute vec4 aShape;   // width, length, opacity, its own lean
uniform float uTime, uLean, uZ, uDepth, uTop, uPixel;
uniform vec2 uSheet;     // screen x of a travelling sheet of heavier rain, and its strength
varying vec2 vUv; varying float vAlpha;
void main() {
  float k = 1.0 - (uZ + aPlace.y) / uDepth, lean = uLean + aShape.w;
  float span = uTop * 2.0 * k + aShape.y * 2.0, s = fract(aPlace.z + uTime * aPlace.w / ${LOOP}.0);
  vec2 down = vec2(sin(lean), -cos(lean)), centre = vec2(aPlace.x, 0.0) + down * (s - 0.5) * span / cos(lean);
  // The quad is three times the thread's width and holds its soft cross-section. A thread never draws
  // thinner than about a pixel, where it would shimmer: its light is thinned instead.
  float pixel = uPixel * k * 1.2, width = max(aShape.x, pixel) * 3.0;
  vec2 p = centre - down * position.y * aShape.y + vec2(-down.y, down.x) * position.x * width;
  vUv = uv;
  // Inside a sheet the dimmer threads gain half again; none passes 0.9, so no thread is ever brighter than widget text.
  vAlpha = min(0.9, aShape.z * min(1.0, aShape.x / pixel) * (1.0 + uSheet.y * (1.0 - smoothstep(0.5, 1.5, abs(centre.x / k - uSheet.x)))));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, aPlace.y, 1.0);
}`;
const FRAGMENT = `
uniform vec3 uColour; uniform float uSoft;
varying vec2 vUv; varying float vAlpha;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  // In focus: a soft-edged line with a brighter core. Out of focus: one wide soft smear.
  float line = mix(exp(-x * x * 9.0), exp(-x * x * 3.0) * (1.0 - x * x), uSoft);
  // Brightest at the lower tip, fading to nothing upward.
  float along = pow(1.0 - vUv.y, 1.15) * smoothstep(0.0, mix(0.02, 0.3, uSoft), vUv.y);
  gl_FragColor = vec4(uColour, vAlpha * line * along);
}`;

/**
 * Rain at up to three depths, as one group to add to the stage. Nothing on quiet dates.
 * amount: ctx.amount. share: multiplier of the counts. dim: multiplier of the opacity. near: keep the
 * out-of-focus near band. colours: [far, middle, near]. lean: degrees from vertical, falling toward +x;
 * spread: each thread's own lean, plus or minus; breathe: [degrees, real seconds] of the slow change of lean.
 * stretch, haste: multipliers of length and speed. sheets: a wide band of heavier rain crosses now and then.
 */
export function rainFall(kit, { amount, share = 1, dim = 1, near = true, colours = [0xa9cdea, 0xcfe3f5, 0x8fb8dc], lean = 7, spread = 1.5, breathe = [1, 40], stretch = 1, haste = 1, sheets = false, salt = 0 } = {}) {
  const { T, rnd, view, tick, ctx } = kit, group = new T.Group(), rad = Math.PI / 180;
  if (ctx.quiet) return group;
  const top = view.halfH + .12, W = view.halfW, between = ([a, b], k) => a + (b - a) * k;
  const uTime = { value: 0 }, uLean = { value: lean * rad }, uSheet = { value: new T.Vector2(0, 0) };
  BANDS.forEach((band, b) => {
    const n = Math.round(band.count(amount) * share);
    if (n < 1 || (band.soft && !near)) return;
    const z0 = (band.z[0] + band.z[1]) / 2, place = new Float32Array(n * 4), shape = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const r = k => rnd(i, salt + b * 20 + k), z = between(band.z, r(1)), k = 1 - z / view.depth, length = between(band.length, r(2)) * stretch, tilt = (r(3) - .5) * 2 * spread * rad;
      const path = (top * 2 * k + length * 2) / Math.cos(lean * rad + tilt), speed = between(band.speed, r(4)) * haste * REAL;
      // Weighted to the sides: the middle of the screen carries about a quarter of the edge density.
      place.set([(r(5) < .5 ? -1 : 1) * Math.pow(r(6), .55) * 1.08 * W * k, z - z0, r(7), Math.max(1, Math.round(speed / path * LOOP))], i * 4);
      shape.set([between(band.width, r(8)), length, between(band.opacity, r(9)) * dim, tilt], i * 4);
    }
    const geometry = new T.InstancedBufferGeometry().copy(new T.PlaneGeometry(1, 1));
    geometry.setAttribute('aPlace', new T.InstancedBufferAttribute(place, 4)); geometry.setAttribute('aShape', new T.InstancedBufferAttribute(shape, 4)); geometry.instanceCount = n;
    const mesh = new T.Mesh(geometry, new T.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { uTime, uLean, uSheet, uColour: { value: new T.Color(colours[b]) }, uSoft: { value: band.soft }, uZ: { value: z0 }, uDepth: { value: view.depth }, uTop: { value: top }, uPixel: { value: view.halfH * 2 / Math.min(1440, Math.max(360, ctx.height)) } } }));
    // The band sits at its own depth so it is sorted among the scene's objects and passes behind the near ones.
    mesh.position.z = z0; mesh.frustumCulled = false; group.add(mesh);
  });
  tick(t => {
    const real = t * REAL;
    uTime.value = t % LOOP; uLean.value = (lean + breathe[0] * Math.sin(real / breathe[1] * 2 * Math.PI)) * rad;
    if (sheets) {
      // One sheet every 30 to 50 real seconds, 3 units wide, 14 seconds from the left edge to the right.
      const cycle = Math.floor(real / 40), since = real - cycle * 40 - rnd(cycle, salt + 90) * 10;
      uSheet.value.set(-W - 2 + since / 14 * (W * 2 + 4), since > 0 && since < 14 ? .5 : 0);
    }
  });
  return group;
}
