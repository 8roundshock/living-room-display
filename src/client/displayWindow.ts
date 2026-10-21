import { useEffect, useState } from 'react';

/**
 * One display window (#436). The editor opens and reuses a window named `still-display`; a display
 * opened any other way (a typed URL, a bookmark, a second editor) announces itself on a
 * BroadcastChannel, and every older browser display then closes itself or, when the browser does not
 * allow that, shows a calm card and stops floating, polling and holding the screen awake. The native
 * screensaver host is single-instance on its own (the Local\LivingRoomDisplay.Ambient mutex) and runs
 * in its own Edge profile, so it takes no part.
 */
export const DISPLAY_WINDOW = 'still-display';
export const DISPLAY_CHANNEL = 'still-display';
/** How long a retired display waits for window.close() before it shows the card instead. */
export const RETIRE_CARD_DELAY_MS = 200;

interface OpenedMessage { type: 'opened'; id: string; at: number }

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** True once a newer display has opened in another window and this one could not close itself. */
export function useSingleDisplay(active: boolean): boolean {
  const [retired, setRetired] = useState(false);
  useEffect(() => {
    if (!active || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(DISPLAY_CHANNEL);
    const self: OpenedMessage = { type: 'opened', id: newId(), at: Date.now() };
    let timer: number | undefined;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data as Partial<OpenedMessage> | null;
      if (!message || message.type !== 'opened' || typeof message.id !== 'string' || typeof message.at !== 'number' || message.id === self.id) return;
      // The later display wins; two opened in the same millisecond compare their ids.
      if (message.at < self.at || (message.at === self.at && message.id < self.id)) return;
      channel.close();
      try { window.close(); } catch { /* not closable from script */ }
      timer = window.setTimeout(() => setRetired(true), RETIRE_CARD_DELAY_MS);
    };
    channel.postMessage(self);
    return () => { window.clearTimeout(timer); channel.close(); };
  }, [active]);
  return retired;
}

/** The editor window that opened this display, when it is still open and on this origin. */
export function liveOpener(): Window | null {
  try {
    const opener = window.opener as Window | null;
    if (!opener || opener.closed || opener === window) return null;
    // Reading another origin's location throws.
    return opener.location.origin === window.location.origin ? opener : null;
  } catch { return null; }
}

/** Esc, E, Editor or Close display: back to the editor that opened this display, or open the editor here. */
export function leaveDisplay(destination = '/editor'): void {
  const opener = liveOpener();
  if (opener) {
    opener.focus();
    window.close();
    return;
  }
  window.location.assign(destination);
}
