// Clear ice for Winter (#616, #665): the glaze round a bare twig (a sleeve with gentle
// swellings, frozen drops and beads) and the icicles under a snow-laden bough.
// The ice is clear, not white: its own colour is dark, so its body stays see-through and it
// shows by its rim and by what it catches. backlight() puts small cold lamps behind a piece of
// ice, the way glass is lit to be seen. Nothing here sets a renderOrder (#662): the scene
// decides what is drawn first by where it puts each mesh's origin (./winter-order.js).
// (The frost fern of #616 lived in this file as winter-frost.js until #665 replaced it with
// an evergreen.) Parts: plain functions of the kit. See ../README.md.
import { sheets } from './spring-blade.js';
import { limb } from './spring-limb.js';

/** Clear ice: returns makers that share one material. `sleeve` glazes a limb, `drop` is a
 * frozen drop hanging from its origin, `bead` a flattened bead, `icicles` a few icicles as one mesh. */
export function ice(kit) {
  const { T, rnd } = kit;
  const ripple = kit.canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { const value = rnd(i, 71) < .5 ? 60 : 200; g.fillStyle = `rgba(${value},${value},${value},${.12 + rnd(i, 72) * .2})`; g.beginPath(); g.ellipse(rnd(i, 73) * w, rnd(i, 74) * h, 6 + rnd(i, 75) * 16, 2 + rnd(i, 76) * 5, 0, 0, 7); g.fill(); }
  }, { srgb: false, repeat: true });
  const material = kit.mat({ color: 0x36475c, roughness: .05, metalness: 0, clearcoat: 1, clearcoatRoughness: .04, bumpMap: ripple, bumpScale: .006, clear: true }, 1.3);
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
    return limb(kit, points, t => (radius(t) * thick + skin) * (1 + .12 * Math.sin(t * length * 9 + salt) + .05 * Math.sin(t * length * 23 + salt * 2)) * (t > .93 ? Math.sqrt(Math.max(.004, 1 - ((t - .93) / .07) ** 2)) : 1), material, { sides: 12 });
  }
  /** A frozen drop of `length` hanging from its origin: a pointed neck that fills out to a round end. */
  function drop(length) {
    const S = sheets(kit); S.turn(12, 12, v => { const angle = Math.PI * (1 - v); return [length * .36 * Math.sin(angle) * Math.pow(Math.sin(angle / 2), 1.5) + length * .03 * v, -length * (1 - Math.cos(angle)) / 2]; }, () => [1, 1, 1]);
    return new T.Mesh(S.geometry(), material);
  }
  /** A flattened bead of ice, `size` across. */
  function bead(size) { const mesh = new T.Mesh(kit.ballGeo, material); mesh.scale.set(size / 2, size * .36, size / 2); return mesh; }   // a few pixels across: the low-detail sphere is enough
  /** Icicles as one mesh in world coordinates. `list` are [root (a Vector3), length, girth]: each hangs straight
   * down from its root, widest where it joins, thinning unevenly to a point, with the faint rings an icicle grows in. */
  function icicles(list, seed = 0) {
    const S = sheets(kit), place = new T.Matrix4();
    list.forEach(([root, length, girth], i) => {
      const p1 = rnd(i, seed + 1) * 6, p2 = rnd(i, seed + 2) * 6, lean = (rnd(i, seed + 3) - .5) * .1 * length;
      S.turn(8, 16, v => [Math.max(.0015, girth * (Math.pow(v, 1.3) * (1 + .13 * Math.sin(v * length * 46 + p1) + .07 * Math.sin(v * length * 21 + p2)) + (v > .86 ? (v - .86) * 2.4 : 0))), -length * (1 - v)],
        () => [1, 1, 1], { matrix: place.makeTranslation(root.x, root.y, root.z), bend: v => lean * (1 - v) * (1 - v) });
    });
    return new T.Mesh(S.geometry(), material);
  }
  return { sleeve, drop, bead, icicles, material };
}

/** Small cold lamps behind a piece of ice, the way glass is lit to be seen: they light its rims
 * and far facets and leave the side that faces the room clear. `spots` are [Vector3, strength];
 * each lamp drifts a little about its spot, so the highlights slide while the ice stays still
 * (`sweep` 0 keeps the lamps where they are). Returns a group to add. Local lights only: the
 * scene's own lighting is not touched. */
export function backlight(kit, spots, { colour = 0xcfe2ff, range = 8, sweep = .9 } = {}) {
  const { T } = kit, group = new T.Group(), lamps = spots.map(([home, strength], i) => { const lamp = new T.PointLight(kit.C(colour), strength, range, 2); lamp.position.copy(home); group.add(lamp); return { lamp, home, phase: i * 2.3 }; });
  if (sweep) kit.tick(t => { for (const { lamp, home, phase } of lamps) lamp.position.set(home.x + Math.sin(t * .56 + phase) * sweep, home.y + Math.cos(t * .41 + phase) * sweep * .5, home.z); });
  return group;
}
