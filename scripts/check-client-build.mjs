// Runs after `vite build` (#711): the built client holds this build only. The installer copies the whole dist folder,
// so an old chunk left here would ship. Fails when dist/client/assets has other than one index-*.js, when index.html
// names another one, or when the server build is missing (emptying the client output must never touch it).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function clientBuildProblems(root) {
  const at = path => fileURLToPath(new URL(path, root)), problems = [];
  if (!existsSync(at('dist/server/index.js'))) problems.push('dist/server/index.js is missing: the client build must not empty the server output');
  if (!existsSync(at('dist/client/index.html'))) return [...problems, 'dist/client/index.html is missing'];
  const entries = readdirSync(at('dist/client/assets')).filter(name => /^index-[\w-]+\.js$/.test(name));
  if (entries.length !== 1) problems.push(`dist/client/assets has ${entries.length} index-*.js bundles, expected exactly 1: ${entries.join(', ')}`);
  const named = readFileSync(at('dist/client/index.html'), 'utf8').match(/<script\b[^>]*\bsrc="\/assets\/(index-[\w-]+\.js)"/)?.[1];
  if (!named || !entries.includes(named)) problems.push(`dist/client/index.html names ${named ?? 'no entry bundle'}, which is not the built one`);
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = clientBuildProblems(new URL('../', import.meta.url));
  if (problems.length) { for (const problem of problems) console.error(`check-client-build: ${problem}`); process.exit(1); }
  console.log('check-client-build: one index bundle, named by index.html; the server build is in place.');
}
