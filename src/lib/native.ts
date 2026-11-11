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
