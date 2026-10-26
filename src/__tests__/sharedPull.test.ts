/**
 * "Shared with me" from the owners' side (#732): the shared pull queries each
 * connection's Journal drive over peer and imports what is shared with the host.
 * Real PGlite; the peer and connection APIs are stubbed at the SDK boundary.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const mocks = vi.hoisted(() => ({
    getConnections: vi.fn(),
    queryModifiedOverPeer: vi.fn(),
    saveAppState: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/network', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/network')>()),
    getConnections: mocks.getConnections,
}));
vi.mock('@homebase-id/js-lib/peer', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/peer')>()),
    queryModifiedOverPeer: mocks.queryModifiedOverPeer,
}));
vi.mock('@/lib/db', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/db')>();
    mocks.saveAppState.mockImplementation(actual.saveAppState);
    return { ...actual, saveAppState: mocks.saveAppState };
});

import { pullShared, pullOwnerNow, SHARED_PULL_STATE_KEY } from '@/lib/homebase/sync/sharedPull';
import { handleInvitation } from '@/lib/homebase/sync/peerNotes';
import { getAppState, getSearchIndexEntry, getSyncRecord } from '@/lib/db';
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

/** What each owner's drive returns to the host; an Error makes that owner's query fail. */
let drives: Record<string, HomebaseFile[] | Error>;

function ctx(): SyncContext {
    const find = (uniqueId: string, owner?: string) => {
        const files = drives[owner ?? ''];
        return Array.isArray(files) ? files.find((f) => f.fileMetadata.appData.uniqueId === uniqueId) ?? null : null;
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
    mocks.getConnections.mockImplementation(async () => ({
        results: Object.keys(drives).map((odinId) => ({ odinId })),
        cursor: undefined,
    }));
    mocks.queryModifiedOverPeer.mockImplementation(async (_client: DotYouClient, owner: string) => {
        const files = drives[owner];
        if (files instanceof Error) throw files;
        return { includeHeaderContent: true, cursor: `cursor-${owner}`, searchResults: files ?? [] };
    });
});

const run = (c: SyncContext, manual = false) => pullShared(c, client, { canReadConnections: true, manual });
const ownerState = async (odinId: string) =>
    (await getAppState<{ owners: Record<string, { cursor?: string; failures: number; nextAttemptAt: number }> }>(SHARED_PULL_STATE_KEY))?.owners[odinId];
const queriedOwners = () => mocks.queryModifiedOverPeer.mock.calls.map((call) => call[1]);

describe('pullShared', () => {
    it('imports a note shared with the host once, under its owner', async () => {
        drives[OWNER] = [sharedNote()];
        const c = ctx();

        await run(c);
        await run(c, true);

        const entry = await getSearchIndexEntry(SHARED);
        expect(entry?.metadata.isCollaborative).toBe(true);
        expect(entry?.metadata.authorOdinId).toBe(OWNER);
        expect((await getSyncRecord(SHARED))?.authorOdinId).toBe(OWNER);
        // The second pass found it synced already and left it alone
        expect(c.notesProvider.getNote).toHaveBeenCalledTimes(1);
    });

    it('imports a note shared with the host by name', async () => {
        drives[OWNER] = [note(NAMED, { isCollaborative: true, recipients: [HOST] })];

        await run(ctx());

        expect(await getSearchIndexEntry(NAMED)).not.toBeNull();
    });

    it('ignores a public note and a note not shared with the host', async () => {
        drives[OWNER] = [
            note(PUBLIC, { isPublic: true }, false),
            note(NOT_FOR_ME, { isCollaborative: true, recipients: [OTHER] }),
        ];
        const c = ctx();

        await run(c);

        expect(await getSearchIndexEntry(PUBLIC)).toBeNull();
        expect(await getSearchIndexEntry(NOT_FOR_ME)).toBeNull();
        expect(c.notesProvider.getNote).not.toHaveBeenCalled();
    });

    it('omits the cursor on the first query, then stores and reuses the returned one', async () => {
        await run(ctx());
        expect(mocks.queryModifiedOverPeer.mock.calls[0][3].cursor).toBeUndefined();
        expect((await ownerState(OWNER))?.cursor).toBe(`cursor-${OWNER}`);

        await run(ctx());
        expect(mocks.queryModifiedOverPeer.mock.calls[1][3].cursor).toBe(`cursor-${OWNER}`);
    });

    it('backs off an owner that fails, and retries it once nextAttemptAt has passed', async () => {
        drives[OWNER] = new Error('404');
        await run(ctx());
        const failed = await ownerState(OWNER);
        expect(failed?.failures).toBe(1);
        expect(failed!.nextAttemptAt).toBeGreaterThan(Date.now() + 4 * 60_000);

        await run(ctx());
        expect(queriedOwners()).toEqual([OWNER]); // still backing off

        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(failed!.nextAttemptAt + 1);
            drives[OWNER] = [];
            await run(ctx());
        } finally {
            vi.useRealTimers();
        }
        expect(queriedOwners()).toEqual([OWNER, OWNER]);
        expect((await ownerState(OWNER))?.failures).toBe(0);
    });

    it('doubles the backoff on each failure', async () => {
        drives[OWNER] = new Error('offline');
        await run(ctx());
        await run(ctx(), true);
        const state = await ownerState(OWNER);
        expect(state?.failures).toBe(2);
        expect(state!.nextAttemptAt).toBeGreaterThan(Date.now() + 9 * 60_000);
    });

    it('queries a backing-off owner on a manual refresh', async () => {
        drives[OWNER] = new Error('404');
        await run(ctx());
        drives[OWNER] = [sharedNote()];

        await run(ctx(), true);

        expect(queriedOwners()).toEqual([OWNER, OWNER]);
        expect(await getSearchIndexEntry(SHARED)).not.toBeNull();
    });

    it('writes app_state at most once per pass, and not at all when nothing changed', async () => {
        drives[OTHER] = [];
        drives['pippin.dotyou.cloud'] = new Error('404');
        await run(ctx());
        expect(mocks.saveAppState).toHaveBeenCalledTimes(1);

        mocks.saveAppState.mockClear();
        drives['pippin.dotyou.cloud'] = [];
        await run(ctx());
        // pippin is still backing off; the others' cursors did not move, and the full pass ran today
        expect(mocks.saveAppState).not.toHaveBeenCalled();
    });

    it('makes no calls without ReadConnections', async () => {
        await pullShared(ctx(), client, { canReadConnections: false, manual: true });

        expect(mocks.getConnections).not.toHaveBeenCalled();
        expect(mocks.queryModifiedOverPeer).not.toHaveBeenCalled();
        expect(mocks.saveAppState).not.toHaveBeenCalled();
    });
});

