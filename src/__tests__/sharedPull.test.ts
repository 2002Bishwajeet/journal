/**
 * "Shared with me" from the owners' side (#732): the shared pull queries one owner's
 * Journal drive over peer and imports what is shared with the host. Nothing polls
 * (#1494): an owner is pulled only for a reason, and Refresh never lists connections.
 * Real PGlite; the peer, connection and notification APIs are stubbed at the SDK boundary.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const mocks = vi.hoisted(() => ({
    getConnections: vi.fn(),
    queryModifiedOverPeer: vi.fn(),
    GetNotifications: vi.fn(),
    MarkNotificationsAsRead: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/network', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/network')>()),
    getConnections: mocks.getConnections,
}));
vi.mock('@homebase-id/js-lib/peer', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/peer')>()),
    queryModifiedOverPeer: mocks.queryModifiedOverPeer,
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/core')>()),
    GetNotifications: mocks.GetNotifications,
    MarkNotificationsAsRead: mocks.MarkNotificationsAsRead,
}));
vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => client }));

import { pullOwnerNow, revalidateOwner } from '@/lib/homebase/sync/sharedPull';
import { dismissPeerNote, handleInvitation } from '@/lib/homebase/sync/peerNotes';
import { refreshSharedNotes } from '@/hooks/useSharedPull';
import { getSearchIndexEntry, getSharedNoteOwners, getSyncRecord } from '@/lib/db';
import { JOURNAL_APP_ID, JOURNAL_PUSH_TYPE_SHARE } from '@/lib/homebase/config';
import type { SyncContext } from '@/lib/homebase/sync/context';
import type { DotYouClient, HomebaseFile } from '@homebase-id/js-lib/core';
import type { NoteFileContent } from '@/types';

const HOST = 'sam.dotyou.cloud';
const OWNER = 'frodo.dotyou.cloud';
const OTHER = 'merry.dotyou.cloud';
const client = { getHostIdentity: () => HOST } as unknown as DotYouClient;

const SHARED = '11111111-1111-4111-8111-111111111111';
const PUBLIC = '22222222-2222-4222-8222-222222222222';
const NOT_FOR_ME = '33333333-3333-4333-8333-333333333333';
const NAMED = '44444444-4444-4444-8444-444444444444';
const FROM_OTHER = '55555555-5555-4555-8555-555555555555';

const KEY_HEADER = { iv: new Uint8Array(16), encryptedAesKey: new Uint8Array(48), encryptionVersion: 1, type: 11 };

function note(uniqueId: string, content: Partial<NoteFileContent>, isEncrypted = true): HomebaseFile {
    return {
        fileId: `file-${uniqueId}`,
        fileState: 'active',
        fileMetadata: {
            isEncrypted,
            updated: 1_700_000_000_000,
            versionTag: 'v1',
            appData: { uniqueId, content: { title: `Title ${uniqueId.slice(0, 4)}`, tags: [], ...content } },
        },
        sharedSecretEncryptedKeyHeader: KEY_HEADER,
    } as unknown as HomebaseFile;
}

const sharedNote = (uniqueId = SHARED) => note(uniqueId, { isCollaborative: true, circleIds: ['circle-1'] });
const forbidden = () => Object.assign(new Error('403'), { response: { status: 403 } });

/** What each owner's drive returns to the host; an Error makes that owner's query and reads fail. */
let drives: Record<string, HomebaseFile[] | Error>;

function ctx(): SyncContext {
    const find = (uniqueId: string, owner?: string) => {
        const files = drives[owner ?? ''];
        if (files instanceof Error) throw files;
        return files?.find((f) => f.fileMetadata.appData.uniqueId === uniqueId) ?? null;
    };
    return {
        hostIdentity: HOST,
        notesProvider: {
            dsrToContent: vi.fn(async (file: HomebaseFile) => file.fileMetadata.appData.content),
            getNote: vi.fn(async (uniqueId: string, owner?: string) => find(uniqueId, owner)),
            getNotePayload: vi.fn(async () => null),
        },
    } as unknown as SyncContext;
}

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

