// The storm cloud (Storms, #619): a dark, slow mass of soft volumes in one top corner, at three
// depths, thinning along the top edge; and the soft glow that now and then lights it from inside.
// Coordinator decision on #619: the glow is slow and soft, stays inside the cloud, is never
// brighter than widget text, and there is no bolt. That is built in, not tuned: the glow is
// drawn only through the cloud's own density, and with "lighter of the two" blending, so
// overlapping volumes never add up beyond the stated peak.
import { softNoise } from './fog-noise.js';

/** The plan gives times in real seconds; the scene clock runs at an eighth of real time (README). */
const REAL = 8;
/** The shader clock wraps here; every volume makes a whole number of runs and swells per LOOP. */
const LOOP = 2400;
/** The first glow starts this many scene seconds into the clock (a few real seconds after the scene appears); the still frame (t = 14) falls between events. */
const FIRST = 12.45;
/** One glow in every slot of this many real seconds, starting up to 40 seconds into it: 48 to 128 seconds apart. */
const SLOT = 88;

const VERTEX = `
attribute vec4 aPlace;   // start along the run 0-1, how far it hangs below the top edge, depth, width as seen
attribute vec4 aLook;    // height over width, atlas cell (negative: mirrored), opacity, far-to-near tone
attribute vec4 aMove;    // runs per LOOP, swells per LOOP, swell phase, unused
uniform float uTime, uZ, uDepth, uTop; uniform vec2 uRun;
varying vec2 vUv; varying vec2 vAt; varying float vFade, vAlpha, vTone;
void main() {
  float k = 1.0 - aPlace.z / uDepth, s = fract(aPlace.x + uTime * aMove.x / ${LOOP}.0);
  float thin = 1.0 - s * sqrt(s);                                     // the mass thins away from its corner
  float swell = 1.0 + 0.04 * sin(6.2832 * (uTime * aMove.y / ${LOOP}.0 + aMove.z));
  vec2 size = vec2(aPlace.w, aPlace.w * aLook.x) * mix(0.5, 1.0, thin) * swell;
  // A volume that leaves the mass at one end fades out there and fades back in at the other.
  vFade = smoothstep(0.0, 0.12, s) * (1.0 - smoothstep(0.72, 1.0, s));
  vAt = vec2(mix(uRun.x, uRun.y, s), uTop - aPlace.y * thin) + position.xy * size;
  float cell = abs(aLook.y) - 1.0, across = aLook.y < 0.0 ? 1.0 - uv.x : uv.x;
  vUv = (vec2(mod(cell, 2.0), floor(cell / 2.0)) + vec2(across, uv.y)) * 0.5;
  vAlpha = aLook.z * vFade; vTone = aLook.w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vAt * k, aPlace.z - uZ, 1.0);
}`;
const BODY = `
uniform sampler2D uMap; uniform vec3 uNear, uFar, uEdge, uRim;
varying vec2 vUv; varying vec2 vAt; varying float vFade, vAlpha, vTone;
void main() {
  vec4 puff = texture2D(uMap, vUv);   // r: lower edges, g: density, b: edges turned to the light
  float a = puff.g * vAlpha;
  vec3 colour = mix(mix(uFar, uNear, vTone), uEdge, puff.b * 0.7);
  gl_FragColor = vec4(colour * a + uRim * puff.r * vAlpha * 0.3, a);
}`;
const GLOW = `
uniform sampler2D uMap; uniform vec3 uGlow; uniform vec3 uLights[2]; uniform float uReach;   // where on the screen plane, strength
varying vec2 vUv; varying vec2 vAt; varying float vFade, vAlpha, vTone;
void main() {
  vec4 puff = texture2D(uMap, vUv);
  float light = 0.0;
  for (int i = 0; i < 2; i++) { vec2 away = (vAt - uLights[i].xy) / uReach; light = max(light, uLights[i].z * exp(-dot(away, away) * 2.4)); }
  // Light comes through the cloud and nowhere else: none where there is no cloud, most where it is dense.
  gl_FragColor = vec4(uGlow * light * min(1.0, pow(puff.g, 1.15) * (0.85 + 0.5 * puff.b)) * vFade, 1.0);
}`;

