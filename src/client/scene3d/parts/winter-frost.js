// Frost and clear ice for Winter (#616): a frost fern grown as a dendrite of small faceted ice
// crystals (one instanced mesh), whose outer edge slowly advances and retreats; and the clear
// ice that glazes a twig: a sleeve with gentle swellings, frozen drops and beads.
// The glaze is clear, not white: its own colour is dark, so its body stays see-through and it
// shows by its rim and by what it catches. backlight() puts small cold lamps behind a piece of
// ice, the way glass is lit to be seen. Parts: plain functions of the kit. See ../README.md.
import { sheets } from './spring-blade.js';
import { limb } from './spring-limb.js';

/**
 * A frost fern in its own plane, growing from the frame corner at `corner` (a Vector3): `across`
 * and `up` are how far it may reach along the bottom edge and up the side edge. `fronds` are
 * [x, y, heading in radians, length, curl in radians per unit] measured from the corner in that
 * plane. Each grows a curving rib; at every step a barb leaves on either side (about 56 to 60
 * degrees, longer on the outside of the curve) and the longer barbs carry a regular row of
 * barbules at sixty degrees; a long frond also sends out two smaller fronds of its own. The
 * barbs follow a feather's outline and shorten to single feathers toward the outer limit.
 * `density` (0-1) is the share of steps that carry barbs; `size` scales the crystals, not the
 * reach. `tilt` leans the plane so the corner is nearer the camera.
 * Returns { mesh, tips, breathe, count }: `tips(n)` are crystal tips for glints, and
 * `breathe(t)` grows and shrinks the outermost crystals over `period` scene seconds.
 */
