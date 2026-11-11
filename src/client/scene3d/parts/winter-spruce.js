// A bough of white spruce as it hangs on the side of a tree in winter (#665): a spine that
// sags under its load and levels out at its tip, side twigs to either side in a flat spray
// that faces the room, twiglets on those, and short stiff needles all round every twig. Seen
// from the room it is a broad paw: the far half of the spray rises behind the spine, the near
// half hangs in front of it. It is not the kit's fir (long soft needles in a hanging swag,
// which is Christmas) and not the Russian New Year spruce top (a young tree with a trunk and
// upturned whorls): this is one heavy bough of a grown tree whose trunk is beyond the frame.
// The part decides where snow lies along each twig, because needles under snow are left out;
// ./winter-snow.js lays the snow on the same plan. A part: plain functions of the kit.
import { tubes } from './new-year-tree-tubes.js';

/** Needle greens, from the deep green of old needles through blue-green to the paler shoot tip, and the wood. */
const DEEP = 0x143c22, BLUE = 0x26663e, PALE = 0x52916a, BARK = 0x6e5038, SHOOT = 0xa9804e;

/**
 * One bough. `from` is where it leaves the trunk (beyond the frame edge); it runs `reach`
 * toward +x, sinks by `drop` and levels out over its last third; `swing` brings its tip toward
 * the room. `spread` is the length of its longest side twigs, `tilt` how far the spray is
 * turned to face the room (radians below level on its near side: a level spray would be seen
 * edge-on), `twigs` how many side twigs, `needle` the needle length, `girth` the radius of the
 * wood where it enters, and `load` (0-1) how much of it lies under snow.
 * Returns { wood, needles, segments, at, hangs, tip }: two meshes in world coordinates;
 * `segments` are the twigs as { points, curve, kind, length, cover, heap, girth } with `cover`
 * the stretch [from, to] of each (0-1) that carries snow, or null, and `heap` (0-1) how deep it
 * can lie there (less on a twig that hangs steeply); `at(t)` is a point on the spine;
 * `hangs` are the ends of the near twigs, from the trunk outward, for things that hang.
 */
