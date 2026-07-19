import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    saveDocumentUpdate, getDocumentUpdates, upsertSyncRecord, getSyncRecord,
    getSearchIndexEntry, upsertSearchIndex,
} from '@/lib/db/queries';
import type { OnlineContextType } from '@/contexts/OnlineContext';
import * as Y from 'yjs';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';

const { mockGetNote, mockGetNotePayload, mockDsr } = vi.hoisted(() => ({
    mockGetNote: vi.fn(),
    mockGetNotePayload: vi.fn(),
    mockDsr: vi.fn(),
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        getNote = mockGetNote;
        getNotePayload = mockGetNotePayload;
        dsrToNoteFileContent = mockDsr;
        constructor() {}
    },
}));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class FolderDriveProvider { constructor() {} },
}));
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor { constructor() {} },
}));

import { documentBroadcast } from '@/lib/broadcast';
import { SyncService } from '@/lib/homebase/SyncService';

const HOST = 'sam.dotyou.cloud';
const FRODO = 'frodo.dotyou.cloud';
const DOC_ID = '11111111-1111-1111-1111-111111111111';

const fakeDotYouClient = { getHostIdentity: () => HOST } as unknown as DotYouClient;
const fakeOnline = { isOnline: true } as unknown as OnlineContextType;

/** A full-state Yjs update whose Y.Text 'body' holds `text`. */
function textUpdate(text: string): Uint8Array {
    const d = new Y.Doc();
    d.getText('body').insert(0, text);
    const u = Y.encodeStateAsUpdate(d);
    d.destroy();
    return u;
}
function bodyOf(blob: Uint8Array): string {
    const d = new Y.Doc();
    Y.applyUpdate(d, blob);
    const s = d.getText('body').toString();
    d.destroy();
    return s;
}

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    // @ts-expect-error test-only setter
    pgliteModule.setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

