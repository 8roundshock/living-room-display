/** Private native presentation protocol; ordinary browser titles never signal readiness. */
export const NATIVE_STARTING_TITLE = 'Still · Starting display';
export const NATIVE_READY_TITLE = 'Still · Display · Ready';

export interface NativePaintHost {
  fontsReady: Promise<unknown>;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
  boardMounted(): boolean;
  loading(): void;
  reveal(): void;
  ready(): void;
}

/**
 * A mounted app/title is not a painted board. Wait for fonts, a committed board,
 * and a paint after releasing its startup cover before publishing the marker.
 * Cancellation revokes readiness and every late callback is inert.
 */
export function prepareNativeDisplay(host: NativePaintHost, hasState: boolean): () => void {
  let cancelled = false, frame: number | undefined;
  host.loading();
  const next = (callback: () => void) => {
    frame = host.requestFrame(() => {
      frame = undefined;
      if (!cancelled) callback();
    });
  };
  if (hasState) void host.fontsReady.then(() => {
    if (cancelled) return;
    next(() => {
      if (!host.boardMounted()) return;
      next(() => {
        if (!host.boardMounted()) return;
        host.reveal();
        next(() => { if (host.boardMounted()) host.ready(); });
      });
    });
  }).catch(() => { /* Failed preparation stays covered; the native timeout owns exit. */ });
  return () => {
    cancelled = true;
    if (frame !== undefined) host.cancelFrame(frame);
    host.loading();
  };
}
