/**
 * #746: a collaborator's edit pushes the note owner, at most once per note per 15 minutes.
 * Provider part: the update options. Sync part: the throttle. The click route is in swPush.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as Y from 'yjs';
import type { EncryptedKeyHeader } from '@homebase-id/js-lib/core';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { saveDocumentUpdate, getSyncRecord, upsertSyncRecord, upsertSearchIndex } from '@/lib/db/queries';
import { serializeKeyHeader } from '@/lib/utils';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';
import { JOURNAL_APP_ID, JOURNAL_PUSH_TYPE_EDIT } from '@/lib/homebase/config';
import type { DocumentMetadata, SyncRecord } from '@/types';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockPatch, mockUpdateNote } = vi.hoisted(() => ({ mockPatch: vi.fn(), mockUpdateNote: vi.fn() }));

vi.mock('@homebase-id/js-lib/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/core')>()),
    patchFile: mockPatch,
}));
// SyncService gets a provider whose updateNote is a spy; the real class stays reachable for the provider tests
vi.mock('@/lib/homebase/NotesDriveProvider', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/homebase/NotesDriveProvider')>();
    return {
        NotesDriveProvider: class extends actual.NotesDriveProvider {
            override updateNote = mockUpdateNote;
        },
        RealNotesDriveProvider: actual.NotesDriveProvider,
    };
});
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({ FolderDriveProvider: class { constructor() {} } }));
vi.mock('@/lib/homebase/InboxProcessor', () => ({ InboxProcessor: class { constructor() {} } }));

import { SyncService } from '@/lib/homebase/SyncService';
import * as providerModule from '@/lib/homebase/NotesDriveProvider';

const HOST = 'owner.dotyou.cloud';
const PEER = 'sam.dotyou.cloud';
const META = { title: 'Secret title', folderId: 'main', tags: [] } as unknown as DocumentMetadata;
const KEY_HEADER = serializeKeyHeader(
    { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' } as unknown as EncryptedKeyHeader,
);

describe('NotesDriveProvider.updateNote edit push', () => {
    const Real = (providerModule as unknown as { RealNotesDriveProvider: typeof providerModule.NotesDriveProvider }).RealNotesDriveProvider;
    const update = async (author: string, notifyOwner?: boolean) => {
        mockPatch.mockReset();
        mockPatch.mockResolvedValue({ newVersionTag: 'v2' });
        await new Real(fakeDotYouClient(HOST)).updateNote(
            'note-1', 'file-1', 'v1', META, author, 'gt-1', undefined, undefined, { notifyOwner },
        );
        return mockPatch.mock.calls[0][2];
    };

    it('attaches the push options to a peer update with notifyOwner, without the title', async () => {
        const instructions = await update(PEER, true);
        expect(instructions.locale).toBe('peer');
        expect(instructions.useAppNotification).toBe(true);
        expect(instructions.appNotificationOptions).toEqual({
            appId: JOURNAL_APP_ID,
            typeId: JOURNAL_PUSH_TYPE_EDIT,
            tagId: 'note-1',
            silent: false,
            unEncryptedMessage: 'Edited a shared note',
            collapseId: 'note-1',
        });
        expect(JSON.stringify(instructions.appNotificationOptions)).not.toContain('Secret title');
    });

    it('attaches nothing to a peer update without notifyOwner', async () => {
        const instructions = await update(PEER);
        expect(instructions.useAppNotification).toBeUndefined();
        expect(instructions.appNotificationOptions).toBeUndefined();
    });

    it('never attaches options to a local update, even with notifyOwner', async () => {
        const instructions = await update(HOST, true);
        expect(instructions.locale).toBe('local');
        expect(instructions.appNotificationOptions).toBeUndefined();
    });
});

describe('pushNote edit push throttle', () => {
    let db: PGlite;
    beforeAll(async () => {
        db = await createTestDatabase();
        setTestDb(db);
    });
    afterAll(async () => { await closeTestDatabase(); });

    let svc: SyncService;
    let now: number;
    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        mockUpdateNote.mockResolvedValue({ versionTag: 'v2' });
        now = 1_000_000_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        svc = new SyncService(fakeDotYouClient(HOST), fakeOnlineContext());
    });
    afterEach(() => { vi.restoreAllMocks(); });

    async function edit(id: string, text: string, authorOdinId: string | undefined) {
        const d = new Y.Doc();
        d.getText('body').insert(0, text);
        await saveDocumentUpdate(id, Y.encodeStateAsUpdate(d));
        d.destroy();
        await upsertSearchIndex({ docId: id, title: 'Note', plainTextContent: text, metadata: META });
        await upsertSyncRecord({
            localId: id, entityType: 'note', lastSyncedAt: new Date().toISOString(), syncStatus: 'pending',
            remoteFileId: 'file-' + id, versionTag: 'v1', contentHash: 'stale', encryptedKeyHeader: KEY_HEADER,
            authorOdinId, globalTransitId: authorOdinId ? 'gt-' + id : undefined,
        } as SyncRecord);
        await svc.pushNote((await getSyncRecord(id))!);
        return (mockUpdateNote.mock.calls.at(-1)![8] as { notifyOwner?: boolean }).notifyOwner;
    }

    it('notifies once per note in 15 minutes, again after, and once per other note', async () => {
        expect(await edit('aaaaaaaa-0000-0000-0000-000000000001', 'one', PEER)).toBe(true);
        now += 60_000;
        expect(await edit('aaaaaaaa-0000-0000-0000-000000000001', 'two', PEER)).toBe(false);
        expect(await edit('aaaaaaaa-0000-0000-0000-000000000002', 'one', PEER)).toBe(true);
        now += 15 * 60_000;
        expect(await edit('aaaaaaaa-0000-0000-0000-000000000001', 'three', PEER)).toBe(true);
    });

    it('does not notify when the note author is the host', async () => {
        expect(await edit('aaaaaaaa-0000-0000-0000-000000000003', 'one', HOST)).toBe(false);
        expect(await edit('aaaaaaaa-0000-0000-0000-000000000004', 'one', undefined)).toBe(false);
    });
});
