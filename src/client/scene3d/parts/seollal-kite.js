// Korean kites for Seollal (#628). The bangpae-yeon (방패연, shield kite) is a rectangle of hanji
// with a round hole a third of its length across, five bamboo spars with none along the foot,
// bowed by a string behind the head, and no tail. Its lower half is washed indigo: a chima-yeon,
// a kite "wearing a skirt". The gaori-yeon (가오리연, ray kite) is the small diamond with a tail.
// No lettering and no red disc on either. See ../README.md.
import { hanjiFibres } from './seollal-hanji.js';

const HANJI = '#f2ead8', BAMBOO = 0xb89a5a, THREAD = 0xe8e0cc;

/** The shield kite, 2.2 x 3 times `scale`, facing +z with its head up. The group's origin is the
 * centre of the hole; `userData.tow` is the point in front where the bridle meets the flying line. */
export function shieldKite(kit, { scale = 1, indigo = [47, 95, 168] } = {}) {
  const { T, V, rnd, tick, canvasTexture, mat, line } = kit, group = new T.Group();
  const w = 2.2 * scale, h = 3 * scale, hw = w / 2, hh = h / 2, PX = 512, PY = 704;
  // The paper is bowed toward the viewer by the head spar's string, and less and less toward the unsupported foot.
  const bow = (x, y) => .24 * scale * (1 - (x / hw) ** 2) * (.35 + .65 * (y + hh) / h);
  const hole = g => { g.beginPath(); g.ellipse(PX / 2, PY / 2, PX * (h / 6) / w, PY / 6, 0, 0, 7); };
  const ink = alpha => `rgba(${indigo.join(',')},${alpha})`;

  const map = canvasTexture(PX, PY, g => {
    g.fillStyle = HANJI; g.fillRect(0, 0, PX, PY);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(${rnd(i, 3) < .5 ? '255,251,238' : '196,178,140'},${(.03 + rnd(i, 4) * .05).toFixed(3)})`; g.beginPath(); g.arc(rnd(i, 5) * PX, rnd(i, 6) * PY, 20 + rnd(i, 7) * 60, 0, 7); g.fill(); }
    // The skirt: indigo laid on from the waist down with a wide brush, uneven along its upper edge.
    const waist = PY * .5;
    g.save(); g.beginPath(); g.moveTo(0, PY); g.lineTo(0, waist);
    for (let x = 0; x <= PX; x += 8) g.lineTo(x, waist + Math.sin(x * .045) * 5 + Math.sin(x * .19) * 2 + (rnd(x, 11) - .5) * 9);
    g.lineTo(PX, PY); g.closePath(); g.clip();
    const wash = g.createLinearGradient(0, waist, 0, PY); wash.addColorStop(0, ink(.84)); wash.addColorStop(.5, ink(.95)); wash.addColorStop(1, ink(1)); g.fillStyle = wash; g.fillRect(0, waist - 24, PX, PY);
    // Brush streaks: paler where the brush ran dry, deeper where the pigment pooled.
    for (let i = 0; i < 110; i++) {
      const y = waist + rnd(i, 21) * (PY - waist), x = rnd(i, 22) * PX, length = 60 + rnd(i, 23) * 260;
      g.strokeStyle = rnd(i, 24) < .45 ? `rgba(132,176,232,${(.05 + rnd(i, 25) * .12).toFixed(3)})` : `rgba(18,42,104,${(.06 + rnd(i, 25) * .14).toFixed(3)})`; g.lineWidth = 2 + rnd(i, 26) * 9;
      g.beginPath(); g.moveTo(x - length / 2, y); g.lineTo(x + length / 2, y + (rnd(i, 27) - .5) * 6); g.stroke();
    }
    g.restore();
    hanjiFibres(kit, g, PX, PY, { count: 280, salt: 31 });
    hanjiFibres(kit, g, PX, PY, { count: 170, salt: 71, ink: '255,252,240', strength: .2 });
    // The hem, where the paper is folded over the frame string, and the turned edge of the hole.
    g.strokeStyle = 'rgba(120,100,70,.2)'; g.lineWidth = 12; g.strokeRect(6, 6, PX - 12, PY - 12);
    g.strokeStyle = 'rgba(255,250,236,.35)'; g.lineWidth = 7; hole(g); g.stroke();
  }, { anisotropy: 8 });
  const alpha = canvasTexture(PX, PY, g => { g.fillStyle = '#fff'; g.fillRect(0, 0, PX, PY); g.fillStyle = '#000'; hole(g); g.fill(); }, { srgb: false });
  const bump = canvasTexture(PX, PY, g => { g.fillStyle = '#808080'; g.fillRect(0, 0, PX, PY); hanjiFibres(kit, g, PX, PY, { count: 280, salt: 31, ink: '255,255,255', strength: .7 }); }, { srgb: false });

  // The frame first, so it is drawn before the paper and shows through it and through the hole:
  // head spar (the thickest), waist spar (the thinnest), the upright centre spar and two diagonals.
  const bamboo = mat({ color: BAMBOO, roughness: .45, clearcoat: .35, clearcoatRoughness: .4 }, .7);
  const spar = (from, to, radius) => {
    const points = []; for (let i = 0; i <= 12; i++) { const x = from[0] + (to[0] - from[0]) * i / 12, y = from[1] + (to[1] - from[1]) * i / 12; points.push(V(x, y, bow(x, y) - radius - .008 * scale)); }
    return new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), 24, radius, 6), bamboo);
  };
  const head = hh - .025 * scale;
  group.add(spar([-hw, head], [hw, head], .021 * scale), spar([-hw, 0], [hw, 0], .011 * scale), spar([0, hh], [0, -hh], .014 * scale), spar([-hw, hh], [hw, -hh], .014 * scale), spar([hw, hh], [-hw, -hh], .014 * scale));
  // The bow strings are straight chords behind the bowed head and waist spars.
  for (const y of [head, 0]) group.add(line([V(-hw, y, -.03 * scale), V(hw, y, -.03 * scale)], THREAD, .4));

  const geometry = new T.PlaneGeometry(w, h, 24, 32), p = geometry.attributes.position, rest = p.array.slice();
  const paper = new T.Mesh(geometry, mat({ map, alphaMap: alpha, alphaTest: .5, bumpMap: bump, bumpScale: .012, roughness: .9, side: T.DoubleSide, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: .42, see: .3 }, .3, false));
  group.add(paper);
  // The foot has no spar: between the ends of the diagonals and the centre spar the paper ripples.
  tick(t => {
    for (let i = 0; i < p.count; i++) { const x = rest[i * 3], y = rest[i * 3 + 1], low = Math.max(0, -y / hh); p.setZ(i, bow(x, y) + .05 * scale * low * low * Math.abs(Math.sin(Math.PI * x / hw)) * Math.sin(x * 4.2 / scale - t * 2.4)); }
    p.needsUpdate = true; geometry.computeVertexNormals();
  });

  // The bridle: threads from the two head corners, the centre and the foot meet in front of the kite.
  const tow = V(0, .28 * scale, .9 * scale);
  for (const from of [V(-hw, hh, 0), V(hw, hh, 0), V(0, 0, bow(0, 0)), V(0, -hh, bow(0, -hh))]) group.add(line([from, tow], THREAD, .5));
  group.userData.tow = tow;
  return group;
}

/** The ray kite: a small diamond of plain hanji on two sticks, with a red and a yellow paper tail
 * that wave. About 0.84 x 1 times `scale`; the origin is its centre. */
export function rayKite(kit, { scale = 1, tails = [[0xd8433b, 1.8, 0], [0xf5cf52, 1.35, 1.7]] } = {}) {
  const { T, V, tick, mat, line } = kit, group = new T.Group();
  const outline = new T.Shape(); outline.moveTo(0, .5); outline.lineTo(.42, .08); outline.lineTo(0, -.5); outline.lineTo(-.42, .08); outline.closePath();
  const paper = new T.Mesh(new T.ShapeGeometry(outline), mat({ color: HANJI, roughness: .9, side: T.DoubleSide, emissive: HANJI, emissiveIntensity: .25, see: .5 }, .3, false)); paper.scale.setScalar(scale);
  group.add(line([V(0, .5, -.01), V(0, -.5, -.01)].map(v => v.multiplyScalar(scale)), BAMBOO, .8), line([V(-.42, .08, -.01), V(0, .15, -.05), V(.42, .08, -.01)].map(v => v.multiplyScalar(scale)), BAMBOO, .8), paper);
  for (const [colour, length, phase] of tails) {
    const n = 24, position = new Float32Array((n + 1) * 6), index = [], geometry = new T.BufferGeometry();
    for (let i = 0; i < n; i++) { const k = i * 2; index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    geometry.setAttribute('position', new T.BufferAttribute(position, 3)); geometry.setIndex(index);
    const tail = new T.Mesh(geometry, mat({ color: colour, roughness: .8, side: T.DoubleSide, emissive: colour, emissiveIntensity: .2 }, .3, false)); tail.frustumCulled = false; group.add(tail);
    tick(t => {
      for (let i = 0; i <= n; i++) {
        const u = i / n, x = (phase ? .03 : -.03) + Math.sin(u * 7 - t * 2.6 + phase) * .1 * u, y = -.5 - u * length, z = Math.cos(u * 5 - t * 2.1 + phase) * .06 * u;
        position.set([(x - .035) * scale, y * scale, z * scale, (x + .035) * scale, y * scale, z * scale], i * 6);
      }
      geometry.attributes.position.needsUpdate = true; geometry.computeVertexNormals();
    });
  }
  return group;
}
