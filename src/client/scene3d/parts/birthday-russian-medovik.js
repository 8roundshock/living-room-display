// The birthday cake of the Russian treatment (#627): a honey layer cake (medovik), one low tier
// under a coat of crumbs, with a wedge already cut out so the thin honey-brown and cream layers
// show, a piped cream border and a few thin candles in an arc on the uncut part. Also the cut
// slice, turned to show its layers. Mainly a birthday: the candles are lit and say so first.

/** The cut face: thin honey layers and cream in turn, a little uneven, as a cake cut by hand shows them. */
function layers(kit, salt) {
  const { rnd } = kit;
  return kit.canvasTexture(256, 256, g => {
    g.fillStyle = '#e6cc9c'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9; i++) {
      const y = 14 + i * 26.5; g.fillStyle = i % 3 === 1 ? '#8f5216' : '#a5631f'; g.beginPath(); g.moveTo(0, y + Math.sin(i + salt) * 2);
      for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * .05 + i * 2 + salt) * 2.2);
      for (let x = 256; x >= 0; x -= 16) g.lineTo(x, y + 12.5 + Math.sin(x * .043 + i * 1.3 + salt) * 2.2);
      g.closePath(); g.fill();
    }
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${rnd(i, salt + 1) < .5 ? '255,240,214' : '96,52,16'},${.08 + rnd(i, salt + 2) * .12})`; g.fillRect(rnd(i, salt + 3) * 256, rnd(i, salt + 4) * 256, 1 + rnd(i, salt + 5) * 2.5, 1 + rnd(i, salt + 6) * 1.5); }
    g.fillStyle = '#9a6426'; g.fillRect(0, 0, 256, 7);
  }, { anisotropy: 4 });
}
/** The crumb coat: toasted cake crumbs pressed all over the outside. */
function crumbCoat(kit, salt) {
  const { rnd } = kit, coat = kit.canvasTexture(256, 256, g => {
    g.fillStyle = '#a06424'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) { const v = rnd(i, salt + 1); g.fillStyle = v < .4 ? `rgba(110,60,18,${.3 + rnd(i, salt + 2) * .4})` : `rgba(${206 + Math.round(v * 20)},${140 + Math.round(v * 40)},${66 + Math.round(v * 40)},${.3 + rnd(i, salt + 2) * .45})`; g.beginPath(); g.arc(rnd(i, salt + 3) * 256, rnd(i, salt + 4) * 256, .8 + rnd(i, salt + 5) * 2.4, 0, 7); g.fill(); }
  }, { repeat: true });
  return coat;
}

/** A wedge-shaped piece of the cake between two angles about the y axis, standing on y = 0: crumb coat outside and on top, layers on both cut faces. */
function piece(kit, { radius, height, from, sweep, coat, cut }) {
  const { T } = kit, group = new T.Group();
  // A honey-brown cake is darker than a cream one, so fully see-through it would show the white plate under it as a pale
  // patch on its top. It keeps half of the see-through look.
  const outside = kit.mat({ map: coat, color: 0xd0d0d0, bumpMap: coat, bumpScale: .02, roughness: .85, emissive: 0x9a5a1c, emissiveIntensity: .1, see: .5 }, .25);
  const inside = kit.mat({ map: cut, color: 0xd8d8d8, roughness: .65, side: T.DoubleSide, emissive: 0xb07a3a, emissiveIntensity: .1, see: .5 }, .3);
  // The top takes the same crumbs at their own scale: the coat is wrapped round the side, not stretched over the top.
  const above = coat.clone(); above.repeat.set(radius * 2.4, radius * 2.4); above.needsUpdate = true;
  const top = kit.mat({ map: above, color: 0xd0d0d0, bumpMap: above, bumpScale: .02, roughness: .85, emissive: 0x9a5a1c, emissiveIntensity: .1, see: .5 }, .25);
  const body = new T.Mesh(new T.CylinderGeometry(radius, radius, height, Math.max(8, Math.round(sweep * 14)), 1, false, from, sweep), [outside, top, outside]); body.position.y = height / 2; group.add(body);
  for (const [angle, flip] of [[from, 1], [from + sweep, -1]]) {
    const face = new T.Mesh(new T.PlaneGeometry(radius, height), inside); face.position.set(Math.sin(angle) * radius / 2, height / 2, Math.cos(angle) * radius / 2); face.rotation.y = angle - Math.PI / 2 * flip + (flip < 0 ? Math.PI : 0); group.add(face);
  }
  return group;
}

/**
 * The cake, standing on y = 0. `gap` is the angle of the missing wedge and `facing` where it opens (0 is toward +z).
 * Returns { group, lamp, top }: `lamp` is the candles' light and `top` the height of the cake's top.
 */
export function honeyCake(kit, { radius = 1.45, height = 1, gap = .87, facing = -.3, candles = 7, colours = ['#e63950', '#f2c230', '#5ab8d6'], seed = 0 } = {}) {
  const { T, C, rnd, tick } = kit, group = new T.Group(), coat = crumbCoat(kit, seed), from = facing + gap / 2, sweep = Math.PI * 2 - gap;
  coat.repeat.set(5, 1);
  group.add(piece(kit, { radius, height, from, sweep, coat, cut: layers(kit, seed) }));
  const within = angle => { const d = Math.atan2(Math.sin(angle - facing), Math.cos(angle - facing)); return Math.abs(d) > gap / 2 + .06; }, o = new T.Object3D();

  // Loose crumbs on top, thicker toward the rim, and a low border of piped cream shells.
  const crumbs = new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), kit.mat({ color: 0xffffff, roughness: .85, flatShading: true }, .3, false), 170), TONES = [0xc98b3c, 0xa5631f, 0xe0b06a, 0xb8742a];
  let placed = 0;
  for (let i = 0; i < 400 && placed < 170; i++) {
    const angle = rnd(i, seed + 1) * Math.PI * 2, r = radius * (1 - Math.pow(rnd(i, seed + 2), 2.2) * .62) * .97; if (!within(angle)) continue;
    o.position.set(Math.sin(angle) * r, height + .012, Math.cos(angle) * r); o.rotation.set(rnd(i, seed + 3) * 6, rnd(i, seed + 4) * 6, 0); o.scale.setScalar(.018 + rnd(i, seed + 5) * .028); o.updateMatrix(); crumbs.setMatrixAt(placed, o.matrix); crumbs.setColorAt(placed, C(TONES[i % TONES.length])); placed++;
  }
  crumbs.count = placed; if (crumbs.instanceColor) crumbs.instanceColor.needsUpdate = true; crumbs.frustumCulled = false; group.add(crumbs);
  const shell = new T.SphereGeometry(1, 12, 8), piped = [];
  for (let i = 0; i < 44; i++) { const angle = i / 44 * Math.PI * 2; if (within(angle)) piped.push(angle); }
  const border = new T.InstancedMesh(shell, kit.mat({ color: 0xe9dcc0, roughness: .4, clearcoat: .4, clearcoatRoughness: .3 }, .6), piped.length);
  piped.forEach((angle, i) => { o.position.set(Math.sin(angle) * radius * .9, height + .04, Math.cos(angle) * radius * .9); o.rotation.set(.5, angle + .5, 0, 'YXZ'); o.scale.set(.085, .06, .11); o.updateMatrix(); border.setMatrixAt(i, o.matrix); });
  border.frustumCulled = false; group.add(border);

  // Thin candles in an arc on the uncut part, each its own height and lean. A fixed handful: never an age.
  const count = Math.max(3, Math.round(candles)), lamp = new T.PointLight(0xffb060, 2.4, 6, 2); lamp.position.set(0, height + .95, .2); group.add(lamp);
  const flames = [];
  for (let i = 0; i < count; i++) {
    const angle = facing + Math.PI + (i - (count - 1) / 2) * (2.5 / count) + (rnd(i, seed + 6) - .5) * .12, r = radius * (.5 + (i % 2) * .1 + rnd(i, seed + 7) * .08), tall = .5 + rnd(i, seed + 8) * .12, x = Math.sin(angle) * r, z = Math.cos(angle) * r;
    const candle = new T.Mesh(new T.CylinderGeometry(.028, .03, tall, 10), kit.mat({ map: kit.patternTex('#fbf7ef', colours[i % colours.length], 'stripes'), roughness: .5, emissive: 0xffe2b0, emissiveIntensity: .12 }, .6, false));
    candle.position.set(x, height + tall / 2, z); candle.rotation.set((rnd(i, seed + 9) - .5) * .1, 0, (rnd(i, seed + 10) - .5) * .1); group.add(candle);
    const wick = new T.Mesh(new T.CylinderGeometry(.005, .005, .05, 5), kit.mat({ color: 0x2a2018, roughness: .9, see: 0 }, .1, false)); wick.position.set(x, height + tall + .02, z); group.add(wick);
    const flame = new T.Sprite(new T.SpriteMaterial({ map: kit.tex.flame(), transparent: true, depthWrite: false, blending: T.AdditiveBlending })); flame.position.set(x, height + tall + .17, z); group.add(flame);
    const halo = kit.glow(0xffb050, 1.3, .42, { twinkle: .3 }); halo.position.copy(flame.position); group.add(halo); flames.push([flame, i * 2.1]);
  }
  // Flames breathe slowly, each on its own phase; the warm light on the cake follows.
  tick(t => { for (const [flame, phase] of flames) flame.scale.set(.19 + Math.sin(t * 2.3 + phase) * .012, .38 * (1 + Math.sin(t * 1.7 + phase) * .1), 1); lamp.intensity = 2.4 * (1 + Math.sin(t * 1.9) * .08); });
  return { group, lamp, top: height };
}

/** The slice that was cut, standing on y = 0 with its point toward +z: the same layers on both sides. */
export function cakeSlice(kit, { radius = 1.45, height = 1, gap = .8, seed = 0 } = {}) {
  const coat = crumbCoat(kit, seed + 9); coat.repeat.set(1, 1);
  const group = piece(kit, { radius, height, from: Math.PI - gap / 2, sweep: gap, coat, cut: layers(kit, seed + 9) });
  group.children.forEach(child => { child.position.z += radius * .62; });
  return group;
}
