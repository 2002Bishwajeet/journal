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
