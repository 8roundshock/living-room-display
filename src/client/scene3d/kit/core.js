// Core of the scene kit: world, colour, materials, light, lines and registration.
// Ported from the owner-approved scene style picker (2026-11-10, #600). See ../README.md.
import { thinned } from '../settings.ts';

/** Deterministic value in [0, 1) for an index and a salt; the same everywhere, on every run. */
export const rnd = (i, s) => { const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };

export function createCore(T, renderer, ctx, look, view) {
  /** The Transparency setting as a multiplier (#670; settings.ts seeScale): 1 is the owner's picks. */
  const seeScale = look.seeScale ?? 1;
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  /** An sRGB colour (0xrrggbb or '#rrggbb') as the linear colour the lit materials expect. */
  const C = hex => new T.Color(hex).convertSRGBToLinear();
  /** A colour between two sRGB colours, returned as a 0xrrggbb number. */
  const mix = (a, b, k) => new T.Color(a).lerp(new T.Color(b), k).getHex();
  /** A colour turned around the colour wheel (`hue` in turns, -0.5 to 0.5) and optionally made more or less saturated or light; 0xrrggbb. */
  const shift = (colour, hue, saturation = 0, lightness = 0) => new T.Color(colour).offsetHSL(hue, saturation, lightness).getHex();

  const owned = new Set(), ticks = [], glows = [], materials = new Set();
  const own = item => { owned.add(item); return item; };
  const tick = fn => { ticks.push(fn); };
  const stage = new T.Group();

  // ---------- textures ----------
  const canvasOf = (width, height) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; };
  /** A texture drawn once on a 2D canvas. `srgb` marks colour data (maps); leave it off for alpha, bump and masks. */
  function canvasTexture(width, height, draw, { srgb = true, repeat = false, anisotropy = 1 } = {}) {
    const canvas = canvasOf(width, height); draw(canvas.getContext('2d'), width, height);
    const texture = own(new T.CanvasTexture(canvas));
    if (srgb) texture.encoding = T.sRGBEncoding;
    if (repeat) texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.anisotropy = Math.min(anisotropy, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }
  const radial = stops => canvasTexture(128, 128, g => { const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64); stops.forEach(([offset, colour]) => gradient.addColorStop(offset, colour)); g.fillStyle = gradient; g.fillRect(0, 0, 128, 128); }, { srgb: false });
  const lazy = make => { let value; return () => value ?? (value = make()); };
  const tex = {
    /** Soft halo: bright core, long faint skirt. */
    glow: lazy(() => radial([[0, 'rgba(255,255,255,1)'], [.18, 'rgba(255,255,255,.55)'], [.5, 'rgba(255,255,255,.13)'], [1, 'rgba(255,255,255,0)']])),
    /** Out-of-focus light: an even disc with a brighter edge. */
    disc: lazy(() => radial([[0, 'rgba(255,255,255,.5)'], [.8, 'rgba(255,255,255,.58)'], [.92, 'rgba(255,255,255,.9)'], [1, 'rgba(255,255,255,0)']])),
    flame: lazy(() => canvasTexture(64, 128, g => { g.translate(32, 86); g.scale(1, 2.1); const gradient = g.createRadialGradient(0, 6, 1, 0, 0, 30); gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(.25, 'rgba(255,225,130,1)'); gradient.addColorStop(.6, 'rgba(255,140,40,.55)'); gradient.addColorStop(1, 'rgba(255,90,20,0)'); g.fillStyle = gradient; g.beginPath(); g.arc(0, 0, 30, 0, 7); g.fill(); }, { srgb: false })),
  };
  const patterns = new Map();
  /** A repeating two-colour pattern: 'dots', 'stripes' (diagonal), 'grid', 'bands' (horizontal) or 'diamonds'. */
  function patternTex(base, accent, kind) {
    const key = `${base}|${accent}|${kind}`; if (patterns.has(key)) return patterns.get(key);
    const texture = canvasTexture(256, 256, g => {
      g.fillStyle = base; g.fillRect(0, 0, 256, 256); g.fillStyle = accent; g.strokeStyle = accent;
      if (kind === 'dots') for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.beginPath(); g.arc(x * 32 + (y % 2 ? 16 : 0) + 8, y * 32 + 16, 6, 0, 7); g.fill(); }
      else if (kind === 'stripes') { g.lineWidth = 14; for (let i = -8; i < 16; i++) { g.beginPath(); g.moveTo(i * 40, 0); g.lineTo(i * 40 + 256, 256); g.stroke(); } }
      else if (kind === 'bands') { for (let i = 0; i < 4; i++) g.fillRect(0, i * 64 + 20, 256, 24); }
      else if (kind === 'diamonds') for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const cx = x * 64 + (y % 2 ? 32 : 0) + 16, cy = y * 64 + 32; g.beginPath(); g.moveTo(cx, cy - 20); g.lineTo(cx + 14, cy); g.lineTo(cx, cy + 20); g.lineTo(cx - 14, cy); g.closePath(); g.fill(); }
      else { g.lineWidth = 3; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(0, i * 32 + 16); g.lineTo(256, i * 32 + 16); g.stroke(); g.beginPath(); g.moveTo(i * 32 + 16, 0); g.lineTo(i * 32 + 16, 256); g.stroke(); } }
    }, { repeat: true });
    patterns.set(key, texture); return texture;
  }

  // ---------- soft studio environment and lights ----------
  const environment = (() => {
    const studio = new T.Scene(), room = new T.BoxGeometry(40, 40, 40), disposables = [room];
    const wall = new T.MeshBasicMaterial({ color: 0x040406, side: T.BackSide }); disposables.push(wall); studio.add(new T.Mesh(room, wall));
    const panel = (width, height, colour, strength, position) => { const geometry = new T.PlaneGeometry(width, height), material = new T.MeshBasicMaterial({ color: new T.Color(colour).multiplyScalar(strength), side: T.DoubleSide }), mesh = new T.Mesh(geometry, material); disposables.push(geometry, material); mesh.position.set(...position); mesh.lookAt(0, 0, 0); studio.add(mesh); };
    panel(16, 10, 0xfff0dc, 4.5, [-11, 13, 11]); panel(9, 16, 0xbcd2ff, 2.2, [17, 2, 6]); panel(22, 3, 0xffffff, 2.6, [0, -9, 15]); panel(12, 12, 0xffd2a8, 1.6, [0, 16, -7]);
    // The render target is owned, not only its texture: disposing the texture alone leaves the target's
    // framebuffer and texture on the GPU, one per rebuild (#638), and the Transparency slider rebuilds (#670).
    const generator = new T.PMREMGenerator(renderer), target = generator.fromScene(studio, .04); generator.dispose(); disposables.forEach(item => item.dispose());
    return own(target).texture;
  })();
  function lights(scene) {
    const key = new T.DirectionalLight(C(0xfff1e0), 2.6), rim = new T.DirectionalLight(C(0x9fbfff), 1.8), fill = new T.DirectionalLight(0xffffff, .35);
    key.position.set(-6, 9, 12); rim.position.set(7, 4, -9); fill.position.set(6, -3, 10);
    scene.add(key, rim, fill, new T.AmbientLight(0xffffff, .12));
  }

  // ---------- materials ----------
  /** The glass patch: a lit body thins out while its rim (Fresnel) and its highlights stay.
   * `share` (0-1) is how much of the owner's see-through setting this material takes; the
   * Transparency setting scales it (0 to 2), and the shader follows settings.ts `thinned`. */
  function glassify(material, share = 1) {
    const see = { value: look.seeThrough * seeScale * Math.min(1, Math.max(0, share)) };
    material.transparent = true;
    material.onBeforeCompile = shader => {
      shader.uniforms.uSee = see;
      shader.fragmentShader = 'uniform float uSee;\n' + shader.fragmentShader.replace('#include <tonemapping_fragment>',
        'float gFres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 1.6);\n float gLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));\n float gGlass = clamp(0.14 + gFres * 0.85 + gLum * 0.75, 0.0, 1.0);\n gl_FragColor.a *= uSee <= 1.0 ? mix(1.0, gGlass, uSee) : pow(gGlass, uSee);\n#include <tonemapping_fragment>');
    };
    return material;
  }
  /** How solid a scene's own see-through body is under the Transparency setting (#670). `body` is the
   * solidity the scene chose (0-1, at the owner's picks); the result is what to draw: 1 at 0%, `body`
   * itself at the standard 50%, thinner toward 100% but never zero. Pass every alpha a scene sets for
   * a body through it (an alpha map's grey, a uniform, `opacity`). A cut-out outline (alphaTest) is a
   * shape, not a body, and light (halos, flames, particles) is not a body either. */
  const solidity = body => thinned(body, seeScale);
  /** The material factory. `options` are three.js material options with sRGB colours, plus `see`
   * (0-1, default 1): the share of the see-through look this surface takes, for the rare surface
   * that must stay solid, such as a national flag. `env` scales the studio reflections;
   * `physical` adds clearcoat support. Always glass-patched. */
  function mat(options, env = 1, physical = true) {
    const { see = 1, ...o } = options;
    for (const key of ['color', 'emissive']) if (typeof o[key] === 'number' || typeof o[key] === 'string') o[key] = C(o[key]);
    const material = physical ? new T.MeshPhysicalMaterial(o) : new T.MeshStandardMaterial(o);
    material.userData.env = env; material.envMapIntensity = env * look.shine; materials.add(material);
    return glassify(material, see);
  }
  const gold = () => mat({ color: 0xd9b25a, metalness: 1, roughness: .25 }, 1, false);
  const satin = colour => mat({ color: colour, metalness: .25, roughness: .32, clearcoat: .6, clearcoatRoughness: .3, side: T.DoubleSide });

  // ---------- light: halos and bulbs ----------
  /** An additive halo sprite. `opacity` is its strength before the owner's glow setting; `twinkle` (0-1) is how far it breathes. */
  function glow(colour, size, opacity, { texture = tex.glow(), twinkle = .25 } = {}) {
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, color: C(colour), transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false, depthTest: false }));
    sprite.scale.setScalar(size); sprite.userData = { o: opacity, tw: twinkle, ph: glows.length * 1.7 }; glows.push(sprite); return sprite;
  }
  const ballGeo = own(new T.SphereGeometry(1, 16, 12)), sphereGeo = own(new T.SphereGeometry(1, 48, 32));
  /** A small lit bulb with its halo. */
  function bulb(colour, radius = .05, halo = 16) {
    const group = new T.Group(), core = new T.Mesh(ballGeo, new T.MeshBasicMaterial({ color: C(colour).multiplyScalar(1.7) }));
    core.scale.setScalar(radius); group.add(core, glow(colour, radius * halo, .75)); return group;
  }

  // ---------- lines, curves and ribbons ----------
  function line(points, colour = 0xcfc8d8, opacity = .55) { return new T.Line(new T.BufferGeometry().setFromPoints(points), new T.LineBasicMaterial({ color: C(colour), transparent: true, opacity })); }
  /** Points of a cord hanging between two points; `sag` is the drop at its middle. */
  const catenary = (a, b, sag, n = 28) => new T.QuadraticBezierCurve3(a, a.clone().add(b).multiplyScalar(.5).add(V(0, -sag * 2, 0)), b).getPoints(n);
  /** A flat band along `points`. `side` is the direction of its width: a vector, or a function of 0-1 along the band. */
  function ribbonGeo(points, width, side) {
    const position = [], uv = [], index = [], last = points.length - 1;
    points.forEach((point, i) => {
      const half = (typeof side === 'function' ? side(i / last) : side).clone().multiplyScalar(width / 2), a = point.clone().add(half), b = point.clone().sub(half);
      position.push(a.x, a.y, a.z, b.x, b.y, b.z); uv.push(i / last, 0, i / last, 1);
      if (i) { const k = i * 2; index.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    });
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3)); geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geometry.setIndex(index); geometry.computeVertexNormals(); return geometry;
  }

  /** A sub-stage: a group already on the stage that can be placed, scaled or mirrored as one piece. */
  function part(x = 0, y = 0, scale = 1, mirror = false) { const group = new T.Group(); group.position.set(x, y, 0); group.scale.set(mirror ? -scale : scale, scale, scale); stage.add(group); return group; }

  /** Runs once per rendered frame, after the scene's own ticks. */
  function animate(t) {
    for (const fn of ticks) fn(t);
    for (const sprite of glows) sprite.material.opacity = sprite.userData.o * look.glow * (1 - sprite.userData.tw + sprite.userData.tw * (.5 + .5 * Math.sin(t * 1.3 + sprite.userData.ph)));
  }
  function dispose() { for (const item of owned) item.dispose?.(); owned.clear(); materials.clear(); ticks.length = 0; glows.length = 0; patterns.clear(); }

  return { T, ctx, view, stage, V, C, mix, shift, rnd, own, tick, part, tex, canvasTexture, patternTex, environment, lights, mat, solidity, gold, satin, glow, bulb, ballGeo, sphereGeo, line, catenary, ribbonGeo, animate, dispose };
}
