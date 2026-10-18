import { useEffect, useRef, useState } from 'react';
import type { AirQualityState, Settings } from '../shared/contracts';
import { api } from './api';

const REFRESH_MS = 5 * 60_000;

/**
 * Editor-only Air quality preview. While the draft shows Air quality but the saved state has no
 * reading for its scale (the widget is not saved enabled, or the scale changed), fetch
 * /api/air-quality for the draft scale and refresh every 5 minutes. Cancel clears it at once;
 * after Save it is kept until the next /api/state carries the saved reading, so the canvas never
 * blinks back to "not loaded". The provider is only reached through the local server.
 */
export function useAirQualityPreview(draft: Settings, saved: AirQualityState | undefined): AirQualityState | null {
  const scale = draft.widgetData.airQuality.scale;
  const needed = draft.widgets.airQuality && (!saved || saved.status === 'off' || saved.scale !== scale);
  const [preview, setPreview] = useState<AirQualityState | null>(null);
  const epoch = useRef(0);
  useEffect(() => {
    const current = ++epoch.current;
    if (!needed) { setPreview(null); return; }
    let controller: AbortController | undefined;
    const load = async () => {
      controller?.abort(); controller = new AbortController();
      try {
        const result = await api<AirQualityState>(`/api/air-quality?scale=${scale}`, { signal: controller.signal });
        if (current === epoch.current && result.scale === scale) setPreview(result);
      } catch {
        // An aborted or failed preview shows the honest saved state (off or unavailable), never clean air.
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, REFRESH_MS);
    return () => { window.clearInterval(timer); controller?.abort(); };
  }, [needed, scale]);
  return needed && preview?.scale === scale ? preview : null;
}
