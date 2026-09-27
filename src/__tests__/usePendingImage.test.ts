// @vitest-environment happy-dom
/**
 * #177: a pending image's node src is a blob: URL that dies with the tab. The
 * displayed image must come from the bytes queued in pending_image_uploads, and
 * the node must say whether it is waiting, uploading or failed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';
import {
    savePendingImageUpload, updateImageUploadStatus, updateImageRetryAt, getPendingImageUpload,
    getPendingImageUploadStatus, incrementImageRetryCount, deletePendingImageUpload,
    retryPendingImageUploadNow, getImageUploadsReadyForRetry,
} from '@/lib/db/queries';
import { OnlineContext } from '@/contexts/OnlineContext';
import { usePendingImage } from '@/hooks/usePendingImage';

const ID = '22222222-2222-2222-2222-222222222222';
const DOC_ID = '11111111-1111-1111-1111-111111111111';

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    // @ts-expect-error test-only setter
    pgliteModule.setTestDb(db);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => { await closeTestDatabase(); });

async function queue(): Promise<void> {
    await savePendingImageUpload({
        id: ID, noteDocId: DOC_ID, blobData: new Uint8Array([1, 2, 3]), contentType: 'image/png',
        status: 'pending', retryCount: 0, createdAt: new Date().toISOString(),
    });
}

describe('pending image queries', () => {
    beforeEach(async () => { await resetTestDatabase(); });

    it('reads one row, or null when there is none', async () => {
        expect(await getPendingImageUpload(ID)).toBeNull();
        await queue();
        expect(await getPendingImageUpload(ID)).toEqual({
            blobData: new Uint8Array([1, 2, 3]), contentType: 'image/png', status: 'pending',
        });
        expect(await getPendingImageUploadStatus(ID)).toBe('pending');
    });

    it('retry-now makes a failed row due immediately', async () => {
        await queue();
        await updateImageUploadStatus(ID, 'failed_permanent');
        await updateImageRetryAt(ID, new Date(Date.now() + 60_000));
        expect(await getImageUploadsReadyForRetry()).toEqual([]);

        await retryPendingImageUploadNow(ID);

        expect((await getImageUploadsReadyForRetry()).map(u => u.id)).toEqual([ID]);
        expect((await getPendingImageUpload(ID))?.status).toBe('pending');
    });

    it('retry-now gives a fresh attempt budget', async () => {
        await queue();
        await incrementImageRetryCount(ID);
        await retryPendingImageUploadNow(ID);

        expect((await getImageUploadsReadyForRetry())[0].retryCount).toBe(0);
    });
});

describe('usePendingImage', () => {
    let root: Root;
    let result: ReturnType<typeof usePendingImage> | undefined;
    function Probe() { result = usePendingImage(ID); return null; }

    beforeEach(async () => {
        await resetTestDatabase();
        result = undefined;
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:restored');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    async function mount(isOnline = true) {
        await act(async () => {
            root.render(h(OnlineContext.Provider, { value: { isOnline } }, h(Probe)));
        });
    }

    it('shows the queued bytes as uploading when online', async () => {
        await queue();
        await mount();
        await vi.waitFor(() => expect(result).toEqual({ url: 'blob:restored', state: 'uploading' }));
        await act(async () => root.unmount());
    });

    it('is offline when the row exists but there is no connection', async () => {
        await queue();
        await mount(false);
        await vi.waitFor(() => expect(result).toEqual({ url: 'blob:restored', state: 'offline' }));
        await act(async () => root.unmount());
    });

    it('is failed for a failed row', async () => {
        await queue();
        await updateImageUploadStatus(ID, 'failed');
        await mount();
        await vi.waitFor(() => expect(result?.state).toBe('failed'));
        await act(async () => root.unmount());
    });

    it('is remote when this device has no row', async () => {
        await mount();
        await vi.waitFor(() => expect(result).toEqual({ url: undefined, state: 'remote' }));
        await act(async () => root.unmount());
    });

    it('picks up a status change by polling', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        await queue();
        await mount();
        await vi.waitFor(() => expect(result?.state).toBe('uploading'));

        await updateImageUploadStatus(ID, 'failed');
        await act(async () => { vi.advanceTimersByTime(5000); });

        await vi.waitFor(() => expect(result?.state).toBe('failed'));
        await act(async () => root.unmount());
    });

    it('reads the bytes once and stops polling when the row is gone', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        await queue();
        await mount();
        await vi.waitFor(() => expect(result?.state).toBe('uploading'));
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

        await deletePendingImageUpload(ID);
        await act(async () => { vi.advanceTimersByTime(5000); });
        await vi.waitFor(() => expect(vi.getTimerCount()).toBe(0));

        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        expect(result?.state).toBe('uploading');
        await act(async () => root.unmount());
    });

    it('stays uploading, not failed, and stops polling once the row is marked synced (#179)', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        await queue();
        await mount();
        await vi.waitFor(() => expect(result?.state).toBe('uploading'));

        await updateImageUploadStatus(ID, 'synced', 'jrnl_img0');
        await act(async () => { vi.advanceTimersByTime(5000); });
        await vi.waitFor(() => expect(vi.getTimerCount()).toBe(0));

        expect(result?.state).toBe('uploading');
        await act(async () => root.unmount());
    });

    it('does not poll without a local row', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        await mount();
        await vi.waitFor(() => expect(result?.state).toBe('remote'));
        expect(vi.getTimerCount()).toBe(0);
        await act(async () => root.unmount());
    });

    it('revokes the object URL on unmount', async () => {
        await queue();
        await mount();
        await vi.waitFor(() => expect(result?.url).toBe('blob:restored'));

        await act(async () => root.unmount());

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:restored');
    });
});
