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
    ensureShareCircle: vi.fn(),
    enroll: vi.fn(),
    unenroll: vi.fn(),
    enrollViewers: vi.fn(),
    unenrollViewers: vi.fn(),
    getRecipientsOfOwnNotes: vi.fn(),
    flushAndSyncNote: vi.fn(),
    getSyncRecord: vi.fn(),
    makeNoteCollaborative: vi.fn(),
    revokeNoteCollaboration: vi.fn(),
    supersedeNoteHeaders: vi.fn(),
    setNotePublic: vi.fn(),
    updateNote: vi.fn(),
    notes: [] as unknown[],
    fetchMembersOfCircle: vi.fn(),
    sendSharePush: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/network', () => ({ fetchMembersOfCircle: mocks.fetchMembersOfCircle }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@/components/auth', () => ({
    useDotYouClientContext: () => ({ getHostIdentity: () => 'me.id', getRoot: () => 'https://me.id' }),
}));
vi.mock('@/hooks/useSyncService', () => ({
    useSyncService: () => ({
        syncService: { flushAndSyncNote: mocks.flushAndSyncNote, supersedeNoteHeaders: mocks.supersedeNoteHeaders },
    }),
}));
vi.mock('@/lib/db', () => ({ getSyncRecord: mocks.getSyncRecord, getRecipientsOfOwnNotes: mocks.getRecipientsOfOwnNotes }));
vi.mock('@/lib/homebase/ShareCircleProvider', () => ({
    ShareCircleProvider: class {
        ensureShareCircle = mocks.ensureShareCircle;
        enroll = mocks.enroll;
        unenroll = mocks.unenroll;
        enrollViewers = mocks.enrollViewers;
        unenrollViewers = mocks.unenrollViewers;
    },
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class {
        makeNoteCollaborative = mocks.makeNoteCollaborative;
        revokeNoteCollaboration = mocks.revokeNoteCollaboration;
    },
}));
vi.mock('@/lib/homebase/SharePushProvider', () => ({
    SharePushProvider: class {
        send = mocks.sendSharePush;
    },
}));
vi.mock('@/lib/homebase/config', () => ({
    MAIN_FOLDER_ID: 'main',
    COLLABORATIVE_FOLDER_ID: 'collab',
    ownerConsoleDriveUrl: (root: string) => `${root}/owner/apps/console/drives/alias_type`,
}));
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
    localStorage.clear();
    mocks.calls = [];
    mocks.flushAndSyncNote.mockImplementation(record('flush'));
    mocks.getSyncRecord.mockImplementation(async () => { mocks.calls.push('record'); return { remoteFileId: 'file-1' }; });
    // The provider runs the enrollment between the ACL upload and the invite
    mocks.makeNoteCollaborative.mockImplementation(async (...args: unknown[]) => {
        mocks.calls.push('provider');
        await (args[4] as () => Promise<void>)();
        mocks.calls.push('invite');
    });
    mocks.ensureShareCircle.mockImplementation(async () => {
        mocks.calls.push('circle');
        return { circleId: 'share', canEdit: true };
    });
    mocks.enroll.mockImplementation(async (ids: string[]) => {
        mocks.calls.push('enroll');
        return ids.map((odinId) => ({ odinId, status: 'added' }));
    });
    mocks.unenroll.mockImplementation(record('unenroll'));
    mocks.enrollViewers.mockImplementation(async (ids: string[]) => {
        mocks.calls.push('enrollViewers');
        return ids.map((odinId) => ({ odinId, status: 'added' }));
    });
    mocks.unenrollViewers.mockImplementation(record('unenrollViewers'));
    mocks.getRecipientsOfOwnNotes.mockResolvedValue([]);
    mocks.revokeNoteCollaboration.mockImplementation(async () => {
        mocks.calls.push('revoke');
        return { versionTag: 'v3', previousUpdated: 2000 };
    });
    mocks.supersedeNoteHeaders.mockImplementation(() => { mocks.calls.push('supersede'); });
    mocks.setNotePublic.mockImplementation(record('unpublish'));
    mocks.updateNote.mockImplementation(record('metadata'));
    mocks.notes = [];
    mocks.sendSharePush.mockResolvedValue(undefined);
    mocks.fetchMembersOfCircle.mockImplementation(async (_c: unknown, id: string) => MEMBERS[id]);
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
const MEMBERS: Record<string, { domain: string }[]> = {
    c1: [{ domain: 'a.id' }, { domain: 'b.id' }],
    c2: [{ domain: 'b.id' }, { domain: '' }],
};

