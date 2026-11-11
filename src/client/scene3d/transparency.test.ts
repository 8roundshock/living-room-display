import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { QUIET_LOOK, sceneLook, seeScale, thinned } from './settings.ts';

// #670: the Transparency setting (0-100, absent = 50) scales every see-through value of the 3D scenes
// through one multiplier and one curve, used by the kit's glass shader and by kit.solidity.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const files = (folder: string) => readdirSync(fileURLToPath(new URL(`./${folder}/`, import.meta.url))).filter(file => file.endsWith('.js')).map(file => [`${folder}/${file}`, read(`./${folder}/${file}`)] as const);
const MODULES = [...files('scenes'), ...files('parts'), ...files('weather')];

test('The setting is a multiplier: 0 solid, 50 (and absent) the owner’s picks, 100 the most see-through', () => {
  assert.equal(seeScale(undefined), 1); assert.equal(seeScale(50), 1);
  assert.equal(seeScale(0), 0); assert.equal(seeScale(25), .5); assert.equal(seeScale(100), 2); assert.equal(seeScale(75), 1.5);
  assert.equal(seeScale(-20), 0, 'below the range is solid'); assert.equal(seeScale(250), 2, 'above the range is the most see-through');
  assert.equal(sceneLook('autumn', 'everyday').seeScale, 1, 'no setting is the standard look');
  assert.equal(sceneLook('autumn', 'everyday', false, 0).seeScale, 0); assert.equal(sceneLook('christmas', 'special', false, 100).seeScale, 2);
});

test('The curve: solid at 0, exactly the chosen alpha at the standard look, thinner but never zero beyond it', () => {
  for (const alpha of [0, .14, .5, .6, .7, .8, 216 / 255, .92, 1]) {
    assert.equal(thinned(alpha, 1), alpha, `the standard look keeps ${alpha} exactly`);
    assert.equal(thinned(alpha, 0), 1, 'nothing is see-through at 0%');
    assert.ok(Math.abs(thinned(alpha, 2) - alpha * alpha) < 1e-12, `100% squares ${alpha}`);
    let previous = 1;
    for (let scale = 0; scale <= 2.0001; scale += .05) {
      const value = thinned(alpha, scale);
      assert.ok(value <= previous + 1e-12 && value >= 0 && value <= 1, `monotonic and in range: ${alpha} at ${scale}`);
      if (alpha > 0) assert.ok(value > 0, `a body never vanishes: ${alpha} at ${scale}`);
      previous = value;
    }
  }
  assert.equal(thinned(1, 2), 1, 'a solid rim stays solid at 100%');
  // The texture greys the standard look draws are unchanged, so 50% is today's look pixel for pixel.
  for (const body of [.7, .8, 216 / 255, .5, .6]) assert.equal(Math.round(thinned(body, 1) * 255), Math.round(body * 255));
  assert.deepEqual([thinned(.7, 2), thinned(.8, 2)].map(value => +value.toFixed(2)), [.49, .64], 'Autumn’s leaf body and Winter’s snow at 100%');
});

test('A quiet date keeps its rule; Transparency still applies to it', () => {
  const quiet = sceneLook('autumn', 'everyday', true, 20), normal = sceneLook('autumn', 'everyday', true);
  assert.equal(quiet.seeScale, .4);
  assert.deepEqual({ ...quiet, seeScale: 1 }, normal, 'only seeScale differs');
  assert.deepEqual([quiet.timeScale, quiet.particles, quiet.saturation], [QUIET_LOOK.timeScale, QUIET_LOOK.particles, QUIET_LOOK.saturation]);
});

test('The glass shader follows the same curve, and the kit offers solidity()', () => {
  const core = read('./kit/core.js');
  assert.match(core, /uSee <= 1\.0 \? mix\(1\.0, gGlass, uSee\) : pow\(gGlass, uSee\)/, 'kit/core.js uses thinned() in GLSL');
  assert.match(core, /value: look\.seeThrough \* seeScale \* Math\.min\(1, Math\.max\(0, share\)\)/, 'the glass share is scaled by the setting');
  assert.match(core, /const solidity = body => thinned\(body, seeScale\)/);
  assert.match(core, /\bsolidity,/, 'solidity is part of the kit');
  assert.match(read('./engine.d.ts'), /solidity\(body: number\): number;/, 'and of its typed surface');
  assert.match(core, /own\(target\)\.texture/, 'the environment render target is released with the scene, not only its texture (#638)');
});

test('No scene reads the setting; the bodies scenes make see-through themselves go through kit.solidity', () => {
  for (const [name, source] of MODULES) {
    assert.doesNotMatch(source, /seeScale|\.transparency\b|sceneLook|OWNER_LOOK|from '\.\.\/settings/, `${name} must not read the look or the setting`);
    // A literal opacity below 1 in a lit material is a body's own see-through and must follow the setting.
    for (const [, value] of source.matchAll(/\bmat\(\{[^}]*\bopacity: (\.\d+|0\.\d+)/g)) assert.fail(`${name}: opacity ${value} in mat() is a see-through body; write opacity: kit.solidity(${value})`);
  }
  const uses = Object.fromEntries(MODULES.map(([name, source]) => [name, (source.match(/kit\.solidity\(/g) ?? []).length]).filter(([, count]) => count));
  assert.deepEqual(uses, {
    'parts/autumn-leaf.js': 1, 'parts/winter-snow.js': 1, 'parts/birthday-korean-jogakbo.js': 2,
    'parts/birthday-russian-tea.js': 1, 'parts/maslenitsa-blini.js': 2, 'parts/mimosa-spray.js': 1,
  }, 'the scene parts with a see-through body of their own (update this list, and the README, with a new one)');
});
