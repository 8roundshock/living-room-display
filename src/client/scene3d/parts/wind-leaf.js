// A slim lance-shaped leaf (Wind, #621): a curved cut-out plane with its own outline, midrib and
// side veins, in sage, in the paler tone of its underside, or in straw. Not a maple leaf and not
// a maple key: those belong to Canada Day.

/** Returns leaf({ tone, length, width, variant }): a mesh whose origin is the foot of the leaf and whose tip points along +y. tone: 'sage' | 'pale' | 'straw'. */
export function slimLeaves(kit) {
  const { T, own } = kit, W = 96, H = 384;
  const half = v => .47 * Math.pow(Math.sin(Math.PI * Math.pow(v, .72)), 1.15);   // half-width along the leaf, widest about a third up
  const outline = g => { g.beginPath(); for (let i = 0; i <= 40; i++) { const v = i / 40; g.lineTo(W * (.5 + half(v)), H * (1 - v)); } for (let i = 40; i >= 0; i--) { const v = i / 40; g.lineTo(W * (.5 - half(v)), H * (1 - v)); } g.closePath(); };
  const veins = (g, colour, k) => {
    g.strokeStyle = colour; g.lineCap = 'round';
    for (let i = 3; i < 34; i++) { const v = i / 36, reach = half(v) * W * .92; for (const sign of [-1, 1]) { g.lineWidth = .9 * k; g.beginPath(); g.moveTo(W / 2, H * (1 - v)); g.quadraticCurveTo(W / 2 + sign * reach * .6, H * (1 - v) - 9, W / 2 + sign * reach, H * (1 - v) - 20); g.stroke(); } }
    for (let i = 0; i < 24; i++) { g.lineWidth = (3.4 - i * .11) * k; g.beginPath(); g.moveTo(W / 2, H * (1 - i / 24)); g.lineTo(W / 2, H * (1 - (i + 1) / 24)); g.stroke(); }
  };
  // A neutral map that each tone's material colour multiplies: a little darker toward the foot, and veins a little
  // darker and browner than the blade, never paler (#683).
  const map = kit.canvasTexture(W, H, g => { const shade = g.createLinearGradient(0, H, 0, 0); shade.addColorStop(0, '#c9c9c9'); shade.addColorStop(.5, '#ededed'); shade.addColorStop(1, '#ffffff'); g.fillStyle = shade; g.fillRect(0, 0, W, H); const lines = document.createElement('canvas'); lines.width = W; lines.height = H; veins(lines.getContext('2d'), '#6a6040', .85); g.globalAlpha = .3; g.drawImage(lines, 0, 0); g.globalAlpha = 1; }, { anisotropy: 4 });
  const alpha = kit.canvasTexture(W, H, g => { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; outline(g); g.fill(); }, { srgb: false });
  const bump = kit.canvasTexture(W, H, g => { g.fillStyle = '#707070'; g.fillRect(0, 0, W, H); veins(g, '#585858', 1.6); }, { srgb: false });   // shallow grooves (#683)
  // Three curls: folded along the midrib, arched along its length, and twisted a little toward the tip.
  const curls = [[.1, .07, .1, .5], [.06, -.05, .16, -.7], [.14, .1, .04, .9]].map(([fold, arch, droop, twist]) => {
    const geometry = own(new T.PlaneGeometry(1, 1, 6, 18)); geometry.translate(0, .5, 0); const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, fold * Math.pow(Math.abs(x) * 2, 1.3) + arch * Math.sin(Math.PI * y) - droop * y * y + twist * x * y * .28); }
    geometry.computeVertexNormals(); return geometry;
  });
  const TONES = { sage: 0x7fae86, pale: 0xb9cdb4, straw: 0xe6cf8a }, materials = new Map();
  const material = tone => { if (!materials.has(tone)) materials.set(tone, kit.mat({ map, alphaMap: alpha, bumpMap: bump, bumpScale: .02, alphaTest: .5, side: T.DoubleSide, roughness: .5, clearcoat: .45, clearcoatRoughness: .35, color: TONES[tone] ?? TONES.sage }, .8)); return materials.get(tone); };
  return ({ tone = 'sage', length = .7, width = .13, variant = 0 } = {}) => { const mesh = new T.Mesh(curls[((variant % 3) + 3) % 3], material(tone)); mesh.scale.set(width, length, length); return mesh; };
}