describe('share', () => {
    it('flushes, reads the sync record, calls the provider, unpublishes, then writes local metadata', async () => {
        mocks.notes = [note('n1', { title: 'N', folderId: 'f1', isPublic: true })];
        const { api, unmount } = await mountHook();

        let shared = false;
        await act(async () => { shared = (await api().share('n1', { circles: CIRCLES, odinIds: [] })).shared; });

        expect(shared).toBe(true);
        expect(mocks.calls).toEqual(['flush', 'record', 'provider', 'circle', 'enroll', 'invite', 'unpublish', 'metadata']);
        expect(mocks.makeNoteCollaborative).toHaveBeenCalledWith(
            'n1', { circleIds: ['c1', 'c2'], odinIds: [], recipients: ['a.id', 'b.id'] }, 'me.id', 'file-1', expect.any(Function),
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
                odinIds: undefined,
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

        expect(mocks.calls).toEqual(['flush', 'record', 'provider', 'circle', 'enroll', 'invite', 'metadata']);
        await unmount();
    });

    it('fetches the members of every selected circle itself and dedupes them', async () => {
        const { api, unmount } = await mountHook();
        await act(async () => { await api().share('n1', { circles: CIRCLES, odinIds: [] }); });

        expect(mocks.fetchMembersOfCircle).toHaveBeenCalledTimes(2);
        expect(mocks.makeNoteCollaborative).toHaveBeenCalledWith(
            'n1', { circleIds: ['c1', 'c2'], odinIds: [], recipients: ['a.id', 'b.id'] }, 'me.id', 'file-1', expect.any(Function),
        );
        await unmount();
    });

    it('blocks the share when a selected circle has no members', async () => {
        MEMBERS.c2 = [];
        const { api, unmount } = await mountHook();
        let shared = true;
        await act(async () => { shared = (await api().share('n1', { circles: CIRCLES, odinIds: [] })).shared; });

        expect(shared).toBe(false);
        expect(mocks.toastError).toHaveBeenCalledWith('Two has no members');
        expect(mocks.makeNoteCollaborative).not.toHaveBeenCalled();
        MEMBERS.c2 = [{ domain: 'b.id' }, { domain: '' }];
        await unmount();
    });

    it('rejects an empty selection without calling anything', async () => {
        const { api, unmount } = await mountHook();
        let shared = true;
        await act(async () => { shared = (await api().share('n1', { circles: [], odinIds: [] })).shared; });

        expect(shared).toBe(false);
        expect(mocks.calls).toEqual([]);
        expect(mocks.toastError).toHaveBeenCalledWith('Choose at least one circle or person');
        await unmount();
    });

    // #730: recipients get drive access through Journal's share circle
    it('enrolls the members of all selected circles once, never the owner', async () => {
        MEMBERS.c2 = [{ domain: 'b.id' }, { domain: 'me.id' }];
        const { api, unmount } = await mountHook();
        await act(async () => { await api().share('n1', { circles: CIRCLES, odinIds: [] }); });

        expect(mocks.enroll).toHaveBeenCalledTimes(1);
        expect(mocks.enroll).toHaveBeenCalledWith(['a.id', 'b.id']);
        MEMBERS.c2 = [{ domain: 'b.id' }, { domain: '' }];
        await unmount();
    });

    it('still saves the share when someone is refused, and names them', async () => {
        mocks.notes = [note('n1', { folderId: 'f1' })];
        mocks.enroll.mockResolvedValue([
            { odinId: 'a.id', status: 'contactNotReviewed' },
            { odinId: 'b.id', status: 'notAConnectedIdentity' },
        ]);
        const { api, unmount } = await mountHook();
        let shared = false;
        await act(async () => { shared = (await api().share('n1', { circles: CIRCLES, odinIds: [] })).shared; });

        expect(shared).toBe(true);
        expect(mocks.updateNote).toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalledWith('Review a.id in Homebase (Connections) so they can open shared notes.');
        expect(mocks.toastError).toHaveBeenCalledWith("b.id isn't connected to you, so they can't open shared notes.");
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Note is now collaborative');
        await unmount();
    });

    it('still saves the share and sends the invite when the share circle fails', async () => {
        mocks.notes = [note('n1', { folderId: 'f1' })];
        mocks.ensureShareCircle.mockRejectedValue(new Error('500'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { api, unmount } = await mountHook();
        let shared = false;
        await act(async () => { shared = (await api().share('n1', { circles: CIRCLES, odinIds: [] })).shared; });

        expect(shared).toBe(true);
        expect(mocks.calls).toContain('invite');
        expect(mocks.updateNote).toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalledWith("Couldn't give the people you shared with access to the note.");
        await unmount();
    });

    it('returns no read-only notice when recipients can edit', async () => {
        const { api, unmount } = await mountHook();
        let result: unknown;
        await act(async () => { result = await api().share('n1', { circles: CIRCLES, odinIds: [] }); });
        expect(result).toEqual({ shared: true });
        await unmount();
    });

    it("returns the drive settings link once per identity while the drive isn't Journal's", async () => {
        mocks.ensureShareCircle.mockResolvedValue({ circleId: 'read', canEdit: false });
        const { api, unmount } = await mountHook();
        const results: unknown[] = [];
        await act(async () => { results.push(await api().share('n1', { circles: CIRCLES, odinIds: [] })); });
        await act(async () => { results.push(await api().share('n1', { circles: CIRCLES, odinIds: [] })); });

        expect(results).toEqual([
            { shared: true, readOnlyDriveUrl: 'https://me.id/owner/apps/console/drives/alias_type' },
            { shared: true },
        ]);
        expect(localStorage.getItem('journal-read-only-share-notice')).toBe('me.id');
        await unmount();
    });

    it('shows the read-only notice again to another identity on the same device', async () => {
        localStorage.setItem('journal-read-only-share-notice', 'someone-else.id');
        mocks.ensureShareCircle.mockResolvedValue({ circleId: 'read', canEdit: false });
        const { api, unmount } = await mountHook();
        let url: string | undefined;
        await act(async () => { url = (await api().share('n1', { circles: CIRCLES, odinIds: [] })).readOnlyDriveUrl; });
        expect(url).toBe('https://me.id/owner/apps/console/drives/alias_type');
        await unmount();
    });

    it('unenrolls people the share dropped who have no other shared note', async () => {
        mocks.notes = [note('n1', { folderId: 'collab', recipients: ['a.id', 'x.id', 'y.id'] })];
        mocks.getRecipientsOfOwnNotes.mockResolvedValue(['a.id', 'b.id', 'y.id']);
        const { api, unmount } = await mountHook();
        await act(async () => { await api().share('n1', { circles: CIRCLES, odinIds: [] }); });

        expect(mocks.getRecipientsOfOwnNotes).toHaveBeenCalledWith('me.id', 'recipients');
        expect(mocks.unenroll).toHaveBeenCalledWith(['x.id']);
        expect(mocks.calls.indexOf('unenroll')).toBeGreaterThan(mocks.calls.indexOf('metadata'));
        await unmount();
    });

    it('sends the share push after the share, with the recipients the note had before (#745)', async () => {
        mocks.notes = [note('n1', { folderId: 'collab', recipients: ['a.id'] })];
        mocks.sendSharePush.mockImplementation(record('push'));
        const { api, unmount } = await mountHook();
        await act(async () => { await api().share('n1', { circles: CIRCLES, odinIds: [] }); });

        expect(mocks.sendSharePush).toHaveBeenCalledWith('n1', ['a.id', 'b.id'], ['a.id']);
        expect(mocks.calls.indexOf('push')).toBeGreaterThan(mocks.calls.indexOf('invite'));
        await unmount();
    });

    // #897: people named on a share are viewers
    it('shares with a person alone as a viewer: Read-only circle, no share circle, lowercased', async () => {
        mocks.notes = [note('n1', { folderId: 'f1' })];
        const { api, unmount } = await mountHook();
        let shared = false;
        await act(async () => { shared = (await api().share('n1', { circles: [], odinIds: [' Sam.ID ', 'sam.id'] })).shared; });

        expect(shared).toBe(true);
        expect(mocks.makeNoteCollaborative).toHaveBeenCalledWith(
            'n1', { circleIds: [], odinIds: ['sam.id'], recipients: [] }, 'me.id', 'file-1', expect.any(Function),
        );
        expect(mocks.ensureShareCircle).not.toHaveBeenCalled();
        expect(mocks.enroll).not.toHaveBeenCalled();
        expect(mocks.enrollViewers).toHaveBeenCalledWith(['sam.id']);
        expect(mocks.updateNote.mock.calls[0][0].metadata).toMatchObject({
            isCollaborative: true,
            circleIds: undefined,
            odinIds: ['sam.id'],
            recipients: [],
        });
        expect(mocks.sendSharePush).toHaveBeenCalledWith('n1', ['sam.id'], []);
        await unmount();
    });

    it('enrolls circle members as editors and people as viewers; someone can be both', async () => {
        const { api, unmount } = await mountHook();
        await act(async () => { await api().share('n1', { circles: CIRCLES, odinIds: ['b.id', 'sam.id'] }); });

        expect(mocks.enroll).toHaveBeenCalledWith(['a.id', 'b.id']);
        expect(mocks.enrollViewers).toHaveBeenCalledWith(['b.id', 'sam.id']);
        expect(mocks.makeNoteCollaborative.mock.calls[0][1]).toEqual({
            circleIds: ['c1', 'c2'], odinIds: ['b.id', 'sam.id'], recipients: ['a.id', 'b.id'],
        });
        await unmount();
    });

    it('names the people the viewers circle refused, and still saves the share', async () => {
        mocks.notes = [note('n1', { folderId: 'f1' })];
        mocks.enrollViewers.mockResolvedValue([{ odinId: 'stranger.id', status: 'notAConnectedIdentity' }]);
        const { api, unmount } = await mountHook();
        let shared = false;
        await act(async () => { shared = (await api().share('n1', { circles: [], odinIds: ['stranger.id'] })).shared; });

        expect(shared).toBe(true);
        expect(mocks.toastError).toHaveBeenCalledWith("stranger.id isn't connected to you, so they can't open shared notes.");
        await unmount();
    });

    it('refuses to name the owner', async () => {
        const { api, unmount } = await mountHook();
        let shared = true;
        await act(async () => { shared = (await api().share('n1', { circles: [], odinIds: ['me.id'] })).shared; });

        expect(shared).toBe(false);
        expect(mocks.toastError).toHaveBeenCalledWith("You can't share a note with yourself");
        expect(mocks.makeNoteCollaborative).not.toHaveBeenCalled();
        await unmount();
    });

    it('unenrolls a removed viewer no other note names, and keeps one another note names', async () => {
        mocks.notes = [note('n1', {
            folderId: 'collab', isCollaborative: true, circleIds: ['c1'], odinIds: ['sam.id', 'kept.id'], recipients: ['a.id', 'b.id'],
        })];
        mocks.getRecipientsOfOwnNotes.mockImplementation(async (_owner: string, key: string) =>
            key === 'odinIds' ? ['kept.id'] : ['a.id', 'b.id']);
        const { api, unmount } = await mountHook();
        await act(async () => { await api().share('n1', { circles: [CIRCLES[0]], odinIds: [] }); });

        expect(mocks.getRecipientsOfOwnNotes).toHaveBeenCalledWith('me.id', 'odinIds');
        expect(mocks.unenrollViewers).toHaveBeenCalledWith(['sam.id']);
        expect(mocks.unenroll).not.toHaveBeenCalled();
        expect(mocks.updateNote.mock.calls[0][0].metadata).toMatchObject({ circleIds: ['c1'], odinIds: undefined });
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Sharing updated');
        await unmount();
    });

    it('pushes only the people new to the share, viewers included', async () => {
        mocks.notes = [note('n1', { folderId: 'collab', isCollaborative: true, odinIds: ['sam.id'], recipients: [] })];
        const { api, unmount } = await mountHook();
        await act(async () => { await api().share('n1', { circles: [], odinIds: ['sam.id', 'new.id'] }); });

        expect(mocks.sendSharePush).toHaveBeenCalledWith('n1', ['sam.id', 'new.id'], ['sam.id']);
        await unmount();
    });

    it('reports a provider failure', async () => {
        mocks.makeNoteCollaborative.mockRejectedValue(new Error('boom'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { api, unmount } = await mountHook();
        let shared = true;
        await act(async () => { shared = (await api().share('n1', { circles: CIRCLES, odinIds: [] })).shared; });

        expect(shared).toBe(false);
        expect(mocks.sendSharePush).not.toHaveBeenCalled();
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

    it('unenrolls only the recipients with no other shared note', async () => {
        mocks.getRecipientsOfOwnNotes.mockResolvedValue(['b.id']);
        const { api, unmount } = await mountHook();
        await act(async () => api().revoke(note('s', { folderId: 'shared', recipients: ['a.id', 'b.id'] })));

        expect(mocks.unenroll).toHaveBeenCalledWith(['a.id']);
        expect(mocks.calls.indexOf('unenroll')).toBeGreaterThan(mocks.calls.indexOf('metadata'));
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Collaboration revoked');
        await unmount();
    });

    it('unenrolls the viewers no other note names (#897)', async () => {
        mocks.getRecipientsOfOwnNotes.mockImplementation(async (_owner: string, key: string) =>
            key === 'odinIds' ? ['kept.id'] : []);
        const { api, unmount } = await mountHook();
        await act(async () => api().revoke(note('s', { folderId: 'shared', odinIds: ['sam.id', 'kept.id'] })));

        expect(mocks.unenrollViewers).toHaveBeenCalledWith(['sam.id']);
        expect(mocks.updateNote.mock.calls[0][0].metadata).toMatchObject({ odinIds: undefined });
        await unmount();
    });

    it('does not touch the share circle when everyone still has a shared note', async () => {
        mocks.getRecipientsOfOwnNotes.mockResolvedValue(['a.id']);
        const { api, unmount } = await mountHook();
        await act(async () => api().revoke(note('s', { folderId: 'shared', recipients: ['a.id'] })));

        expect(mocks.unenroll).not.toHaveBeenCalled();
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
