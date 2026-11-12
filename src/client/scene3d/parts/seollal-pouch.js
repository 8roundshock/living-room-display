// Bokjumeoni (복주머니), the silk lucky pouches given at the New Year (#628), in their two
// traditional shapes: the round, pleated duru-jumeoni and the angular, eared gwi-jumeoni. Each
// hangs on its own two-colour cord and ends in knots and tassels. The round one carries a small
// chrysanthemum spray in gold thread; neither carries a character. See ../README.md.
import { cordMaterial, smooth } from './seollal-forms.js';

const GOLD_THREAD = '#e6c670', GOLD_DEEP = '#b98f3c';

/** A silk tassel hanging from the group's origin: a wrapped head over a skirt of threads. */
function tassel(kit, { head, skirt, length = .34 }) {
  const { T, mat, canvasTexture } = kit, group = new T.Group(), css = colour => `#${new T.Color(colour).getHexString()}`;
  const threads = canvasTexture(64, 128, g => { g.fillStyle = css(skirt); g.fillRect(0, 0, 64, 128); for (let x = 0; x < 64; x += 2) { g.fillStyle = `rgba(${x % 4 ? '255,255,255' : '0,0,0'},${x % 3 ? .1 : .2})`; g.fillRect(x, 0, 1, 128); } });
  // The lower edge is cut threads, not a hem.
  const fringe = canvasTexture(64, 128, g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 128); g.fillStyle = '#000'; for (let x = 0; x < 64; x += 4) g.fillRect(x, 128 - 8 - (x * 7 % 13), 2, 30); }, { srgb: false });
  const body = new T.Mesh(new T.CylinderGeometry(.03, .052, length, 16, 1, true), mat({ map: threads, alphaMap: fringe, alphaTest: .5, roughness: .5, metalness: .15, side: T.DoubleSide }, .7, false)); body.position.y = -.085 - length / 2;
  const knob = new T.Mesh(kit.sphereGeo, kit.satin(head)); knob.scale.set(.036, .046, .036); knob.position.y = -.05;
  const wrap = new T.Mesh(new T.CylinderGeometry(.031, .031, .03, 16), kit.gold()); wrap.position.y = -.095;
  group.add(kit.line([kit.V(), kit.V(0, -.02, 0)], head, .9), knob, wrap, body);
  return group;
}

/** A small decorative knot: three loops of cord around a bead. */
function knot(kit, material, radius = .045) {
  const { T } = kit, group = new T.Group(), loop = new T.TorusGeometry(radius * .62, radius * .26, 8, 18);
  for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + i * 2.094, mesh = new T.Mesh(loop, material); mesh.position.set(Math.cos(a) * radius * .7, Math.sin(a) * radius * .7, 0); group.add(mesh); }
  const bead = new T.Mesh(kit.ballGeo, material); bead.scale.setScalar(radius * .42); group.add(bead);
  return group;
}

/** Silk for a pouch: fine warp lines over the ground colour, and whatever `motif(g, raised)` works into it.
 * Returns one material for each of `sides`, sharing the same cloth. */
function silk(kit, colour, motif, sides = [kit.T.DoubleSide]) {
  const { T, rnd, canvasTexture, mat } = kit, css = `#${new T.Color(colour).getHexString()}`;
  const warp = (g, raised) => { for (let x = 0; x < 512; x += 2) { g.fillStyle = raised ? `rgba(255,255,255,${(.03 + rnd(x, 3) * .05).toFixed(3)})` : `rgba(${rnd(x, 4) < .5 ? '255,235,220' : '30,0,10'},${(.03 + rnd(x, 5) * .06).toFixed(3)})`; g.fillRect(x, 0, 1, 512); } };
  const map = canvasTexture(512, 512, g => { g.fillStyle = css; g.fillRect(0, 0, 512, 512); warp(g, false); motif?.(g, false); }, { anisotropy: 8 });
  const bump = canvasTexture(512, 512, g => { g.fillStyle = '#707070'; g.fillRect(0, 0, 512, 512); warp(g, true); motif?.(g, true); }, { srgb: false });
  return sides.map(side => mat({ map, bumpMap: bump, bumpScale: .02, metalness: .25, roughness: .34, clearcoat: .6, clearcoatRoughness: .3, side, see: .75 }, 1));
}