describe('the full pass (revoke)', () => {
    it('removes a note its owner no longer returns', async () => {
        drives[OWNER] = [sharedNote()];
        await run(ctx());
        drives[OWNER] = [];

        await run(ctx(), true);

        expect(await getSearchIndexEntry(SHARED)).toBeNull();
        expect(await getSyncRecord(SHARED)).toBeNull();
        // A full pass starts over without a cursor
        expect(mocks.queryModifiedOverPeer.mock.calls[1][3].cursor).toBeUndefined();
    });

    it('keeps the note when its owner errored', async () => {
        drives[OWNER] = [sharedNote()];
        await run(ctx());
        drives[OWNER] = new Error('500');

        await run(ctx(), true);

        expect(await getSearchIndexEntry(SHARED)).not.toBeNull();
    });

    it('keeps notes from other owners', async () => {
        drives[OWNER] = [sharedNote()];
        await run(ctx());
        delete drives[OWNER];
        drives[OTHER] = [];

        await run(ctx(), true);

        expect(await getSearchIndexEntry(SHARED)).not.toBeNull();
    });
});

describe('pullOwnerNow', () => {
    it('queries only that owner, ignores its backoff, imports a new share and writes app_state once', async () => {
        drives[OTHER] = [];
        drives[OWNER] = new Error('404');
        await run(ctx());
        mocks.queryModifiedOverPeer.mockClear();
        mocks.saveAppState.mockClear();
        drives[OWNER] = [sharedNote()];

        await pullOwnerNow(ctx(), client, OWNER);

        expect(mocks.getConnections).toHaveBeenCalledTimes(1); // only the first pass's
        expect(queriedOwners()).toEqual([OWNER]);
        expect(await getSearchIndexEntry(SHARED)).not.toBeNull();
        expect(mocks.saveAppState).toHaveBeenCalledTimes(1);
        expect((await ownerState(OWNER))?.failures).toBe(0);
    });

    it('uses the stored cursor', async () => {
        await run(ctx());
        await pullOwnerNow(ctx(), client, OWNER);

        expect(mocks.queryModifiedOverPeer.mock.calls[1][3].cursor).toBe(`cursor-${OWNER}`);
    });

    it('rejects when the owner does not answer, and backs it off', async () => {
        drives[OWNER] = new Error('404');

        await expect(pullOwnerNow(ctx(), client, OWNER)).rejects.toThrow(OWNER);
        expect((await ownerState(OWNER))?.failures).toBe(1);
    });
});

describe('invite and pull', () => {
    const invite = {
        fileId: 'invite',
        fileMetadata: {
            senderOdinId: OWNER,
            appData: {
                content: { authorOdinId: OWNER, noteUniqueId: SHARED, noteTitle: 'T', notePreview: '', sharedAt: '2026-01-01T00:00:00.000Z' },
            },
        },
    } as unknown as HomebaseFile<string>;

    it('imports a note that arrives by pull and then by invite once', async () => {
        drives[OWNER] = [sharedNote()];
        const c = ctx();

        await run(c);
        await handleInvitation(c, invite);

        expect(c.notesProvider.getNote).toHaveBeenCalledTimes(1);
    });

    it('imports a note that arrives by invite and then by pull once', async () => {
        drives[OWNER] = [sharedNote()];
        const c = ctx();

        await handleInvitation(c, invite);
        await run(c);

        expect(c.notesProvider.getNote).toHaveBeenCalledTimes(1);
        expect(await getSearchIndexEntry(SHARED)).not.toBeNull();
    });
});
