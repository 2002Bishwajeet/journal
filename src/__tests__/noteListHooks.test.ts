// @vitest-environment happy-dom
/**
 * The layout's note list and note actions live in two hooks. These pin the
 * behaviour the layout relies on: which list each route shows, deleting the
 * open note opens its neighbour, creating a note from a pseudo-folder lands in
 * Main, opening a note keeps the tag filter, and revoking collaboration moves
 * the note back to Main.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    trashNote: vi.fn<(id: string) => Promise<void>>(async () => {}),
    createNote: vi.fn(async (folderId?: string) => ({ docId: 'new', folderId: folderId ?? '' })),
    updateNote: vi.fn<(params: unknown) => Promise<void>>(async () => {}),
    revokeNoteCollaboration: vi.fn<(docId: string, odinId: string) => Promise<void>>(async () => {}),
    lists: {} as Record<string, unknown[]>,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@/components/auth', () => ({
    useDotYouClientContext: () => ({ getHostIdentity: () => 'me.id' }),
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class {
        revokeNoteCollaboration = mocks.revokeNoteCollaboration;
    },
}));
vi.mock('@/hooks/useFolders', () => ({
    resolveNoteFolderId: (folderId: string | undefined, folders: ReadonlyArray<{ id: string }>) =>
        folderId && folders.some((f) => f.id === folderId) ? folderId : 'main',
}));
vi.mock('@/lib/homebase/config', () => ({
    MAIN_FOLDER_ID: 'main',
    PSEUDO_FOLDERS: { trash: 'trash', archive: 'archive', shared: 'shared' },
}));
const list = (key: string) => ({ data: mocks.lists[key], isLoading: key === 'loading' });
const mutation = (fn: unknown) => ({ mutateAsync: fn });
vi.mock('@/hooks/useNotes', () => ({
    useNotesByFolder: (folderId: string | undefined) => list(`folder:${folderId}`),
    useNoteCounts: () => ({ trashed: 1, archived: 2, collaborative: 3 }),
    useCollaborativeNotes: (enabled: boolean) => list(enabled ? 'shared' : 'off'),
    useTrashedNotes: (enabled: boolean) => list(enabled ? 'trash' : 'off'),
    useArchivedNotes: (enabled: boolean) => list(enabled ? 'archive' : 'off'),
    useNotes: () => ({
        createNote: mutation(mocks.createNote),
        deleteNote: mutation(vi.fn(async () => {})),
        trashNote: mutation(mocks.trashNote),
        restoreNote: mutation(vi.fn(async () => {})),
        archiveNote: mutation(vi.fn(async () => {})),
        unarchiveNote: mutation(vi.fn(async () => {})),
        emptyTrash: mutation(vi.fn(async () => {})),
        updateNote: mutation(mocks.updateNote),
    }),
}));
vi.mock('@/hooks/useTags', () => ({
    useNotesByTag: (tag: string | null) => list(tag ? `tag:${tag}` : 'off'),
}));

import { useNoteListView } from '@/hooks/useNoteListView';
import { useNoteActions } from '@/hooks/useNoteActions';
import type { NoteListEntry } from '@/types';

const note = (docId: string, folderId = 'f1') =>
    ({ docId, title: docId, preview: '', metadata: { folderId } }) as unknown as NoteListEntry;
const NOTES = [note('a'), note('b'), note('c')];

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.trashNote.mockResolvedValue(undefined);
    mocks.lists = {
        'folder:f1': [note('f')],
        'folder:shared': [note('fs')],
        'folder:trash': [note('ft')],
        'folder:undefined': [note('fu')],
        shared: [note('s')],
        trash: [note('t')],
        archive: [note('r')],
        'tag:x': [note('x')],
    };
});

async function renderHook<T>(hook: () => T) {
    const result = { current: null as T | null };
    function Probe() {
        result.current = hook();
        return null;
    }
    const el = document.createElement('div');
    const root = createRoot(el);
    await act(async () => { root.render(h(Probe)); });
    return { api: () => result.current!, unmount: async () => act(async () => root.unmount()) };
}

describe('useNoteListView', () => {
    const view = async (folderId: string | undefined, selectedTag: string | null = null) => {
        const { api, unmount } = await renderHook(() => useNoteListView({ folderId, selectedTag }));
        const value = api();
        await unmount();
        return { ids: value.notes.map((n) => n.docId), isManagementView: value.isManagementView, counts: value.counts };
    };

    it('shows the folder list for a folder route', async () => {
        expect(await view('f1')).toMatchObject({ ids: ['f'], isManagementView: false });
    });

    it('shows the shared list for /shared', async () => {
        expect(await view('shared')).toMatchObject({ ids: ['s'], isManagementView: false });
    });

    it('shows the tag list when a tag is selected', async () => {
        expect((await view(undefined, 'x')).ids).toEqual(['x']);
    });

    it('shows Trash and Archive as management views', async () => {
        expect(await view('trash')).toMatchObject({ ids: ['t'], isManagementView: true });
        expect(await view('archive')).toMatchObject({ ids: ['r'], isManagementView: true });
    });

    it('returns the sidebar badge counts', async () => {
        expect((await view('f1')).counts).toEqual({ trashed: 1, archived: 2, collaborative: 3 });
    });
});

describe('useNoteActions', () => {
    const actions = (overrides: Partial<Parameters<typeof useNoteActions>[0]> = {}) =>
        renderHook(() =>
            useNoteActions({
                folderId: 'f1',
                noteId: 'b',
                selectedTag: null,
                notes: NOTES,
                folders: [{ id: 'f1' }],
                closeTab: vi.fn(),
                handleTabClose: vi.fn(),
                ...overrides,
            }),
        );

    it('trashes the open note and opens the next one', async () => {
        const closeTab = vi.fn();
        const { api, unmount } = await actions({ closeTab });
        await act(async () => api().deleteAndSelectNeighbour('b'));

        expect(closeTab).toHaveBeenCalledWith('b');
        expect(mocks.trashNote).toHaveBeenCalledWith('b');
        expect(mocks.navigate).toHaveBeenCalledWith('/f1/c', { viewTransition: true });
        await unmount();
    });

    it('opens the previous note when the last one is deleted, and the folder when none is left', async () => {
        const last = await actions({ noteId: 'c' });
        await act(async () => last.api().deleteAndSelectNeighbour('c'));
        expect(mocks.navigate).toHaveBeenCalledWith('/f1/b', { viewTransition: true });
        await last.unmount();

        const only = await actions({ noteId: 'a', notes: [note('a')] });
        await act(async () => only.api().deleteAndSelectNeighbour('a'));
        expect(mocks.navigate).toHaveBeenLastCalledWith('/f1', { viewTransition: true });
        await only.unmount();
    });

    it("doesn't navigate when a note that isn't open is deleted, or trashing fails", async () => {
        const { api, unmount } = await actions();
        await act(async () => api().deleteAndSelectNeighbour('a'));
        mocks.trashNote.mockRejectedValueOnce(new Error('offline'));
        await act(async () => api().deleteAndSelectNeighbour('b'));

        expect(mocks.navigate).not.toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalledWith("Couldn't move note to Trash");
        await unmount();
    });

    it('creates a note in Main from a pseudo-folder and opens it', async () => {
        const { api, unmount } = await actions({ folderId: 'trash' });
        await act(async () => api().createAndOpen('trash'));

        expect(mocks.createNote).toHaveBeenCalledWith('main');
        expect(mocks.navigate).toHaveBeenCalledWith('/main/new', { viewTransition: true });
        await unmount();
    });

    it("opens a note in its own folder and keeps the tag filter", async () => {
        const { api, unmount } = await actions({
            folderId: undefined,
            selectedTag: 'x y',
            notes: [note('t1', 'f9')],
        });
        api().selectNote('t1');

        expect(mocks.navigate).toHaveBeenCalledWith('/f9/t1?tag=x%20y', { viewTransition: true });
        await unmount();
    });

    it('revokes collaboration and moves the note back to Main', async () => {
        const { api, unmount } = await actions();
        await act(async () => api().revokeCollaboration(note('s', 'shared')));

        expect(mocks.revokeNoteCollaboration).toHaveBeenCalledWith('s', 'me.id');
        expect(mocks.updateNote).toHaveBeenCalledWith({
            docId: 's',
            metadata: expect.objectContaining({
                folderId: 'main',
                isCollaborative: false,
                lastEditedBy: 'me.id',
            }),
        });
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Collaboration revoked');
        await unmount();
    });
});
