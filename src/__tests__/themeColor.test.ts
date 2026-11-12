// @vitest-environment happy-dom
/**
 * The status bar colour (<meta name="theme-color">) follows the in-app theme and
 * the top surface of the screen, not only the OS scheme (#893).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { setThemeColor, setSystemBarsStyle, syncThemeColor } from '@/lib/themeColor';
import { useThemePreference, type ThemePreference } from '@/hooks/useThemePreference';

const LIGHT_BG = '#FDFCF8';
const DARK_BG = '#1C1B1A';
const DARK_SIDEBAR = '#161514';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.head.innerHTML = `
        <meta name="theme-color" content="${LIGHT_BG}" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="${DARK_BG}" media="(prefers-color-scheme: dark)" />
        <style>
            :root { --background: ${LIGHT_BG}; --sidebar: #F2F0E9; }
            .dark { --background: ${DARK_BG}; --sidebar: ${DARK_SIDEBAR}; }
        </style>`;
    // OS in light mode
    vi.spyOn(window, 'matchMedia').mockImplementation(
        (query: string) =>
            ({
                matches: false,
                media: query,
                addEventListener: () => {},
                removeEventListener: () => {},
            }) as unknown as MediaQueryList,
    );
});

afterEach(() => {
    syncThemeColor('--background');
    vi.restoreAllMocks();
});

const metas = () => [...document.querySelectorAll('meta[name="theme-color"]')];

describe('setThemeColor', () => {
    it('updates both metas and keeps their media', () => {
        setThemeColor('#123456');
        expect(metas().map((m) => [m.getAttribute('content'), m.getAttribute('media')])).toEqual([
            ['#123456', '(prefers-color-scheme: light)'],
            ['#123456', '(prefers-color-scheme: dark)'],
        ]);
    });
});

describe('Android system bars', () => {
    afterEach(() => {
        delete window.JournalSystemBars;
    });

    it('receives the theme colour when the app theme changes', () => {
        const postMessage = vi.fn();
        window.JournalSystemBars = { postMessage };
        syncThemeColor('--background');
        document.documentElement.classList.add('dark');
        syncThemeColor();
        expect(postMessage.mock.calls).toEqual([[LIGHT_BG], [DARK_BG]]);
    });

    it('does nothing outside the Android shell', () => {
        expect(() => setThemeColor('#123456')).not.toThrow();
    });
});

describe('theme-color follows the in-app theme', () => {
    it("setTheme('dark') with a light OS leaves every theme-color equal to the dark token", async () => {
        let setTheme: (p: ThemePreference) => void = () => {};
        function C() {
            setTheme = useThemePreference().setTheme;
            return null;
        }
        const root = createRoot(document.createElement('div'));
        await act(async () => root.render(h(C)));
        expect(metas().every((m) => m.getAttribute('content') === LIGHT_BG)).toBe(true);

        await act(async () => setTheme('dark'));
        expect(metas().every((m) => m.getAttribute('content') === DARK_BG)).toBe(true);
        root.unmount();
    });

    it('keeps the chosen surface across a theme change', () => {
        syncThemeColor('--sidebar');
        document.documentElement.classList.add('dark');
        syncThemeColor();
        expect(metas().every((m) => m.getAttribute('content') === DARK_SIDEBAR)).toBe(true);
    });
});

describe('iOS system bars', () => {
    const invoke = vi.fn(() => Promise.resolve());

    afterEach(() => {
        delete window.__JOURNAL_NATIVE__;
        delete window.__TAURI_INTERNALS__;
        invoke.mockClear();
    });

    it('sends the theme preference to the shell on iOS', () => {
        window.__JOURNAL_NATIVE__ = { platform: 'ios' };
        window.__TAURI_INTERNALS__ = { invoke };
        setSystemBarsStyle('dark');
        setSystemBarsStyle('system');
        expect(invoke.mock.calls).toEqual([
            ['plugin:system-bars|set_style', { style: 'dark' }],
            ['plugin:system-bars|set_style', { style: 'system' }],
        ]);
    });

    it('does nothing on the web or on Android', () => {
        window.__TAURI_INTERNALS__ = { invoke };
        setSystemBarsStyle('dark');
        window.__JOURNAL_NATIVE__ = { platform: 'android' };
        setSystemBarsStyle('dark');
        expect(invoke).not.toHaveBeenCalled();
    });

    it('a theme change reaches the shell', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'ios' };
        window.__TAURI_INTERNALS__ = { invoke };
        let setTheme: (p: ThemePreference) => void = () => {};
        function C() {
            setTheme = useThemePreference().setTheme;
            return null;
        }
        const root = createRoot(document.createElement('div'));
        await act(async () => root.render(h(C)));
        invoke.mockClear();
        await act(async () => setTheme('light'));
        expect(invoke).toHaveBeenCalledWith('plugin:system-bars|set_style', { style: 'light' });
        root.unmount();
    });
});
