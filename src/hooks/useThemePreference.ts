import { useCallback, useState, useEffect } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'journal-theme-preference';

function getStoredPreference(): ThemePreference {
    if (typeof localStorage === 'undefined') return 'system';
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
    }
    return 'system';
}

function getSystemTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(preference: ThemePreference): void {
    if (typeof window === 'undefined') return;
    const root = window.document.documentElement;

    // Remove existing theme classes
    root.classList.remove('light', 'dark');

    // Determine actual theme to apply
    const actualTheme = preference === 'system' ? getSystemTheme() : preference;

    // Apply the class
    root.classList.add(actualTheme);

    // Also set color-scheme for native browser UI (scrollbars, form controls)
    root.style.colorScheme = actualTheme;
}

export function useThemePreference() {
    const [theme, setThemeState] = useState<ThemePreference>(getStoredPreference);

    // Apply theme on initial mount
    useEffect(() => {
        applyTheme(theme);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Listen for system preference changes (only when theme is 'system')
    useEffect(() => {
        if (theme !== 'system') return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const handleChange = () => {
            applyTheme('system');
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [theme]);

    const setTheme = useCallback((preference: ThemePreference) => {
        // Persist to localStorage
        localStorage.setItem(THEME_STORAGE_KEY, preference);

        // Apply theme
        applyTheme(preference);

        // Update state
        setThemeState(preference);
    }, []);

    return { theme, setTheme } as const;
}
