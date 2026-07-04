import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import * as Y from 'yjs';

// Real DB, mocked at the pglite singleton boundary — same pattern as peer_note_fetch.test.ts.
vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';

// saveDocumentUpdate wrapper with a controllable delay so we can interleave updates
// and pin the stranded-update gap (see the last test). Delay defaults to 0, so every
// other test uses the real, un-delayed persistence path.
const saveControl = { delayMs: 0 };
vi.mock('@/lib/db', async (importActual) => {
    const actual = await importActual<typeof import('@/lib/db')>();
    return {
        ...actual,
        saveDocumentUpdate: async (docId: string, blob: Uint8Array) => {
            if (saveControl.delayMs > 0) await new Promise(r => setTimeout(r, saveControl.delayMs));
            return actual.saveDocumentUpdate(docId, blob);
        },
    };
});
import { saveDocumentUpdate, getDocumentUpdates } from '@/lib/db';
import { PGliteProvider } from '@/lib/yjs/provider';

const DOC_ID = '11111111-1111-1111-1111-111111111111';

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    // @ts-expect-error test-only setter
    pgliteModule.setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => {
    await resetTestDatabase();
    saveControl.delayMs = 0;
    vi.clearAllMocks();
});

/** Author N incremental Yjs updates by editing a single Y.Text in N transactions. */
function authorUpdates(texts: string[]): { updates: Uint8Array[]; fullText: string } {
    const d = new Y.Doc();
    const updates: Uint8Array[] = [];
    d.on('update', (u: Uint8Array) => updates.push(u));
    let pos = 0;
    for (const t of texts) { d.getText('body').insert(pos, t); pos += t.length; }
    const fullText = d.getText('body').toString();
    d.destroy();
    return { updates, fullText };
}

function bodyOf(blob: Uint8Array): string {
    const d = new Y.Doc();
    Y.applyUpdate(d, blob);
    const s = d.getText('body').toString();
    d.destroy();
    return s;
}

async function docRowCount(docId: string): Promise<number> {
    const r = await db.query<{ c: number }>(
        'SELECT COUNT(*)::int as c FROM document_updates WHERE doc_id = $1', [docId]);
    return r.rows[0].c;
}

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

describe('PGliteProvider.load', () => {
    it('restores full document state from N stored updates', async () => {
        const { updates, fullText } = authorUpdates(['One', 'Two', 'Three']);
        for (const u of updates) await saveDocumentUpdate(DOC_ID, u);

        const doc = new Y.Doc();
        const provider = new PGliteProvider(DOC_ID, doc);
        await provider.load();

        expect(doc.getText('body').toString()).toBe(fullText);
        expect(fullText).toBe('OneTwoThree');

        // Reload into a second, independent doc and confirm identical state vectors.
        await tick();
        const stored = await getDocumentUpdates(DOC_ID);
        const doc2 = new Y.Doc();
        for (const u of stored) Y.applyUpdate(doc2, u);
        expect(doc2.getText('body').toString()).toBe(fullText);
    });
});

describe('PGliteProvider.compact', () => {
    it('round-trips content byte-for-byte through a compact() (5 updates -> 1 blob)', async () => {
        const { updates, fullText } = authorUpdates(['Alpha', 'Beta', 'Gamma', 'Delta', 'Eps']);
        for (const u of updates) await saveDocumentUpdate(DOC_ID, u);

        const doc = new Y.Doc();
        const provider = new PGliteProvider(DOC_ID, doc);
        await provider.load();
        await tick(); // let the load-time re-save microtask settle first
        await provider.compact();

        expect(await docRowCount(DOC_ID)).toBe(1);

        const stored = await getDocumentUpdates(DOC_ID);
        expect(stored.length).toBe(1);
        expect(bodyOf(stored[0])).toBe(fullText);

        // Compacted blob is byte-identical to a fresh full-state encoding of the same content.
        const ref = new Y.Doc();
        for (const u of updates) Y.applyUpdate(ref, u);
        const refFull = Y.encodeStateAsUpdate(ref);
        ref.destroy();
        expect(Buffer.from(stored[0]).equals(Buffer.from(refFull))).toBe(true);
    });

    it('compacts to a single row once the 50-update threshold is reached', async () => {
        const doc = new Y.Doc();
        const provider = new PGliteProvider(DOC_ID, doc);
        await provider.load();

        // 50 discrete edits, each flushed on its own microtask so updateCount climbs by 1.
        for (let i = 0; i < 50; i++) {
            doc.getText('body').insert(doc.getText('body').length, 'x');
            await tick(0);
        }

        expect(await docRowCount(DOC_ID)).toBe(1);
        expect(doc.getText('body').length).toBe(50);

        // The single compacted row still carries the full 50-char state.
        const stored = await getDocumentUpdates(DOC_ID);
        expect(bodyOf(stored[0]).length).toBe(50);
    });
});

