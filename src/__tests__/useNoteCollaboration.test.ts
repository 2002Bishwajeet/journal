// @vitest-environment happy-dom
/**
 * useNoteCollaboration owns sharing a note with circles and revoking it. Pins the
 * order of the share steps (flush, sync record, provider, unpublish, local
 * metadata), the recipients it derives, and that revoking moves the note to Main.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
    calls: [] as string[],
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    flushAndSyncNote: vi.fn(),
    getSyncRecord: vi.fn(),
    makeNoteCollaborative: vi.fn(),
    revokeNoteCollaboration: vi.fn(),
    supersedeNoteHeaders: vi.fn(),
    setNotePublic: vi.fn(),
    updateNote: vi.fn(),
    notes: [] as unknown[],
    fetchMembersOfCircle: vi.fn(),
    getConnectionInfo: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/network', () => ({
    fetchMembersOfCircle: mocks.fetchMembersOfCircle,
    getConnectionInfo: mocks.getConnectionInfo,
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@/components/auth', () => ({
    useDotYouClientContext: () => ({ getHostIdentity: () => 'me.id' }),
}));
vi.mock('@/hooks/useSyncService', () => ({
    useSyncService: () => ({
        syncService: { flushAndSyncNote: mocks.flushAndSyncNote, supersedeNoteHeaders: mocks.supersedeNoteHeaders },
    }),
}));
vi.mock('@/lib/db', () => ({ getSyncRecord: mocks.getSyncRecord }));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class {
        makeNoteCollaborative = mocks.makeNoteCollaborative;
        revokeNoteCollaboration = mocks.revokeNoteCollaboration;
    },
}));
vi.mock('@/lib/homebase/config', () => ({ MAIN_FOLDER_ID: 'main', COLLABORATIVE_FOLDER_ID: 'collab' }));
vi.mock('@/hooks/useNotes', () => ({
    useNotes: () => ({
        get: { data: mocks.notes },
        updateNote: { mutateAsync: mocks.updateNote },
        setNotePublic: { mutateAsync: mocks.setNotePublic },
    }),
}));

import { useNoteCollaboration } from '@/hooks/useNoteCollaboration';
import type { NoteListEntry } from '@/types';

const note = (docId: string, metadata: Record<string, unknown>) =>
    ({ docId, title: docId, preview: '', metadata }) as unknown as NoteListEntry;

const record = (name: string) => vi.fn(async () => { mocks.calls.push(name); return undefined; });

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.calls = [];
    mocks.flushAndSyncNote.mockImplementation(record('flush'));
    mocks.getSyncRecord.mockImplementation(async () => { mocks.calls.push('record'); return { remoteFileId: 'file-1' }; });
    mocks.makeNoteCollaborative.mockImplementation(record('provider'));
    mocks.revokeNoteCollaboration.mockImplementation(async () => {
        mocks.calls.push('revoke');
        return { versionTag: 'v3', previousUpdated: 2000 };
    });
    mocks.supersedeNoteHeaders.mockImplementation(() => { mocks.calls.push('supersede'); });
    mocks.setNotePublic.mockImplementation(record('unpublish'));
    mocks.updateNote.mockImplementation(record('metadata'));
    mocks.notes = [];
    mocks.fetchMembersOfCircle.mockImplementation(async (_c: unknown, id: string) => MEMBERS[id]);
    mocks.getConnectionInfo.mockImplementation(async (_c: unknown, id: string) =>
        ({ status: CONNECTIONS.includes(id) ? 'Connected' : 'none' }));
});

async function mountHook() {
    let api: ReturnType<typeof useNoteCollaboration> | null = null;
    function Probe() {
        api = useNoteCollaboration();
        return null;
    }
    const el = document.createElement('div');
    const root = createRoot(el);
    await act(async () => { root.render(h(Probe)); });
    return { api: () => api!, unmount: () => act(async () => root.unmount()) };
}

const CIRCLES = [
    { circleId: 'c1', name: 'One' },
    { circleId: 'c2', name: 'Two' },
];
const CONNECTIONS = ['a.id', 'b.id', 'sam.id'];
const MEMBERS: Record<string, { domain: string }[]> = {
    c1: [{ domain: 'a.id' }, { domain: 'b.id' }],
    c2: [{ domain: 'b.id' }, { domain: '' }],
};

describe('share', () => {
    it('flushes, reads the sync record, calls the provider, unpublishes, then writes local metadata', async () => {
        mocks.notes = [note('n1', { title: 'N', folderId: 'f1', isPublic: true })];
        const { api, unmount } = await mountHook();

        let shared = false;
        await act(async () => { shared = await api().share('n1', { circles: CIRCLES, odinIds: [] }); });

        expect(shared).toBe(true);
        expect(mocks.calls).toEqual(['flush', 'record', 'provider', 'unpublish', 'metadata']);
        expect(mocks.makeNoteCollaborative).toHaveBeenCalledWith(
            'n1',
            { circleIds: ['c1', 'c2'], odinIds: [], recipients: ['a.id', 'b.id'], removedRecipients: [] },
            'me.id',
            'file-1',
        );
        expect(mocks.setNotePublic).toHaveBeenCalledWith({ docId: 'n1', isPublic: false });
        expect(mocks.updateNote).toHaveBeenCalledWith({
            docId: 'n1',
            metadata: {
                title: 'N',
                isPublic: false,
                folderId: 'collab',
                isCollaborative: true,
                circleIds: ['c1', 'c2'],
                recipients: ['a.id', 'b.id'],
                lastEditedBy: 'me.id',
            },
        });
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Note is now collaborative');
        await unmount();
    });

    it('skips the unpublish for a private note', async () => {
        mocks.notes = [note('n1', { folderId: 'f1', isPublic: false })];
        const { api, unmount } = await mountHook();
        await act(async () => { await api().share('n1', { circles: CIRCLES, odinIds: [] }); });

        expect(mocks.calls).toEqual(['flush', 'record', 'provider', 'metadata']);
        await unmount();
    });

    it('fetches the members of every selected circle itself and dedupes them', async () => {
        const { api, unmount } = await mountHook();
        await act(async () => { await api().share('n1', { circles: CIRCLES, odinIds: [] }); });

        expect(mocks.fetchMembersOfCircle).toHaveBeenCalledTimes(2);
        expect(mocks.makeNoteCollaborative).toHaveBeenCalledWith(
            'n1',
            { circleIds: ['c1', 'c2'], odinIds: [], recipients: ['a.id', 'b.id'], removedRecipients: [] },
            'me.id',
            'file-1',
        );
        await unmount();
    });

    it('blocks the share when a selected circle has no members', async () => {
        MEMBERS.c2 = [];
        const { api, unmount } = await mountHook();
        let shared = true;
        await act(async () => { shared = await api().share('n1', { circles: CIRCLES, odinIds: [] }); });

        expect(shared).toBe(false);
        expect(mocks.toastError).toHaveBeenCalledWith('Two has no members');
        expect(mocks.makeNoteCollaborative).not.toHaveBeenCalled();
        MEMBERS.c2 = [{ domain: 'b.id' }, { domain: '' }];
        await unmount();
    });

    it('rejects an empty selection without calling anything', async () => {
        const { api, unmount } = await mountHook();
        let shared = true;
        await act(async () => { shared = await api().share('n1', { circles: [], odinIds: [] }); });

        expect(shared).toBe(false);
        expect(mocks.calls).toEqual([]);
        expect(mocks.toastError).toHaveBeenCalledWith('Choose at least one circle or person');
        await unmount();
    });

    // #681: share with people by identity
    it('shares with a connection by identity alone, lowercased, and stores them', async () => {
        mocks.notes = [note('n1', { folderId: 'f1' })];
        const { api, unmount } = await mountHook();
        let shared = false;
        await act(async () => { shared = await api().share('n1', { circles: [], odinIds: [' Sam.ID ', 'sam.id'] }); });

        expect(shared).toBe(true);
        expect(mocks.getConnectionInfo).toHaveBeenCalledTimes(1);
        expect(mocks.makeNoteCollaborative).toHaveBeenCalledWith(
            'n1',
            { circleIds: [], odinIds: ['sam.id'], recipients: ['sam.id'], removedRecipients: [] },
            'me.id',
            'file-1',
        );
        expect(mocks.updateNote.mock.calls[0][0].metadata).toMatchObject({
            isCollaborative: true,
            circleIds: undefined,
            odinIds: ['sam.id'],
            recipients: ['sam.id'],
        });
        await unmount();
    });

    it('invites the circle members and the people once each, never the owner', async () => {
        const { api, unmount } = await mountHook();
        await act(async () => { await api().share('n1', { circles: CIRCLES, odinIds: ['b.id', 'sam.id'] }); });

        expect(mocks.makeNoteCollaborative.mock.calls[0][1].recipients).toEqual(['a.id', 'b.id', 'sam.id']);
        await unmount();
    });

    it('refuses an identity that is not a connection, and the owner', async () => {
        const { api, unmount } = await mountHook();
        let shared = true;
        await act(async () => { shared = await api().share('n1', { circles: [], odinIds: ['stranger.id'] }); });
        expect(shared).toBe(false);
        expect(mocks.toastError).toHaveBeenCalledWith('stranger.id is not one of your connections');

        await act(async () => { shared = await api().share('n1', { circles: [], odinIds: ['me.id'] }); });
        expect(shared).toBe(false);
        expect(mocks.toastError).toHaveBeenCalledWith("You can't share a note with yourself");
        expect(mocks.makeNoteCollaborative).not.toHaveBeenCalled();
        await unmount();
    });

    it('changing a share takes the invite back from people no longer on it', async () => {
        mocks.notes = [note('n1', {
            folderId: 'collab', isCollaborative: true, circleIds: ['c1'], odinIds: ['sam.id'],
            recipients: ['a.id', 'b.id', 'sam.id'],
        })];
        const { api, unmount } = await mountHook();
        await act(async () => { await api().share('n1', { circles: [CIRCLES[0]], odinIds: [] }); });

        expect(mocks.makeNoteCollaborative.mock.calls[0][1]).toEqual({
            circleIds: ['c1'], odinIds: [], recipients: ['a.id', 'b.id'], removedRecipients: ['sam.id'],
        });
        expect(mocks.updateNote.mock.calls[0][0].metadata).toMatchObject({ circleIds: ['c1'], odinIds: undefined });
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Sharing updated');
        await unmount();
    });

    it('naming no one on a shared note stops sharing it', async () => {
        mocks.notes = [note('n1', { folderId: 'collab', isCollaborative: true, odinIds: ['sam.id'], recipients: ['sam.id'] })];
        const { api, unmount } = await mountHook();
        let shared = false;
        await act(async () => { shared = await api().share('n1', { circles: [], odinIds: [] }); });

        expect(shared).toBe(true);
        expect(mocks.revokeNoteCollaboration).toHaveBeenCalledWith('n1', 'me.id', ['sam.id']);
        expect(mocks.makeNoteCollaborative).not.toHaveBeenCalled();
        await unmount();
    });

    it('reports a provider failure', async () => {
        mocks.makeNoteCollaborative.mockRejectedValue(new Error('boom'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { api, unmount } = await mountHook();
        let shared = true;
        await act(async () => { shared = await api().share('n1', { circles: CIRCLES, odinIds: [] }); });

        expect(shared).toBe(false);
        expect(mocks.updateNote).not.toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalledWith('Failed to make note collaborative');
        await unmount();
    });
});

describe('revoke', () => {
    it('revokes collaboration and moves the note back to Main', async () => {
        const { api, unmount } = await mountHook();
        await act(async () => api().revoke(note('s', { folderId: 'shared', recipients: ['a.id'] })));

        expect(mocks.revokeNoteCollaboration).toHaveBeenCalledWith('s', 'me.id', ['a.id']);
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

    // #689: a pull holding the pre-revoke header must not undo the local write
    it('supersedes the replaced header before writing local metadata', async () => {
        const { api, unmount } = await mountHook();
        await act(async () => api().revoke(note('s', { folderId: 'shared' })));

        expect(mocks.supersedeNoteHeaders).toHaveBeenCalledWith('s', 2000);
        expect(mocks.calls).toEqual(['revoke', 'supersede', 'metadata']);
        await unmount();
    });

    it('reports a failed revoke and leaves local metadata alone', async () => {
        mocks.revokeNoteCollaboration.mockRejectedValue(new Error('versionTagMismatch'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { api, unmount } = await mountHook();
        await act(async () => api().revoke(note('s', { folderId: 'shared' })));

        expect(mocks.updateNote).not.toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalledWith('Failed to revoke collaboration');
        await unmount();
    });
});