beforeEach(async () => {
    await resetTestDatabase();
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    drives = { [OWNER]: [] };
    // 50 connections: none of them may be asked unless there is a reason
    mocks.getConnections.mockResolvedValue({
        results: Array.from({ length: 50 }, (_, i) => ({ odinId: `c${i}.dotyou.cloud` })),
        cursor: undefined,
    });
    mocks.queryModifiedOverPeer.mockImplementation(async (_client: DotYouClient, owner: string) => {
        const files = drives[owner];
        if (files instanceof Error) throw files;
        return { includeHeaderContent: true, cursor: `cursor-${owner}`, searchResults: files ?? [] };
    });
    mocks.GetNotifications.mockResolvedValue({ results: [] });
    mocks.MarkNotificationsAsRead.mockResolvedValue({});
});

const pull = (c: SyncContext, owner = OWNER) => pullOwnerNow(c, client, owner);
const queriedOwners = () => mocks.queryModifiedOverPeer.mock.calls.map((call) => call[1]);

describe('pullOwnerNow', () => {
    it('imports a note shared with the host once, under its owner', async () => {
        drives[OWNER] = [sharedNote()];
        const c = ctx();

        await pull(c);
        await pull(c);

        const entry = await getSearchIndexEntry(SHARED);
        expect(entry?.metadata.isCollaborative).toBe(true);
        expect(entry?.metadata.authorOdinId).toBe(OWNER);
        expect((await getSyncRecord(SHARED))?.authorOdinId).toBe(OWNER);
        // The second pull found it synced already and left it alone
        expect(c.notesProvider.getNote).toHaveBeenCalledTimes(1);
    });

    it('queries only that owner, never the connection list', async () => {
        drives[OTHER] = [sharedNote(FROM_OTHER)];

        await pull(ctx());

        expect(queriedOwners()).toEqual([OWNER]);
        expect(mocks.getConnections).not.toHaveBeenCalled();
        expect(await getSearchIndexEntry(FROM_OTHER)).toBeNull();
    });

    it('imports a note shared with the host by name', async () => {
        drives[OWNER] = [note(NAMED, { isCollaborative: true, recipients: [HOST] })];

        await pull(ctx());

        expect(await getSearchIndexEntry(NAMED)).not.toBeNull();
    });

    // #897: a viewer is named in odinIds, not in recipients
    it('imports a note that names the host as a viewer, with its role', async () => {
        drives[OWNER] = [note(NAMED, { isCollaborative: true, odinIds: [HOST], recipients: [] })];

        await pull(ctx());

        expect((await getSearchIndexEntry(NAMED))?.metadata).toMatchObject({
            authorOdinId: OWNER,
            odinIds: [HOST],
            recipients: [],
        });
    });

    it('ignores a note that names someone else as a viewer', async () => {
        drives[OWNER] = [note(NOT_FOR_ME, { isCollaborative: true, odinIds: [OTHER], recipients: [] })];

        await pull(ctx());

        expect(await getSearchIndexEntry(NOT_FOR_ME)).toBeNull();
    });

    it('ignores a public note and a note not shared with the host', async () => {
        drives[OWNER] = [
            note(PUBLIC, { isPublic: true }, false),
            note(NOT_FOR_ME, { isCollaborative: true, recipients: [OTHER] }),
        ];
        const c = ctx();

        await pull(c);

        expect(await getSearchIndexEntry(PUBLIC)).toBeNull();
        expect(await getSearchIndexEntry(NOT_FOR_ME)).toBeNull();
        expect(c.notesProvider.getNote).not.toHaveBeenCalled();
    });

    it('omits the cursor on the first query', async () => {
        await pull(ctx());
        await pull(ctx());

        expect(mocks.queryModifiedOverPeer.mock.calls.map((call) => call[3].cursor)).toEqual([undefined, undefined]);
    });

    it('rejects when the owner does not answer', async () => {
        drives[OWNER] = new Error('404');

        await expect(pull(ctx())).rejects.toThrow(OWNER);
    });

    it('removes a note its owner no longer returns', async () => {
        drives[OWNER] = [sharedNote()];
        await pull(ctx());
        drives[OWNER] = [];

        await pull(ctx());

        expect(await getSearchIndexEntry(SHARED)).toBeNull();
        expect(await getSyncRecord(SHARED)).toBeNull();
    });

    it('keeps the note when its owner errored', async () => {
        drives[OWNER] = [sharedNote()];
        await pull(ctx());
        drives[OWNER] = new Error('500');

        await expect(pull(ctx())).rejects.toThrow();

        expect(await getSearchIndexEntry(SHARED)).not.toBeNull();
    });

    // #897: taken off every share, the host loses the drive access too, so the query is a 403
    it('drops the notes the owner no longer shares when the owner refuses the query', async () => {
        drives[OWNER] = [sharedNote()];
        await pull(ctx());
        drives[OWNER] = forbidden();

        await expect(pull(ctx())).rejects.toThrow();

        expect(await getSearchIndexEntry(SHARED)).toBeNull();
    });

    it('keeps notes from other owners', async () => {
        drives[OWNER] = [sharedNote()];
        await pull(ctx());
        drives[OTHER] = [];

        await pull(ctx(), OTHER);

        expect(await getSearchIndexEntry(SHARED)).not.toBeNull();
    });
});

