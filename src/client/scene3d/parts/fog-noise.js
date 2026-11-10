// Smooth noise for canvas textures (introduced with Fog, #620; also shapes the storm cloud,
// the snow drifts and the birch bark). A small lattice of kit.rnd values, interpolated: cheap
// enough to fill a texture pixel by pixel, deterministic, and it repeats so a texture can tile.

/** Returns noise(x, y) in 0-1 that repeats every `cells` units on both axes. */
export function softNoise(kit, cells = 8, salt = 0) {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = kit.rnd(i, salt + 71);
  const at = (x, y) => lattice[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)];
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (at(x0, y0) * (1 - u) + at(x0 + 1, y0) * u) * (1 - v) + (at(x0, y0 + 1) * (1 - u) + at(x0 + 1, y0 + 1) * u) * v;
  };
}
