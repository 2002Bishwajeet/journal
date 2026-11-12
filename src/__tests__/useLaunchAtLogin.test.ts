// @vitest-environment happy-dom
/** #1013: the Settings row's launch-at-login state; desktop app only. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getLaunchAtLogin, setLaunchAtLogin } = vi.hoisted(() => ({
    getLaunchAtLogin: vi.fn<() => Promise<boolean>>(async () => true),
    setLaunchAtLogin: vi.fn<(on: boolean) => Promise<void>>(async () => {}),
}));

vi.mock('@premium', () => ({ getLaunchAtLogin, setLaunchAtLogin }));

import { useLaunchAtLogin } from '@/hooks/useLaunchAtLogin';

let host: HTMLDivElement;
let root: Root;
const result = { current: null as unknown as ReturnType<typeof useLaunchAtLogin> };

const capture = (value: ReturnType<typeof useLaunchAtLogin>) => { result.current = value; };

function Probe() {
    capture(useLaunchAtLogin());
    return null;
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
    getLaunchAtLogin.mockClear();
    setLaunchAtLogin.mockClear();
    host = document.createElement('div');
    root = createRoot(host);
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    delete (window as { __JOURNAL_NATIVE__?: unknown }).__JOURNAL_NATIVE__;
});

describe('useLaunchAtLogin', () => {
    it('is not desktop on the web and never reads the OS setting', async () => {
        await act(async () => { root.render(createElement(Probe)); });
        await flush();
        expect(result.current.desktop).toBe(false);
        expect(result.current.enabled).toBeNull();
        expect(getLaunchAtLogin).not.toHaveBeenCalled();
    });

    it('is not desktop on a phone', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'ios' };
        await act(async () => { root.render(createElement(Probe)); });
        await flush();
        expect(result.current.desktop).toBe(false);
        expect(getLaunchAtLogin).not.toHaveBeenCalled();
    });

    it('reads the OS setting on desktop and writes changes through', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'linux' };
        await act(async () => { root.render(createElement(Probe)); });
        await flush();
        expect(result.current.desktop).toBe(true);
        expect(result.current.enabled).toBe(true);

        await act(async () => { await result.current.setEnabled(false); });
        expect(setLaunchAtLogin).toHaveBeenCalledWith(false);
        expect(result.current.enabled).toBe(false);
    });

    it('keeps the old value when the OS refuses the change', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'windows' };
        setLaunchAtLogin.mockRejectedValueOnce(new Error('denied'));
        await act(async () => { root.render(createElement(Probe)); });
        await flush();
        await act(async () => { await result.current.setEnabled(false).catch(() => {}); });
        expect(result.current.enabled).toBe(true);
    });
});
