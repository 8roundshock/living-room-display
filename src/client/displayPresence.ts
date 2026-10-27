import { useEffect, useState } from 'react';
import { api } from './api.ts';

/** Register before painting a browser display, so the producer cannot photograph its own board. */
export function useDisplayPresence(active: boolean) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active) { setReady(false); return; }
    let stopped = false, id: string | null = null, opening = false;
    const send = <T,>(body: object, keepalive = false) => api<T>('/api/preview/display', {
      method: 'POST', headers: { 'X-LRD-Display': '1' }, body: JSON.stringify(body), keepalive,
    });
    const release = () => {
      const previous = id; id = null; setReady(false);
      if (previous) void send({ action: 'release', id: previous }, true).catch(() => {});
    };
    const open = async () => {
      if (opening || id || stopped || document.visibilityState !== 'visible') return;
      opening = true;
      try {
        const result = await send<{ id: string }>({ action: 'start' });
        if (stopped || document.visibilityState !== 'visible') { void send({ action: 'release', id: result.id }, true).catch(() => {}); return; }
        id = result.id; setFailed(false); setReady(true);
      } catch { if (!stopped) setFailed(true); }
      finally { opening = false; }
    };
    const visibility = () => { if (document.visibilityState !== 'visible') release(); else void open(); };
    const timer = window.setInterval(() => {
      if (!id || document.visibilityState !== 'visible') return;
      const current = id;
      void send({ action: 'heartbeat', id: current }).catch(() => {
        if (!stopped && id === current) { setReady(false); setFailed(true); }
      });
    }, 5_000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', release);
    void open();
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', release); release(); };
  }, [active]);
  return { ready: !active || ready, failed };
}
