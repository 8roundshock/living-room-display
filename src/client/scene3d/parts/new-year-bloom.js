// Long-exposure firework blooms of the New Year scene (#610): fine curved trails of light held
// almost still, as in a night photograph. A bloom opens slowly, holds, lets its tips sink and
// fade, rests, and reopens a little to one side with new trails. There is no flash. One line
// mesh for the trails, one point cloud for their tips. See ../README.md, "Shared parts".

/** Scene-clock seconds of one cycle: opening, holding, fading, resting (about two minutes on the wall clock). */
const OPEN = 2.5, HOLD = 8.5, FADE = 3, REST = 1, CYCLE = OPEN + HOLD + FADE + REST, SAMPLES = 14;

/** How each kind of burst throws its trails: `aim(i, n, r)` gives a trail's direction (r(k) is a
 * stable random number), `reach` its length as a share of the radius, `droop` how far its end
 * hangs below a straight line, `drag` how soon it slows, `strands` parallel lines per trail. */
const KINDS = {
  /** A full sphere of even trails. */
  chrysanthemum: { strands: 1, drag: 2.4, aim: (i, n, r) => { const y = 1 - 2 * (i + .5) / n, flat = Math.sqrt(1 - y * y), a = i * 2.39996 + r(1) * .5; return [Math.cos(a) * flat, y, Math.sin(a) * flat]; }, reach: r => .82 + r(2) * .18, droop: () => .1 },
  /** Fewer, longer trails thrown up and out that hang down like willow boughs. */
  willow: { strands: 1, drag: 1.5, aim: (i, n, r) => { const y = .15 + .8 * r(3), flat = Math.sqrt(1 - y * y), a = i * 2.39996 + r(1) * .6; return [Math.cos(a) * flat, y, Math.sin(a) * flat * .7]; }, reach: r => .62 + r(2) * .3, droop: r => 1.25 + r(4) * .5 },
  /** A few thick fronds, each three lines side by side, arching out of a narrow fan. */
  palm: { strands: 3, drag: 1.9, aim: (i, n, r) => { const a = Math.PI * (.12 + .76 * (i + .5 + (r(1) - .5) * .5) / n), tilt = (r(3) - .5) * .7; return [Math.cos(a) * Math.cos(tilt), Math.sin(a) * .9 + .25, Math.sin(tilt)]; }, reach: r => .85 + r(2) * .2, droop: r => .5 + r(4) * .2 },
};

/** One bloom. `centre` is where it opens, `radius` its size, `trails` how many trails, `from`
 * and `to` the colour of a trail's body and of its tip, `offset` shifts its cycle so blooms take
 * turns, `wander` is how far a reopening may move, `floor` the y of the bottom edge at that
 * depth, where its faint rising streak starts. The caller leaves blooms out on a quiet date. */
