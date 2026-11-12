// Soviet-era glass for the New Year tree (#622): the spire that replaced the star on top, twisted
// icicles, glass cones, a pyramid drop, one "reflector" ball with a ribbed well, a clip-on bird,
// a thread of glass beads and wisps of foil "rain". Long and figural shapes: the Western
// Christmas scene keeps the round baubles. Every hanging piece has its origin where it hangs.
import { merged, resmooth, turned } from './new-year-tree-tubes.js';

// Silvered glass in a dark room: a mirror finish would show mostly black, so the silvering is a little soft and the colour glows faintly.
const mirror = (kit, colour, roughness = .34, more = {}) => kit.mat({ color: colour, metalness: .45, roughness, emissive: colour, emissiveIntensity: .1, gloss: true, own: .6, ...more }, 1.3);   // #691: a jewel's colour with its own light, not mirror-black

/** Hang a body (its top at its own y = 0) on a thread, under a small gold cap with a wire loop. */
function hung(kit, body, neck, thread) {
  const { T, V } = kit, group = new T.Group(), gold = kit.gold();
  const cap = new T.Mesh(new T.CylinderGeometry(neck * .8, neck, neck * .9, 14), gold); cap.position.y = -thread - neck * .45;
  const loop = new T.Mesh(new T.TorusGeometry(neck * .5, neck * .1, 6, 14), gold); loop.position.y = -thread + neck * .3;
  body.position.y = -thread - neck * .85;
  group.add(kit.line([V(), V(0, -thread + neck * .7, 0)], 0xd9c9a0, .5), loop, cap, body); group.userData.body = body;
  return group;
}

/** The tree-top spire, standing on y = 0 where its sleeve slips over the leader: sleeve, large ball, neck, small ball, spike. */
export function spire(kit, { length = 1.15, colour = 0xd9c7d2, band = 0xb5324f, tint = 0x7fc9c0 } = {}) {
  const { T } = kit, group = new T.Group(), ball = (y, centre, radius) => Math.abs(y - centre) < radius ? Math.sqrt(radius * radius - (y - centre) * (y - centre)) : 0, profile = [];
  for (let i = 0; i <= 120; i++) {
    const y = i / 120, core = y < .03 ? .052 : y < .68 ? .036 : .036 * Math.pow(Math.max(0, 1 - (y - .68) / .32), .85);
    profile.push([Math.max(core, ball(y, .3, .175), ball(y, .585, .1)), y]);
  }
  const css = value => `#${new T.Color(value).getHexString()}`;
  // Painted the way the factories painted them: frost rings and a row of dots on the large ball, a colour band on the small one.
  const paint = kit.canvasTexture(64, 512, g => {
    const Y = y => 512 * (1 - y); g.fillStyle = css(colour); g.fillRect(0, 0, 64, 512);
    g.fillStyle = css(tint); g.globalAlpha = .55; g.fillRect(0, Y(1), 64, Y(.7) - Y(1)); g.globalAlpha = 1;
    g.fillStyle = css(band); g.fillRect(0, Y(.62), 64, Y(.55) - Y(.62));
    g.fillStyle = '#f4f6fb'; for (const [from, to] of [[.4, .375], [.225, .2], [.66, .65], [.52, .51]]) g.fillRect(0, Y(from), 64, Y(to) - Y(from));
    for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(i * 8 + 4, Y(.3), 2.2, 0, 7); g.fill(); }
    g.fillStyle = '#d9b25a'; g.fillRect(0, Y(.1), 64, Y(0) - Y(.1));
  }, { anisotropy: 4 });
  // Green is roughness and blue is metalness: mirror glass, matte where it is frosted.
  const finish = kit.canvasTexture(64, 512, g => {
    const Y = y => 512 * (1 - y); g.fillStyle = 'rgb(0,80,235)'; g.fillRect(0, 0, 64, 512);
    g.fillStyle = 'rgb(0,215,70)'; for (const [from, to] of [[.4, .375], [.225, .2], [.66, .65], [.52, .51]]) g.fillRect(0, Y(from), 64, Y(to) - Y(from));
    for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(i * 8 + 4, Y(.3), 2.2, 0, 7); g.fill(); }
    g.fillStyle = 'rgb(0,90,255)'; g.fillRect(0, Y(.62), 64, Y(.55) - Y(.62));
  }, { srgb: false });
  paint.wrapS = finish.wrapS = T.RepeatWrapping; paint.repeat.x = finish.repeat.x = 3;
  const body = new T.Mesh(turned(kit, profile, 40), kit.mat({ map: paint, roughnessMap: finish, metalnessMap: finish, metalness: 1, roughness: 1, emissiveMap: paint, emissive: 0xffffff, emissiveIntensity: .12 }, 1.7));
  body.scale.setScalar(length); group.add(body);
  const glint = kit.glow(0xfff4e0, .5, .2, { twinkle: .15 }); glint.position.y = length * .99; group.add(glint);
  return group;
}

