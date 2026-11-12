// Jogakbo (조각보) for the Korean-accent birthday (#631): a wrapping cloth pieced from leftover
// scraps of sheer ramie, irregular squares and rectangles joined by flat sealed seams, hung from a
// slim rod by its corner straps. The panes are see-through and the seams read. It is one hanging
// cloth, never a full-screen grid. See ../README.md.

const RAMIE = '#efe9da', TINTS = ['#49c9a3', '#f2718f', '#e0b443', '#6f93dc'];

/** The cloth hanging below the group's origin, which is the middle of its rod: `width` x `height`. */
export function jogakbo(kit, { width = 2.8, height = 3.6, salt = 8 } = {}) {
  const { T, V, rnd, tick, mat, canvasTexture } = kit, group = new T.Group(), PX = 512, PY = 660, hw = width / 2;
  // A seeded, irregular subdivision into about two dozen panes.
  const panes = []; let calls = 0;
  const split = (x, y, w, h, level) => {
    const id = calls++, area = w * h / (PX * PY);
    if (level > 6 || Math.min(w, h) < 46 || (area < .12 && rnd(id, salt) < .5) || area < .03) { panes.push([x, y, w, h]); return; }
    // Mostly cut across the longer side; now and then the other way, for a long strip.
    const k = .32 + rnd(id, salt + 1) * .36, across = (w > h * 1.05) !== (rnd(id, salt + 2) < .14);
    if (across) { split(x, y, w * k, h, level + 1); split(x + w * k, y, w * (1 - k), h, level + 1); } else { split(x, y, w, h * k, level + 1); split(x, y + h * k, w, h * (1 - k), level + 1); }
  };
  split(0, 0, PX, PY, 0);
  // Most panes are plain ramie white; about a third take a pale tint, never two alike side by side in the list.
  const tone = i => rnd(i, salt + 5) < .46 ? RAMIE : TINTS[(i + Math.floor(rnd(i, salt + 6) * 4)) % 4];
  const seams = (g, colour, lineWidth) => { g.strokeStyle = colour; g.lineWidth = lineWidth; for (const [x, y, w, h] of panes) g.strokeRect(x, y, w, h); g.strokeRect(lineWidth / 2, lineWidth / 2, PX - lineWidth, PY - lineWidth); };
  const map = canvasTexture(PX, PY, g => {
    panes.forEach(([x, y, w, h], i) => { g.fillStyle = tone(i); g.fillRect(x, y, w, h); });
    // The open weave of ramie, a thread in each direction.
    g.fillStyle = 'rgba(120,110,90,.1)'; for (let x = 0; x < PX; x += 3) g.fillRect(x, 0, 1, PY); for (let y = 0; y < PY; y += 3) g.fillRect(0, y, PX, 1);
    // A sealed seam is three layers of cloth: paler and denser than a pane, with its stitching down the middle.
    seams(g, 'rgba(255,252,242,.85)', 6.5); seams(g, 'rgba(150,138,112,.7)', 1);
  }, { anisotropy: 8 });
  const alpha = canvasTexture(PX, PY, g => {
    // How solid the ramie is (a pane 0.5-0.7, a sealed seam 0.85) at the standard look; kit.solidity applies the Transparency setting (#670).
    panes.forEach(([x, y, w, h], i) => { const v = Math.round(255 * kit.solidity(.5 + rnd(i, salt + 7) * .2)); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, w, h); });
    const seam = Math.round(255 * kit.solidity(216 / 255)); seams(g, `rgb(${seam},${seam},${seam})`, 6.5);
  }, { srgb: false, anisotropy: 8 });
  const geometry = new T.PlaneGeometry(width, height, 28, 36); geometry.translate(0, -height / 2, 0);
  const p = geometry.attributes.position, rest = p.array.slice();
  const cloth = new T.Mesh(geometry, mat({ map, alphaMap: alpha, roughness: .8, side: T.DoubleSide, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: .4, see: .4, depthWrite: false, clear: true }, .3, false)); cloth.position.y = -.1;   // ramie gauze: really see-through (#683)
  tick(t => {
    for (let i = 0; i < p.count; i++) {
      const x = rest[i * 3], y = rest[i * 3 + 1], down = -y / height, middle = 1 - (x / hw) ** 2;
      // Tied only at its corners, the top edge dips a little between them; a slow ripple travels down the cloth.
      p.setY(i, y - .09 * middle * Math.max(0, 1 - down * 2.5)); p.setZ(i, Math.sin(x * 1.7 + y * .8 - t * 2.4) * .04 * (.25 + down) + Math.sin(x * 3.9 - t * 1.7) * .012 * down);
    }
    p.needsUpdate = true; geometry.computeVertexNormals(); group.rotation.z = Math.sin(t * 2.8) * .0087;
  });
  // The rod, and a strap from each top corner tied around it.
  const wood = mat({ color: 0xd8c29a, roughness: .55, clearcoat: .3 }, .7), rod = new T.Mesh(new T.CylinderGeometry(.035, .035, width + .4, 12), wood); rod.rotation.z = Math.PI / 2;
  const strap = mat({ color: RAMIE, roughness: .8, side: T.DoubleSide, see: .4 }, .3, false);
  for (const side of [-1, 1]) {
    const loop = new T.Mesh(new T.TorusGeometry(.05, .014, 6, 16), strap); loop.rotation.y = Math.PI / 2; loop.position.set(side * (hw - .04), 0, 0);
    const tail = new T.Mesh(kit.ribbonGeo([V(side * (hw - .04), -.04, .02), V(side * (hw - .01), -.2, .04), V(side * (hw + .05), -.34, .03)], .035, V(1, 0, 0)), strap);
    group.add(loop, tail);
  }
  for (const cap of [-1, 1]) { const knob = new T.Mesh(kit.ballGeo, wood); knob.scale.setScalar(.045); knob.position.x = cap * (hw + .2); group.add(knob); }
  group.add(rod, cloth);
  group.userData.ends = [V(-hw - .12, 0, 0), V(hw + .12, 0, 0)];
  return group;
}
