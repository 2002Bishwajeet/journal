/**
 * End to end for the share dialog's link card (#222, proves #217): real PGlite +
 * Yjs + NotesDriveProvider + SyncService, with only the drive SDK calls stubbed.
 * Making a note public, then editing its description / indexing flag, must reach
 * the uploaded header's `card`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as Y from 'yjs';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    saveDocumentUpdate, getDocumentUpdates, upsertSearchIndex, upsertSyncRecord, getSyncRecord,
    getSearchIndexEntry, updateSearchIndexMetadata, updateSyncStatus, recordNoteRekey,
} from '@/lib/db/queries';
import { buildPublicCard, mergeShareCard, type ShareCardPatch } from '@/lib/share/publicCard';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';
import type { SyncRecord } from '@/types';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockGetHeader, mockGetHeaderByUniqueId, mockReUpload, mockPatch } = vi.hoisted(() => ({
    mockGetHeader: vi.fn(),
    mockGetHeaderByUniqueId: vi.fn(),
    mockReUpload: vi.fn(),
    mockPatch: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        getFileHeader: mockGetHeader,
        getFileHeaderByUniqueId: mockGetHeaderByUniqueId,
        // Make public/private re-upload via uploadFile (#451); keep reUploadFile's
        // (client, instructions, metadata, encrypt) shape for the assertions below.
        uploadFile: (...args: unknown[]) => mockReUpload(args[0], args[1], args[2], args[5]),
        patchFile: mockPatch,
    };
});
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class FolderDriveProvider { constructor() {} },
}));
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor { constructor() {} },
}));

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { SyncService } from '@/lib/homebase/SyncService';

const DOC_ID = '11111111-1111-1111-1111-111111111111';
const client = fakeDotYouClient('sam.dotyou.cloud');

function remoteHeader() {
    return {
        fileId: 'file-1',
        fileMetadata: {
            versionTag: 'v1',
            isEncrypted: false,
            appData: { uniqueId: DOC_ID, groupId: 'main', userDate: 1, tags: [], content: { title: 'Note', tags: [] } },
        },
    };
}

function helloWorldUpdate(): Uint8Array {
    const doc = new Y.Doc();
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    p.insert(0, [t]);
    t.insert(0, 'Hello world');
    doc.getXmlFragment('prosemirror').insert(0, [p]);
    return Y.encodeStateAsUpdate(doc);
}

/** What ShareDialog.handleMakePublic + setNotePublic do. */
async function makePublic(): Promise<void> {
    const record = await getSyncRecord(DOC_ID);
    const blob = Y.mergeUpdates(await getDocumentUpdates(DOC_ID));
    const metadata = (await getSearchIndexEntry(DOC_ID))!.metadata;
    const rekeyed = await new NotesDriveProvider(client).makeNotePublic(DOC_ID, record?.remoteFileId, buildPublicCard(blob, metadata));
    await recordNoteRekey(DOC_ID, rekeyed.previousVersionTag, rekeyed.versionTag);
    const current = (await getSearchIndexEntry(DOC_ID))!;
    await updateSearchIndexMetadata(DOC_ID, current.title, { ...current.metadata, isPublic: true });
}

/** What useNotes().setShareCard does, followed by the sync push. */
async function setShareCardAndPush(svc: SyncService, patch: ShareCardPatch): Promise<void> {
    const current = (await getSearchIndexEntry(DOC_ID))!;
    await updateSearchIndexMetadata(DOC_ID, current.title, mergeShareCard(current.metadata, patch));
    await updateSyncStatus(DOC_ID, 'pending');
    mockPatch.mockClear();
    await svc.pushNote((await getSyncRecord(DOC_ID))!);
}

function uploadedCard(metadataArg: { appData: { content: string } }) {
    return JSON.parse(metadataArg.appData.content).card;
}
const patchedCard = () => {
    expect(mockPatch).toHaveBeenCalledTimes(1);
    return uploadedCard(mockPatch.mock.calls[0][3]);
};

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

describe('share card: dialog edits reach the uploaded header', () => {
    let svc: SyncService;

    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        mockGetHeader.mockResolvedValue(remoteHeader());
        mockGetHeaderByUniqueId.mockResolvedValue(remoteHeader());
        mockReUpload.mockResolvedValue({ newVersionTag: 'v2' });
        mockPatch.mockResolvedValue({ newVersionTag: 'v3' });
        svc = new SyncService(client, fakeOnlineContext());

        await saveDocumentUpdate(DOC_ID, helloWorldUpdate());
        await upsertSearchIndex({
            docId: DOC_ID, title: 'Note', plainTextContent: 'Hello world',
            metadata: {
                title: 'Note', folderId: 'main', tags: [], excludeFromAI: false,
                timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
            },
        });
        await upsertSyncRecord({
            localId: DOC_ID, entityType: 'note', remoteFileId: 'file-1', versionTag: 'v1',
            syncStatus: 'synced', contentHash: 'old',
        } as SyncRecord);
    });

    it('publishes the first paragraph, then the custom text, indexing, and the first paragraph again', async () => {
        await makePublic();
        expect(mockReUpload).toHaveBeenCalledTimes(1);
        expect(uploadedCard(mockReUpload.mock.calls[0][2])).toEqual({ description: 'Hello world' });

        await setShareCardAndPush(svc, { shareDescription: 'Custom text' });
        expect(patchedCard().description).toBe('Custom text');
        expect((await getSyncRecord(DOC_ID))?.syncStatus).toBe('synced');

        await setShareCardAndPush(svc, { shareIndexable: true });
        expect(patchedCard()).toEqual({ description: 'Custom text', indexable: true });

        // "Use first paragraph"
        await setShareCardAndPush(svc, { shareDescription: '' });
        expect(patchedCard()).toEqual({ description: 'Hello world', indexable: true });
        expect((await getSearchIndexEntry(DOC_ID))?.metadata).not.toHaveProperty('shareDescription');
    });

    it("keeps a description typed before the make-public upload's websocket echo is pulled", async () => {
        await makePublic();
        const current = (await getSearchIndexEntry(DOC_ID))!;
        await updateSearchIndexMetadata(DOC_ID, current.title, mergeShareCard(current.metadata, { shareDescription: 'Custom text' }));
        await updateSyncStatus(DOC_ID, 'pending');

        // The re-upload comes back over the websocket: v2, public projection, no description yet.
        await svc.handleRemoteNote({
            fileId: 'file-1',
            fileMetadata: {
                versionTag: 'v2',
                isEncrypted: false,
                appData: { uniqueId: DOC_ID, groupId: 'main', content: JSON.stringify({ title: 'Note', isPublic: true }) },
            },
        } as unknown as Parameters<SyncService['handleRemoteNote']>[0]);

        expect((await getSearchIndexEntry(DOC_ID))?.metadata.shareDescription).toBe('Custom text');
        mockPatch.mockClear();
        await svc.pushNote((await getSyncRecord(DOC_ID))!);
        expect(patchedCard().description).toBe('Custom text');
    });

    it('keeps the old version tag when this device was behind the re-uploaded version', async () => {
        await upsertSyncRecord({
            localId: DOC_ID, entityType: 'note', remoteFileId: 'file-1', versionTag: 'v0',
            syncStatus: 'synced', contentHash: 'old',
        } as SyncRecord);
        await makePublic();
        expect((await getSyncRecord(DOC_ID))?.versionTag).toBe('v0');
    });
});