/** Build a decrypted remote note header (HomebaseFile shape) for handleRemoteNote. */
function makeRemoteFile(opts: { versionTag: string; sender?: string; groupId?: string }) {
    return {
        fileId: 'remote-file-1',
        sharedSecretEncryptedKeyHeader: { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' },
        fileMetadata: {
            versionTag: opts.versionTag,
            updated: 1700000001000,
            senderOdinId: opts.sender ?? FRODO,
            globalTransitId: 'gtid-1',
            appData: { uniqueId: DOC_ID, groupId: opts.groupId, userDate: 1700000000000 },
        },
    } as never;
}

describe('SyncService.handleRemoteNote', () => {
    let svc: SyncService;
    let broadcastSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        broadcastSpy = vi.spyOn(documentBroadcast, 'notifyDocumentUpdated').mockImplementation(() => {});
        svc = new SyncService(fakeDotYouClient, fakeOnline);
    });

    it('creates search_index, sync_records and the stored blob for a brand-new remote note', async () => {
        mockDsr.mockResolvedValue({ title: 'Remote Note', tags: ['t'] });
        mockGetNotePayload.mockResolvedValue(textUpdate('hello from remote'));

        await svc.handleRemoteNote(makeRemoteFile({ versionTag: 'v1' }));

        const idx = await getSearchIndexEntry(DOC_ID);
        expect(idx?.title).toBe('Remote Note');

        const record = await getSyncRecord(DOC_ID);
        expect(record?.versionTag).toBe('v1');
        expect(record?.syncStatus).toBe('synced');
        expect(record?.remoteFileId).toBe('remote-file-1');

        const updates = await getDocumentUpdates(DOC_ID);
        expect(updates.length).toBe(1);
        expect(bodyOf(updates[0])).toBe('hello from remote');
    });

    it('is a no-op when the remote versionTag equals the stored one', async () => {
        await upsertSyncRecord({
            localId: DOC_ID, entityType: 'note', remoteFileId: 'remote-file-1', versionTag: 'v1',
            lastSyncedAt: new Date().toISOString(), syncStatus: 'synced', authorOdinId: FRODO,
        });
        mockDsr.mockResolvedValue({ title: 'T', tags: [] });

        await svc.handleRemoteNote(makeRemoteFile({ versionTag: 'v1' }));

        // Same versionTag -> early return before any payload fetch or DB write.
        expect(mockGetNotePayload).not.toHaveBeenCalled();
        expect((await getDocumentUpdates(DOC_ID)).length).toBe(0);
        expect(await getSearchIndexEntry(DOC_ID)).toBeNull();
        expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('CRDT-merges local and remote edits without loss when the versionTag is new', async () => {
        await saveDocumentUpdate(DOC_ID, textUpdate('AAA'));
        await upsertSearchIndex({
            docId: DOC_ID, title: 'T', plainTextContent: 'AAA',
            metadata: { title: 'T', folderId: 'main', excludeFromAI: false, timestamps: { created: '2020-01-01T00:00:00.000Z', modified: '2020-01-01T00:00:00.000Z' } },
        });
        await upsertSyncRecord({
            localId: DOC_ID, entityType: 'note', remoteFileId: 'remote-file-1', versionTag: 'v1',
            lastSyncedAt: new Date().toISOString(), syncStatus: 'synced', authorOdinId: FRODO,
        });
        mockDsr.mockResolvedValue({ title: 'T', tags: [] });
        mockGetNotePayload.mockResolvedValue(textUpdate('BBB'));

        await svc.handleRemoteNote(makeRemoteFile({ versionTag: 'v2' }));

        const updates = await getDocumentUpdates(DOC_ID);
        expect(updates.length).toBe(1); // old updates cleared, merged blob saved
        const merged = bodyOf(updates[0]);
        expect(merged).toContain('AAA');
        expect(merged).toContain('BBB');

        const record = await getSyncRecord(DOC_ID);
        expect(record?.versionTag).toBe('v2');
        expect(broadcastSpy).toHaveBeenCalledWith(DOC_ID);
    });
});

describe('SyncService.handleDeletedNote', () => {
    let svc: SyncService;
    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        vi.spyOn(documentBroadcast, 'notifyDocumentUpdated').mockImplementation(() => {});
        svc = new SyncService(fakeDotYouClient, fakeOnline);
    });

    it('removes the local search_index, document_updates and sync_record', async () => {
        await saveDocumentUpdate(DOC_ID, textUpdate('doomed'));
        await upsertSearchIndex({
            docId: DOC_ID, title: 'Doomed', plainTextContent: 'doomed',
            metadata: { title: 'Doomed', folderId: 'main', excludeFromAI: false, timestamps: { created: '2020-01-01T00:00:00.000Z', modified: '2020-01-01T00:00:00.000Z' } },
        });
        await upsertSyncRecord({
            localId: DOC_ID, entityType: 'note', remoteFileId: 'remote-file-1', versionTag: 'v1',
            lastSyncedAt: new Date().toISOString(), syncStatus: 'synced',
        });

        await svc.handleDeletedNote({ fileMetadata: { appData: { uniqueId: DOC_ID } } } as never);

        expect(await getSearchIndexEntry(DOC_ID)).toBeNull();
        expect((await getDocumentUpdates(DOC_ID)).length).toBe(0);
        expect(await getSyncRecord(DOC_ID)).toBeNull();
    });
});

describe('SyncService.mergeYjsDocuments', () => {
    let svc: SyncService;
    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        svc = new SyncService(fakeDotYouClient, fakeOnline);
    });

    it('merges two divergent docs into a superset and is idempotent', async () => {
        await saveDocumentUpdate(DOC_ID, textUpdate('LOCAL'));
        const remote = textUpdate('REMOTE');

        const merged = await svc.mergeYjsDocuments(DOC_ID, remote);
        expect(bodyOf(merged)).toContain('LOCAL');
        expect(bodyOf(merged)).toContain('REMOTE');

        // Persist the merged state as the new local truth, then merge the same remote again.
        await db.query('DELETE FROM document_updates WHERE doc_id = $1', [DOC_ID]);
        await saveDocumentUpdate(DOC_ID, merged);
        const mergedAgain = await svc.mergeYjsDocuments(DOC_ID, remote);

        // Idempotent: re-merging an already-integrated remote yields byte-identical state.
        expect(Buffer.from(mergedAgain).equals(Buffer.from(merged))).toBe(true);
    });
});
