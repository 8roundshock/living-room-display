// Mimosa for 8 March (#626): sprigs of silver acacia, the flower of the day. Arching stems carry
// loose panicles of small fluffy yellow balls, paler green buds at their tips, and feathery
// twice-divided grey-green leaves. They stand in a plain clear glass vase with water in it, the
// stems visible through the glass. Not the pink sensitive plant, and never a second bouquet.
import { tubes, turned } from './new-year-tree-tubes.js';

/** A clear glass vase standing on y = 0: a cylinder with a slight waist and a thick base, water to `water` of its height.
 * `userData.mouth` is the height of its rim. Add what stands in it before the vase, so it is drawn through the glass. */
export function glassVase(kit, { height = 1.7, radius = .42, water = .6 } = {}) {
  const { T } = kit, group = new T.Group(), wall = k => radius * (.93 - .09 * Math.sin(Math.min(1, k / .8) * Math.PI) + .08 * Math.pow(k, 3)), outer = [[0, 0], [radius * .86, 0], [radius * .93, .02]], inner = [];
  for (let i = 1; i <= 24; i++) { const k = i / 24; outer.push([wall(k), k * height]); }
  for (let i = 24; i >= 2; i--) { const k = i / 24; inner.push([wall(k) - .028, k * height + (i === 24 ? .004 : 0)]); }
  inner.push([wall(.08) - .06, .11], [0, .1]);
  // Clear glass shows only where it turns away from the eye or catches a light: almost no body colour, a strong sheen.
  const glass = kit.mat({ color: 0x1c2a30, roughness: .04, metalness: 0, clearcoat: 1, clearcoatRoughness: .03, side: T.DoubleSide, depthWrite: false, clear: true, emissive: 0xcfe6ef, emissiveIntensity: .05 }, 2.4);
  const body = new T.Mesh(turned(kit, [...outer, ...inner], 64), glass); body.renderOrder = 3; group.add(body);
  const level = height * water, surface = new T.Mesh(new T.CircleGeometry(wall(water) - .03, 48), kit.mat({ color: 0x8fc4d8, roughness: .03, metalness: .2, clearcoat: 1, clear: true, opacity: kit.solidity(.5), side: T.DoubleSide, depthWrite: false }, 2.2));
  surface.rotation.x = -Math.PI / 2; surface.position.y = level; surface.renderOrder = 2; group.add(surface);
  const line = new T.Mesh(new T.TorusGeometry(wall(water) - .03, .008, 6, 64), kit.mat({ color: 0xcfe6ef, roughness: .05, clearcoat: 1, emissive: 0xcfe6ef, emissiveIntensity: .25, depthWrite: false, clear: true }, 2)); line.rotation.x = Math.PI / 2; line.position.y = level; line.renderOrder = 2; group.add(line);
  group.userData.mouth = height; group.userData.neck = wall(1) - .05;
  return group;
}

/** A feathery acacia leaf as an alpha drawing: a midrib with pairs of side ribs, each combed with tiny leaflets. */
function feather(kit, variant) {
  return kit.canvasTexture(512, 256, g => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 256); g.strokeStyle = '#fff'; g.lineCap = 'round';
    const pairs = 12 + variant * 2, rib = x => 128 + Math.sin(x / 512 * 2.6 + variant) * 9;
    g.lineWidth = 4; g.beginPath(); for (let x = 6; x <= 500; x += 12) { if (x === 6) g.moveTo(x, rib(x)); else g.lineTo(x, rib(x)); } g.stroke();
    for (let i = 0; i < pairs; i++) {
      const u = (i + .7) / (pairs + .5), x = 20 + u * 470, reach = (104 - variant * 8) * Math.pow(Math.sin(Math.PI * Math.min(1, u * .86 + .14)), .7), angle = 1.12 - u * .32 + variant * .04;
      for (const side of [-1, 1]) {
        const dx = Math.cos(angle), dy = side * Math.sin(angle);
        g.lineWidth = 2.4; g.beginPath(); g.moveTo(x, rib(x)); g.lineTo(x + dx * reach, rib(x) + dy * reach); g.stroke();
        g.lineWidth = 3.4;
        for (let s = 9; s < reach; s += 6.4) for (const turn of [-1, 1]) {
          const px = x + dx * s, py = rib(x) + dy * s, a = Math.atan2(dy, dx) + turn * 1.05, length = 10.5 * (1 - s / reach * .45);
          g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * length, py + Math.sin(a) * length); g.stroke();
        }
      }
    }
  }, { srgb: false, anisotropy: 8 });
}