export function frostFern(kit, { corner, across = 4.4, up = 3.8, fronds, tilt = .175, density = 1, size = 1, period = 45, seed = 0 }) {
  const { T, V, C, rnd } = kit, cosT = Math.cos(tilt), sinT = Math.sin(tilt), list = [], ends = [];
  const far = (x, y) => Math.hypot(Math.max(0, x) / across, Math.max(0, y) / up);
  const crystal = (x, y, heading, length, width) => { list.push({ x, y, heading, length: length * size, width: width * size, far: far(x + Math.cos(heading) * length * .5, y + Math.sin(heading) * length * .5), n: list.length }); };
  /** A barb: one straight crystal, with a regular row of barbules on either side when it is long enough. Frost is orderly: that is what makes it a feather and not a thorn bush. */
  const barb = (x0, y0, heading, length, fine, salt) => {
    const cos = Math.cos(heading), sin = Math.sin(heading); crystal(x0, y0, heading, length, .016 + length * .03);
    if (length > .12) ends.push([x0 + cos * length, y0 + sin * length]);
    if (fine && length > .13) for (let j = 1, count = Math.floor(length / .05); j < count; j++) {
      const p = j / count, reach = length * .4 * (1 - p) * (.9 + rnd(j, salt) * .2) + .015;
      for (const turn of [1, -1]) crystal(x0 + cos * length * p, y0 + sin * length * p, heading + turn * 1.047, reach, .012);
    }
  };
  const grow = (x0, y0, heading, length, curl, salt, child) => {
    const step = .05, steps = Math.round(length / step), longest = .25 * Math.pow(length, .55) * (child ? .8 : 1); let x = x0, y = y0, h = heading;
    for (let i = 0; i < steps; i++) {
      const s = i / steps, d = far(x, y); if (d > .96 || s > .93) break;   // a frond ends in its last short barbs, not in a bare thread
      h += curl * step * (.4 + 1.2 * s);
      // The barbs follow a feather's outline along the rib, and shorten to single feathers toward the outer limit.
      const open = Math.pow(Math.sin(Math.PI * Math.pow(s, .5)), .7) * (1 - .3 * s), thin = Math.max(0, 1 - .75 * d * d);
      // Rib crystals overlap by two thirds, so the rib is one tapering line and not a row of dashes.
      crystal(x, y, h, step * 3, (.045 - .027 * s) * (child ? .7 : 1) * (.3 + .7 * thin));
      if (rnd(i, salt + 2) < density) for (const side of [1, -1]) {
        const key = i * 2 + (side > 0 ? 0 : 1);
        barb(x, y, h + side * (.98 + rnd(key, salt + 3) * .07), (.03 + longest * open * thin) * (side * curl < 0 ? 1 : .7) * (.92 + rnd(key, salt + 4) * .16), d < .78, salt + 100 + key * 7);
      }
      // Two smaller fronds leave a long rib, one to each side, and curl the other way.
      if (!child && length > 2.4) [[.3, 1], [.56, -1]].forEach(([share, turn], k) => { if (i === Math.round(steps * share)) { const side = curl < 0 ? turn : -turn; grow(x, y, h + side * .75, length * (1 - s) * .42, -side * (Math.abs(curl) * 2 + .25), salt + 500 + k * 37, true); } });
      x += Math.cos(h) * step; y += Math.sin(h) * step;
    }
  };
  fronds.forEach(([x, y, heading, length, curl], f) => grow(x, y, heading, length, curl, seed + f * 17, false));
  // Nearest the corner first, so the crystals that come and go (the outermost 15%) are the end of the list.
  list.sort((a, b) => a.far - b.far || a.n - b.n);

  // A crystal: a six-sided prism that tapers to a quarter of its width, standing on its base.
  const geometry = new T.CylinderGeometry(.125, .5, 1, 6, 1, true); geometry.translate(0, .5, 0);
  const material = kit.mat({ color: 0x8ea3c0, roughness: .12, metalness: 0, clearcoat: 1, clearcoatRoughness: .08, flatShading: true }, 1.4);
  const mesh = new T.InstancedMesh(geometry, material, list.length), colours = new Float32Array(list.length * 3), TINTS = [C(0xf2f8ff), C(0xa9ead6), C(0xd3bef6)];
  const UP = V(0, 1, 0), place = V(), way = V(), scale = V(), turn = new T.Quaternion(), roll = new T.Quaternion(), matrix = new T.Matrix4();
  // The plane leans back from the corner; each crystal is lifted a little out of it and rolled, so its facets catch the light differently.
  const spot = (x, y, lift, out) => out.set(corner.x + x * cosT, corner.y + y, corner.z - x * sinT + lift);
  const compose = (item, grown) => {
    spot(item.x, item.y, (rnd(item.n, seed + 7) - .5) * .1, place);
    way.set(Math.cos(item.heading) * cosT, Math.sin(item.heading), -Math.cos(item.heading) * sinT + (rnd(item.n, seed + 8) - .5) * .36).normalize();
    turn.setFromUnitVectors(UP, way).multiply(roll.setFromAxisAngle(UP, rnd(item.n, seed + 9) * 6.283));
    scale.set(item.width, item.length * grown, item.width * (.45 + rnd(item.n, seed + 10) * .55)); return matrix.compose(place, turn, scale);
  };
  list.forEach((item, i) => {
    mesh.setMatrixAt(i, compose(item, 1));
    const pick = rnd(item.n, seed + 11), tint = pick < .75 ? TINTS[0] : pick < .875 ? TINTS[1] : TINTS[2]; colours[i * 3] = tint.r; colours[i * 3 + 1] = tint.g; colours[i * 3 + 2] = tint.b;
  });
  mesh.instanceColor = new T.BufferAttribute(colours, 3); mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.frustumCulled = false;

  // The outermost 15% of the crystals come and go. The edge moves far too slowly to redo them every frame:
  // they are recomputed only when it has moved by a step too small to see, and only their part of the buffer is sent.
  const first = Math.floor(list.length * .85), edge = list[first]?.far ?? 1, last = list[list.length - 1]?.far ?? 1;
  let shown = -1;
  function breathe(t) {
    const front = edge + (last - edge + .02) * (.5 - .5 * Math.cos(t * Math.PI * 2 / period));
    if (Math.abs(front - shown) < .0008 || first >= list.length) return;
    shown = front;
    for (let i = first; i < list.length; i++) { const grown = Math.min(1, Math.max(0, (front - list[i].far) / .03)); mesh.setMatrixAt(i, compose(list[i], grown * grown * (3 - 2 * grown))); }
    mesh.instanceMatrix.updateRange.offset = first * 16; mesh.instanceMatrix.updateRange.count = (list.length - first) * 16; mesh.instanceMatrix.needsUpdate = true;
  }
  // Tips for glints: barb tips well inside the fern, spread around the corner.
  const inside = ends.filter(([x, y]) => { const d = far(x, y); return d > .25 && d < .8 && x > .1 && y > .1; }).sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
  const tips = (count = 6) => Array.from({ length: Math.min(count, inside.length) }, (_, i) => { const [x, y] = inside[Math.floor((i + .5) / count * inside.length)]; return spot(x, y, .05, V()); });
  return { mesh, tips, breathe, count: list.length };
}

