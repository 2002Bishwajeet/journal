import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    saveDocumentUpdate, upsertSearchIndex, upsertSyncRecord, getSyncRecord, getSearchIndexEntry,
} from '@/lib/db/queries';
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';
import type { OnlineContextType } from '@/contexts/OnlineContext';
import type { DocumentMetadata, SyncRecord } from '@/types';
import * as Y from 'yjs';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';

const { mockUploadFile, mockPatchFile, mockGetPayloadBytes, mockGetContent } = vi.hoisted(() => ({
    mockUploadFile: vi.fn(),
    mockPatchFile: vi.fn(),
    mockGetPayloadBytes: vi.fn(),
    mockGetContent: vi.fn(),
}));
// Only the SDK is stubbed: NotesDriveProvider and SyncService both run for real, so the
// push and the rebuild-from-server pull are exercised end to end.
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        uploadFile: mockUploadFile,
        patchFile: mockPatchFile,
        getPayloadBytes: mockGetPayloadBytes,
        getContentFromHeaderOrPayload: mockGetContent,
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

const DOC_ID = '33333333-3333-3333-3333-333333333333';
/** The note was really written in 2020... */
const CREATED = '2020-03-15T10:30:00.000Z';
/** ...but it is only pushed to the server today. */
const PUSH_TIME = Date.parse('2026-09-16T12:00:00.000Z');

const fakeDotYouClient = { getHostIdentity: () => 'sam.dotyou.cloud' } as unknown as DotYouClient;
const fakeOnline = { isOnline: true } as unknown as OnlineContextType;

const META = (extra: Partial<DocumentMetadata> = {}): DocumentMetadata => ({
    title: 'Old Note',
    folderId: MAIN_FOLDER_ID,
    tags: [],
    timestamps: { created: CREATED, modified: '2026-09-16T11:59:00.000Z' },
    excludeFromAI: false,
    ...extra,
});

function textUpdate(text: string): Uint8Array {
    const d = new Y.Doc();
    d.getText('body').insert(0, text);
    const u = Y.encodeStateAsUpdate(d);
    d.destroy();
    return u;
}

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    // @ts-expect-error test-only setter
    pgliteModule.setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

describe('NotesDriveProvider pushes the real created timestamp as userDate', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockUploadFile.mockResolvedValue({ file: { fileId: 'remote-file-1' }, newVersionTag: 'v1' });
        mockPatchFile.mockResolvedValue({ newVersionTag: 'v2' });
        provider = new NotesDriveProvider(fakeDotYouClient);
    });

    it('createNote sends the note created date, not the moment of the push', async () => {
        await provider.createNote(DOC_ID, META(), textUpdate('old content'));

        const uploaded = mockUploadFile.mock.calls[0][2];
        expect(uploaded.appData.userDate).toBe(Date.parse(CREATED));
    });

    it('updateNote sends the note created date, not the moment of the push', async () => {
        await provider.updateNote(DOC_ID, 'remote-file-1', 'v1', META());

        const patched = mockPatchFile.mock.calls[0][3];
        expect(patched.appData.userDate).toBe(Date.parse(CREATED));
    });

    it('falls back to now when a note carries no usable created timestamp', async () => {
        const before = Date.now();
        await provider.createNote(DOC_ID, META({
            timestamps: undefined as unknown as DocumentMetadata['timestamps'],
        }), textUpdate('x'));
        const after = Date.now();

        const userDate = mockUploadFile.mock.calls[0][2].appData.userDate;
        expect(userDate).toBeGreaterThanOrEqual(before);
        expect(userDate).toBeLessThanOrEqual(after);
    });
});

describe('created timestamp round-trip through the server', () => {
    let svc: SyncService;
    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        mockUploadFile.mockResolvedValue({ file: { fileId: 'remote-file-1' }, newVersionTag: 'v1' });
        svc = new SyncService(fakeDotYouClient, fakeOnline);
    });

    it('keeps a note created long ago from collapsing to its push time when the local DB is wiped and rebuilt', async () => {
        const blob = textUpdate('written back in 2020');
        await saveDocumentUpdate(DOC_ID, blob);
        await upsertSearchIndex({
            docId: DOC_ID, title: 'Old Note', plainTextContent: 'written back in 2020', metadata: META(),
        });
        await upsertSyncRecord({
            localId: DOC_ID, entityType: 'note', lastSyncedAt: new Date().toISOString(),
            syncStatus: 'pending',
        } as SyncRecord);

        await svc.pushNote((await getSyncRecord(DOC_ID))!);

        // What actually went to the server.
        const pushedAppData = mockUploadFile.mock.calls[0][2].appData;
        expect(pushedAppData.userDate).toBe(Date.parse(CREATED));

        // The local database is wiped; everything must come back from the server alone.
        await resetTestDatabase();
        expect(await getSearchIndexEntry(DOC_ID)).toBeNull();

        mockGetContent.mockResolvedValue({ title: 'Old Note', tags: [] });
        mockGetPayloadBytes.mockResolvedValue({ bytes: blob });

        await svc.handleRemoteNote({
            fileId: 'remote-file-1',
            sharedSecretEncryptedKeyHeader: {
                encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=',
            },
            fileMetadata: {
                versionTag: 'v1',
                updated: PUSH_TIME, // server-side change date is today — that is what sync cursors use
                appData: { uniqueId: DOC_ID, groupId: MAIN_FOLDER_ID, userDate: pushedAppData.userDate },
            },
        } as never);

        const rebuilt = await getSearchIndexEntry(DOC_ID);
        expect(rebuilt?.metadata.timestamps.created).toBe(CREATED);
        // Pre-fix this was the push time, i.e. every note's created date collapsed to "today".
        expect(rebuilt?.metadata.timestamps.created).not.toBe(new Date(PUSH_TIME).toISOString());
    });
});
