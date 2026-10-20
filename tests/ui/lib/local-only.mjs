// Keeps a suite's pages to the app under test.
//
// A filtering proxy or ad blocker on the test machine can rewrite the app's own HTML to load its script
// from another host: on the owner's PC, AdGuard for Windows adds http://local.adguard.org/?...
// &type=content-script&... to every page Edge loads, including the suites' loopback pages. Under load
// that request can fail (net::ERR_CONTENT_LENGTH_MISMATCH was seen), and the console error fails a suite
// that allows none, although the app did nothing wrong (#315). The app itself never loads anything from
// another origin (its CSP is default-src 'self').

const EMPTY = { script: 'text/javascript', stylesheet: 'text/css' };

/**
 * Answers every request from `context` that is not for `base` (the suite's own server) with an empty
 * response, so nothing from another host runs in the page. Returns the list of answered URLs (origin and
 * path only) for the suite's output.
 */
export async function keepPagesLocal(context, base) {
  const origin = new URL(base).origin, outside = [];
  await context.route(url => url.origin !== origin, route => {
    const request = route.request(), url = new URL(request.url());
    outside.push(`${request.resourceType()} ${url.origin}${url.pathname}`);
    return route.fulfill({ status: 200, contentType: EMPTY[request.resourceType()] ?? 'text/plain', body: '' });
  });
  return outside;
}
