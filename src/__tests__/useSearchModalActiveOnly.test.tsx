// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

const row = (docId: string) => ({
    docId,
    title: docId,
    preview: '',
    metadata: { title: docId },
});

vi.mock('@/lib/db', () => ({
    advancedSearch: vi.fn(async () => []),
    getNotesByIds: vi.fn(async () => []),
    getRecentlyModifiedNotes: vi.fn(async () => [row('active')]),
    getAllFolders: vi.fn(async () => []),
}));

import { useSearchModal } from '@/hooks/useSearchModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useSearchModal empty query', () => {
    it('lists only active notes', async () => {
        let entries: ReturnType<typeof useSearchModal>['entries'] = [];
        const Probe = () => {
            entries = useSearchModal({ isOpen: true, onClose: () => {}, onSelectNote: () => {} }).entries;
            return null;
        };
        const root = createRoot(document.createElement('div'));
        await act(async () => {
            root.render(createElement(Probe));
        });
        await act(async () => {});
        const noteIds = entries.flatMap((e) => (e.kind === 'note' ? [e.result.docId] : []));
        expect(noteIds).toEqual(['active']);
        act(() => root.unmount());
    });
});
