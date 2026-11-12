// @vitest-environment happy-dom
/** #1013, #1116: the Desktop group in Appearance settings shows only in the desktop app. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const launch = vi.hoisted(() => ({
    value: { desktop: false, enabled: null as boolean | null, setEnabled: vi.fn<(on: boolean) => Promise<void>>(async () => {}) },
}));
vi.mock('@/hooks/useLaunchAtLogin', () => ({ useLaunchAtLogin: () => launch.value }));
const menuBar = vi.hoisted(() => ({
    value: { mac: false, enabled: null as boolean | null, setEnabled: vi.fn<(on: boolean) => Promise<void>>(async () => {}) },
}));
vi.mock('@/hooks/useMenuBarOnly', () => ({ useMenuBarOnly: () => menuBar.value }));
vi.mock('@/hooks/useThemePreference', () => ({ useThemePreference: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/hooks/useEditorAppearance', () => ({
    useEditorAppearance: () => ({ font: 'sans', setFont: vi.fn(), width: 'normal', setWidth: vi.fn() }),
}));

import AppearanceSection from '@/components/settings/sections/AppearanceSection';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    launch.value.setEnabled.mockClear();
    menuBar.value = { ...menuBar.value, mac: false, enabled: null };
    menuBar.value.setEnabled.mockClear();
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
});

describe('AppearanceSection Desktop group', () => {
    it('is hidden outside the desktop app', async () => {
        launch.value = { ...launch.value, desktop: false, enabled: null };
        await act(async () => { root.render(createElement(AppearanceSection)); });
        expect(host.textContent).not.toContain('Launch at login');
    });

    it('shows the launch-at-login switch on desktop, off until read, and toggles it', async () => {
        launch.value = { ...launch.value, desktop: true, enabled: false };
        await act(async () => { root.render(createElement(AppearanceSection)); });
        expect(host.textContent).toContain('Launch at login');
        const sw = host.querySelector('[role="switch"]') as HTMLElement;
        expect(sw.getAttribute('aria-checked')).toBe('false');
        await act(async () => { sw.click(); });
        expect(launch.value.setEnabled).toHaveBeenCalledWith(true);
    });

    it('disables the switch until the OS setting is read', async () => {
        launch.value = { ...launch.value, desktop: true, enabled: null };
        await act(async () => { root.render(createElement(AppearanceSection)); });
        expect((host.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
    });

    it('offers "Show in menu bar only" on macOS only, off by default', async () => {
        launch.value = { ...launch.value, desktop: true, enabled: false };
        await act(async () => { root.render(createElement(AppearanceSection)); });
        expect(host.textContent).not.toContain('Show in menu bar only');

        menuBar.value = { ...menuBar.value, mac: true, enabled: false };
        await act(async () => { root.render(createElement(AppearanceSection)); });
        expect(host.textContent).toContain('Show in menu bar only');
        const sw = host.querySelector('#desktop-menu-bar-only') as HTMLButtonElement;
        expect(sw.getAttribute('aria-checked')).toBe('false');
        await act(async () => { sw.click(); });
        expect(menuBar.value.setEnabled).toHaveBeenCalledWith(true);
    });
});