/**
 * The spray, rising from the group's origin (the mouth of the vase). `stems` are [lean x, lean z, length above the
 * mouth, droop]. Returns { group, stems, ball }: `stems` are the stems' own groups, pivoted at the origin, for a slight
 * sway; `ball(count)` gives an instanced mesh of loose blossom balls in the same material, for the fallen and falling ones.
 */
export function mimosaSpray(kit, { stems, panicles = 6, leaves = 14, inside = 1.5, seed = 0 } = {}) {
  const { T, V, C, rnd } = kit, group = new T.Group(), own = [], up = V(0, 1, 0);
  const STEM = C(0x7f9a5a), SHOOT = C(0xa9c070), DEEP = C(0xd89400), LIGHT = C(0xf4c000), BUD = C(0xb9c860);
  const round = new T.SphereGeometry(1, 8, 6);
  const fuzz = kit.canvasTexture(64, 64, g => { g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, 64, 64); for (let i = 0; i < 520; i++) { const v = Math.round(90 + rnd(i, seed + 3) * 165); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rnd(i, seed + 1) * 64, rnd(i, seed + 2) * 64, 1.6, 1.6); } }, { srgb: false, repeat: true });
  // Yellow that stays yellow when the screen is dim: soft, matte, and a little lit from within.
  // Painted deeper than #ffd91f: the key light and the tone curve lift it to that, instead of to cream.
  const blossom = kit.mat({ color: 0xffffff, roughness: 1, bumpMap: fuzz, bumpScale: .02, emissive: 0xe89c00, emissiveIntensity: .5 }, .1, false);
  const down = new T.MeshBasicMaterial({ color: C(0xf2b000), alphaMap: fuzz, transparent: true, opacity: .2, depthWrite: false, blending: T.AdditiveBlending });
  const fronds = [0, 1, 2].map(variant => kit.mat({ color: [0x6f9a7c, 0x4f8a62, 0x7fa88c][variant], alphaMap: feather(kit, variant), roughness: .7, side: T.DoubleSide, depthWrite: false, clear: true, emissive: 0x4f8a62, emissiveIntensity: .45 }, .3, false));
  const blade = new T.PlaneGeometry(1, .46, 12, 2), q = blade.attributes.position;
  for (let i = 0; i < q.count; i++) { const x = q.getX(i) + .5, y = q.getY(i); q.setXYZ(i, x, y, -.26 * x * x + .5 * Math.abs(y) * Math.abs(y) + .03 * Math.sin(x * 5)); }
  blade.computeVertexNormals();
  const o = new T.Object3D();
  let leafCount = 0;

  stems.forEach(([leanX, leanZ, reach, droop], index) => {
    const stem = new T.Group(), salt = seed + index * 23, length = reach + inside, balls = [];
    const spine = t => V(leanX * length * Math.pow(t, 1.7) + Math.sin(t * 3 + salt) * .05 * t, length * t - inside - droop * Math.pow(t, 3.2), leanZ * length * Math.pow(t, 1.5) + Math.cos(t * 2.3 + salt) * .05 * t);
    const points = []; for (let i = 0; i <= 32; i++) points.push(spine(i / 32));
    const wood = tubes(kit, 6).add(points, .026, .008, STEM, SHOOT), first = inside / length + .12;
    /** A panicle: a short stalk with balls all round it on fine pedicels, the smallest and greenest at its tip. */
    const panicle = (from, dir, span, count, k0) => {
      const ref = Math.abs(dir.y) > .9 ? V(1, 0, 0) : up, a = V().crossVectors(dir, ref).normalize(), b = V().crossVectors(dir, a), path = [];
      for (let i = 0; i <= 8; i++) { const u = i / 8; path.push(from.clone().addScaledVector(dir, span * u).add(V(0, -span * .22 * u * u, 0))); }
      wood.add(path, .009, .004, SHOOT, SHOOT);
      for (let k = 0; k < count; k++) {
        const u = (k + .6) / count, n = k0 + k, phi = k * 2.4 + salt, at = path[Math.min(7, Math.floor(u * 8))].clone().lerp(path[Math.min(8, Math.floor(u * 8) + 1)], u * 8 % 1), stalk = .05 + rnd(n, salt + 4) * .07;
        const bud = u > .82 && rnd(n, salt + 5) < .8;
        balls.push([at.addScaledVector(a, Math.cos(phi) * stalk).addScaledVector(b, Math.sin(phi) * stalk), bud ? .026 + rnd(n, salt + 6) * .012 : (.045 + rnd(n, salt + 6) * .03) * (1 - u * .25), bud ? BUD : DEEP.clone().lerp(LIGHT, rnd(n, salt + 7))]);
      }
    };
    const count = Math.max(2, Math.round(panicles * (.7 + reach / 6)));
    for (let j = 0; j < count; j++) {
      const t = first + (1 - first) * (j + .5) / count, from = spine(t), ahead = spine(Math.min(1, t + .03)).sub(from).normalize(), sign = j % 2 ? 1 : -1;
      const side = V(sign * (.6 + rnd(j, salt + 8) * .4), .25, (rnd(j, salt + 9) - .5) * 1.4).normalize(), dir = ahead.clone().multiplyScalar(.62).addScaledVector(side, .78).normalize();
      panicle(from, dir, .42 + rnd(j, salt + 10) * .34, 8 + Math.floor(rnd(j, salt + 11) * 12), j * 40);
    }
    panicle(spine(.985), spine(1).sub(spine(.96)).normalize(), .4, 14, 900);
    stem.add(wood.mesh(kit.mat({ color: 0xffffff, vertexColors: true, roughness: .6, emissive: 0x4f6a3a, emissiveIntensity: .25 }, .4, false)));
    const heads = new T.InstancedMesh(round, blossom, balls.length), fluff = new T.InstancedMesh(round, down, balls.length);
    balls.forEach(([at, size, tint], i) => { o.position.copy(at); o.rotation.set(i, i * 2, 0); o.scale.setScalar(size); o.updateMatrix(); heads.setMatrixAt(i, o.matrix); heads.setColorAt(i, tint); o.scale.setScalar(size * 1.3); o.updateMatrix(); fluff.setMatrixAt(i, o.matrix); });
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    heads.frustumCulled = fluff.frustumCulled = false; stem.add(heads, fluff);
    // Feathery leaves along the stem, below and between the panicles, each turned and drooping its own way.
    const share = Math.round(leaves / stems.length + (index < leaves % stems.length ? .5 : 0));
    for (let j = 0; j < share; j++, leafCount++) {
      const t = first - .04 + (1 - first) * (j + .35) / (share + .4) * .9, at = spine(t), ahead = spine(Math.min(1, t + .03)).sub(at).normalize(), sign = (j + index) % 2 ? 1 : -1;
      const out = V(sign * (.75 + rnd(j, salt + 12) * .25), .12 + rnd(j, salt + 13) * .3, (rnd(j, salt + 14) - .5) * 1.1).addScaledVector(ahead, .35).normalize(), leaf = new T.Mesh(blade, fronds[leafCount % 3]);
      leaf.position.copy(at); leaf.quaternion.setFromUnitVectors(V(1, 0, 0), out); leaf.rotateX((rnd(j, salt + 15) - .5) * 1.2 + (sign > 0 ? 0 : Math.PI)); leaf.scale.setScalar(.85 + rnd(j, salt + 16) * .5); leaf.renderOrder = 1; stem.add(leaf);
    }
    own.push(stem); group.add(stem);
  });

  /** Loose balls in the blossom's own material: returns an instanced mesh; place them with setMatrixAt. */
  const ball = count => { const mesh = new T.InstancedMesh(round, blossom, count); for (let i = 0; i < count; i++) mesh.setColorAt(i, DEEP.clone().lerp(LIGHT, rnd(i, seed + 31))); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.frustumCulled = false; return mesh; };
  return { group, stems: own, ball };
}
