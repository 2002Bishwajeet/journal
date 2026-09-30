import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import {
    saveSnapshot,
    getSnapshots,
    getSnapshotBlob,
    getLatestSnapshotVector,
    deleteSnapshots,
} from '@/lib/db';

const DOC_A = '20000000-0000-0000-0000-00000000000a';
const DOC_B = '20000000-0000-0000-0000-00000000000b';

function snapshot(n: number) {
    return {
        stateBlob: new Uint8Array([n, n, n]),
        stateVector: new Uint8Array([n]),
        preview: `preview ${n}`,
        wordCount: n,
    };
}

/** Pin a snapshot's created_at so ordering doesn't depend on insert timing. */
async function setCreatedAt(id: number, iso: string) {
    await db.query('UPDATE document_snapshots SET created_at = $1 WHERE id = $2', [iso, id]);
}

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

describe('snapshot queries', () => {
    it('saves a snapshot and lists its metadata without any blob', async () => {
        await saveSnapshot(DOC_A, snapshot(3));

        const snaps = await getSnapshots(DOC_A);

        expect(snaps).toHaveLength(1);
        expect(Object.keys(snaps[0]).sort()).toEqual(['createdAt', 'id', 'preview', 'wordCount']);
        expect(snaps[0]).toMatchObject({ preview: 'preview 3', wordCount: 3 });
        expect(snaps[0].createdAt).toBeInstanceOf(Date);
    });

    it('lists only the given note, newest first', async () => {
        await saveSnapshot(DOC_A, snapshot(1));
        await saveSnapshot(DOC_A, snapshot(2));
        await saveSnapshot(DOC_A, snapshot(3));
        await saveSnapshot(DOC_B, snapshot(9));
        const [s1, s2, s3] = (await getSnapshots(DOC_A)).sort((a, b) => a.wordCount - b.wordCount);
        await setCreatedAt(s1.id, '2026-01-02T00:00:00Z');
        await setCreatedAt(s2.id, '2026-01-03T00:00:00Z');
        await setCreatedAt(s3.id, '2026-01-01T00:00:00Z');

        const snaps = await getSnapshots(DOC_A);

        expect(snaps.map((s) => s.wordCount)).toEqual([2, 1, 3]);
    });

    it('returns a snapshot blob by id, or null when it is gone', async () => {
        await saveSnapshot(DOC_A, snapshot(7));
        const [{ id }] = await getSnapshots(DOC_A);

        expect(Array.from((await getSnapshotBlob(id))!)).toEqual([7, 7, 7]);
        expect(await getSnapshotBlob(id + 1000)).toBeNull();
    });

    it('returns the newest snapshot state vector for a note', async () => {
        expect(await getLatestSnapshotVector(DOC_A)).toBeNull();

        await saveSnapshot(DOC_A, snapshot(1));
        await saveSnapshot(DOC_A, snapshot(2));
        const [newer, older] = await getSnapshots(DOC_A);
        await setCreatedAt(older.id, '2026-01-01T00:00:00Z');
        await setCreatedAt(newer.id, '2026-01-02T00:00:00Z');

        const latest = await getLatestSnapshotVector(DOC_A);
        expect(Array.from(latest!.stateVector)).toEqual([newer.wordCount]);
        expect(latest!.createdAt.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    });

    it('deletes snapshots by id', async () => {
        await saveSnapshot(DOC_A, snapshot(1));
        await saveSnapshot(DOC_A, snapshot(2));
        await saveSnapshot(DOC_A, snapshot(3));
        const snaps = await getSnapshots(DOC_A);
        const byWords = (n: number) => snaps.find((s) => s.wordCount === n)!.id;

        await deleteSnapshots([byWords(1), byWords(3)]);
        await deleteSnapshots([]);

        expect((await getSnapshots(DOC_A)).map((s) => s.wordCount)).toEqual([2]);
    });
});