// #1494: the owner's unshare push makes the recipient check that owner's notes
describe('revalidateOwner', () => {
    it("drops the owner's notes it no longer shares and keeps the rest", async () => {
        drives[OWNER] = [sharedNote(), sharedNote(NAMED)];
        drives[OTHER] = [sharedNote(FROM_OTHER)];
        await pull(ctx());
        await pull(ctx(), OTHER);
        drives[OWNER] = [sharedNote(NAMED)];
        mocks.queryModifiedOverPeer.mockClear();

        await revalidateOwner(ctx(), OWNER);

        expect(await getSearchIndexEntry(SHARED)).toBeNull();
        expect(await getSearchIndexEntry(NAMED)).not.toBeNull();
        expect(await getSearchIndexEntry(FROM_OTHER)).not.toBeNull();
        expect(mocks.queryModifiedOverPeer).not.toHaveBeenCalled();
        expect(mocks.getConnections).not.toHaveBeenCalled();
    });

    it('drops a note the owner refuses to return', async () => {
        drives[OWNER] = [sharedNote()];
        await pull(ctx());
        drives[OWNER] = forbidden();

        await revalidateOwner(ctx(), OWNER);

        expect(await getSearchIndexEntry(SHARED)).toBeNull();
    });
});

describe('refreshSharedNotes', () => {
    const sync = (c: SyncContext) => ({
        pullOwnerNow: vi.fn((owner: string) => pullOwnerNow(c, client, owner)),
        revalidateOwner: vi.fn((owner: string) => revalidateOwner(c, owner)),
    });

    it('pulls only the owners the host has notes from, never the connection list', async () => {
        drives[OWNER] = [sharedNote()];
        drives[OTHER] = [sharedNote(FROM_OTHER)];
        const c = ctx();
        await pull(c);
        mocks.queryModifiedOverPeer.mockClear();

        await refreshSharedNotes(client, sync(c));

        expect(queriedOwners()).toEqual([OWNER]);
        expect(mocks.getConnections).not.toHaveBeenCalled();
        expect(await getSearchIndexEntry(FROM_OTHER)).toBeNull();
    });

    it('also pulls an owner with an unread share push, once, and marks it read', async () => {
        drives[OWNER] = [sharedNote()];
        drives[OTHER] = [sharedNote(FROM_OTHER)];
        const c = ctx();
        await pull(c);
        mocks.queryModifiedOverPeer.mockClear();
        const push = (id: string, senderId: string) =>
            ({ id, senderId, unread: true, created: 0, options: { appId: JOURNAL_APP_ID, typeId: JOURNAL_PUSH_TYPE_SHARE, tagId: '' } });
        mocks.GetNotifications.mockResolvedValue({ results: [push('n1', OTHER), push('n2', OWNER)] });

        await refreshSharedNotes(client, sync(c));

        expect(queriedOwners().sort()).toEqual([OTHER, OWNER].sort());
        expect(await getSearchIndexEntry(FROM_OTHER)).not.toBeNull();
        expect([...mocks.MarkNotificationsAsRead.mock.calls[0][1]].sort()).toEqual(['n1', 'n2']);
    });

    it('makes no peer call with no shared notes and no pushes', async () => {
        await refreshSharedNotes(client, sync(ctx()));

        expect(mocks.queryModifiedOverPeer).not.toHaveBeenCalled();
        expect(mocks.getConnections).not.toHaveBeenCalled();
    });
});

