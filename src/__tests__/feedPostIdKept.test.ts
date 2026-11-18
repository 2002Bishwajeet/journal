/**
 * #1414: Update on feed published a second post. saveFeedPost updates the post only when the
 * note still has its `feedPostId`; without it, it publishes anew. Every writer of the note's
 * metadata wrote a whole snapshot, so a snapshot without the id dropped it:
 *  - a title edit (or any metadata-only write) built from metadata read before Publish saved the id;
 *  - a pull of a server copy without the id over a local one with it (saved, not pushed yet);
 *  - a push version conflict, which uploads this device's copy over the server's, from a
 *    device whose copy predates the publish.
 * Nothing clears `feedPostId` on purpose, so a write without it now keeps the one there.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { EncryptedKeyHeader } from '@homebase-id/js-lib/core';
import * as Y from 'yjs';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    getSearchIndexEntry, getSyncRecord, saveDocumentUpdate, updateSearchIndexMetadata, upsertSearchIndex, upsertSyncRecord,
} from '@/lib/db/queries';
import { serializeKeyHeader } from '@/lib/utils';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';
import type { DocumentMetadata, SyncRecord } from '@/types';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockDsr, mockGetNote, mockGetNotePayload, mockUpdateNote } = vi.hoisted(() => ({
    mockDsr: vi.fn(),
    mockGetNote: vi.fn(),
    mockGetNotePayload: vi.fn(),
    mockUpdateNote: vi.fn(),
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        dsrToContent = mockDsr;
        getNote = mockGetNote;
        getNotePayload = mockGetNotePayload;
        updateNote = mockUpdateNote;
        constructor() {}
    },
}));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class FolderDriveProvider { constructor() {} },
}));
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor { constructor() {} },
}));

import { SyncService } from '@/lib/homebase/SyncService';
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';

const NOTE_ID = '14141414-1414-1414-1414-141414141414';
const POST_ID = 'feed-post-1';
const KEY_HEADER = { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' } as unknown as EncryptedKeyHeader;
const fakeClient = fakeDotYouClient('sam.dotyou.cloud');
const fakeOnline = fakeOnlineContext();

const BEFORE_PUBLISH: DocumentMetadata = {
    title: 'Trip report',
    folderId: MAIN_FOLDER_ID,
    tags: [],
    timestamps: { created: '2026-11-18T00:00:00.000Z', modified: '2026-11-18T00:00:00.000Z' },
    excludeFromAI: false,
};
const PUBLISHED: DocumentMetadata = { ...BEFORE_PUBLISH, feedPostId: POST_ID };

function textUpdate(text: string): Uint8Array {
    const d = new Y.Doc();
    d.getText('body').insert(0, text);
    const u = Y.encodeStateAsUpdate(d);
    d.destroy();
    return u;
}

function header(versionTag: string) {
    return {
        fileId: 'note-file-1',
        sharedSecretEncryptedKeyHeader: KEY_HEADER,
        fileMetadata: { versionTag, updated: 1763424000000, appData: { uniqueId: NOTE_ID, groupId: MAIN_FOLDER_ID } },
    } as never;
}

async function seed(metadata: DocumentMetadata, syncStatus: SyncRecord['syncStatus']) {
    await saveDocumentUpdate(NOTE_ID, textUpdate('Body'));
    await upsertSearchIndex({ docId: NOTE_ID, title: metadata.title, plainTextContent: 'Body', metadata });
    await upsertSyncRecord({
        localId: NOTE_ID, entityType: 'note', syncStatus, remoteFileId: 'note-file-1',
        versionTag: 'v1', contentHash: 'stale', encryptedKeyHeader: serializeKeyHeader(KEY_HEADER),
    } as SyncRecord);
}

const uploaded = (call: number) => mockUpdateNote.mock.calls[call][3] as DocumentMetadata;

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

beforeEach(async () => {
    await resetTestDatabase();
    vi.clearAllMocks();
    mockGetNotePayload.mockResolvedValue(null);
});

describe('a metadata-only write keeps feedPostId (#1414)', () => {
    // The editor's title write is built from the metadata it rendered with. Read before
    // Publish saved the id, it wrote the note back without it, and the next Update on feed
    // published a second post.
    it('keeps the id when a title edit from a snapshot taken before Publish lands after it', async () => {
        await upsertSearchIndex({ docId: NOTE_ID, title: 'Trip report', plainTextContent: '', metadata: BEFORE_PUBLISH });
        const snapshot = (await getSearchIndexEntry(NOTE_ID))!.metadata;

        await updateSearchIndexMetadata(NOTE_ID, 'Trip report', PUBLISHED);
        await updateSearchIndexMetadata(NOTE_ID, 'Trip report, day 2', { ...snapshot, title: 'Trip report, day 2' });

        const entry = await getSearchIndexEntry(NOTE_ID);
        expect(entry?.title).toBe('Trip report, day 2');
        expect(entry?.metadata.feedPostId).toBe(POST_ID);
    });

    it('lets a new id through: a republish of a post deleted on the feed', async () => {
        await upsertSearchIndex({ docId: NOTE_ID, title: 'Trip report', plainTextContent: '', metadata: PUBLISHED });

        await updateSearchIndexMetadata(NOTE_ID, 'Trip report', { ...PUBLISHED, feedPostId: 'feed-post-2' });

        expect((await getSearchIndexEntry(NOTE_ID))?.metadata.feedPostId).toBe('feed-post-2');
    });

    it('does not invent an id for a note never published', async () => {
        await upsertSearchIndex({ docId: NOTE_ID, title: 'Trip report', plainTextContent: '', metadata: BEFORE_PUBLISH });

        await updateSearchIndexMetadata(NOTE_ID, 'Renamed', { ...BEFORE_PUBLISH, title: 'Renamed' });

        expect((await getSearchIndexEntry(NOTE_ID))?.metadata).not.toHaveProperty('feedPostId');
    });
});

describe('a pull keeps feedPostId (#1414)', () => {
    // Pending: published here, the id not pushed yet (offline, or the app closed), and an edit
    // from another device comes in. Synced: a server copy that lost the id to an older push.
    it.each(['pending', 'synced'] as const)('keeps the local id over a server copy without one, and pushes it back (%s)', async (status) => {
        await seed(PUBLISHED, status);
        mockGetNotePayload.mockResolvedValue(textUpdate('Body'));
        mockDsr.mockResolvedValue({ title: 'Trip report, day 2', tags: [], excludeFromAI: false });

        const svc = new SyncService(fakeClient, fakeOnline);
        await svc.handleRemoteNote(header('v2'));

        const entry = await getSearchIndexEntry(NOTE_ID);
        expect(entry?.title).toBe('Trip report, day 2');
        expect(entry?.metadata.feedPostId).toBe(POST_ID);

        // The server lacks it: the next push uploads it
        const record = (await getSyncRecord(NOTE_ID))!;
        expect(record.syncStatus).toBe('pending');
        mockUpdateNote.mockResolvedValue({ versionTag: 'v3' });
        await svc.pushNote(record);
        expect(mockUpdateNote).toHaveBeenCalledTimes(1);
        expect(uploaded(0).feedPostId).toBe(POST_ID);
    });

    it('takes the server id when it has one', async () => {
        await seed(PUBLISHED, 'synced');
        mockDsr.mockResolvedValue({ title: 'Trip report', tags: [], excludeFromAI: false, feedPostId: 'feed-post-2' });

        await new SyncService(fakeClient, fakeOnline).handleRemoteNote(header('v2'));

        expect((await getSearchIndexEntry(NOTE_ID))?.metadata.feedPostId).toBe('feed-post-2');
        expect((await getSyncRecord(NOTE_ID))?.syncStatus).toBe('synced');
    });
});

describe('a push version conflict keeps the server feedPostId (#1414)', () => {
    // Another device published the note; this one, whose copy predates that, edits the title.
    // Its push conflicts and the retry uploaded this device's metadata, without the id.
    beforeEach(async () => {
        await seed({ ...BEFORE_PUBLISH, title: 'Trip report, day 2' }, 'pending');
        mockGetNote.mockResolvedValue(header('v-remote'));
        mockGetNotePayload.mockResolvedValue(textUpdate('Remote'));
        mockDsr.mockResolvedValue({ title: 'Trip report', tags: [], excludeFromAI: false, feedPostId: POST_ID });
        mockUpdateNote.mockImplementation(async (...args: unknown[]) => {
            const options = args[8] as { onVersionConflict?: () => Promise<unknown> } | undefined;
            if (options?.onVersionConflict) return await options.onVersionConflict();
            return { versionTag: 'v-merged' };
        });
    });

    it('uploads the server id with this device edit', async () => {
        await new SyncService(fakeClient, fakeOnline).pushNote((await getSyncRecord(NOTE_ID))!);

        expect(mockUpdateNote).toHaveBeenCalledTimes(2);
        expect(uploaded(1).title).toBe('Trip report, day 2');
        expect(uploaded(1).feedPostId).toBe(POST_ID);
    });

    it('keeps it here too, so the next push does not drop it again', async () => {
        const svc = new SyncService(fakeClient, fakeOnline);
        await svc.pushNote((await getSyncRecord(NOTE_ID))!);

        expect((await getSearchIndexEntry(NOTE_ID))?.metadata.feedPostId).toBe(POST_ID);
        mockUpdateNote.mockClear();
        await svc.pushNote((await getSyncRecord(NOTE_ID))!);
        expect(mockUpdateNote).not.toHaveBeenCalled();
    });

    it('keeps this device id when it has one', async () => {
        await updateSearchIndexMetadata(NOTE_ID, 'Trip report, day 2', { ...BEFORE_PUBLISH, title: 'Trip report, day 2', feedPostId: 'feed-post-2' });

        await new SyncService(fakeClient, fakeOnline).pushNote((await getSyncRecord(NOTE_ID))!);

        expect(uploaded(1).feedPostId).toBe('feed-post-2');
    });
});
