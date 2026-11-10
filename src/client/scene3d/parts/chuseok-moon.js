// Boreumdal (보름달), the full harvest moon of Chuseok (#629): one whole, warm, dim disc with its
// halo. The markings are the moon's own seas, soft and irregular; no figure is drawn into them.
// Never a crescent, never blue-white. See ../README.md.

/** The seas as [x, y, radius x, radius y, turn, strength] in a unit square, north up. */
const SEAS = [[.24, .43, .13, .25, .15, .5], [.38, .27, .15, .13, 0, .6], [.6, .29, .1, .1, 0, .58], [.68, .44, .12, .1, .4, .6], [.84, .36, .05, .065, 0, .6], [.8, .56, .07, .1, 0, .5], [.7, .63, .05, .05, 0, .5], [.42, .66, .11, .09, 0, .5], [.28, .68, .06, .06, 0, .55], [.48, .12, .22, .03, 0, .4], [.52, .4, .04, .035, 0, .4]];

/** A full moon of `radius` facing the viewer, with a halo. It is unlit and luminous, and ignores the fog. */
export function fullMoon(kit, { radius = 1, opacity = .55, halo = .14 } = {}) {
  const { T, rnd, canvasTexture, glow } = kit, group = new T.Group(), P = 512;
  const map = canvasTexture(P, P, g => {
    const face = g.createRadialGradient(P / 2, P / 2, 0, P / 2, P / 2, P / 2); face.addColorStop(0, '#f6e9c4'); face.addColorStop(.72, '#f2e1b6'); face.addColorStop(1, '#d6bf88'); g.fillStyle = face; g.fillRect(0, 0, P, P);
    // The seas are drawn sharp on their own canvas and blurred onto the face in one pass.
    const sharp = document.createElement('canvas'); sharp.width = sharp.height = P; const s = sharp.getContext('2d');
    for (const [x, y, rx, ry, turn, strength] of SEAS) { s.fillStyle = `rgba(146,124,82,${strength})`; s.beginPath(); s.ellipse(x * P, y * P, rx * P, ry * P, turn, 0, 7); s.fill(); }
    // Bays and highland tongues, so no sea keeps the outline of an ellipse.
    for (let i = 0; i < 70; i++) { const [x, y, rx, ry] = SEAS[i % SEAS.length], a = rnd(i, 3) * 6.283, bay = rnd(i, 4) < .5; s.globalCompositeOperation = bay ? 'destination-out' : 'source-over'; s.fillStyle = `rgba(146,124,82,${bay ? .7 : .45})`; s.beginPath(); s.arc((x + Math.cos(a) * rx * (bay ? .95 : .8)) * P, (y + Math.sin(a) * ry * (bay ? .95 : .8)) * P, (.012 + rnd(i, 5) * .03) * P, 0, 7); s.fill(); }
    s.globalCompositeOperation = 'source-over';
    try { g.filter = 'blur(10px)'; } catch { /* no canvas filter: sharper seas */ }
    g.drawImage(sharp, 0, 0); try { g.filter = 'none'; } catch { /* no canvas filter */ }
    // One bright rayed crater low on the disc and a few pale flecks of highland.
    const ray = g.createRadialGradient(.46 * P, .83 * P, 0, .46 * P, .83 * P, .09 * P); ray.addColorStop(0, 'rgba(255,250,228,.55)'); ray.addColorStop(1, 'rgba(255,250,228,0)'); g.fillStyle = ray; g.fillRect(0, 0, P, P);
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(255,248,222,${(.06 + rnd(i, 7) * .1).toFixed(3)})`; g.beginPath(); g.arc(rnd(i, 8) * P, rnd(i, 9) * P, (.008 + rnd(i, 10) * .02) * P, 0, 7); g.fill(); }
  });
  const disc = new T.Mesh(new T.CircleGeometry(radius, 96), new T.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false, fog: false }));
  // The halo is behind whatever crosses the moon, so it keeps the depth test that halos usually skip.
  const light = glow(0xf7d264, radius * 6.4, halo, { twinkle: .1 }); light.material.depthTest = true; light.position.z = -.2;
  group.add(light, disc);
  return group;
}
