// Canada Day (#600 reference scene; design plan #606). The National Flag flying from its pole in
// the top-right corner with a few leaves fallen at the pole's foot, a cord of maple leaves in
// the top-left corner, a maple branch reaching in from the lower left with one large leaf on
// its stem, and three leaves falling at different depths. No fireworks (New Year has them).
// Nothing overlaps or decorates the flag. The middle stays empty. Art rules: ../README.md.
import { weatherOver } from '../parts/wind-underneath.js';

// The flag's stylised 11-point leaf, left half from the foot of the stem up to the tip, in the
// flag's own proportions (x from the centre line, y down, 2000 units from centre to tip). The
// botanical leaves of this scene use the kit's leaf; only the flag uses this one.
const FLAG_LEAF = [[-90, 2030], [-45, 1167], [-156, 1069], [-1015, 1220], [-899, 900], [-919, 827], [-1860, 65], [-1648, -34], [-1614, -113], [-1800, -685], [-1258, -570], [-1185, -608], [-1080, -855], [-657, -401], [-546, -458], [-750, -1510], [-423, -1321], [-332, -1348], [0, -2000]];

/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function build(kit, ctx) {
  const { T, V, rnd, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount, seed = ctx.seed;
  // The weather over the scene (#646): wind flies the flag harder with the gust (up to twice its wave), leans every
  // hanging leaf to the left and doubles its turn, and carries the falling leaves left; rain and a storm stop the
  // falling leaves and halve the red glow; fog dims the glow by 40%.
  const weather = weatherOver(kit, ctx);
  const TINTS = [...kit.LEAF_TINTS, 0xe0a0a8];

  // ---------- the flag: 2 to 1, red-white-red in 1:2:1, flying inward from the top of its pole ----------
  const flagTexture = kit.canvasTexture(1024, 512, g => {
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 1024, 512); g.fillStyle = '#d52b1e'; g.fillRect(0, 0, 256, 512); g.fillRect(768, 0, 256, 512);
    const unit = 512 / 4800, outline = [...FLAG_LEAF, ...FLAG_LEAF.slice(0, -1).reverse().map(([x, y]) => [-x, y])];
    g.beginPath(); outline.forEach(([x, y], i) => { if (i) g.lineTo(512 + x * unit, 256 + y * unit); else g.moveTo(512 + x * unit, 256 + y * unit); }); g.closePath(); g.fill();
    // A faint weave so the cloth is not a flat print.
    g.globalAlpha = .05; g.fillStyle = '#000'; for (let y = 0; y < 512; y += 3) g.fillRect(0, y, 1024, 1); for (let x = 0; x < 1024; x += 3) g.fillRect(x, 0, 1, 512);
  }, { anisotropy: 8 });
  const px = W - .7, top = 3.9, width = 3.5 * S, height = width / 2, foot = -view.halfH - .4;
  const steel = kit.mat({ color: 0xbfc3c9, metalness: 1, roughness: .28 }, 1.2, false);
  const pole = new T.Mesh(new T.CylinderGeometry(.045, .055, top - foot, 18), steel); pole.position.set(px, (top + foot) / 2, 0);
  const finial = new T.Mesh(kit.sphereGeo, kit.gold()); finial.scale.setScalar(.1); finial.position.set(px, top + .09, 0);
  const collar = new T.Mesh(new T.CylinderGeometry(.06, .075, .1, 18), kit.gold()); collar.position.set(px, top - .02, 0);
  const cloth = kit.flagCloth(flagTexture, { width, height, fly: -1, wave: weather.windy ? () => .6 * (1 + weather.wind.gust) : .6 }); cloth.position.set(px - .05, top - .12 - height / 2, 0);
  stage.add(pole, finial, collar, cloth, kit.line([V(px + .07, top - .05, .03), V(px + .1, top - 2.6, .05), V(px + .07, foot, .03)], 0xd9d2c0, .45));
  // A few leaves lie at the foot of the pole.
  const fallen = Math.max(2, Math.round(2 + A * 8));
  for (let i = 0; i < fallen; i++) {
    const z = -.5 + rnd(i, seed + 4) * 1.4, leaf = kit.leaf(TINTS[(i * 2 + 1) % TINTS.length], [.5, .34, .62, .42][i % 4] * S, i); leaf.position.set(W - .3 - (i + rnd(i, seed + 2)) / fallen * 2.6, -view.halfHAt(z) + .14 + rnd(i, seed + 3) * .16, z);
    leaf.rotation.set(-1.15 + rnd(i, seed + 5) * .5, rnd(i, seed + 6) * .8 - .4, rnd(i, seed + 7) * 6.3); stage.add(leaf);
  }

  // Each hanging leaf hangs from its stem, tip down, and turns a little on it.
  const hangLeaf = (at, scale, tint, variant, lean, turn, reach, phase) => {
    const pivot = new T.Group(), leaf = kit.leaf(tint, scale, variant); pivot.position.copy(at); leaf.rotation.z = Math.PI; leaf.position.y = -scale * .84; pivot.add(leaf, kit.line([V(), V(0, -scale * .1, 0)], 0x6a3a2a, .8)); pivot.rotation.z = lean; stage.add(pivot);
    tick(t => { const sway = weather.wind.sway; pivot.rotation.y = turn + Math.sin(t * .25 + phase) * reach * sway; pivot.rotation.x = Math.sin(t * .19 + phase) * reach * .3 * sway; pivot.rotation.z = lean + weather.sway(Math.sin(t * .22 + phase) * .04, -1); });
    return pivot;
  };

  // ---------- a maple branch from the lower left, one large leaf on its stem ----------
  {
    const spine = new T.CatmullRomCurve3([V(-W - .6, -.25, -.5), V(-W + .5, -.5, -.2), V(-W + 1.6, -.42, .05), V(-W + 2.55, -.62, .2)]);
    const geometry = new T.TubeGeometry(spine, 40, .1, 8), p = geometry.attributes.position, centre = V();
    for (let ring = 0; ring <= 40; ring++) { spine.getPointAt(ring / 40, centre); const k = 1 - .72 * ring / 40; for (let j = 0; j <= 8; j++) { const v = ring * 9 + j; p.setXYZ(v, centre.x + (p.getX(v) - centre.x) * k, centre.y + (p.getY(v) - centre.y) * k, centre.z + (p.getZ(v) - centre.z) * k); } }
    geometry.computeVertexNormals(); stage.add(new T.Mesh(geometry, kit.mat({ color: 0x7a5238, roughness: .8 }, .4, false)));
    const big = 1.7 * S, hero = hangLeaf(spine.getPointAt(1), big, 0xffffff, 1, .22, 0, .45, 0);
    const glow = kit.glow(0xd52b1e, 7 * S, .17 * weather.backlight, { twinkle: .1 }); glow.position.set(hero.position.x + .3, hero.position.y - big * .8, -2.5); stage.add(glow);
    hangLeaf(spine.getPointAt(.42), .62 * S, TINTS[1], 0, -.35, 0, .55, 2.1);
    hangLeaf(spine.getPointAt(.7).add(V(0, 0, -.2)), .44 * S, TINTS[3], 2, .5, 0, .6, 4.2);
  }

  // ---------- a cord of leaves in the top-left corner: five at most, no two the same size and tint ----------
  {
    // Sizes alternate large and small so neighbours never touch.
    const cord = kit.catenary(V(-W - .4, 4.3, 0), V(-W + 5.5, 4.66, 0), .4, 40), strung = Math.min(5, Math.max(2, Math.round(3 + A * 12))), SIZES = [.46, .24, .4, .28, .34]; stage.add(kit.line(cord, 0xbfa77a, .7));
    for (let k = 0; k < strung; k++) {
      const at = cord[Math.round(3 + (k + .5 + (rnd(k, seed + 13) - .5) * .2) / strung * 34)].clone().add(V(0, 0, (rnd(k, seed + 14) - .5) * .3));
      hangLeaf(at, SIZES[k] * S, TINTS[(k * 2) % TINTS.length], k, (rnd(k, seed + 12) - .5) * .4, (rnd(k, seed + 16) - .5) * 1.1, .3, rnd(k, seed + 15) * 6);
    }
  }

  // ---------- three leaves falling at different depths, on the left so none passes the flag ----------
  if (!ctx.quiet) for (let i = 0; i < Math.round(2 + A * 8); i++) {
    const leaf = kit.leaf(TINTS[(i + 2) % TINTS.length], (.3 + rnd(i, seed + 21) * .22) * S, i), x0 = -W * (.58 + (i + rnd(i, seed + 23)) / 3 * .4), z = -6 + rnd(i, seed + 25) * 5, speed = .1 + rnd(i, seed + 26) * .12, phase = rnd(i, seed + 27) * 20;
    leaf.visible = weather.falls; stage.add(leaf);   // rain or a storm stops the falling leaves (#646)
    tick(t => { const y = ((rnd(i, seed + 28) * 13 - t * speed) % 13 + 13) % 13 - 6.5; leaf.position.set(x0 * (1 - z / view.depth * .9) + Math.sin(t * .4 + phase) * .5 + weather.drift((6.5 - y) / speed), y, z); leaf.rotation.set(t * (.2 + rnd(i, seed + 29) * .3) + phase, t * (.25 + rnd(i, seed + 30) * .3) + phase, t * .15 + phase); });
  }
}
