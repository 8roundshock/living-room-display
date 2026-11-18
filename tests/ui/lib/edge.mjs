// Headless Microsoft Edge for the browser suites and tools (#708). Every tests/ui/*-browser.mjs, tests/ui/tools/*.mjs
// and windows/tests/Test-CursorBrowser.mjs launches Edge through launchEdge, never through chromium.launch directly
// (tests/ui/lib/edge.test.mjs checks the sources).
//
// Why: on Windows, Edge registers each tab with the shell ("Alt+Tab shows … tabs in Microsoft Edge"). For a headless
// page Explorer makes a proxy window that headless Edge never unregisters, so every page a suite opened stayed in
// Alt+Tab, titled with the page title, until Explorer restarted. The Edge feature msWindowTabManagerPublic does the
// registering; disabling it creates no proxy.
//
// The catch: Edge, like Chromium, keeps only the LAST --disable-features switch, and Playwright already passes its own
// list. A suite that simply added --disable-features=msWindowTabManagerPublic would switch Playwright's defaults back
// on. So the helper passes one merged list (Playwright's own, ours and any the caller gave), which Playwright places
// after its own, and checks the real command line after each launch: the last --disable-features must hold every
// feature an earlier one disabled, and ours. When a Playwright update changes its list, the check fails and names
// what to add to PLAYWRIGHT_DISABLED_FEATURES.

/** The Playwright the suites are pinned to (CI: PLAYWRIGHT_VERSION in .github/workflows/browser-suites.yml). */
export const PLAYWRIGHT_VERSION = '1.62.1';
/** Playwright 1.62.1's own --disable-features list, in its order (playwright-core, chromiumSwitches.ts). */
export const PLAYWRIGHT_DISABLED_FEATURES = Object.freeze([
  'AvoidUnnecessaryBeforeUnloadCheckSync', 'BoundaryEventDispatchTracksNodeRemoval', 'DestroyProfileOnBrowserClose',
  'DialMediaRouteProvider', 'GlobalMediaControls', 'HttpsUpgrades', 'LensOverlay', 'MediaRouter', 'PaintHolding',
  'ThirdPartyStoragePartitioning', 'BlockOriginHeaderModificationOnRedirect', 'Translate', 'AutoDeElevate',
  'OptimizationHints', 'msForceBrowserSignIn', 'msEdgeUpdateLaunchServicesPreferredVersion',
]);
/** What the suites disable on top (#708): msWindowTabManagerPublic, so headless pages leave no Alt+Tab entry. */
export const EXTRA_DISABLED_FEATURES = Object.freeze(['msWindowTabManagerPublic']);

const SWITCH = '--disable-features=';
const featuresOf = value => value.slice(SWITCH.length).split(',').map(feature => feature.trim()).filter(Boolean);

/** `args` with a single --disable-features switch: Playwright's list, ours, then any the caller passed. */
export function edgeArgs(args = []) {
  const callers = args.filter(arg => arg.startsWith(SWITCH)).flatMap(featuresOf);
  const features = [...new Set([...PLAYWRIGHT_DISABLED_FEATURES, ...EXTRA_DISABLED_FEATURES, ...callers])];
  return [...args.filter(arg => !arg.startsWith(SWITCH)), `${SWITCH}${features.join(',')}`];
}

/** The problem with a browser's command line, or null: Edge uses only the last --disable-features switch, so it must
 * hold every feature an earlier switch (Playwright's) disabled, and EXTRA_DISABLED_FEATURES. */
export function disabledFeaturesProblem(commandLine) {
  const lists = [...String(commandLine).matchAll(/--disable-features=([^\s"]*)/g)].map(match => featuresOf(`${SWITCH}${match[1]}`));
  if (!lists.length) return 'Edge was started without --disable-features; launch it through tests/ui/lib/edge.mjs (#708).';
  const last = new Set(lists.at(-1)), earlier = [...new Set(lists.slice(0, -1).flat())];
  const dropped = earlier.filter(feature => !last.has(feature)), missing = EXTRA_DISABLED_FEATURES.filter(feature => !last.has(feature));
  if (dropped.length) return `Edge would turn Playwright's disabled features back on (${dropped.join(', ')}): Edge keeps only the last --disable-features switch. Add them to PLAYWRIGHT_DISABLED_FEATURES in tests/ui/lib/edge.mjs (pinned Playwright ${PLAYWRIGHT_VERSION}) (#708).`;
  if (missing.length) return `Edge was started without disabling ${missing.join(', ')}, so each headless page would leave an entry in Windows Alt+Tab (#708).`;
  return null;
}

/** The browser's real command line, as Edge reports it on its version page (Browser.getBrowserCommandLine needs
 * --enable-automation, which would change how pages behave). */
export async function browserCommandLine(browser) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto('edge://version');
    return await page.locator('#command_line').textContent({ timeout: 10_000 });
  } finally { await context.close(); }
}

/**
 * Launches headless Edge with `args` merged as above (WEBGL_ARGS and other per-suite switches are kept) and the other
 * Playwright launch `options`, then checks its real command line. Throws, closing the browser, if the check fails.
 */
export async function launchEdge(chromium, { edge, args = [], ...options } = {}) {
  const browser = await chromium.launch({ executablePath: edge, headless: true, ...options, args: edgeArgs(args) });
  try {
    const problem = disabledFeaturesProblem(await browserCommandLine(browser));
    if (problem) throw new Error(problem);
  } catch (error) { await browser.close().catch(() => undefined); throw error; }
  return browser;
}
