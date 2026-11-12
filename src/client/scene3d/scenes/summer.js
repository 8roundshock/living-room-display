// Summer (design plan #614). A morning-glory vine hangs down the right edge from beyond the
// top-right corner: two stems wound loosely round each other, three side runners, heart leaves
// that grow smaller down the vine, three open flowers that differ in size and facing, furled
// buds and tendrils. A short runner of the same vine enters low on the left, and a few fireflies
// (lights only) glow and fade over it and beside the vine. Nothing along the bottom edge except
// that runner, nothing in the middle, no sun. One fixed picture for the whole season
// (coordinator decision on #614). Art rules: ../README.md.
import { aim } from '../parts/spring-blade.js';
import { limb, taper } from '../parts/spring-limb.js';
import { morningGlory } from '../parts/summer-morning-glory.js';
import { weatherOver } from '../parts/wind-underneath.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed, today = ctx.seed + ctx.day;
  // The weather over the scene (#646): wind leans each leaf and flower to the left and widens its sway; rain and a storm
  // put out the fireflies and halve the glows; fog dims the glows and the fireflies by 40% and stops the twinkle.
  const weather = weatherOver(kit, ctx), G = morningGlory(kit), TURN = Math.PI * 2;
  const at = (x, y, z = 0) => V(W - x, y, z);   // measured from the right edge, so the vine keeps its edge on any screen shape

  /** A leaf on its stalk from a node. The group turns a little about the node. */
  const hangLeaf = (parent, node, side, size, hold, yaw, index, yellow = 0) => {
    const pivot = new T.Group(), reach = (.1 + size * .22) * S, out = V(side * .8, -.3, .5).normalize(), end = out.clone().multiplyScalar(reach);
    const blade = G.leaf({ size: size * S, hold, seed: seed + index * 7, yellow }); blade.position.copy(end);
    aim(kit, blade, V(side * .3 + (rnd(index, seed + 2) - .5) * .5, -1, .12), V(Math.sin(yaw), .12, Math.cos(yaw)));
    pivot.position.copy(node); pivot.add(blade, limb(kit, [V(), end.clone().multiplyScalar(.5).add(V(0, .03 * S, 0)), end], taper(.014 * S, .009 * S), G.stem, { sides: 5 })); parent.add(pivot);
    const pace = 1 + rnd(index, seed + 3) * .68, phase = rnd(index, today + 4) * 6;
    // The leaf hangs below its node: its free end is below the pivot.
    tick(t => { pivot.rotation.z = weather.sway(Math.sin(t * pace + phase) * .026, -.7); pivot.rotation.x = Math.sin(t * pace * .7 + phase) * .012 * weather.wind.sway; });
    return pivot;
  };
  /** A bud on a short stalk. */
  const hangBud = (parent, node, way, length, index) => {
    const end = node.clone().addScaledVector(way.clone().normalize(), .16 * S), bud = G.bud({ length: length * S, seed: seed + index });
    bud.position.copy(end); bud.quaternion.setFromUnitVectors(V(0, 1, 0), way.clone().normalize()); parent.add(bud, limb(kit, [node, end], taper(.012 * S, .01 * S), G.stem, { sides: 5 }));
  };

  // ---------- the vine: it swings as one piece about the point it hangs from ----------
  const hook = at(-.3, 5.2, -.3), vine = new T.Group(), body = new T.Group(); vine.position.copy(hook); body.position.copy(hook).negate(); vine.add(body); stage.add(vine);
  const guide = new T.CatmullRomCurve3([hook, at(.5, 4.0, 0), at(1.0, 2.4, .1), at(.75, .6, 0), at(1.1, -1.0, .15), at(1.25, -2.2, .1), at(1.56, -2.64, .1), at(1.84, -2.34, .15)], false, 'centripetal'), length = guide.getLength();
  /** A point on one of the two wound stems: `phase` picks the stem, `share` is 0-1 down the vine. */
  const wound = (phase, share, until = 1) => {
    const p = guide.getPointAt(share), t = guide.getTangentAt(share), n = V(t.y, -t.x, 0).normalize(), b = V().crossVectors(t, n), angle = share * length / 1.4 * TURN + phase, rho = .12 * Math.min(1, (until - share) * 9 + .12);
    return p.addScaledVector(n, Math.cos(angle) * rho).addScaledVector(b, Math.sin(angle) * rho);
  };
  const strand = (phase, until, from, to) => { const points = [], n = Math.round(96 * until); for (let i = 0; i <= n; i++) points.push(wound(phase, i / n * until, until)); return limb(kit, points, taper(from * S, to * S), G.stem, { sides: 6, steps: Math.round(260 * until) }); };
  body.add(strand(0, 1, .036, .016), strand(Math.PI, .78, .03, .014));
  const onStem = (second, share) => second ? wound(Math.PI, Math.min(share, .76), .78) : wound(0, Math.min(share, .97));   // the second stem ends sooner
  const runner = (share, points, phase = 0) => { const mesh = limb(kit, [wound(phase, share), ...points.map(p => at(...p))], taper(.024 * S, .012 * S), G.stem, { sides: 6 }); body.add(mesh); return mesh; };
  const high = runner(.13, [[1.3, 3.92, .2], [2.1, 3.62, .35], [2.75, 3.3, .3], [3.08, 3.42, .22]]);
  const mid = runner(.42, [[1.45, 1.6, .25], [1.95, 1.25, .35], [2.3, .8, .3], [2.22, .44, .25]], Math.PI);
  const low = runner(.7, [[1.45, -1.2, .3], [1.85, -1.75, .35], [2.2, -2.05, .3]]);

  // Leaves: larger near the top. Each differs in size, hold and turn; none faces the room squarely.
  const leaves = Math.min(24, Math.round(10 + 14 * A)), onRunners = [[high, .45, -1, .7, 1, -.4], [high, .82, 1, .5, 0, .5], [mid, .4, -1, .58, 2, .35], [mid, .78, 1, .4, 1, -.5], [low, .55, -1, .42, 0, .2]], onVine = Math.max(4, leaves - onRunners.length);
  for (let i = 0; i < onVine; i++) {
    const share = .07 + (i + rnd(i, seed + 11) * .5) / onVine * .84, side = i % 2 ? 1 : -1;
    hangLeaf(body, onStem(i % 2 === 1, share), side, (.95 - share * .62) * (.86 + rnd(i, seed + 12) * .28), i, (rnd(i, seed + 13) - .5) * 1.2, i);
  }
  onRunners.forEach(([shoot, share, side, size, hold, yaw], i) => hangLeaf(body, shoot.userData.at(share), side, size, hold, yaw, 40 + i));

  // Three open flowers (five at most), never in a row, each its own size and facing; a soft light in each throat.
  const FLOWERS = [[wound(0, .31), [1.38, 2.62, .42], .5, [-.3, .22, .93]], [wound(Math.PI, .55), [.84, .3, .46], .42, [-.52, -.1, .85]], [low.userData.at(.5), [1.72, -1.58, .62], .38, [.12, .42, .9]], [high.userData.at(.62), [2.3, 3.9, .6], .4, [-.2, -.3, .93]], [mid.userData.at(.62), [2.42, 1.2, .62], .36, [-.7, .3, .65]]];
  FLOWERS.slice(0, Math.min(5, Math.round(2 + 3 * A))).forEach(([node, foot, radius, face], i) => {
    const pivot = new T.Group(), base = at(...foot).sub(node), flower = G.flower({ radius: radius * S, seed: seed + i }), way = V(...face).normalize();
    flower.position.copy(base); flower.quaternion.setFromUnitVectors(V(0, 1, 0), way);
    pivot.position.copy(node); pivot.add(flower, limb(kit, [V(), base.clone().multiplyScalar(.5).add(V(0, .04, 0)), base], taper(.016 * S, .013 * S), G.stem, { sides: 5 })); body.add(pivot);
    if (!ctx.quiet) { const light = kit.glow(0xe9f0ff, .5 * S, .14 * weather.backlight, { twinkle: .1 }); light.position.copy(base).addScaledVector(way, flower.userData.deep * .7); pivot.add(light); }
    const phase = rnd(i, seed + 21) * 6, hold = base.y / base.length(); tick(t => { pivot.rotation.z = weather.sway(Math.sin(t * 1.2 + phase) * .0175, hold); });
  });
  hangBud(body, high.userData.at(1), V(.5, .7, .3), .36, 1); hangBud(body, mid.userData.at(.9), V(-.5, -.6, .5), .3, 2); hangBud(body, wound(0, .88), V(.7, -.2, .5), .27, 3);
  [[high.userData.at(.3), V(-.3, -1, .2), .5, 1], [mid.userData.at(1), V(-.2, -1, .1), .42, -1], [wound(0, .62), V(-.75, -.6, .3), .55, 1], [low.userData.at(1), V(-.8, -.5, .1), .36, -1]].forEach(([from, way, reach, side]) => body.add(G.tendril({ from, way, reach: reach * S, coil: .1 * S, side, thick: .011 * S })));
  tick(t => { vine.rotation.z = weather.sway(Math.sin(t * 1.257) * .0087, 0); });

  if (ctx.quiet) return;   // a quiet date keeps the vine alone: no runner, no fireflies, no backlight

  // ---------- a short runner of the same vine, low on the left and set back ----------
  {
    const z = -1.5, edge = view.halfWAt(z), start = V(-edge - .45, -3.16, z), shoot = limb(kit, [start, V(-edge + .5, -3.5, z), V(-edge + 1.4, -3.74, z + .1), V(-edge + 2.2, -4.3, z + .1), V(-edge + 2.75, -4.62, z)], taper(.024 * S, .011 * S), G.stem, { sides: 6 }); stage.add(shoot);
    [[.3, 1, .5, 0, .3], [.52, -1, .4, 2, -.4], [.74, 1, .33, 1, .5], [.93, -1, .25, 0, -.2]].forEach(([share, side, size, hold, yaw], i) => { const pivot = hangLeaf(stage, shoot.userData.at(share), side, size, hold, yaw, 60 + i); pivot.children[0].rotation.x -= .5; });
    hangBud(stage, shoot.userData.at(1), V(.8, .45, .2), .26, 7);
    stage.add(G.tendril({ from: shoot.userData.at(.62), way: V(.4, .9, .1), reach: .36 * S, coil: .08 * S, side: -1, thick: .01 * S }));
  }

  // ---------- backlight behind the upper vine ----------
  const haze = kit.glow(0x7fb8a0, 6, .05 * weather.backlight, { twinkle: .24 }); haze.position.copy(at(1.6, 2.6, -2.5)); stage.add(haze);

  // ---------- fireflies: lights only, four over the runner in the bottom-left corner and two beside the vine ----------
  // Rain or a storm puts the fireflies out (#646): they stay built and hidden.
  {
    const SPOTS = [[-W + 1.5, -2.5, -1], [W - 2.3, -.7, .6], [-W + 2.6, -3.3, 1.6], [-W + .9, -1.7, -4.5], [W - 2.2, 2.0, -3], [-W + 2.9, -2.1, -6], [-W + 1.9, -3.7, 2.6], [W - 2.9, -2.9, -1.5], [-W + .7, -3.0, .4], [-W + 2.2, -1.5, -2.4]];
    const smooth = k => k * k * (3 - 2 * k);
    SPOTS.slice(0, Math.min(10, Math.round(4 + 6 * A))).forEach(([x, y, z], i) => {
      // Far ones are small and sharp; near ones are larger, softer and fainter.
      const scale = 1 - z / view.depth, near = z > 1, colour = i % 2 ? 0xf3e58a : 0xd9f27a, home = V(x * scale, y * scale, z);
      const core = kit.glow(colour, .14 * S * (near ? 2.6 : 1), 0, { twinkle: 0 }), halo = kit.glow(colour, .9 * S * (near ? 1.5 : 1), 0, { twinkle: 0 }); core.visible = halo.visible = !weather.wet; stage.add(core, halo);
      // Three seconds up, two held, four down, then five to fourteen dark, on a clock that runs at an eighth of real time.
      const dark = .625 + rnd(i, today + 31) * 1.125, cycle = 1.125 + dark, offset = rnd(i, today + 32) * cycle + i * .37, pace = .25 + rnd(i, seed + 33) * .15, phase = rnd(i, seed + 34) * 6;
      tick(t => {
        const age = ((t + offset) % cycle + cycle) % cycle, lit = age < .375 ? smooth(age / .375) : age < .625 ? 1 : age < 1.125 ? 1 - smooth((age - .625) / .5) : 0;
        core.userData.o = lit * (near ? .5 : 1) * weather.far; halo.userData.o = lit * (near ? .16 : .3) * weather.far;
        core.position.set(home.x + Math.cos(t * pace + phase) * .6, home.y + Math.sin(t * pace * 1.3 + phase) * .35, home.z + Math.sin(t * pace * .7 + phase) * .25); halo.position.copy(core.position);
      });
    });
  }
}
