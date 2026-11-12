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
  /** A drawing buffer with several samples a pixel (the engine asks for antialiasing): a cut-out outline is then
   * smoothed by alpha to coverage. Without it (or in a Node build with no context) an outline is a plain cut. */
  const multisampled = (() => { try { const gl = renderer.getContext?.(); return !!gl && gl.getParameter(gl.SAMPLES) > 1; } catch { return false; } })();
  /** The illustrated look (#691, owner 2026-11-12: "on average colours are too dull ... i like the vibrancy of the autumn
   * one", and Maslenitsa looked "too 3d from 2005"). What made Autumn vivid (#671), for every kit surface:
   * - own: the share of its own colour a surface gives off as light of its own, so its shadow side keeps its colour
   *   instead of going dark and muddy (a scene may set its own with mat's `own` option). A metal takes less of it
   *   (its colour is mostly its reflection), but enough that gold or a silvered ornament never reads black where it
   *   reflects the dark room.
   * - rim: a little more of that light toward the silhouette, so a shape reads on black.
   * - wrap: the lights reach round a curved surface (a wrapped Lambert term), so there is no hard line between its
   *   lit and its dark side.
   * - The tone curve: the engine's filmic curve (ACES) desaturates a bright colour and turns red toward orange and
   *   orange toward yellow, which is most of what read as dull. Kit surfaces use this one instead: the colour is
   *   scaled by `exposure` and only its brightest channel is softly compressed above `knee`, so hue and saturation
   *   stay and nothing clips harshly. A surface that skips tone mapping altogether (toneMapped: false, Autumn's
   *   leaves) skips this as well. */
  const LOOK = { own: .22, rim: .9, wrap: .45, exposure: 1.3, knee: .72 };
  const physicalLights = T.ShaderChunk.lights_physical_pars_fragment.replace('float dotNL = saturate( dot( geometry.normal, directLight.direction ) );',
    // Only the warm and white lights wrap; the cool rim light behind the scene keeps to the edges it is there for
    // (wrapped, it washed a cool cast over warm surfaces and turned golden blini mauve).
    'float gWrap = directLight.color.b > directLight.color.r * 1.2 ? 0.0 : ' + LOOK.wrap.toFixed(3) + ';\n\tfloat dotNL = saturate( ( dot( geometry.normal, directLight.direction ) + gWrap ) / ( 1.0 + gWrap ) );');
  const k = LOOK.knee.toFixed(3), room = (1 - LOOK.knee).toFixed(3);
  /** Shader text that replaces the filmic curve; the include stays (with TONE_MAPPING undefined it is empty) so a part that adds its own text before it still finds it. */
  const curve = '#ifdef TONE_MAPPING\n { vec3 gC = gl_FragColor.rgb * ' + LOOK.exposure.toFixed(3) + '; float gM = max(max(gC.r, gC.g), gC.b);\n'
    + '   if (gM > ' + k + ') {\n    float gS = (gM - min(min(gC.r, gC.g), gC.b)) / gM, gTo = ' + k + ' + ' + room + ' * (1.0 - exp(-(gM - ' + k + ') / ' + room + '));\n    gC *= gTo / gM;\n'
    // A near-white that bright goes whiter (a white cake under the warm key light stays white, not peach); a saturated colour keeps its saturation.
    + '    gC = mix(gC, vec3(gTo), (1.0 - gS) * (1.0 - gS) * clamp(gM - ' + k + ', 0.0, 1.0) * 0.7);\n   }\n   gl_FragColor.rgb = gC; }\n #undef TONE_MAPPING\n#endif\n#include <tonemapping_fragment>';
  /** The solid state of a material (#683): 0 clear, 1 solid, 2 solid while it fades (fade()). */
  const SOLID = { clear: 0, solid: 1, fading: 2 };
  const solids = new WeakMap();
  /** The glass patch: a lit body thins out while its rim (Fresnel) and its highlights stay.
   * `share` (0-1) is how much of the owner's see-through setting this material takes; the
   * Transparency setting scales it (0 to 2), and the shader follows settings.ts `thinned`.
   *
   * Solid or clear (#683, owner direction 2026-11-12: "leafs behind leafs shouldnt be see through").
   * The background is true black, and a surface blended over black at alpha a shows a times its colour.
   * So a solid surface (the default) is drawn opaque at its colour times that alpha, after the tone curve and
   * the output encoding, exactly where blending would have put it: on black it looks as it always did, thin
   * and dim, but whatever is behind it in the scene, another leaf or a branch, is hidden by it, in any order
   * (the depth buffer decides). Every alpha it has is how dim it is: the glass look, an alpha map's grey,
   * a body's kit.solidity, `opacity`. Only a cut-out outline (`alphaTest`) is a shape: its alpha says where the
   * surface is, not how dim, and is turned into coverage, smoothed across the pixel's samples (alpha to
   * coverage) when the buffer has them, so an outline has no dark fringe over what is behind it. A clear
   * surface (`clear: true`: glass, ice, water, tea) is blended over what is behind it, as every surface was
   * before #683. fade() lets a solid surface fade in or out over what is behind it. */
  function glassify(material, share = 1, clear = false, own = LOOK.own) {
    const see = { value: look.seeThrough * seeScale * Math.min(1, Math.max(0, share)) }, solid = { value: clear ? SOLID.clear : SOLID.solid }, sharp = { value: multisampled ? 0 : 1 }, glowing = { value: own };
    material.transparent = clear;
    if (!clear) material.depthWrite = true;
    // Set here, with the rest of the material's state, not when its program is compiled (fade() changes it too).
    material.alphaToCoverage = !clear && multisampled && material.alphaTest > 0;
    solids.set(material, solid);
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, { uSee: see, uSolid: solid, uSharp: sharp, uOwn: glowing });
      shader.fragmentShader = 'uniform float uSee;\nuniform float uSolid;\nuniform float uSharp;\nuniform float uOwn;\n' + shader.fragmentShader
        // The illustrated look (LOOK): light that wraps round a surface.
        .replace('#include <lights_physical_pars_fragment>', physicalLights)
        // A cut-out: where the outline is (its coverage of this pixel), apart from how dim the surface is (`opacity`).
        .replace('#include <alphatest_fragment>', 'float gCover = 1.0;\n#ifdef ALPHATEST\n float gShape = diffuseColor.a / max(opacity, 0.0001), gEdge = max(fwidth(gShape), 0.0001);\n if (uSolid > 0.5) {\n  gCover = uSharp > 0.5 ? step(ALPHATEST, gShape) : clamp((gShape - ALPHATEST) / gEdge + 0.5, 0.0, 1.0);\n  if (gCover <= 0.0) discard;\n  diffuseColor.a = opacity;\n } else if (diffuseColor.a < ALPHATEST) discard;\n#endif')
        .replace('#include <tonemapping_fragment>',
          'float gFres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 1.6);\n'
          // The illustrated look (LOOK): a share of the surface's own colour as light of its own, a little more toward its rim.
          + ' gl_FragColor.rgb += diffuseColor.rgb * uOwn * (1.0 - 0.6 * metalnessFactor) * (1.0 + ' + LOOK.rim.toFixed(3) + ' * gFres * gFres);\n'
          + ' float gLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));\n float gGlass = clamp(0.14 + gFres * 0.85 + gLum * 0.75, 0.0, 1.0);\n gl_FragColor.a *= uSee <= 1.0 ? mix(1.0, gGlass, uSee) : pow(gGlass, uSee);\n' + curve)
        // Solid: the colour times its alpha, drawn opaque (or, while it fades, blended by its fade alone).
        .replace('#include <dithering_fragment>', 'if (uSolid > 0.5) {\n  float gFade = uSolid > 1.5 ? max(opacity, 0.0001) : 1.0;\n  gl_FragColor.rgb *= clamp(gl_FragColor.a / gFade, 0.0, 1.0);\n  gl_FragColor.a = (uSolid > 1.5 ? opacity : 1.0) * gCover;\n }\n#include <dithering_fragment>');
    };
    return material;
  }
  /** How many of this scene's kit.mat surfaces are solid and how many clear, for tests and tools. */
  function surfaces() { let solid = 0, clear = 0; for (const material of materials) if (solids.get(material)?.value === SOLID.clear) clear++; else solid++; return { solid, clear }; }
  /** Fades a kit.mat surface as a whole to `amount` (0-1) over whatever is behind it. A solid surface is
   * blended only while it fades and is solid again at 1; a clear one simply takes it as its opacity. */
  function fade(material, amount) {
    const solid = solids.get(material), value = Math.min(1, Math.max(0, amount));
    material.opacity = value;
    if (!solid || solid.value === SOLID.clear) return;
    const fading = value < 1;
    solid.value = fading ? SOLID.fading : SOLID.solid; material.transparent = fading;
    material.alphaToCoverage = !fading && multisampled && material.alphaTest > 0;
  }
  /** How solid a scene's own see-through body is under the Transparency setting (#670). `body` is the
   * solidity the scene chose (0-1, at the owner's picks); the result is what to draw: 1 at 0%, `body`
   * itself at the standard 50%, thinner toward 100% but never zero. Pass every alpha a scene sets for
   * a body through it (an alpha map's grey, a uniform, `opacity`). On a solid surface (#683) it is how
   * dim the body is; on a clear one, how much shows through it. A cut-out outline (alphaTest) is a
   * shape, not a body, and light (halos, flames, particles) is not a body either. */
  const solidity = body => thinned(body, seeScale);
  /** The material factory. `options` are three.js material options with sRGB colours, plus `see`
   * (0-1, default 1): the share of the see-through look this surface takes, for the rare surface
   * that must stay solid, such as a national flag; and `clear` (default false): a surface that is
   * really see-through, glass, ice, water or tea, blended over what is behind it. Every other surface
   * is solid (see glassify, #683): thin and dim on black, but it hides what is behind it.
   * `env` scales the studio reflections; `physical` adds clearcoat support. Always glass-patched.
   *
   * The illustrated look (#691): `own` (0-1) is the share of its own colour the surface gives off as light of its
   * own (LOOK.own by default, half that for a clear surface; 0 for one that brings its own glow). Less shine (owner,
   * 2026-11-12: "the pumpkins are too shiny"): a surface that is neither metal (metalness 0.5 or more) nor clear is
   * matte or satin, whatever it asks for: its roughness is at least 0.5 and a quarter of its clearcoat is kept, softened.
   * Pass `gloss: true` for one that really is glossy (a glazed or lacquered surface) to keep what it asks for. */
  function mat(options, env = 1, physical = true) {
    const { see = 1, clear = false, own = clear ? LOOK.own / 2 : LOOK.own, gloss = false, ...o } = options;
    for (const key of ['color', 'emissive']) if (typeof o[key] === 'number' || typeof o[key] === 'string') o[key] = C(o[key]);
    if (!clear && !gloss && !((o.metalness ?? 0) >= .5)) {
      o.roughness = Math.max(o.roughness ?? 1, .5);
      if (o.clearcoat) { o.clearcoat *= .25; o.clearcoatRoughness = Math.max(o.clearcoatRoughness ?? 0, .4); }
    }
    const material = physical ? new T.MeshPhysicalMaterial(o) : new T.MeshStandardMaterial(o);
    // Polished metal really reflects: it keeps more of the studio than other surfaces under the lower shine (#691).
    material.userData.env = env; material.envMapIntensity = env * look.shine * ((o.metalness ?? 0) >= .5 ? 1.8 : 1); materials.add(material);
    return glassify(material, see, clear, own);
  }
  const gold = () => mat({ color: 0xd9b25a, metalness: 1, roughness: .25 }, 1, false);
  // Ribbon satin has a real sheen: a soft one, and its colour rich in the folds (#691).
  const satin = colour => mat({ color: colour, metalness: .2, roughness: .38, clearcoat: .3, clearcoatRoughness: .3, side: T.DoubleSide, gloss: true, own: .4 });

  // ---------- light: halos and bulbs ----------
  /** An additive halo sprite. `opacity` is its strength before the owner's glow setting; `twinkle` (0-1) is how far it
   * breathes. In fog nothing twinkles (#620, #646): every halo, bulb and soft disc holds still. */
  function glow(colour, size, opacity, { texture = tex.glow(), twinkle = .25 } = {}) {
    if (ctx.weather === 'fog') twinkle = 0;
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, color: C(colour), transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false, depthTest: false }));
    sprite.scale.setScalar(size); sprite.userData = { o: opacity, tw: twinkle, ph: glows.length * 1.7 }; glows.push(sprite); return sprite;
  }
  // The low-detail sphere has enough segments (24 x 18, was 16 x 12) that its facets do not show at the sizes scenes use it (#691).
  const ballGeo = own(new T.SphereGeometry(1, 24, 18)), sphereGeo = own(new T.SphereGeometry(1, 48, 32));
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

  return { T, ctx, view, stage, V, C, mix, shift, rnd, own, tick, part, tex, canvasTexture, patternTex, environment, lights, surfaces, mat, solidity, fade, gold, satin, glow, bulb, ballGeo, sphereGeo, line, catenary, ribbonGeo, animate, dispose };
}
