import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';
import { upsertSearchIndex, getActiveNoteByTitle } from '@/lib/db/queries';
import { todayTitle, findOrCreateDailyNote } from '@/hooks/useDailyNote';

const DOC_ACTIVE = '20000000-0000-0000-0000-000000000001';
const DOC_TRASHED = '20000000-0000-0000-0000-000000000002';

async function addNote(docId: string, title: string, archivalStatus?: number) {
    const now = new Date().toISOString();
    await upsertSearchIndex({
        docId,
        title,
        plainTextContent: `body of ${title}`,
        metadata: {
            title,
            folderId: 'main',
            timestamps: { created: now, modified: now },
            excludeFromAI: false,
            ...(archivalStatus !== undefined ? { archivalStatus } : {}),
        },
    });
}

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    // @ts-expect-error test-only setter
    pgliteModule.setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

describe('todayTitle', () => {
    it('formats a local date as zero-padded YYYY-MM-DD', () => {
        expect(todayTitle(new Date(2026, 6, 4, 15, 30))).toBe('2026-07-04'); // July 4
        expect(todayTitle(new Date(2026, 0, 5))).toBe('2026-01-05'); // Jan (month/day padded)
        expect(todayTitle(new Date(2026, 11, 31, 9))).toBe('2026-12-31'); // Dec 31
    });

    it('uses local calendar fields, not UTC, across the midnight boundary', () => {
        // Both constructed from local components — 11:59pm one day vs 12:01am the
        // next map to different day-strings regardless of the runner's timezone.
        expect(todayTitle(new Date(2026, 2, 14, 23, 59))).toBe('2026-03-14');
        expect(todayTitle(new Date(2026, 2, 15, 0, 1))).toBe('2026-03-15');
    });
});

describe('findOrCreateDailyNote (find-or-create matrix)', () => {
    const now = new Date(2026, 6, 4, 12); // -> title 2026-07-04
    const title = todayTitle(now);

    it('creates a new note when today has none', async () => {
        let calledWith: string | null = null;
        const result = await findOrCreateDailyNote(now, async (t) => {
            calledWith = t;
            return { docId: DOC_ACTIVE, folderId: 'daily' };
        });

        expect(calledWith).toBe(title);
        expect(result).toEqual({ docId: DOC_ACTIVE, folderId: 'daily', created: true });
    });

    it("reuses today's existing active note instead of creating one", async () => {
        await addNote(DOC_ACTIVE, title); // active note with today's title
        let created = false;
        const result = await findOrCreateDailyNote(now, async () => {
            created = true;
            return { docId: 'should-not-be-used', folderId: 'daily' };
        });

        expect(created).toBe(false);
        expect(result).toEqual({ docId: DOC_ACTIVE, folderId: 'main', created: false });
    });

    it('ignores a trashed note with today\'s title and creates a fresh one', async () => {
        await addNote(DOC_TRASHED, title, 2); // trashed note with today's title
        let calledWith: string | null = null;
        const result = await findOrCreateDailyNote(now, async (t) => {
            calledWith = t;
            return { docId: DOC_ACTIVE, folderId: 'daily' };
        });

        expect(calledWith).toBe(title);
        expect(result.created).toBe(true);
        expect(result.docId).toBe(DOC_ACTIVE);
        // The query the decision relies on must not surface the trashed note.
        expect(await getActiveNoteByTitle(title)).toBeNull();
    });
});
