// @vitest-environment happy-dom
/**
 * #1013: the tray menu's "New note" reaches the app as an event; the handler runs only in
 * the native app, and the listener is removed with the component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { listenTrayNewNote, unlisten } = vi.hoisted(() => {
    const unlisten = vi.fn();
    return { unlisten, listenTrayNewNote: vi.fn<(handler: () => void) => Promise<() => void>>(async () => unlisten) };
});

vi.mock('@premium', () => ({ listenTrayNewNote }));

import { useTrayNewNote } from '@/hooks/useTrayNewNote';

let host: HTMLDivElement;
let root: Root;

function Probe({ onNewNote }: { onNewNote: () => void }) {
    useTrayNewNote(onNewNote);
    return null;
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
    listenTrayNewNote.mockClear();
    unlisten.mockClear();
    host = document.createElement('div');
    root = createRoot(host);
});

afterEach(() => {
    delete (window as { __JOURNAL_NATIVE__?: unknown }).__JOURNAL_NATIVE__;
});

describe('useTrayNewNote', () => {
    it('does nothing outside the native app', async () => {
        await act(async () => { root.render(createElement(Probe, { onNewNote: vi.fn() })); });
        await flush();
        expect(listenTrayNewNote).not.toHaveBeenCalled();
        await act(async () => { root.unmount(); });
    });

    it('runs the latest handler when the tray sends New note, and stops listening on unmount', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'linux' };
        const first = vi.fn();
        const second = vi.fn();
        await act(async () => { root.render(createElement(Probe, { onNewNote: first })); });
        await flush();
        expect(listenTrayNewNote).toHaveBeenCalledTimes(1);

        await act(async () => { root.render(createElement(Probe, { onNewNote: second })); });
        listenTrayNewNote.mock.calls[0][0]();
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        expect(listenTrayNewNote).toHaveBeenCalledTimes(1);

        await act(async () => { root.unmount(); });
        expect(unlisten).toHaveBeenCalledTimes(1);
    });
});