describe('PGliteProvider.destroy', () => {
    it('compacts on destroy when updateCount > 1', async () => {
        const doc = new Y.Doc();
        const provider = new PGliteProvider(DOC_ID, doc);
        await provider.load();
        // Two separate edits -> two saves -> updateCount === 2.
        doc.getText('body').insert(0, 'a');
        await tick(0);
        doc.getText('body').insert(1, 'b');
        await tick(0);
        expect(await docRowCount(DOC_ID)).toBe(2);

        await provider.destroy();
        expect(await docRowCount(DOC_ID)).toBe(1);
        const stored = await getDocumentUpdates(DOC_ID);
        expect(bodyOf(stored[0])).toBe('ab');
    });

    it('does not compact on destroy when updateCount <= 1', async () => {
        const doc = new Y.Doc();
        const provider = new PGliteProvider(DOC_ID, doc);
        await provider.load();
        doc.getText('body').insert(0, 'a'); // single edit -> updateCount === 1
        await tick(0);
        expect(await docRowCount(DOC_ID)).toBe(1);

        // Overwrite the row so we can detect whether compact() ran (compact would rewrite it).
        await db.query('UPDATE document_updates SET update_blob = $1 WHERE doc_id = $2',
            [new Uint8Array([1, 2, 3]), DOC_ID]);

        await provider.destroy();

        // updateCount was 1, so destroy() must NOT compact — the sentinel row survives untouched.
        expect(await docRowCount(DOC_ID)).toBe(1);
        const rows = await db.query<{ update_blob: Uint8Array }>(
            'SELECT update_blob FROM document_updates WHERE doc_id = $1', [DOC_ID]);
        expect(Buffer.from(rows.rows[0].update_blob).equals(Buffer.from([1, 2, 3]))).toBe(true);
    });
});

describe('PGliteProvider stranded-update gap', () => {
    // Pins the current (buggy) behavior fixed by plan 004: an update that arrives while a
    // prior save is in flight is NOT auto-persisted — it strands in memory until the next
    // local update or an explicit flush(). See provider.ts handleUpdate (isSaving guard).
    it('leaves an update stranded in memory while a save is in flight, until flush()', async () => {
        const doc = new Y.Doc();
        const provider = new PGliteProvider(DOC_ID, doc);
        await provider.load();
        saveControl.delayMs = 50; // make A's save slow enough to interleave B

        doc.getText('body').insert(0, 'A'); // update A: microtask begins, save A is delayed
        await tick(5);                       // A's save is still in flight
        doc.getText('body').insert(1, 'B'); // update B pushed while isSaving === true
        await tick(80);                      // A's save completes; no further edits fire

        // Only A was persisted; B is stranded in pendingUpdates (current behavior — plan 004).
        expect(await docRowCount(DOC_ID)).toBe(1);
        expect(bodyOf((await getDocumentUpdates(DOC_ID))[0])).toBe('A');

        await provider.flush(); // flush drains the stranded update

        expect(await docRowCount(DOC_ID)).toBe(2);
        const doc2 = new Y.Doc();
        for (const u of await getDocumentUpdates(DOC_ID)) Y.applyUpdate(doc2, u);
        expect(doc2.getText('body').toString()).toBe('AB');
    });
});
