// The carollers' Christmas star (#623): hand-made on the hoop of a sieve, the drum closed with
// oiled paper and lit from inside by a candle, eight paper-covered rays with foil edges and small
// tassels, ribbons tied under it, carried on a pole. Also the first star of the evening and the
// snow the pole is planted in. No picture on the drum: a plain rosette, as the plan requires.
import { merged } from './new-year-tree-tubes.js';

/** Colourways of the ray papers: [body, bands...] from the rim to the tip, with foil where a band is 'foil'. */
const PAPERS = [
  ['#d8323e', [0, .07, 'foil'], [.56, .6, 'foil'], [.6, .74, '#3c66cc'], [.74, .78, 'foil']],
  ['#3c66cc', [0, .07, 'foil'], [.3, .34, 'foil'], [.82, 1, 'foil']],
  ['foil', [0, .12, '#d8323e'], [.42, .54, '#3c66cc'], [.86, 1, '#d8323e']],
  ['#d8323e', [0, .07, 'foil'], [.4, .44, 'foil'], [.44, 1, '#3c66cc']],
];
const ORDER = [0, 1, 2, 3, 1, 0, 3, 2];

/**
 * The star. Returns { group, wheel, lamp }: the group's origin is the centre of the drum, which
 * faces +z; `wheel` is the part that turns on its axle; `lamp` is the candle's light.
 */
