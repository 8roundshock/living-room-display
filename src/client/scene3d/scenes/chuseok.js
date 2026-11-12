// Chuseok, the Korean harvest festival (design plan #629). A woven tray of half-moon songpyeon,
// just off the steam on their bed of pine needles, rests in the bottom-left corner with an opened
// chestnut burr and a few jujubes beside it; a dim, warm full moon sits in the top-right corner,
// crossed by a leafy persimmon branch whose fruit is still turning orange. No mooncakes, no
// pampas grass, no rabbit in the moon, no ritual tableware, no bare late-autumn branch. The
// ripening rice belongs to the three holiday days: it is drawn only when the engine gives the
// scene the special tier (#632). The middle stays empty. Art rules: ../README.md.
import { chestnutBurr, jujube } from '../parts/chuseok-fruit.js';
import { fullMoon } from '../parts/chuseok-moon.js';
import { persimmon, persimmonLeaves } from '../parts/chuseok-persimmon.js';
import { riceStalk } from '../parts/chuseok-rice.js';
import { chaeban, pineBed, songpyeon } from '../parts/chuseok-songpyeon.js';
import { taperTube } from '../parts/seollal-forms.js';
import { weatherOver } from '../parts/wind-underneath.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  // The plan's sizes are on-screen sizes at the everyday look; K follows the owner's size setting from there.
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, A = ctx.amount, K = ctx.size / .85, seed = ctx.seed, lifted = ctx.tier === 'special';
  // The weather over the scene (#646): wind leans the fruit, the leaves and the rice to the left and widens their sway,
  // and carries the loose leaf and the steam left; rain and a storm keep the loose leaf on the branch and halve the lilac
  // light behind the tray, fog dims it by 40%. The moon is the hero and stays as it is.
  const weather = weatherOver(kit, ctx);

  // ---------- the tray of songpyeon, bottom left, tilted toward the viewer so its top reads ----------
  {
    const tray = new T.Group(), R = 1.6 * K; tray.position.set(-W + 2.45, -view.halfH + .8, -.6); tray.rotation.set(.5, .2, 0); stage.add(tray);
    tray.add(chaeban(kit, { radius: R }));
    const needles = kit.needles(); pineBed(kit, needles, { radius: R * .86, pairs: Math.round(170 + A * 330), salt: seed % 97 }); tray.add(needles.mesh());
    // No two alike: white, mugwort green, gardenia yellow, pine-bark rose, in three shapes; two carry finger marks.
    // [colour, x, z, turn, lean back, roll, shape, dimples]
    const PILE = [[0xf1ece0, -.46, .34, .35, -.35, 0, 1, 2], [0x7a9a48, .36, .46, -.5, -.5, .1, 2.3, 0], [0xe9c552, -.05, -.34, .1, -.9, 0, 4.1, 0], [0xdb8c96, .84, -.2, 1.1, -.4, -.1, 1, 1], [0xf1ece0, -.9, -.3, -.9, -.55, .1, 2.3, 0]];
    PILE.slice(0, Math.min(5, Math.max(3, Math.round(3 + A * 9)))).forEach(([colour, x, z, turn, back, roll, shape, dimples], i) => {
      const cake = songpyeon(kit, { size: 1.15 * K * (1 + (rnd(i, seed + 3) - .5) * .12), colour, seed: shape, dimples }), seat = new T.Group();
      seat.position.set(x * K, .1 * K, z * K); seat.rotation.y = turn; cake.rotation.set(back, 0, roll); seat.add(cake); tray.add(seat);
    });
    // A lilac rim from behind, the scene's third colour as light only.
    const rim = new T.PointLight(0xd79ae0, .9 * weather.backlight, 5, 2); rim.position.set(1.3 * K, .9 * K, -1.5 * K); tray.add(rim);
    if (!ctx.quiet) {
      // Two faint wisps of steam rise from the pile and fade.
      for (let i = 0; i < 2; i++) {
        const wisp = kit.glow(0xfff4e0, 1, 0, { twinkle: 0 }), x0 = tray.position.x + (i ? .45 : -.3) * K, y0 = tray.position.y + .5 * K; stage.add(wisp);
        tick(t => { const life = (t / 1.125 + i * .5) % 1; wisp.position.set(x0 + Math.sin(life * 4 + i * 2) * .12 + weather.drift(life * 10), y0 + life * .8, .4); wisp.scale.set((.35 + life * .35) * K, (.8 + life * .5) * K, 1); wisp.userData.o = .09 * Math.sin(Math.PI * life); });
      }
    }
  }
  // A quiet date keeps the hero only.
  if (ctx.quiet) return;

  // ---------- on the ground beside the tray: an opened chestnut burr and jujubes ----------
  {
    // A little above the bottom edge (#675: the float's zoom crops the lowest 2% of the screen at its centre).
    const ground = z => -view.halfHAt(z) + .13;
    const burr = chestnutBurr(kit, { radius: .34 * K, salt: seed % 53 }); burr.position.set(-W + 4.4, ground(.6) + .56 * K, .6); burr.rotation.set(.15, -.3, .1); stage.add(burr);
    const fallen = Math.min(3, Math.max(1, Math.round(1 + A * 9)));
    [[4.95, 1.1, .3, .85, .3], [5.3, .3, -.5, .5, .26], [3.85, 1.5, 1.2, .95, .28]].slice(0, fallen).forEach(([x, z, turn, ripe, length], i) => {
      const fruit = jujube(kit, { length: length * K, ripe, salt: 11 + i * 5 }); fruit.position.set(-W + x, ground(z) + length * K * .36 + .065, z); fruit.rotation.set(0, turn, (rnd(i, seed + 8) - .5) * .3); stage.add(fruit);
    });
  }

  // ---------- the full moon, top right, far behind the branch ----------
  const moonZ = -8, far = 1 - moonZ / view.depth, moonAt = V((W - 1.95) * far, 2.55 * far, moonZ);
  {
    const moon = fullMoon(kit, { radius: 1.35 * far * K, opacity: .44, halo: lifted ? .2 : .14 }); stage.add(moon);
    // It drifts along a shallow arc over ten minutes and back.
    tick(t => { moon.position.set(moonAt.x - Math.sin(t * .084) * .3 * far, moonAt.y + Math.cos(t * .084) * .08 * far, moonZ); });
  }

  // ---------- a persimmon branch grows in from the top-right corner and crosses the moon ----------
  {
    const branch = new T.Group(), root = V(W + .45, 4.95, -1); branch.position.copy(root); stage.add(branch);
    const spine = new T.CatmullRomCurve3([V(0, 0, 0), V(-1.1, -.42, .1), V(-2.2, -.62, -.05), V(-3.3, -1.12, .1), V(-4.5, -1.5, 0)]);
    const bark = kit.canvasTexture(64, 256, g => { g.fillStyle = '#808080'; g.fillRect(0, 0, 64, 256); for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${rnd(i, 1) < .5 ? '255,255,255' : '0,0,0'},${(.15 + rnd(i, 2) * .3).toFixed(2)})`; g.lineWidth = 1 + rnd(i, 3) * 2.5; const x = rnd(i, 4) * 64, y = rnd(i, 5) * 256; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd(i, 6) - .5) * 8, y + 20 + rnd(i, 7) * 60); g.stroke(); } }, { srgb: false, repeat: true });
    const wood = kit.mat({ color: 0x6a4f3a, roughness: .85, bumpMap: bark, bumpScale: .03 }, .4, false);
    branch.add(new T.Mesh(taperTube(kit, spine, u => .075 - .053 * u, 48, 8), wood));
    const twig = (at, to, radius) => { const curve = new T.CatmullRomCurve3([at, at.clone().lerp(to, .5).add(V(0, .06, 0)), to]); branch.add(new T.Mesh(taperTube(kit, curve, u => radius * (1 - .5 * u), 10, 6), wood)); };
    // Three fruits, each a different size and a different stage of turning; they hang from short side twigs.
    const sway = [];
    [[.36, .64, .95, V(-.1, -.3, .25)], [.63, .5, .5, V(.1, -.24, -.2)], [.9, .57, .75, V(-.12, -.22, .15)]].forEach(([u, size, ripe, off], i) => {
      const at = spine.getPointAt(u), tip = at.clone().add(off); twig(at, tip, .028);
      const fruit = persimmon(kit, { size: size * K, ripe, salt: 3 + i * 7, stalk: .1 }); fruit.position.copy(tip); fruit.rotation.x = .5 + i * .08; fruit.rotation.z = (rnd(i, seed + 5) - .5) * .25; branch.add(fruit); sway.push([fruit, fruit.rotation.z, i * 1.9, -1]);
    });
    // Six leaves, alternating along the branch, in three curls and three tints.
    const leaf = persimmonLeaves(kit), TINTS = [0xffffff, 0xf2ffd8, 0xffe9c4];
    const leaves = Math.min(6, Math.max(3, Math.round(3 + A * 12)));
    [[.2, 1, .95, 2.5], [.3, -1, .8, 1.2], [.5, 1, .9, 2.9], [.74, -1, .72, 1.5], [.8, 1, .82, -2.7], [1, -1, .78, 1.9]].slice(0, leaves).forEach(([u, side, scale, hang], i) => {
      const blade = leaf(scale * K * .78, i, TINTS[i % 3]); blade.position.copy(spine.getPointAt(u)).add(V(0, side * .03, side * .06));
      blade.rotation.set((rnd(i, seed + 6) - .5) * .5 + side * .25, (rnd(i, seed + 7) - .5) * .9, hang + (rnd(i, seed + 9) - .5) * .25); branch.add(blade); sway.push([blade, blade.rotation.z, i * 1.3 + 4, Math.cos(blade.rotation.z)]);   // a leaf grows along its +y: this is how far it points up
    });
    tick(t => {
      branch.rotation.z = weather.sway(Math.sin(t * 3.1) * .0105, 0);
      // Fruit and leaves follow a little behind the branch.
      for (const [item, rest, phase, hold] of sway) item.rotation.z = rest + weather.sway(Math.sin(t * 3.1 - .7 + phase * .2) * .03, hold);
    });
    // About once every ninety seconds a leaf lets go and falls down the right edge.
    const loose = leaf(.6 * K, 1, TINTS[2]); stage.add(loose);
    tick(t => {
      const cycle = (t / 11.25) % 1, fall = cycle / .5; loose.visible = fall < 1 && weather.falls;   // rain or a storm keeps it on the branch (#646)
      loose.position.set(W - 1.5 + Math.sin(fall * 9) * .45 + weather.drift(fall * 5.625), 3.2 - fall * 8.4, -.6); loose.rotation.set(fall * 5, fall * 4, -2 + Math.sin(fall * 7) * .8);
    });
  }

  // ---------- holiday days only: ripening rice rooted below the bottom-right corner ----------
  if (lifted) {
    const stalks = [[1.0, 2.5, .62, 48], [1.45, 2.15, .5, 40], [1.95, 2.35, .75, 45], [2.4, 1.9, .42, 36], [2.85, 2.2, .55, 42]];
    stalks.forEach(([x, height, lean, grains], i) => {
      const stalk = riceStalk(kit, { height: height * K, lean: lean * K, grains, salt: 21 + i * 13 }); stalk.position.set(W - x, -view.halfH - .3, -.3 + (i % 3) * .3); stage.add(stalk);
      const phase = i * 1.1; tick(t => { stalk.rotation.z = weather.sway(Math.sin(t * 4.2 + phase) * .0175, 1); });
    });
  }
}
