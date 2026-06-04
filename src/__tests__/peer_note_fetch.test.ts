import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { saveDocumentUpdate, getDocumentUpdates, getSyncRecord, upsertSyncRecord } from '@/lib/db/queries';
import type { OnlineContextType } from '@/contexts/OnlineContext';
import * as Y from 'yjs';

function yjsUpdateWithContent(text = 'hello'): Uint8Array {
    const d = new Y.Doc();
    d.getArray('content').insert(0, [text]);
    const u = Y.encodeStateAsUpdate(d);
    d.destroy();
    return u;
}
function emptyYjsUpdate(): Uint8Array {
    const d = new Y.Doc();
    const u = Y.encodeStateAsUpdate(d); // 2 bytes — [0,0]
    d.destroy();
    return u;
}

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

// File-level DB lifecycle shared by all describe blocks
let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    // @ts-expect-error test-only setter
    pgliteModule.setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

function makePeerHeader() {
    return {
        fileId: 'remote-file-1',
        sharedSecretEncryptedKeyHeader: { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' },
        fileMetadata: { updated: 1700000000000, versionTag: 'v1', globalTransitId: 'gtid-1', appData: {} },
    };
}

describe('SyncService.ensurePeerNoteContent', () => {
    let svc: SyncService;
    let broadcastSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        broadcastSpy = vi.spyOn(documentBroadcast, 'notifyDocumentUpdated').mockImplementation(() => {});
        svc = new SyncService(fakeDotYouClient, fakeOnline);
    });

    it('returns local without fetching when content already exists', async () => {
        await saveDocumentUpdate(DOC_ID, yjsUpdateWithContent());
        const result = await svc.ensurePeerNoteContent(DOC_ID, FRODO);
        expect(result.status).toBe('local');
        expect(mockGetNote).not.toHaveBeenCalled();
        expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('re-fetches when the only local content is an empty doc', async () => {
        await saveDocumentUpdate(DOC_ID, emptyYjsUpdate());
        mockGetNote.mockResolvedValue(makePeerHeader());
        mockGetNotePayload.mockResolvedValue(yjsUpdateWithContent());
        const result = await svc.ensurePeerNoteContent(DOC_ID, FRODO);
        expect(result.status).toBe('fetched');
        expect(mockGetNote).toHaveBeenCalled();
    });

    it('returns local without fetching when authorOdinId is the host', async () => {
        const result = await svc.ensurePeerNoteContent(DOC_ID, HOST);
        expect(result.status).toBe('local');
        expect(mockGetNote).not.toHaveBeenCalled();
    });

    it('fetches, stores and broadcasts when local is empty', async () => {
        mockGetNote.mockResolvedValue(makePeerHeader());
        mockGetNotePayload.mockResolvedValue(new Uint8Array([9, 9, 9]));
        const result = await svc.ensurePeerNoteContent(DOC_ID, FRODO);
        expect(result.status).toBe('fetched');
        expect(mockGetNote).toHaveBeenCalledWith(DOC_ID, FRODO, { decrypt: true });
        const updates = await getDocumentUpdates(DOC_ID);
        expect(updates.length).toBe(1);
        const record = await getSyncRecord(DOC_ID);
        expect(record?.authorOdinId).toBe(FRODO);
        expect(record?.globalTransitId).toBe('gtid-1');
        expect(broadcastSpy).toHaveBeenCalledWith(DOC_ID);
    });

    it('returns forbidden on a 403 header error', async () => {
        mockGetNote.mockRejectedValue({ response: { status: 403 } });
        const result = await svc.ensurePeerNoteContent(DOC_ID, FRODO);
        expect(result.status).toBe('forbidden');
        expect((await getDocumentUpdates(DOC_ID)).length).toBe(0);
        expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('returns notfound when the header fetch resolves to null', async () => {
        mockGetNote.mockResolvedValue(null);
        const result = await svc.ensurePeerNoteContent(DOC_ID, FRODO);
        expect(result.status).toBe('notfound');
        expect(mockGetNotePayload).not.toHaveBeenCalled();
    });

    it('returns offline on a network error (no response)', async () => {
        mockGetNote.mockRejectedValue(new Error('Network Error'));
        const result = await svc.ensurePeerNoteContent(DOC_ID, FRODO);
        expect(result.status).toBe('offline');
    });

    it('returns empty when header is OK but payload is null', async () => {
        mockGetNote.mockResolvedValue(makePeerHeader());
        mockGetNotePayload.mockResolvedValue(null);
        const result = await svc.ensurePeerNoteContent(DOC_ID, FRODO);
        expect(result.status).toBe('empty');
        expect((await getDocumentUpdates(DOC_ID)).length).toBe(0);
    });
});

describe('SyncService.revalidatePeerNote', () => {
    let svc: SyncService;
    const V_OLD = 'a0000000-0000-0000-0000-000000000001';
    const V_NEW = 'a0000000-0000-0000-0000-000000000002';

    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        vi.spyOn(documentBroadcast, 'notifyDocumentUpdated').mockImplementation(() => {});
        svc = new SyncService(fakeDotYouClient, fakeOnline);
    });

    it('returns unchanged and does not fetch the payload when versionTag matches', async () => {
        await upsertSyncRecord({
            localId: DOC_ID, entityType: 'note', remoteFileId: 'rf', versionTag: V_OLD,
            lastSyncedAt: new Date().toISOString(), syncStatus: 'synced', authorOdinId: FRODO,
        });
        mockGetNote.mockResolvedValue({
            fileId: 'rf',
            sharedSecretEncryptedKeyHeader: { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' },
            fileMetadata: { versionTag: V_OLD, updated: 1, globalTransitId: 'g' },
        });
        const r = await svc.revalidatePeerNote(DOC_ID, FRODO);
        expect(r).toBe('unchanged');
        expect(mockGetNotePayload).not.toHaveBeenCalled();
    });

    it('merges and broadcasts when the author note is newer', async () => {
        await saveDocumentUpdate(DOC_ID, yjsUpdateWithContent('local'));
        await upsertSyncRecord({
            localId: DOC_ID, entityType: 'note', remoteFileId: 'rf', versionTag: V_OLD,
            lastSyncedAt: new Date().toISOString(), syncStatus: 'synced', authorOdinId: FRODO,
        });
        mockGetNote.mockResolvedValue({
            fileId: 'rf',
            sharedSecretEncryptedKeyHeader: { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' },
            fileMetadata: { versionTag: V_NEW, updated: 2, globalTransitId: 'g' },
        });
        mockGetNotePayload.mockResolvedValue(yjsUpdateWithContent('remote'));
        const broadcastSpy = vi.spyOn(documentBroadcast, 'notifyDocumentUpdated');

        const r = await svc.revalidatePeerNote(DOC_ID, FRODO);

        expect(r).toBe('updated');
        expect(mockGetNotePayload).toHaveBeenCalledWith('rf', FRODO, 2);
        const record = await getSyncRecord(DOC_ID);
        expect(record?.versionTag).toBe(V_NEW);
        expect(broadcastSpy).toHaveBeenCalledWith(DOC_ID);
    });

    it('returns skipped when the header fetch fails', async () => {
        mockGetNote.mockRejectedValue(new Error('offline'));
        const r = await svc.revalidatePeerNote(DOC_ID, FRODO);
        expect(r).toBe('skipped');
        expect(mockGetNotePayload).not.toHaveBeenCalled();
    });
});

describe('SyncService.handleRemoteNote author identity', () => {
    let svc: SyncService;

    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        vi.spyOn(documentBroadcast, 'notifyDocumentUpdated').mockImplementation(() => {});
        svc = new SyncService(fakeDotYouClient, fakeOnline);
    });

    it('uses the stored sync record authorOdinId over senderOdinId', async () => {
        await upsertSyncRecord({
            localId: DOC_ID,
            entityType: 'note',
            remoteFileId: 'remote-file-1',
            versionTag: 'v0',
            lastSyncedAt: new Date().toISOString(),
            syncStatus: 'synced',
            authorOdinId: FRODO,
        });
        mockDsr.mockResolvedValue({ title: 'T', tags: [] });
        mockGetNotePayload.mockResolvedValue(null);

        const remoteFile = {
            fileId: 'remote-file-1',
            sharedSecretEncryptedKeyHeader: { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' },
            fileMetadata: {
                versionTag: 'v1',
                updated: 1700000001000,
                senderOdinId: 'someone-else.dotyou.cloud',
                globalTransitId: 'gtid-2',
                appData: { uniqueId: DOC_ID, groupId: undefined },
            },
        } as never;

        await svc.handleRemoteNote(remoteFile);

        expect(mockGetNotePayload).toHaveBeenCalledWith('remote-file-1', FRODO, 1700000001000);
    });
});