/** A chrysanthemum spray in satin stitch: a flower of narrow petals, a bud and three leaves on a bent stem. */
function chrysanthemum(g, raised) {
  const bright = raised ? '#ffffff' : GOLD_THREAD, deep = raised ? '#d0d0d0' : GOLD_DEEP, edge = raised ? 'rgba(0,0,0,.35)' : 'rgba(110,70,10,.55)';
  const petal = (x, y, angle, length, width, fill) => { g.save(); g.translate(x, y); g.rotate(angle); g.fillStyle = fill; g.strokeStyle = edge; g.lineWidth = .9; g.beginPath(); g.ellipse(length * .56, 0, length * .5, width, 0, 0, 7); g.fill(); g.stroke(); g.restore(); };
  g.lineCap = 'round'; g.strokeStyle = deep;
  g.lineWidth = 3.4; g.beginPath(); g.moveTo(-40, 74); g.bezierCurveTo(-12, 50, 16, 36, 4, -4); g.stroke();
  g.lineWidth = 2.6; g.beginPath(); g.moveTo(-10, 46); g.quadraticCurveTo(26, 40, 40, 16); g.stroke();
  for (const [x, y, angle, length] of [[-22, 60, -2.7, 26], [8, 36, -.25, 24], [-26, 40, 2.5, 18]]) for (const [turn, k] of [[0, 1], [.75, .62], [-.75, .62]]) petal(x, y, angle + turn, length * k, length * k * .24, deep);
  for (let i = 0; i < 5; i++) petal(40, 16, -1.15 + (i - 2) * .34, 15, 3.6, bright);
  for (let i = 0; i < 18; i++) petal(4, -26, i / 18 * 6.283, 27, 3.8, i % 2 ? bright : deep);
  for (let i = 0; i < 11; i++) petal(4, -26, i / 11 * 6.283 + .3, 16, 3.4, bright);
  g.fillStyle = deep; g.beginPath(); g.arc(4, -26, 5, 0, 7); g.fill();
}

/** Hang a pouch body under the group's origin on a cord `drop` long, and let it swing and turn a little. */
function hung(kit, body, { size, drop, cord, lean, phase, mouth, tassels, weather }) {
  const { T, V, tick } = kit, group = new T.Group(), length = drop / size;
  // Two strands leave the mouth, meet in a knot, and one cord runs up to the hook.
  for (const side of [-1, 1]) body.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([V(side * mouth[0], mouth[1], 0), V(side * mouth[0] * .86, mouth[1] + .2, .01), V(side * mouth[0] * .25, mouth[1] + .44, 0), V(0, mouth[1] + .56, 0)]), 20, .014, 6), cord));
  const join = knot(kit, cord); join.position.set(0, mouth[1] + .58, 0);
  const rope = new T.Mesh(new T.TubeGeometry(new T.LineCurve3(V(0, mouth[1] + .6, 0), V(0, length, 0)), 8, .014, 6), cordMaterial(kit, ...cord.userData.pair, Math.round(length * 9)));
  body.add(join, rope); body.scale.setScalar(size); body.position.y = -drop; group.add(body);
  tick(t => {
    // `weather` (parts/wind-underneath.js, #646): in the wind the pouch leans left on its cord and swings and turns twice as far.
    const calm = Math.sin(t * 3.6 + phase) * .026, sway = weather ? weather.wind.sway : 1;
    group.rotation.z = lean + (weather ? weather.sway(calm, -1) : calm); body.rotation.y = Math.sin(t * 2.3 + phase) * .14 * sway;
    // The tassels follow a quarter of a swing behind.
    for (const item of tassels) item.rotation.z = item.userData.rest + Math.sin(t * 3.6 + phase - 1.57) * .06 * sway;
  });
  return group;
}

const pairOf = (kit, [first, second], turns) => { const material = cordMaterial(kit, first, second, turns); material.userData.pair = [first, second]; return material; };

/** The round pouch (duru-jumeoni): a pleated neck and frill over a round belly, about 1 x 1 times `size`.
 * The group's origin is the hook it hangs from; its belly hangs `drop` below. */
export function roundPouch(kit, { size = 1, drop = 2.5, colour = 0xd8433b, cord = [0xf5cf52, 0x5fbfa0], lean = 0, phase = 0, weather = null } = {}) {
  const { T } = kit, body = new T.Group();
  const profile = new T.SplineCurve([[.001, -.5], [.2, -.485], [.39, -.39], [.49, -.2], [.47, 0], [.36, .14], [.2, .225], [.135, .275], [.15, .32], [.23, .39], [.31, .5]].map(([x, y]) => new T.Vector2(x, y))).getSpacedPoints(56);
  // The seam of the lathe is turned to the back; the embroidered front is the middle of the texture.
  const geometry = new T.LatheGeometry(profile, 108, Math.PI), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), around = Math.atan2(x, z);
    // Nine pleats pressed into the neck by the drawstring; they open into the frill above it and die away in the belly.
    const k = 1 + smooth(y, -.04, .26) * (.1 + .17 * smooth(y, .27, .5)) * Math.cos(around * 9 + .4);
    p.setXYZ(i, x * k, y, z * k * .55);
  }
  geometry.computeVertexNormals();
  // The texture runs once around the pouch and once up its profile, so the spray is drawn narrower than it is tall.
  // The pouch is see-through and closed, so its far wall is drawn first and its near wall over it.
  const cloth = silk(kit, colour, (g, raised) => { g.save(); g.translate(256, 330); g.scale(.82, 1.5); chrysanthemum(g, raised); g.restore(); }, [T.BackSide, T.FrontSide]);
  const string = pairOf(kit, cord, 14), drawstring = new T.Mesh(new T.TorusGeometry(.152, .02, 8, 44), string); drawstring.rotation.x = Math.PI / 2; drawstring.scale.set(1, .6, 1); drawstring.position.y = .275;
  body.add(...cloth.map(material => new T.Mesh(geometry, material)), drawstring);
  // A knot and a tassel lie on each shoulder.
  const tassels = [-1, 1].map(side => {
    const tie = knot(kit, string, .04); tie.position.set(side * .2, .25, .07);
    const item = tassel(kit, { head: cord[0], skirt: side < 0 ? cord[1] : cord[0], length: side < 0 ? .3 : .36 }); item.position.set(side * .23, .22, .12); item.userData.rest = side * .62; item.rotation.x = -.25;
    body.add(tie, item); return item;
  });
  return hung(kit, body, { size, drop, cord: string, lean, phase, mouth: [.15, .29], tassels, weather });
}

