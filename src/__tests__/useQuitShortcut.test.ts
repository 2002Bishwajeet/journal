// @vitest-environment happy-dom
/** #1013: Ctrl+Q quits the Windows and Linux desktop app, whose window only hides on close. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { quitApp } = vi.hoisted(() => ({ quitApp: vi.fn<() => Promise<void>>(async () => {}) }));
vi.mock('@premium', () => ({ quitApp }));

import { useQuitShortcut } from '@/hooks/useQuitShortcut';

let root: Root;

function Probe() {
    useQuitShortcut();
    return null;
}

const press = (init: KeyboardEventInit) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    return act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

beforeEach(() => {
    quitApp.mockClear();
    root = createRoot(document.createElement('div'));
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    delete (window as { __JOURNAL_NATIVE__?: unknown }).__JOURNAL_NATIVE__;
});

describe('useQuitShortcut', () => {
    it('quits on Ctrl+Q on Linux and Windows', async () => {
        for (const platform of ['linux', 'windows'] as const) {
            window.__JOURNAL_NATIVE__ = { platform };
            await act(async () => { root.render(createElement(Probe)); });
            await press({ key: 'q', ctrlKey: true });
            expect(quitApp).toHaveBeenCalledTimes(1);
            quitApp.mockClear();
            await act(async () => { root.render(null); });
        }
    });

    it('ignores other keys, and the web and macOS', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'linux' };
        await act(async () => { root.render(createElement(Probe)); });
        await press({ key: 'q' });
        await press({ key: 'w', ctrlKey: true });
        await act(async () => { root.render(null); });

        window.__JOURNAL_NATIVE__ = { platform: 'macos' };
        await act(async () => { root.render(createElement(Probe)); });
        await press({ key: 'q', ctrlKey: true });
        await act(async () => { root.render(null); });

        delete (window as { __JOURNAL_NATIVE__?: unknown }).__JOURNAL_NATIVE__;
        await act(async () => { root.render(createElement(Probe)); });
        await press({ key: 'q', ctrlKey: true });
        expect(quitApp).not.toHaveBeenCalled();
    });
});
