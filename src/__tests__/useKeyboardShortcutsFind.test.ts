// @vitest-environment happy-dom
/** Cmd/Ctrl+F and +H open Find in the note on screen, wherever focus is. */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/react';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { registerActiveEditor } from '@/lib/agent/activeEditor';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function Probe({ onFocusMode }: { onFocusMode: () => void }) {
    useKeyboardShortcuts({ findInNote: true, onFocusMode });
    return null;
}

function fakeEditor() {
    const calls: string[] = [];
    const chain = {
        openFind: () => ({ run: () => calls.push('openFind') }),
        openReplace: () => ({ run: () => calls.push('openReplace') }),
    };
    return { calls, editor: { isDestroyed: false, chain: () => chain } as unknown as Editor };
}

const press = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
    window.dispatchEvent(event);
    return event;
};

let unregister: (() => void) | undefined;
afterEach(() => {
    unregister?.();
    unregister = undefined;
});

async function mount(onFocusMode = vi.fn()) {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(h(Probe, { onFocusMode })));
    return { onFocusMode, unmount: () => act(async () => root.unmount()) };
}

describe('useKeyboardShortcuts findInNote', () => {
    it('opens Find in the active note and takes the key', async () => {
        const { calls, editor } = fakeEditor();
        unregister = registerActiveEditor({ docId: 'a', editor, editable: true, excludeFromAI: false });
        const { unmount } = await mount();

        expect(press({ key: 'f', ctrlKey: true }).defaultPrevented).toBe(true);
        expect(press({ key: 'h', metaKey: true }).defaultPrevented).toBe(true);
        expect(calls).toEqual(['openFind', 'openReplace']);
        await unmount();
    });

    it('leaves the key to the browser with no note open', async () => {
        const { onFocusMode, unmount } = await mount();
        expect(press({ key: 'f', ctrlKey: true }).defaultPrevented).toBe(false);
        expect(press({ key: 'h', ctrlKey: true }).defaultPrevented).toBe(false);
        expect(onFocusMode).not.toHaveBeenCalled();
        await unmount();
    });

    it('keeps Shift+F for focus mode', async () => {
        const { calls, editor } = fakeEditor();
        unregister = registerActiveEditor({ docId: 'a', editor, editable: true, excludeFromAI: false });
        const { onFocusMode, unmount } = await mount();

        press({ key: 'F', ctrlKey: true, shiftKey: true });
        expect(onFocusMode).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([]);
        await unmount();
    });

    it('opens Find, not Replace, on a read-only note', async () => {
        const { calls, editor } = fakeEditor();
        unregister = registerActiveEditor({ docId: 'a', editor, editable: false, excludeFromAI: false });
        const { unmount } = await mount();

        press({ key: 'h', ctrlKey: true });
        expect(calls).toEqual(['openFind']);
        await unmount();
    });

    it('does not repeat a key the editor already handled', async () => {
        const { calls, editor } = fakeEditor();
        unregister = registerActiveEditor({ docId: 'a', editor, editable: true, excludeFromAI: false });
        const { unmount } = await mount();

        const handled = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true });
        handled.preventDefault();
        window.dispatchEvent(handled);
        expect(calls).toEqual([]);
        await unmount();
    });
});
