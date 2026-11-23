// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import type { KeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { RECENT_SEARCHES_KEY } from '@/lib/storage';

// Search filters in the search dialog (#1230): suggestions, completion, chips and the phone's buttons.

const advancedSearch = vi.fn();
vi.mock('@/lib/db', () => ({
    getNotesByIds: async () => [],
    getRecentlyModifiedNotes: async () => [],
    getAllFolders: async () => [{ id: 'f-travel', name: 'Travel' }, { id: 'f-work', name: 'Work' }],
    getTagCounts: async () => [{ tag: 'recipe', count: 3 }, { tag: 'work', count: 2 }, { tag: 'bread', count: 1 }],
    advancedSearch: (query: string, options: unknown) => advancedSearch(query, options),
}));

import { useSearchModal } from '@/hooks/useSearchModal';

type Api = ReturnType<typeof useSearchModal>;

const key = (k: string) => ({ key: k, preventDefault: () => {} }) as unknown as KeyboardEvent;
const rows = (api: Api) =>
    api.entries.map((e) => (e.kind === 'filter' ? `filter:${e.label}${e.count === undefined ? '' : ` ${e.count}`}` : e.kind === 'note' ? `note:${e.result.docId}` : `q:${e.text}`));

const onClose = vi.fn();
async function render() {
    const result = { current: null as Api | null };
    function Probe() {
        result.current = useSearchModal({ isOpen: true, onClose, onSelectNote: () => {} });
        return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => { root.render(h(Probe)); });
    await act(async () => {});
    return () => result.current!;
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    onClose.mockReset();
    advancedSearch.mockReset().mockResolvedValue([{ docId: 'n1', title: 'Soup', score: 1, matchType: 'title', metadata: {} }]);
    vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

describe('useSearchModal filters', () => {
    it('lists the tags that contain the typed text first, in the flat keyboard list', async () => {
        const api = await render();
        await act(async () => { api().handleQueryChange('tag:re'); });
        await settle();
        // "recipe" starts with "re" and "bread" only contains it.
        expect(rows(api())).toEqual(['filter:#recipe 3', 'filter:#bread 1', 'note:n1']);
        // The suggestions are not results (#1231).
        expect(api().status).toBe('1 result');
        advancedSearch.mockResolvedValueOnce([]);
        await act(async () => { api().handleQueryChange('tag:re '); });
        await settle();
        // Not the visible "No notes found…" text, which would then be on screen twice.
        expect(api().status).toBe('No results');
        await act(async () => { api().handleQueryChange('tag:re'); });
        await settle();
        await act(async () => { api().handleKeyDown(key('ArrowDown')); });
        expect(api().selectedIndex).toBe(1);
        await act(async () => { api().handleKeyDown(key('ArrowDown')); });
        expect(api().entries[api().selectedIndex].kind).toBe('note');
    });

    it('Enter completes the token, keeps the dialog open and searches that tag', async () => {
        const api = await render();
        await act(async () => { api().handleQueryChange('soup tag:re'); });
        await act(async () => { api().handleKeyDown(key('Enter')); });
        expect(api().query).toBe('soup tag:recipe ');
        expect(onClose).not.toHaveBeenCalled();
        await settle();
        expect(rows(api())).toEqual(['note:n1']);
        expect(advancedSearch).toHaveBeenLastCalledWith('soup  ', { filters: { tags: ['recipe'] } });
        expect(api().chips.map((c) => c.label)).toEqual(['#recipe']);
    });

    it('completes a #tag as #tag and a folder or flag by its name', async () => {
        const api = await render();
        await act(async () => { api().handleQueryChange('#wo'); });
        expect(rows(api())).toEqual(['filter:#work 2']);
        await act(async () => { api().handleSelectEntry(api().entries[0]); });
        expect(api().query).toBe('#work ');

        await act(async () => { api().handleQueryChange('folder:'); });
        expect(rows(api())).toEqual(['filter:Travel', 'filter:Work', 'filter:Shared with me']);
        await act(async () => { api().handleQueryChange('is:p'); });
        expect(rows(api())).toEqual(['filter:Pinned', 'filter:Public']);
        await act(async () => { api().handleQueryChange('after:'); });
        expect(rows(api())).toEqual(['filter:Today', 'filter:Yesterday', 'filter:Last 7 days', 'filter:Last 30 days']);
        // A token typed in full has no suggestion left.
        await act(async () => { api().handleQueryChange('is:pinned'); });
        expect(rows(api()).filter((r) => r.startsWith('filter:'))).toEqual([]);
    });

    it('shows no suggestions once the caret leaves the token', async () => {
        const api = await render();
        await act(async () => { api().handleQueryChange('tag:re soup'); });
        expect(api().entries.some((e) => e.kind === 'filter')).toBe(false);
        await act(async () => { api().handleCaretChange(6); });
        expect(api().entries.filter((e) => e.kind === 'filter')).toHaveLength(2);
    });

    it('resolves folder: to folder ids, and passes the text without the filters', async () => {
        const api = await render();
        await act(async () => { api().handleQueryChange('folder:trav plan'); });
        await settle();
        expect(advancedSearch).toHaveBeenLastCalledWith(' plan', { filters: { folderIds: ['f-travel'] } });
        expect(api().chips.map((c) => c.label)).toEqual(['Travel']);
        expect(api().searchText).toBe(' plan');
    });

    it('removing a chip removes exactly its token and searches again', async () => {
        const api = await render();
        await act(async () => { api().handleQueryChange('budget tag:work after:2026-10 plan'); });
        await settle();
        expect(api().chips.map((c) => c.label)).toEqual(['#work', 'after 2026-10']);
        await act(async () => { api().handleRemoveChip(api().chips[0]); });
        expect(api().query).toBe('budget after:2026-10 plan');
        await settle();
        expect(advancedSearch).toHaveBeenLastCalledWith('budget  plan', { filters: { after: new Date(2026, 9, 1).toISOString() } });
        await act(async () => { api().handleRemoveChip(api().chips[0]); });
        expect(api().query).toBe('budget plan');
    });

    it('the filter buttons start a token, and Pinned toggles is:pinned', async () => {
        const api = await render();
        await act(async () => { api().handleQueryChange('budget'); });
        await act(async () => { api().handleFilterButton('tag'); });
        expect(api().query).toBe('budget tag:');
        expect(rows(api()).slice(0, 3)).toEqual(['filter:#recipe 3', 'filter:#work 2', 'filter:#bread 1']);
        await act(async () => { api().handleQueryChange(''); });
        await act(async () => { api().handleFilterButton('date'); });
        expect(api().query).toBe('after:');
        await act(async () => { api().handleQueryChange('soup '); });
        await act(async () => { api().handleFilterButton('pinned'); });
        expect(api().query).toBe('soup is:pinned ');
        expect(api().chips.map((c) => c.label)).toEqual(['Pinned']);
        await act(async () => { api().handleFilterButton('pinned'); });
        expect(api().query).toBe('soup');
    });

    it('searches filters alone, and remembers the query as typed', async () => {
        const api = await render();
        await act(async () => { api().handleQueryChange('is:pinned'); });
        await settle();
        expect(advancedSearch).toHaveBeenLastCalledWith('', { filters: { pinned: true } });
        await act(async () => { api().handleSelectResult('n1'); });
        expect(JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY)!).items).toEqual(['is:pinned']);
    });
});
