// Birthday (#600 reference scene; design plan #612). Also serves birthday-russian and
// birthday-korean until they have their own designs (#627, #631), taking their colourway from
// ctx.palette. A candle-lit cake between two presents in the left corner, five balloons that
// all differ tied to a present in the right corner, and a short swag of bunting in each top
// corner. No confetti or streamers (New Year has them), no lettering, no age. The middle stays
// empty. Art rules: ../README.md.
/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick, mix, shift } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed;
  const [first, second, third] = ctx.palette, CREAM = 0xf6ead8, GOLD = 0xf2c94c;
  const css = colour => `#${new T.Color(colour).getHexString()}`, deep = (colour, k = .3) => mix(colour, 0x000000, k), pale = (colour, k = .55) => mix(colour, 0xffffff, k);
  // The colourway: the scene's three registry colours and two neighbours on the colour wheel, a little deepened so they glow rather than wash out.
  const TONES = [first, third, second, shift(first, -.16), shift(second, -.13)].map(colour => shift(colour, 0, .08, -.07));
  // Textile-inspired accents stay secondary: a small diamond repeat or offset panels on the wrapping paper only.
  const PAPER = ctx.id === 'birthday-russian' ? ['diamonds', 'stripes', 'diamonds'] : ctx.id === 'birthday-korean' ? ['grid', 'bands', 'grid'] : ['dots', 'stripes', 'grid'];
  // Things stand a little above the bottom edge (#675): the float's zoom crops the lowest 2% of the screen at its
  // centre, and a cake or a present standing in that band would be cut. FLOOR is the share of the half-height they stand at.
  const FLOOR = .9585, stand = (object, x, z, front, sink = 0) => { object.position.set(x, -view.halfHAt(z + front) * FLOOR - sink, z); stage.add(object); };

  // ---------- five balloons tied to a present, right corner ----------
  // The bunch keeps clear of the right edge, so the float never cuts a balloon (#675).
  const anchor = kit.gift(.8 * S, .64 * S, .8 * S, css(deep(second, .35)), css(pale(second)), PAPER[0], GOLD); anchor.rotation.y = .5; stand(anchor, Math.min(W - 1.4, W * .82), 0, .55 * S);
  const tie = V(anchor.position.x, anchor.position.y + .6 * S, 0);
  const SPOTS = [[-1.0, 2.6, .2], [-2.2, 3.3, -.5], [-.2, 3.9, .4], [-1.6, 4.7, -.2], [-3.1, 4.2, .5], [-.8, 5.6, -.6], [-2.7, 5.7, .1]];
  const KINDS = [{ skin: 'latex' }, { skin: 'pearl' }, { skin: 'foil', shape: 'star' }, { skin: 'latex', pattern: [CREAM, 'dots'] }, { skin: 'foil' }, { skin: 'latex' }, { skin: 'pearl' }];
  const bunch = Math.min(SPOTS.length, Math.max(3, Math.round(3 + A * 7)));
  for (let i = 0; i < bunch; i++) {
    const kind = KINDS[i], star = kind.shape === 'star', radius = (star ? .6 : .4 + rnd(i, seed + 1) * .22) * S, group = new T.Group(), at = V(...SPOTS[i]).multiplyScalar(.82 + S * .18);
    const balloon = kit.balloon(star ? GOLD : TONES[i % TONES.length], radius, kind); group.position.copy(tie); balloon.position.copy(at);
    balloon.quaternion.slerp(new T.Quaternion().setFromUnitVectors(V(0, -1, 0), at.clone().negate().normalize()), .45);
    const knot = at.clone().add(V(0, -(star ? 1.07 : 1.2) * radius, 0).applyQuaternion(balloon.quaternion));
    group.add(balloon, kit.line(new T.QuadraticBezierCurve3(knot, knot.clone().multiplyScalar(.5).add(V(-.12, -.45, 0)), V()).getPoints(24))); stage.add(group);
    const phase = i * 1.3; tick(t => { group.rotation.z = Math.sin(t * .45 + phase) * .035; group.rotation.x = Math.sin(t * .33 + phase) * .02; });
  }

  // ---------- a cake between two presents, left corner ----------
  const cake = kit.cake({ candles: 3 + A * 6, tiers: [[1.45, .95, CREAM, deep(first, .1)], [1.02, .8, pale(first, .6), CREAM], [.66, .66, CREAM, deep(second, .1)]], sprinkles: TONES, candleColours: [css(first), css(second), css(third)] });
  cake.scale.setScalar(S * .92); stand(cake, -W + 2.45, 0, 1.75 * S, .03);
  const presents = [[.85, 1.25, 1.5, 1.25, deep(first, .35), pale(first), PAPER[2], GOLD, .5, -1.1], [4.45, .74, .56, .74, deep(third, .25), pale(third, .7), PAPER[1], first, -.4, .95]];
  for (const [offset, w, h, d, base, accent, kind, ribbon, turn, z] of presents) { const present = kit.gift(w * S, h * S, d * S, css(base), css(accent), kind, ribbon); present.rotation.y = turn; stand(present, -W + offset, z, d * S * .7); }

  // ---------- a short swag of bunting in each top corner ----------
  const papers = TONES.map((tone, i) => [css(tone), css(pale(tone)), ['dots', 'stripes', 'grid', 'dots', 'stripes'][i]]), flags = Math.max(2, Math.round(3 + A * 6));
  stage.add(kit.bunting(V(-W - .35, 4.7, 0), V(-W + 4.6, 4.62, 0), { flags, papers }), kit.bunting(V(W - 3.7, 4.62, 0), V(W + .35, 4.7, 0), { flags: flags - 1, papers, start: 2 }));
}
