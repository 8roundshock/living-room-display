import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { AppState } from '../shared/contracts';
import { api } from './api';
import { AmbientDisplay } from './Display';
import { Editor } from './Editor';

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const request = useRef(0);
  const updateState = useCallback<Dispatch<SetStateAction<AppState | null>>>(
    (update) => {
      revision.current++;
      setState(update);
    },
    [],
  );
  const display = window.location.pathname.startsWith('/display');
  const standaloneDisplay = display && window.self === window.top;
  useLayoutEffect(() => {
    if (!standaloneDisplay) return;
    // Cover loading/error states and descendant controls before paint. The
    // editor's embedded component never changes the document cursor.
    document.documentElement.classList.add('standalone-display');
    return () =>
      document.documentElement.classList.remove('standalone-display');
  }, [standaloneDisplay]);
  const reload = useCallback(async () => {
    const startedAt = revision.current;
    const requestId = ++request.current;
    try {
      const received = await api<AppState>('/api/state');
      if (requestId === request.current && startedAt === revision.current) {
        setState(received);
        setError(null);
      }
    } catch (caught) {
      if (requestId === request.current)
        setError(
          caught instanceof Error
            ? caught.message
            : 'Cannot reach the local display server.',
        );
    }
  }, []);
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => {
      void reload();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    document.title = display ? 'Still · Display' : 'Still · Your room';
  }, [display]);

  if (!state)
    return (
      <main className={`loading-page ${display ? 'display-fallback' : ''}`}>
        <div className="fallback-content" key={error ? 'error' : 'loading'}>
          {error ? (
            <>
              <p>{display ? 'Display unavailable' : error}</p>
              <button
                className="button"
                onClick={() => {
                  void reload();
                }}
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <div className="loading-orbit" />
              <p>{display ? 'Opening display…' : 'Opening your room…'}</p>
            </>
          )}
        </div>
      </main>
    );
  if (display)
    return <AmbientDisplay state={state} disconnected={error !== null} />;
  return (
    <Editor
      state={state}
      setState={updateState}
      connectionError={error}
      reload={reload}
    />
  );
}
