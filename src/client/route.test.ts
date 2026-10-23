import test from 'node:test';
import assert from 'node:assert/strict';
import { pageForPath } from './route.ts';

test('#438 / is Home, /editor is Edit display, /display is the display and any other path opens Home', () => {
  const cases: [string, ReturnType<typeof pageForPath>][] = [
    ['/', 'home'], ['', 'home'], ['/home', 'home'], ['/somewhere/else', 'home'], ['/editors', 'home'], ['/displays', 'home'],
    ['/editor', 'edit'], ['/editor/', 'edit'], ['/editor/anything', 'edit'],
    ['/settings', 'settings'], ['/settings/', 'settings'], ['/settings/anything', 'settings'], ['/settings-extra', 'home'],
    ['/display', 'display'], ['/display/', 'display'], ['//display', 'display'],
  ];
  for (const [path, page] of cases) assert.equal(pageForPath(path), page, path);
});
