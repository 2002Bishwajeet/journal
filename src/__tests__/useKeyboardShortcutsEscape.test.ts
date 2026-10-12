// @vitest-environment happy-dom
/** Zen mode exits on Esc, but not on an Esc a dialog or menu already consumed. */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function Probe({ onEscape }: { onEscape: () => void }) {
    useKeyboardShortcuts({ onEscape });
    return null;
}

describe('useKeyboardShortcuts onEscape', () => {
    it('fires on Esc unless the event was already handled', async () => {
        const onEscape = vi.fn();
        const root = createRoot(document.createElement('div'));
        await act(async () => root.render(h(Probe, { onEscape })));

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
        expect(onEscape).toHaveBeenCalledTimes(1);

        const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        handled.preventDefault();
        window.dispatchEvent(handled);
        expect(onEscape).toHaveBeenCalledTimes(1);

        await act(async () => root.unmount());
    });
});
