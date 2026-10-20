import { Icon } from './icons';
import { DISPLAY_WINDOW } from './route';

/**
 * The header Home and Edit display share (#438): the brand goes Home, the Pages nav switches between
 * the two pages, and Open display targets one named window (`still-display`, shared with #436), so
 * repeated clicks reuse that window instead of opening another tab each time. No `rel="noreferrer"`:
 * it would sever the window name. Plain anchors, so Edit display's `beforeunload` still guards a
 * dirty draft. At 480 px or narrower only the other page's link shows and Open display is icon-only.
 */
export function StudioHeader({ page }: { page: 'home' | 'edit' }) {
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
      <a className="button open-display" href="/display" target={DISPLAY_WINDOW} aria-label="Open display">
        <Icon name="monitor" size={17} />
        <span className="open-display-label">Open display</span>
        <Icon name="arrow" size={15} />
      </a>
    </header>
  );
}
