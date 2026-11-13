// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h, act } from 'react';
import type { KeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { RECENT_NOTES_KEY, RECENT_SEARCHES_KEY } from '@/lib/storage';

const docs = ['a', 'b', 'c', 'd'].map((docId) => ({
    docId,
    title: docId.toUpperCase(),
    preview: '',
    metadata: { archivalStatus: 0 },
}));
const getNotesByIds = vi.fn();
const getRecentlyModifiedNotes = vi.fn();
const advancedSearch = vi.fn();
vi.mock('@/lib/db', () => ({
    getNotesByIds: (ids: string[]) => getNotesByIds(ids),
    getRecentlyModifiedNotes: (limit: number) => getRecentlyModifiedNotes(limit),
    getAllFolders: async () => [],
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
    getNotesByIds.mockReset().mockImplementation(async (ids: string[]) => docs.filter((d) => ids.includes(d.docId)));
    getRecentlyModifiedNotes.mockReset().mockResolvedValue(docs);
    advancedSearch.mockReset();
    onSelectNote.mockReset();
    localStorage.setItem(RECENT_NOTES_KEY, JSON.stringify({
        _v: 1, items: [{ docId: 'c', openedAt: 2 }, { docId: 'gone', openedAt: 1 }, { docId: 'a', openedAt: 0 }],
    }));
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify({ _v: 1, items: ['zebra'] }));
});

describe('useSearchModal recents', () => {
    it('clearing the input reuses the rows and keeps the old ones while a query is pending', async () => {
        vi.useFakeTimers();
        try {
            let resolve: (r: unknown[]) => void = () => {};
            advancedSearch.mockImplementation(() => new Promise((r) => { resolve = r; }));
            const api = await render();
            await act(async () => { api().handleQueryChange('b'); });
            await act(async () => { await vi.advanceTimersByTimeAsync(200); });
            const hit = (docId: string) => ({ docId, title: docId, score: 1, matchType: 'title', metadata: {} });
            await act(async () => { resolve([hit('b'), hit('d')]); });
            expect(ids(api())).toEqual(['notes:b', 'notes:d']);
            // Select d, then type another letter: rows stay while pending, and selection follows d.
            await act(async () => { api().setSelectedIndex(1); });
            await act(async () => { api().handleQueryChange('bd'); });
            expect(ids(api())).toEqual(['notes:b', 'notes:d']);
            expect(api().isLoading).toBe(true);
            await act(async () => { await vi.advanceTimersByTimeAsync(200); });
            await act(async () => { resolve([hit('d'), hit('b')]); });
            expect(api().isLoading).toBe(false);
            expect(api().selectedIndex).toBe(0);
            await act(async () => { api().handleQueryChange(''); });
            expect(ids(api())).toEqual(['recent:c', 'recent:a', 'q:zebra', 'notes:b', 'notes:d']);
            expect(getNotesByIds).toHaveBeenCalledTimes(1);
            expect(getRecentlyModifiedNotes).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('lists recent notes, then recent searches, then the other notes', async () => {
        const api = await render();
        expect(ids(api())).toEqual(['recent:c', 'recent:a', 'q:zebra', 'notes:b', 'notes:d']);
        // One load per open: the opened notes by id, and the latest 30.
        expect(getNotesByIds).toHaveBeenCalledTimes(1);
        expect(getRecentlyModifiedNotes).toHaveBeenCalledWith(30);
        expect(getRecentlyModifiedNotes).toHaveBeenCalledTimes(1);
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
            expect(onSelectNote).toHaveBeenCalledWith('b', undefined);
            expect(stored(RECENT_SEARCHES_KEY)).toEqual(['Bee', 'zebra']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('searches with the untrimmed query, so a trailing space ends the last word', async () => {
        vi.useFakeTimers();
        try {
            advancedSearch.mockResolvedValue([]);
            const api = await render();
            await act(async () => { api().handleQueryChange('zeppelin '); });
            await act(async () => { await vi.advanceTimersByTimeAsync(200); });
            expect(advancedSearch).toHaveBeenCalledWith('zeppelin ');
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
