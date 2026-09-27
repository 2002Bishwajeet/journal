// @vitest-environment happy-dom
/**
 * useImageDeletionTracker must only queue a payload deletion for images that belong
 * to THIS note's remote file. A copy/pasted `attachment://<otherFileId>/<key>` points at
 * another note's payload; deleting it here must never delete this note's same-named key.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';

const { mockSavePendingImageDeletion, mockGetSyncRecord, mockSyncNote } = vi.hoisted(() => ({
    mockSavePendingImageDeletion: vi.fn(),
    mockGetSyncRecord: vi.fn(),
    mockSyncNote: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
    savePendingImageDeletion: mockSavePendingImageDeletion,
    getSyncRecord: mockGetSyncRecord,
}));
vi.mock('@/hooks/useSyncService', () => ({
    useSyncService: () => ({ syncNote: mockSyncNote }),
}));

import { useImageDeletionTracker } from '@/components/editor/hooks/useImageDeletionTracker';

const DOC_ID = 'note-b';
const OWN_FILE_ID = 'file-B';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function image(src: string): Y.XmlElement {
    const el = new Y.XmlElement('image');
    el.setAttribute('src', src);
    return el;
}

function Tracker({ yXmlFragment }: { yXmlFragment: Y.XmlFragment }) {
    useImageDeletionTracker({ docId: DOC_ID, yXmlFragment });
    return null;
}

/** Mount the tracker over a doc holding the given image srcs, delete image 0, let the 2s timer fire. */
async function deleteFirstImage(srcs: string[]) {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');
    fragment.insert(0, srcs.map(image));

    const el = document.createElement('div');
    const root = createRoot(el);
    await act(async () => { root.render(h(Tracker, { yXmlFragment: fragment })); });

    fragment.delete(0, 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });

    await act(async () => root.unmount());
    doc.destroy();
}

describe('useImageDeletionTracker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mockSavePendingImageDeletion.mockResolvedValue(undefined);
        mockGetSyncRecord.mockResolvedValue({ localId: DOC_ID, remoteFileId: OWN_FILE_ID });
    });
    afterEach(() => { vi.useRealTimers(); });

    it('does not queue a deletion for a removed image whose fileId belongs to another note', async () => {
        await deleteFirstImage(['attachment://file-A/jrnl_img0']);

        expect(mockSavePendingImageDeletion).not.toHaveBeenCalled();
    });

    it('queues a deletion for a removed image stored on this note\'s own file', async () => {
        await deleteFirstImage(['attachment://file-B/jrnl_img0']);

        expect(mockSavePendingImageDeletion).toHaveBeenCalledWith(DOC_ID, 'jrnl_img0');
    });

    it('does not queue a deletion when the note has no sync record yet', async () => {
        mockGetSyncRecord.mockResolvedValue(null);

        await deleteFirstImage(['attachment://file-B/jrnl_img0']);

        expect(mockSavePendingImageDeletion).not.toHaveBeenCalled();
    });

    it('queues this note\'s key when its own image is removed even if a foreign image reuses the key', async () => {
        // Own jrnl_img0 is removed; a pasted foreign jrnl_img0 (another note's payload) stays.
        await deleteFirstImage(['attachment://file-B/jrnl_img0', 'attachment://file-A/jrnl_img0']);

        expect(mockSavePendingImageDeletion).toHaveBeenCalledWith(DOC_ID, 'jrnl_img0');
    });
});
