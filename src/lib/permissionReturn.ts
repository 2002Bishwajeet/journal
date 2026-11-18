/**
 * Where the owner console's extend-permissions page (`/owner/appupdate`) sends the user back
 * when it runs outside the native app: `journal://permissions/return?to=<in-app route>`.
 * `to` is the page the grant started from, so the publish dialog or Diagnostics resumes there.
 */
const PREFIX = 'journal://permissions/return';
// Only used to tell an in-app route from one that leaves the app; never navigated to
const APP_ORIGIN = 'http://app.invalid';

/** The `journal://` return link for `returnUrl`, an app page: only its path, query and hash are kept. */
export function permissionReturnLink(returnUrl: string): string {
    const { pathname, search, hash } = new URL(returnUrl);
    return `${PREFIX}?to=${encodeURIComponent(pathname + search + hash)}`;
}

/**
 * The in-app route a permission return link goes back to, or null when `link` isn't one or `to`
 * isn't a plain app path (another origin, `//host`, a backslash trick). A web page can open
 * `journal://` links, so `to` is never trusted.
 */
export function permissionReturnRoute(link: string): string | null {
    let url: URL;
    let target: URL;
    try {
        url = new URL(link);
        const to = url.searchParams.get('to') ?? '';
        if (!/^\/(?![/\\])/.test(to)) return null;
        target = new URL(to, APP_ORIGIN);
    } catch {
        return null;
    }
    if (`${url.protocol}//${url.host}${url.pathname}` !== PREFIX || target.origin !== APP_ORIGIN) return null;
    return target.pathname + target.search + target.hash;
}
