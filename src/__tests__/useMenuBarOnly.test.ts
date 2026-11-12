// @vitest-environment happy-dom
/** #1116: the "Show in menu bar only" Settings state; macOS app with the premium plugin only. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';
import type { NativePlatform } from '@/lib/native';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { invoke, saved } = vi.hoisted(() => {
    const saved = { on: false };
    return {
        saved,
        invoke: vi.fn(async (cmd: string, args?: { on: boolean }) => {
            if (cmd === 'plugin:journal-desktop|menu_bar_only') return saved.on;
            if (cmd === 'plugin:journal-desktop|set_menu_bar_only') saved.on = args?.on ?? false;
            return undefined;
        }),
    };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { useMenuBarOnly } from '@/hooks/useMenuBarOnly';

let root: Root;
const result = { current: null as unknown as ReturnType<typeof useMenuBarOnly> };

const capture = (value: ReturnType<typeof useMenuBarOnly>) => { result.current = value; };

function Probe() {
    capture(useMenuBarOnly());
    return null;
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function renderOn(platform?: NativePlatform, plugins = ['journal-desktop']) {
    if (platform) window.__JOURNAL_NATIVE__ = { platform, plugins };
    await act(async () => { root.render(createElement(Probe)); });
    await flush();
}

beforeEach(() => {
    invoke.mockClear();
    saved.on = false;
    root = createRoot(document.createElement('div'));
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    delete (window as { __JOURNAL_NATIVE__?: unknown }).__JOURNAL_NATIVE__;
});

describe('useMenuBarOnly', () => {
    it('is not offered on the web and never calls the native side', async () => {
        await renderOn();
        expect(result.current.mac).toBe(false);
        expect(result.current.enabled).toBeNull();
        expect(invoke).not.toHaveBeenCalled();
    });

    it.each<NativePlatform>(['windows', 'linux', 'ios'])('is not offered on %s, which has no Dock', async (platform) => {
        await renderOn(platform);
        expect(result.current.mac).toBe(false);
        expect(invoke).not.toHaveBeenCalled();
    });

    it('is not offered in a macOS build without the premium plugin', async () => {
        await renderOn('macos', []);
        expect(result.current.mac).toBe(false);
        expect(invoke).not.toHaveBeenCalled();
    });

    it('starts as "Dock and menu bar" on macOS and switches the Dock icon off and on', async () => {
        await renderOn('macos');
        expect(result.current.mac).toBe(true);
        expect(result.current.enabled).toBe(false);

        await act(async () => { await result.current.setEnabled(true); });
        expect(invoke).toHaveBeenLastCalledWith('plugin:journal-desktop|set_menu_bar_only', { on: true });
        expect(result.current.enabled).toBe(true);

        await act(async () => { await result.current.setEnabled(false); });
        expect(invoke).toHaveBeenLastCalledWith('plugin:journal-desktop|set_menu_bar_only', { on: false });
        expect(result.current.enabled).toBe(false);
    });

    it('shows the saved choice after a restart', async () => {
        saved.on = true;
        await renderOn('macos');
        expect(result.current.enabled).toBe(true);
    });

    it('keeps the old value when the change fails', async () => {
        await renderOn('macos');
        invoke.mockRejectedValueOnce('denied');
        await act(async () => { await result.current.setEnabled(true).catch(() => {}); });
        expect(result.current.enabled).toBe(false);
    });
});
