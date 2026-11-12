import { nativePlatform } from '@/lib/native';

// The browser chrome and status bar take their colour from <meta name="theme-color">
// (#893). index.html has one per OS scheme for the no-JS first paint; these keep
// their `media` and follow the in-app theme and the surface at the top of the screen.

// The Android shell (MainActivity.kt) listens on `JournalSystemBars` and picks light or
// dark status and navigation bar icons from the colour, so they follow the in-app theme
// and not only the OS scheme. WKWebView reads no meta tag: on iOS the shell's
// `system-bars` command (src-tauri/src/lib.rs) sets the window's appearance instead.
declare global {
    interface Window {
        JournalSystemBars?: { postMessage(color: string): void };
        __TAURI_INTERNALS__?: { invoke(command: string, args: object): Promise<unknown> };
    }
}

type Surface = '--background' | '--sidebar';

let surface: Surface = '--background';

export function setThemeColor(color: string): void {
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', color));
    window.JournalSystemBars?.postMessage(color);
}

/** iOS shell: the status bar text follows the theme preference; "system" hands it back to the OS. */
export function setSystemBarsStyle(preference: 'light' | 'dark' | 'system'): void {
    if (nativePlatform() !== 'ios') return;
    window.__TAURI_INTERNALS__?.invoke('plugin:system-bars|set_style', { style: preference }).catch(() => {});
}

/** Sets theme-color to the current value of the top surface's CSS token; pass a surface to change it. */
export function syncThemeColor(next: Surface = surface): void {
    surface = next;
    const color = getComputedStyle(document.documentElement).getPropertyValue(surface).trim();
    if (color) setThemeColor(color);
}
