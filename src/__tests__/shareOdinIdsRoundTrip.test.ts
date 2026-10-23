/**
 * #681: the identities a note is shared with (`odinIds`) must survive every place that
 * rebuilds a note's metadata from its header. One that drops them would take those
 * people out of the ACL on the next save.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { getSearchIndexEntry, upsertSearchIndex, upsertSyncRecord } from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockDsr, mockGetNote, mockGetNotePayload, mockUpdateNote } = vi.hoisted(() => ({
    mockDsr: vi.fn(),
    mockGetNote: vi.fn(),
    mockGetNotePayload: vi.fn(),
    mockUpdateNote: vi.fn(),
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        dsrToContent = mockDsr;
        getNote = mockGetNote;
        getNotePayload = mockGetNotePayload;
        updateNote = mockUpdateNote;
        constructor() {}
    },
}));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class FolderDriveProvider { constructor() {} },
}));
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor { constructor() {} },
}));
vi.mock('../../mcp/client', () => ({ createClient: () => fakeDotYouClient() }));

import { SyncService } from '@/lib/homebase/SyncService';
import { COLLABORATIVE_FOLDER_ID } from '@/lib/homebase/config';
import { createDriveDeps } from '../../mcp/drive';
import type { McpCredentials } from '../../mcp/credentials';
import type { DocumentMetadata, NoteFileContent } from '@/types';

const NOTE_ID = '68168168-1681-6816-8168-168168168168';
const OWNER = 'frodo.dotyou.cloud';
const SHARED_CONTENT: NoteFileContent = {
    title: 'Shared',
    tags: [],
    excludeFromAI: false,
    isCollaborative: true,
    odinIds: ['sam.dotyou.cloud'],
    recipients: ['sam.dotyou.cloud'],
};

function header(versionTag: string) {
    return {
        fileId: 'note-file-1',
        fileMetadata: {
            versionTag,
            updated: 2000,
            created: 1000,
            globalTransitId: 'gtid-1',
            appData: { uniqueId: NOTE_ID, groupId: COLLABORATIVE_FOLDER_ID, userDate: 1000 },
        },
    } as never;
}

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

beforeEach(async () => {
    await resetTestDatabase();
    vi.clearAllMocks();
    mockDsr.mockResolvedValue(SHARED_CONTENT);
    mockGetNotePayload.mockResolvedValue(null);
});

describe('pull (handleRemoteNote) keeps odinIds', () => {
    it('for a note new to this device', async () => {
        await new SyncService(fakeDotYouClient(OWNER), fakeOnlineContext()).handleRemoteNote(header('v1'));

        expect((await getSearchIndexEntry(NOTE_ID))?.metadata.odinIds).toEqual(['sam.dotyou.cloud']);
    });

    it('for a note this device already has', async () => {
        const local: DocumentMetadata = {
            title: 'Shared',
            folderId: COLLABORATIVE_FOLDER_ID,
            timestamps: { created: '2026-10-22T00:00:00.000Z', modified: '2026-10-22T00:00:00.000Z' },
            excludeFromAI: false,
        };
        await upsertSearchIndex({ docId: NOTE_ID, title: 'Shared', plainTextContent: '', metadata: local });
        await upsertSyncRecord({
            localId: NOTE_ID,
            entityType: 'note',
            remoteFileId: 'note-file-1',
            versionTag: 'v1',
            lastSyncedAt: new Date().toISOString(),
            syncStatus: 'synced',
        });

        await new SyncService(fakeDotYouClient(OWNER), fakeOnlineContext()).handleRemoteNote(header('v2'));

        expect((await getSearchIndexEntry(NOTE_ID))?.metadata.odinIds).toEqual(['sam.dotyou.cloud']);
    });
});

describe('peer bootstrap keeps odinIds', () => {
    it("writes the author's odinIds when an invite arrives", async () => {
        const invite = { fileId: 'invite-1' };
        mockDsr.mockImplementation(async (file: unknown) => file === invite
            ? { authorOdinId: OWNER, noteUniqueId: NOTE_ID, noteTitle: 'Shared', notePreview: '', sharedAt: '2026-10-22T00:00:00.000Z' }
            : SHARED_CONTENT);
        mockGetNote.mockResolvedValue(header('v1'));

        await new SyncService(fakeDotYouClient('sam.dotyou.cloud'), fakeOnlineContext()).handleInvitation(invite as never);

        const entry = await getSearchIndexEntry(NOTE_ID);
        expect(entry?.metadata).toMatchObject({ authorOdinId: OWNER, odinIds: ['sam.dotyou.cloud'] });
    });
});

describe('MCP edit keeps odinIds', () => {
    it('reads them into the edit metadata and uploads them back', async () => {
        mockGetNote.mockResolvedValue({
            ...(header('v1') as object),
            fileMetadata: {
                ...(header('v1') as { fileMetadata: object }).fileMetadata,
                appData: { uniqueId: NOTE_ID, groupId: COLLABORATIVE_FOLDER_ID, userDate: 1000, content: 'encrypted' },
            },
        });
        const deps = createDriveDeps({} as McpCredentials);

        const note = await deps.fetchNoteForEdit(NOTE_ID);
        expect(note?.metadata.odinIds).toEqual(['sam.dotyou.cloud']);

        await deps.uploadNoteEdit(NOTE_ID, {
            fileId: note!.fileId,
            versionTag: note!.versionTag,
            metadata: note!.metadata,
            yjsBlob: new Uint8Array([0, 0]),
        });
        expect(mockUpdateNote.mock.calls[0][3]).toMatchObject({ isCollaborative: true, odinIds: ['sam.dotyou.cloud'] });
    });
});
