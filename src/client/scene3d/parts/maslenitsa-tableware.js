// Tableware for the food scenes of the Russian family (#624, also #625 and #627): a glazed
// plate (with an optional low foot), a cut-glass bowl, a glazed clay bowl, a carved wooden spoon
// and a wisp of steam. Each vessel is different on purpose; none is a stock bowl.
import { relathe, tubes, turned } from './new-year-tree-tubes.js';

const css = (kit, value) => `#${new kit.T.Color(value).getHexString()}`;

/** A glazed plate standing on y = 0, `radius` wide. `foot` (in plate radii) raises it on a low turned foot.
 * `line` is the colour of the thin line painted on its rim. `userData.top` is the height of its flat well. */
export function plate(kit, { radius = 1.6, colour = 0xf3ecdd, line = 0xc9973a, foot = 0 } = {}) {
  const base = foot ? [[0, 0], [.36, 0], [.38, .018], [.34, .04], [.2, foot * .55], [.19, foot * .8], [.3, foot], [.5, foot + .012]] : [[0, 0], [.5, 0], [.56, .02]];
  const lift = foot ? foot - .008 : 0, profile = [...base, [.8, lift + .07], [.97, lift + .115], [1, lift + .13], [1.006, lift + .142], [.992, lift + .15], [.955, lift + .14], [.8, lift + .095], [.62, lift + .05], [.52, lift + .04], [0, lift + .04]];
  const lip = base.length + 3, last = profile.length - 1;
  const glaze = kit.canvasTexture(8, 256, g => { g.fillStyle = css(kit, colour); g.fillRect(0, 0, 8, 256); g.fillStyle = css(kit, line); g.fillRect(0, 256 * (1 - (lip + 1.6) / last), 8, 256 * 1.1 / last); });
  const mesh = new kit.T.Mesh(turned(kit, profile, 72), kit.mat({ map: glaze, roughness: .2, clearcoat: 1, clearcoatRoughness: .08 }, .9));
  mesh.scale.setScalar(radius); mesh.userData.top = (lift + .04) * radius;
  return mesh;
}

/** A small cut-glass bowl on a foot, standing on y = 0: diamond facets that each catch the light on their own.
 * `userData.fill` is the height of its rim and `userData.inner` the radius just inside it, for what it holds. */
export function cutGlassBowl(kit, { radius = .42 } = {}) {
  const { T } = kit, sides = 18, profile = [[.5, 0], [.52, .05], [.2, .12], [.17, .22], [.45, .32], [.75, .5], [.93, .72], [1, .96], [1.01, 1.04]], position = [], index = [];
  profile.forEach(([r, y], i) => { for (let j = 0; j < sides; j++) { const a = (j + (i % 2) * .5) / sides * Math.PI * 2; position.push(Math.sin(a) * r, y, Math.cos(a) * r); } });
  for (let i = 1; i < profile.length; i++) for (let j = 0; j < sides; j++) {
    const a0 = (i - 1) * sides + j, a1 = (i - 1) * sides + (j + 1) % sides, b0 = i * sides + j, b1 = i * sides + (j + 1) % sides;
    if (i % 2) index.push(a0, a1, b0, a1, b1, b0); else index.push(a0, b1, b0, a0, a1, b1);
  }
  const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3)); geometry.setIndex(index); geometry.computeVertexNormals();
  // Cut glass in a dark room: facets that face a light flash, the rest keep a faint cool body instead of going black.
  const crystal = kit.mat({ color: 0xe6f0f8, metalness: .65, roughness: .14, flatShading: true, side: T.DoubleSide, depthWrite: false, clear: true, emissive: 0xbcd4e8, emissiveIntensity: .16 }, 1.9, false);
  const mesh = new T.Mesh(geometry, crystal); mesh.scale.setScalar(radius); mesh.renderOrder = 2; mesh.userData.fill = .96 * radius; mesh.userData.inner = .9 * radius;
  return mesh;
}

