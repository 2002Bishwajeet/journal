import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { saveDocumentUpdate, getDocumentUpdates } from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';
import { formatGuidId } from '@homebase-id/js-lib/helpers';
import { getNewId } from '@/lib/utils';
import { getCover, setCover, setDarkCover } from '@/lib/editor/cover';
import * as Y from 'yjs';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider { constructor() {} },
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

type UpdateImageReference = (docId: string, pendingId: string, fileId: string, payloadKey: string) => Promise<boolean>;

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

async function storedDoc(): Promise<Y.Doc> {
    const d = new Y.Doc();
    for (const u of await getDocumentUpdates(DOC_ID)) Y.applyUpdate(d, u);
    return d;
}

describe('SyncService.updateImageReference cover promotion', () => {
    let updateImageReference: UpdateImageReference;

    beforeEach(async () => {
        await resetTestDatabase();
        vi.spyOn(documentBroadcast, 'notifyDocumentUpdated').mockImplementation(() => {});
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        const svc = new SyncService(fakeDotYouClient('sam.dotyou.cloud'), fakeOnlineContext());
        updateImageReference = (svc as unknown as { updateImageReference: UpdateImageReference })
            .updateImageReference.bind(svc);
    });

    it('promotes a pending cover to an attachment src and drops its pendingId', async () => {
        const pendingId = formatGuidId(getNewId());
        const ydoc = new Y.Doc();
        setCover(ydoc, { src: 'blob:x', pendingId, positionY: 30 });
        await saveDocumentUpdate(DOC_ID, Y.encodeStateAsUpdate(ydoc));

        expect(await updateImageReference(DOC_ID, pendingId, 'F', 'jrnl_img0')).toBe(true);

        const d = await storedDoc();
        expect(getCover(d)).toEqual({ src: 'attachment://F/jrnl_img0', positionY: 30 });
        expect(documentBroadcast.notifyDocumentUpdated).toHaveBeenCalledWith(DOC_ID);
        d.destroy();
    });

    it('leaves a cover with another pendingId alone', async () => {
        const ydoc = new Y.Doc();
        setCover(ydoc, { src: 'blob:x', pendingId: formatGuidId(getNewId()), positionY: 50 });
        await saveDocumentUpdate(DOC_ID, Y.encodeStateAsUpdate(ydoc));

        expect(await updateImageReference(DOC_ID, formatGuidId(getNewId()), 'F', 'jrnl_img0')).toBe(false);
    });

    it('still promotes a body image with the same pending id format', async () => {
        const pendingId = formatGuidId(getNewId());
        const coverPendingId = formatGuidId(getNewId());
        const ydoc = new Y.Doc();
        const img = new Y.XmlElement('image');
        img.setAttribute('src', 'blob:y');
        img.setAttribute('data-pending-id', pendingId);
        ydoc.getXmlFragment('prosemirror').insert(0, [img]);
        setCover(ydoc, { src: 'blob:x', pendingId: coverPendingId, positionY: 50 });
        await saveDocumentUpdate(DOC_ID, Y.encodeStateAsUpdate(ydoc));

        expect(await updateImageReference(DOC_ID, pendingId, 'F', 'jrnl_img1')).toBe(true);

        const d = await storedDoc();
        const stored = d.getXmlFragment('prosemirror').get(0) as Y.XmlElement;
        expect(stored.getAttribute('src')).toBe('attachment://F/jrnl_img1');
        expect(stored.getAttribute('data-pending-id')).toBeUndefined();
        // The cover's own upload is still pending
        expect(getCover(d)).toEqual({ src: 'blob:x', pendingId: coverPendingId, positionY: 50 });
        d.destroy();
    });

    it('promotes a pending dark cover and leaves the light cover alone (#512)', async () => {
        const darkPendingId = formatGuidId(getNewId());
        const ydoc = new Y.Doc();
        setCover(ydoc, { src: 'attachment://F/jrnl_img0', positionY: 40 });
        setDarkCover(ydoc, { src: 'blob:d', pendingId: darkPendingId, positionY: 60 });
        await saveDocumentUpdate(DOC_ID, Y.encodeStateAsUpdate(ydoc));

        expect(await updateImageReference(DOC_ID, darkPendingId, 'F', 'jrnl_img1')).toBe(true);

        const d = await storedDoc();
        expect(getCover(d)).toEqual({
            src: 'attachment://F/jrnl_img0',
            positionY: 40,
            dark: { src: 'attachment://F/jrnl_img1', positionY: 60 },
        });
        d.destroy();
    });

    it('promoting the light cover keeps a pending dark cover (#512)', async () => {
        const lightPendingId = formatGuidId(getNewId());
        const darkPendingId = formatGuidId(getNewId());
        const ydoc = new Y.Doc();
        setCover(ydoc, { src: 'blob:l', pendingId: lightPendingId, positionY: 50 });
        setDarkCover(ydoc, { src: 'blob:d', pendingId: darkPendingId, positionY: 50 });
        await saveDocumentUpdate(DOC_ID, Y.encodeStateAsUpdate(ydoc));

        expect(await updateImageReference(DOC_ID, lightPendingId, 'F', 'jrnl_img0')).toBe(true);

        const d = await storedDoc();
        expect(getCover(d)).toEqual({
            src: 'attachment://F/jrnl_img0',
            positionY: 50,
            dark: { src: 'blob:d', pendingId: darkPendingId, positionY: 50 },
        });
        d.destroy();
    });
});
