// Snowfall in deep focus (Snow, #618): many small sharp flakes far away, fewer soft ones in
// focus, a handful of large out-of-focus discs close to the glass, and a few clear hexagonal
// plates that turn as they fall. Each depth band is one instanced mesh whose flakes fall, sway
// and wrap in the vertex shader. Flakes are light: display colours, drawn additively.

/** The plans give speeds in real seconds; the scene clock runs at an eighth of real time (README). */
const REAL = 8;
/** The shader clock wraps here; every flake makes a whole number of falls and sways per LOOP. */
const LOOP = 2400;

// Size is the flake's width in world units; speed in units per real second; count at amount A.
// Opacity is the light at a flake's centre as a display value: higher than the plan's figures, which were
// chosen beside the picker's brighter stand-in layer. The app draws the whole layer at about a third
// (settings.ts), so the brightest flake is still below widget text.
const BANDS = [
  { z: [-10, -4], size: [.05, .08], opacity: [.5, .75], speed: [.05, .08], count: A => 60 + 160 * A, look: 0, least: 2.4 },
  { z: [-3, 1], size: [.1, .18], opacity: [.68, .9], speed: [.09, .14], count: A => 20 + 50 * A, look: 1, least: 3 },
  { z: [3, 7], size: [.5, 1.2], opacity: [.07, .11], speed: [.18, .25], count: A => 2 + 5 * A, look: 2, least: 3 },
];

const VERTEX = `
attribute vec4 aPlace;   // x where it crosses mid-height, depth within the band, start 0-1, falls per LOOP
attribute vec4 aShape;   // width, opacity, sideways sway, sways per LOOP
attribute float aPhase;
uniform float uTime, uZ, uDepth, uTop, uPixel, uSlant, uLeast;
varying vec2 vUv; varying float vAlpha;
void main() {
  // Never smaller than a few pixels on screen: a smaller dot flickers. Its light is thinned instead.
  float k = 1.0 - (uZ + aPlace.y) / uDepth, size = max(aShape.x, uPixel * k * uLeast);
  float span = uTop * 2.0 * k + size * 2.0, s = fract(aPlace.z + uTime * aPlace.w / ${LOOP}.0);
  vec2 centre = vec2(aPlace.x + uSlant * (s - 0.5) * span + aShape.z * sin(6.2832 * (uTime * aShape.w / ${LOOP}.0 + aPhase)), (0.5 - s) * span);
  vUv = uv; vAlpha = aShape.y * aShape.x * aShape.x / (size * size);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(centre + position.xy * size, aPlace.y, 1.0);
}`;
const FRAGMENT = `
uniform vec3 uColour; uniform float uLook;   // 0 small sharp dot, 1 soft dot, 2 out-of-focus disc
varying vec2 vUv; varying float vAlpha;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float spot = 1.0 - smoothstep(mix(0.45, 0.0, min(uLook, 1.0)), 1.0, r);
  float disc = (0.5 + 0.5 * smoothstep(0.5, 0.9, r)) * (1.0 - smoothstep(0.86, 1.0, r));
  gl_FragColor = vec4(uColour, vAlpha * mix(spot, disc, max(uLook - 1.0, 0.0)));
}`;

/**
 * Snow at up to three depths, as one group to add to the stage. Nothing on quiet dates.
 * amount: ctx.amount. share: multiplier of the far and middle counts. dim: multiplier of the opacity.
 * near: how many out-of-focus discs (default: the plan's count for the amount). colours: [far, middle, near]. lanes: [from, to] share of the
 * half-width the near discs keep to, so none crosses the middle. slant: sideways drift per unit of fall.
 */
