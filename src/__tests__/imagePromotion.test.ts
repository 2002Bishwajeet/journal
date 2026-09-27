import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    saveDocumentUpdate, getDocumentUpdates, upsertSyncRecord, savePendingImageUpload,
    getImageUploadsReadyForRetry, getPendingSyncCount, getSyncRecord, updateSyncStatus,
} from '@/lib/db/queries';
import type { OnlineContextType } from '@/contexts/OnlineContext';
import * as Y from 'yjs';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';

const { mockAddImageToNote } = vi.hoisted(() => ({ mockAddImageToNote: vi.fn() }));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        addImageToNote = mockAddImageToNote;
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

const DOC_ID = '11111111-1111-1111-1111-111111111111';
const UPLOAD_ID = '22222222-2222-2222-2222-222222222222';
const FILE_ID = 'remote-file-1';

const fakeDotYouClient = { getHostIdentity: () => 'sam.dotyou.cloud' } as unknown as DotYouClient;
const fakeOnline = { isOnline: true } as unknown as OnlineContextType;

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    // @ts-expect-error test-only setter
    pgliteModule.setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

/** A doc with a paragraph; the pending image node is added separately. */
function makeDoc(): Y.Doc {
    const ydoc = new Y.Doc();
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('hello')]);
    ydoc.getXmlFragment('prosemirror').insert(0, [p]);
    return ydoc;
}

/** Append the pending image node to the doc; returns the delta for that insert. */
function insertPendingImage(ydoc: Y.Doc): Uint8Array {
    const before = Y.encodeStateVector(ydoc);
    const img = new Y.XmlElement('image');
    img.setAttribute('src', 'blob:x');
    img.setAttribute('data-pending-id', UPLOAD_ID);
    const fragment = ydoc.getXmlFragment('prosemirror');
    fragment.insert(fragment.length, [img]);
    return Y.encodeStateAsUpdate(ydoc, before);
}

async function storedImageAttrs(): Promise<Record<string, unknown> | undefined> {
    const d = new Y.Doc();
    for (const u of await getDocumentUpdates(DOC_ID)) Y.applyUpdate(d, u);
    const img = d.getXmlFragment('prosemirror').toArray()
        .find((n): n is Y.XmlElement => n instanceof Y.XmlElement && n.nodeName === 'image');
    const attrs = img?.getAttributes();
    d.destroy();
    return attrs;
}

async function getUploadRow(): Promise<{ status: string; payload_key: string | null; retry_count: number } | undefined> {
    const r = await db.query<{ status: string; payload_key: string | null; retry_count: number }>(
        'SELECT status, payload_key, retry_count FROM pending_image_uploads WHERE id = $1', [UPLOAD_ID]);
    return r.rows[0];
}

async function queueUpload(retryCount = 0): Promise<void> {
    await savePendingImageUpload({
        id: UPLOAD_ID, noteDocId: DOC_ID, blobData: new Uint8Array([1, 2, 3]), contentType: 'image/png',
        status: 'pending', retryCount, createdAt: new Date().toISOString(),
    });
}

describe('SyncService.processPendingImageUploads promotion', () => {
    let svc: SyncService;

    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        vi.spyOn(documentBroadcast, 'notifyDocumentUpdated').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mockAddImageToNote.mockResolvedValue({ payloadKey: 'jrnl_img0', versionTag: 'v2' });
        await upsertSyncRecord({
            localId: DOC_ID, entityType: 'note', remoteFileId: FILE_ID, versionTag: 'v1',
            lastSyncedAt: new Date().toISOString(), syncStatus: 'synced',
        });
        svc = new SyncService(fakeDotYouClient, fakeOnline);
    });

    it('promotes a present node, deletes the row and appends (not replaces) document updates', async () => {
        const ydoc = makeDoc();
        await saveDocumentUpdate(DOC_ID, Y.encodeStateAsUpdate(ydoc));
        await saveDocumentUpdate(DOC_ID, insertPendingImage(ydoc));
        const before = await getDocumentUpdates(DOC_ID);
        await queueUpload();

        await svc.processPendingImageUploads();

        const attrs = await storedImageAttrs();
        expect(attrs?.src).toBe(`attachment://${FILE_ID}/jrnl_img0`);
        expect(attrs?.['data-pending-id']).toBeUndefined();
        expect(await getUploadRow()).toBeUndefined();

        const after = await getDocumentUpdates(DOC_ID);
        expect(after.length).toBe(before.length + 1);
        before.forEach((u, i) => expect(after[i]).toEqual(u));
    });

    it('marks the note pending after promotion so the new src reaches the server', async () => {
        const ydoc = makeDoc();
        await saveDocumentUpdate(DOC_ID, Y.encodeStateAsUpdate(ydoc));
        await saveDocumentUpdate(DOC_ID, insertPendingImage(ydoc));
        await queueUpload();

        await svc.processPendingImageUploads();

        expect((await getSyncRecord(DOC_ID))?.syncStatus).toBe('pending');
    });

    it('keeps an edit made during the upload pending', async () => {
        await saveDocumentUpdate(DOC_ID, Y.encodeStateAsUpdate(makeDoc()));
        await queueUpload();
        mockAddImageToNote.mockImplementationOnce(async () => {
            await updateSyncStatus(DOC_ID, 'pending'); // the user types while the bytes upload
            return { payloadKey: 'jrnl_img0', versionTag: 'v2' };
        });

        await svc.processPendingImageUploads();

        expect((await getSyncRecord(DOC_ID))?.syncStatus).toBe('pending');
    });

    it('keeps the row with the payload key when the node is absent', async () => {
        await saveDocumentUpdate(DOC_ID, Y.encodeStateAsUpdate(makeDoc()));
        await queueUpload();

        await svc.processPendingImageUploads();

        expect(await getUploadRow()).toEqual({ status: 'failed', payload_key: 'jrnl_img0', retry_count: 1 });
    });

    it('retries promotion without re-uploading once the node appears', async () => {
        const ydoc = makeDoc();
        await saveDocumentUpdate(DOC_ID, Y.encodeStateAsUpdate(ydoc));
        await queueUpload();
        await svc.processPendingImageUploads();
        expect(mockAddImageToNote).toHaveBeenCalledTimes(1);

        await db.query(`UPDATE pending_image_uploads SET next_retry_at = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE id = $1`, [UPLOAD_ID]);
        await saveDocumentUpdate(DOC_ID, insertPendingImage(ydoc));

        await svc.processPendingImageUploads();

        expect(mockAddImageToNote).toHaveBeenCalledTimes(1);
        expect((await storedImageAttrs())?.src).toBe(`attachment://${FILE_ID}/jrnl_img0`);
        expect(await getUploadRow()).toBeUndefined();
    });

    it('gives up as failed_permanent after the 5th failed promotion, keeping the bytes', async () => {
        await saveDocumentUpdate(DOC_ID, Y.encodeStateAsUpdate(makeDoc()));
        await queueUpload(4);

        await svc.processPendingImageUploads();

        expect((await getUploadRow())?.status).toBe('failed_permanent');
        expect(await getImageUploadsReadyForRetry()).toEqual([]);
        expect((await getPendingSyncCount()).images).toBe(0);
    });
});
