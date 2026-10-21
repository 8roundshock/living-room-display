import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { DISPLAY_WINDOW } from './displayWindow';

/**
 * The header Home and Edit display share (#438): the brand goes Home, the Pages nav switches between
 * the two pages, and Open display targets one named window (`still-display`, shared with #436), so
 * repeated clicks reuse that window instead of opening another tab each time. No `rel="noreferrer"`:
 * it would sever the window name. Plain anchors, so Edit display's `beforeunload` still guards a
 * dirty draft. At 480 px or narrower only the other page's link shows and Open display is icon-only.
 */
export function StudioHeader({ page }: { page: 'home' | 'edit' }) {
  const displayWindow = useRef<Window | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  useEffect(() => {
    const check = () => setDisplayOpen(displayWindow.current !== null && displayWindow.current.closed === false);
    const timer = window.setInterval(check, 1000);
    window.addEventListener('focus', check);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', check); };
  }, []);
  function openDisplay(event: React.MouseEvent<HTMLAnchorElement>) {
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
  const pages = [
    { id: 'home', href: '/', label: 'Home', icon: 'home' },
    { id: 'edit', href: '/editor', label: 'Edit display', icon: 'edit' },
  ] as const;
  return (
    <header className="studio-header">
      <a className="brand" href="/" aria-label="Still home">
        <span className="brand-symbol">
          <Icon name="moon" size={20} />
        </span>
        still
      </a>
      <nav className="studio-pages" aria-label="Pages">
        {pages.map((item) => (
          <a
            key={item.id}
            className={`studio-page-link ${item.id === page ? 'current' : ''}`}
            href={item.href}
            aria-current={item.id === page ? 'page' : undefined}
          >
            <Icon name={item.icon} size={16} />
            {item.label}
          </a>
        ))}
      </nav>
      <div className="open-display-group">
        <p className="open-display-hint" id="open-display-hint">
          For full screen on this PC: Start &gt; Living Room Display - Show display, or press F
          on the display
        </p>
        <div className="display-window-actions">
          {displayOpen && <button className="button close-display" onClick={closeDisplay} aria-label="Close display" title="Close display"><Icon name="close" size={15} /><span className="close-display-label">Close display</span></button>}
        <a className="button open-display" href="/display" target={DISPLAY_WINDOW} onClick={openDisplay} aria-label={displayOpen ? 'Show display' : 'Open display'} aria-describedby="open-display-hint">
          <Icon name="monitor" size={17} />
          <span className="open-display-label">{displayOpen ? 'Show display' : 'Open display'}</span>
          <Icon name="arrow" size={15} />
        </a>
        </div>
      </div>
    </header>
  );
}
