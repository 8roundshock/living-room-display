// Snow lying on a bough (#665): a thick soft pad along the upper side of the spine and a
// rounded finger of it along each side twig, the way fresh snow sits on spruce: it follows the
// droop, swells and thins a little, ends in a round nose short of the twig's tip, and leaves the
// needles underneath and at the tip showing. Real geometry in one mesh; white on top and
// blue-white underneath; glass, but with a body that reads. A part: plain functions of the kit.
import { sheets } from './spring-blade.js';

/** How wide and how high the snow lies on each kind of twig, at its start and at its end. */
const LIE = { spine: [.24, .1, .18, .09], twig: [.11, .06, .15, .07], twiglet: [.06, .045, .07, .045] };

/** The snow's material. `body` is how solid the snow is where it faces the room, as a share of
 * its rim, which stays whole: the kit's see-through look thins dark surfaces and leaves a bright
 * one solid, so white snow sets its own. (three.js r128 shader text; if a later three.js words
 * that line differently nothing is replaced and the snow is simply solid.) */
export function snowLook(kit, { body = .7 } = {}) {
  const { rnd } = kit;
  const grain = kit.canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const value = rnd(i, 81) < .5 ? 40 : 215; g.fillStyle = `rgba(${value},${value},${value},${.1 + rnd(i, 82) * .25})`; g.fillRect(rnd(i, 83) * w, rnd(i, 84) * h, 1 + rnd(i, 85) * 2, 1 + rnd(i, 86) * 2); }
  }, { srgb: false, repeat: true });
  const material = kit.mat({ color: 0xffffff, vertexColors: true, roughness: .9, metalness: 0, bumpMap: grain, bumpScale: .01, emissive: 0x6a8cc8, emissiveIntensity: .22, see: 0 }, .3, false);
  const solid = { value: body }, patch = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    patch(shader, renderer); shader.uniforms.uSnowBody = solid;
    shader.fragmentShader = 'uniform float uSnowBody;\n' + shader.fragmentShader.replace('#include <tonemapping_fragment>',
      'gl_FragColor.a *= mix(uSnowBody, 1.0, pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 1.1));\n#include <tonemapping_fragment>');
  };
  return material;
}

/**
 * Snow on the twigs of one bough. `segments` are the twigs as ./winter-spruce.js returns them:
 * { curve, kind, length, cover, heap }, with `cover` the stretch that carries snow and `heap`
 * how deep it can lie there. `thick` scales how deep it lies everywhere (not where). Returns { mesh, crests }: one mesh in world coordinates, and
 * `crests(n)` gives n points on top of the snow, spread along the bough, for glints.
 */
export function snowPads(kit, segments, { material, thick = 1, seed = 0 } = {}) {
  const { T, V, C } = kit, S = sheets(kit), tops = [], white = C(0x8aa4cc), shade = C(0x5f80c2), tone = new T.Color();
  const up = V(0, 1, 0), at = V(), along = V(), side = V(), lift = V();
  segments.forEach(({ curve, kind, length, cover, heap = 1 }, n) => {
    if (!cover) return;
    const [w0, w1, h0, h1] = LIE[kind], [from, to] = cover, lying = (to - from) * length;
    if (lying < .08) return;
    // The ends are rounded over about the snow's own width, and the pad swells and thins along the twig.
    const nose = Math.min(.5, (w0 + w1) * .6 * thick / lying), p1 = seed + n * 1.7, p2 = seed * .7 + n * 2.9, rows = Math.max(6, Math.round(lying / .05));
    const shape = v => {
      const share = from + (to - from) * v, q = Math.min(v, 1 - v) / nose, round = q >= 1 ? 1 : Math.sqrt(Math.max(0, 1 - (1 - q) * (1 - q)));
      const swell = (1 + .16 * Math.sin(v * lying * 8 + p1) + .09 * Math.sin(v * lying * 19 + p2)) * round * thick;
      return [share, (w0 + (w1 - w0) * share) * swell, (h0 + (h1 - h0) * share) * swell * heap];
    };
    let ring = -1, wide = 0, high = 0;
    S.add(12, rows, (u, v, out) => {
      // One ring of the pad at a time: where the twig is, which way is across it and which way is up from it.
      if (v !== ring) {
        ring = v; const [share, w, h] = shape(v); wide = w; high = h; curve.getPointAt(share, at); curve.getTangentAt(share, along).normalize();
        side.crossVectors(up, along); if (side.lengthSq() < .01) side.set(0, 0, 1); side.normalize(); lift.crossVectors(along, side);
      }
      const a = u * Math.PI * 2, x = Math.cos(a), y = Math.sin(a);
      // Round on top, nearly flat underneath, resting on the twig so the needles below it stay clear.
      out.copy(at).addScaledVector(side, x * wide).addScaledVector(lift, high * (.3 + (y < 0 ? y * .32 : Math.pow(y, .8))));
    }, u => { const top = .5 + .5 * Math.sin(u * Math.PI * 2), k = top * top * (3 - 2 * top); tone.copy(shade).lerp(white, k); return [tone.r, tone.g, tone.b]; },
    { wrap: true, map: (u, v) => [u * 2, v * lying * 5] });
    // The top of the pad, a third and two thirds of the way along it.
    if (kind !== 'twiglet') for (const v of [.34, .68]) { const [share, , high] = shape(v); curve.getPointAt(share, at); tops.push({ point: at.clone().add(V(0, high * 1.25, 0)), kind }); }
  });
  const mesh = new T.Mesh(S.geometry(), material); mesh.frustumCulled = false;
  const crests = count => Array.from({ length: Math.min(count, tops.length) }, (_, i) => tops[Math.floor((i + .5) / count * tops.length)].point);
  return { mesh, crests };
}
