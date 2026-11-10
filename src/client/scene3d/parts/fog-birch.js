// Birch trunks (Fog, #620): pale columns that run off the top and the bottom of the screen, each
// with its own bark (short dark dashes and two or three eye-shaped scars), its own slight bend
// and its own depth. Also a tapered limb for the few bare twigs.

/** A bare limb along `points`, tapering from radius `from` to `to`. Returns a mesh. */
export function taperedLimb(kit, points, from, to, material, radial = 7) {
  const { T, V } = kit, curve = new T.CatmullRomCurve3(points), rings = Math.max(10, points.length * 7), geometry = new T.TubeGeometry(curve, rings, 1, radial), p = geometry.attributes.position, centre = V();
  for (let ring = 0; ring <= rings; ring++) {
    curve.getPointAt(ring / rings, centre); const r = from + (to - from) * ring / rings;
    for (let j = 0; j <= radial; j++) { const v = ring * (radial + 1) + j; p.setXYZ(v, centre.x + (p.getX(v) - centre.x) * r, centre.y + (p.getY(v) - centre.y) * r, centre.z + (p.getZ(v) - centre.z) * r); }
  }
  return new T.Mesh(geometry, material);
}

/**
 * One birch trunk standing at depth `z`, at `x` as seen on the screen plane. `light` (0-1) dims a
 * trunk that stands farther into the fog; `detail` is the bark canvas width. Returns a mesh, with
 * `userData.at(y)` giving the trunk's centre at a height, for attaching twigs.
 */
export function birchTrunk(kit, { x, z, radius = .2, light = 1, detail = 256, salt = 0 }) {
  const { T, V, rnd, view } = kit, k = 1 - z / view.depth, height = view.halfHAt(z) * 2 + 1.2, r = n => rnd(n, salt);
  const bark = kit.canvasTexture(detail, detail * 8, (g, w, h) => {
    const unit = w / 256;
    g.fillStyle = '#d8dcd6'; g.fillRect(0, 0, w, h);
    // Broad soft patches of warmer and greyer white, so the bark is not one flat tone.
    for (let i = 0; i < 46; i++) { g.fillStyle = `rgba(${r(i + 900) < .5 ? '176,184,182' : '240,234,220'},${.1 + r(i + 950) * .12})`; g.beginPath(); g.ellipse(r(i + 1000) * w, r(i + 1050) * h, (20 + r(i + 1100) * 50) * unit, (40 + r(i + 1150) * 120) * unit, 0, 0, 7); g.fill(); }
    // Lenticels: short horizontal dashes, a few of them long.
    g.lineCap = 'round';
    for (let i = 0; i < 230; i++) {
      const y = r(i) * h, at = r(i + 300) * w, length = (5 + Math.pow(r(i + 600), 2.4) * 70) * unit, sag = (r(i + 1300) - .5) * 4 * unit;
      g.strokeStyle = `rgba(90,84,78,${.35 + r(i + 1600) * .5})`; g.lineWidth = (1.1 + r(i + 1900) * 2.4) * unit;
      for (const wrap of [0, -w]) { g.beginPath(); g.moveTo(at + wrap, y); g.quadraticCurveTo(at + wrap + length / 2, y + sag, at + wrap + length, y + sag * .4); g.stroke(); }
    }
    // Scars where a branch once was: a dark eye under a pair of drooping brows, on the side that faces the room.
    const scars = 2 + Math.round(r(2300));
    for (let i = 0; i < scars; i++) {
      const cx = (.36 + r(i + 2310) * .28) * w, cy = (.14 + (i + r(i + 2320) * .7) / scars * .74) * h, a = (20 + r(i + 2330) * 14) * unit, b = a * (.42 + r(i + 2340) * .2);
      g.fillStyle = '#35302c'; g.beginPath(); g.moveTo(cx - a, cy); g.quadraticCurveTo(cx, cy - b * 1.7, cx + a, cy); g.quadraticCurveTo(cx, cy + b * 1.5, cx - a, cy); g.fill();
      g.strokeStyle = 'rgba(58,52,48,.8)'; g.lineWidth = 3.2 * unit;
      for (const sign of [-1, 1]) { g.beginPath(); g.moveTo(cx + sign * a * .2, cy - b * 1.1); g.quadraticCurveTo(cx + sign * a * 1.5, cy - b * .9, cx + sign * a * 2.3, cy + b * 1.9); g.stroke(); }
      g.fillStyle = 'rgba(150,146,138,.5)'; g.beginPath(); g.ellipse(cx, cy + b * .1, a * .45, b * .32, 0, 0, 7); g.fill();
    }
  }, { anisotropy: 4 });
  // The seam of the cylinder and of the bark is at the back.
  const geometry = new T.CylinderGeometry(radius * .84, radius * 1.1, height, 14, 30, true, Math.PI), p = geometry.attributes.position;
  // A gentle S, different for each trunk, and a slight lean: a birch is never a ruled column.
  const bend = .05 + r(2400) * .07, turnA = r(2401) * 6.283, turnB = r(2402) * 6.283, lean = (r(2403) - .5) * .04;
  const at = y => V(x * k + bend * Math.sin(y / height * Math.PI * 1.25 + turnA) + lean * y, y, z + bend * .5 * Math.cos(y / height * Math.PI * 1.1 + turnB));
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), centre = at(y); p.setX(i, p.getX(i) + centre.x); p.setZ(i, p.getZ(i) + centre.z - z); }
  const trunk = new T.Mesh(geometry, kit.mat({ map: bark, bumpMap: bark, bumpScale: .03, color: new T.Color().setScalar(light).getHex(), roughness: .8, metalness: 0 }, .4, false));
  trunk.position.z = z; trunk.userData.at = at;
  return trunk;
}
