import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { AppState, ChangeMarker } from '../shared/contracts';
import { scheduledSettings } from '../shared/schedule';
import { ApiError, api, apiTagged, rememberRevision } from './api';
import { AmbientDisplay } from './Display';
import { useSingleDisplay } from './displayWindow';
import { Editor } from './Editor';
import { Home } from './Home';
import { SettingsPage } from './SettingsPage';
import { PAGE_TITLES, pageForPath } from './route';

/** Home and the display pick up a change made elsewhere within about this long, while visible (#438). */
const CHANGE_POLL_MS = 5_000;

interface LoadError {
  message: string;
  /** No answer from the server at all, as opposed to an answer with an error. */
  network: boolean;
}
const POLL_MS = 30_000;
/**
 * While the server is still fetching the forecast or air quality (it answers after a short wait
 * rather than with the provider, #351), ask again this soon, at most this many times in a row.
 * The provider's own 8 s timeout ends a refresh well within that.
 */
const REFRESH_POLL_MS = 2_000;
const REFRESH_POLLS = 5;

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [retrying, setRetrying] = useState(false);
  // When the latest state request that reached the server was sent (`performance.now()`), so the
  // editor can clear an error caused by an earlier lost connection (#232).
  const [reachedAt, setReachedAt] = useState(0);
  const revision = useRef(0);
  const request = useRef(0);
  const refreshPoll = useRef<{ timer: number | undefined; count: number }>({ timer: undefined, count: 0 });
  const updateState = useCallback<Dispatch<SetStateAction<AppState | null>>>(
    (update) => {
      revision.current++;
      setState(update);
    },
    [],
  );
  const legacyCity = pageForPath(window.location.pathname) === 'edit' && new URLSearchParams(window.location.search).get('focus') === 'city';
  const page = legacyCity ? 'settings' : pageForPath(window.location.pathname);
  useEffect(() => { if (legacyCity) window.location.replace('/settings?focus=city'); }, [legacyCity]);
  const display = page === 'display';
  const nativeDisplay = display && window.self === window.top && new URLSearchParams(window.location.search).get('native') === '1';
  // #436 one display window: a newer browser display retires this one (it closes, or shows a card and
  // stops polling, floating and holding the screen awake). The native screensaver page is single-instance on its own.
  const retired = useSingleDisplay(display && !nativeDisplay && window.self === window.top);
  // A request still in flight when the display retires must not start the early refresh polls again.
  const polling = useRef(true);
  polling.current = !retired;
  useLayoutEffect(() => {
    if (!nativeDisplay) return;
    // Cover loading/error states and descendant controls before paint. The
    // editor's embedded component never changes the document cursor.
    document.documentElement.classList.add('native-display');
    return () =>
      document.documentElement.classList.remove('native-display');
  }, [nativeDisplay]);
  const reload = useCallback(async () => {
    const startedAt = revision.current;
    const requestId = ++request.current;
    const sentAt = performance.now();
    try {
      const { body: received, etag } = await apiTagged<AppState>('/api/state');
      // The settings revision travels with these settings, for the editor's If-Match (#287).
      rememberRevision(received.settings, etag);
      setReachedAt((previous) => Math.max(previous, sentAt));
      if (requestId === request.current && startedAt === revision.current) {
        setState(received);
        setError(null);
      }
      // One bounded early poll while a provider refresh is still running (#351).
      const poll = refreshPoll.current;
      if (!received.weather.refreshing && !received.airQuality?.refreshing && !received.alerts?.refreshing) poll.count = 0;
      else if (polling.current && poll.timer === undefined && poll.count < REFRESH_POLLS) {
        poll.count++;
        poll.timer = window.setTimeout(() => {
          poll.timer = undefined;
          void reload();
        }, REFRESH_POLL_MS);
      }
    } catch (caught) {
      if (caught instanceof ApiError && !caught.network)
        setReachedAt((previous) => Math.max(previous, sentAt));
      if (requestId === request.current)
        setError({
          message:
            caught instanceof Error
              ? caught.message
              : 'Cannot reach the local display server.',
          network: !(caught instanceof ApiError) || caught.network,
        });
    }
  }, []);
  useEffect(() => {
    if (retired) return;
    void reload();
    const timer = window.setInterval(() => {
      void reload();
    }, POLL_MS);
    const poll = refreshPoll.current;
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(poll.timer);
      poll.timer = undefined;
    };
  }, [reload, retired]);
  // Home, the display and schedule status ask whether anything changed every 5 s while visible,
  // and reload state only when it has. A lost connection reloads at once, so
  // Home and the display say they are offline without waiting for the 30 s poll.
  useEffect(() => {
    if (retired) return;
    let marker: string | null = null, failed = false, busy = false, stopped = false;
    const check = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const { change } = await api<ChangeMarker>('/api/changes');
        // Reload after a change, and once the server answers again after a lost connection.
        if (!stopped && ((marker !== null && change !== marker) || failed)) void reload();
        marker = change; failed = false;
      } catch (caught) {
        if (!stopped && !failed && caught instanceof ApiError && caught.network) { failed = true; void reload(); }
      } finally { busy = false; }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, CHANGE_POLL_MS);
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [page, reload, retired]);
  useEffect(() => {
    // Home keeps the title current itself once it shows ("Done · Still · Home" while a timer is done).
    document.title = PAGE_TITLES[page];
  }, [page]);

  if (retired)
    return (
      <main className="display-retired">
        <div className="display-retired-card" role="status">
          <p>The display is open in another window.</p>
          <p>Close this tab (Ctrl+W).</p>
        </div>
      </main>
    );
  if (!state)
    return (
      <main className={`loading-page ${display ? 'display-fallback' : ''}`}>
        <div className="fallback-content" key={error ? 'error' : 'loading'}>
          {error ? (
            <>
              {display ? (
                <p>Display unavailable</p>
              ) : (
                <div className="fallback-message" role="alert">
                  <p className="fallback-title">
                    {error.network
                      ? "Can't reach the display server on this computer."
                      : error.message}
                  </p>
                  <p className="fallback-hint">
                    {error.network
                      ? page === 'home'
                        ? 'Home needs the display server that runs on this computer. It may still be starting, or it may have stopped. Try again in a moment; if it keeps failing, restart the app.'
                        : 'The app needs the display server that runs on this computer. Try again in a moment; if it keeps failing, restart the app.'
                      : 'The display server answered but could not open your settings. Try again in a moment.'}
                  </p>
                </div>
              )}
              <button
                className="button"
                aria-busy={retrying}
                onClick={() => {
                  if (retrying) return;
                  setRetrying(true);
                  void reload().finally(() => setRetrying(false));
                }}
              >
                {retrying ? 'Trying again…' : 'Try again'}
              </button>
            </>
          ) : (
            <>
              <div className="loading-orbit" />
              <p>{display ? 'Opening display…' : page === 'home' ? 'Opening Home…' : 'Opening your room…'}</p>
            </>
          )}
        </div>
      </main>
    );
  if (display)
    return <div className={state.schedule?.config.enabled ? 'schedule-display' : undefined}><AmbientDisplay state={state} settings={scheduledSettings(state.settings, state.schedule)} disconnected={error !== null} native={nativeDisplay} /></div>;
  if (page === 'home')
    return (
      <Home
        state={state}
        setState={updateState}
        connectionError={error?.message ?? null}
        disconnected={error !== null && error.network}
        reload={reload}
      />
    );
  if (page === 'settings') return <SettingsPage state={state} setState={updateState} connectionError={error?.message ?? null} reload={reload} />;
  return (
    <Editor
      state={state}
      setState={updateState}
      connectionError={error?.message ?? null}
      serverReachedAt={reachedAt}
      reload={reload}
    />
  );
}