/** A glazed clay bowl standing on y = 0, darker where the glaze pools under the rim. */
export function clayBowl(kit, { radius = .36, glaze = 0x4c98bc, inside = 0xe9eef0 } = {}) {
  const profile = [[0, 0], [.46, 0], [.5, .03], [.52, .1], [.78, .36], [.96, .7], [1, .92], [1.01, 1], [.98, 1.02], [.94, .98], [.9, .72], [.72, .4], [.44, .16], [0, .12]];
  const paint = kit.canvasTexture(8, 256, g => {
    const y = k => 256 * (1 - k / (profile.length - 1)); g.fillStyle = css(kit, inside); g.fillRect(0, 0, 8, 256);
    const outer = g.createLinearGradient(0, y(0), 0, y(7.4)); outer.addColorStop(0, css(kit, kit.mix(glaze, 0x000000, .35))); outer.addColorStop(.5, css(kit, glaze)); outer.addColorStop(.9, css(kit, kit.mix(glaze, 0xffffff, .2))); outer.addColorStop(1, css(kit, kit.mix(glaze, 0x000000, .25)));
    g.fillStyle = outer; g.fillRect(0, y(8.5), 8, y(0) - y(8.5)); g.fillStyle = '#7a4a34'; g.fillRect(0, y(1.2), 8, y(0) - y(1.2));
    // Under what the bowl holds the inside is as dark as the outside, so nothing pale shows through the wall.
    g.fillStyle = css(kit, kit.mix(glaze, 0x000000, .3)); g.fillRect(0, 0, 8, y(10.4));
  });
  const mesh = new kit.T.Mesh(turned(kit, profile, 56), kit.mat({ map: paint, roughness: .22, clearcoat: 1, clearcoatRoughness: .1, emissiveMap: paint, emissive: 0xffffff, emissiveIntensity: .14 }, .9));
  mesh.scale.setScalar(radius); mesh.userData.fill = .78 * radius; mesh.userData.inner = .88 * radius;
  return mesh;
}

/** Thick soured cream as it sits in a bowl: a low mound with one slow swirl, `radius` wide, on y = 0. */
export function creamSwirl(kit, { radius = .3, colour = 0xe9e2d2 } = {}) {
  const profile = []; for (let i = 0; i <= 14; i++) { const k = i / 14; profile.push([1 - k, .42 * Math.pow(Math.sin(k * Math.PI / 2), 1.3)]); }
  const geometry = turned(kit, profile, 48), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z); p.setY(i, p.getY(i) + .085 * Math.sin(Math.atan2(z, x) + r * 8) * Math.sin(Math.min(1, r * 1.15) * Math.PI)); }
  relathe(geometry, profile.length);
  const mesh = new kit.T.Mesh(geometry, kit.mat({ color: colour, roughness: .32, clearcoat: .5, clearcoatRoughness: .3 }, .7)); mesh.scale.setScalar(radius);
  return mesh;
}

/** A plain carved wooden spoon: its origin is the middle of its bowl, the handle runs toward +x and rises. */
export function woodenSpoon(kit, { length = 1.05, colour = 0xc8a878 } = {}) {
  const { T, V } = kit, group = new T.Group(), wood = kit.mat({ color: colour, roughness: .55, clearcoat: .3, clearcoatRoughness: .5 }, .5);
  const scoop = new T.Mesh(kit.sphereGeo, wood); scoop.scale.set(.15, .055, .105); group.add(scoop);
  const handle = tubes(kit, 8).add([V(.11, .012, 0), V(.3, .03, 0), V(.6, .06, 0), V(length, .1, 0)], .028, .024, undefined, undefined, (k, r) => r * (1 + .5 * Math.pow(k, 6))).mesh(wood);
  handle.scale.set(1, .7, 1); group.add(handle);
  return group;
}

/** A wisp of steam rising from the group's origin and thinning out. Nothing on quiet dates (it is in the air). */
export function steam(kit, { height = 1.3, width = .5, strength = .1, wisps = 2, salt = 0, weather = null } = {}) {
  const { T, rnd } = kit, group = new T.Group(); if (kit.ctx.quiet) return group;
  const curl = kit.canvasTexture(64, 256, g => {
    g.lineCap = 'round';
    // Soft without a canvas filter: the same wavering line drawn wide and faint, then narrower.
    for (let pass = 0; pass < 7; pass++) {
      g.lineWidth = 30 - pass * 4; g.strokeStyle = `rgba(255,255,255,${.035 + pass * .012})`; g.beginPath();
      for (let i = 0; i <= 40; i++) { const k = i / 40, x = 32 + Math.sin(k * 5.2 + salt) * 11 * k + Math.sin(k * 11 + salt * 2) * 3, y = 238 - k * 210; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    const fade = g.createLinearGradient(0, 0, 0, 256); fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(.35, 'rgba(0,0,0,0)'); fade.addColorStop(.85, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = fade; g.fillRect(0, 0, 64, 256);
  }, { srgb: false });
  for (let i = 0; i < wisps; i++) {
    const wisp = kit.glow(0xfff4e6, 1, strength, { texture: curl, twinkle: 0 }), phase = i / wisps + rnd(i, salt + 1) * .2, side = (i % 2 ? 1 : -1) * width * .22;
    group.add(wisp);
    kit.tick(t => {
      const k = (t * .3 + phase) % 1;
      // `weather` (the scene's parts/wind-underneath.js, #646): in the wind the steam is blown left as it rises.
      wisp.position.set(side + Math.sin(t * .4 + i * 2) * width * .1 + (weather ? weather.drift(k * 10) : 0), height * (.4 + k * .45), 0); wisp.scale.set((i % 2 ? -1 : 1) * width * (.7 + k * .7), height * (.8 + k * .4), 1); wisp.userData.o = strength * Math.pow(Math.sin(Math.PI * k), 1.2);
    });
  }
  return group;
}
