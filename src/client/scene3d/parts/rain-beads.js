// Beads of water on the glass (Rain, #617): clear lenses scattered in one top corner, dense at
// the corner and sparse outward, the large ones each a different size. A bead swells, stays
// for minutes and shrinks away; now and then one runs down and leaves a thin wet trail.

/** The plan gives times in real seconds; the scene clock runs at an eighth of real time (README). */
const REAL = 8;

/** `count` beads within `reach` units of the top corner on `side` (-1 left, 1 right). Returns a group. */
export function paneBeads(kit, { count, reach = 3.4, side = -1, seed = 0 }) {
  const { T, V, rnd, view, tick, ctx } = kit, S = ctx.size, group = new T.Group(), Z = .5, cx = side * view.halfWAt(Z), cy = view.halfHAt(Z);
  // A drop on a pane: a sphere pressed to about a third of its depth.
  const lens = new T.SphereGeometry(1, 22, 14); lens.scale(1, 1, .35);
  // Clear water: almost no body of its own, so what shows is the rim and what the lens reflects.
  const waterOf = () => kit.mat({ color: 0x121c26, roughness: .04, metalness: 0, reflectivity: 1, clearcoat: 1, clearcoatRoughness: .02, clear: true }, 2.8), water = waterOf();
  const smooth = k => { const u = Math.min(1, Math.max(0, k)); return u * u * (3 - 2 * u); };

  // Large beads first, so each finds room; nothing smaller than five pixels across, so no bead can pass for a stuck pixel.
  const LARGE = [.2, .15, .125, .175], beads = [], n = Math.round(count);
  for (let i = 0; i < n; i++) {
    const large = i < Math.min(LARGE.length, Math.round(n / 5)), radius = (large ? LARGE[i] : .05 + rnd(i, seed + 1) * .04 + (i % 5 === 4 ? .028 : 0)) * S;
    for (let attempt = 0; attempt < 14; attempt++) {
      const a = (.04 + rnd(i * 17 + attempt, seed + 2) * .92) * Math.PI / 2, d = radius + .22 + Math.pow(rnd(i * 17 + attempt, seed + 3), 1.5) * (reach - radius - .22), x = Math.cos(a) * d, y = Math.sin(a) * d;
      if (beads.some(other => Math.hypot(other.x - x, other.y - y) < other.radius + radius + .14)) continue;
      beads.push({ x, y, radius, tall: large ? 1.14 : 1, life: (180 + rnd(i, seed + 4) * 180) / REAL, offset: rnd(i, seed + 5) * 60 }); break;
    }
  }
  const mesh = new T.InstancedMesh(lens, water, beads.length), matrix = mesh.instanceMatrix.array; mesh.frustumCulled = false; group.add(mesh);
  matrix.fill(0);
  tick(t => {
    for (let i = 0; i < beads.length; i++) {
      // Each life is three to six minutes; it swells in and shrinks away over eight seconds, a little aside from where the last one sat.
      const bead = beads[i], turn = (t + bead.offset) / bead.life, life = Math.floor(turn), age = (turn - life) * bead.life, size = ctx.quiet ? bead.radius : bead.radius * Math.min(smooth(age), smooth(bead.life - age)), o = i * 16;
      // Where this life sits is drawn once per life, not once per frame.
      if (bead.lived !== life) { bead.lived = life; bead.dx = (rnd(i + life * 31, seed + 6) - .5) * .16; bead.dy = (rnd(i + life * 31, seed + 7) - .5) * .16; }
      matrix[o] = size; matrix[o + 5] = size * bead.tall; matrix[o + 10] = size; matrix[o + 15] = 1;
      matrix[o + 12] = cx - side * (bead.x + bead.dx); matrix[o + 13] = cy - bead.y - (bead.tall - 1) * size - bead.dy; matrix[o + 14] = Z;
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  // A faint cool light behind the cluster, the registry's violet: it gives the lenses a rim to catch.
  if (!ctx.quiet) { const rim = kit.glow(0xa890f0, 5.5, .05, { twinkle: .1 }); rim.position.set(cx - side * 1.3, cy - 1.1, -1.5); group.add(rim); }
  if (ctx.quiet) return group;

  // ---------- the runner: one bead at a time slides down a slightly wandering path, pausing on the way ----------
  const DROP = 2.4, SEGMENTS = 44, wander = u => .1 * Math.sin(u * 5.2 + seed) * u + .04 * Math.sin(u * 13 + 1.7) * u;
  const path = new T.CatmullRomCurve3(Array.from({ length: 12 }, (_, i) => V(wander(i / 11), -DROP * i / 11, 0)));
  // The wet trail is a very flat tube, so its two edges catch the light as fine lines.
  const trailGeometry = new T.TubeGeometry(path, SEGMENTS, .028 * S, 6); trailGeometry.scale(1, 1, .3);
  const trail = new T.Mesh(trailGeometry, kit.mat({ color: 0x121c26, roughness: .05, metalness: 0, reflectivity: 1, clearcoat: 1, clearcoatRoughness: .05, opacity: 1, clear: true }, 2));
  const runner = new T.Mesh(lens, waterOf()), run = new T.Group(), at = V(); run.add(trail, runner); group.add(run);
  const PERIOD = 56, SLIDE = 26, DRY = 20;
  let slide = { cycle: -1 };
  tick(t => {
    const real = t * REAL, cycle = Math.floor(real / PERIOD);
    // A run's own numbers (when it starts, where, how long, how big, which way it wanders) are drawn once per run, not once per frame.
    if (slide.cycle !== cycle) { const r = k => rnd(cycle, seed + 20 + k); slide = { cycle, wait: rnd(cycle, seed + 8) * 8, length: .62 + r(1) * .38, radius: (.13 + r(2) * .04) * S, x: cx - side * (.7 + r(3) * 2), y: cy - .35 - r(4) * .5, turn: r(5) < .5 ? -1 : 1 }; }
    const since = real - cycle * PERIOD - slide.wait, x = Math.min(1, Math.max(0, since / SLIDE)), along = x - Math.sin(x * 6 * Math.PI) / (6 * Math.PI) * .95;
    run.visible = since > 0 && since < SLIDE + DRY; if (!run.visible) return;
    run.position.set(slide.x, slide.y, Z); run.scale.x = slide.turn; trail.scale.y = slide.length;
    path.getPointAt(along, at); runner.position.set(at.x, at.y * slide.length, .01);
    // The bead swells at the top, runs, and thins away at the bottom; the trail it left dries over twenty seconds.
    const size = slide.radius * smooth(since / 3) * (1 - smooth((since - SLIDE - 2) / 6)); runner.scale.set(size, size * 1.16, size);
    trailGeometry.setDrawRange(0, Math.floor(along * SEGMENTS) * 36); trail.material.opacity = 1 - smooth((since - SLIDE) / DRY);
  });
  return group;
}
