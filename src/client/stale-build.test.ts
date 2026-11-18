import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { claimReload, entryOf, installStaleBuildRecovery, newerBuildServed, STALE_BUILD_KEY, STALE_BUILD_QUIET_MS } from './stale-build.ts';

// #711: each build starts from an empty dist/client, so a page that outlived an update reloads into the new build when
// it misses one of the old chunks, once, and never loops.
const html = (entry: string) => `<!doctype html><html><head><script type="module" crossorigin src="/assets/${entry}"></script><link rel="stylesheet" crossorigin href="/assets/index-Cs7Od02B.css"></head><body><div id="root"></div></body></html>`;
const served = (entry: string, ok = true) => (async () => new Response(html(entry), { status: ok ? 200 : 503 })) as unknown as typeof fetch;
class MemoryStorage { values = new Map<string, string>(); getItem(key: string) { return this.values.get(key) ?? null; } setItem(key: string, value: string) { this.values.set(key, value); } }
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function page(running: string, fetcher: typeof fetch, storage: MemoryStorage | null = new MemoryStorage(), now = { at: 1_000_000 }) {
  const listeners = new Map<string, () => void>(), reloads = { count: 0 }, fetches = { count: 0 };
  const counted = ((...args: Parameters<typeof fetch>) => { fetches.count++; return fetcher(...args); }) as typeof fetch;
  const target = { addEventListener: (type: string, listener: () => void) => { listeners.set(type, listener); }, removeEventListener: () => undefined,
    sessionStorage: storage, location: { reload: () => { reloads.count++; } } };
  const doc = { querySelector: () => ({ getAttribute: () => `/assets/${running}` }) };
  installStaleBuildRecovery(target as never, doc as never, counted, () => now.at);
  return { fire: () => listeners.get('vite:preloadError')?.(), reloads, fetches, now, storage };
}

test('entryOf reads the entry bundle a built index.html names', () => {
  assert.equal(entryOf(html('index-SxD2__3G.js')), '/assets/index-SxD2__3G.js');
  assert.equal(entryOf('<script type="module" src="/src/client/main.tsx"></script>'), '/src/client/main.tsx', 'the dev server page');
  assert.equal(entryOf('<html><body>Client file not found</body></html>'), null);
});

test('A newer build is served only when the server’s index.html names another entry bundle', async () => {
  assert.equal(await newerBuildServed('/assets/index-OLD.js', served('index-NEW.js')), true);
  assert.equal(await newerBuildServed('/assets/index-SAME.js', served('index-SAME.js')), false);
  assert.equal(await newerBuildServed('http://127.0.0.1:4318/assets/index-SAME.js', served('index-SAME.js')), false, 'an absolute src compares by path');
  assert.equal(await newerBuildServed('/assets/index-OLD.js', served('index-NEW.js', false)), false, 'a server that is not ready');
  assert.equal(await newerBuildServed(null, served('index-NEW.js')), false);
});

test('At most one reload a minute per tab; storage that cannot be used still allows the first', () => {
  const storage = new MemoryStorage();
  assert.equal(claimReload(storage, 1_000_000), true); assert.equal(storage.getItem(STALE_BUILD_KEY), '1000000');
  assert.equal(claimReload(storage, 1_000_000 + STALE_BUILD_QUIET_MS - 1), false);
  assert.equal(claimReload(storage, 1_000_000 + STALE_BUILD_QUIET_MS), true);
  assert.equal(claimReload({ getItem: () => { throw new Error('blocked'); }, setItem: () => undefined }, 5), true);
  assert.equal(claimReload(null, 5), true);
});

test('A missed chunk reloads into a newer build once, and never when the same build is served', async () => {
  const updated = page('index-OLD.js', served('index-NEW.js'));
  updated.fire(); updated.fire(); await settle();
  assert.deepEqual([updated.reloads.count, updated.fetches.count], [1, 1], 'two failures at once: one check, one reload');
  updated.fire(); await settle();
  assert.equal(updated.reloads.count, 1, 'this page has reloaded already');
  // After the reload the tab is a new page with the same session storage: within a minute it does not reload again,
  // even if the server still names another bundle (a server that keeps changing cannot make a loop).
  const again = page('index-OLD.js', served('index-NEW.js'), updated.storage, { at: updated.now.at + 5_000 });
  again.fire(); await settle();
  assert.equal(again.reloads.count, 0);
  const same = page('index-SAME.js', served('index-SAME.js'));
  same.fire(); await settle(); same.fire(); await settle();
  assert.deepEqual([same.reloads.count, same.fetches.count], [0, 2], 'the chunk is missing for another reason: no reload');
  const down = page('index-OLD.js', (async () => { throw new Error('offline'); }) as unknown as typeof fetch);
  down.fire(); await settle();
  assert.equal(down.reloads.count, 0, 'an unreachable server: no reload, no error');
});

test('The client build starts empty and is checked; the page installs the recovery', () => {
  const read = (path: string) => readFileSync(new URL(path, new URL('../../', import.meta.url)), 'utf8');
  assert.match(read('vite.config.ts'), /outDir: 'dist\/client', emptyOutDir: true/);
  assert.match(read('package.json'), /vite build && node scripts\/check-client-build\.mjs/);
  assert.match(read('src/client/main.tsx'), /installStaleBuildRecovery\(\);/);
  assert.match(read('windows/installer/tests/Test-InstallerPayload.ps1'), /index-\*\.js bundles; expected exactly 1/);
});