describe('getSharedNoteOwners', () => {
    it('lists each owner the host has a shared note from, not the host', async () => {
        drives[OWNER] = [sharedNote(), sharedNote(NAMED)];
        drives[OTHER] = [sharedNote(FROM_OTHER)];
        await pull(ctx());
        await pull(ctx(), OTHER);

        expect((await getSharedNoteOwners(HOST)).sort()).toEqual([OTHER, OWNER].sort());
        expect(await getSharedNoteOwners(OWNER)).toEqual([OTHER]);
    });
});

const invite = {
    fileId: 'invite',
    fileMetadata: {
        senderOdinId: OWNER,
        appData: {
            content: { authorOdinId: OWNER, noteUniqueId: SHARED, noteTitle: 'T', notePreview: '', sharedAt: '2026-01-01T00:00:00.000Z' },
        },
    },
} as unknown as HomebaseFile<string>;

describe('invite and pull', () => {
    it('imports a note that arrives by pull and then by invite once', async () => {
        drives[OWNER] = [sharedNote()];
        const c = ctx();

        await pull(c);
        await handleInvitation(c, invite);

        expect(c.notesProvider.getNote).toHaveBeenCalledTimes(1);
    });

    it('imports a note that arrives by invite and then by pull once', async () => {
        drives[OWNER] = [sharedNote()];
        const c = ctx();

        await handleInvitation(c, invite);
        await pull(c);

        expect(c.notesProvider.getNote).toHaveBeenCalledTimes(1);
        expect(await getSearchIndexEntry(SHARED)).not.toBeNull();
    });
});

// #682: "Remove from my list" is a local delete that has to stick
describe('a note the receiver removed from their list', () => {
    const remove = async () => {
        const entry = await getSearchIndexEntry(SHARED);
        await dismissPeerNote(SHARED, OWNER, entry!.metadata);
    };

    it('stays out after a pull and an invite', async () => {
        drives[OWNER] = [sharedNote()];
        const c = ctx();
        await pull(c);
        await remove();

        await pull(c);
        await handleInvitation(c, invite);

        expect(await getSearchIndexEntry(SHARED)).toBeNull();
        expect(await getSyncRecord(SHARED)).toBeNull();
    });

    it('comes back when the owner changes who it is shared with', async () => {
        drives[OWNER] = [sharedNote()];
        const c = ctx();
        await pull(c);
        await remove();

        drives[OWNER] = [note(SHARED, { isCollaborative: true, circleIds: ['circle-1', 'circle-2'] })];
        await pull(c);

        expect(await getSearchIndexEntry(SHARED)).not.toBeNull();
    });

    it('comes back when the owner stops sharing it and shares it again', async () => {
        drives[OWNER] = [sharedNote()];
        const c = ctx();
        await pull(c);
        await remove();

        drives[OWNER] = [];
        await pull(c);
        drives[OWNER] = [sharedNote()];
        await pull(c);

        expect(await getSearchIndexEntry(SHARED)).not.toBeNull();
    });
});