export function carolStar(kit, { radius = .62, depth = .24, reach = .83, base = .34 } = {}) {
  const { T, V, rnd } = kit, group = new T.Group(), wheel = new T.Group(); group.add(wheel);

  // ---------- the drum: a bent-wood hoop closed by two sheets of oiled paper ----------
  const wood = kit.mat({ color: 0xc9b48a, roughness: .8, side: T.DoubleSide }, .3, false);
  const hoop = new T.Mesh(new T.CylinderGeometry(radius, radius, depth, 56, 1, true), wood); hoop.rotation.x = Math.PI / 2; wheel.add(hoop);
  for (const side of [-1, 1]) { const band = new T.Mesh(new T.TorusGeometry(radius, .02, 8, 64), wood); band.position.z = side * depth / 2; wheel.add(band); }
  const paper = kit.canvasTexture(512, 512, g => {
    const light = g.createRadialGradient(256, 268, 8, 256, 256, 256); light.addColorStop(0, '#fff3cc'); light.addColorStop(.14, '#ffdc8c'); light.addColorStop(.42, '#f9b452'); light.addColorStop(.78, '#e08c34'); light.addColorStop(1, '#a85a1c'); g.fillStyle = light; g.fillRect(0, 0, 512, 512);
    // Mottling and fibres of hand-oiled paper.
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${rnd(i, 1) < .5 ? '255,226,160' : '120,60,14'},${.03 + rnd(i, 2) * .06})`; g.beginPath(); g.arc(rnd(i, 3) * 512, rnd(i, 4) * 512, 8 + rnd(i, 5) * 40, 0, 7); g.fill(); }
    for (let i = 0; i < 90; i++) { const x = rnd(i, 6) * 512, y = rnd(i, 7) * 512, a = rnd(i, 8) * 6.3, l = 20 + rnd(i, 9) * 70; g.strokeStyle = `rgba(120,70,20,${.05 + rnd(i, 10) * .08})`; g.lineWidth = .6 + rnd(i, 11); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    // A plain eight-petal rosette drawn in thin brown line: geometry only.
    g.translate(256, 256); g.strokeStyle = 'rgba(110,50,10,.6)'; g.lineWidth = 3.5;
    for (let i = 0; i < 8; i++) { g.save(); g.rotate(i * Math.PI / 4 + Math.PI / 8); g.beginPath(); g.moveTo(0, -34); g.quadraticCurveTo(56, -118, 0, -196); g.quadraticCurveTo(-56, -118, 0, -34); g.stroke(); g.restore(); }
    g.beginPath(); g.arc(0, 0, 34, 0, 7); g.stroke(); g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 210, 0, 7); g.stroke(); g.beginPath(); g.arc(0, 0, 226, 0, 7); g.stroke();
    for (let i = 0; i < 32; i++) { const a = i * Math.PI / 16; g.fillStyle = 'rgba(110,50,10,.55)'; g.beginPath(); g.arc(Math.cos(a) * 218, Math.sin(a) * 218, 3, 0, 7); g.fill(); }
  }, { anisotropy: 8 });
  // The paper shows only the candle's light coming through it, so it is drawn as its own light: no room light washes it
  // out, and it keeps most of its body (a lit lampshade is not glass).
  const sheet = kit.mat({ color: 0x000000, emissiveMap: paper, emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 1, see: .3 }, 0, false);
  const front = new T.Mesh(new T.CircleGeometry(radius * .99, 56), sheet), back = new T.Mesh(front.geometry, sheet);
  front.position.z = depth / 2 - .004; back.position.z = -depth / 2 + .004; back.rotation.y = Math.PI; wheel.add(front, back);

  // ---------- eight rays: four-sided paper pyramids, no two neighbours in the same paper ----------
  const papers = PAPERS.map(([body, ...bands]) => {
    const fill = (g, value) => { g.fillStyle = value; g.fillRect(0, 0, 32, 256); }, band = (g, from, to, value) => { g.fillStyle = value; g.fillRect(0, 256 * (1 - to), 32, 256 * (to - from)); };
    const map = kit.canvasTexture(32, 256, g => { fill(g, body === 'foil' ? '#f0c860' : body); for (const [from, to, value] of bands) band(g, from, to, value === 'foil' ? '#f0c860' : value); });
    // Green is roughness and blue is metalness: matte paper, bright foil.
    const finish = kit.canvasTexture(32, 256, g => { fill(g, body === 'foil' ? 'rgb(0,70,255)' : 'rgb(0,185,0)'); for (const [from, to, value] of bands) band(g, from, to, value === 'foil' ? 'rgb(0,70,255)' : 'rgb(0,185,0)'); }, { srgb: false });
    // Coloured paper and gold foil that keep their colour in the dark street (#691): they hold light of their own.
    return kit.mat({ map, roughnessMap: finish, metalnessMap: finish, roughness: 1, metalness: 1, flatShading: true, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: .1, own: .5 }, 1, false);
  });
  const spike = new T.ConeGeometry(base / Math.SQRT2, reach, 4, 1); spike.rotateY(Math.PI / 4);
  const strips = [[], []];
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + Math.PI / 2, out = V(Math.cos(a), Math.sin(a), 0), ray = new T.Mesh(spike, papers[ORDER[i]]);
    ray.position.copy(out).multiplyScalar(radius - .03 + reach / 2); ray.rotation.z = a - Math.PI / 2; wheel.add(ray);
    // A tassel of three paper strips at the tip, hanging the way paper hangs.
    const tip = out.clone().multiplyScalar(radius - .03 + reach);
    for (let k = 0; k < 3; k++) {
      const length = .15 + rnd(i * 3 + k, 21) * .1, lean = (k - 1) * .05 + (rnd(i * 3 + k, 22) - .5) * .04, points = [];
      for (let j = 0; j <= 5; j++) { const u = j / 5; points.push(V(tip.x + lean * u + out.x * .03 * (1 - u), tip.y - length * u + out.y * .02 * (1 - u), .01 * (k - 1) + Math.sin(u * 3 + i) * .012)); }
      strips[(i + k) % 2].push(kit.ribbonGeo(points, .028, V(1, 0, .25 * (k - 1)).normalize()));
    }
  }
  wheel.add(new T.Mesh(merged(kit, strips[0]), kit.mat({ color: 0xe2bd62, metalness: 1, roughness: .32, side: T.DoubleSide }, 1.3, false)), new T.Mesh(merged(kit, strips[1]), kit.mat({ color: 0xc0444e, roughness: .7, side: T.DoubleSide }, .4, false)));

  // ---------- the candle inside: its light on the rays, a soft hot spot through the paper, and the glow around the drum ----------
  const lamp = new T.PointLight(0xffb060, 2, 5.5, 2); lamp.position.set(0, 0, .4); group.add(lamp);
  const spot = kit.glow(0xfff0c8, radius * .9, .5, { twinkle: .2 }); spot.position.set(0, -.03, depth / 2 + .02); group.add(spot);
  const halo = kit.glow(0xffa24a, radius * 5.8, .34, { twinkle: .12 }); halo.position.z = -.3; group.add(halo);
  return { group, wheel, lamp };
}

/** Ribbons tied at one point and left to hang in loose curls: `list` is [colour, length] pairs. The origin is the knot. */
export function hangingRibbons(kit, list, { width = .13, salt = 0 } = {}) {
  const { T, V, rnd } = kit, group = new T.Group();
  list.forEach(([colour, length], i) => {
    const drift = (i - (list.length - 1) / 2) * .22 + (rnd(i, salt + 1) - .5) * .1, phase = rnd(i, salt + 2) * 6, curl = .05 + rnd(i, salt + 3) * .05, points = [];
    for (let j = 0; j <= 30; j++) { const u = j / 30; points.push(V(drift * Math.pow(u, .7) + Math.sin(u * 5 + phase) * curl * u, -u * length, Math.cos(u * 4 + phase) * curl * 1.4 * u + i * .02)); }
    group.add(new T.Mesh(kit.ribbonGeo(points, width, u => V(Math.cos(u * 4.2 + phase * .5), 0, Math.sin(u * 4.2 + phase * .5))), kit.satin(colour)));
  });
  const knot = new T.Mesh(kit.sphereGeo, kit.satin(list[0][0])); knot.scale.set(width * .7, width * .5, width * .6); group.add(knot);
  return group;
}

/** The first star of the evening: a small steady glint, four long hairline rays and four short ones. */
export function firstStar(kit, size = .9, colour = 0xeaf2ff) {
  const glint = kit.canvasTexture(256, 256, g => {
    g.translate(128, 128);
    const core = g.createRadialGradient(0, 0, 0, 0, 0, 44); core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(.12, 'rgba(255,255,255,.85)'); core.addColorStop(.4, 'rgba(255,255,255,.16)'); core.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = core; g.fillRect(-128, -128, 256, 256);
    for (let i = 0; i < 8; i++) {
      const length = i % 2 ? 62 : 122, beam = g.createLinearGradient(0, 0, length, 0); beam.addColorStop(0, 'rgba(255,255,255,.95)'); beam.addColorStop(1, 'rgba(255,255,255,0)');
      g.save(); g.rotate(i * Math.PI / 4 + .2); g.fillStyle = beam; g.beginPath(); g.moveTo(0, -(i % 2 ? 1.6 : 2.4)); g.lineTo(length, 0); g.lineTo(0, i % 2 ? 1.6 : 2.4); g.closePath(); g.fill(); g.restore();
    }
  }, { srgb: false });
  return kit.glow(colour, size, 1, { texture: glint, twinkle: 0 });
}

/** A drift of snow lying on y = 0, `width` wide: three soft swells, bluer in its hollows, with a fine sparkle. */
export function snowDrift(kit, { width = 3.4, depth = 1.6, height = .55, salt = 0 } = {}) {
  const { T, C, rnd } = kit, columns = 110, rows = 28, geometry = new T.PlaneGeometry(width, depth, columns, rows); geometry.rotateX(-Math.PI / 2);
  const p = geometry.attributes.position, lit = C(0xdde6f4), shade = C(0x34508c), tones = [];
  // Wind-shaped swells [centre x, centre z, radius, height]: a long back, a steeper shoulder, a low apron in front.
  const swells = [[-.16, -.12, .2, 1], [.2, -.05, .17, .78], [.02, .3, .3, .34], [-.36, .1, .12, .42], [.4, .22, .1, .3]];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / width, z = p.getZ(i) / depth, edge = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x) * 2, 3)), .8) * Math.max(0, 1 - Math.pow(Math.abs(z) * 2, 4));
    let h = 0; for (const [cx, cz, r, k] of swells) { const dx = x - cx + (z - cz) * .25; h = Math.max(h, k * Math.exp(-(dx * dx + (z - cz) * (z - cz) * .45) / (r * r)) + h * .35); }
    // Fine ridges the wind leaves across the crest.
    h = Math.min(1.2, h) * edge * (1 + .05 * Math.sin(x * 23 + z * 9 + salt)) + .022 * Math.sin(x * 58 + z * 21 + Math.sin(x * 9 + salt) * 2.4) * edge * h; p.setY(i, h * height - (1 - edge) * .6);
  }
  // Slopes that face the light are white, slopes that face away are blue: the drift keeps its form at any brightness.
  geometry.computeVertexNormals(); const n = geometry.attributes.normal;
  for (let i = 0; i < p.count; i++) { const tone = shade.clone().lerp(lit, Math.min(1, Math.max(0, .5 + (n.getX(i) * -.9 + n.getZ(i) * .3) * 1.9 - (1 - n.getY(i)) * .7))); tones.push(tone.r, tone.g, tone.b); }
  geometry.setAttribute('color', new T.Float32BufferAttribute(tones, 3));
  const grain = kit.canvasTexture(256, 256, g => { g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 2400; i++) { const v = Math.round(rnd(i, salt + 3) * 255); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rnd(i, salt + 1) * 256, rnd(i, salt + 2) * 256, 2, 2); } }, { srgb: false, repeat: true });
  grain.repeat.set(6, 3);
  return new T.Mesh(geometry, kit.mat({ color: 0xffffff, vertexColors: true, roughness: .9, bumpMap: grain, bumpScale: .01, emissive: 0x4f6fa8, emissiveIntensity: .08 }, .2, false));
}