/** Clear ice: returns makers that share one material. `sleeve` glazes a limb, `drop` is a
 * frozen drop hanging from its origin, `bead` a flattened bead. */
export function ice(kit) {
  const { T, rnd } = kit;
  const ripple = kit.canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { const value = rnd(i, 71) < .5 ? 60 : 200; g.fillStyle = `rgba(${value},${value},${value},${.12 + rnd(i, 72) * .2})`; g.beginPath(); g.ellipse(rnd(i, 73) * w, rnd(i, 74) * h, 6 + rnd(i, 75) * 16, 2 + rnd(i, 76) * 5, 0, 0, 7); g.fill(); }
  }, { srgb: false, repeat: true });
  const material = kit.mat({ color: 0x36475c, roughness: .05, metalness: 0, clearcoat: 1, clearcoatRoughness: .04, bumpMap: ripple, bumpScale: .006 }, 1.3);
  // Clear ice is seen by its edge. The kit has no rim-lit surface, so this one adds a cold light of its own along
  // its silhouette, before the kit's see-through patch reads the colour (three.js r128 shader text; if a later
  // three.js words that line differently nothing is replaced and the ice is simply without the rim).
  const patch = material.onBeforeCompile, rim = kit.C(0xd6e8ff);
  material.onBeforeCompile = (shader, renderer) => {
    shader.fragmentShader = shader.fragmentShader.replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
      `outgoingLight += vec3(${rim.r.toFixed(3)}, ${rim.g.toFixed(3)}, ${rim.b.toFixed(3)}) * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 1.6) * 2.4;\n\tgl_FragColor = vec4( outgoingLight, diffuseColor.a );`);
    patch(shader, renderer);
  };
  /** The glaze round a limb made with limb(): `thick` times as thick plus a skin, swelling and thinning along it, heavier underneath. */
  function sleeve(wood, { thick = 1.7, skin = .012, salt = 0 } = {}) {
    const { at, radius, length } = wood.userData, points = []; for (let i = 0; i <= 24; i++) points.push(at(i / 24).add(new T.Vector3(0, -radius(i / 24) * .4, 0)));
    // The glaze closes over the tip of the twig in a rounded end.
    const glaze = limb(kit, points, t => (radius(t) * thick + skin) * (1 + .12 * Math.sin(t * length * 9 + salt) + .05 * Math.sin(t * length * 23 + salt * 2)) * (t > .93 ? Math.sqrt(Math.max(.004, 1 - ((t - .93) / .07) ** 2)) : 1), material, { sides: 12 });
    glaze.renderOrder = 2; return glaze;
  }
  /** A frozen drop of `length` hanging from its origin: a pointed neck that fills out to a round end. */
  function drop(length) {
    const S = sheets(kit); S.turn(12, 12, v => { const angle = Math.PI * (1 - v); return [length * .36 * Math.sin(angle) * Math.pow(Math.sin(angle / 2), 1.5) + length * .03 * v, -length * (1 - Math.cos(angle)) / 2]; }, () => [1, 1, 1]);
    const mesh = new T.Mesh(S.geometry(), material); mesh.renderOrder = 2; return mesh;
  }
  /** A flattened bead of ice, `size` across. */
  function bead(size) { const mesh = new T.Mesh(kit.sphereGeo, material); mesh.scale.set(size / 2, size * .36, size / 2); mesh.renderOrder = 2; return mesh; }
  return { sleeve, drop, bead, material };
}

/** Small cold lamps behind a piece of ice, the way glass is lit to be seen: they light its rims
 * and far facets and leave the side that faces the room clear. `spots` are [Vector3, strength];
 * each lamp drifts a little about its spot, so the highlights slide while the ice stays still.
 * Returns a group to add. Local lights only: the scene's own lighting is not touched. */
export function backlight(kit, spots, { colour = 0xcfe2ff, range = 8, sweep = .9 } = {}) {
  const { T } = kit, group = new T.Group(), lamps = spots.map(([home, strength], i) => { const lamp = new T.PointLight(kit.C(colour), strength, range, 2); lamp.position.copy(home); group.add(lamp); return { lamp, home, phase: i * 2.3 }; });
  kit.tick(t => { for (const { lamp, home, phase } of lamps) lamp.position.set(home.x + Math.sin(t * .56 + phase) * sweep, home.y + Math.cos(t * .41 + phase) * sweep * .5, home.z); });
  return group;
}
