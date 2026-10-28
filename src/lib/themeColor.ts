// The browser chrome and status bar take their colour from <meta name="theme-color">
// (#893). index.html has one per OS scheme for the no-JS first paint; these keep
// their `media` and follow the in-app theme and the surface at the top of the screen.

type Surface = '--background' | '--sidebar';

let surface: Surface = '--background';

export function setThemeColor(color: string): void {
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', color));
}

/** Sets theme-color to the current value of the top surface's CSS token; pass a surface to change it. */
export function syncThemeColor(next: Surface = surface): void {
    surface = next;
    const color = getComputedStyle(document.documentElement).getPropertyValue(surface).trim();
    if (color) setThemeColor(color);
}
