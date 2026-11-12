// Halloween (design plan #608). Three blown-glass pumpkins on the bottom edge in the left
// corner: a large amber one carved with a calm face and lit quietly from inside, a squat
// smoky-violet one a little in front and a small pale celadon one a little behind; and a
// dew-beaded cobweb spun into the opposite top corner. The glow breathes, it never flickers.
// No spider, skull, ghost, witch, moon or falling leaves. The plan's bare branch with roosting
// bats belongs to 31 October only and waits for the day-of step (#632, #639). The middle stays
// empty. Art rules: ../README.md.
import { pumpkin } from '../parts/halloween-pumpkin.js';
import { cobweb } from '../parts/halloween-cobweb.js';
import { weatherOver } from '../parts/wind-underneath.js';

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { stage, view, tick } = kit, W = view.halfW, A = ctx.amount, seed = ctx.seed;
  // The weather over the scene (#646): wind leans the cobweb left from its corner; rain and a storm halve the warm light
  // behind the pumpkins, fog dims it by 40% and takes the dew's glints away. The pumpkins keep still; nothing falls.
  const weather = weatherOver(kit, ctx);
  // The plan gives on-screen sizes at the everyday size (0.85); U carries the tier's size from there.
  const U = ctx.size / .85, floor = z => -view.halfHAt(z);
  const sit = (object, x, z, sunk) => { object.position.set(x, floor(z) - sunk, z); stage.add(object); return object; };

  // ---------- three glass pumpkins that differ in shape, colour and size; the base of each is cut by the frame ----------
  const lantern = sit(pumpkin(kit, { colour: 0xe8681c, width: 2.3 * U, height: 1.9 * U, ribs: 10, carved: true, stem: [.7, 1], salt: seed + 1, see: .6 }), -W + 2.15, 0, .09); lantern.rotation.y = .3;
  const squat = sit(pumpkin(kit, { colour: 0x6d4a9c, width: 1.5 * U, height: 1 * U, ribs: 12, groove: .14, stem: [-.8, .8], salt: seed + 2 }), -W + 3.95, .7, .08); squat.rotation.y = 1.1;
  const pale = sit(pumpkin(kit, { colour: 0xb4d6a8, width: .9 * U, height: .86 * U, ribs: 9, groove: .1, stem: [.5, 1.25], tendril: true, salt: seed + 3 }), -W + .78, -.6, .08); pale.rotation.y = -.4;
  const warm = kit.glow(0xff8a2a, 6 * U, .1 * weather.backlight, { twinkle: .06 }); warm.position.set(-W + 2.2, -view.halfH + .5, -1.6); stage.add(warm);

  // ---------- the cobweb, anchored just outside the top-right corner ----------
  const web = cobweb(kit, { reach: 4.6, dew: 30 + A * 170, salt: seed + 5, weather }); web.scale.setScalar(U); web.position.set(W + .4, view.halfH + .4, 0); stage.add(web);
  // The web hangs from the corner toward the lower left: its free end is below it.
  tick(() => { web.rotation.z = weather.sway(0, -.7); });
}
