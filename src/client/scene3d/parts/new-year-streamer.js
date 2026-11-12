// Paper streamers of the New Year scene (#610): a thrown streamer caught over the top edge,
// a tight curl near the top that relaxes into an open drape. Each one has its own width, curl
// and finish. See ../README.md, "Shared parts".

/** Finishes: material options and studio reflection strength for a colour. */
const FINISH = {
  foil: colour => [{ color: colour, metalness: .9, roughness: .25, emissive: colour, emissiveIntensity: .2 }, 1.6],
  satin: colour => [{ color: colour, metalness: .3, roughness: .34, clearcoat: .6, clearcoatRoughness: .3, emissive: colour, emissiveIntensity: .08 }, 1.1],
  paper: colour => [{ color: colour, metalness: 0, roughness: .86 }, .3],
  pearl: colour => [{ color: colour, metalness: .12, roughness: .26, clearcoat: 1, clearcoatRoughness: .16, emissive: colour, emissiveIntensity: .12 }, 1],
};

/** A streamer hanging from the group's origin, which belongs on the top edge: it starts above
 * the edge, as if caught on a rail. `finish` is foil, satin, paper or pearl; `stripe` paints a
 * fine pinstripe of that colour along it. It turns a few degrees about its hanging axis. */
export function streamer(kit, { length = 1.6, width = .12, curl = .12, turns = 3, colour = 0xf6cf4e, finish = 'foil', stripe = null, lean = 0, phase = 0, weather = null } = {}) {
  const { T, V, tick } = kit, group = new T.Group(), points = [], over = .5;
  for (let j = 0; j <= 130; j++) {
    const u = j / 130, angle = turns * Math.PI * 2 * Math.pow(u, .78) + phase, radius = curl * (.35 + 1.15 * u * u);
    points.push(V(Math.cos(angle) * radius + lean * u * u, over - u * (length + over), Math.sin(angle) * radius));
  }
  const [options, env] = (FINISH[finish] ?? FINISH.foil)(colour);
  if (stripe !== null) {
    const css = value => `#${new T.Color(value).getHexString()}`;
    options.map = kit.canvasTexture(8, 32, g => { g.fillStyle = css(colour); g.fillRect(0, 0, 8, 32); g.fillStyle = css(stripe); g.fillRect(0, 6, 8, 4); g.fillRect(0, 22, 8, 4); }, { anisotropy: 4 }); options.color = 0xffffff;
  }
  group.add(new T.Mesh(kit.ribbonGeo(points, width, V(0, 1, 0)), kit.mat({ ...options, side: T.DoubleSide }, env, finish !== 'paper')));
  // `weather` (parts/wind-underneath.js, #646): in the wind the streamer, hanging from the top edge, leans left and swings half as far again.
  tick(t => { const calm = Math.sin(t * .23 + phase * 1.7) * .02; group.rotation.y = Math.sin(t * .3 + phase) * .105 * (weather ? weather.wind.sway : 1); group.rotation.z = weather ? weather.sway(calm, -1) : calm; });
  return group;
}
