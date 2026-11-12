// @vitest-environment happy-dom
/** #1014: Settings -> Shortcuts offers the capture hotkey picker, except in a Wayland session. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';
import type { QuickCaptureState } from '@/lib/premiumStub';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
    state: vi.fn<() => Promise<QuickCaptureState>>(),
    setShortcut: vi.fn<(s: string) => Promise<QuickCaptureState>>(),
}));

vi.mock('@premium', () => ({ quickCapture: { state: mocks.state, setShortcut: mocks.setShortcut, hide: vi.fn() } }));

import { useQuickCaptureShortcut } from '@/hooks/useQuickCaptureShortcut';

let root: Root;
const result = { current: null as unknown as ReturnType<typeof useQuickCaptureShortcut> };

const capture = (value: ReturnType<typeof useQuickCaptureShortcut>) => { result.current = value; };

function Probe() {
    capture(useQuickCaptureShortcut());
    return null;
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const x11: QuickCaptureState = { shortcut: 'CmdOrCtrl+Shift+J', session: 'x11', error: null };

beforeEach(() => {
    mocks.state.mockReset();
    mocks.setShortcut.mockReset();
    root = createRoot(document.createElement('div'));
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    delete (window as { __JOURNAL_NATIVE__?: unknown }).__JOURNAL_NATIVE__;
});

describe('useQuickCaptureShortcut', () => {
    it('has no hotkey on the web and never asks the native side', async () => {
        await act(async () => { root.render(createElement(Probe)); });
        await flush();
        expect(result.current.state).toBeNull();
        expect(result.current.pickable).toBe(false);
        expect(mocks.state).not.toHaveBeenCalled();
    });

    it('offers the picker on desktop outside Wayland', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'linux' };
        mocks.state.mockResolvedValue(x11);
        await act(async () => { root.render(createElement(Probe)); });
        await flush();
        expect(result.current.state).toEqual(x11);
        expect(result.current.pickable).toBe(true);
    });

    it('hides the picker in a Wayland session', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'linux' };
        mocks.state.mockResolvedValue({ ...x11, session: 'wayland' });
        await act(async () => { root.render(createElement(Probe)); });
        await flush();
        expect(result.current.pickable).toBe(false);
    });

    it('keeps the old shortcut when the OS refuses the new one', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'windows' };
        mocks.state.mockResolvedValue(x11);
        mocks.setShortcut.mockRejectedValue('Another app has it');
        await act(async () => { root.render(createElement(Probe)); });
        await flush();
        await act(async () => { await result.current.setShortcut('Ctrl+Alt+K').catch(() => {}); });
        expect(result.current.state?.shortcut).toBe('CmdOrCtrl+Shift+J');
    });

    it('shows the new shortcut once registered', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'macos' };
        mocks.state.mockResolvedValue(x11);
        mocks.setShortcut.mockResolvedValue({ ...x11, shortcut: 'Cmd+Alt+K' });
        await act(async () => { root.render(createElement(Probe)); });
        await flush();
        await act(async () => { await result.current.setShortcut('Cmd+Alt+K'); });
        expect(result.current.state?.shortcut).toBe('Cmd+Alt+K');
    });
});
