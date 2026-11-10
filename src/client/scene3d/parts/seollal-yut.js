// Yut (윷), the four throwing sticks of yunnori (#628): split from a branch, so each is rounded
// on the bark side and flat on the belly. The backs are left plain: the sources name no fixed
// mark, so none is invented. See ../README.md.

/** One stick lying along x with its flat belly down on y = 0 and its round back up.
 * `length` and `width` in world units; `bend` bows it a little; `salt` varies the grain. */
export function yutStick(kit, { length = 1.4, width = .3, bend = .02, salt = 1 } = {}) {
  const { T, rnd, canvasTexture, mat } = kit, group = new T.Group(), half = width / 2;
  // The stick narrows a little toward its ends, and the ends are rounded off by the knife.
  const girth = u => { const e = Math.abs(2 * u - 1); return (1 - .2 * e ** 3) * Math.sqrt(Math.max(0, 1 - Math.max(0, (e - .9) / .1) ** 2)) + .001; };
  const spine = u => bend * (1 - (2 * u - 1) ** 2);
  const back = new T.ParametricGeometry((u, v, target) => { const k = girth(u), a = v * Math.PI; target.set((u - .5) * length, Math.sin(a) * half * k * .96 + spine(u), Math.cos(a) * half * k); }, 40, 14);
  const belly = new T.ParametricGeometry((u, v, target) => { const k = girth(u); target.set((u - .5) * length, spine(u) - .012 * width * Math.sin(v * Math.PI), (1 - 2 * v) * half * k); }, 40, 4);
  const grain = (base, dark, light, lines) => canvasTexture(512, 128, g => {
    g.fillStyle = base; g.fillRect(0, 0, 512, 128);
    for (let i = 0; i < lines; i++) {
      const y = rnd(i, salt) * 128, wobble = 2 + rnd(i, salt + 1) * 5; g.strokeStyle = `rgba(${rnd(i, salt + 2) < .6 ? dark : light},${(.08 + rnd(i, salt + 3) * .16).toFixed(3)})`; g.lineWidth = .8 + rnd(i, salt + 4) * 2.2;
      g.beginPath(); g.moveTo(0, y); for (let x = 32; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * .012 + i) * wobble); g.stroke();
    }
  }, { anisotropy: 4 });
  // Bark side: darker, with long streaks. Belly: pale split wood with the grain of the heart.
  const bark = mat({ map: grain('#80573a', '40,22,8', '176,132,88', 46), roughness: .5, clearcoat: .35, clearcoatRoughness: .4, side: T.DoubleSide }, .8);
  const heart = mat({ map: grain('#e4c690', '140,92,40', '255,240,206', 38), roughness: .42, clearcoat: .45, clearcoatRoughness: .35, side: T.DoubleSide }, .8);
  group.add(new T.Mesh(back, bark), new T.Mesh(belly, heart));
  return group;
}
