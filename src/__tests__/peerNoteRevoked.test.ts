import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { toGuidId } from '@homebase-id/js-lib/helpers';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    saveDocumentUpdate, getDocumentUpdates, getSyncRecord, upsertSyncRecord, upsertSearchIndex, getSearchIndexEntry,
} from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';
import * as Y from 'yjs';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockGetNote, mockGetNotePayload } = vi.hoisted(() => ({
    mockGetNote: vi.fn(),
    mockGetNotePayload: vi.fn(),
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        getNote = mockGetNote;
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

import { documentBroadcast } from '@/lib/broadcast';
import { SyncService } from '@/lib/homebase/SyncService';
import { bootstrapCollaborativeNote } from '@/lib/homebase/sync/peerNotes';
import type { SyncContext } from '@/lib/homebase/sync/context';

const HOST = 'sam.dotyou.cloud';
const FRODO = 'frodo.dotyou.cloud';
const DOC_ID = '11111111-1111-1111-1111-111111111111';

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

function yjsUpdate(): Uint8Array {
    const d = new Y.Doc();
    d.getArray('content').insert(0, ['hello']);
    const u = Y.encodeStateAsUpdate(d);
    d.destroy();
    return u;
}

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => {
    await closeTestDatabase();
});

async function seedPeerNote() {
    await saveDocumentUpdate(DOC_ID, yjsUpdate());
    await upsertSyncRecord({
        localId: DOC_ID, entityType: 'note', remoteFileId: 'rf', versionTag: 'a0000000-0000-0000-0000-000000000001',
        lastSyncedAt: new Date().toISOString(), syncStatus: 'synced', authorOdinId: FRODO,
    });
    await upsertSearchIndex({
        docId: DOC_ID,
        title: 'Shared',
        plainTextContent: 'hello',
        metadata: {
            title: 'Shared', folderId: 'collab', tags: [],
            timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
            excludeFromAI: true, isCollaborative: true, authorOdinId: FRODO,
        },
    });
}

async function localCopyExists() {
    const [updates, record, row] = await Promise.all([
        getDocumentUpdates(DOC_ID), getSyncRecord(DOC_ID), getSearchIndexEntry(DOC_ID),
    ]);
    return updates.length > 0 || !!record || !!row;
}

describe('revalidatePeerNote after the owner revokes', () => {
    let svc: SyncService;

    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        vi.spyOn(documentBroadcast, 'notifyDocumentUpdated').mockImplementation(() => {});
        svc = new SyncService(fakeDotYouClient(HOST), fakeOnlineContext());
        await seedPeerNote();
    });

    it.each([403, 404])('removes the local copy on a %i from the owner', async (status) => {
        mockGetNote.mockRejectedValue(httpError(status));
        expect(await svc.revalidatePeerNote(DOC_ID, FRODO)).toBe('removed');
        expect(await localCopyExists()).toBe(false);
    });

    it('removes the local copy when the owner answers with no header', async () => {
        mockGetNote.mockResolvedValue(null);
        expect(await svc.revalidatePeerNote(DOC_ID, FRODO)).toBe('removed');
        expect(await localCopyExists()).toBe(false);
    });

    it.each([
        ['a network error', new Error('Network Error')],
        ['a 500', httpError(500)],
        ['a 503', httpError(503)],
    ])('keeps the local copy on %s', async (_name, err) => {
        mockGetNote.mockRejectedValue(err);
        expect(await svc.revalidatePeerNote(DOC_ID, FRODO)).toBe('skipped');
        expect(await localCopyExists()).toBe(true);
    });
});

describe('bootstrapCollaborativeNote for a leftover invite', () => {
    const ctx = { hostIdentity: HOST, notesProvider: { getNote: mockGetNote } } as unknown as SyncContext;

    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    const bootstrap = () => bootstrapCollaborativeNote(ctx, DOC_ID, FRODO, 'Title', 'preview', '2026-01-01T00:00:00.000Z');

    it.each([403, 404])('writes no stub when the owner answers %i', async (status) => {
        mockGetNote.mockRejectedValue(httpError(status));
        await bootstrap();
        expect(await getSearchIndexEntry(DOC_ID)).toBeNull();
    });

    it('writes no stub when the owner answers with no header', async () => {
        mockGetNote.mockResolvedValue(null);
        await bootstrap();
        expect(await getSearchIndexEntry(DOC_ID)).toBeNull();
    });

    it.each([
        ['a network error', new Error('Network Error')],
        ['a 500', httpError(500)],
    ])('still writes a stub on %s', async (_name, err) => {
        mockGetNote.mockRejectedValue(err);
        await bootstrap();
        expect((await getSearchIndexEntry(DOC_ID))?.title).toBe('Title');
    });
});

describe('handleDeletedInvitation', () => {
    let svc: SyncService;

    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        svc = new SyncService(fakeDotYouClient(HOST), fakeOnlineContext());
        await seedPeerNote();
    });

    it('removes the note whose id the invite named', async () => {
        const inviteId = toGuidId(`collab-invite-${DOC_ID}`);
        await svc.handleDeletedInvitation({ fileMetadata: { appData: { uniqueId: inviteId } } });
        expect(await localCopyExists()).toBe(false);
    });

    it('keeps notes the invite did not name', async () => {
        const inviteId = toGuidId('collab-invite-22222222-2222-2222-2222-222222222222');
        await svc.handleDeletedInvitation({ fileMetadata: { appData: { uniqueId: inviteId } } });
        expect(await localCopyExists()).toBe(true);
    });
});