/**
 * The cloud mass in the top corner on `side` (-1 left, 1 right), as one group.
 * count: main volumes; ragged: smaller ones hung under them, as a share of the count. length: how far it runs along the top edge.
 * hang: how far it hangs down at the corner. peak: brightness of the inner glow at its strongest, as a display
 * value 0-1 (0: no glow). echo: one glow in two is answered 2.5 s later, at 40%, from the other place.
 */
export function stormCloud(kit, { count, ragged: share = .6, side = -1, length = 7.5, hang = 2.6, peak = .68, echo = true, salt = 0 }) {
  const { T, rnd, view, tick, ctx } = kit, group = new T.Group(), W = view.halfW, S = ctx.size;
  // Four different volumes on one canvas: each is a few merged soft lumps broken by slow noise, fading to nothing before its square's edge.
  const atlas = kit.canvasTexture(512, 512, (g, w, h) => {
    const image = g.createImageData(w, h), data = image.data, broad = softNoise(kit, 16, salt + 1), fine = softNoise(kit, 32, salt + 2), N = 256, density = new Float32Array(N * N);
    const step = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); }, at = (x, y) => density[Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))];
    for (let cell = 0; cell < 4; cell++) {
      const lumps = Array.from({ length: 6 }, (_, i) => [.5 + (rnd(i, salt + cell * 9 + 3) - .5) * .44, .5 + (rnd(i, salt + cell * 9 + 4) - .5) * .24, .17 + rnd(i, salt + cell * 9 + 5) * .12]);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const u = (x + .5) / N, v = (y + .5) / N; let open = 1;
        for (const [cx, cy, radius] of lumps) { const d = Math.hypot(u - cx, (v - cy) * 1.25) / radius; if (d < 1) open *= 1 - .9 * (1 - d * d) * (1 - d * d); }
        // The square is drawn about three fifths as high as wide, so the noise is sampled that much coarser downward and the billows stay round.
        const broken = (1 - open) * (.55 + .85 * (.65 * broad(u * 4 + cell * 4, v * 2.5) + .35 * fine(u * 9, v * 5.5 + cell * 8)));
        density[y * N + x] = Math.min(1, broken) * step(0, .16, Math.min(u, 1 - u, v, 1 - v));
      }
      const ox = (cell % 2) * N, oy = (cell >> 1) * N;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const here = at(x, y), o = ((oy + y) * w + ox + x) * 4;
        data[o] = Math.round(255 * Math.min(1, Math.max(0, (at(x, y - 10) - here) * 2.4)));          // a lower edge: denser just above
        data[o + 1] = Math.round(255 * here);
        data[o + 2] = Math.round(255 * Math.min(1, Math.max(0, (at(x + 12, y + 16) - here) * 1.6)));  // an upper left edge: denser down to the right
        data[o + 3] = 255;
      }
    }
    g.putImageData(image, 0, 0);
  }, { srgb: false });

  // Main volumes in three depth rows; smaller ragged ones hang under them on the two nearer rows.
  // A volume fills about the middle three fifths of its square, so the square is drawn that much wider than the volume is meant to look.
  const ROWS = [-9, -5, -2], SPREAD = 1.7, main = Math.round(count), ragged = Math.round(main * share), volumes = [];
  for (let i = 0; i < main + ragged; i++) {
    const small = i >= main, r = k => rnd(i, salt + 20 + k), row = small ? 1 + i % 2 : i % 3, z = ROWS[row] + (r(1) - .5) * 1.2;
    volumes.push({ z, place: [(small ? i - main : i) / (small ? ragged : main) + r(2) * .12, small ? hang * (.72 + r(3) * .26) : hang * (.1 + ((i * .618) % 1) * .78), z, (small ? .9 + r(4) * .7 : 2.6 + r(4) * 2.4) * SPREAD * S],
      look: [small ? .7 + r(5) * .2 : .5 + r(5) * .22, (1 + Math.floor(r(6) * 4)) * (r(7) < .5 ? -1 : 1), small ? .5 + r(8) * .2 : .45 + r(8) * .25, row / 2],
      // 0.01 to 0.03 units a real second, the far row slowest; a swell of 4% over 30 to 50 real seconds.
      move: [Math.max(1, Math.round((.01 + row * .007 + r(9) * .006) * REAL / (length + 3.2) * LOOP)), Math.round(LOOP * REAL / (30 + r(10) * 20)), r(11), 0] });
  }
  volumes.sort((a, b) => a.z - b.z);   // far to near: the nearer volumes are drawn over the farther ones
  const geometry = new T.InstancedBufferGeometry().copy(new T.PlaneGeometry(1, 1));
  for (const [name, key] of [['aPlace', 'place'], ['aLook', 'look'], ['aMove', 'move']]) geometry.setAttribute(name, new T.InstancedBufferAttribute(new Float32Array(volumes.flatMap(volume => volume[key])), 4));
  geometry.instanceCount = volumes.length;
  const Z = -5.5, lights = [new T.Vector3(side * (W - 1.9), view.halfH - .95, 0), new T.Vector3(side * (W - 4.7), view.halfH - .7, 0)];
  const shared = { uTime: { value: 0 }, uMap: { value: atlas }, uZ: { value: Z }, uDepth: { value: view.depth }, uTop: { value: view.halfH + .25 }, uRun: { value: new T.Vector2(side * (W + 2.4), side * (W - length - .8)) } };
  const body = new T.Mesh(geometry, new T.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: BODY, transparent: true, premultipliedAlpha: true, depthWrite: false,
    uniforms: { ...shared, uNear: { value: new T.Color(0x2b3350) }, uFar: { value: new T.Color(0x454d6e) }, uEdge: { value: new T.Color(0x5d688c) }, uRim: { value: new T.Color(0x8ea2f2) } } }));
  body.position.z = Z; body.frustumCulled = false; group.add(body);
  // The glow is drawn after everything else, keeping the lighter of what is there and itself. It still tests depth, so
  // an object of the scene underneath that stands in front of the cloud hides it.
  const glowing = peak > 0 && !ctx.quiet, inner = new T.Mesh(geometry, new T.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: GLOW, transparent: true, depthWrite: false,
    blending: T.CustomBlending, blendEquation: T.MaxEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor,
    uniforms: { ...shared, uGlow: { value: new T.Color(0xc3ccff) }, uLights: { value: lights }, uReach: { value: 1.75 * S } } }));
  inner.position.z = Z; inner.renderOrder = 1; inner.frustumCulled = false; inner.visible = false; group.add(inner);
  // 1.6 s up, 0.4 s held, 5 s down: the fastest change of brightness in the scene is the 1.6-second rise.
  const pulse = since => since <= 0 || since >= 7 ? 0 : since < 1.6 ? (k => k * k * (3 - 2 * k))(since / 1.6) : since < 2 ? 1 : Math.pow(1 - (since - 2) / 5, 2);
  tick(t => {
    shared.uTime.value = t % LOOP; if (!glowing) return;
    const real = (t - FIRST) * REAL, slot = Math.floor(real / SLOT); let first = 0, second = 0;
    if (slot >= 0) {
      const since = real - slot * SLOT - (slot ? rnd(slot, salt + 40) * 40 : 0), swap = rnd(slot, salt + 41) < .5, strong = pulse(since), answer = echo && rnd(slot, salt + 42) < .5 ? pulse(since - 2.5) * .4 : 0;
      first = swap ? answer : strong; second = swap ? strong : answer;
    }
    lights[0].z = first * peak; lights[1].z = second * peak; inner.visible = first + second > .002;
  });
  return group;
}
