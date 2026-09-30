// @vitest-environment happy-dom
/**
 * useThemePreference keeps per-instance state, and JournalLayout mounts an
 * instance that stays on 'system' while Settings changes the theme through
 * another. That stale instance's matchMedia listener must not re-apply the
 * system scheme once the user has picked Light or Dark.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { useThemePreference, type ThemePreference } from '@/hooks/useThemePreference';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let systemDark = false;
const listeners = new Set<() => void>();

beforeEach(() => {
    systemDark = false;
    listeners.clear();
    localStorage.clear();
    document.documentElement.className = '';
    vi.spyOn(window, 'matchMedia').mockImplementation(
        (query: string) =>
            ({
                get matches() { return systemDark; },
                media: query,
                addEventListener: (_: string, fn: () => void) => listeners.add(fn),
                removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
            }) as unknown as MediaQueryList,
    );
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useThemePreference', () => {
    it('keeps an explicit choice when the OS scheme changes, even with a stale system instance mounted', async () => {
        let setThemeB: (p: ThemePreference) => void = () => {};
        function A() {
            useThemePreference();
            return null;
        }
        function B() {
            setThemeB = useThemePreference().setTheme;
            return null;
        }

        const el = document.createElement('div');
        document.body.appendChild(el);
        const root = createRoot(el);
        await act(async () => { root.render(h('div', null, h(A), h(B))); });
        expect(document.documentElement.classList.contains('light')).toBe(true);

        await act(async () => { setThemeB('dark'); });
        expect(document.documentElement.classList.contains('dark')).toBe(true);

        // OS switches to light: instance A still listens (its own state is 'system').
        systemDark = false;
        await act(async () => { listeners.forEach((fn) => fn()); });
        expect(document.documentElement.classList.contains('dark')).toBe(true);

        await act(async () => root.unmount());
        el.remove();
    });

    it('follows the OS scheme while the preference is system', async () => {
        function A() {
            useThemePreference();
            return null;
        }
        const el = document.createElement('div');
        document.body.appendChild(el);
        const root = createRoot(el);
        await act(async () => { root.render(h(A)); });
        expect(document.documentElement.classList.contains('light')).toBe(true);

        systemDark = true;
        await act(async () => { listeners.forEach((fn) => fn()); });
        expect(document.documentElement.classList.contains('dark')).toBe(true);

        await act(async () => root.unmount());
        el.remove();
    });
});
