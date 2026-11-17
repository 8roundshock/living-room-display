/**
 * Recovery for a page that outlived an update (#711). Each build now starts from an empty `dist/client`, so after an
 * update the server no longer has the previous build's chunks. A page opened before the update (the display in a
 * browser tab, an editor left open) that then asks for one of them, such as a 3D scene module, gets an error: Vite
 * reports it as `vite:preloadError`, and the 3D layer falls back to the flat scene.
 *
 * The page reloads only when the server's `index.html` names a different entry bundle than the one it runs, that is,
 * when a newer build really is there; then the reload loads that build. If the entry is the same, the chunk is missing
 * for another reason and a reload would not help, so nothing happens. Reloads are also at most one a minute per tab,
 * so a server that keeps changing cannot make a loop. A page with unsaved changes keeps its own `beforeunload` guard:
 * the browser asks before the reload.
 */
export const STALE_BUILD_KEY = 'lrd-stale-build-reload';
export const STALE_BUILD_QUIET_MS = 60_000;

/** The path of the entry bundle an `index.html` names, e.g. `/assets/index-SxD2__3G.js`, or null. */
export function entryOf(html: string): string | null {
  const tag = html.match(/<script\b[^>]*\btype=["']module["'][^>]*>/i)?.[0];
  const src = tag?.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  return src ? new URL(src, 'http://local').pathname : null;
}

/** True when the server serves another build than the one this page runs. */
export async function newerBuildServed(running: string | null, fetcher: typeof fetch): Promise<boolean> {
  if (!running) return false;
  const response = await fetcher('/', { cache: 'no-store', headers: { accept: 'text/html' } });
  if (!response.ok) return false;
  const served = entryOf(await response.text());
  return served !== null && served !== new URL(running, 'http://local').pathname;
}

/** Whether a reload may happen now; records it. Storage that cannot be read or written allows one per page load. */
export function claimReload(storage: Pick<Storage, 'getItem' | 'setItem'> | null, now: number): boolean {
  try {
    const stored = storage?.getItem(STALE_BUILD_KEY) ?? null, last = stored === null ? null : Number(stored);
    if (last !== null && Number.isFinite(last) && now - last >= 0 && now - last < STALE_BUILD_QUIET_MS) return false;
    storage?.setItem(STALE_BUILD_KEY, String(now));
  } catch { /* private mode or blocked storage: the per-page guard below still holds */ }
  return true;
}

interface RecoveryWindow { addEventListener: Window['addEventListener']; sessionStorage?: Storage; location: { reload(): void } }

/** Listens for chunk load failures and reloads into a newer build when one is served. Returns a function that stops. */
export function installStaleBuildRecovery(target: RecoveryWindow = window, doc: Pick<Document, 'querySelector'> = document, fetcher: typeof fetch = (...args) => fetch(...args), clock: () => number = Date.now): () => void {
  const running = doc.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src') ?? null;
  let checking = false, reloaded = false;
  const onError = () => {
    if (checking || reloaded) return;
    checking = true;
    // Not preventDefault: the failed import still throws, so the caller's own fallback (the flat scene) shows meanwhile.
    void newerBuildServed(running, fetcher).then(newer => {
      if (!newer || reloaded) return;
      let storage: Storage | null = null;
      try { storage = target.sessionStorage ?? null; } catch { storage = null; }
      if (!claimReload(storage, clock())) return;
      reloaded = true; target.location.reload();
    }).catch(() => undefined).finally(() => { checking = false; });
  };
  target.addEventListener('vite:preloadError', onError);
  return () => (target as Window).removeEventListener('vite:preloadError', onError);
}
