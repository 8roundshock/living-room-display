// Runs the browser suites (tests/ui/*-browser.mjs) one after another, each in its own Node process with
// its own isolated loopback server and temporary synthetic data, and prints how long each took. CI runs
// one set per job (.github/workflows/browser-suites.yml, #323); locally, run every suite or name some.
//
//   node tests/ui/lib/run-suites.mjs --playwright <module> --edge <browser> --sharp <module> [suite ...]
//   node tests/ui/lib/run-suites.mjs ... --set pull-request       the suites CI runs on every pull request
//   node tests/ui/lib/run-suites.mjs ... --set pull-request --shard 2   only the second shard of that set
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
 * The CI sets. Owner direction, 2026-11-10 (#603): a pull request must not wait half an hour, so the
 * pull-request set is split into shards of about 90 seconds of test time that run on parallel runners
 * (seconds measured on windows-2025 in brackets), and the three slow suites moved to `main`.
 * `main` runs on pushes to main and weekly: widgets (833), home (227), catalog-sky (141).
 * `scheduled` adds the slowest motion and data suites on the weekly and manual runs.
 * Every suite belongs to exactly one set, so a new suite fails the runner until it is placed.
 */
export const SHARDS = {
  'pull-request': [
    ['workspace'], // 90
    ['themes'], // 83
    ['grid', 'display-controls', 'shared-snapshot', 'snapshot-resume'], // 71, 6, 3, 7
    ['studio', 'settings'], // 64, 21
    ['styles', 'schedule'], // 59, 30
    ['dynamic', 'reminders'], // 44, 41
    ['catalog-time', 'canvas-scope', 'screen'], // 38, 32, 19
    ['freesize', 'daylight', 'picker-sheet'], // 29, 21, 16
    ['first-run', 'preview', 'editor-sync', 'context-help', 'motion-preview'], // 13, 12, 12, 10, 9
    ['scene3d'], // WebGL on the runner's software rasteriser (#600): every mount compiles its shaders on the processor
  ],
  main: [['widgets'], ['home'], ['catalog-sky']],
  scheduled: [['motion', 'weather', 'palette', 'collection']], // 219, 81, 68
};
export const SETS = Object.fromEntries(Object.entries(SHARDS).map(([set, shards]) => [set, shards.flat()]));

export function checkSets() {
  const placed = Object.values(SETS).flat();
  return [
    ...SUITES.filter(suite => !placed.includes(suite)).map(suite => `tests/ui/${suite}-browser.mjs is in no set of tests/ui/lib/run-suites.mjs`),
    ...placed.filter(suite => !SUITES.includes(suite)).map(suite => `set suite ${suite} has no tests/ui/${suite}-browser.mjs`),
    ...placed.filter((suite, index) => placed.indexOf(suite) !== index).map(suite => `${suite} is in more than one set`),
    ...(SETS.main.includes('widgets') ? [] : ['the main set must include the widgets suite (#323, #603)']),
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
      set: { type: 'string' }, shard: { type: 'string' }, repeat: { type: 'string', default: '1' }, list: { type: 'boolean' },
      'no-gpu': { type: 'boolean' },
    },
  });
  const problems = checkSets();
  if (values.list) {
    for (const [set, shards] of Object.entries(SHARDS)) shards.forEach((suites, index) => console.log(`${set} ${index + 1}/${shards.length}: ${suites.join(' ')}`));
  }
  if (problems.length) { for (const problem of problems) console.error(problem); process.exit(1); }
  if (values.list) process.exit(0);
  if (values.set && !SETS[values.set]) { console.error(`Unknown set ${values.set}; sets: ${Object.keys(SETS).join(', ')}`); process.exit(1); }
  const shard = values.shard === undefined ? undefined : Number(values.shard);
  if (shard !== undefined && !(values.set && Number.isInteger(shard) && shard >= 1 && shard <= SHARDS[values.set].length)) { console.error('--shard takes a shard number of the chosen --set'); process.exit(1); }
  const chosen = values.set ? (shard ? SHARDS[values.set][shard - 1] : SETS[values.set]) : positionals.length ? positionals : SUITES;
  const unknown = chosen.filter(suite => !SUITES.includes(suite));
  if (unknown.length) { console.error(`Unknown suite(s): ${unknown.join(', ')}; suites: ${SUITES.join(', ')}`); process.exit(1); }
  const repeat = Number(values.repeat);
  if (!Number.isInteger(repeat) || repeat < 1) { console.error('--repeat takes a whole number of runs'); process.exit(1); }
  const common = [...(values.playwright ? ['--playwright', values.playwright] : []), ...(values.edge ? ['--edge', values.edge] : [])];
  const actions = Boolean(process.env.GITHUB_ACTIONS);
  const results = [];
  for (let round = 1; round <= repeat; round++) for (const suite of chosen) {
    const args = [...common, ...(suite === 'preview' && values.sharp ? ['--sharp', values.sharp] : []), ...(suite === 'motion' && values['no-gpu'] ? ['--no-gpu'] : [])];
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
