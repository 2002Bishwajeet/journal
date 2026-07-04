import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { DotYouClient, EncryptedKeyHeader } from '@homebase-id/js-lib/core';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    saveDocumentUpdate, getDocumentUpdates, upsertSyncRecord, getSyncRecord, upsertSearchIndex,
} from '@/lib/db/queries';
import { computeContentHash } from '@/lib/utils/hash';
import { serializeKeyHeader } from '@/lib/utils';
import type { OnlineContextType } from '@/contexts/OnlineContext';
import type { DocumentMetadata, SyncRecord } from '@/types';
import * as Y from 'yjs';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';

const { mockGetNote, mockGetNotePayload, mockUpdateNote, mockCreateNote } = vi.hoisted(() => ({
    mockGetNote: vi.fn(),
    mockGetNotePayload: vi.fn(),
    mockUpdateNote: vi.fn(),
    mockCreateNote: vi.fn(),
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        getNote = mockGetNote;
        getNotePayload = mockGetNotePayload;
        updateNote = mockUpdateNote;
        createNote = mockCreateNote;
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

const HOST = 'sam.dotyou.cloud';
const DOC_ID = '11111111-1111-1111-1111-111111111111';

const fakeDotYouClient = { getHostIdentity: () => HOST } as unknown as DotYouClient;
const fakeOnline = { isOnline: true } as unknown as OnlineContextType;

const VALID_KEY_HEADER = serializeKeyHeader(
    { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' } as unknown as EncryptedKeyHeader,
);

function textUpdate(text: string): Uint8Array {
    const d = new Y.Doc();
    d.getText('body').insert(0, text);
    const u = Y.encodeStateAsUpdate(d);
    d.destroy();
    return u;
}
function bodyOf(blob: Uint8Array): string {
    const d = new Y.Doc();
    Y.applyUpdate(d, blob);
    const s = d.getText('body').toString();
    d.destroy();
    return s;
}
/** Reproduce exactly the single blob pushNote builds by merging stored updates. */
function mergeBlob(updates: Uint8Array[]): Uint8Array {
    const d = new Y.Doc();
    for (const u of updates) Y.applyUpdate(d, u);
    const blob = Y.encodeStateAsUpdate(d);
    d.destroy();
    return blob;
}

const META = (extra: Partial<DocumentMetadata> = {}): DocumentMetadata =>
    ({ title: 'Note', folderId: 'main', tags: [], ...extra } as DocumentMetadata);

async function seedNote(opts: {
    updates: Uint8Array[];
    plainText: string;
    metadata: DocumentMetadata;
    record: Partial<SyncRecord>;
}) {
    for (const u of opts.updates) await saveDocumentUpdate(DOC_ID, u);
    await upsertSearchIndex({ docId: DOC_ID, title: opts.metadata.title, plainTextContent: opts.plainText, metadata: opts.metadata });
    await upsertSyncRecord({
        localId: DOC_ID, entityType: 'note', lastSyncedAt: new Date().toISOString(),
        syncStatus: 'pending', ...opts.record,
    } as SyncRecord);
}

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    // @ts-expect-error test-only setter
    pgliteModule.setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

describe('SyncService.pushNote', () => {
    let svc: SyncService;
    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        svc = new SyncService(fakeDotYouClient, fakeOnline);
    });

    it('uploads the merged Yjs blob and records the returned versionTag when content changed', async () => {
        const updates = [textUpdate('Hello'), textUpdate('World')];
        await seedNote({
            updates, plainText: 'HelloWorld', metadata: META(),
            record: { remoteFileId: 'file-1', versionTag: 'v1', contentHash: 'stale', encryptedKeyHeader: VALID_KEY_HEADER },
        });
        mockUpdateNote.mockResolvedValue({ versionTag: 'v2' });

        const record = await getSyncRecord(DOC_ID);
        await svc.pushNote(record!);

        expect(mockUpdateNote).toHaveBeenCalledTimes(1);
        expect(mockGetNote).not.toHaveBeenCalled(); // cached key header is valid
        const blob = mockUpdateNote.mock.calls[0][6] as Uint8Array;
        expect(bodyOf(blob)).toContain('Hello');
        expect(bodyOf(blob)).toContain('World');

        const after = await getSyncRecord(DOC_ID);
        expect(after?.versionTag).toBe('v2');
        expect(after?.syncStatus).toBe('synced');
    });

    it('skips the network and marks synced when the content hash is unchanged', async () => {
        const updates = [textUpdate('unchanged content')];
        const metadata = META();
        const currentHash = await computeContentHash(metadata, mergeBlob(updates));
        await seedNote({
            updates, plainText: 'unchanged content', metadata,
            record: { remoteFileId: 'file-1', versionTag: 'v1', contentHash: currentHash, encryptedKeyHeader: VALID_KEY_HEADER },
        });

        const record = await getSyncRecord(DOC_ID);
        await svc.pushNote(record!);

        expect(mockUpdateNote).not.toHaveBeenCalled();
        expect(mockCreateNote).not.toHaveBeenCalled();
        expect((await getSyncRecord(DOC_ID))?.syncStatus).toBe('synced');
    });

    it('sends an EMPTY doc blob when plain text is empty even though updates exist', async () => {
        // Pins BUG-01 (current behavior). Plan 003 will flip this to upload the merged blob —
        // that plan updates this assertion.
        const updates = [textUpdate('this real content is thrown away')];
        await seedNote({
            updates, plainText: '', metadata: META(),
            record: { remoteFileId: 'file-1', versionTag: 'v1', contentHash: 'stale', encryptedKeyHeader: VALID_KEY_HEADER },
        });
        mockUpdateNote.mockResolvedValue({ versionTag: 'v2' });

        const record = await getSyncRecord(DOC_ID);
        await svc.pushNote(record!);

        expect(mockUpdateNote).toHaveBeenCalledTimes(1);
        const blob = mockUpdateNote.mock.calls[0][6] as Uint8Array;
        expect(blob.byteLength).toBe(2); // fresh empty Y.Doc encodes to [0, 0]
        expect(bodyOf(blob)).toBe('');
    });

    it('re-fetches, merges and re-uploads on a version conflict, then marks synced with the merged hash', async () => {
        const localUpdates = [textUpdate('Local')];
        const metadata = META();
        await seedNote({
            updates: localUpdates, plainText: 'Local', metadata,
            record: { remoteFileId: 'file-1', versionTag: 'v1', contentHash: 'stale', encryptedKeyHeader: VALID_KEY_HEADER },
        });
        mockGetNote.mockResolvedValue({
            fileId: 'fresh-file-1',
            sharedSecretEncryptedKeyHeader: { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' },
            fileMetadata: { versionTag: 'v-remote', updated: 1700000002000, globalTransitId: 'g2' },
        });
        mockGetNotePayload.mockResolvedValue(textUpdate('Remote'));
        // First (outer) call triggers the conflict callback; the inner retry returns the final tag.
        mockUpdateNote.mockImplementation(async (...args: unknown[]) => {
            const options = args[8] as { onVersionConflict?: () => Promise<unknown> } | undefined;
            if (options?.onVersionConflict) return await options.onVersionConflict();
            return { versionTag: 'v-merged' };
        });

        const record = await getSyncRecord(DOC_ID);
        await svc.pushNote(record!);

        expect(mockGetNote).toHaveBeenCalledTimes(1); // re-fetch of the fresh remote header
        expect(mockGetNote.mock.calls[0][2]).toEqual({ decrypt: false });
        expect(mockGetNotePayload).toHaveBeenCalledTimes(1);
        expect(mockUpdateNote).toHaveBeenCalledTimes(2); // outer + inner retry

        const mergedBlob = mockUpdateNote.mock.calls[1][6] as Uint8Array;
        expect(bodyOf(mergedBlob)).toContain('Local');
        expect(bodyOf(mergedBlob)).toContain('Remote');

        // Local store now holds the merged blob.
        const stored = await getDocumentUpdates(DOC_ID);
        expect(stored.length).toBe(1);
        expect(bodyOf(stored[0])).toContain('Local');
        expect(bodyOf(stored[0])).toContain('Remote');

        const after = await getSyncRecord(DOC_ID);
        expect(after?.versionTag).toBe('v-merged');
        expect(after?.syncStatus).toBe('synced');
        expect(after?.contentHash).toBe(await computeContentHash(metadata, mergedBlob));
    });

    it('marks a metadata-only pin toggle as synced WITHOUT uploading', async () => {
        // Pins BUG-06 (current behavior). computeContentHash ignores isPinned, so toggling the
        // pin leaves the hash unchanged and pushNote takes the skip-upload path. Plan 003 flips
        // this so metadata-only changes still sync — that plan updates this assertion.
        const updates = [textUpdate('body text')];
        // Stored hash reflects the pre-toggle content (isPinned: false); note is now pinned.
        const storedHash = await computeContentHash(META({ isPinned: false }), mergeBlob(updates));
        await seedNote({
            updates, plainText: 'body text', metadata: META({ isPinned: true }),
            record: { remoteFileId: 'file-1', versionTag: 'v1', contentHash: storedHash, encryptedKeyHeader: VALID_KEY_HEADER },
        });

        const record = await getSyncRecord(DOC_ID);
        await svc.pushNote(record!);

        expect(mockUpdateNote).not.toHaveBeenCalled();
        expect(mockCreateNote).not.toHaveBeenCalled();
        expect((await getSyncRecord(DOC_ID))?.syncStatus).toBe('synced');
    });
});