export function bloom(kit, { kind = 'chrysanthemum', centre, radius = 1.9, trails = 110, from = 0xf6cf4e, to = 0xffffff, offset = 0, wander = .6, floor = -4.5, strength = 1, salt = 0 } = {}) {
  const { T, V, C, rnd, tick } = kit, group = new T.Group(), how = KINDS[kind] ?? KINDS.chrysanthemum, count = Math.max(1, Math.round(trails)) * how.strands;
  const perTrail = (SAMPLES - 1) * 2, rest = new Float32Array(count * SAMPLES * 3), position = new Float32Array(count * perTrail * 3), colour = new Float32Array(count * perTrail * 3);
  const tipPosition = new Float32Array(count * 3), tipColour = new Float32Array(count * 3), body = C(from).multiplyScalar(strength), end = C(to).multiplyScalar(strength), shade = new T.Color();
  const lines = new T.BufferGeometry(); lines.setAttribute('position', new T.BufferAttribute(position, 3)); lines.setAttribute('color', new T.BufferAttribute(colour, 3));
  const tips = new T.BufferGeometry(); tips.setAttribute('position', new T.BufferAttribute(tipPosition, 3)); tips.setAttribute('color', new T.BufferAttribute(tipColour, 3));
  const trailsMesh = new T.LineSegments(lines, new T.LineBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
  const tipsMesh = new T.Points(tips, new T.PointsMaterial({ map: kit.tex.glow(), size: .13 * radius / 1.9 + .05, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
  trailsMesh.frustumCulled = tipsMesh.frustumCulled = false;
  const heart = kit.glow(from, radius * 1.5, 0, { twinkle: 0 }), streak = kit.line([V(), V()], from, .06);
  group.add(streak, trailsMesh, tipsMesh, heart);

  const at = V();
  /** Lay out the trails of opening number `turn` around a centre that has wandered a little. */
  function throwTrails(turn) {
    at.copy(centre).add(V((rnd(turn, salt + 31) - .5) * 2 * wander, (rnd(turn, salt + 32) - .5) * wander, 0));
    const single = count / how.strands;
    for (let i = 0; i < count; i++) {
      const trail = Math.floor(i / how.strands), strand = i % how.strands, r = k => rnd(trail + turn * 977, salt + k), [dx, dy, dz] = how.aim(trail, single, r);
      const length = radius * how.reach(r), hang = radius * how.droop(r), aside = (strand - (how.strands - 1) / 2) * .035 * radius;
      for (let k = 0; k < SAMPLES; k++) {
        const s = k / (SAMPLES - 1), out = (1 - Math.exp(-how.drag * s)) / (1 - Math.exp(-how.drag)) * length, j = (i * SAMPLES + k) * 3;
        rest[j] = at.x + dx * out - dy * aside; rest[j + 1] = at.y + dy * out + dx * aside - hang * s * s; rest[j + 2] = at.z + dz * out;
      }
    }
    heart.position.copy(at);
    const start = V(at.x + (at.x < 0 ? -.5 : .5), floor - .3, at.z), points = new T.QuadraticBezierCurve3(start, V(at.x + (at.x < 0 ? -.08 : .08), (floor + at.y) / 2, at.z), at.clone()).getPoints(16);
    streak.geometry.dispose(); streak.geometry = new T.BufferGeometry().setFromPoints(points);
  }
  /** Write the trails as they look when `reveal` of each is drawn, at brightness `level`, their ends sunk by `sink`. */
  let drawn = '';
  function expose(reveal, level, sink, time) {
    // While a bloom holds, its trails do not change: only the tips are rewritten.
    const state = `${reveal}|${level}|${sink}`, same = state === drawn; drawn = state;
    let v = 0;
    for (let i = 0; i < count; i++) {
      if (!same) for (let k = 0; k < SAMPLES - 1; k++) for (const sample of [k, k + 1]) {
        const s = sample / (SAMPLES - 1), j = (i * SAMPLES + sample) * 3;
        // Nothing at the centre, full by two thirds of the way, white-hot at the tip; only the revealed part is lit.
        const lit = Math.min(1, Math.max(0, (s - .05) / .6)) * Math.min(1, Math.max(0, (reveal * 1.1 - s) / .1)) * level * (.75 + .5 * s);
        shade.copy(body).lerp(end, s * s * s);
        position[v] = rest[j]; position[v + 1] = rest[j + 1] - sink * s * s; position[v + 2] = rest[j + 2];
        colour[v] = shade.r * lit; colour[v + 1] = shade.g * lit; colour[v + 2] = shade.b * lit; v += 3;
      }
      // The tip rides the head of the trail while it opens, then rests at its end and shimmers very slowly.
      const head = Math.min(1, reveal) * (SAMPLES - 1), low = Math.min(SAMPLES - 2, Math.floor(head)), mix = head - low, a = (i * SAMPLES + low) * 3, glint = level * (.7 + .3 * Math.sin(time * 1.9 + i * 2.4));
      const s = head / (SAMPLES - 1);
      tipPosition[i * 3] = rest[a] + (rest[a + 3] - rest[a]) * mix; tipPosition[i * 3 + 1] = rest[a + 1] + (rest[a + 4] - rest[a + 1]) * mix - sink * s * s; tipPosition[i * 3 + 2] = rest[a + 2] + (rest[a + 5] - rest[a + 2]) * mix;
      tipColour[i * 3] = end.r * glint; tipColour[i * 3 + 1] = end.g * glint; tipColour[i * 3 + 2] = end.b * glint;
    }
    if (!same) lines.attributes.position.needsUpdate = lines.attributes.color.needsUpdate = true;
    tips.attributes.position.needsUpdate = tips.attributes.color.needsUpdate = true;
    heart.userData.o = .1 * strength * level * Math.min(1, reveal * 2);
  }

  let shown = null;
  tick(t => {
    const clock = t - offset + CYCLE * 64, turn = Math.floor(clock / CYCLE), tau = clock - turn * CYCLE;
    if (turn !== shown) { throwTrails(turn); shown = turn; drawn = ''; }
    const ease = x => x * x * (3 - 2 * x), fading = Math.min(1, Math.max(0, (tau - OPEN - HOLD) / FADE));
    expose(tau < OPEN ? ease(tau / OPEN) : 1, tau >= OPEN + HOLD + FADE ? 0 : 1 - ease(fading), radius * .3 * fading * fading, t);
    streak.material.opacity = .06 * (tau >= OPEN + HOLD + FADE ? 0 : 1 - fading);
  });
  return group;
}