/** A twisted glass icicle: a six-sided taper turned about its axis, so each facet runs in a spiral. */
export function icicle(kit, { length = .7, colour = 0xcfd6e0, turns = 1.5, thread = .15 } = {}) {
  const { T } = kit, rings = 30, sides = 6, width = length * .1, position = [], index = [];
  for (let i = 0; i <= rings; i++) {
    const s = i / rings, radius = width * Math.min(1, Math.sqrt(s / .07)) * Math.pow(1 - s, .75) * (1 + .1 * Math.sin(s * 11)) + .0015;
    for (let j = 0; j < sides; j++) { const a = j / sides * Math.PI * 2 + s * turns * Math.PI * 2; position.push(Math.cos(a) * radius, -s * length, Math.sin(a) * radius); }
    if (i) for (let j = 0; j < sides; j++) { const a0 = (i - 1) * sides + j, a1 = (i - 1) * sides + (j + 1) % sides, b0 = a0 + sides, b1 = a1 + sides; index.push(a0, a1, b0, a1, b1, b0); }
  }
  const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3)); geometry.setIndex(index); geometry.computeVertexNormals();
  return hung(kit, new T.Mesh(geometry, mirror(kit, colour, .3, { flatShading: true })), length * .055, thread);
}

/** A glass fir cone: an ovoid core under overlapping scales on a spiral. `frost` whitens the scale tips. */
export function glassCone(kit, { length = .34, colour = 0xd9a441, frost = 0, thread = .12 } = {}) {
  const { T, C } = kit, body = new T.Group(), radius = length * .34, shape = s => Math.pow(Math.sin(Math.PI * Math.min(1, .08 + s * .92)), .7) * (1 - .3 * s), profile = [];
  for (let i = 0; i <= 24; i++) { const s = 1 - i / 24; profile.push([radius * .8 * shape(s), -s * length]); }
  const base = C(colour), tip = base.clone().lerp(new T.Color(1, 1, 1), frost), deep = base.clone().multiplyScalar(.55);
  body.add(new T.Mesh(turned(kit, profile, 20), mirror(kit, kit.mix(colour, 0x000000, .35), .4)));
  const scale = new T.SphereGeometry(1, 8, 6), p = scale.attributes.position, tones = [];
  for (let i = 0; i < p.count; i++) { const k = Math.min(1, Math.max(0, p.getZ(i) * .5 + .5)), tone = k < .7 ? deep.clone().lerp(base, k / .7) : base.clone().lerp(tip, (k - .7) / .3); tones.push(tone.r, tone.g, tone.b); }
  scale.setAttribute('color', new T.Float32BufferAttribute(tones, 3));
  const count = 58, scales = new T.InstancedMesh(scale, kit.mat({ color: 0xffffff, vertexColors: true, metalness: .9, roughness: .3 }, 1.6), count), o = new T.Object3D();
  for (let i = 0; i < count; i++) {
    const s = (i + .5) / count, angle = i * 2.39996, r = radius * shape(s) * .82, size = radius * (.5 - .2 * s);
    o.position.set(Math.sin(angle) * r, -length * (.04 + s * .9), Math.cos(angle) * r); o.rotation.set(.75 + s * .35, angle, 0, 'YXZ'); o.scale.set(size * .9, size * .34, size * 1.05); o.updateMatrix(); scales.setMatrixAt(i, o.matrix);
  }
  scales.frustumCulled = false; body.add(scales);
  return hung(kit, body, length * .13, thread);
}

