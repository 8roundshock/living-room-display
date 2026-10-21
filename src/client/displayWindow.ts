import { useEffect, useRef, useState, type MouseEvent } from 'react';

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

/** Return to the opener, or close a display it opened even if the opener has since closed (#480). */
export function leaveDisplay(destination = '/editor', opened = false): void {
  const opener = liveOpener();
  if (opener || opened) {
    try { opener?.focus(); } catch { /* the opener may close between checking and focusing */ }
    try { window.close(); } catch { /* fall back when the browser refuses to close */ }
    window.setTimeout(() => { if (!window.closed) window.location.assign(destination); }, RETIRE_CARD_DELAY_MS);
    return;
  }
  window.location.assign(destination);
}

export interface DisplayWindowControls {
  displayOpen: boolean;
  openDisplay: (event: MouseEvent<HTMLAnchorElement>) => void;
  closeDisplay: () => void;
}

/** One controller per Home/editor page; the Home card and header share its live window (#513). */
export function useDisplayWindow(): DisplayWindowControls {
  const displayWindow = useRef<Window | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  useEffect(() => {
    const check = () => setDisplayOpen(displayWindow.current !== null && displayWindow.current.closed === false);
    const timer = window.setInterval(check, 1000);
    window.addEventListener('focus', check);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', check); };
  }, []);
  function openDisplay(event: MouseEvent<HTMLAnchorElement>) {
    // Modified clicks (a new tab on purpose) keep the browser's own behaviour.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const current = displayWindow.current;
    const win = current?.closed === false ? current : window.open('', DISPLAY_WINDOW);
    if (!win) { window.location.assign('/display'); return; }
    try {
      if (win.location.pathname !== '/display') win.location.replace('/display');
    } catch {
      win.location.replace('/display');
    }
    win.focus();
    displayWindow.current = win;
    setDisplayOpen(true);
  }
  function closeDisplay() {
    displayWindow.current?.close();
    displayWindow.current = null;
    setDisplayOpen(false);
  }
  return { displayOpen, openDisplay, closeDisplay };
}
