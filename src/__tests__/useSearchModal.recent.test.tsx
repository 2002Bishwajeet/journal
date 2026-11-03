// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h, act } from 'react';
import type { KeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { RECENT_NOTES_KEY, RECENT_SEARCHES_KEY } from '@/lib/storage';

const docs = ['a', 'b', 'c', 'd'].map((docId) => ({
    docId,
    title: docId.toUpperCase(),
    plainTextContent: '',
    metadata: { archivalStatus: 0 },
}));
const getAllDocuments = vi.fn();
const advancedSearch = vi.fn();
vi.mock('@/lib/db', () => ({
    getAllDocuments: () => getAllDocuments(),
    advancedSearch: (q: string) => advancedSearch(q),
}));

import { useSearchModal } from '@/hooks/useSearchModal';

type Api = ReturnType<typeof useSearchModal>;

const key = (k: string) => ({ key: k, preventDefault: () => {} }) as unknown as KeyboardEvent;
const ids = (api: Api) =>
    api.entries.map((e) => (e.kind === 'search' ? `q:${e.text}` : `${e.section}:${e.result.docId}`));
const stored = (k: string) => JSON.parse(localStorage.getItem(k)!).items;

const onSelectNote = vi.fn();
async function render() {
    const result = { current: null as Api | null };
    function Probe() {
        result.current = useSearchModal({ isOpen: true, onClose: () => {}, onSelectNote });
        return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => { root.render(h(Probe)); });
    return () => result.current!;
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    getAllDocuments.mockReset().mockResolvedValue(docs);
    advancedSearch.mockReset();
    onSelectNote.mockReset();
    localStorage.setItem(RECENT_NOTES_KEY, JSON.stringify({
        _v: 1, items: [{ docId: 'c', openedAt: 2 }, { docId: 'gone', openedAt: 1 }, { docId: 'a', openedAt: 0 }],
    }));
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify({ _v: 1, items: ['zebra'] }));
});

describe('useSearchModal recents', () => {
    it('lists recent notes, then recent searches, then the other notes', async () => {
        const api = await render();
        expect(ids(api())).toEqual(['recent:c', 'recent:a', 'q:zebra', 'notes:b', 'notes:d']);
        // Same DB calls as before: one on open and one for the empty query.
        expect(getAllDocuments).toHaveBeenCalledTimes(2);
    });

    it('ArrowDown then Enter on a recent search sets the query', async () => {
        const api = await render();
        advancedSearch.mockResolvedValue([]);
        await act(async () => { api().handleKeyDown(key('ArrowDown')); });
        await act(async () => { api().handleKeyDown(key('ArrowDown')); });
        await act(async () => { api().handleKeyDown(key('Enter')); });
        expect(api().query).toBe('zebra');
        expect(onSelectNote).not.toHaveBeenCalled();
    });

    it('picking a result saves the query', async () => {
        vi.useFakeTimers();
        try {
            advancedSearch.mockResolvedValue([{ docId: 'b', title: 'B', score: 1, matchType: 'title', metadata: {} }]);
            const api = await render();
            await act(async () => { api().handleQueryChange('  Bee '); });
            await act(async () => { await vi.advanceTimersByTimeAsync(200); });
            expect(ids(api())).toEqual(['notes:b']);
            await act(async () => { api().handleSelectResult('b'); });
            expect(onSelectNote).toHaveBeenCalledWith('b');
            expect(stored(RECENT_SEARCHES_KEY)).toEqual(['Bee', 'zebra']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('remove and clear update the list and storage', async () => {
        const api = await render();
        await act(async () => { api().handleRemoveEntry(api().entries[0]); });
        expect(ids(api())).toEqual(['recent:a', 'q:zebra', 'notes:b', 'notes:c', 'notes:d']);
        expect(stored(RECENT_NOTES_KEY).map((n: { docId: string }) => n.docId)).toEqual(['gone', 'a']);
        await act(async () => { api().handleClearRecents(); });
        expect(ids(api())).toEqual(['notes:a', 'notes:b', 'notes:c', 'notes:d']);
        expect(stored(RECENT_NOTES_KEY)).toEqual([]);
        expect(stored(RECENT_SEARCHES_KEY)).toEqual([]);
    });
});