/** A pyramid drop: a long four-sided point under a short one, with a faceted bead above. */
export function pyramidDrop(kit, { length = .3, colour = 0x2f5fb8, thread = .14 } = {}) {
  const { T } = kit, body = new T.Group(), half = length * .21, bead = length * .12, top = -bead * 1.7, waist = top - length * .26, position = [0, top, 0], index = [];
  for (let j = 0; j < 4; j++) { const a = j * Math.PI / 2 + Math.PI / 4; position.push(Math.cos(a) * half, waist, Math.sin(a) * half); }
  position.push(0, top - length, 0);
  for (let j = 0; j < 4; j++) index.push(0, 1 + (j + 1) % 4, 1 + j, 5, 1 + j, 1 + (j + 1) % 4);
  const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3)); geometry.setIndex(index); geometry.computeVertexNormals();
  const glass = mirror(kit, colour, .26, { flatShading: true, emissiveIntensity: .3 }), pearl = new T.Mesh(new T.IcosahedronGeometry(bead, 0), mirror(kit, kit.mix(colour, 0xffffff, .55), .26, { flatShading: true })); pearl.position.y = -bead * .9;
  body.add(pearl, new T.Mesh(geometry, glass));
  return hung(kit, body, length * .1, thread);
}

/** The one ball: silver, with a ribbed concave well pressed into its face, the "reflector" of the 1950s and 60s. */
export function reflectorBall(kit, { radius = .2, colour = 0xcfd6e0, well = 0xe58aa6, thread = .12 } = {}) {
  const { T, C } = kit, columns = 64, geometry = new T.SphereGeometry(1, columns, 44); geometry.rotateX(Math.PI / 2);
  const p = geometry.attributes.position, open = .66, rim = Math.cos(open), silver = C(colour), rose = C(well), tones = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), inside = z > rim, theta = Math.acos(Math.min(1, Math.max(-1, z))), k = inside ? theta / open : 1;
    if (inside) p.setZ(i, rim - (z - rim) * .85 - .05 * Math.sin(Math.PI * k) * (.5 + .5 * Math.cos(Math.atan2(y, x) * 14)));
    const tone = inside ? rose.clone().lerp(silver, Math.pow(k, 6)) : silver; tones.push(tone.r, tone.g, tone.b);
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(tones, 3)); resmooth(geometry, columns); geometry.translate(0, -1, 0);
  const body = new T.Mesh(geometry, kit.mat({ color: 0xffffff, vertexColors: true, metalness: .9, roughness: .3 }, 1.6)); body.scale.setScalar(radius);
  return hung(kit, body, radius * .24, thread);
}

/** A clip-on glass bird that stands upright on a bough: its origin is the clip under it; it faces +x. */
export function clipBird(kit, { size = .46, colour = 0xe9eef4, wing = 0x7fc9c0, tail = 0xf4f6fb } = {}) {
  const { T, V } = kit, group = new T.Group(), profile = [];
  // Along the bird from tail to beak: a stub, the full breast, the neck, the head.
  for (let i = 0; i <= 40; i++) { const s = i / 40, breast = .3 * Math.exp(-Math.pow((s - .42) / .24, 2)), head = .2 * Math.exp(-Math.pow((s - .84) / .1, 2)); profile.push([Math.max(.001, (breast + head + .05 * (1 - s)) * Math.min(1, (1 - s) / .05) * Math.min(1, .35 + s / .1)), s]); }
  const glass = kit.mat({ color: colour, metalness: .35, roughness: .3, clearcoat: 1, clearcoatRoughness: .12 }, 1.2), body = new T.Mesh(turned(kit, profile, 28), glass);
  body.rotation.z = -Math.PI / 2; body.position.set(-.5, .46, 0); body.scale.set(1, 1, .82);
  const beak = new T.Mesh(new T.ConeGeometry(.05, .2, 10), kit.gold()); beak.rotation.z = -Math.PI / 2; beak.position.set(.56, .46, 0);
  const painted = kit.mat({ color: wing, roughness: .3, clearcoat: 1, clearcoatRoughness: .15, emissive: wing, emissiveIntensity: .25 }, 1), parts = [body, beak];
  for (const side of [-1, 1]) {
    const feather = new T.Mesh(kit.sphereGeo, painted); feather.scale.set(.25, .12, .05); feather.position.set(-.14, .5, side * .268); feather.rotation.set(0, side * -.12, -.3); parts.push(feather);
    const eye = new T.Mesh(kit.ballGeo, kit.mat({ color: 0x14161c, roughness: .1, clearcoat: 1, see: 0 }, 1)); eye.scale.setScalar(.022); eye.position.set(.39, .53, side * .125); parts.push(eye);
  }
  // The tail: a brush of thin glass-fibre strips, fanned and a little curled.
  const strips = [];
  for (let i = 0; i < 9; i++) {
    const lift = (i - 4) / 4 * .5 + .2, reach = .5 + (i % 3) * .06, points = [];
    for (let j = 0; j <= 8; j++) { const u = j / 8; points.push(V(-.46 - Math.cos(lift) * reach * u, .46 + Math.sin(lift) * reach * u + u * u * .08, (i % 2 ? .012 : -.012) * u * 4)); }
    strips.push(kit.ribbonGeo(points, .03, V(Math.sin(lift), Math.cos(lift), 0)));
  }
  parts.push(new T.Mesh(merged(kit, strips), kit.mat({ color: tail, metalness: .6, roughness: .3, side: T.DoubleSide }, 1.3, false)));
  // The spring clip that holds it on the bough.
  const steel = kit.mat({ color: 0xbfc3c9, metalness: 1, roughness: .3 }, 1.2, false), leg = new T.Mesh(new T.CylinderGeometry(.018, .018, .12, 8), steel), jaw = new T.Mesh(new T.BoxGeometry(.2, .035, .1), steel);
  leg.position.set(-.06, .08, 0); jaw.position.set(-.06, .018, 0); parts.push(leg, jaw);
  group.add(...parts); group.scale.setScalar(size); group.userData.body = body;
  return group;
}

