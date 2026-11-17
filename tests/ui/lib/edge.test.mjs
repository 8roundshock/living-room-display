// #708: the shared headless-Edge launch keeps Playwright's disabled features and adds msWindowTabManagerPublic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { disabledFeaturesProblem, edgeArgs, EXTRA_DISABLED_FEATURES, PLAYWRIGHT_DISABLED_FEATURES, PLAYWRIGHT_VERSION } from './edge.mjs';

const root = new URL('../../../', import.meta.url), read = path => readFileSync(new URL(path, root), 'utf8');
const SWITCH = '--disable-features=';
// What Playwright 1.62.1 itself puts on Edge's command line before the caller's arguments.
const playwrightLine = `"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --disable-field-trial-config ${SWITCH}${PLAYWRIGHT_DISABLED_FEATURES.join(',')} --enable-features=CDPScreenshotNewSurface --headless --no-sandbox`;

test('edgeArgs passes one --disable-features: Playwright’s list, ours and the caller’s, keeping every other argument', () => {
  const args = edgeArgs(['--use-angle=swiftshader', '--disable-features=Foo,msWindowTabManagerPublic', '--ignore-gpu-blocklist']);
  assert.deepEqual(args.slice(0, 2), ['--use-angle=swiftshader', '--ignore-gpu-blocklist'], 'per-suite switches such as WEBGL_ARGS stay');
  const lists = args.filter(arg => arg.startsWith(SWITCH));
  assert.equal(lists.length, 1, 'one switch, because Edge keeps only the last');
  assert.deepEqual(lists[0].slice(SWITCH.length).split(','), [...PLAYWRIGHT_DISABLED_FEATURES, ...EXTRA_DISABLED_FEATURES, 'Foo'], 'no feature twice');
  assert.deepEqual(edgeArgs(), [`${SWITCH}${[...PLAYWRIGHT_DISABLED_FEATURES, ...EXTRA_DISABLED_FEATURES].join(',')}`]);
  assert.deepEqual(EXTRA_DISABLED_FEATURES, ['msWindowTabManagerPublic']);
});

test('The command-line check accepts the merged list and fails for each way the switch can go wrong', () => {
  assert.equal(disabledFeaturesProblem(`${playwrightLine} ${edgeArgs(['--disable-3d-apis']).join(' ')}`), null, 'Playwright’s list, then the merged one');
  // Adding only our feature as its own switch would drop Playwright's list: the check names what would come back on.
  const naive = disabledFeaturesProblem(`${playwrightLine} ${SWITCH}msWindowTabManagerPublic`);
  assert.match(naive, /back on \(AvoidUnnecessaryBeforeUnloadCheckSync, BoundaryEventDispatchTracksNodeRemoval/); assert.match(naive, /PLAYWRIGHT_DISABLED_FEATURES/);
  // A Playwright update that adds a feature the merged list lacks.
  assert.match(disabledFeaturesProblem(`${playwrightLine.replace(SWITCH, `${SWITCH}NewPlaywrightFeature,`)} ${edgeArgs().join(' ')}`), /back on \(NewPlaywrightFeature\)/);
  assert.match(disabledFeaturesProblem(playwrightLine), /without disabling msWindowTabManagerPublic/, 'Playwright’s list alone leaves the Alt+Tab entries');
  assert.match(disabledFeaturesProblem('msedge.exe --headless'), /without --disable-features/);
});

test('Every browser suite and tool launches Edge through the shared helper', () => {
  const files = [
    ...readdirSync(new URL('tests/ui/', root)).filter(name => name.endsWith('.mjs')).map(name => `tests/ui/${name}`),
    ...readdirSync(new URL('tests/ui/tools/', root)).filter(name => name.endsWith('.mjs')).map(name => `tests/ui/tools/${name}`),
    ...readdirSync(new URL('windows/tests/', root)).filter(name => name.endsWith('.mjs')).map(name => `windows/tests/${name}`),
  ];
  const launching = files.filter(file => /launchEdge\(|chromium\.launch|launchPersistentContext/.test(read(file)));
  assert.ok(launching.length >= 33, `${launching.length} suites and tools launch a browser`);
  for (const file of launching) {
    const source = read(file);
    assert.doesNotMatch(source, /chromium\.launch\(|launchPersistentContext\(/, `${file} launches Edge directly; use launchEdge from tests/ui/lib/edge.mjs`);
    assert.match(source, /import \{ launchEdge \} from '(\.\.\/)*(\.\/)?(lib|tests\/ui\/lib)\/edge\.mjs';/, file);
  }
  for (const file of ['tests/ui/scene3d-browser.mjs', 'tests/ui/themes-browser.mjs', 'tests/ui/tools/scene-sheet.mjs']) assert.match(read(file), /launchEdge\(chromium, \{ edge(: values\.edge)?, args/, `${file} keeps its WebGL switches`);
});

test('The pinned Playwright is the one CI installs and the docs name', () => {
  assert.match(read('.github/workflows/browser-suites.yml'), new RegExp(`PLAYWRIGHT_VERSION: ${PLAYWRIGHT_VERSION.replaceAll('.', '\\.')}\\b`));
  assert.match(read('docs/development.md'), new RegExp(`playwright@${PLAYWRIGHT_VERSION.replaceAll('.', '\\.')}\\b`));
});

// Keep the helper importable without Playwright installed: the unit test never launches a browser.
test('The helper module has no Playwright import', () => {
  assert.doesNotMatch(read('tests/ui/lib/edge.mjs'), /from 'playwright'|require\('playwright'\)/);
  assert.ok(fileURLToPath(new URL('tests/ui/lib/edge.mjs', root)));
});
