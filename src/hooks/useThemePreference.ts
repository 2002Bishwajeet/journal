import { useCallback, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

function getInitialThemePreference(): ThemePreference {
    // Vite runs this on the client, but guard anyway.
    if (typeof document === 'undefined') return 'system';
    const root = document.documentElement;
    if (root.classList.contains('dark')) return 'dark';
    if (root.classList.contains('light')) return 'light';
    return 'system';
}

function applyThemePreference(preference: ThemePreference): void {
    if (typeof window === 'undefined') return;
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');

    if (preference === 'system') {
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
        root.classList.add(systemTheme);
        return;
    }

    root.classList.add(preference);
}

export function useThemePreference() {
    const [theme, setThemeState] = useState<ThemePreference>(() => getInitialThemePreference());

    const setTheme = useCallback((preference: ThemePreference) => {
        applyThemePreference(preference);
        setThemeState(preference);
    }, []);

    return { theme, setTheme } as const;
}
