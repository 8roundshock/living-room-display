// New Year (design plan #610). Long-exposure fireworks: a champagne-gold chrysanthemum in the
// top-left corner, a silver-white willow in the top-right corner and a small gold-and-rose palm
// far back on the left, each held almost still on a cycle of about two minutes and taking
// turns, with a faint streak rising to each from the bottom edge, a few embers sinking from
// them, and paper streamers of different finishes caught over the top edge. No flash, no
// numerals, no clock, no drinkware (coordinator decision on #610), no tree, snow or balloons.
// The palm, the two long streamers and the fuller embers are the plan's day-of extras: the
// tier rule makes this six-day scene special on every day today (#632 will narrow that).
// The middle stays empty. Art rules: ../README.md.
import { bloom } from '../parts/new-year-bloom.js';
import { streamer } from '../parts/new-year-streamer.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, A = ctx.amount, seed = ctx.seed, bold = ctx.tier === 'special';
  // The plan gives on-screen sizes at the everyday size (0.85); U carries the tier's size from there.
  const U = ctx.size / .85, GOLD = 0xf6cf4e, SILVER = 0xdfe6f5, BLUE = 0x5fb8f2, ROSE = 0xf070c8, IVORY = 0xf4efe2;

  // ---------- the blooms: three kinds, sizes and colours; none on a quiet date ----------
  const far = -6, back = 1 - far / view.depth;
  const BLOOMS = [
    { kind: 'chrysanthemum', centre: V(-W + 2.25, 2.15, -1), radius: 1.9 * U, trails: 50 + A * 200, from: GOLD, to: 0xfff8e8, offset: 8 },
    { kind: 'willow', centre: V(W - 1.9, 3.05, -1.5), radius: 1.5 * U, trails: 30 + A * 100, from: SILVER, to: 0x9fd0f7, offset: 11 },
    ...(bold ? [{ kind: 'palm', centre: V((-W + 1.15) * back, -1.75 * back, far), radius: 1 * U * back, trails: 9, from: GOLD, to: ROSE, offset: 5, wander: .3 }] : []),
  ];
  if (!ctx.quiet) BLOOMS.forEach((options, i) => stage.add(bloom(kit, { ...options, floor: -view.halfHAt(options.centre.z), salt: seed + i * 7 })));

  // ---------- embers sinking from the two near blooms, gone before the lower third ----------
  if (!ctx.quiet) {
    const count = bold ? Math.round(A * 200) : Math.round(A * 100), position = new Float32Array(count * 3), colour = new Float32Array(count * 3), geometry = new T.BufferGeometry(), LIFE = 6;
    geometry.setAttribute('position', new T.BufferAttribute(position, 3)); geometry.setAttribute('color', new T.BufferAttribute(colour, 3));
    const sparks = new T.Points(geometry, new T.PointsMaterial({ map: kit.tex.glow(), size: .13, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending })); sparks.frustumCulled = false; stage.add(sparks);
    tick(t => {
      for (let i = 0; i < count; i++) {
        // Each spark lives LIFE scene seconds, then starts again somewhere else under its bloom.
        const from = BLOOMS[i % 2], clock = t * (.8 + rnd(i, seed + 21) * .4) + rnd(i, seed + 22) * LIFE, turn = Math.floor(clock / LIFE), age = clock - turn * LIFE;
        const x = from.centre.x + (rnd(i + turn * 131, seed + 23) - .5) * from.radius * 1.7, y = from.centre.y + (rnd(i + turn * 131, seed + 24) - .7) * from.radius - age * .36 - age * age * .012;
        const glow = Math.pow(Math.sin(Math.PI * age / LIFE), .7) * Math.min(1, Math.max(0, (y + 1.3) / 1.2)) * (.35 + rnd(i, seed + 25) * .65);
        position[i * 3] = x + Math.sin(t * .5 + i) * .07; position[i * 3 + 1] = y; position[i * 3 + 2] = from.centre.z + (rnd(i, seed + 26) - .5) * 2;
        colour[i * 3] = glow * 2.4; colour[i * 3 + 1] = glow * 1.7; colour[i * 3 + 2] = glow * .7;
      }
      geometry.attributes.position.needsUpdate = geometry.attributes.color.needsUpdate = true;
    });
  }

  // ---------- streamers caught over the top edge: no two the same width, curl, length or finish ----------
  const STREAMERS = [
    { x: -W + 4.15, length: 1.75, width: .14, curl: .13, turns: 3.2, colour: GOLD, finish: 'foil' },
    { x: W - 4.4, length: 1.45, width: .1, curl: .1, turns: 2.6, colour: SILVER, finish: 'satin' },
    { x: W - 3.35, length: 1.9, width: .16, curl: .15, turns: 2.9, colour: IVORY, finish: 'paper', stripe: GOLD },
    ...(bold ? [{ x: -W + .45, length: 3, width: .09, curl: .17, turns: 4.2, colour: IVORY, finish: 'paper', lean: .15 }, { x: W - .5, length: 2.6, width: .12, curl: .12, turns: 4.6, colour: BLUE, finish: 'pearl', lean: -.12 }] : []),
  ];
  STREAMERS.forEach(({ x, ...options }, i) => { const paper = streamer(kit, { ...options, length: options.length * U, width: options.width * U, curl: options.curl * U, phase: i * 1.9 + rnd(i, seed + 41) }); paper.position.set(x, view.halfH, (rnd(i, seed + 42) - .5) * .6); stage.add(paper); });
}
