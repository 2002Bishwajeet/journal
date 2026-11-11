import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { getSnapshots, upsertSearchIndex } from '@/lib/db';
import { runDailySnapshotPrune } from '@/lib/history/dailyPrune';

const DOC_A = '30000000-0000-0000-0000-00000000000a';
const DOC_B = '30000000-0000-0000-0000-00000000000b';
const DAY = 86_400_000;
// A Wednesday
const NOW = new Date('2026-06-17T12:00:00Z');

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

async function addSnapshot(docId: string, createdAt: Date, bytes = 3) {
    await db.query(
        `INSERT INTO document_snapshots (doc_id, state_blob, state_vector, preview, word_count, created_at)
         VALUES ($1, $2, $3, '', 0, $4)`,
        [docId, new Uint8Array(bytes), new Uint8Array([1]), createdAt],
    );
}

/** Three snapshots on one day, `daysAgo` days before `now` */
async function addBusyDay(docId: string, daysAgo: number, now = NOW) {
    for (const hour of [1, 2, 3]) await addSnapshot(docId, new Date(now.getTime() - daysAgo * DAY + hour * 3_600_000));
}

async function jobRows() {
    const result = await db.query<{ status: string; processed_at: Date | null }>(
        `SELECT status, processed_at FROM job_queue WHERE job_type = 'snapshot-prune'`,
    );
    return result.rows;
}

describe('runDailySnapshotPrune', () => {
    it('prunes every note as of now, including notes not edited since', async () => {
        // Both notes were last edited on these days, when each day's three snapshots were all under 24 h old
        await addBusyDay(DOC_A, 5);
        await addBusyDay(DOC_B, 10);

        await runDailySnapshotPrune(NOW);

        expect(await getSnapshots(DOC_A)).toHaveLength(1);
        expect(await getSnapshots(DOC_B)).toHaveLength(1);
        expect(await jobRows()).toEqual([{ status: 'done', processed_at: expect.any(Date) }]);
    });

    it('applies the byte budget to old notes', async () => {
        // An hour-old 100 KB snapshot, then one 100 KB snapshot a week from 5 weeks back
        await addSnapshot(DOC_A, new Date(NOW.getTime() - 3_600_000), 100 * 1024);
        for (let week = 5; week < 25; week++) await addSnapshot(DOC_A, new Date(NOW.getTime() - week * 7 * DAY), 100 * 1024);

        await runDailySnapshotPrune(NOW);

        expect(await getSnapshots(DOC_A)).toHaveLength(3);
    });

    it('runs at most once a day, across calls', async () => {
        await runDailySnapshotPrune(NOW);
        await addBusyDay(DOC_A, 5);

        // Claimed 23 hours ago: nothing happens
        await runDailySnapshotPrune(new Date(NOW.getTime() + 23 * 3_600_000));
        expect(await getSnapshots(DOC_A)).toHaveLength(3);

        // A day later it runs again, and the old run's row goes
        await runDailySnapshotPrune(new Date(NOW.getTime() + DAY + 1));
        expect(await getSnapshots(DOC_A)).toHaveLength(1);
        expect(await jobRows()).toHaveLength(1);
    });

    it('two passes started together run once', async () => {
        await addBusyDay(DOC_A, 5);

        await Promise.all([runDailySnapshotPrune(NOW), runDailySnapshotPrune(NOW)]);

        expect(await getSnapshots(DOC_A)).toHaveLength(1);
        expect(await jobRows()).toHaveLength(1);
    });

    it('rewrites the table when it drops a quarter of the history or more, else only frees the space', async () => {
        const relfilenode = async () =>
            (await db.query<{ relfilenode: number }>(`SELECT relfilenode FROM pg_class WHERE relname = 'document_snapshots'`)).rows[0].relfilenode;
        // Two of three equal snapshots go: VACUUM FULL, so the table gets a new file
        await addBusyDay(DOC_A, 5);
        const before = await relfilenode();
        await runDailySnapshotPrune(NOW);
        expect(await relfilenode()).not.toBe(before);

        // A day later, two 3-byte snapshots go next to ten 1 KB ones: a plain VACUUM keeps the file
        const later = new Date(NOW.getTime() + DAY + 1);
        for (let day = 2; day < 12; day++) await addSnapshot(DOC_B, new Date(later.getTime() - day * DAY), 1024);
        await addBusyDay(DOC_B, 15, later);
        const kept = await relfilenode();
        await runDailySnapshotPrune(later);
        expect(await getSnapshots(DOC_B)).toHaveLength(11);
        expect(await relfilenode()).toBe(kept);
    });

    it('drops all history of a note trashed elsewhere, and counts it as pruned', async () => {
        // Arrived by sync already in Trash: setNoteArchivalStatusLocal never ran here
        const now = NOW.toISOString();
        await upsertSearchIndex({
            docId: DOC_A,
            title: 'Trashed',
            plainTextContent: '',
            metadata: { title: 'Trashed', folderId: 'main', timestamps: { created: now, modified: now }, excludeFromAI: false, archivalStatus: 2 },
        });
        await addSnapshot(DOC_A, new Date(NOW.getTime() - 3_600_000));
        await addSnapshot(DOC_B, new Date(NOW.getTime() - 3_600_000));
        const relfilenode = async () =>
            (await db.query<{ relfilenode: number }>(`SELECT relfilenode FROM pg_class WHERE relname = 'document_snapshots'`)).rows[0].relfilenode;
        const before = await relfilenode();

        await runDailySnapshotPrune(NOW);

        expect(await getSnapshots(DOC_A)).toHaveLength(0);
        expect(await getSnapshots(DOC_B)).toHaveLength(1);
        // Half the bytes went, so the table was rewritten
        expect(await relfilenode()).not.toBe(before);
    });
});
