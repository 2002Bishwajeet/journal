/**
 * getRecipientsOfOwnNotes decides who stays in Journal's share circle (#730): everyone
 * the host's own collaborative notes are shared with, never people on notes shared with the host.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { getRecipientsOfOwnNotes, upsertSearchIndex, upsertSyncRecord } from '@/lib/db/queries';
import type { DocumentMetadata } from '@/types';

const HOST = 'me.id';
const uuid = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, '0')}`;
const ID = {
    mine: uuid(1), mineTrashed: uuid(2), unshared: uuid(3), empty: uuid(4), theirs: uuid(5), theirsByRecord: uuid(6),
};

beforeAll(async () => { setTestDb(await createTestDatabase()); });
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

const save = (docId: string, metadata: Partial<DocumentMetadata>) =>
    upsertSearchIndex({
        docId,
        title: docId,
        plainTextContent: '',
        metadata: {
            title: docId,
            folderId: 'collab',
            excludeFromAI: false,
            timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
            ...metadata,
        },
    });

describe('getRecipientsOfOwnNotes', () => {
    it("returns the recipients of the host's collaborative notes once each, archived and trashed included", async () => {
        await save(ID.mine, { isCollaborative: true, recipients: ['a.id', 'b.id'] });
        await save(ID.mineTrashed, { isCollaborative: true, recipients: ['b.id', 'c.id'], archivalStatus: 2, authorOdinId: HOST });
        await save(ID.unshared, { isCollaborative: false, recipients: ['d.id'] });
        await save(ID.empty, { isCollaborative: true });

        expect((await getRecipientsOfOwnNotes(HOST)).sort()).toEqual(['a.id', 'b.id', 'c.id']);
    });

    it('leaves out notes other people shared with the host', async () => {
        await save(ID.theirs, { isCollaborative: true, recipients: ['e.id'], authorOdinId: 'frodo.id' });
        await save(ID.theirsByRecord, { isCollaborative: true, recipients: ['f.id'] });
        await upsertSyncRecord({
            localId: ID.theirsByRecord, entityType: 'note', syncStatus: 'synced', authorOdinId: 'frodo.id',
        });

        expect(await getRecipientsOfOwnNotes(HOST)).toEqual([]);
    });

    // #897: who stays in the viewers' circle
    it("returns the viewers of the host's notes with 'odinIds', apart from the editors", async () => {
        await save(ID.mine, { isCollaborative: true, recipients: ['a.id'], odinIds: ['sam.id'] });
        await save(ID.mineTrashed, { isCollaborative: true, odinIds: ['sam.id', 'pip.id'], archivalStatus: 2 });
        await save(ID.theirs, { isCollaborative: true, odinIds: ['e.id'], authorOdinId: 'frodo.id' });

        expect((await getRecipientsOfOwnNotes(HOST, 'odinIds')).sort()).toEqual(['pip.id', 'sam.id']);
        expect(await getRecipientsOfOwnNotes(HOST)).toEqual(['a.id']);
    });
});
