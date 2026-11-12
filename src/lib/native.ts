// The Tauri shell's initialization script (src-tauri/src/lib.rs) sets
// `window.__JOURNAL_NATIVE__` before any app code runs. The web never sets it.
export type NativePlatform = 'macos' | 'windows' | 'linux' | 'ios' | 'android';

declare global {
  interface Window {
    __JOURNAL_NATIVE__?: { platform: NativePlatform };
  }
}

/** The native app's platform, or null on the web. */
export function nativePlatform(): NativePlatform | null {
  return window.__JOURNAL_NATIVE__?.platform ?? null;
}

/** True inside the desktop or mobile app, false in a browser. */
export function isNativeApp(): boolean {
  return nativePlatform() !== null;
}

/** The hosted app. Links for other people point here from the native app. */
export const PUBLIC_ORIGIN = 'https://journal.cloudx.run';

/**
 * The origin of links the app hands to other people (share, folder and feed links).
 * The native app's own origin is `http://localhost:47821` (src-tauri/src/lib.rs), so
 * it uses the hosted app; the web uses its own origin, so dev and preview keep theirs.
 */
export function publicOrigin(): string {
  return isNativeApp() ? PUBLIC_ORIGIN : window.location.origin;
}

// Native plugins, called through Tauri's IPC. `browser` is ours (src-tauri/plugins/browser):
// SFSafariViewController and ASWebAuthenticationSession on iOS, Custom Tabs on Android.
// `opener` is Tauri's, for the default browser on desktop.
async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/**
 * The http(s) URL `href` points at when the native app should open it outside its
 * web view, else null. Null for the app's own pages, and for a link that comes back
 * to the app (a query value starting with the app's origin, like the owner
 * console's extend-permissions `return`): an in-app browser can't hand that return
 * back, so it stays a navigation of the web view.
 */
export function externalUrl(href: string | URL | undefined | null): string | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  const { origin } = window.location;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.origin === origin || [...url.searchParams.values()].some((v) => v.startsWith(origin))) return null;
  return url.href;
}

/**
 * Opens a link outside the app's web view: an in-app browser sheet on iOS and
 * Android (SFSafariViewController, Custom Tabs), the default browser on desktop.
 */
export async function openExternal(url: string): Promise<void> {
  const platform = nativePlatform();
  if (platform === 'ios' || platform === 'android') await invoke('plugin:browser|open_url', { url });
  else await invoke('plugin:opener|open_url', { url });
}

/**
 * Native app: every external http(s) link, whether an anchor or `window.open`,
 * opens through `openExternal` instead of navigating the app's own web view.
 * Links inside an editable note are left to the editor, which opens them with
 * `window.open` (TipTap's Link `openOnClick`). Does nothing on the web.
 */
export function routeExternalLinks(): void {
  if (!isNativeApp()) return;

  const open = window.open.bind(window);
  window.open = (target, ...rest) => {
    const url = externalUrl(target);
    if (!url) return open(target, ...rest);
    void openExternal(url).catch((err: unknown) => console.error('[native] Failed to open link:', err));
    return null;
  };

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]');
    if (!(anchor instanceof HTMLAnchorElement) || anchor.closest('[contenteditable="true"]')) return;
    const url = externalUrl(anchor.href);
    if (!url) return;
    event.preventDefault();
    window.open(url);
  });
}

/** The YouAuth callback scheme. The deep-link plugin registers it (tauri.conf.json). */
const AUTH_SCHEME = 'journal';

/**
 * Whether sign-in runs in a system auth session that returns to the app on a
 * `journal://` link: ASWebAuthenticationSession on iOS, Custom Tabs on Android,
 * the default browser on macOS. Windows and Linux keep it in the web view: a
 * `journal://` link there starts a second copy of the app, which can't take the
 * asset server's port.
 */
function signsInOutsideApp(): boolean {
  const platform = nativePlatform();
  return platform === 'ios' || platform === 'android' || platform === 'macos';
}

/** Where the identity sends the browser back to once the user approves sign-in. */
export function authCallbackUrl(): string {
  return signsInOutsideApp() ? `${AUTH_SCHEME}://auth/finalize` : `${window.location.origin}/auth/finalize`;
}

/**
 * Sends the user to the identity's YouAuth authorize page. In the web view (web,
 * Windows, Linux) that is a navigation. On iOS the auth session hands back the
 * `journal://auth/finalize?...` URL and the app opens /auth/finalize with its
 * query. On Android and macOS the same URL comes back as a deep link, which
 * useDeepLinks routes to /auth/finalize. Resolves without navigating when the
 * user closes the iOS sheet.
 */
export async function startSignIn(authUrl: string): Promise<void> {
  const url = new URL(authUrl);
  // The identity's authorize page is always http(s); refuse javascript: and the like.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Sign-in URL must be http(s)');
  authUrl = url.href;
  const platform = nativePlatform();
  if (!signsInOutsideApp()) {
    window.location.href = authUrl;
  } else if (platform === 'ios') {
    const result = await invoke<{ url?: string } | null>('plugin:browser|authenticate', {
      url: authUrl,
      callbackScheme: AUTH_SCHEME,
    });
    if (result?.url) window.location.replace(`/auth/finalize${new URL(result.url).search}`);
  } else {
    await openExternal(authUrl);
  }
}
