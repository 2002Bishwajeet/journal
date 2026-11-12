// @vitest-environment happy-dom
/**
 * #1013: the tray menu's "New note" reaches the app as an event. Wired as in JournalLayout
 * (useNoteActions + useTrayNewNote), it creates a note in the current folder and opens it,
 * only in the native app, and the listener is removed with the component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
    const unlisten = vi.fn();
    return {
        unlisten,
        listenTrayNewNote: vi.fn<(handler: () => void) => Promise<() => void>>(async () => unlisten),
        navigate: vi.fn(),
        createNote: vi.fn(async (p: { folderId?: string; tags?: string[] }) => ({ docId: 'new', folderId: p.folderId ?? '' })),
    };
});

vi.mock('@premium', () => ({ listenTrayNewNote: mocks.listenTrayNewNote }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/hooks/useMoveNote', () => ({ useMoveNote: () => vi.fn() }));
vi.mock('@/hooks/useBackTo', () => ({ useBackTo: () => vi.fn() }));
vi.mock('@/hooks/useFolders', () => ({
    resolveNoteFolderId: (folderId: string | undefined, folders: ReadonlyArray<{ id: string }>) =>
        folderId && folders.some((f) => f.id === folderId) ? folderId : 'main',
}));
const mutation = (fn: unknown) => ({ mutateAsync: fn });
vi.mock('@/hooks/useNotes', () => ({
    useNotes: () => ({
        createNote: mutation(mocks.createNote),
        deleteNote: mutation(vi.fn()),
        trashNote: mutation(vi.fn()),
        restoreNote: mutation(vi.fn()),
        archiveNote: mutation(vi.fn()),
        unarchiveNote: mutation(vi.fn()),
        emptyTrash: mutation(vi.fn()),
    }),
}));

import { useTrayNewNote } from '@/hooks/useTrayNewNote';
import { useNoteActions } from '@/hooks/useNoteActions';

let host: HTMLDivElement;
let root: Root;

function Layout({ folderId }: { folderId: string | undefined }) {
    const noteActions = useNoteActions({
        folderId,
        noteId: undefined,
        selectedTag: null,
        notes: [],
        folders: [{ id: 'f1' }, { id: 'f2' }],
        closeTab: vi.fn(),
        handleTabClose: vi.fn(),
    });
    useTrayNewNote(noteActions.createAndOpen, folderId);
    return null;
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const pickNewNote = () => act(async () => { mocks.listenTrayNewNote.mock.calls[0][0](); });

beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    root = createRoot(host);
});

afterEach(() => {
    delete (window as { __JOURNAL_NATIVE__?: unknown }).__JOURNAL_NATIVE__;
});

describe('tray New note', () => {
    it('does nothing outside the native app', async () => {
        await act(async () => { root.render(createElement(Layout, { folderId: 'f1' })); });
        await flush();
        expect(mocks.listenTrayNewNote).not.toHaveBeenCalled();
        await act(async () => { root.unmount(); });
    });

    it('creates a note in the current folder and opens it, and stops listening on unmount', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'linux', plugins: [] };
        await act(async () => { root.render(createElement(Layout, { folderId: 'f1' })); });
        await flush();
        expect(mocks.listenTrayNewNote).toHaveBeenCalledTimes(1);

        await pickNewNote();
        expect(mocks.createNote).toHaveBeenCalledWith({ folderId: 'f1', tags: [] });
        expect(mocks.navigate).toHaveBeenCalledWith('/f1/new');

        // The user moved to another folder: the same listener uses the new folder.
        await act(async () => { root.render(createElement(Layout, { folderId: 'f2' })); });
        await pickNewNote();
        expect(mocks.createNote).toHaveBeenLastCalledWith({ folderId: 'f2', tags: [] });
        expect(mocks.navigate).toHaveBeenLastCalledWith('/f2/new');
        expect(mocks.listenTrayNewNote).toHaveBeenCalledTimes(1);

        await act(async () => { root.unmount(); });
        expect(mocks.unlisten).toHaveBeenCalledTimes(1);
    });
});
