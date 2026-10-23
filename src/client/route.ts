/** The app's three pages (#438): Home at `/`, Edit display at `/editor` and the ambient display at `/display`. */
export type Page = 'home' | 'edit' | 'settings' | 'display';

/** Any other extension-less path opens Home, so old bookmarks and typos land somewhere useful. */
export function pageForPath(pathname: string): Page {
  const first = pathname.split('/').find(Boolean) ?? '';
  if (first === 'display') return 'display';
  if (first === 'editor') return 'edit';
  if (first === 'settings') return 'settings';
  return 'home';
}

export const PAGE_TITLES: Record<Page, string> = { home: 'Still · Home', edit: 'Still · Edit display', settings: 'Still · Settings', display: 'Still · Display' };
/** The display window every Open display link targets, shared with #436, so repeated clicks reuse one window. */
export { DISPLAY_WINDOW } from './displayWindow.ts';
