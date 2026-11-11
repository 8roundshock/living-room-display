// Leaves for Autumn (#664): a blade whose outline is given point by point, so lobes and teeth
// keep their points at any size, on its stalk, as one mesh of thin coloured glass. The maple
// and the birch of the Autumn scene are built with it; the outlines, veins and colours are theirs.
// A part: plain functions of the kit, no state at module level. See ../README.md.
import { sheets } from './spring-blade.js';

/** How solid a leaf's body is beside its veins, rim and stalk, which are solid (#664: "less
 * transparent"; the ginkgo fan of #653 was 0.55, the first 3D Autumn about 0.82). This is the
 * standard look: the Transparency setting moves it through kit.solidity (#670). */
export const BODY = .7;

/** The three textures of a kind of leaf, drawn in the blade's own coordinates: across is the
 * way round the outline (its points are evenly spaced, whatever their angles), up is the way
 * out from the stalk to the rim. `veins(g, w, h, colour, width)` strokes the veins;
 * `mottle` and `speck` are the colours ('r,g,b') of the soft patches and of the small dark spots. */
export function leafTextures(kit, veins, { mottle = '150,90,20', speck = '96,44,8', specks = 46, salt = 0 } = {}) {
  const { rnd } = kit, W = 512, H = 256;
  const softened = (draw, blur) => g => { const sharp = document.createElement('canvas'); sharp.width = W; sharp.height = H; draw(sharp.getContext('2d')); try { g.filter = `blur(${blur}px)`; } catch { /* no canvas filter: sharp veins */ } g.drawImage(sharp, 0, 0); try { g.filter = 'none'; } catch { /* no canvas filter */ } };
  const map = kit.canvasTexture(W, H, g => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 180; i++) { g.fillStyle = `rgba(${rnd(i, salt + 1) < .5 ? mottle : '255,244,200'},${.03 + rnd(i, salt + 2) * .05})`; g.beginPath(); g.ellipse(rnd(i, salt + 3) * W, rnd(i, salt + 4) * H, 4 + rnd(i, salt + 5) * 12, 6 + rnd(i, salt + 6) * 20, 0, 0, 7); g.fill(); }
    veins(g, W, H, 'rgba(255,238,170,.5)', 1);
    // Small dark spots, more of them toward the rim, as on a leaf that has hung into October.
    for (let i = 0; i < specks; i++) { g.fillStyle = `rgba(${speck},${.3 + rnd(i, salt + 7) * .4})`; g.beginPath(); g.arc(rnd(i, salt + 8) * W, Math.pow(rnd(i, salt + 9), 1.7) * H * .8, .7 + rnd(i, salt + 10) * 1.5, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.fillRect(0, H * .97, W, H * .03);   // where the stalk joins, and the stalk itself
  }, { anisotropy: 8 });
  const relief = kit.canvasTexture(W, H, g => { g.fillStyle = '#787878'; g.fillRect(0, 0, W, H); softened(s => veins(s, W, H, '#ffffff', 2.2), 1.5)(g); }, { srgb: false });
  const solid = kit.canvasTexture(W, H, g => {
    const body = Math.round(kit.solidity(BODY) * 255); g.fillStyle = `rgb(${body},${body},${body})`; g.fillRect(0, 0, W, H);
    softened(s => { veins(s, W, H, '#ffffff', 2.6); s.fillStyle = '#fff'; s.fillRect(0, 0, W, H * .045); s.fillRect(0, H * .96, W, H * .04); }, 1.1)(g);
  }, { srgb: false, anisotropy: 8 });
  return { map, relief, solid };
}

/** The material of a leaf. A dimmed yellow is olive and a dimmed orange is brown, and a leaf
 * that the key light misses is dimmed. So a leaf is lit only weakly by the scene's lights (they
 * model its relief) and holds light of its own in its own colour, as a leaf does with the sun
 * behind it; `glow` is how much. It is matt. It takes only a small share of the kit's
 * see-through look, which thins a surface by how dark it is; its thinness is drawn by the
 * `solid` texture instead.
 *
 * Colours as painted (#671: "brighter colours"). The engine's tone curve (filmic, exposure 1.15)
 * is made for a scene of lit objects: it compresses whatever is bright, lifts it toward white
 * and turns a saturated orange toward yellow, so a fire-orange leaf came out a dull amber and
 * its red-orange was lost. A leaf is mostly its own light, so it skips the curve
 * (`toneMapped: false`, a property of this material alone): the colour of a vertex is the
 * colour on screen when the leaf's light adds up to 1, a little brighter where the key light
 * also falls on it. The kit's glass look still applies (it is computed before the curve). */
