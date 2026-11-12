// Fir, ornaments and snow: needles as one instanced mesh, twigs and boughs, hanging ornaments
// in several shapes and finishes, falling snow points, soft light discs.
// Ported from the owner-approved scene style picker (2026-11-10, #600). See ../README.md.

export function createFir(core) {
  const { T, V, C, rnd, own, tick, mat, gold, glow, line, tex, ctx, canvasTexture, patternTex, sphereGeo } = core;
  // A needle is one or two pixels wide: three open sides are enough, and a third of the picker's triangles.
  const needleGeo = own(new T.ConeGeometry(.0125, 1, 3, 1, true));
  const q = new T.Quaternion(), up = V(0, 1, 0), at = V(), scale = V(), matrix = new T.Matrix4();

  /** A collector of fir needles. Add needles (through twig and bough), then call mesh() once. */
  function needles() {
    let capacity = 8192, count = 0, matrices = new Float32Array(capacity * 16), colours = new Float32Array(capacity * 3);
    return {
      get count() { return count; },
      /** One needle from `position` along the unit vector `direction`; r, g, b are linear colour. */
      add(position, direction, length, r, g, b) {
        if (count === capacity) { capacity *= 2; const m = new Float32Array(capacity * 16), c = new Float32Array(capacity * 3); m.set(matrices); c.set(colours); matrices = m; colours = c; }
        q.setFromUnitVectors(up, direction); at.copy(position).addScaledVector(direction, length / 2); scale.set(1, length, 1);
        matrix.compose(at, q, scale).toArray(matrices, count * 16); colours[count * 3] = r; colours[count * 3 + 1] = g; colours[count * 3 + 2] = b; count++;
      },
      mesh() {
        const mesh = new T.InstancedMesh(needleGeo, mat({ color: 0xffffff, roughness: .5, metalness: 0 }, .5, false), count);
        mesh.instanceMatrix.array.set(matrices.subarray(0, count * 16)); mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor = new T.BufferAttribute(colours.slice(0, count * 3), 3); mesh.frustumCulled = false; return mesh;
      },
    };
  }
  /** Needles along a straight twig from a to b. `needle` is needle length, `snow` the share of upward
   * needles that are white, `clumps` an optional list that collects places for snow caps as [x, y, z, radius]. */
  function twig(N, a, b, needle, snow, seed, clumps) {
    const dir = b.clone().sub(a), L = dir.length(); dir.normalize();
    const ref = Math.abs(dir.y) > .9 ? V(1, 0, 0) : V(0, 1, 0), u = V().crossVectors(dir, ref).normalize(), v = V().crossVectors(dir, u).normalize(), steps = Math.max(4, Math.round(L / .026));
    const p = V(), d = V();
    for (let i = 0; i < steps; i++) {
      const t = i / steps; p.copy(a).addScaledVector(dir, L * t);
      for (let k = 0; k < 3; k++) {
        const phi = i * 2.4 + seed + k * 2.1, tilt = .7 + rnd(i * 3 + k, seed) * .35, g = .1 + rnd(i * 3 + k, seed + 1) * .16 + t * .08;
        d.copy(dir).multiplyScalar(Math.cos(tilt)).addScaledVector(u, Math.sin(tilt) * Math.cos(phi)).addScaledVector(v, Math.sin(tilt) * Math.sin(phi)).normalize();
        const white = snow && d.y > .1 && rnd(i * 3 + k, seed + 5) < snow;
        N.add(p, d, needle * (1 - .3 * t) * (.8 + rnd(i, seed + 2) * .4), white ? .86 : g * .22, white ? .92 : g, white ? 1 : g * .34);
      }
      if (clumps && snow && i % 4 === 2 && rnd(i, seed + 9) < snow) clumps.push([p.x, p.y + .06, p.z, .05 + rnd(i, seed + 11) * .06]);
    }
  }
  /** A drooping bough with side twigs. Returns pt(t): the point at 0-1 along its spine, for hanging things on it. */
  function bough(N, base, dir, length, droop, side, needle, snow, seed, clumps, density = 1) {
    const pt = t => base.clone().addScaledVector(dir, length * t).add(V(0, -droop * t * t, 0)), segments = 6;
    for (let i = 0; i < segments; i++) twig(N, pt(i / segments), pt((i + 1) / segments), needle, snow, seed + i, clumps);
    const n = Math.max(2, Math.round(length / .2 * density));
    for (let j = 1; j <= n; j++) {
      const t = j / (n + 1), sg = j % 2 ? 1 : -1, tl = length * .45 * (1 - t * .65) + .12, a = pt(t), d = dir.clone().multiplyScalar(.74).addScaledVector(side, sg * .67).normalize(), b = a.clone().addScaledVector(d, tl).add(V(0, -droop * .25 * tl, 0));
      twig(N, a, b, needle * .9, snow, seed + j * 7, clumps);
      if (tl > .55) for (let k = 1; k <= 2; k++) {
        const m = a.clone().lerp(b, k / 3), d2 = (k % 2 ? d.clone().multiplyScalar(.75).addScaledVector(dir, .5).addScaledVector(side, -sg * .1) : d.clone().multiplyScalar(.7).addScaledVector(side, sg * .55).addScaledVector(dir, -.2)).normalize();
        twig(N, m, m.clone().addScaledVector(d2, tl * .4), needle * .8, snow, seed + j * 7 + k * 3, clumps);
      }
    }
    return pt;
  }
  // ---------- ornaments ----------
  const capGeo = own(new T.CylinderGeometry(.2, .24, .2, 20)), ringGeo = own(new T.TorusGeometry(.1, .025, 8, 20));
  // A lathe profile runs from the lowest point (s = 0) up to the cap at y = +1 (s = 1), so faces point outward.
  const lathe = (bottom, radiusAt) => { const points = []; for (let i = 0; i <= 48; i++) { const y = bottom + (1 - bottom) * i / 48; points.push(new T.Vector2(Math.max(radiusAt(y, i / 48), .0001), y)); } return own(new T.LatheGeometry(points, 40)); };
  const shapes = new Map();
  /** Unit ornament bodies hanging from y = +1, where the cap sits. */
  const SHAPES = {
    ball: () => sphereGeo,
    /** A teardrop: a round shoulder drawn down to a point. */
    drop: () => lathe(-1.7, y => y >= 0 ? Math.sqrt(Math.max(0, 1 - y * y)) : Math.pow(Math.cos(-y / 1.7 * Math.PI / 2), 1.6)),
    /** An onion: a flattened bulb that pinches into a long spire. */
    onion: () => lathe(-2.1, y => y >= -.35 ? 1.05 * Math.sqrt(Math.max(0, 1 - Math.pow((y - .15) / .85, 2))) : .849 * Math.pow((y + 2.1) / 1.75, 1.85)),
    /** A slim finial: three beads tapering to a tip. */
    finial: () => lathe(-2.6, (y, s) => (.16 + .4 * Math.pow(Math.abs(Math.sin(s * Math.PI * 3)), .7)) * (.3 + .7 * s) * Math.min(1, s / .04)),
    /** A cut-glass ball: flat facets that each catch the light on their own. */
    facet: () => own(new T.IcosahedronGeometry(1, 1)),
  };
  const shape = name => { if (!shapes.has(name)) shapes.set(name, (SHAPES[name] ?? SHAPES.ball)()); return shapes.get(name); };
  const sparkle = (() => { let texture; return () => texture ?? (texture = canvasTexture(256, 256, g => { g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 2600; i++) { const v = Math.round(rnd(i, 3) * 255); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rnd(i, 1) * 256, rnd(i, 2) * 256, 2, 2); } }, { srgb: false, repeat: true })); })();
  /** Surface finishes: [material options, studio reflection strength]. */
  const FINISH = {
    mirror: colour => [{ color: colour, metalness: 1, roughness: .27 }, 1.5],
    satin: colour => [{ color: colour, metalness: .85, roughness: .5 }, 1.5],
    pearl: colour => [{ color: colour, metalness: .1, roughness: .24, clearcoat: 1, clearcoatRoughness: .14 }, 1],
    glitter: colour => [{ color: colour, metalness: .75, roughness: .46, bumpMap: sparkle(), bumpScale: .035 }, 1.6],
    banded: (colour, accent) => [{ map: patternTex(`#${new T.Color(colour).getHexString()}`, `#${new T.Color(accent).getHexString()}`, 'bands'), metalness: .9, roughness: .34 }, 1.4],
  };
  /** A hanging ornament. The group's origin is the point it hangs from; `thread` is the thread length.
   * shape: ball | drop | onion | finial | facet. finish: mirror | satin | pearl | glitter | banded. */
  function ornament({ color, radius = .3, thread = 1, shape: shapeName = 'ball', finish = 'mirror', accent = 0xd9b25a } = {}) {
    const group = new T.Group(), geometry = shape(shapeName), [options, env] = (FINISH[finish] ?? FINISH.mirror)(color, accent);
    if (shapeName === 'facet') options.flatShading = true;
    const body = new T.Mesh(geometry, mat(options, env)); body.scale.setScalar(radius); body.position.y = -thread - radius;
    const cap = new T.Mesh(capGeo, gold()); cap.scale.setScalar(radius); cap.position.y = -thread + .06 * radius;
    const ring = new T.Mesh(ringGeo, gold()); ring.scale.setScalar(radius); ring.position.y = -thread + .24 * radius;
    group.add(body, cap, ring, line([V(), V(0, -thread + .3 * radius, 0)], 0xd9c9a0, .5));
    group.userData.body = body; return group;
  }
  /** The picker's bauble: a mirror or satin ball on a thread. */
  const bauble = (color, radius, thread, satinFinish) => ornament({ color, radius, thread, finish: satinFinish ? 'satin' : 'mirror' });

  /** Slow falling snow as soft points across the whole view. `salt` gives a second field its own
   * flakes instead of a copy of the first. `drift(t)`, if given, is how far the wind has carried the
   * whole fall sideways (world units, read once a frame; the flakes wrap round the view). Nothing on quiet dates. */
  function snow(count, { size = .16, opacity = .8, colour = 0xdfeeff, salt = 0, drift = null } = {}) {
    if (ctx.quiet || count < 1) return new T.Group();
    const n = Math.round(count), position = new Float32Array(n * 3), geometry = new T.BufferGeometry(), half = core.view.halfW * 1.375;
    geometry.setAttribute('position', new T.BufferAttribute(position, 3));
    const points = new T.Points(geometry, new T.PointsMaterial({ map: tex.glow(), size, transparent: true, opacity, depthWrite: false, color: C(colour), blending: T.AdditiveBlending }));
    points.frustumCulled = false;
    tick(t => {
      const carried = drift ? drift(t) : 0, span = 2 * half;
      for (let i = 0; i < n; i++) {
        const x = (rnd(i, 1 + salt) - .5) * span + Math.sin(t * .3 + i) * .3 + carried;
        position[i * 3] = carried ? ((x + half) % span + span) % span - half : x;
        position[i * 3 + 1] = ((rnd(i, 2 + salt) * 12 - t * (.12 + rnd(i, 3 + salt) * .14)) % 12 + 12) % 12 - 6;
        position[i * 3 + 2] = -9 + rnd(i, 4 + salt) * 11;
      }
      geometry.attributes.position.needsUpdate = true;
    });
    return points;
  }

  /** A soft out-of-focus light disc, for depth behind or in front of a scene. Nothing on quiet dates. */
  function bokeh(colour, size, opacity, twinkle = .4) { return ctx.quiet ? new T.Group() : glow(colour, size, opacity, { texture: tex.disc(), twinkle }); }

  return { needles, twig, bough, ornament, bauble, snow, bokeh };
}
