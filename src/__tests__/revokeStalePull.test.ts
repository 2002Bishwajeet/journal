/**
 * #689: a pull (or websocket notification) holding the note's header from just
 * before the owner's revoke, e.g. with a peer's last edit, wrote that header's
 * sharing state over the revoke's local write: the note stayed in the shared
 * folder with its badge. handleRemoteNote must not write metadata from a header
 * the revoke superseded, even when it fetched that header before the revoke ran.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { getSearchIndexEntry, upsertSearchIndex, updateSearchIndexMetadata, upsertSyncRecord } from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockDsr, mockGetNotePayload } = vi.hoisted(() => ({
    mockDsr: vi.fn(),
    mockGetNotePayload: vi.fn(),
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        dsrToContent = mockDsr;
        getNotePayload = mockGetNotePayload;
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
import { MAIN_FOLDER_ID, COLLABORATIVE_FOLDER_ID } from '@/lib/homebase/config';
import type { DocumentMetadata } from '@/types';

const NOTE_ID = '68968968-9689-6896-8968-968968968968';
const fakeClient = fakeDotYouClient();
const fakeOnline = fakeOnlineContext();

const SHARED: DocumentMetadata = {
    title: 'Shared',
    folderId: COLLABORATIVE_FOLDER_ID,
    tags: [],
    timestamps: { created: '2026-10-22T00:00:00.000Z', modified: '2026-10-22T00:00:00.000Z' },
    excludeFromAI: false,
    isCollaborative: true,
    circleIds: ['circle-1'],
    recipients: ['peer.id'],
};
const REVOKED: DocumentMetadata = {
    ...SHARED,
    folderId: MAIN_FOLDER_ID,
    isCollaborative: false,
    circleIds: undefined,
    recipients: undefined,
};

/** The note's header as the server held it: shared, with the peer's last edit. */
function sharedHeader(updated: number, versionTag: string) {
    return {
        fileId: 'note-file-1',
        fileMetadata: {
            versionTag,
            updated,
            appData: { uniqueId: NOTE_ID, groupId: COLLABORATIVE_FOLDER_ID },
        },
    } as never;
}

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

describe('SyncService.handleRemoteNote after a revoke (#689)', () => {
    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        mockDsr.mockResolvedValue({ title: 'Shared', tags: [], isCollaborative: true, circleIds: ['circle-1'], recipients: ['peer.id'] });
        mockGetNotePayload.mockResolvedValue(null);
        await upsertSearchIndex({ docId: NOTE_ID, title: 'Shared', plainTextContent: '', metadata: SHARED });
        await upsertSyncRecord({
            localId: NOTE_ID,
            entityType: 'note',
            remoteFileId: 'note-file-1',
            versionTag: 'v1',
            lastSyncedAt: new Date().toISOString(),
            syncStatus: 'synced',
        });
    });

    /** The hook's revoke: remote patch done, then the floor, then the local write. */
    async function revokeLocally(svc: SyncService, previousUpdated: number) {
        svc.supersedeNoteHeaders(NOTE_ID, previousUpdated);
        await updateSearchIndexMetadata(NOTE_ID, 'Shared', REVOKED);
    }

    it('keeps the revoke when a pull that fetched the pre-revoke header finishes after it', async () => {
        const svc = new SyncService(fakeClient, fakeOnline);
        // The pull is mid-way through the note (fetching its payload) when the revoke lands.
        let releasePayload!: () => void;
        mockGetNotePayload.mockReturnValue(new Promise((resolve) => { releasePayload = () => resolve(null); }));
        const pull = svc.handleRemoteNote(sharedHeader(2000, 'v2'));
        await vi.waitFor(() => expect(mockGetNotePayload).toHaveBeenCalled());

        await revokeLocally(svc, 2000);
        releasePayload();
        await pull;

        const entry = await getSearchIndexEntry(NOTE_ID);
        expect(entry?.metadata.folderId).toBe(MAIN_FOLDER_ID);
        expect(entry?.metadata.isCollaborative).toBe(false);
        expect(entry?.metadata.circleIds).toBeUndefined();
    });

    it('ignores an older header that arrives after the revoke', async () => {
        const svc = new SyncService(fakeClient, fakeOnline);
        await revokeLocally(svc, 2000);

        await svc.handleRemoteNote(sharedHeader(1500, 'v1b'));

        expect((await getSearchIndexEntry(NOTE_ID))?.metadata.folderId).toBe(MAIN_FOLDER_ID);
    });

    it('still applies a header newer than the one the revoke replaced', async () => {
        const svc = new SyncService(fakeClient, fakeOnline);
        await revokeLocally(svc, 2000);

        // Someone re-shared the note after the revoke
        await svc.handleRemoteNote(sharedHeader(3000, 'v4'));

        const entry = await getSearchIndexEntry(NOTE_ID);
        expect(entry?.metadata.folderId).toBe(COLLABORATIVE_FOLDER_ID);
        expect(entry?.metadata.isCollaborative).toBe(true);
    });
});
