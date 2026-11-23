// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/lib/db', () => ({
    advancedSearch: vi.fn(async () => []),
    getNotesByIds: vi.fn(async () => []),
    getRecentlyModifiedNotes: vi.fn(async () => []),
    getAllFolders: vi.fn(async () => []),
}));

import { useSearchModal } from '@/hooks/useSearchModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useSearchModal focus', () => {
    it('makes the rest of the page inert while open and returns focus to the opener on close', () => {
        const page = document.createElement('div');
        const opener = document.createElement('button');
        page.appendChild(opener);
        const host = document.createElement('div');
        document.body.append(page, host);
        opener.focus();

        const Probe = ({ isOpen }: { isOpen: boolean }) => {
            useSearchModal({ isOpen, onClose: () => {}, onSelectNote: () => {} });
            return null;
        };
        const root = createRoot(host);
        act(() => root.render(createElement(Probe, { isOpen: true })));
        expect(page.hasAttribute('inert')).toBe(true);
        opener.blur();

        act(() => root.render(createElement(Probe, { isOpen: false })));
        expect(page.hasAttribute('inert')).toBe(false);
        expect(document.activeElement).toBe(opener);

        act(() => root.unmount());
        page.remove();
        host.remove();
    });

    it('Tab wraps inside the dialog', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        let onKeyDown: ReturnType<typeof useSearchModal>['handleDialogKeyDown'] = () => {};
        const Probe = () => {
            onKeyDown = useSearchModal({ isOpen: false, onClose: () => {}, onSelectNote: () => {} }).handleDialogKeyDown;
            return createElement('div', { onKeyDown }, createElement('input', { id: 'first' }), createElement('button', { id: 'last' }));
        };
        const root = createRoot(host);
        act(() => root.render(createElement(Probe)));
        const first = host.querySelector<HTMLElement>('#first')!;
        const last = host.querySelector<HTMLElement>('#last')!;

        last.focus();
        const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        act(() => { last.dispatchEvent(tab); });
        expect(tab.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);

        const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
        act(() => { first.dispatchEvent(back); });
        expect(document.activeElement).toBe(last);

        act(() => root.unmount());
        host.remove();
    });
});
