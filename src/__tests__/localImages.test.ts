// @vitest-environment happy-dom
/**
 * #179: an uploaded image keeps its local upload row (status 'synced') so it
 * still renders offline. The queue must ignore such rows, and removing the
 * image from the note drops its bytes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';
import {
    savePendingImageUpload, updateImageUploadStatus, upsertSyncRecord, getImageUploadsReadyForRetry,
    getPendingImageUploads, getPendingSyncCount, getLocalImageBytes, deleteLocalImagesByKeys,
} from '@/lib/db/queries';
import { useLocalImage } from '@/hooks/image/useLocalImage';

const DOC_ID = '11111111-1111-1111-1111-111111111111';
const UPLOAD_ID = '22222222-2222-2222-2222-222222222222';
const FILE_ID = 'remote-file-1';
const KEY = 'jrnl_img0';

beforeAll(async () => {
    const db = await createTestDatabase();
    // @ts-expect-error test-only setter
    pgliteModule.setTestDb(db);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => { await closeTestDatabase(); });

async function seedSyncedImage(): Promise<void> {
    await upsertSyncRecord({
        localId: DOC_ID, entityType: 'note', remoteFileId: FILE_ID, versionTag: 'v1',
        lastSyncedAt: new Date().toISOString(), syncStatus: 'synced',
    });
    await savePendingImageUpload({
        id: UPLOAD_ID, noteDocId: DOC_ID, blobData: new Uint8Array([1, 2, 3]), contentType: 'image/png',
        status: 'pending', retryCount: 0, createdAt: new Date().toISOString(),
    });
    await updateImageUploadStatus(UPLOAD_ID, 'synced', KEY);
}

describe('local image queries', () => {
    beforeEach(async () => { await resetTestDatabase(); });

    it('returns the bytes of a synced row by remote file id and payload key', async () => {
        await seedSyncedImage();
        expect(await getLocalImageBytes(FILE_ID, KEY)).toEqual({
            blobData: new Uint8Array([1, 2, 3]), contentType: 'image/png',
        });
        expect(await getLocalImageBytes(FILE_ID, 'other_key')).toBeNull();
        expect(await getLocalImageBytes('other-file', KEY)).toBeNull();
    });

    it('does not serve a row that is still uploading', async () => {
        await seedSyncedImage();
        await updateImageUploadStatus(UPLOAD_ID, 'uploading');
        expect(await getLocalImageBytes(FILE_ID, KEY)).toBeNull();
    });

    it('keeps synced rows out of the upload queue and the pending count', async () => {
        await seedSyncedImage();
        expect(await getImageUploadsReadyForRetry()).toEqual([]);
        expect(await getPendingImageUploads()).toEqual([]);
        expect((await getPendingSyncCount()).images).toBe(0);
    });

    it('deleteLocalImagesByKeys removes only the given keys of that note', async () => {
        await seedSyncedImage();
        await deleteLocalImagesByKeys(DOC_ID, ['unrelated']);
        expect(await getLocalImageBytes(FILE_ID, KEY)).not.toBeNull();

        await deleteLocalImagesByKeys(DOC_ID, [KEY]);
        expect(await getLocalImageBytes(FILE_ID, KEY)).toBeNull();
    });
});

describe('useLocalImage', () => {
    beforeEach(async () => { await resetTestDatabase(); });

    async function render(fileId: string, key: string): Promise<{ url: () => string | null; unmount: () => void }> {
        let url: string | null = null;
        const Probe = () => { url = useLocalImage(fileId, key); return null; };
        const root = createRoot(document.createElement('div'));
        await act(async () => { root.render(h(Probe)); });
        // let the DB read resolve
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        return { url: () => url, unmount: () => act(() => root.unmount()) };
    }

    it('returns an object URL for a locally kept image and revokes it on unmount', async () => {
        await seedSyncedImage();
        const revoke = vi.spyOn(URL, 'revokeObjectURL');
        const r = await render(FILE_ID, KEY);
        expect(r.url()).toMatch(/^blob:/);
        const url = r.url();
        r.unmount();
        expect(revoke).toHaveBeenCalledWith(url);
    });

    it('returns null when the image is not kept on this device', async () => {
        const r = await render(FILE_ID, KEY);
        expect(r.url()).toBeNull();
        r.unmount();
    });
});
