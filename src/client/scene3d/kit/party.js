// Party pieces: balloons, bows, wrapped gifts, a tiered cake, bunting, confetti, streamers.
// Ported from the owner-approved scene style picker (2026-11-10, #600). See ../README.md.

export function createParty(core) {
  const { T, V, C, rnd, own, tick, mat, satin, glow, line, catenary, ribbonGeo, patternTex, tex, ctx, view, sphereGeo, ballGeo } = core;

  // ---------- balloons ----------
  const balloonGeo = (() => {
    const geometry = own(new T.SphereGeometry(1, 44, 30)), p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0) { const k = 1 - .22 * y * y; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); p.setY(i, y * 1.12); } }
    geometry.scale(.86, 1, .86); geometry.computeVertexNormals(); return geometry;
  })();
  const knotGeo = own(new T.ConeGeometry(.1, .15, 12));
  const starGeo = (() => {
    let geometry;
    return () => geometry ?? (geometry = (() => {
      const outline = new T.Shape();
      for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .46 : 1; outline[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
      outline.closePath();
      const made = own(new T.ExtrudeGeometry(outline, { depth: .06, bevelEnabled: true, bevelThickness: .3, bevelSize: .16, bevelOffset: -.12, bevelSegments: 7, curveSegments: 4 }));
      made.translate(0, 0, -.03); made.computeVertexNormals(); return made;
    })());
  })();
  /** Balloon skins: [material options, studio reflection strength]. */
  const SKIN = {
    latex: colour => [{ color: colour, roughness: .22, metalness: 0, clearcoat: 1, clearcoatRoughness: .08, emissive: C(colour).multiplyScalar(.12) }, .55],
    pearl: colour => [{ color: colour, roughness: .34, metalness: .4, clearcoat: .7, clearcoatRoughness: .25, emissive: C(colour).multiplyScalar(.08) }, .9],
    foil: colour => [{ color: colour, roughness: .28, metalness: .9, emissive: C(colour).multiplyScalar(.22) }, 1.6],
  };
  /** A balloon with its knot; the group's origin is the balloon's centre and the knot hangs at y = -1.17 x radius.
   * skin: latex | pearl | foil. shape: round | star. `pattern` = [accent colour, kind] prints a patternTex on it. */
  function balloon(colour, radius, { skin = 'latex', shape = 'round', pattern } = {}) {
    const group = new T.Group(), [options, env] = (SKIN[skin] ?? SKIN.latex)(colour);
    if (pattern) { const css = value => `#${new T.Color(value).getHexString()}`; options.map = patternTex(css(colour), css(pattern[0]), pattern[1]); options.color = 0xffffff; }
    const material = mat(options, env), body = new T.Mesh(shape === 'star' ? starGeo() : balloonGeo, material), knot = new T.Mesh(knotGeo, material);
    body.scale.setScalar(radius); knot.scale.setScalar(radius); knot.position.y = (shape === 'star' ? -1.02 : -1.17) * radius; group.add(body, knot); return group;
  }

  // ---------- bows and gifts ----------
  /** A soft two-loop bow with tails, about `scale` wide. */
  function puffyBow(colour, scale) {
    const group = new T.Group(), material = satin(colour);
    for (const sg of [-1, 1]) {
      const loop = new T.Mesh(new T.TorusGeometry(.3, .115, 14, 28), material); loop.scale.set(1, .62, .55); loop.position.set(sg * .3, .06, 0); loop.rotation.z = sg * .35; group.add(loop);
      const points = []; for (let i = 0; i <= 12; i++) { const t = i / 12; points.push(V(sg * (.06 + t * .34 + Math.sin(t * 4) * .03), -t * .75, .05 + Math.sin(t * 5 + sg) * .05)); }
      group.add(new T.Mesh(ribbonGeo(points, .2, V(1, .25, 0).normalize()), material));
    }
    const knot = new T.Mesh(sphereGeo, material); knot.scale.set(.12, .11, .12); group.add(knot); group.scale.setScalar(scale); return group;
  }
  /** A wrapped box standing on y = 0 with a lid, crossed ribbons and a bow. `base`/`accent` are CSS colours of the paper; kind as patternTex. */
  function gift(width, height, depth, base, accent, kind, ribbon) {
    const group = new T.Group(), paper = patternTex(base, accent, kind), box = new T.Mesh(new T.BoxGeometry(width, height, depth), mat({ map: paper, roughness: .42, clearcoat: .5, clearcoatRoughness: .3 }, .8)); box.position.y = height / 2;
    const lid = new T.Mesh(new T.BoxGeometry(width * 1.06, height * .16, depth * 1.06), mat({ map: paper, roughness: .42, clearcoat: .5 }, .8)); lid.position.y = height * .96;
    const band = satin(ribbon), bandWidth = Math.min(width, depth) * .16;
    const r1 = new T.Mesh(new T.BoxGeometry(bandWidth, height * 1.14, depth * 1.075), band), r2 = new T.Mesh(new T.BoxGeometry(width * 1.075, height * 1.14, bandWidth), band); r1.position.y = r2.position.y = height * .57;
    const bow = puffyBow(ribbon, Math.min(width, depth) * .75); bow.position.y = height * 1.1; bow.rotation.x = -.5;
    group.add(box, lid, r1, r2, bow); return group;
  }

  // ---------- cake ----------
  /** A tiered cake on a plate, standing on y = 0, lit by its own candles. `tiers` are [radius, height, sponge colour, glaze colour]
   * from the bottom up; `sprinkles` and `candleColours` are colour lists. */
  function cake({ candles = 5, tiers = [[1.45, .95, 0xf6ead8, 0xe8456a], [1.02, .8, 0xf2b6c6, 0xf6ead8], [.66, .66, 0xf6ead8, 0x3fa7d6]], sprinkles = [0xe8456a, 0xf2a93b, 0x3fa7d6, 0x58c98a, 0x9b6bd6], candleColours = ['#e8456a', '#3fa7d6', '#f2a93b'] } = {}) {
    const group = new T.Group(), base = tiers[0][0];
    const plate = new T.Mesh(new T.CylinderGeometry(base * 1.28, base * 1.21, .08, 64), mat({ color: 0xd8dbe2, metalness: 1, roughness: .2 }, 1.2, false)); plate.position.y = .04; group.add(plate);
    let y = .08; const pearl = new T.SphereGeometry(.06, 12, 10), matrix = new T.Matrix4(), o = new T.Object3D(), tops = [];
    for (const [r, h, sponge, glazeColour] of tiers) {
      const tier = new T.Mesh(new T.CylinderGeometry(r, r, h, 64), mat({ color: sponge, roughness: .55, clearcoat: .25, clearcoatRoughness: .5 }, .6)); tier.position.y = y + h / 2; group.add(tier);
      const count = Math.round(r * 28), pearls = new T.InstancedMesh(pearl, mat({ color: glazeColour, roughness: .3, clearcoat: .8 }, .9), count * 2);
      for (let i = 0; i < count; i++) { const a = i / count * 6.283; pearls.setMatrixAt(i, matrix.makeTranslation(Math.cos(a) * r, y + h, Math.sin(a) * r)); pearls.setMatrixAt(count + i, matrix.makeTranslation(Math.cos(a) * (r + .01), y + .05, Math.sin(a) * (r + .01))); }
      pearls.frustumCulled = false; group.add(pearls);
      const glaze = new T.Mesh(new T.CylinderGeometry(r + .015, r + .015, .1, 64), mat({ color: glazeColour, roughness: .22, clearcoat: 1, clearcoatRoughness: .1 }, 1)); glaze.position.y = y + h - .04; group.add(glaze);
      const drips = new T.InstancedMesh(ballGeo, glaze.material, count);
      for (let i = 0; i < count; i++) { const a = (i + .5) / count * 6.283, L = .08 + rnd(i, r * 10) * .22; o.position.set(Math.cos(a) * (r + .01), y + h - .08 - L * .5, Math.sin(a) * (r + .01)); o.rotation.set(0, 0, 0); o.scale.set(.055, L, .04); o.updateMatrix(); drips.setMatrixAt(i, o.matrix); }
      drips.frustumCulled = false; group.add(drips); y += h; tops.push(y);
    }
    const scatter = new T.InstancedMesh(new T.CylinderGeometry(.012, .012, .07, 6), mat({ color: 0xffffff, roughness: .4 }, .6, false), 90); o.scale.set(1, 1, 1);
    for (let i = 0; i < 90; i++) {
      const level = i % tiers.length, r = tiers[level][0], inner = level < tiers.length - 1 ? tiers[level + 1][0] + .05 : .05, a = rnd(i, 1) * 6.283, rr = inner + rnd(i, 2) * (r - inner - .1);
      o.position.set(Math.cos(a) * rr, tops[level] + .012, Math.sin(a) * rr); o.rotation.set(1.57, 0, rnd(i, 3) * 3); o.updateMatrix(); scatter.setMatrixAt(i, o.matrix); scatter.setColorAt(i, C(sprinkles[i % sprinkles.length]));
    }
    scatter.instanceColor.needsUpdate = true; scatter.frustumCulled = false; group.add(scatter);
    const count = Math.max(1, Math.round(candles)), ringRadius = tiers[tiers.length - 1][0] * .58, lamp = new T.PointLight(0xffb060, 2.4, 6, 2); lamp.position.set(0, y + .75, .3); group.add(lamp);
    for (let i = 0; i < count; i++) {
      const a = i / count * 6.283 + .3, cx = Math.cos(a) * ringRadius, cz = Math.sin(a) * ringRadius, height = .4 + rnd(i, 7) * .16;
      const candle = new T.Mesh(new T.CylinderGeometry(.035, .035, height, 12), mat({ map: patternTex('#fbf7ef', candleColours[i % candleColours.length], 'stripes'), roughness: .5 }, .6, false)); candle.position.set(cx, y + height / 2, cz); group.add(candle);
      const flame = new T.Sprite(new T.SpriteMaterial({ map: tex.flame(), transparent: true, depthWrite: false, blending: T.AdditiveBlending })); flame.scale.set(.2, .4, 1); flame.position.set(cx, y + height + .18, cz); group.add(flame);
      const halo = glow(0xffb050, 1.5, .5, { twinkle: .5 }); halo.position.set(cx, y + height + .18, cz); group.add(halo);
      const phase = i * 2.1; tick(t => { flame.scale.set(.2 + Math.sin(t * 9 + phase) * .02, .4 + Math.sin(t * 7 + phase) * .05, 1); });
    }
    tick(t => { lamp.intensity = 2.4 + Math.sin(t * 8) * .25; });
    return group;
  }

  // ---------- bunting, confetti, streamers ----------
  /** Triangular flags on a cord hanging from a to b. `papers` are [base, accent, kind] patternTex triples, cycled. */
  function bunting(a, b, { flags = 6, sag = .36, drop = 1.25, papers = [['#e8456a', '#f6a8b8', 'dots'], ['#f2a93b', '#fbe0a8', 'stripes'], ['#3fa7d6', '#a8dcf2', 'grid'], ['#58c98a', '#b8f0d0', 'dots'], ['#9b6bd6', '#d6c0f2', 'stripes']], start = 0 } = {}) {
    const group = new T.Group(), count = Math.max(1, Math.round(flags)), points = catenary(a, b, sag, count * 6); group.add(line(points, 0xd8d2c4, .8));
    for (let j = 0; j < count; j++) {
      const p0 = points[j * 6 + 1], p1 = points[j * 6 + 5], width = p0.distanceTo(p1), geometry = new T.BufferGeometry(), size = .8 + rnd(j + start, 41) * .4;
      geometry.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, width, 0, 0, width / 2, -width * drop * size, 0], 3)); geometry.setAttribute('uv', new T.Float32BufferAttribute([0, 1, 1, 1, .5, 0], 2)); geometry.computeVertexNormals();
      const flag = new T.Mesh(geometry, mat({ map: patternTex(...papers[(j + start) % papers.length]), roughness: .7, side: T.DoubleSide }, .4, false));
      flag.position.copy(p0); flag.rotation.z = Math.atan2(p1.y - p0.y, p1.x - p0.x); group.add(flag);
      const phase = (j + start) * 1.1; tick(t => { flag.rotation.x = Math.sin(t * .8 + phase) * .22; });
    }
    return group;
  }
  /** Foil confetti tumbling down, thicker toward the left and right edges. Nothing on quiet dates. */
  function confetti(count, { colours = [0xe8456a, 0xf2a93b, 0x3fa7d6, 0x58c98a, 0x9b6bd6, 0xf6ead8, 0xf2c94c], size = 1 } = {}) {
    const n = Math.round(count); if (ctx.quiet || n < 1) return new T.Group();
    const mesh = new T.InstancedMesh(new T.PlaneGeometry(.2 * size, .11 * size), mat({ color: 0xffffff, metalness: .45, roughness: .3, side: T.DoubleSide }, .9, false), n), o = new T.Object3D(), edge = view.halfW * 1.075;
    for (let i = 0; i < n; i++) mesh.setColorAt(i, C(colours[i % colours.length]));
    mesh.instanceColor.needsUpdate = true; mesh.frustumCulled = false;
    tick(t => {
      for (let i = 0; i < n; i++) {
        const z = -8 + rnd(i, 1) * 10, x = (rnd(i, 2) < .5 ? -1 : 1) * (edge - Math.pow(rnd(i, 3), 1.6) * edge) * (1 - z / view.depth * .9), phase = rnd(i, 4) * 30;
        o.position.set(x + Math.sin(t * .5 + phase) * .3, ((rnd(i, 5) * 13 - t * (.14 + rnd(i, 6) * .2)) % 13 + 13) % 13 - 6.5, z); o.rotation.set(t * (.6 + rnd(i, 7)) + phase, t * (.5 + rnd(i, 8)) + phase, phase); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
    return mesh;
  }
  /** A curled paper streamer hanging down from the group's origin, turning slowly. */
  function streamer(length, radius, colour, { width = .16, phase = 0 } = {}) {
    const turns = length * 2.1, points = []; for (let j = 0; j <= 110; j++) { const u = j / 110, a = u * turns * 6.283; points.push(V(Math.cos(a) * radius * (1 + u * .5), -u * length, Math.sin(a) * radius * (1 + u * .5))); }
    const group = new T.Group(); group.add(new T.Mesh(ribbonGeo(points, width, V(0, 1, 0)), satin(colour)));
    tick(t => { group.rotation.z = Math.sin(t * .4 + phase) * .05; group.rotation.y = t * .12 + phase; });
    return group;
  }

  return { balloon, puffyBow, gift, cake, bunting, confetti, streamer };
}