export function leafLook(kit, { map, relief, solid }, glow = 1) {
  const material = kit.mat({ color: 0x707070, vertexColors: true, map, alphaMap: solid, bumpMap: relief, bumpScale: .012, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: glow, roughness: 1, metalness: 0, side: kit.T.DoubleSide, see: .15 }, 0, false);
  // The leaf's own light takes the leaf's own colour, which is per vertex (three.js r128 shader text; if a later
  // three.js words that line differently nothing is replaced and the light is simply white-gold on every leaf).
  const patch = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => { shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance *= vColor;\n#endif'); patch(shader, renderer); };
  material.toneMapped = false;
  return material;
}

/** One leaf on its stalk, as a group holding one mesh (`userData.blade`). The origin is the
 * foot of the stalk; the stalk runs toward +y and the blade opens beyond it, tip toward +y,
 * face toward +z, then turned by `turn` in its own plane and tipped by `pitch` about its base.
 * `outline` is the blade's rim as [angle from the tip, distance from the stalk] pairs in rising
 * order of angle, from -pi to pi, for a blade of length 1; `size` scales it. `lift(x, y, r, i)`
 * is the relief and `tint(i, r)` the linear colour at outline point i, r of the way out;
 * `stalkTint` is the stalk's colour and `girth` its thickness.
 * `about` moves the origin that far up from the foot, for a leaf that turns in the air.
 *
 * Drawing order. three.js draws see-through meshes from the farthest origin to the nearest,
 * and a nearer leaf drawn first hides the one behind it. The mesh's origin is the foot of
 * the stalk, the point a leaf sways about, and blade and stalk are placed inside the
 * geometry: sway does not move that origin. Turn or sway a leaf only about its origin. The
 * scene may then move the origin in depth without moving the leaf (`userData.blade` has its
 * geometry to itself), to say which of two overlapping leaves is drawn first, and may call
 * `userData.carry(offset)` to bring a blade nearer on its stalk, clear of the leaf behind it. */
export function leafOn(kit, material, { outline, size = .4, stalk = .3, rows = 5, lift = () => 0, tint, stalkTint, girth = .009, pitch = 0, turn = 0, bow = 0, about = 0 }) {
  const { T } = kit, S = sheets(kit), cols = outline.length - 1, TURN = Math.PI * 2;
  const place = new T.Matrix4().makeTranslation(0, stalk - about, 0).multiply(new T.Matrix4().makeRotationZ(turn)).multiply(new T.Matrix4().makeRotationX(pitch));
  S.add(cols, rows, (u, v, out) => { const i = Math.round(u * cols), [a, reach] = outline[i], r = v * reach * size, x = Math.sin(a) * r, y = Math.cos(a) * r; out.set(x, y, lift(x, y, v, i)); },
    (u, v) => tint(Math.round(u * cols), v), { matrix: place });
  // The stalk: a thin bowed tube from the origin to the blade, in the same geometry (one draw call a leaf).
  if (stalk > 0) S.add(5, 4, (u, v, out) => { const a = u * TURN, r = girth * (1 - .3 * v), sag = Math.sin(v * Math.PI) * bow * stalk; out.set(sag + Math.cos(a) * r, v * stalk - about, sag * .5 + Math.sin(a) * r); },
    () => stalkTint, { wrap: true, map: () => [.5, .008] });
  const group = new T.Group(), blade = new T.Mesh(S.geometry(), material), points = (cols + 1) * (rows + 1);
  // Carries the blade by `offset` (a vector in the leaf's own coordinates) without moving the foot of the stalk: the stalk leans to follow.
  const carry = offset => { const position = blade.geometry.attributes.position; for (let n = 0; n < position.count; n++) { const share = n < points ? 1 : Math.floor((n - points) / 6) / 4; position.setXYZ(n, position.getX(n) + offset.x * share, position.getY(n) + offset.y * share, position.getZ(n) + offset.z * share); } position.needsUpdate = true; };
  group.add(blade); group.userData = { blade, size, points, carry };
  return group;
}
