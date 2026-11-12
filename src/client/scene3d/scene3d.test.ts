import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { THEME_SCENE_IDS, type ThemeSceneId } from '../../shared/theme-registry.ts';
import { previewTheme } from '../ambient-theme.ts';
import { planScene3d, SCENE_MODULE_FALLBACK, sceneModuleFor } from './resolve.ts';
import { civilDay, fadeMask, OWNER_LOOK, QUIET_LOOK, RENDER_LIMITS, renderSize, sceneLook, sceneSeed, TIER_LOOK } from './settings.ts';
import { sceneTier, sceneWindowDays, SPECIAL_MAX_WINDOW_DAYS } from './tier.ts';
import { softwareRendererName } from './webgl.ts';

const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} is not ${expected}`);
const moduleIds = (folder: string) => readdirSync(fileURLToPath(new URL(`./${folder}/`, import.meta.url))).filter(file => file.endsWith('.js') && !file.startsWith('_')).map(file => file.slice(0, -3));
const SCENE_FILES = moduleIds('scenes'), WEATHER_FILES = moduleIds('weather');

test('The owner’s picks of 2026-11-10 are the look of an everyday scene, before the tier rule', () => {
  assert.deepEqual({ ...OWNER_LOOK }, { seeThrough: 1, glow: .65, shine: .8, size: .85, timeScale: 5 / 40, fadeToMiddle: .6, brightness: .95, amount: .3 });
  const christmas = sceneLook('christmas', 'everyday');
  near(christmas.amount, .3 * .8, 'everyday amount'); near(christmas.size, .85, 'everyday size'); near(christmas.opacity, .95 * .9, 'everyday opacity');
  assert.deepEqual([christmas.glow, christmas.shine, christmas.seeThrough, christmas.timeScale, christmas.fadeToMiddle, christmas.particles, christmas.saturation], [.65, .8, 1, .125, .6, true, 1]);
});
test('Special occasions are a little brighter and bigger; Canada Day keeps its own lower amount', () => {
  const birthday = sceneLook('birthday', 'special'), canada = sceneLook('canada-day', 'special');
  near(birthday.amount, .3, 'special amount'); near(birthday.size, .85 * 1.1, 'special size'); assert.equal(birthday.opacity, 1, 'a special scene is drawn at the saved brightness itself: 0.95 x 1.15 is clamped');
  near(canada.amount, .15, 'Canada Day amount'); near(sceneLook('canada-day', 'everyday').amount, .15 * .8, 'Canada Day everyday amount');
  assert.deepEqual(TIER_LOOK, { everyday: { opacity: .9, amount: .8, size: 1 }, special: { opacity: 1.15, amount: 1, size: 1.1 } });
});
test('A quiet date is frozen, much reduced and has nothing in the air', () => {
  const quiet = sceneLook('autumn', 'everyday', true), normal = sceneLook('autumn', 'everyday');
  near(quiet.amount, normal.amount * .4, 'quiet amount'); near(quiet.opacity, normal.opacity * .38, 'quiet opacity');
  assert.equal(quiet.timeScale, 0); assert.equal(quiet.particles, false); assert.ok(quiet.saturation < .5);
  assert.deepEqual({ ...QUIET_LOOK }, { amount: .4, opacity: .38, timeScale: 0, particles: false, saturation: .15 });
});
test('No tier or date raises the scene above the saved brightness', () => {
  for (const id of THEME_SCENE_IDS) for (const tier of ['special', 'everyday'] as const) for (const quiet of [false, true]) {
    const { opacity } = sceneLook(id, tier, quiet);
    assert.ok(opacity > 0 && opacity <= 1, `${id} ${tier} ${quiet}: ${opacity}`);
  }
  // The brightness share (#636: scene highlights about as bright as the text, as in the picker) times the tier is clamped at 1.
  assert.ok(OWNER_LOOK.brightness * TIER_LOOK.special.opacity > 1, 'the special tier would exceed the saved brightness without the clamp');
  assert.equal(sceneLook('canada-day', 'special').opacity, 1);
  near(sceneLook('christmas', 'everyday').opacity, .855, 'everyday share of the saved brightness');
  near(sceneLook('birthday', 'special', true).opacity, .38, 'a quiet date dims the clamped layer, not the unclamped product');
  assert.ok(sceneLook('christmas', 'everyday').opacity < sceneLook('birthday', 'special').opacity, 'everyday stays below special');
});
test('Fade to middle is the picker’s radial mask', () => {
  assert.equal(fadeMask(.6), 'radial-gradient(ellipse 72% 72% at 50% 50%, rgba(0,0,0,0.40) 31%, #000 100%)');
  assert.equal(fadeMask(0), 'radial-gradient(ellipse 72% 72% at 50% 50%, rgba(0,0,0,1.00) 18%, #000 100%)');
  assert.equal(fadeMask(7), fadeMask(1));
});
test('The backing store follows the device and never exceeds 2560 x 1440', () => {
  assert.deepEqual(renderSize(1920, 1080, 1), { width: 1920, height: 1080 });
  assert.deepEqual(renderSize(3840, 2160, 1), { width: 2560, height: 1440 });
  assert.deepEqual(renderSize(1920, 1080, 2), { width: 2560, height: 1440 });
  assert.deepEqual(renderSize(3440, 1440, 1), { width: 2560, height: 1072 });
  assert.deepEqual(renderSize(640, 360, 1.5), { width: 960, height: 540 });
  assert.deepEqual(renderSize(0, 300, 1), { width: 0, height: 0 });
  for (const [width, height, ratio] of [[5120, 1440, 1], [1080, 1920, 3], [7680, 4320, 2]] as const) {
    const size = renderSize(width, height, ratio);
    assert.ok(size.width <= RENDER_LIMITS.maxWidth && size.height <= RENDER_LIMITS.maxHeight, JSON.stringify(size));
  }
  assert.equal(RENDER_LIMITS.framesPerSecond, 20);
});
test('A scene seed is stable and differs between scenes', () => {
  assert.equal(sceneSeed('christmas'), sceneSeed('christmas'));
  assert.equal(new Set(THEME_SCENE_IDS.map(sceneSeed)).size, THEME_SCENE_IDS.length);
  for (const id of THEME_SCENE_IDS) assert.ok(Number.isInteger(sceneSeed(id)) && sceneSeed(id) >= 0);
});
test('The civil day number changes at local midnight and at no other time', () => {
  assert.equal(civilDay(new Date(2026, 11, 24, 23, 59, 59)), civilDay(new Date(2026, 11, 24, 0, 0, 0)));
  assert.equal(civilDay(new Date(2026, 11, 25, 0, 0, 0)), civilDay(new Date(2026, 11, 24, 23, 59, 59)) + 1);
  assert.equal(civilDay(new Date(2027, 0, 1, 12)), civilDay(new Date(2026, 11, 31, 12)) + 1);
  // A clock change does not make a day count twice or vanish.
  assert.equal(civilDay(new Date(2026, 2, 9, 12)), civilDay(new Date(2026, 2, 7, 12)) + 2);
});

test('The eligibility window comes from the holiday policy and the calendar', () => {
  for (const year of [2026, 2027, 2028, 2032]) {
    assert.equal(sceneWindowDays('christmas', year), 42, 'forty lead days, Christmas Day and Boxing Day');
    assert.equal(sceneWindowDays('canada-day', year), 3, 'two lead days and the day');
    assert.equal(sceneWindowDays('halloween', year), 17);
  }
  assert.equal(sceneWindowDays('summer', 2026), 0); assert.equal(sceneWindowDays('no-such-scene', 2026), 0);
});
test('Tier: birthdays and short celebrations are special; seasons, weather and long windows are everyday', () => {
  const tier = (motif: ThemeSceneId, habitat?: ThemeSceneId) => sceneTier({ motif, ...(habitat ? { habitat } : {}) }, 2026);
  for (const id of ['birthday', 'birthday-russian', 'birthday-korean', 'canada-day', 'mimosa', 'lotus-lanterns', 'new-year'] as const) assert.equal(tier(id), 'special', id);
  for (const id of ['spring', 'summer', 'autumn', 'winter', 'rain', 'snow', 'storm', 'fog', 'wind', 'christmas', 'halloween', 'easter'] as const) assert.equal(tier(id), 'everyday', id);
  // The boundary is one week on screen.
  assert.equal(SPECIAL_MAX_WINDOW_DAYS, 7);
  assert.equal(sceneWindowDays('orthodox-christmas', 2026), 7); assert.equal(tier('orthodox-christmas'), 'special');
  assert.equal(sceneWindowDays('thanksgiving', 2026), 8); assert.equal(tier('thanksgiving'), 'everyday');
  // Weather over a scene (Combined) keeps that scene's tier.
  assert.equal(tier('snow', 'christmas'), 'everyday'); assert.equal(tier('rain', 'birthday'), 'special'); assert.equal(tier('wind', 'canada-day'), 'special');
  for (const id of THEME_SCENE_IDS) assert.ok(['special', 'everyday'].includes(tier(id)), id);
  assert.equal(tier(previewTheme('canada-day').motif), 'special'); assert.equal(tier(previewTheme('christmas').motif), 'everyday');
});

test('A scene resolves to its own module, to a declared fallback, or to the flat renderer', () => {
  const scenes = ['christmas', 'canada-day', 'birthday'], weather = ['snow'];
  assert.deepEqual(planScene3d(previewTheme('christmas'), scenes, weather), { sceneId: 'christmas', module: 'christmas', weather: null });
  assert.deepEqual(planScene3d(previewTheme('birthday-russian'), scenes, weather), { sceneId: 'birthday-russian', module: 'birthday', weather: null });
  assert.deepEqual(planScene3d(previewTheme('birthday-korean'), scenes, weather), { sceneId: 'birthday-korean', module: 'birthday', weather: null });
  assert.equal(planScene3d(previewTheme('summer'), scenes, weather), null, 'no module yet');
  assert.equal(sceneModuleFor('birthday-russian', [...scenes, 'birthday-russian']), 'birthday-russian', 'a file named after the scene wins without an edit');
  assert.equal(sceneModuleFor('birthday-russian', ['christmas']), null);
});
test('A birthday treatment uses its own module as soon as its file exists, and the shared Birthday module until then', () => {
  for (const id of ['birthday-russian', 'birthday-korean'] as const) {
    const scene = previewTheme(id), others = SCENE_FILES.filter(file => file !== id);
    assert.ok(others.includes('birthday'), 'the shared Birthday module exists');
    // Without scenes/<id>.js: the shared module draws it, and the scene is told which treatment it is (ctx.id).
    assert.deepEqual(planScene3d(scene, others, WEATHER_FILES), { sceneId: id, module: 'birthday', weather: null });
    // With scenes/<id>.js: that file wins. Nothing but the new file changes; SCENE_MODULE_FALLBACK may keep its entry.
    assert.deepEqual(planScene3d(scene, [...others, id], WEATHER_FILES), { sceneId: id, module: id, weather: null });
    assert.equal(SCENE_MODULE_FALLBACK[id], 'birthday');
    // The folder as it is today resolves one way or the other, never to nothing.
    assert.equal(planScene3d(scene, SCENE_FILES, WEATHER_FILES)?.module, SCENE_FILES.includes(id) ? id : 'birthday');
    // Neither file: the flat renderer.
    assert.equal(planScene3d(scene, others.filter(file => file !== 'birthday'), WEATHER_FILES), null);
    // Combined weather over a birthday follows the same rule for the scene module.
    assert.equal(planScene3d({ motif: 'snow', habitat: id, source: 'weather' }, [...others, id], ['snow'])?.module, id);
    assert.equal(planScene3d({ motif: 'snow', habitat: id, source: 'weather' }, others, ['snow'])?.module, 'birthday');
  }
  // The classic treatment never borrows another treatment's module.
  assert.equal(sceneModuleFor('birthday', ['birthday-russian', 'birthday-korean']), null);
});
test('Weather over a scene needs its overlay; a weather scene on its own needs its scene module', () => {
  const scenes = ['christmas', 'canada-day', 'birthday'];
  const snowOnChristmas = { motif: 'snow', habitat: 'christmas', source: 'weather' } as const, rainOnCanadaDay = { motif: 'rain', habitat: 'canada-day', source: 'weather' } as const;
  assert.deepEqual(planScene3d(snowOnChristmas, scenes, ['snow']), { sceneId: 'christmas', module: 'christmas', weather: 'snow' });
  assert.equal(planScene3d(rainOnCanadaDay, scenes, ['snow']), null, 'the flat renderer keeps showing rain until weather/rain.js exists');
  assert.equal(planScene3d(snowOnChristmas, scenes, []), null);
  assert.equal(planScene3d(previewTheme('snow'), scenes, ['snow']), null, 'the Snow scene itself is scenes/snow.js, not the overlay');
  assert.deepEqual(planScene3d(previewTheme('snow'), [...scenes, 'snow'], ['snow']), { sceneId: 'snow', module: 'snow', weather: null });
});
test('Module files follow the contract: a registered id, a default build(kit, ctx), imports only from parts/', async () => {
  for (const id of ['christmas', 'canada-day', 'birthday']) assert.ok(SCENE_FILES.includes(id), `reference scene ${id}`);
  assert.ok(WEATHER_FILES.includes('snow'));
  for (const id of SCENE_FILES) assert.ok((THEME_SCENE_IDS as string[]).includes(id), `scenes/${id}.js must be named after a registered scene id`);
  for (const id of WEATHER_FILES) assert.ok(['rain', 'snow', 'storm', 'fog', 'wind'].includes(id), `weather/${id}.js must be named after a weather kind`);
  for (const [folder, ids] of [['scenes', SCENE_FILES], ['weather', WEATHER_FILES]] as const) for (const id of ids) {
    const module = await import(new URL(`./${folder}/${id}.js`, import.meta.url).href) as { default?: unknown };
    assert.equal(typeof module.default, 'function', `${folder}/${id}.js default export`);
    assert.equal((module.default as (...parameters: unknown[]) => unknown).length, 2, `${folder}/${id}.js builds from (kit, ctx)`);
    // three.js comes from kit.T, and nothing from the app: a scene file stays a small chunk of its own.
    const source = readFileSync(new URL(`./${folder}/${id}.js`, import.meta.url), 'utf8');
    for (const [, specifier] of source.matchAll(/^\s*(?:import\s*|(?:import|export)\s[^'"\n;]*?\sfrom\s*)['"]([^'"\n]+)['"]/gm)) assert.match(specifier!, /^\.\.\/parts\/[\w-]+\.js$/, `${folder}/${id}.js imports ${specifier}`);
    assert.doesNotMatch(source, /^[^/\n]*\bimport\s*\(/m, `${folder}/${id}.js must not load code on its own`);
    assert.doesNotMatch(source, /Math\.random\(/, `${folder}/${id}.js must be deterministic: use kit.rnd`);
  }
  for (const [from, to] of Object.entries(SCENE_MODULE_FALLBACK)) {
    assert.ok((THEME_SCENE_IDS as string[]).includes(from), from); assert.ok(SCENE_FILES.includes(to), `${from} falls back to an existing module`);
  }
  for (const id of ['birthday', 'birthday-russian', 'birthday-korean', 'christmas', 'canada-day'] as const) assert.ok(planScene3d(previewTheme(id), SCENE_FILES, WEATHER_FILES), `${id} is drawn in 3D`);
});
test('Shared parts are named after the scene that introduced them and import only other parts', () => {
  let parts: string[] = [];
  try { parts = readdirSync(fileURLToPath(new URL('./parts/', import.meta.url))).filter(file => file.endsWith('.js')); } catch { /* no shared parts yet */ }
  const owners = [...THEME_SCENE_IDS, 'rain', 'snow', 'storm', 'fog', 'wind'] as string[];
  for (const file of parts) {
    assert.match(file, /^[a-z0-9]+(-[a-z0-9]+)+\.js$/, `parts/${file} is lower-case words joined by hyphens`);
    assert.ok(owners.some(owner => file.startsWith(`${owner}-`) && file.length > owner.length + 4), `parts/${file} starts with the id of the scene that introduced it, then the name of the part`);
    const source = readFileSync(new URL(`./parts/${file}`, import.meta.url), 'utf8');
    for (const [, specifier] of source.matchAll(/^\s*(?:import\s*|(?:import|export)\s[^'"\n;]*?\sfrom\s*)['"]([^'"\n]+)['"]/gm)) assert.match(specifier!, /^\.\/[\w-]+\.js$/, `parts/${file} imports ${specifier}`);
    assert.doesNotMatch(source, /Math\.random\(/, `parts/${file} must be deterministic: use kit.rnd`);
  }
});
test('A processor-drawn WebGL is recognised by name', () => {
  for (const name of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver', 'Software Rasterizer']) assert.equal(softwareRendererName(name), true, name);
  for (const name of ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Ti (0x00001B06) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Apple M2', '']) assert.equal(softwareRendererName(name), false, name);
});

// Review of #676: a stray comment once swallowed the statements that put three scenes' heroes on the stage, and every
// other check passed because an empty scene has nothing to crop. Each scene (everyday and quiet) and overlay is built
// in Node and must keep most of what it drew at the baseline in tests/scene3d/census-baseline.json.
test('Every scene and overlay still draws most of what it drew: nothing is silently dropped', async () => {
  // @ts-expect-error -- a plain JavaScript test tool without type declarations
  const { censusAll } = await import('../../../tests/scene3d/census.mjs');
  const baseline: { counts: Record<string, { objects: number; triangles: number }> } = JSON.parse(readFileSync(new URL('../../../tests/scene3d/census-baseline.json', import.meta.url), 'utf8'));
  const now: Record<string, { objects: number; triangles: number }> = await censusAll();
  assert.deepEqual(Object.keys(now).sort(), Object.keys(baseline.counts).sort(), 'every scene and overlay has a baseline (take a census and add new ones)');
  const lost = Object.entries(baseline.counts).filter(([key, was]) => { const is = now[key]!; return is.objects === 0 || is.objects < was.objects * .95 || is.triangles < was.triangles * .95; })
    .map(([key, was]) => `${key}: ${JSON.stringify(now[key])}, was ${JSON.stringify(was)}`);
  assert.deepEqual(lost, [], 'a scene lost part of what it draws (more than 5% of its objects or of its triangles); if that was meant, take a new census');
});
