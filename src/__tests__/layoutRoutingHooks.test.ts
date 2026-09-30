// @vitest-environment happy-dom
/**
 * The layout's tab ↔ URL sync and URL action params live in two hooks. These
 * pin the behaviour the layout relies on: closing the active tab lands on its
 * neighbour, and `?action=search|collaborate` opens the matching UI and then
 * drops the param.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
    getAppState: vi.fn<(key: string) => Promise<unknown>>(async () => null),
    navigate: vi.fn(),
    setSearchParams: vi.fn(),
    search: '',
}));
vi.mock('@/lib/db', () => ({ getAppState: mocks.getAppState }));
vi.mock('react-router-dom', () => ({
    useNavigate: () => mocks.navigate,
    useSearchParams: () => [new URLSearchParams(mocks.search), mocks.setSearchParams],
}));

import { useTabRouting } from '@/hooks/useTabRouting';
import { useLayoutUrlActions } from '@/hooks/useLayoutUrlActions';
import { TABS_STORAGE_KEY } from '@/lib/storage';
import type { NoteListEntry } from '@/types';

const note = (docId: string, folderId = 'f1') =>
    ({ docId, title: docId, preview: '', metadata: { folderId } }) as unknown as NoteListEntry;
const NOTES = [note('a'), note('b'), note('c')];

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    vi.clearAllMocks();
    mocks.getAppState.mockResolvedValue(null);
    mocks.search = '';
});

async function mount(render: () => void) {
    function Probe() {
        render();
        return null;
    }
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(h(Probe)); });
    return async () => { await act(async () => root.unmount()); el.remove(); };
}

describe('useTabRouting', () => {
    it('opens the note in the URL as the active tab', async () => {
        let api: ReturnType<typeof useTabRouting> | null = null;
        const unmount = await mount(() => {
            api = useTabRouting({ noteId: 'b', folderId: 'f1', notes: NOTES, isNotesLoading: false });
        });

        expect(api!.activeTabId).toBe('b');
        expect(api!.openTabs.map((t) => t.docId)).toEqual(['b']);

        await unmount();
    });

    it('navigates to the right neighbour when the active tab closes', async () => {
        localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({
            openTabs: NOTES.map((n) => ({ docId: n.docId, title: n.title })),
            activeTabId: 'b',
        }));
        let api: ReturnType<typeof useTabRouting> | null = null;
        const unmount = await mount(() => {
            api = useTabRouting({ noteId: 'b', folderId: 'f1', notes: NOTES, isNotesLoading: false });
        });

        await act(async () => api!.handleTabClose('b'));

        expect(mocks.navigate).toHaveBeenCalledWith('/f1/c', { viewTransition: true });
        expect(api!.openTabs.map((t) => t.docId)).toEqual(['a', 'c']);
        expect(api!.activeTabId).toBe('c');

        await unmount();
    });
});

describe('useLayoutUrlActions', () => {
    const options = {
        folders: [{ id: 'f1' }],
        isFolderLoading: false,
        folderId: 'f1',
        notes: NOTES,
        createNote: vi.fn(async () => ({ docId: 'new', folderId: 'f1' })),
    };

    it('opens search for ?action=search and removes the param', async () => {
        mocks.search = '?action=search';
        const openSearch = vi.fn();
        const unmount = await mount(() => {
            useLayoutUrlActions({ ...options, openSearch, openCollaborate: vi.fn() });
        });

        expect(openSearch).toHaveBeenCalledWith(true);
        const update = mocks.setSearchParams.mock.calls[0][0] as (p: URLSearchParams) => URLSearchParams;
        expect(update(new URLSearchParams('?action=search&tag=x')).toString()).toBe('tag=x');

        await unmount();
    });

    it('opens the collaborate dialog for ?action=collaborate&noteId=', async () => {
        mocks.search = '?action=collaborate&noteId=c';
        const openCollaborate = vi.fn();
        const unmount = await mount(() => {
            useLayoutUrlActions({ ...options, openSearch: vi.fn(), openCollaborate });
        });

        expect(openCollaborate).toHaveBeenCalledWith(NOTES[2]);
        expect(mocks.setSearchParams).toHaveBeenCalled();

        await unmount();
    });
});
