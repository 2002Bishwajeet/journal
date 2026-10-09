import { useSyncExternalStore } from 'react';

// The theme is the `dark` class on <html> (useThemePreference, and the inline
// script in index.html on pages that don't mount it, like the share page).
function subscribe(onChange: () => void) {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
}

const isDark = () => document.documentElement.classList.contains('dark');

/** Whether the app is showing its dark theme; updates when the theme changes. */
export function useIsDarkTheme(): boolean {
    return useSyncExternalStore(subscribe, isDark, () => false);
}