export function snowfall(kit, { amount, share = 1, dim = 1, near = null, colours = [0xe6f1ff, 0xf4f8ff, 0xcfe0f5], lanes = [.78, 1.04], slant = .1, salt = 0 } = {}) {
  const { T, rnd, view, tick, ctx } = kit, group = new T.Group(), S = ctx.size;
  if (ctx.quiet) return group;
  const top = view.halfH + .12, W = view.halfW, between = ([a, b], k) => a + (b - a) * k, uTime = { value: 0 };
  BANDS.forEach((band, b) => {
    const n = Math.round(band.look === 2 ? near ?? band.count(amount) : band.count(amount) * share);
    if (n < 1) return;
    const z0 = (band.z[0] + band.z[1]) / 2, place = new Float32Array(n * 4), shape = new Float32Array(n * 4), phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = k => rnd(i, salt + b * 20 + k), z = between(band.z, r(1)), k = 1 - z / view.depth, size = between(band.size, band.look === 2 ? (i + r(2)) / n : r(2)) * S;
      // Weighted to the sides; the large discs keep to their lanes, alternating sides.
      const across = band.look === 2 ? (i % 2 ? 1 : -1) * between(lanes, r(6)) : (r(5) < .5 ? -1 : 1) * Math.pow(r(6), .6) * 1.06;
      place.set([across * W * k, z - z0, r(7), Math.max(1, Math.round(between(band.speed, r(4)) * REAL / (top * 2 * k + size * 2) * LOOP))], i * 4);
      // Sideways sway of 0.15 to 0.4 units over 10 to 18 real seconds.
      shape.set([size, between(band.opacity, r(9)) * dim, .15 + r(10) * .25, Math.round(LOOP * REAL / (10 + r(11) * 8))], i * 4); phase[i] = r(12);
    }
    const geometry = new T.InstancedBufferGeometry().copy(new T.PlaneGeometry(1, 1));
    geometry.setAttribute('aPlace', new T.InstancedBufferAttribute(place, 4)); geometry.setAttribute('aShape', new T.InstancedBufferAttribute(shape, 4)); geometry.setAttribute('aPhase', new T.InstancedBufferAttribute(phase, 1)); geometry.instanceCount = n;
    const mesh = new T.Mesh(geometry, new T.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { uTime, uColour: { value: new T.Color(colours[b]) }, uLook: { value: band.look }, uLeast: { value: band.least }, uSlant: { value: slant }, uZ: { value: z0 }, uDepth: { value: view.depth }, uTop: { value: top }, uPixel: { value: view.halfH * 2 / Math.min(1440, Math.max(360, ctx.height)) } } }));
    // The band sits at its own depth so it is sorted among the scene's objects and passes behind the near ones.
    mesh.position.z = z0; mesh.frustumCulled = false; group.add(mesh);
  });
  tick(t => { uTime.value = t % LOOP; });
  return group;
}

/** A few of the flakes as real geometry: flat hexagonal plates of clear ice, each a different size, slowly
 * tumbling so that a face now and then turns through the light. Clear means almost no body colour: what
 * shows is the rim and what a face reflects. Nothing on quiet dates. */
export function snowPlates(kit, { count, colour = 0x2c3a48, salt = 0 } = {}) {
  const { T, rnd, view, tick, ctx } = kit, n = Math.round(count);
  if (ctx.quiet || n < 1) return new T.Group();
  const mesh = new T.InstancedMesh(new T.CylinderGeometry(1, 1, .16, 6), kit.mat({ color: colour, roughness: .2, metalness: 0, reflectivity: 1, clearcoat: 1, clearcoatRoughness: .14, flatShading: true }, 2.2), n), o = new T.Object3D();
  mesh.frustumCulled = false;
  // Everything about a plate that does not change from frame to frame is worked out once.
  const plates = Array.from({ length: n }, (_, i) => {
    const r = k => rnd(i, salt + 60 + k), z = -2.5 + r(1) * 3.2, k = 1 - z / view.depth, span = (view.halfH + .3) * 2 * k;
    return { z, span, x: (i % 2 ? 1 : -1) * (.5 + (i + r(3)) / n * .5) * view.halfW * k, phase: r(2) * 6.283, sway: .5 + r(4) * .3, start: r(5) * span, fall: (.09 + r(6) * .05) * REAL,
      spinX: 1.3 + r(7) * 1.2, spinY: .9 + r(8) * .9, size: (.06 + (i + r(9)) / n * .05) * ctx.size };
  });
  tick(t => {
    for (let i = 0; i < n; i++) {
      const plate = plates[i];
      o.position.set(plate.x + Math.sin(t * plate.sway + plate.phase) * .3, plate.span / 2 - (plate.start + t * plate.fall) % plate.span, plate.z);
      // One turn in 20 to 40 real seconds, about two axes at once.
      o.rotation.set(t * plate.spinX + plate.phase, t * plate.spinY + plate.phase, plate.phase); o.scale.setScalar(plate.size); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return mesh;
}
