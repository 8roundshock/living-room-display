// The scene kit: everything a scene module builds with. One kit per stage (per WebGL context).
// The public surface is documented in ../README.md and typed in ../engine.d.ts; keep the three in step.
import { createCore } from './core.js';
import { createFir } from './fir.js';
import { createMaple } from './maple.js';
import { createParty } from './party.js';

export function createKit(T, renderer, ctx, look, view) {
  const core = createCore(T, renderer, ctx, look, view);
  const { environment, lights, animate, dispose, surfaces, ...shared } = core;
  const kit = { ...shared, ...createFir(core), ...createMaple(core), ...createParty(core) };
  return { kit, environment, lights, animate, dispose, surfaces };
}
