// Hanji, Korean mulberry paper lit from behind. Introduced by Seollal (#628) for the kite; the
// lotus lanterns (#630) use the same paper for their frames, faces and tags. See ../README.md.

/** Scatter mulberry fibres over a canvas: long, thin, slightly bent strokes and a few short flecks.
 * `ink` is an 'r,g,b' string and `strength` the alpha of the strongest fibre. */
export function hanjiFibres(kit, g, width, height, { count = 220, ink = '122,98,64', strength = .16, salt = 1, reach = .22 } = {}) {
  const { rnd } = kit, unit = Math.min(width, height);
  g.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = rnd(i, salt) * width, y = rnd(i, salt + 1) * height, angle = rnd(i, salt + 2) * Math.PI, fleck = i % 4 === 0;
    const length = (fleck ? .02 + rnd(i, salt + 3) * .03 : .06 + rnd(i, salt + 3) * reach) * unit, bend = (rnd(i, salt + 4) - .5) * length * .5;
    const dx = Math.cos(angle) * length / 2, dy = Math.sin(angle) * length / 2;
    g.strokeStyle = `rgba(${ink},${(strength * (.35 + rnd(i, salt + 5) * .65)).toFixed(3)})`; g.lineWidth = fleck ? 1.6 : .7 + rnd(i, salt + 6) * .9;
    g.beginPath(); g.moveTo(x - dx, y - dy); g.quadraticCurveTo(x - Math.sin(angle) * bend, y + Math.cos(angle) * bend, x + dx, y + dy); g.stroke();
  }
}

/** A sheet of hanji as a colour map and a bump map of the same fibres. `wash(g, w, h)` may paint
 * over the base before the fibres are laid, so pigment sits under them as it does on the paper. */
export function hanjiPaper(kit, width, height, { base = '#f2ead8', salt = 1, fibres = 220, wash } = {}) {
  const { rnd, canvasTexture } = kit;
  const map = canvasTexture(width, height, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    // Cloudy pulp: the sheet is never one even tone.
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${rnd(i, salt + 20) < .5 ? '255,251,238' : '190,172,134'},${(.03 + rnd(i, salt + 21) * .05).toFixed(3)})`; g.beginPath(); g.arc(rnd(i, salt + 22) * w, rnd(i, salt + 23) * h, (.04 + rnd(i, salt + 24) * .1) * Math.min(w, h), 0, 7); g.fill(); }
    wash?.(g, w, h);
    hanjiFibres(kit, g, w, h, { count: fibres, salt });
    hanjiFibres(kit, g, w, h, { count: Math.round(fibres * .6), salt: salt + 40, ink: '255,252,240', strength: .2 });
  }, { anisotropy: 8 });
  const bump = canvasTexture(width, height, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); hanjiFibres(kit, g, w, h, { count: fibres, salt, ink: '255,255,255', strength: .7 }); }, { srgb: false });
  return { map, bump };
}
