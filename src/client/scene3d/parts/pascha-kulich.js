// The Easter table of the Russian scene (#625): a kulich, tall and round, with its white sugar
// glaze running down the sides in drips of different lengths; plain dyed eggs in onion-skin maroon
// and clear red, one marbled; and a folded linen napkin with a drawn-thread hem. No letters, no
// cross, no candle, no patterns on the eggs.
import { relathe, turned } from './new-year-tree-tubes.js';

/** A kulich standing on y = 0: straight sides from the tall tin, a shoulder where the dough rose over it, a dome, a glaze cap. */
export function kulich(kit, { radius = .62, height = 1.9, sprinkles = 70, seed = 0 } = {}) {
  const { T, C, rnd } = kit, group = new T.Group(), side = height * .66, rows = 48;
  /** Radius of the loaf at a height: tin, shoulder, dome. */
  const loaf = y => y < .04 ? radius * (.94 + .06 * Math.sqrt(y / .04)) : y < side ? radius : y < side + .1 ? radius * (1 + .07 * Math.sin((y - side) / .1 * Math.PI / 2)) : radius * 1.07 * Math.sqrt(Math.max(0, 1 - Math.pow((y - side - .1) / (height - side - .1), 2.1)));
  const profile = []; for (let i = 0; i <= rows; i++) { const y = height * (i < rows ? Math.pow(i / rows, .9) : 1); profile.push([loaf(y), y]); }
  const pleats = 26, crust = kit.canvasTexture(512, 512, g => {
    const shade = g.createLinearGradient(0, 512, 0, 0); shade.addColorStop(0, '#b97a30'); shade.addColorStop(.5, '#cf9244'); shade.addColorStop(.66, '#c07c30'); shade.addColorStop(.76, '#8f5420'); shade.addColorStop(1, '#a96a28'); g.fillStyle = shade; g.fillRect(0, 0, 512, 512);
    // The paper mould leaves soft vertical pleats below the shoulder.
    for (let i = 0; i < pleats; i++) { const x = (i + .5) / pleats * 512, pleat = g.createLinearGradient(x - 10, 0, x + 10, 0); pleat.addColorStop(0, 'rgba(70,36,8,0)'); pleat.addColorStop(.5, `rgba(70,36,8,${.2 + rnd(i, seed + 1) * .14})`); pleat.addColorStop(1, 'rgba(70,36,8,0)'); g.fillStyle = pleat; g.fillRect(x - 10, 512 * .38, 20, 512 * .62); }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rnd(i, seed + 2) < .5 ? '255,214,150' : '80,40,10'},${.04 + rnd(i, seed + 3) * .08})`; g.beginPath(); g.arc(rnd(i, seed + 4) * 512, rnd(i, seed + 5) * 512, 1 + rnd(i, seed + 6) * 5, 0, 7); g.fill(); }
  }, { anisotropy: 4 });
  group.add(new T.Mesh(turned(kit, profile, 72), kit.mat({ map: crust, bumpMap: crust, bumpScale: .01, roughness: .7, emissive: 0xb97a30, emissiveIntensity: .12 }, .4)));

  // ---------- the glaze: a shell just outside the dome whose lower edge runs down in drips ----------
  const edge = side + .16, steps = 30, around = 120, shell = []; for (let i = 0; i <= steps; i++) { const y = edge + (height - edge) * Math.sin(i / steps * Math.PI / 2); shell.push([i === steps ? 0 : loaf(y) + .032, y + .03 * (i / steps)]); }
  const icing = turned(kit, shell, around), p = icing.attributes.position, count = shell.length;
  const runs = []; for (let i = 0; i < 9; i++) runs.push([(i + .5 + (rnd(i, seed + 11) - .5) * .5) / 9 * Math.PI * 2, .1 + Math.pow(rnd(i, seed + 12), 1.4) * .4, .13 + rnd(i, seed + 13) * .1]);
  const fall = phi => { let total = .03 * Math.sin(phi * 5 + seed) + .03; for (const [at, length, width] of runs) { const d = Math.abs(Math.atan2(Math.sin(phi - at), Math.cos(phi - at))); if (d < width) total = Math.max(total, length * Math.pow(Math.cos(d / width * Math.PI / 2), .9)); } return total; };
  for (let i = 0; i <= around; i++) {
    const phi = i / around * Math.PI * 2, drop = fall(phi);
    for (let j = 0; j < 5; j++) {
      const v = i * count + j, weight = [1, .82, .5, .22, .06][j], y = shell[j][1] - drop * weight, r = loaf(y) + .03 + (j === 1 ? .014 : j === 0 ? .004 : 0) * Math.min(1, drop / .12);
      p.setXYZ(v, Math.sin(phi) * r, y, Math.cos(phi) * r);
    }
  }
  relathe(icing, count);
  const sugar = kit.mat({ color: 0xfbf7ef, roughness: .22, clearcoat: .9, clearcoatRoughness: .12 }, 1);
  group.add(new T.Mesh(icing, sugar));

  // ---------- sprinkles on the cap, in four muted colours ----------
  const TINTS = [0xe8a0a8, 0xa8d08a, 0xf2d06a, 0x9fc4e8], n = Math.round(sprinkles), scatter = new T.InstancedMesh(new T.CylinderGeometry(.011, .011, .06, 6), kit.mat({ color: 0xffffff, roughness: .4 }, .6, false), n), o = new T.Object3D(), top = height - edge;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + rnd(i, seed + 21), k = Math.sqrt((i + .5) / n) * .86, y = edge + top * Math.sqrt(Math.max(0, 1 - Math.pow(k, 2.1))) * .995;
    o.position.set(Math.sin(a) * (loaf(y) + .04), y + .045, Math.cos(a) * (loaf(y) + .04)); o.rotation.set(Math.PI / 2 - k * .9, a + rnd(i, seed + 22) * 3, rnd(i, seed + 23) * 3, 'YXZ'); o.updateMatrix(); scatter.setMatrixAt(i, o.matrix); scatter.setColorAt(i, C(TINTS[i % TINTS.length]));
  }
  if (scatter.instanceColor) scatter.instanceColor.needsUpdate = true; scatter.frustumCulled = false; group.add(scatter);
  return group;
}

/** Shells: how each egg was dyed. `skin` is boiled in onion peel (mottled, with a paler patch where it lay), `red` is clear dye, `marble` is veined. */
const SHELLS = { 'skin-dark': [0x7a2416, 'skin'], 'skin-light': [0x96381e, 'skin'], red: [0xb01414, 'red'], scarlet: [0xc42a1a, 'red'], marble: [0xa01c18, 'marble'] };

/** One dyed egg about its centre, its long axis on y, blunt end down: 0.36 high and 0.26 wide at `size` 1. */
export function dyedEgg(kit, { shell = 'red', size = 1, salt = 0 } = {}) {
  const { T, rnd } = kit, [colour, kind] = SHELLS[shell] ?? SHELLS.red, css = value => `#${new T.Color(value).getHexString()}`, profile = [];
  for (let i = 0; i <= 36; i++) { const t = i / 36 * Math.PI; profile.push([.13 * Math.sin(t) * (1 + .17 * Math.cos(t)), -.18 * Math.cos(t)]); }
  const dye = kit.canvasTexture(128, 128, g => {
    g.fillStyle = css(colour); g.fillRect(0, 0, 128, 128);
    if (kind === 'skin') {
      for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(${rnd(i, salt + 1) < .55 ? '60,14,6' : '214,120,70'},${.05 + rnd(i, salt + 2) * .1})`; g.beginPath(); g.arc(rnd(i, salt + 3) * 128, rnd(i, salt + 4) * 128, 3 + rnd(i, salt + 5) * 14, 0, 7); g.fill(); }
      const patch = g.createRadialGradient(40 + rnd(1, salt) * 50, 70, 2, 64, 70, 30); patch.addColorStop(0, 'rgba(232,160,110,.5)'); patch.addColorStop(1, 'rgba(232,160,110,0)'); g.fillStyle = patch; g.fillRect(0, 0, 128, 128);
    } else if (kind === 'marble') {
      for (let i = 0; i < 16; i++) { g.strokeStyle = `rgba(70,8,10,${.3 + rnd(i, salt + 6) * .4})`; g.lineWidth = .6 + rnd(i, salt + 7) * 1.8; g.beginPath(); const x = rnd(i, salt + 8) * 128, y = rnd(i, salt + 9) * 128; g.moveTo(x, y); g.bezierCurveTo(x + (rnd(i, salt + 10) - .5) * 90, y + 20, x + (rnd(i, salt + 11) - .5) * 90, y + 50, x + (rnd(i, salt + 12) - .5) * 70, y + 80); g.stroke(); }
      for (let i = 0; i < 20; i++) { g.fillStyle = `rgba(236,120,110,${.06 + rnd(i, salt + 13) * .1})`; g.beginPath(); g.arc(rnd(i, salt + 14) * 128, rnd(i, salt + 15) * 128, 4 + rnd(i, salt + 16) * 12, 0, 7); g.fill(); }
    } else { const sheen = g.createLinearGradient(0, 0, 0, 128); sheen.addColorStop(0, 'rgba(255,120,90,.12)'); sheen.addColorStop(1, 'rgba(60,0,0,.16)'); g.fillStyle = sheen; g.fillRect(0, 0, 128, 128); }
  });
  // The dye is deep: the shell is drawn darker than its paint so the key light does not lift it to pink.
  const egg = new T.Mesh(turned(kit, profile, 32), kit.mat({ map: dye, color: 0x808080, roughness: .3, clearcoat: .6, clearcoatRoughness: .2, emissiveMap: dye, emissive: 0xffffff, emissiveIntensity: .2, see: .6 }, .3));
  egg.scale.setScalar(size);
  return egg;
}

/** A folded linen napkin lying on y = 0, `width` by `depth`: soft creases where it was folded, and a drawn-thread hem. */
export function linenNapkin(kit, { width = 2.9, depth = 1.9, colour = '#e9e3d4', seed = 0 } = {}) {
  const { T, rnd } = kit, geometry = new T.PlaneGeometry(width, depth, 48, 32); geometry.rotateX(-Math.PI / 2);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), crease = .028 * Math.exp(-Math.pow((x - width * .12) / .07, 2)) + .022 * Math.exp(-Math.pow((z + depth * .08) / .07, 2));
    // A cloth, not a sheet: its edges wander a little and it never lies quite flat.
    p.setXYZ(i, x + .025 * Math.sin(z * 4.3 + seed), crease + .016 * Math.sin(x * 3.1 + seed) * Math.sin(z * 2.3 + seed * 2) + .02 * Math.sin((x + z) * 1.7 + seed), z + .02 * Math.sin(x * 3.7 + seed * 2));
  }
  geometry.computeVertexNormals();
  const weave = kit.canvasTexture(512, 512, g => {
    g.fillStyle = colour; g.fillRect(0, 0, 512, 512);
    g.globalAlpha = .1; g.fillStyle = '#5a4a30'; for (let i = 0; i < 512; i += 3) { g.fillRect(i, 0, 1, 512); g.fillRect(0, i, 512, 1); }
    g.globalAlpha = 1;
    // The hem: a turned edge, then a line of drawn threads (small open squares) all the way round.
    g.strokeStyle = 'rgba(120,104,80,.35)'; g.lineWidth = 2; g.strokeRect(20, 20, 472, 472); g.strokeRect(40, 40, 432, 432);
    g.fillStyle = 'rgba(70,60,44,.5)'; for (let i = 0; i < 72; i++) { const k = 31 + i * 6.25; g.fillRect(k, 28, 3, 4); g.fillRect(k, 480, 3, 4); g.fillRect(28, k, 4, 3); g.fillRect(480, k, 4, 3); }
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(150,130,100,${.05 + rnd(i, seed + 1) * .06})`; g.lineWidth = 1; g.beginPath(); const y = rnd(i, seed + 2) * 512; g.moveTo(rnd(i, seed + 3) * 300, y); g.lineTo(rnd(i, seed + 3) * 300 + 60 + rnd(i, seed + 4) * 140, y + (rnd(i, seed + 5) - .5) * 4); g.stroke(); }
  }, { anisotropy: 8 });
  return new T.Mesh(geometry, kit.mat({ map: weave, bumpMap: weave, bumpScale: .004, roughness: .9, side: T.DoubleSide }, .3, false));
}
