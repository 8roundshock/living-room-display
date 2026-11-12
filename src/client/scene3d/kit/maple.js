// Maple leaves, cloth and fireworks: a textured, veined, curled leaf; a waving flag cloth
// for any texture; slow fireworks bursts as light points.
// Ported from the owner-approved scene style picker (2026-11-10, #600). See ../README.md.

const MAPLE = [[0, -1], [.12, -.72], [.28, -.8], [.24, -.45], [.52, -.62], [.5, -.4], [.78, -.42], [.62, -.2], [.95, -.05], [.7, .08], [.78, .3], [.42, .26], [.46, .5], [.06, .42], [.05, .85]];
/** The maple leaf outline, tip up, in a -1..1 square: [x, y] pairs. */
export const MAPLE_OUTLINE = [...MAPLE.map(([x, y]) => [x, -y]), ...[...MAPLE].reverse().map(([x, y]) => [-x, -y])];

export function createMaple(core) {
  const { T, V, rnd, own, tick, mat, glow, tex, ctx, canvasTexture } = core;

  const leafTextures = (() => {
    let made;
    return () => made ?? (made = (() => {
      const S = 1024, X = x => (x + 1) / 2 * S, Y = y => (1 - y) / 2 * S;
      // Palmate veins, as on a real leaf: three main veins and two basal ones leave the top of the stem,
      // side veins branch off them to the other points, and short veinlets branch off those.
      // (The picker drew thirteen straight veins from one point, which read as a folded fan.)
      const veins = (g, colour, k) => {
        const O = [0, -.42], curve = (a, b, lift) => { const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2 + lift; return t => [(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * cx + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * cy + t * t * b[1]]; };
        const stroke = (point, from, to) => { for (let i = 0; i < 14; i++) { const [x0, y0] = point(i / 14), [x1, y1] = point((i + 1) / 14); g.lineWidth = (from + (to - from) * i / 14) * k; g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1)); g.stroke(); } };
        g.strokeStyle = colour; g.lineCap = 'round';
        for (const sign of [1, -1]) {
          const centre = curve(O, [0, .93], 0), side = curve(O, [sign * .88, .05], .08), basal = curve(O, [sign * .43, -.48], -.02);
          const branches = [[centre, .42, [sign * .49, .58], 4.4], [centre, .68, [sign * .26, .76], 3], [side, .5, [sign * .73, .4], 4], [side, .44, [sign * .73, -.28], 4]].map(([parent, at, tip, w]) => [curve(parent(at), tip, .03), w]);
          if (sign > 0) stroke(centre, 9, 1.8);
          stroke(side, 7, 1.4); stroke(basal, 4, 1); for (const [branch, w] of branches) stroke(branch, w, .9);
          // Veinlets: short, alternate, leaning toward the tip of their vein.
          [centre, side, basal, ...branches.map(([branch]) => branch)].forEach((vein, v) => { for (let n = 0; n < 5; n++) { const t = .22 + n * .15, [x, y] = vein(t), [ax, ay] = vein(t + .05), dx = ax - x, dy = ay - y, length = Math.hypot(dx, dy) || 1, turn = (n % 2 ? 1 : -1) * (v ? 1 : sign) * .85, reach = (.1 + .05 * ((n + v) % 3)) * (1 - t * .5);
            const ex = x + (dx * Math.cos(turn) - dy * Math.sin(turn)) / length * reach, ey = y + (dx * Math.sin(turn) + dy * Math.cos(turn)) / length * reach; stroke(curve([x, y], [ex, ey], .01), 1.6, .5); } });
        }
        g.lineWidth = 11 * k; g.beginPath(); g.moveTo(X(0), Y(-.4)); g.lineTo(X(0), Y(-.86)); g.stroke();
      };
      const map = canvasTexture(S, S, g => {
        const gradient = g.createRadialGradient(X(0), Y(-.1), 20, X(0), Y(0), S * .6); gradient.addColorStop(0, '#f2492f'); gradient.addColorStop(.55, '#c91d23'); gradient.addColorStop(1, '#8d0e1b'); g.fillStyle = gradient; g.fillRect(0, 0, S, S);
        for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${rnd(i, 1) < .5 ? '255,130,60' : '90,0,12'},${.03 + rnd(i, 2) * .05})`; g.beginPath(); g.arc(rnd(i, 3) * S, rnd(i, 4) * S, 6 + rnd(i, 5) * 26, 0, 7); g.fill(); }
        // The veins a deeper crimson than the blade, thin and faint, never lighter (#683: the owner found pale veins
        // "too bright, if anything in real life they're darker"). Drawn whole on their own canvas and laid on at one
        // strength, so that where they meet at the stem they are no darker than one vein.
        const lines = document.createElement('canvas'); lines.width = lines.height = S; veins(lines.getContext('2d'), '#5c0812', .8);
        g.globalAlpha = .34; g.drawImage(lines, 0, 0); g.globalAlpha = 1;
      }, { anisotropy: 8 });
      const alpha = canvasTexture(S, S, g => { g.fillStyle = '#000'; g.fillRect(0, 0, S, S); g.fillStyle = '#fff'; g.beginPath(); MAPLE_OUTLINE.forEach(([x, y], i) => i ? g.lineTo(X(x * .97), Y(y * .97)) : g.moveTo(X(x * .97), Y(y * .97))); g.closePath(); g.fill(); }, { srgb: false });
      // The veins are drawn sharp on their own canvas and blurred onto the bump map in one pass: a canvas
      // filter per stroke takes minutes where 2D canvas is not GPU-accelerated. They are shallow grooves, as on
      // the upper side of a real leaf, not ridges that catch the light as bright lines (#683).
      const bump = canvasTexture(S, S, g => {
        g.fillStyle = '#707070'; g.fillRect(0, 0, S, S);
        const sharp = document.createElement('canvas'); sharp.width = sharp.height = S; veins(sharp.getContext('2d'), '#545454', 1.7);
        try { g.filter = 'blur(3px)'; } catch { /* no canvas filter: sharp veins */ }
        g.drawImage(sharp, 0, 0); try { g.filter = 'none'; } catch { /* no canvas filter */ }
      }, { srgb: false });
      return { map, alpha, bump };
    })());
  })();
  const leafGeos = [1, 2.3, 4.1].map(seed => {
    const geometry = own(new T.PlaneGeometry(2, 2, 28, 28)), p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), upper = Math.max(0, y); p.setZ(i, .26 * x * x * (1 + .3 * Math.sin(seed)) + .1 * Math.sin(y * 2.4 + seed * 2) - .16 * upper * upper + .05 * Math.sin(x * 5 + seed) * x); }
    geometry.computeVertexNormals(); return geometry;
  });
  const leafMaterials = new Map();
  const leafMaterial = tint => {
    if (!leafMaterials.has(tint)) { const t = leafTextures(); leafMaterials.set(tint, mat({ map: t.map, alphaMap: t.alpha, bumpMap: t.bump, bumpScale: .03, alphaTest: .5, side: T.DoubleSide, roughness: .5, clearcoat: .45, clearcoatRoughness: .35, color: tint }, .8)); }
    return leafMaterials.get(tint);
  };
  /** Tints that multiply the red leaf texture: full red, warm orange-red, dusty crimson, golden. */
  const LEAF_TINTS = [0xffffff, 0xffc9b0, 0xd9b8b8, 0xffe0a8];
  /** One curled maple leaf, about 2 x `scale` across, tip up. `variant` picks one of three curls. */
  function leaf(tint, scale, variant = 0) { const mesh = new T.Mesh(leafGeos[((variant % 3) + 3) % 3], leafMaterial(tint)); mesh.scale.setScalar(scale); return mesh; }

  /** A cloth that waves slowly from its hoist edge (local x = 0). `fly` is +1 to fly toward +x, -1 toward -x;
   * `wave` scales the wave; `see` is the share of the see-through look it takes (a flag should not look faded). */
  function flagCloth(texture, { width = 3.5, height = width / 2, fly = 1, wave: strength = 1, see = .35 } = {}) {
    const geometry = new T.PlaneGeometry(width, height, 80, 40); geometry.translate(width / 2, 0, 0);
    if (fly < 0) { const uv = geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
    const cloth = new T.Mesh(geometry, mat({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: .22, roughness: .7, metalness: 0, side: T.DoubleSide, see }, .35, false));
    cloth.scale.x = fly < 0 ? -1 : 1;
    const p = geometry.attributes.position, base = p.array.slice();
    const wave = t => {
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1], u = x / width, amp = (.03 + .3 * u) * strength;
        p.setZ(i, Math.sin(x * 2.2 - t * 1.5 + y * .9) * amp + Math.sin(x * 4.9 - t * 2.3 + y * 1.7) * amp * .35 + Math.sin(x * 9 - t * 3 + y * 3) * amp * .08);
        p.setY(i, y - .16 * u * u + Math.sin(x * 2.2 - t * 1.5) * .05 * u); p.setX(i, x - .06 * u * u * width * .3);
      }
      p.needsUpdate = true; geometry.computeVertexNormals();
    };
    tick(wave); return cloth;
  }

  /** Slow bursts of light points. `bursts` are [x, y, z, start offset in burst-clock seconds];
   * `tints` are [g, b] weights of red-based sparks, cycled per spark. Nothing on quiet dates. */
  function fireworks(bursts, { per = 100, size = .17, tints = [[.9, .8], [.06, .04], [.06, .04]], flash = [0xff4030, 0xfff0e0], period = 6.6, life = 4.2 } = {}) {
    const group = new T.Group(); if (ctx.quiet || !bursts.length) return group;
    const count = Math.round(per), TRAIL = 16, ROCKET = 14, GOLD = [.62, .15], total = bursts.length * (count * TRAIL + ROCKET), position = new Float32Array(total * 3), colour = new Float32Array(total * 3), geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(position, 3)); geometry.setAttribute('color', new T.BufferAttribute(colour, 3));
    const points = new T.Points(geometry, new T.PointsMaterial({ map: tex.glow(), size, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending })); points.frustumCulled = false; group.add(points);
    const flashes = bursts.map(([x, y, z], b) => { const sprite = glow(flash[b % flash.length], 6 * size / .17, 0, { twinkle: 0 }); sprite.position.set(x, y, z); group.add(sprite); return sprite; });
    tick(t => {
      let k = 0;
      bursts.forEach(([cx, cy, cz, offset], b) => {
        const tau = ((t * .6 - offset) % period + period) % period; flashes[b].userData.o = Math.exp(-tau * 3) * .35;
        for (let i = 0; i < count; i++) {
          const theta = rnd(i, b + 1) * 6.283, phi = Math.acos(2 * rnd(i, b + 9) - 1), speed = (1.7 + rnd(i, b + 17) * 1.1) * size / .17, vx = Math.sin(phi) * Math.cos(theta) * speed, vy = Math.cos(phi) * speed, vz = Math.sin(phi) * Math.sin(theta) * speed;
          const slot = (i + b) % tints.length, tint = slot && i % 9 === 0 ? GOLD : tints[slot];
          for (let j = 0; j < TRAIL; j++) {
            const age = tau - j * .022, on = age > 0 && age < life, d = on ? (1 - Math.exp(-1.4 * age)) / 1.4 : 0, I = on ? Math.pow(1 - age / life, 1.4) * Math.pow(1 - j / TRAIL, 1.5) * (j ? 2.8 : 5.5) : 0;
            position[k * 3] = cx + vx * d; position[k * 3 + 1] = cy + vy * d - (on ? .09 * age * age : 0); position[k * 3 + 2] = cz + vz * d;
            colour[k * 3] = I; colour[k * 3 + 1] = I * tint[0]; colour[k * 3 + 2] = I * tint[1]; k++;
          }
        }
        const rise = (tau - (period - 1.2)) / 1.2;
        for (let j = 0; j < ROCKET; j++) {
          const q = rise - j * .025, on = rise > 0 && q > 0, e = on ? 1 - (1 - q) * (1 - q) : 0, I = on ? (1 - j / ROCKET) * .9 : 0;
          position[k * 3] = cx + (1 - e) * (cx < 0 ? -.7 : .7); position[k * 3 + 1] = -5 + (cy + 5) * e; position[k * 3 + 2] = cz;
          colour[k * 3] = I; colour[k * 3 + 1] = I * .75; colour[k * 3 + 2] = I * .4; k++;
        }
      });
      geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true;
    });
    return group;
  }

  return { leaf, LEAF_TINTS, MAPLE_OUTLINE, flagCloth, fireworks };
}
