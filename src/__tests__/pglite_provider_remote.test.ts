import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as Y from 'yjs';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

// Real DB, mocked at the pglite singleton boundary — same pattern as pglite_provider.test.ts.
vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { saveDocumentUpdate, getDocumentUpdates } from '@/lib/db';
import { PGliteProvider } from '@/lib/yjs/provider';
import { documentBroadcast } from '@/lib/broadcast';

/**
 * A note kept open while others write to it (#1487): the in-app agent, image uploads and
 * other tabs append a row and announce it. Each announcement is read once, and the rows a
 * reload replays stay bounded however many arrive.
 */
const DOC_ID = '33333333-3333-3333-3333-333333333333';
const REMOTE_UPDATES = 120;

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

const THRESHOLD = 50; // PGliteProvider.COMPACTION_THRESHOLD

async function rowCount(): Promise<number> {
    const result = await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM document_updates WHERE doc_id = $1',
        [DOC_ID],
    );
    return result.rows[0].n;
}

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
    const start = Date.now();
    while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

/** Counts the reads of a note's rows until restore() is called. */
function countReads() {
    const orig = db.query.bind(db);
    const counts = { reads: 0, restore: () => { db.query = orig; } };
    db.query = ((sql: string, params?: unknown[]) => {
        if (/^\s*SELECT update_blob FROM document_updates/i.test(sql)) counts.reads++;
        return orig(sql, params);
    }) as typeof db.query;
    return counts;
}

describe('PGliteProvider remote updates', () => {
    it('reads each announced update once and keeps the stored rows bounded', async () => {
        const doc = new Y.Doc();
        const provider = new PGliteProvider(DOC_ID, doc);
        await provider.load();

        const writer = new Y.Doc();
        const text = writer.getText('body');
        const reads = countReads();
        try {
            for (let i = 0; i < REMOTE_UPDATES; i++) {
                const before = Y.encodeStateVector(writer);
                text.insert(text.length, `${i};`);
                await saveDocumentUpdate(DOC_ID, Y.encodeStateAsUpdate(writer, before));
                documentBroadcast.notifyDocumentUpdated(DOC_ID);
                await waitFor(() => doc.getText('body').toString() === text.toString());
                // The reload that reaches the threshold compacts once it has applied the rows.
                const start = Date.now();
                while (await rowCount() >= THRESHOLD && Date.now() - start < 5000) await new Promise((r) => setTimeout(r, 5));
                expect(await rowCount()).toBeLessThan(THRESHOLD);
            }
            // One read per announcement (a compaction reads the rows with a query of its own).
            expect(reads.reads).toBe(REMOTE_UPDATES);
        } finally {
            reads.restore();
        }

        expect(doc.getText('body').toString()).toBe(text.toString());
        await provider.destroy();
        const stored = new Y.Doc();
        for (const row of await getDocumentUpdates(DOC_ID)) Y.applyUpdate(stored, row);
        expect(stored.getText('body').toString()).toBe(text.toString());
        doc.destroy();
        writer.destroy();
        stored.destroy();
    });
});
