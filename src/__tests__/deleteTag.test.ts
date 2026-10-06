/**
 * #458: deleting a tag from the sidebar removes it from every note that has it
 * (trashed and archived included) and marks each changed note pending, so the
 * normal push uploads the new tags.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    upsertSearchIndex, upsertSyncRecord, getSyncRecord, getSearchIndexEntry,
    deleteTagFromAllNotes, TAGS_SQL,
} from '@/lib/db/queries';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const ACTIVE = 'cccccccc-0000-0000-0000-000000000001';
const ARCHIVED = 'cccccccc-0000-0000-0000-000000000002';
const TRASHED = 'cccccccc-0000-0000-0000-000000000003';
const UNTAGGED = 'cccccccc-0000-0000-0000-000000000004';
const MODIFIED = '2026-01-01T00:00:00.000Z';

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

async function addNote(docId: string, tags: string[], archivalStatus = 0) {
    await upsertSearchIndex({
        docId,
        title: docId,
        plainTextContent: '',
        metadata: {
            title: docId, folderId: 'main', tags, excludeFromAI: false, archivalStatus,
            timestamps: { created: MODIFIED, modified: MODIFIED },
        },
    });
    await upsertSyncRecord({ localId: docId, entityType: 'note', syncStatus: 'synced', remoteFileId: `rf-${docId}` });
}

async function seed() {
    await addNote(ACTIVE, ['a', 'x', 'b']);
    await addNote(ARCHIVED, ['x'], 1);
    await addNote(TRASHED, ['x', 'c'], 2);
    await addNote(UNTAGGED, ['a']);
}

async function tagsOf(docId: string) {
    return (await getSearchIndexEntry(docId))?.metadata.tags;
}

describe('deleteTagFromAllNotes', () => {
    it('removes the tag from every note, archived and trashed included, keeping other tags in order', async () => {
        await seed();

        const changed = await deleteTagFromAllNotes('x');

        expect(changed.sort()).toEqual([ACTIVE, ARCHIVED, TRASHED]);
        expect(await tagsOf(ACTIVE)).toEqual(['a', 'b']);
        expect(await tagsOf(ARCHIVED)).toEqual([]);
        expect(await tagsOf(TRASHED)).toEqual(['c']);
        expect(await tagsOf(UNTAGGED)).toEqual(['a']);
    });

    it('marks each changed note pending (bumping dirty_generation) and leaves others synced', async () => {
        await seed();

        await deleteTagFromAllNotes('x');

        for (const id of [ACTIVE, ARCHIVED, TRASHED]) {
            const record = await getSyncRecord(id);
            expect(record?.syncStatus).toBe('pending');
            expect(record?.dirtyGeneration).toBe(1);
        }
        expect((await getSyncRecord(UNTAGGED))?.syncStatus).toBe('synced');
    });

    it('keeps the rest of the metadata, including the modified timestamp', async () => {
        await seed();

        await deleteTagFromAllNotes('x');

        const entry = await getSearchIndexEntry(TRASHED);
        expect(entry?.metadata.archivalStatus).toBe(2);
        expect(entry?.metadata.timestamps.modified).toBe(MODIFIED);
    });

    it('is a no-op for an unknown tag', async () => {
        await seed();

        expect(await deleteTagFromAllNotes('nope')).toEqual([]);

        expect(await tagsOf(ACTIVE)).toEqual(['a', 'x', 'b']);
        for (const id of [ACTIVE, ARCHIVED, TRASHED, UNTAGGED]) {
            expect((await getSyncRecord(id))?.syncStatus).toBe('synced');
        }
    });

    it('drops the tag from the sidebar tag list and its counts', async () => {
        await seed();
        const tagList = async () => (await db.query<{ tag: string; count: number }>(TAGS_SQL)).rows;

        expect(await tagList()).toEqual([
            { tag: 'a', count: 2 }, { tag: 'b', count: 1 }, { tag: 'c', count: 1 }, { tag: 'x', count: 3 },
        ]);

        await deleteTagFromAllNotes('x');

        expect(await tagList()).toEqual([
            { tag: 'a', count: 2 }, { tag: 'b', count: 1 }, { tag: 'c', count: 1 },
        ]);
    });
});
