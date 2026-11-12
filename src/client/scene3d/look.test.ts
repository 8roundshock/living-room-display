import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
// @ts-expect-error The kit is plain JavaScript.
import { createCore } from './kit/core.js';
import { OWNER_LOOK, sceneLook } from './settings.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
class Environment { fromScene() { return new THREE.WebGLRenderTarget(4, 4); } dispose() {} }
const kitFor = () => createCore({ ...THREE, PMREMGenerator: Environment }, { capabilities: { getMaxAnisotropy: () => 1 } }, { weather: null, quiet: false }, sceneLook('christmas', 'everyday'), { halfW: 8, halfH: 4.5 });

test('Less shine (#691): the owner’s 2026-11-12 direction replaces the picker’s 80%', () => {
  assert.equal(OWNER_LOOK.shine, .3);
  assert.match(read('./settings.ts'), /the pumpkins are too shiny/);
});

test('Less shine: a surface that is neither metal nor clear is matte or satin unless it says it is glossy', () => {
  const kit = kitFor();
  const plastic = kit.mat({ color: 0xff0000, roughness: .1, clearcoat: 1, clearcoatRoughness: .05 });
  assert.equal(plastic.roughness, .5); assert.equal(plastic.clearcoat, .25); assert.equal(plastic.clearcoatRoughness, .4);
  const glaze = kit.mat({ color: 0xffffff, roughness: .2, clearcoat: .5, clearcoatRoughness: .2, gloss: true });
  assert.deepEqual([glaze.roughness, glaze.clearcoat, glaze.clearcoatRoughness], [.2, .5, .2], 'a glazed surface keeps its coat');
  const metal = kit.mat({ color: 0xd9b25a, metalness: 1, roughness: .25 }, 1, false);
  assert.equal(metal.roughness, .25, 'polished metal keeps its polish');
  assert.ok(Math.abs(metal.envMapIntensity - OWNER_LOOK.shine * 1.8) < 1e-9, 'and more of the studio than other surfaces');
  const glass = kit.mat({ color: 0xffffff, roughness: .05, clear: true });
  assert.equal(glass.roughness, .05, 'clear glass keeps its polish');
  assert.equal(kit.mat({ color: 0x808080 }).roughness, 1, 'an unset roughness stays fully matte');
});

test('The illustrated look (#691): own light, wrapped light and a hue-keeping curve in the kit’s shader', () => {
  const core = read('./kit/core.js');
  assert.match(core, /const LOOK = \{ own: [\d.]+, rim: [\d.]+, wrap: [\d.]+, exposure: [\d.]+, knee: [\d.]+ \};/);
  assert.match(core, /\.replace\('#include <lights_physical_pars_fragment>', physicalLights\)/, 'the direct light wraps');
  assert.match(core, /directLight\.color\.b > directLight\.color\.r \* 1\.2 \? 0\.0/, 'the cool rim light does not wrap');
  assert.match(core, /gWrapped \* BRDF_Diffuse_Lambert/, 'only the diffuse light wraps, not the highlight');
  assert.match(core, /gl_FragColor\.rgb \+= diffuseColor\.rgb \* uOwn/, 'a surface gives off its own colour');
  assert.match(core, /#undef TONE_MAPPING\\n#endif\\n#include <tonemapping_fragment>/, 'the filmic curve is replaced, its include kept for parts that add text before it');
  // A part that skips tone mapping (Autumn's leaves, #671) skips the kit's curve as well and takes no extra own light.
  assert.match(read('./parts/autumn-leaf.js'), /see: \.15, own: 0 \}/);
  assert.match(read('./parts/autumn-leaf.js'), /material\.toneMapped = false;/);
});

test('The shader text the kit replaces is still in three.js, so each replacement takes effect', () => {
  assert.ok(THREE.ShaderChunk.lights_physical_pars_fragment.includes('reflectedLight.directDiffuse += ( 1.0 - clearcoatDHR ) * irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );'));
  const fragment = THREE.ShaderLib.physical.fragmentShader;
  for (const include of ['#include <lights_physical_pars_fragment>', '#include <tonemapping_fragment>', '#include <metalnessmap_fragment>', '#include <dithering_fragment>']) assert.ok(fragment.includes(include), include);
});
