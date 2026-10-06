/**
 * Measurement behind #103's VACUUM decision. Repeated Yjs compaction (delete
 * rows + insert one blob, as replaceDocumentUpdates does) with incompressible
 * blobs, the worst case for TOAST, grows document_updates ~28x over 30 rounds
 * (1.1 MB -> 31 MB for 20 live docs) because nothing reclaims the dead tuples.
 * A plain VACUUM does not shrink the file, but it makes the dead space reusable,
 * so growth stops. That is why src/lib/db/vacuum.ts exists.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase } from './testDb';
import { measureDatabaseSize } from '@/lib/db/dbStats';

let db: PGlite;
beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await closeTestDatabase(); });

const DOCS = 20;
const ROUNDS = 30;

function randomBlob(size: number, seed: number): Uint8Array {
    const out = new Uint8Array(size);
    let x = seed;
    for (let i = 0; i < size; i++) {
        x = (x * 1664525 + 1013904223) >>> 0;
        out[i] = x >>> 24;
    }
    return out;
}

async function compactAll(round: number) {
    for (let d = 0; d < DOCS; d++) {
        const id = `00000000-0000-0000-0000-${String(d).padStart(12, '0')}`;
        await db.query(
            `WITH del AS (DELETE FROM document_updates WHERE doc_id = $1)
             INSERT INTO document_updates (doc_id, update_blob) VALUES ($1, $2)`,
            [id, randomBlob(48_000, round * 1000 + d)],
        );
    }
}

async function documentUpdatesBytes(): Promise<number> {
    const { tables } = await measureDatabaseSize(db, 20);
    return tables.find((t) => t.name === 'document_updates')!.totalBytes;
}

describe('dead-tuple bloat from repeated Yjs compaction', () => {
    it('grows without VACUUM, and a plain VACUUM stops the growth', async () => {
        await compactAll(0);
        const afterFirstRound = await documentUpdatesBytes();

        for (let r = 1; r <= ROUNDS; r++) await compactAll(r);
        const afterManyRounds = await documentUpdatesBytes();
        expect(afterManyRounds).toBeGreaterThan(afterFirstRound * 3);

        await db.exec('VACUUM');
        const afterVacuum = await documentUpdatesBytes();
        for (let r = 100; r < 110; r++) await compactAll(r);
        const afterMore = await documentUpdatesBytes();
        expect(afterMore).toBeLessThan(afterVacuum * 1.2);
    });
});
