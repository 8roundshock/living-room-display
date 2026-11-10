// A small still pool in one bottom corner (Rain, #617), seen at a low angle, with rings that
// spread and fade where drops land. One shader on one tilted disc: the water is a faint cool
// sheen that fades to nothing at its rim, so the pool has no outline, and every ring keeps the
// same fine width on screen however flat the angle. Light only, drawn additively.

/** The plan gives times in real seconds; the scene clock runs at an eighth of real time (README). */
const REAL = 8;
const RINGS = 6;

const VERTEX = `
varying vec2 vAt;
void main() { vAt = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAGMENT = `
uniform vec3 uRing, uSheen; uniform vec4 uDrops[${RINGS}];   // where on the pool, radius, strength
varying vec2 vAt;
void main() {
  float rim = 1.0 - smoothstep(0.4, 1.0, length(vAt)), light = 0.0;
  for (int i = 0; i < ${RINGS}; i++) {
    float away = length(vAt - uDrops[i].xy) - uDrops[i].z;
    light = max(light, uDrops[i].w * (1.0 - smoothstep(0.0, fwidth(away) * 1.7 + 0.003, abs(away))));
  }
  // The far side meets the eye at the flattest angle and carries a little more sheen.
  float sheen = 0.09 + 0.13 * smoothstep(-0.9, 0.9, vAt.y);
  gl_FragColor = vec4((uSheen * sheen + uRing * light) * rim, 1.0);
}`;

/** A pool of `radius` lying in the bottom corner on `side` (-1 left, 1 right). `every` is the real seconds between rings. Returns a mesh. */
export function cornerPool(kit, { side = 1, radius = 2.2, every = 2.2, seed = 0, ring = 0xbcd8f0, sheen = 0x2f7f86 }) {
  const { T, rnd, view, tick, ctx } = kit, drops = Array.from({ length: RINGS }, () => new T.Vector4(0, 0, 0, 0)), geometry = new T.CircleGeometry(1, 56);
  const pool = new T.Mesh(geometry, new T.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, blending: T.AdditiveBlending, extensions: { derivatives: true },
    uniforms: { uRing: { value: new T.Color(ring) }, uSheen: { value: new T.Color(sheen) }, uDrops: { value: drops } } }));
  // Tipped a little past flat, so that from the room it is a low ellipse about a seventh as high as it is wide.
  pool.scale.setScalar(radius); pool.rotation.x = -(Math.PI / 2 + .12); pool.position.set(side * (view.halfW - radius * .86), -view.halfH + .34, 0);
  const LIFE = 6, period = RINGS * Math.max(every, LIFE / RINGS + .05);
  tick(t => {
    const real = t * REAL;
    drops.forEach((drop, i) => {
      const turn = (real + i * period / RINGS) / period, born = Math.floor(turn), age = (turn - born) * period / LIFE;
      if (ctx.quiet || age >= 1) { drop.w = 0; return; }
      // A ring grows from 0.05 to 0.9 units over six seconds while its light eases up and away again.
      const a = rnd(i + born * 7, seed + 1) * 6.283, d = Math.sqrt(rnd(i + born * 7, seed + 2)) * .5;
      drop.set(Math.cos(a) * d, Math.sin(a) * d * .8, (.05 + .85 * (1 - (1 - age) * (1 - age))) / radius, .7 * Math.pow(Math.sin(Math.PI * Math.sqrt(age)), 1.5));
    });
  });
  return pool;
}
