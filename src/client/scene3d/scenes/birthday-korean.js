// Birthday with Korean accents (design plan #631; coordinator decision on #631: mainly a
// birthday, themed a bit). The birthday core is a candle-lit cake and three balloons tied down;
// the Korean accent is what they sit among: a low lacquered soban carries the cake beside a
// brass bowl of seaweed soup with its spoon and chopsticks (bottom right, the balloons tied to
// the table), two gifts wrapped in knotted silk bojagi wait in the bottom-left corner, and a
// sheer jogakbo patchwork cloth hangs from a rod in the top-left corner. No bunting, no ribbon
// bows, no lettering, no age (the candle count is fixed), nothing of a child's first birthday.
// The middle stays empty. Art rules: ../README.md.
import { bojagiGift } from '../parts/birthday-korean-bojagi.js';
import { jogakbo } from '../parts/birthday-korean-jogakbo.js';
import { soban, soupBowl, sujeo } from '../parts/birthday-korean-soban.js';
import { weatherOver } from '../parts/wind-underneath.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  // The plan's sizes are on-screen sizes at the special look; K follows the owner's size setting from there.
  const { T, V, rnd, stage, view, tick, mix, shift } = kit, W = view.halfW, A = ctx.amount, K = ctx.size / .935, seed = ctx.seed;
  const [jade, coral, gold] = ctx.palette, CREAM = 0xf9f3e8, deep = colour => shift(colour, 0, .06, -.08);
  // The weather over the scene (#646): wind leans the balloons left about their tie and widens their swing, ripples the
  // cloth half as deep again and leans it left from its rod, and blows the steam left. Nothing here falls or is backlit.
  const weather = weatherOver(kit, ctx);

  // ---------- the birthday table, bottom right: cake, seaweed soup, spoon and chopsticks on a soban ----------
  const table = soban(kit, { width: 3.2 * K, depth: 2 * K, height: 1.2 * K }), tableZ = -.3;
  // Its feet on the visible bottom: the float's zoom crops the lowest 2% at its centre (#675).
  table.position.set(W - 3.05, -view.halfHAt(tableZ + .7 * K) * .9588 + .12, tableZ); table.rotation.x = .12; stage.add(table);
  {
    const top = table.userData.top + .06 * K;
    // One low tier, cream with a coral glaze, on a plate; five plain candles, a fixed number.
    const cake = kit.cake({ candles: 5, tiers: [[.78, .6, CREAM, deep(coral)]], sprinkles: [deep(jade), deep(gold), deep(coral), CREAM], candleColours: ['#fbf7ef'] });
    cake.scale.setScalar(.9 * K); cake.position.set(-.66 * K, top, -.12 * K); table.add(cake);
    const bowl = soupBowl(kit, { radius: .4 * K }); bowl.position.set(.82 * K, top, .3 * K); table.add(bowl);
    const cutlery = sujeo(kit, { length: .95 * K }); cutlery.position.set(1.32 * K, top, .22 * K); cutlery.rotation.y = 1.25; table.add(cutlery);
    if (!ctx.quiet) {
      // Steam rises from the soup and fades.
      const from = V(.82 * K, top + bowl.userData.surface, .3 * K).applyEuler(table.rotation).add(table.position);
      for (let i = 0; i < 3; i++) {
        const wisp = kit.glow(0xfff1dc, 1, 0, { twinkle: 0 }); stage.add(wisp);
        tick(t => { const life = (t / 1.125 + i / 3) % 1; wisp.position.set(from.x + Math.sin(life * 4 + i * 2.1) * .1 + (i - 1) * .1 + weather.drift(life * 10), from.y + .1 + life * .8, from.z); wisp.scale.set((.26 + life * .3) * K, (.6 + life * .5) * K, 1); wisp.userData.o = (.1 + i * .03) * Math.sin(Math.PI * life); });
      }
    }
  }
  // A quiet date keeps the hero only.
  if (ctx.quiet) return;

  // ---------- three balloons, each different, tied to the table's rail ----------
  {
    const tie = table.userData.rail[3].clone().applyEuler(table.rotation).add(table.position), bend = V(1.05 * K, .75 * K, .1);
    // They float clear of the right edge, so the float never cuts one (#675).
    const SPOTS = [[.05, 4.75, .1], [.5, 5.85, -.5], [-.4, 6.5, .35]], KINDS = [[jade, .47, 'pearl'], [coral, .4, 'latex'], [gold, .35, 'foil']];
    for (let i = 0; i < Math.min(3, Math.max(2, Math.round(2 + A * 4))); i++) {
      const [colour, radius, skin] = KINDS[i], r = radius * K, group = new T.Group(), at = V(SPOTS[i][0] - (W - 8) * .3, SPOTS[i][1], SPOTS[i][2]), balloon = kit.balloon(deep(colour), r, { skin });
      group.position.copy(tie); balloon.position.copy(at); balloon.quaternion.slerp(new T.Quaternion().setFromUnitVectors(V(0, -1, 0), at.clone().negate().normalize()), .3);
      const knot = at.clone().add(V(0, -1.2 * r, 0).applyQuaternion(balloon.quaternion));
      // The string swings out past the rim of the table before it rises.
      group.add(balloon, kit.line(new T.QuadraticBezierCurve3(knot, bend.clone().add(V(0, i * .25, 0)), V()).getPoints(28))); stage.add(group);
      const phase = i * 1.3 + rnd(i, seed) * 2; tick(t => { group.rotation.z = weather.sway(Math.sin(t * .45 + phase) * .02, 1); group.rotation.x = Math.sin(t * .33 + phase) * .012 * weather.wind.sway; });
    }
  }

  // ---------- two gifts in knotted silk, bottom left: they differ in size, proportion, colour and knot ----------
  {
    // They stand a little above the bottom edge (#675: the float's zoom crops the lowest 2% of the screen at its centre).
    const stand = (gift, x, z, front, turn, sink) => { gift.position.set(x, -view.halfHAt(z + front) * .955 - sink, z); gift.rotation.y = turn; stage.add(gift); };
    stand(bojagiGift(kit, { width: 1.6 * K, height: 1.05 * K, depth: 1.6 * K, colour: deep(jade), lining: deep(coral), ears: 'upright', salt: 3 }), -W + 1.95, -.4, .8 * K, .45, .056);
    stand(bojagiGift(kit, { width: 1.3 * K, height: .45 * K, depth: .7 * K, colour: mix(gold, 0xb07a2a, .45), ears: 'lying', striped: true, salt: 9 }), -W + 3.55, .55, .35 * K, -.2, .03);
  }

  // ---------- a patchwork cloth hanging from its rod, top left ----------
  {
    const cloth = jogakbo(kit, { width: 2.8 * K, height: 3.5 * K, weather }), at = V(-W + 2.05, 4.1, -.8); cloth.position.copy(at); stage.add(cloth);
    for (const end of cloth.userData.ends) stage.add(kit.line([at.clone().add(end), at.clone().add(end).add(V(end.x * .12, 1.1, 0))], 0xcfc8d8, .55));
  }
}
