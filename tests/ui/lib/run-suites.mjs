// Runs the browser suites (tests/ui/*-browser.mjs) one after another, each in its own Node process with
// its own isolated loopback server and temporary synthetic data, and prints how long each took. CI runs
// one set per job (.github/workflows/browser-suites.yml, #323); locally, run every suite or name some.
//
//   node tests/ui/lib/run-suites.mjs --playwright <module> --edge <browser> --sharp <module> [suite ...]
//   node tests/ui/lib/run-suites.mjs ... --set pull-request       the suites CI runs on every pull request
//   node tests/ui/lib/run-suites.mjs ... --repeat 5 preview       five consecutive runs
//   node tests/ui/lib/run-suites.mjs --list                       the sets and their suites
//
// It writes no files and takes no screenshots; the suites keep their images in RAM.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const directory = fileURLToPath(new URL('..', import.meta.url));
/** Every suite in tests/ui, by name (`widgets` for widgets-browser.mjs). */
export const SUITES = readdirSync(directory).filter(file => file.endsWith('-browser.mjs')).map(file => file.slice(0, -'-browser.mjs'.length)).sort();
/**
 * The CI sets (#323). `pull-request` runs on every pull request and push to main and always includes the
 * widgets suite; `scheduled` adds the rest on the weekly and manual runs. Every suite belongs to exactly
 * one set, so a new suite fails the runner until it is placed in one. See docs/development.md.
 */
export const SETS = {
  'pull-request': ['widgets', 'canvas-scope', 'motion', 'preview', 'palette', 'weather', 'grid', 'studio', 'catalog-sky', 'catalog-time', 'freesize', 'reminders', 'workspace', 'display-controls', 'editor-sync', 'first-run'],
  scheduled: [],
};

export function checkSets() {
  const placed = Object.values(SETS).flat();
  return [
    ...SUITES.filter(suite => !placed.includes(suite)).map(suite => `tests/ui/${suite}-browser.mjs is in no set of tests/ui/lib/run-suites.mjs`),
    ...placed.filter(suite => !SUITES.includes(suite)).map(suite => `set suite ${suite} has no tests/ui/${suite}-browser.mjs`),
    ...placed.filter((suite, index) => placed.indexOf(suite) !== index).map(suite => `${suite} is in more than one set`),
    ...(SETS['pull-request'].includes('widgets') ? [] : ['the pull-request set must include the widgets suite (#323)']),
  ];
}

function run(suite, args) {
  return new Promise(done => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(directory, `${suite}-browser.mjs`), ...args], { stdio: 'inherit' });
    child.on('exit', (code, signal) => done({ suite, code: code ?? 1, signal, seconds: Math.round((Date.now() - started) / 1000) }));
    child.on('error', error => done({ suite, code: 1, error: error.message, seconds: Math.round((Date.now() - started) / 1000) }));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      playwright: { type: 'string' }, edge: { type: 'string' }, sharp: { type: 'string' },
      set: { type: 'string' }, repeat: { type: 'string', default: '1' }, list: { type: 'boolean' },
      'skip-frame-budget': { type: 'boolean' },
    },
  });
  const problems = checkSets();
  if (values.list) {
    for (const [set, suites] of Object.entries(SETS)) console.log(`${set}: ${suites.join(' ') || '(none)'}`);
  }
  if (problems.length) { for (const problem of problems) console.error(problem); process.exit(1); }
  if (values.list) process.exit(0);
  if (values.set && !SETS[values.set]) { console.error(`Unknown set ${values.set}; sets: ${Object.keys(SETS).join(', ')}`); process.exit(1); }
  const chosen = values.set ? SETS[values.set] : positionals.length ? positionals : SUITES;
  const unknown = chosen.filter(suite => !SUITES.includes(suite));
  if (unknown.length) { console.error(`Unknown suite(s): ${unknown.join(', ')}; suites: ${SUITES.join(', ')}`); process.exit(1); }
  const repeat = Number(values.repeat);
  if (!Number.isInteger(repeat) || repeat < 1) { console.error('--repeat takes a whole number of runs'); process.exit(1); }
  const common = [...(values.playwright ? ['--playwright', values.playwright] : []), ...(values.edge ? ['--edge', values.edge] : [])];
  const actions = Boolean(process.env.GITHUB_ACTIONS);
  const results = [];
  for (let round = 1; round <= repeat; round++) for (const suite of chosen) {
    const args = [...common, ...(suite === 'preview' && values.sharp ? ['--sharp', values.sharp] : []), ...(suite === 'motion' && values['skip-frame-budget'] ? ['--skip-frame-budget'] : [])];
    const label = repeat > 1 ? `${suite} (run ${round} of ${repeat})` : suite;
    console.log(actions ? `::group::${label}` : `\n=== ${label}`);
    const result = await run(suite, args);
    if (actions) console.log('::endgroup::');
    console.log(`${label}: ${result.code === 0 ? 'pass' : `FAIL (exit ${result.code}${result.signal ? `, ${result.signal}` : ''}${result.error ? `, ${result.error}` : ''})`} in ${result.seconds} s`);
    if (actions && result.code !== 0) console.log(`::error title=Browser suite failed::${label} failed (exit ${result.code}); its output is in the group above`);
    results.push({ ...result, label });
  }
  console.log('\nSummary');
  for (const result of results) console.log(`  ${result.label.padEnd(36)} ${result.code === 0 ? 'pass' : 'FAIL'}  ${String(result.seconds).padStart(4)} s`);
  const failed = results.filter(result => result.code !== 0);
  console.log(`${results.length - failed.length} of ${results.length} passed in ${results.reduce((sum, result) => sum + result.seconds, 0)} s`);
  process.exit(failed.length ? 1 : 0);
}
