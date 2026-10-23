import { useEffect, useState } from 'react';

/** What the display reports on `.grid-ambient[data-wake-lock]` (#436). Nothing appears on screen. */
export type WakeLockState = 'held' | 'unsupported' | 'denied' | 'off';

/** After a rejected request, try again at most this often while the lock is still wanted. */
export const WAKE_LOCK_RETRY_MS = 10_000;

interface Sentinel extends EventTarget { released: boolean; release(): Promise<void> }
interface WakeLockApi { request(type: 'screen'): Promise<Sentinel> }

function wakeLockApi(): WakeLockApi | null {
  const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  return api && typeof api.request === 'function' ? api : null;
}

let deniedLogged = false;

/**
 * Keep the screen on (#436, `screen.keepAwake`): a Screen Wake Lock held only while the display is
 * visible and either the native screensaver page (`native`) or full screen. Never in a windowed tab:
 * Edge's request is "display required", which also blocks the Windows screensaver and display-off,
 * so a forgotten display tab must not hold it. Windows' own power settings apply the rest of the time.
 */
export function useWakeLock(enabled: boolean, native: boolean): WakeLockState {
  const [state, setState] = useState<WakeLockState>(() => !enabled ? 'off' : wakeLockApi() ? 'off' : 'unsupported');
  useEffect(() => {
    const api = wakeLockApi();
    if (!enabled) { setState('off'); return; }
    if (!api) { setState('unsupported'); return; }
    let sentinel: Sentinel | null = null, pending = false, disposed = false, failedAt = -Infinity;
    let retry: number | undefined;
    const wanted = () => !disposed && document.visibilityState === 'visible' && (native || document.fullscreenElement !== null);
    const release = () => {
      const held = sentinel; sentinel = null;
      if (held && !held.released) void held.release().catch(() => undefined);
    };
    const onRelease = (event: Event) => {
      if (event.target !== sentinel) return;
      sentinel = null;
      // The browser releases the lock when the page is hidden; ask again once it is wanted.
      if (wanted()) update(); else setState('off');
    };
    const update = () => {
      window.clearTimeout(retry);
      if (!wanted()) { release(); if (!disposed) setState('off'); return; }
      if (sentinel || pending) return;
      const wait = failedAt + WAKE_LOCK_RETRY_MS - performance.now();
      if (wait > 0) { retry = window.setTimeout(update, wait); return; }
      pending = true;
      api.request('screen').then(lock => {
        pending = false;
        if (!wanted()) { void lock.release().catch(() => undefined); if (!disposed) setState('off'); return; }
        sentinel = lock; lock.addEventListener('release', onRelease);
        setState('held');
      }, (error: unknown) => {
        pending = false; failedAt = performance.now();
        if (disposed) return;
        setState('denied');
        if (!deniedLogged) {
          deniedLogged = true;
          console.info(`Keep the screen on: the browser did not allow a screen wake lock (${error instanceof Error ? error.name : 'denied'}). Windows power settings apply.`);
        }
        if (wanted()) retry = window.setTimeout(update, WAKE_LOCK_RETRY_MS);
      });
    };
    document.addEventListener('visibilitychange', update);
    document.addEventListener('fullscreenchange', update);
    update();
    return () => {
      disposed = true; window.clearTimeout(retry);
      document.removeEventListener('visibilitychange', update);
      document.removeEventListener('fullscreenchange', update);
      release();
    };
  }, [enabled, native]);
  return state;
}
