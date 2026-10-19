// Native palette (#75): the declared values, their harmony on true black, and the CSS that applies them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ACCENT_SWATCHES, CO_OCCURRING_TONES, NATIVE_PALETTE, PALETTE_ROLES, STATUS_TONES, WEATHER_GLYPH_TONE, paletteTones, toneVariables, type PaletteRole, type StatusTone } from './palette.ts';
import { ACTIVE_WIDGET_IDS, WIDGET_CATALOG } from './widgets.ts';
import { defaultSettings } from './defaults.ts';

// sRGB → OKLab (Björn Ottosson, https://bottosson.github.io/posts/oklab/).
function channels(hex: string): [number, number, number] {
  assert.match(hex, /^#[0-9a-f]{6}$/, `${hex} is lower-case six-digit hex`);
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number];
}
const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklch(hex: string): [number, number, number] {
  const [L, a, b] = oklab(hex); const h = Math.atan2(b, a) * 180 / Math.PI;
  return [L, Math.hypot(a, b), h < 0 ? h + 360 : h];
}
function fromOklch([L, C, h]: readonly [number, number, number]): [number, number, number] {
  return [L, C * Math.cos(h * Math.PI / 180), C * Math.sin(h * Math.PI / 180)];
}
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((value, index) => value - b[index]!));
/** WCAG relative luminance. */
const luminance = (hex: string) => { const [r, g, b] = channels(hex).map(linear) as [number, number, number]; return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const colour = (key: PaletteRole | StatusTone) => key in STATUS_TONES ? STATUS_TONES[key as StatusTone] : NATIVE_PALETTE[key as PaletteRole].hex;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('every role is valid hex matching its declared OKLCH, in one lightness band and a low chroma band', () => {
  assert.deepEqual(Object.keys(NATIVE_PALETTE), [...PALETTE_ROLES]);
  const names = new Set<string>();
  for (const role of PALETTE_ROLES) {
    const tone = NATIVE_PALETTE[role];
    assert.ok(tone.name && tone.meaning, `${role} has a name and meaning`); names.add(tone.name);
    assert.ok(distance(oklab(tone.hex), fromOklch(tone.oklch)) <= 0.005, `${role} ${tone.hex} matches oklch(${tone.oklch.join(' ')}): ${oklch(tone.hex).map(value => value.toFixed(3)).join(' ')}`);
    const [L, C] = oklch(tone.hex);
    assert.ok(L >= 0.70 && L <= 0.74, `${role} lightness ${L}`);
    if (role === 'stone') assert.ok(C <= 0.02, `stone stays neutral: ${C}`);
    else assert.ok(C >= 0.045 && C <= 0.075, `${role} chroma ${C}`);
  }
  assert.equal(names.size, PALETTE_ROLES.length, 'tone names are distinct');
});

test('native tones weigh the same as one accent and stay readable on black', () => {
  const mist = luminance('#8aa8c2'), brightestSwatch = Math.max(...ACCENT_SWATCHES.map(swatch => luminance(swatch.value)));
  for (const role of PALETTE_ROLES) {
    const value = luminance(NATIVE_PALETTE[role].hex);
    assert.ok(Math.abs(value - mist) / mist <= 0.06, `${role} luminance ${value.toFixed(4)} within 6% of Mist ${mist.toFixed(4)}`);
    assert.ok(value <= brightestSwatch + 0.005, `${role} is no brighter than the brightest accent swatch`);
    // Contrast against #000 at 100% brightness; the brightness cap scales every mode alike.
    assert.ok((value + 0.05) / 0.05 >= 7, `${role} contrast on black ${((value + 0.05) / 0.05).toFixed(2)}:1`);
  }
});

test('tones that can share a screen, and every role against both status cues, stay apart', () => {
  const pairs = new Set(CO_OCCURRING_TONES.map(pair => [...pair].sort().join('/')));
  for (const [index, role] of PALETTE_ROLES.entries()) {
    for (const other of PALETTE_ROLES.slice(index + 1)) assert.ok(pairs.has([role, other].sort().join('/')), `${role}/${other} is listed`);
    for (const status of Object.keys(STATUS_TONES)) assert.ok(pairs.has([role, status].sort().join('/')), `${role}/${status} is listed`);
  }
  for (const [a, b] of CO_OCCURRING_TONES) {
    const delta = distance(oklab(colour(a)), oklab(colour(b)));
    assert.ok(delta >= 0.05, `${a} and ${b} ΔE_ok ${delta.toFixed(4)}`);
  }
});

test('catalog tones and weather glyphs all map to palette roles', () => {
  for (const [id, entry] of Object.entries(WIDGET_CATALOG)) assert.ok((PALETTE_ROLES as readonly string[]).includes(entry.tone), `${id} tone ${entry.tone}`);
  // icons.tsx is JSX, so read weatherIcon's returned names from its source.
  const source = read('../client/icons.tsx');
  const body = source.slice(source.indexOf('export function weatherIcon'));
  const block = body.slice(0, body.indexOf('\n}') + 2);
  const names = new Set([...block.matchAll(/'([a-z]+)'/g)].map(match => match[1]!));
  assert.ok(names.size >= 6, `weatherIcon names found: ${[...names].join(', ')}`);
  for (const name of names) assert.ok(name in WEATHER_GLYPH_TONE, `${name} glyph has a tone`);
  for (const role of Object.values(WEATHER_GLYPH_TONE)) assert.ok((PALETTE_ROLES as readonly string[]).includes(role));
});

test('the merged catalog keeps its tone decisions, and every literal data-glyph has a sub-tone', () => {
  // Agreed across the #73/#74/#78 units: World clocks and Calendar are time, Countdown and Note
  // personal (like Reminders), Air quality sky (like Weather and Forecast), Sun & moon sun.
  const tones = Object.fromEntries(ACTIVE_WIDGET_IDS.map(id => [id, WIDGET_CATALOG[id].tone]));
  assert.deepEqual(tones, {
    clock: 'time', worldClocks: 'time', calendar: 'time',
    weather: 'sky', forecast: 'sky', airQuality: 'sky', sunMoon: 'sun',
    reminders: 'personal', countdown: 'personal', note: 'personal',
    preview: 'stone', photo: 'stone',
  });
  // Renderers that hard-code a glyph name (Sun & moon's dot and moon) must use one palette.css maps.
  for (const file of readdirSync(new URL('../client/widgets/', import.meta.url)).filter(name => name.endsWith('.tsx'))) {
    for (const [, name] of read(`../client/widgets/${file}`).matchAll(/data-glyph="([a-z]+)"/g)) assert.ok(name! in WEATHER_GLYPH_TONE, `${file} data-glyph="${name}" has a tone`);
  }
});

test('paletteTones and toneVariables: one accent for every role in color mode, the palette in native', () => {
  const appearance = defaultSettings().appearance;
  const color = { ...appearance, accentMode: 'color' as const, accentColor: '#b8a17a' };
  const native = { ...appearance, accentMode: 'native' as const, accentColor: '#b8a17a' };
  for (const role of PALETTE_ROLES) {
    assert.equal(paletteTones(color)[role], '#b8a17a');
    assert.equal(paletteTones(native)[role], NATIVE_PALETTE[role].hex);
    assert.equal(toneVariables(color)[`--tone-${role}`], '#b8a17a');
    assert.equal(toneVariables(native)[`--tone-${role}`], NATIVE_PALETTE[role].hex);
  }
  assert.equal(Object.keys(toneVariables(native)).length, PALETTE_ROLES.length);
});

test('palette.css applies every role and glyph tone; status tones equal the CSS tokens', () => {
  const css = read('../client/palette.css');
  for (const role of PALETTE_ROLES) {
    assert.match(css, new RegExp(`\\.grid-ambient \\.tone-${role} \\{ --ambient-accent: var\\(--tone-${role}\\); \\}`), `.tone-${role} rule`);
    assert.match(css, new RegExp(`--tone-${role}: var\\(--ambient-accent\\);`), `--tone-${role} fallback`);
  }
  for (const [glyph, role] of Object.entries(WEATHER_GLYPH_TONE)) assert.match(css, new RegExp(`\\[data-glyph="${glyph}"\\] \\{ --ambient-accent: var\\(--tone-${role}\\); \\}`), `${glyph} glyph rule`);
  // A glyph paints with its own sub-tone, not the colour inherited from an accent label (#78 day/night icons).
  assert.match(css, /\.grid-ambient \[data-glyph\] \{ color: var\(--ambient-accent\); \}/, 'data-glyph colour rule');
  const styles = read('../client/styles.css');
  assert.equal(styles.match(/--ambient-caution:\s*(#[0-9a-f]{6})/)?.[1], STATUS_TONES.caution);
  assert.equal(styles.match(/--ambient-offline:\s*(#[0-9a-f]{6})/)?.[1], STATUS_TONES.offline);
});
