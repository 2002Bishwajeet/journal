/**
 * #897: people named on a note as viewers (`odinIds`). The list must survive every place
 * that rebuilds a note's metadata from its header (one that drops it would take those
 * people out of the ACL on the next save), the owner puts it back in the ACL when a peer
 * update stripped it, and a viewer's device never sends a peer update.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as Y from 'yjs';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { getSearchIndexEntry, getSyncRecord, saveDocumentUpdate, upsertSearchIndex, upsertSyncRecord } from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockDsr, mockGetNote, mockGetNotePayload, mockUpdateNote, mockRestoreAcl } = vi.hoisted(() => ({
    mockDsr: vi.fn(),
    mockGetNote: vi.fn(),
    mockGetNotePayload: vi.fn(),
    mockUpdateNote: vi.fn(),
    mockRestoreAcl: vi.fn(),
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        dsrToContent = mockDsr;
        getNote = mockGetNote;
        getNotePayload = mockGetNotePayload;
        updateNote = mockUpdateNote;
        restoreNoteAcl = mockRestoreAcl;
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

import { SecurityGroupType } from '@homebase-id/js-lib/core';
import { SyncService } from '@/lib/homebase/SyncService';
import { COLLABORATIVE_FOLDER_ID } from '@/lib/homebase/config';
import { isViewOnly } from '@/lib/homebase/shareTargets';
import { createDriveDeps } from '../../mcp/drive';
import type { McpCredentials } from '../../mcp/credentials';
import type { DocumentMetadata, NoteFileContent, SyncRecord } from '@/types';

const NOTE_ID = '89789789-7897-4897-8978-978978978978';
const OWNER = 'frodo.dotyou.cloud';
const VIEWER = 'sam.dotyou.cloud';
const SHARED_CONTENT: NoteFileContent = {
    title: 'Shared',
    tags: [],
    excludeFromAI: false,
    isCollaborative: true,
    odinIds: [VIEWER],
    recipients: [],
};

function header(versionTag: string, acl?: object) {
    return {
        fileId: 'note-file-1',
        fileMetadata: {
            versionTag,
            updated: 2000,
            created: 1000,
            globalTransitId: 'gtid-1',
            appData: { uniqueId: NOTE_ID, groupId: COLLABORATIVE_FOLDER_ID, userDate: 1000 },
        },
        ...(acl && { serverMetadata: { accessControlList: acl } }),
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
    mockRestoreAcl.mockResolvedValue({ versionTag: 'v3' });
    mockUpdateNote.mockResolvedValue({ versionTag: 'v2' });
});

const local = (extra: Partial<DocumentMetadata> = {}): DocumentMetadata => ({
    title: 'Shared',
    folderId: COLLABORATIVE_FOLDER_ID,
    timestamps: { created: '2026-10-22T00:00:00.000Z', modified: '2026-10-22T00:00:00.000Z' },
    excludeFromAI: false,
    ...extra,
});

async function seed(metadata: DocumentMetadata, record: Partial<SyncRecord> = {}) {
    await upsertSearchIndex({ docId: NOTE_ID, title: 'Shared', plainTextContent: '', metadata });
    await upsertSyncRecord({
        localId: NOTE_ID,
        entityType: 'note',
        remoteFileId: 'note-file-1',
        versionTag: 'v1',
        lastSyncedAt: new Date().toISOString(),
        syncStatus: 'synced',
        ...record,
    } as SyncRecord);
}

describe('pull (handleRemoteNote) keeps odinIds', () => {
    it('for a note new to this device', async () => {
        await new SyncService(fakeDotYouClient(OWNER), fakeOnlineContext()).handleRemoteNote(header('v1'));

        expect((await getSearchIndexEntry(NOTE_ID))?.metadata.odinIds).toEqual([VIEWER]);
    });

    it('for a note this device already has', async () => {
        await seed(local());

        await new SyncService(fakeDotYouClient(OWNER), fakeOnlineContext()).handleRemoteNote(header('v2'));

        expect((await getSearchIndexEntry(NOTE_ID))?.metadata.odinIds).toEqual([VIEWER]);
    });
});

describe('peer bootstrap keeps odinIds', () => {
    it("writes the owner's odinIds when an invite arrives", async () => {
        const invite = { fileId: 'invite-1', fileMetadata: { senderOdinId: OWNER } };
        mockDsr.mockImplementation(async (file: unknown) => file === invite
            ? { authorOdinId: OWNER, noteUniqueId: NOTE_ID, noteTitle: 'Shared', notePreview: '', sharedAt: '2026-10-22T00:00:00.000Z' }
            : SHARED_CONTENT);
        mockGetNote.mockResolvedValue(header('v1'));

        await new SyncService(fakeDotYouClient(VIEWER), fakeOnlineContext()).handleInvitation(invite as never);

        const entry = await getSearchIndexEntry(NOTE_ID);
        expect(entry?.metadata).toMatchObject({ authorOdinId: OWNER, odinIds: [VIEWER] });
        expect(isViewOnly(entry!.metadata, VIEWER)).toBe(true);
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
        expect(note?.metadata.odinIds).toEqual([VIEWER]);

        await deps.uploadNoteEdit(NOTE_ID, {
            fileId: note!.fileId,
            versionTag: note!.versionTag,
            metadata: note!.metadata,
            yjsBlob: new Uint8Array([0, 0]),
        });
        expect(mockUpdateNote.mock.calls[0][3]).toMatchObject({ isCollaborative: true, odinIds: [VIEWER] });
    });
});

// odin-core#2002: a peer update replaces the stored ACL with the sender's, minus odinIdList
describe("the owner's guard", () => {
    const owner = () => new SyncService(fakeDotYouClient(OWNER), fakeOnlineContext());

    it('re-uploads the ACL of its own note when the stored one lost the viewers', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await seed(local({ isCollaborative: true, odinIds: [VIEWER] }));

        await owner().handleRemoteNote(header('v2', { requiredSecurityGroup: SecurityGroupType.Connected, odinIdList: [] }));

        expect(mockRestoreAcl).toHaveBeenCalledWith(NOTE_ID, 'note-file-1', SHARED_CONTENT);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(NOTE_ID));
    });

    it('re-uploads it when odinIdList is gone altogether', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await seed(local());

        await owner().handleRemoteNote(header('v2', { requiredSecurityGroup: SecurityGroupType.Connected, circleIdList: ['c1'] }));

        expect(mockRestoreAcl).toHaveBeenCalledTimes(1);
    });

    it('leaves an ACL that still names the viewers alone, in any case', async () => {
        await seed(local());

        await owner().handleRemoteNote(header('v2', { requiredSecurityGroup: SecurityGroupType.Connected, odinIdList: ['Sam.DotYou.Cloud'] }));

        expect(mockRestoreAcl).not.toHaveBeenCalled();
    });

    it('leaves a circle-only note alone', async () => {
        mockDsr.mockResolvedValue({ ...SHARED_CONTENT, odinIds: undefined, circleIds: ['c1'] });
        await seed(local());

        await owner().handleRemoteNote(header('v2', { requiredSecurityGroup: SecurityGroupType.Connected, circleIdList: ['c1'] }));

        expect(mockRestoreAcl).not.toHaveBeenCalled();
    });

    it("never touches someone else's note", async () => {
        await seed(local({ authorOdinId: OWNER }), { authorOdinId: OWNER });

        await new SyncService(fakeDotYouClient(VIEWER), fakeOnlineContext())
            .handleRemoteNote(header('v2', { requiredSecurityGroup: SecurityGroupType.Connected, odinIdList: [] }));

        expect(mockRestoreAcl).not.toHaveBeenCalled();
    });

    it('lets the pull retry the note when the re-upload fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockRestoreAcl.mockRejectedValue(new Error('500'));
        await seed(local());

        await expect(owner().handleRemoteNote(header('v2', { requiredSecurityGroup: SecurityGroupType.Connected, odinIdList: [] })))
            .rejects.toThrow('500');
        expect((await getSyncRecord(NOTE_ID))?.versionTag).toBe('v1');
    });
});

describe('a viewer never sends a peer update', () => {
    async function pushAs(host: string, metadata: DocumentMetadata) {
        const doc = new Y.Doc();
        doc.getText('body').insert(0, 'typed');
        await saveDocumentUpdate(NOTE_ID, Y.encodeStateAsUpdate(doc));
        doc.destroy();
        await seed(metadata, { syncStatus: 'pending', contentHash: 'stale', authorOdinId: OWNER, globalTransitId: 'gtid-1' });
        await new SyncService(fakeDotYouClient(host), fakeOnlineContext()).pushNote((await getSyncRecord(NOTE_ID))!);
    }

    it('skips the upload of a note shared with the host to view, and marks it synced', async () => {
        await pushAs(VIEWER, local({ isCollaborative: true, authorOdinId: OWNER, odinIds: [VIEWER], recipients: [] }));

        expect(mockUpdateNote).not.toHaveBeenCalled();
        expect((await getSyncRecord(NOTE_ID))?.syncStatus).toBe('synced');
    });

    it('still uploads for an editor who is also named as a viewer', async () => {
        await pushAs(VIEWER, local({ isCollaborative: true, authorOdinId: OWNER, odinIds: [VIEWER], recipients: [VIEWER] }));

        expect(mockUpdateNote).toHaveBeenCalledTimes(1);
    });
});

describe('isViewOnly', () => {
    it("is true only for someone else's note naming the host as a viewer and not an editor", () => {
        expect(isViewOnly({ authorOdinId: OWNER, odinIds: [VIEWER] }, VIEWER)).toBe(true);
        expect(isViewOnly({ authorOdinId: OWNER, odinIds: [VIEWER], recipients: [VIEWER] }, VIEWER)).toBe(false);
        expect(isViewOnly({ authorOdinId: OWNER, recipients: [VIEWER] }, VIEWER)).toBe(false);
        expect(isViewOnly({ odinIds: [VIEWER] }, VIEWER)).toBe(false);
        expect(isViewOnly({ authorOdinId: VIEWER, odinIds: [VIEWER] }, VIEWER)).toBe(false);
    });

    it('is true for a member of a circle shared as viewers, unless another circle makes them an editor (#682)', () => {
        expect(isViewOnly({ authorOdinId: OWNER, viewerRecipients: [VIEWER] }, VIEWER)).toBe(true);
        expect(isViewOnly({ authorOdinId: OWNER, viewerRecipients: [VIEWER], recipients: [VIEWER] }, VIEWER)).toBe(false);
    });
});