/** Glass beads strung along `points` (a hanging cord): small balls and bugle tubes in turn, mostly silver. */
export function beadThread(kit, points, { colours = [0xcfd6e0, 0xcfd6e0, 0x7fc9c0, 0xcfd6e0, 0xcfd6e0, 0xb5324f], ball = .042, bugle = .12, gap = .014 } = {}) {
  const { T, V, C } = kit, group = new T.Group(), lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
  const total = lengths[lengths.length - 1], at = s => { let i = 1; while (i < lengths.length - 1 && lengths[i] < s) i++; const k = (s - lengths[i - 1]) / Math.max(1e-6, lengths[i] - lengths[i - 1]); return [points[i - 1].clone().lerp(points[i], k), points[i].clone().sub(points[i - 1]).normalize()]; };
  const pieces = []; for (let s = gap, n = 0; s + bugle < total; n++) { const size = n % 2 ? bugle : ball * 2; pieces.push([n % 2, s + size / 2]); s += size + gap; }
  const balls = pieces.filter(([kind]) => !kind), tubes = pieces.filter(([kind]) => kind), glass = () => kit.mat({ color: 0xffffff, metalness: .8, roughness: .34 }, 1.6, false), o = new T.Object3D(), up = V(0, 1, 0);
  const round = new T.InstancedMesh(new T.SphereGeometry(ball, 12, 9), glass(), balls.length), long = new T.InstancedMesh(new T.CylinderGeometry(ball * .52, ball * .52, bugle, 6), glass(), tubes.length);
  [[balls, round], [tubes, long]].forEach(([list, mesh], kind) => {
    list.forEach(([, s], i) => { const [position, tangent] = at(s); o.position.copy(position); o.quaternion.setFromUnitVectors(up, tangent); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix); mesh.setColorAt(i, C(colours[(i * (kind ? 5 : 1) + kind * 2) % colours.length])); });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.frustumCulled = false; group.add(mesh);
  });
  group.add(kit.line(points, 0xd9d2c0, .35));
  return group;
}

/** A wisp of foil "rain": hair-thin metal strips hanging from one point, each with its own slight curl. */
export function foilRain(kit, { strands = 12, length = 1.1, colour = 0xe2e6ee, salt = 0 } = {}) {
  const { T, V, rnd } = kit, strips = [];
  for (let i = 0; i < strands; i++) {
    const reach = length * (.72 + rnd(i, salt + 1) * .28), phase = rnd(i, salt + 2) * 6.3, lean = (rnd(i, salt + 3) - .5) * .16, deep = (rnd(i, salt + 4) - .5) * .12, curl = .012 + rnd(i, salt + 5) * .02, points = [];
    for (let j = 0; j <= 14; j++) { const u = j / 14; points.push(V(lean * u + Math.sin(u * 4 + phase) * curl * u, -u * reach, deep * u + Math.cos(u * 3.3 + phase) * curl * u)); }
    strips.push(kit.ribbonGeo(points, .014, u => V(Math.cos(u * 5 + phase), 0, Math.sin(u * 5 + phase))));
  }
  return new T.Mesh(merged(kit, strips), kit.mat({ color: colour, metalness: 1, roughness: .2, side: T.DoubleSide }, 1.7, false));
}