export function spruceBough(kit, { from, reach = 3.6, drop = 1.4, swing = .15, spread = .7, tilt = 1.15, twigs = 16, needle = .09, girth = .045, load = 1, seed = 0 } = {}) {
  const { T, V, C, rnd } = kit, lift = drop * .36, segments = [], hangs = [];
  const at = t => V(from.x + reach * t * (1 - .05 * t), from.y - drop * Math.pow(t, 1.7) + lift * Math.pow(t, 5), from.z + swing * t);
  const ahead = t => at(Math.min(1, t + .01)).sub(at(Math.max(0, t - .01))).normalize();
  const lean = V(0, -Math.sin(tilt), Math.cos(tilt)), across = t => { const along = ahead(t); return lean.clone().addScaledVector(along, -lean.dot(along)).normalize(); };
  const bent = (a, b, sag) => [a, a.clone().lerp(b, .5).add(V(0, sag, 0)), b];

  // ---------- the plan: the spine, side twigs to either side in turn, twiglets on the longer ones ----------
  { const points = []; for (let i = 0; i <= 14; i++) points.push(at(i / 14)); segments.push({ points, kind: 'spine', length: reach, cover: [.05, .985], heap: 1, girth: [girth, girth * .22] }); }
  for (let j = 0; j < twigs; j++) {
    const t = .08 + .87 * (j + .5 + (rnd(j, seed + 1) - .5) * .5) / twigs, near = j % 2 === 0, sign = near ? 1 : -1;
    // A paw's outline: the longest twigs a third of the way out, shortening to the tip and toward the trunk.
    const length = spread * (.16 + Math.pow(Math.sin(Math.PI * Math.pow(t, .62)), .8) * (1 - .3 * t)) * (.7 + rnd(j, seed + 2) * .55);
    const a = at(t), along = ahead(t), side = across(t), way = along.clone().multiplyScalar(.64 + rnd(j, seed + 8) * .22).addScaledVector(side, sign * .67).normalize();
    // A twig sags under its own snow; the far ones, which rise, sag back toward level.
    const b = a.clone().addScaledVector(way, length).add(V(0, -length * length * (.16 + load * .1), (near ? .1 : -.06) * length)), bare = rnd(j, seed + 3) > .6 + load * .34;
    // Snow stays where a twig is near level and slides off where it hangs: the near twigs keep it only close to the spine.
    const steep = Math.max(0, -way.y), heap = 1 - steep * .4;
    segments.push({ points: bent(a, b, length * .04), kind: 'twig', length, cover: bare ? null : [0, .34 + load * .3 - steep * .34 + rnd(j, seed + 4) * .16], heap, girth: [girth * .3, girth * .1] });
    if (near && t > .3) hangs.push({ point: b.clone(), t, length });
    // Twiglets leave the twig to either side in turn, within the spray, each shorter than the last.
    const shoots = length > .62 ? 4 : length > .42 ? 3 : length > .26 ? 2 : 0, flat = side.clone().multiplyScalar(sign).addScaledVector(way, -sign * side.dot(way)).normalize();
    for (let k = 0; k < shoots; k++) {
      const share = (k + .8) / (shoots + .9), base = a.clone().lerp(b, share).add(V(0, length * .16 * share * (1 - share), 0)), outer = k % 2 === 0, n = j * 5 + k;
      const turn = way.clone().multiplyScalar(.76).addScaledVector(flat, outer ? .62 : -.6).normalize(), small = length * (.46 - .07 * k) * (.8 + rnd(n, seed + 5) * .4);
      segments.push({ points: bent(base, base.clone().addScaledVector(turn, small).add(V(0, -small * small * .28, 0)), small * .03), kind: 'twiglet', length: small, cover: !bare && share < .5 - steep * .25 && rnd(n, seed + 6) < .1 + load * .32 ? [0, .5 + rnd(n, seed + 7) * .3] : null, heap: heap * .9, girth: [girth * .16, girth * .07] });
    }
  }

  // A twig is short and gently bent: a few steps measure its length well enough, and building is quicker for it.
  for (const segment of segments) { segment.curve = new T.CatmullRomCurve3(segment.points); segment.curve.arcLengthDivisions = segment.kind === 'spine' ? 60 : 16; }

  // ---------- wood: one mesh ----------
  const wood = tubes(kit, 6), bark = C(BARK), shoot = C(SHOOT);
  for (const { points, kind, girth: [thick, thin] } of segments) wood.add(points, thick, thin, kind === 'spine' ? bark : bark.clone().lerp(shoot, .45), kind === 'spine' ? bark.clone().lerp(shoot, .5) : shoot);

  // ---------- needles: one instanced mesh ----------
  // Short and stiff, all round the twig and leaning toward its tip; a tuft at the tip itself. Where snow lies,
  // most of the needles that point up into it are left out and the few that remain are shorter: they poke through.
  let room = 4096, count = 0, matrices = new Float32Array(room * 16), colours = new Float32Array(room * 3);
  const deep = C(DEEP), blue = C(BLUE), pale = C(PALE), tone = new T.Color();
  const up = V(0, 1, 0), p = V(), d = V(), u = V(), v = V(), way = V(), size = V(), spin = new T.Quaternion(), matrix = new T.Matrix4();
  segments.forEach(({ curve, kind, length, cover }, s) => {
    const steps = Math.max(4, Math.round(length / (needle * .25))), per = kind === 'spine' ? 4 : 5, salt = seed + 100 + s * 13, first = kind === 'spine' ? .08 : .05;
    for (let i = 0; i <= steps; i++) {
      const share = first + (1 - first) * i / steps, tuft = share > .95 && kind !== 'spine', under = cover && share >= cover[0] && share <= cover[1];
      curve.getPointAt(share, p); curve.getTangentAt(share, d).normalize();
      u.crossVectors(d, Math.abs(d.y) > .9 ? V(1, 0, 0) : up).normalize(); v.crossVectors(d, u);
      for (let k = 0; k < per; k++) {
        const n = i * 5 + k, angle = i * 2.4 + k * 6.283 / per + salt, open = tuft ? .2 + rnd(n, salt) * .4 : .8 + rnd(n, salt) * .42;
        way.copy(d).multiplyScalar(Math.cos(open)).addScaledVector(u, Math.sin(open) * Math.cos(angle)).addScaledVector(v, Math.sin(open) * Math.sin(angle)).normalize();
        const buried = under && way.y > .15; if (buried && rnd(n, salt + 1) < .85) continue;
        const long = needle * (kind === 'twiglet' ? .88 : 1) * (.78 + rnd(n, salt + 2) * .44) * (1 - .2 * share) * (buried ? .7 : 1), wide = needle * .11;
        if (count === room) { room *= 2; const m = new Float32Array(room * 16), c = new Float32Array(room * 3); m.set(matrices); c.set(colours); matrices = m; colours = c; }
        spin.setFromUnitVectors(up, way); matrix.compose(p, spin, size.set(wide, long, wide * .7)).toArray(matrices, count * 16);
        // Old needles near the spine are deep green; toward a twig's end they turn blue-green, and the tuft is paler.
        const shade = Math.min(1, .08 + share * .46 + rnd(n, salt + 3) * .4 + (kind === 'twiglet' ? .14 : 0));
        tone.copy(deep).lerp(blue, Math.min(1, shade * 1.5)); if (shade > .66) tone.lerp(pale, (shade - .66) / .34 * .75); colours[count * 3] = tone.r; colours[count * 3 + 1] = tone.g; colours[count * 3 + 2] = tone.b; count++;
      }
    }
  });
  // A needle: three flat sides tapering to a point, standing on its base. It is a pixel or two wide.
  const spike = new T.ConeGeometry(1, 1, 3, 1, true); spike.translate(0, .5, 0);
  // Dark green would all but vanish under the kit's see-through look, which thins dark surfaces most: the needles
  // take under half of it and hold a little green light of their own, so their bodies stay green on black.
  const needles = new T.InstancedMesh(spike, kit.mat({ color: 0xffffff, roughness: .5, metalness: 0, emissive: 0x0f4020, emissiveIntensity: .4, see: .45 }, .45, false), count);
  needles.instanceMatrix.array.set(matrices.subarray(0, count * 16)); needles.instanceColor = new T.BufferAttribute(colours.slice(0, count * 3), 3); needles.frustumCulled = false;
  return { wood: wood.mesh(kit.mat({ color: 0xffffff, vertexColors: true, roughness: .85, metalness: 0, see: .6 }, .3, false)), needles, segments, at, hangs, tip: at(1) };
}