/** The eared pouch (gwi-jumeoni): a flat pouch with a pointed ear at each lower corner and a
 * folded mouth, about 1 x 0.95 times `size`. Plain silk. The origin is the hook it hangs from. */
export function earedPouch(kit, { size = 1, drop = 3.5, colour = 0x5fbfa0, cord = [0xd8433b, 0xf5cf52], lean = 0, phase = 0, weather = null } = {}) {
  const { T } = kit, body = new T.Group();
  const outline = new T.Shape(); outline.moveTo(-.2, .46); outline.lineTo(.2, .46); outline.bezierCurveTo(.2, .16, .3, -.1, .53, -.36); outline.quadraticCurveTo(0, -.5, -.53, -.36); outline.bezierCurveTo(-.3, -.1, -.2, .16, -.2, .46);
  const edge = outline.getPoints(40);
  /** How far the outline is from the centre in a direction. */
  const reach = angle => {
    const dx = Math.cos(angle), dy = Math.sin(angle); let best = 0;
    for (let i = 0; i < edge.length; i++) { const a = edge[i], b = edge[(i + 1) % edge.length], ex = b.x - a.x, ey = b.y - a.y, den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) continue; const t = (a.x * ey - a.y * ex) / den, s = (a.x * dy - a.y * dx) / den; if (t > 0 && s >= 0 && s <= 1) best = Math.max(best, t); }
    return best;
  };
  // A sphere pressed flat and drawn out to the outline: a full middle and a soft rolled edge.
  const geometry = new T.SphereGeometry(1, 160, 30); geometry.rotateX(Math.PI / 2);
  const p = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), rho = Math.pow(Math.hypot(x, y), .72), angle = Math.atan2(y, x), r = reach(angle) * rho, nx = Math.cos(angle) * r, ny = Math.sin(angle) * r;
    // Three folds at the mouth, where the cloth is pleated toward the middle.
    p.setXYZ(i, nx, ny, z * .13 + Math.sign(z) * .05 * smooth(ny, -.05, .42) * Math.cos(nx * 47) * (1 - rho * .5)); uv.setXY(i, nx + .5, ny + .5);
  }
  geometry.computeVertexNormals();
  // Plain silk, with the creases that fan down from the folded mouth.
  const [cloth] = creasedSilk(kit, colour);
  const string = pairOf(kit, cord, 12), band = new T.Mesh(new T.TorusGeometry(1, .09, 8, 44), string); band.rotation.x = Math.PI / 2; band.scale.set(.212, .12, .24); band.position.y = .3;
  const tie = knot(kit, string, .05); tie.position.set(0, .3, .13);
  const item = tassel(kit, { head: cord[1], skirt: cord[0], length: .4 }); item.position.set(0, .27, .15); item.userData.rest = 0;
  body.add(new T.Mesh(geometry, cloth), band, tie, item);
  return hung(kit, body, { size, drop, cord: string, lean, phase, mouth: [.13, .44], tassels: [item], weather });
}

/** Plain silk whose only marks are the creases that fan down from a folded mouth at the top of the texture. */
function creasedSilk(kit, colour) {
  const { rnd } = kit;
  return silk(kit, colour, (g, raised) => {
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const x = 256 + (i - 4) * 21, spread = (i - 4) * 46 + (rnd(i, 61) - .5) * 20, length = 190 + rnd(i, 62) * 120;
      g.strokeStyle = raised ? `rgba(${i % 2 ? '255,255,255' : '0,0,0'},.3)` : `rgba(${i % 2 ? '255,255,255' : '0,30,20'},.14)`; g.lineWidth = 3 + rnd(i, 63) * 3;
      g.beginPath(); g.moveTo(x, 26); g.quadraticCurveTo(x + spread * .3, 26 + length * .5, x + spread, 26 + length); g.stroke();
    }
  });
}
