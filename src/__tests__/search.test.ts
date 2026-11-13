// @vitest-environment happy-dom
/**
 * advancedSearch (hybrid FTS + trigram + LIKE) against the real schema.
 * Notes are seeded through upsertSearchIndex so search_vector is built by the
 * app's own code, and pg_trgm is loaded, so a broken query fails here instead of
 * silently taking the LIKE fallback.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestDatabase, closeTestDatabase, resetTestDatabase, getTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { upsertSearchIndex, advancedSearch, updateSearchIndexMetadata, deleteTagFromAllNotes } from '@/lib/db/queries';
import type { DocumentMetadata } from '@/types';
import { createDoc } from '@/lib/agent/editEngine';
import { previewTextFromFragment } from '@/lib/yjs/previewText';

async function addNote(docId: string, title: string, plainTextContent: string, archivalStatus?: number, tags?: string[]) {
    await upsertSearchIndex({ docId, title, plainTextContent, metadata: noteMetadata(title, archivalStatus, tags) });
}

function noteMetadata(title: string, archivalStatus?: number, tags?: string[]): DocumentMetadata {
    const now = new Date().toISOString();
    return {
        title,
        folderId: 'main',
        timestamps: { created: now, modified: now },
        excludeFromAI: false,
        archivalStatus,
        tags,
    };
}

const ids = (results: { docId: string }[]) => results.map((r) => r.docId);

beforeAll(async () => {
    setTestDb(await createTestDatabase());
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

describe('advancedSearch', () => {
    it('ranks a note with the word in its title above one with it only in the body', async () => {
        const inBody = '20000000-0000-0000-0000-000000000001';
        const inTitle = '20000000-0000-0000-0000-000000000002';
        await addNote(inBody, 'Weekly notes', 'Planning the garden beds for spring.');
        await addNote(inTitle, 'Garden layout', 'Where the tomatoes and beans go.');

        const results = await advancedSearch('garden');

        expect(ids(results)).toEqual([inTitle, inBody]);
        expect(results[0].matchType).toBe('title');
    });

    it('ranks a stemmed full-text match above a trigram-only match', async () => {
        const fts = '20000000-0000-0000-0000-000000000003';
        const trigram = '20000000-0000-0000-0000-000000000004';
        await addNote(trigram, 'Runnin', 'Nothing else to see here.');
        await addNote(fts, 'Morning notes', 'She runs every day before work.');

        const results = await advancedSearch('running');

        expect(ids(results)).toEqual([fts, trigram]);
        expect(results[0].matchType).toBe('content');
        expect(results[1].matchType).toBe('fuzzy');
    });

    it('finds a typo through trigram similarity, which a LIKE search cannot', async () => {
        const journal = '20000000-0000-0000-0000-000000000005';
        await addNote(journal, 'Journal ideas', '');

        const results = await advancedSearch('jurnal');

        expect(ids(results)).toEqual([journal]);
        expect(results[0].matchType).toBe('fuzzy');
    });

    it('returns nothing for an empty or whitespace-only query', async () => {
        await addNote('20000000-0000-0000-0000-000000000006', 'Anything', 'At all.');

        expect(await advancedSearch('')).toEqual([]);
        expect(await advancedSearch('   ')).toEqual([]);
    });

    it('does not fall back to LIKE search on a normal query', async () => {
        const errorSpy = vi.spyOn(console, 'error');
        try {
            await addNote('20000000-0000-0000-0000-000000000007', 'Garden layout', 'Tomatoes.');

            await advancedSearch('garden');

            expect(errorSpy).not.toHaveBeenCalledWith('[advancedSearch] Error:', expect.anything());
        } finally {
            errorSpy.mockRestore();
        }
    });
});

describe('advancedSearch visibility', () => {
    const uid = (n: number) => `30000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

    it('never lists trashed or archived notes by default', async () => {
        await addNote(uid(1), 'Kiwi active', 'kiwi');
        await addNote(uid(2), 'Kiwi trashed', 'kiwi', 2);
        await addNote(uid(3), 'Kiwi archived', 'kiwi', 1);
        expect(ids(await advancedSearch('kiwi'))).toEqual([uid(1)]);
    });

    it('includes archived but not trashed notes with includeArchived', async () => {
        await addNote(uid(1), 'Kiwi active', 'kiwi');
        await addNote(uid(2), 'Kiwi trashed', 'kiwi', 2);
        await addNote(uid(3), 'Kiwi archived', 'kiwi', 1);
        expect(ids(await advancedSearch('kiwi', { includeArchived: true })).sort()).toEqual([uid(1), uid(3)].sort());
    });

    it('does not let 60 trashed matches push out the active one', async () => {
        for (let i = 0; i < 60; i++) await addNote(uid(100 + i), `Mango trash ${i}`, 'mango mango mango', 2);
        await addNote(uid(1), 'Mango', 'mango');
        expect(ids(await advancedSearch('mango'))).toEqual([uid(1)]);
    });
});

describe('advancedSearch on the shared preview text (#1228)', () => {
    it('finds a note by the label of a note link in its body', async () => {
        const id = '20000000-0000-0000-0000-000000000099';
        const text = previewTextFromFragment(createDoc('See [Budget 2026](journal:note/abc123) today').getXmlFragment('prosemirror'));
        await addNote(id, 'Meeting', text);

        expect(ids(await advancedSearch('budget'))).toEqual([id]);
    });
});

describe('advancedSearch ignores accents and matches tags (#1229)', () => {
    const uid = (n: number) => `60000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

    it('finds "café" for cafe, CAFE and café, and marks café in the snippet', async () => {
        await addNote(uid(1), 'Breakfast', 'Breakfast at a café near the tram.');
        await addNote(uid(2), 'Other', 'Nothing here.');

        for (const query of ['cafe', 'CAFE', 'café']) {
            const results = await advancedSearch(query);
            expect(ids(results)).toEqual([uid(1)]);
            expect(results[0].contentHighlight).toContain('<mark>café</mark>');
        }
    });

    it('finds Zürich, crème brûlée and a title "Señor García" without their accents', async () => {
        await addNote(uid(1), 'Trip', 'We took the train to Zürich.');
        await addNote(uid(2), 'Dessert', 'The crème brûlée was perfect.');
        await addNote(uid(3), 'Señor García', 'Met for lunch.');

        expect(ids(await advancedSearch('zurich'))).toEqual([uid(1)]);
        expect(ids(await advancedSearch('creme brulee'))).toEqual([uid(2)]);
        const senor = await advancedSearch('senor garcia');
        expect(ids(senor)).toEqual([uid(3)]);
        expect(senor[0].matchType).toBe('title');
        expect(senor[0].titleHighlight).toContain('<mark>Señor</mark>');
    });

    it('ranks a tag hit under a title hit and above a body-only hit', async () => {
        await addNote(uid(1), 'Weeknight dinners', 'The recipe uses lentils.');
        await addNote(uid(2), 'Lentil soup', 'Onions, carrots, stock.', 0, ['recipe']);
        await addNote(uid(3), 'Recipe box', 'Index cards.');

        const results = await advancedSearch('recipe');

        expect(ids(results)).toEqual([uid(3), uid(2), uid(1)]);
        expect(results.map((r) => r.matchType)).toEqual(['title', 'tag', 'content']);
        expect(results[1].score).toBeLessThan(results[0].score - 0.5);
        expect(results[2].score).toBeLessThan(results[1].score - 0.5);
    });

    it('no longer finds a note by a tag removed from it in the note menu or from every note', async () => {
        await addNote(uid(1), 'Lentil soup', 'Onions.', 0, ['recipe', 'winter']);
        await addNote(uid(2), 'Stew', 'Beans.', 0, ['recipe']);

        await updateSearchIndexMetadata(uid(1), 'Lentil soup', noteMetadata('Lentil soup', 0, ['winter']));
        expect(ids(await advancedSearch('recipe'))).toEqual([uid(2)]);
        expect(ids(await advancedSearch('winter'))).toEqual([uid(1)]);

        await deleteTagFromAllNotes('recipe');
        expect(await advancedSearch('recipe')).toEqual([]);
    });

    it('still stems English words', async () => {
        await addNote(uid(1), 'Notes', 'The meeting ran long.');

        expect(ids(await advancedSearch('meetings'))).toEqual([uid(1)]);
    });
});

describe('advancedSearch stages (#1225)', () => {
    const uid = (n: number) => `40000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
    const filler = (words: number) => Array.from({ length: words }, (_, i) => `filler${i % 50}`).join(' ');

    it('finds a word while its last word is still being typed, far from the first', async () => {
        await addNote(uid(1), 'Trip', `The zeppelin left at dawn. ${filler(400)} A new initiative started.`);
        await addNote(uid(2), 'Other trip', 'The zeppelin landed.');

        expect(ids(await advancedSearch('zeppelin init'))).toEqual([uid(1)]);
        expect(ids(await advancedSearch('zeppelin initiative'))).toEqual([uid(1)]);
    });

    it('keeps a title prefix hit above 80 body hits', async () => {
        for (let i = 0; i < 80; i++) await addNote(uid(100 + i), `Week ${i}`, `We plan the plan for the plan ${i}.`);
        await addNote(uid(1), 'Planner 2026', 'Dates.');

        const results = await advancedSearch('plan');

        expect(results[0].docId).toBe(uid(1));
        expect(results[0].matchType).toBe('title');
        expect(results.slice(1).every((r) => r.score < results[0].score - 1)).toBe(true);
    });

    it('labels a long title prefix as a title match, not fuzzy', async () => {
        await addNote(uid(1), 'Quarterly project planning', 'Goals.');

        const results = await advancedSearch('quarterly proj');

        expect(ids(results)).toEqual([uid(1)]);
        expect(results[0].matchType).toBe('title');
    });

    it('finds a typo in one word of a long title as fuzzy when nothing else matches', async () => {
        await addNote(uid(1), 'The zeppelin trip to Berlin and back', 'Airships.');
        await addNote(uid(2), 'Grocery list', 'Milk.');

        const results = await advancedSearch('zepelin');

        expect(ids(results)).toEqual([uid(1)]);
        expect(results[0].matchType).toBe('fuzzy');
    });

    it('excludes a -word', async () => {
        await addNote(uid(1), 'Spring', 'The garden needs water.');
        await addNote(uid(2), 'Dinner', 'A garden recipe for soup.');
        await addNote(uid(3), 'Garden recipes', 'Soup.');

        expect(ids(await advancedSearch('garden -recipe'))).toEqual([uid(1)]);
    });

    it('matches a quoted phrase only', async () => {
        await addNote(uid(1), 'Dinner', 'My garden recipe for soup.');
        await addNote(uid(2), 'Spring', 'The garden needs water. The recipe needs salt.');

        expect(ids(await advancedSearch('"garden recipe"'))).toEqual([uid(1)]);
    });

    it('takes % and _ literally', async () => {
        await addNote(uid(1), 'Code', 'Call a_b here.');
        await addNote(uid(2), 'Letters', 'A b c, axb and ab.');
        await addNote(uid(3), 'Growth', 'Sales grew 100% this year.');
        await addNote(uid(4), '100 days', 'We sold 1000 apples in 100 days.');

        expect(ids(await advancedSearch('a_b'))).toEqual([uid(1)]);
        expect(ids(await advancedSearch('100%'))).toEqual([uid(3)]);
    });

    it('finds a partial word longer than its stem', async () => {
        await addNote(uid(1), 'Notes', 'Notes from the meeting with Sam.');

        const results = await advancedSearch('meetin');

        expect(ids(results)).toEqual([uid(1)]);
        expect(results[0].contentHighlight).toContain('<mark>meetin</mark>g');
    });

    it('highlights a full-text match deep in a long body', async () => {
        await addNote(uid(1), 'Long', `${filler(3000)} The kohlrabi grew well. ${filler(3000)}`);

        const [hit] = await advancedSearch('kohlrabi');

        expect(hit.contentHighlight).toContain('<mark>kohlrabi</mark>');
    });

    it('reads the full-text and substring statements through their indexes', async () => {
        const db = getTestDatabase();
        await addNote(uid(1), 'Trip', 'The zeppelin left at dawn.');
        await addNote(uid(2), 'Notes', 'Notes from the meeting.');
        await db.exec('ANALYZE search_index');
        const statements = await recordStatements(async () => {
            await advancedSearch('zeppelin');
            await advancedSearch('meetin');
        });
        const fullText = statements.find((s) => s.sql.includes('ts_rank_cd('));
        const substring = statements.find((s) => s.sql.includes('plain_text_content ILIKE'));
        if (!fullText || !substring) throw new Error('stage statements not captured');

        const explain = async (statement: { sql: string; params: unknown[] }) =>
            (await db.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${statement.sql}`, statement.params)).rows
                .map((row) => row['QUERY PLAN'])
                .join('\n');
        await db.exec('SET enable_seqscan = off');
        try {
            expect(await explain(fullText)).not.toContain('Seq Scan on search_index');
            const substringPlan = await explain(substring);
            expect(substringPlan).not.toContain('Seq Scan on search_index');
            expect(substringPlan).toContain('idx_search_content_trgm');
        } finally {
            await db.exec('RESET enable_seqscan');
        }
    });

    it('never runs whole-string similarity or a LOWER() LIKE scan', async () => {
        await addNote(uid(1), 'Trip', 'The zeppelin left at dawn.');
        const statements = await recordStatements(async () => {
            for (const q of ['zeppelin', 'meetin', 'zepelin', 'a_b', '"garden recipe"']) await advancedSearch(q);
        });

        expect(statements.length).toBeGreaterThan(0);
        for (const { sql } of statements) {
            expect(sql).not.toContain('similarity(LEFT(');
            expect(sql).not.toMatch(/LOWER\(s\.plain_text_content\) LIKE/i);
        }
    });
});

/** Every query advancedSearch sends while `run` runs. */
async function recordStatements(run: () => Promise<void>) {
    const db = getTestDatabase();
    const statements: { sql: string; params: unknown[] }[] = [];
    const record = <Q extends typeof db.query>(query: Q) =>
        ((sql: string, params?: unknown[]) => {
            statements.push({ sql, params: params ?? [] });
            return query(sql, params);
        }) as Q;
    const query = record(db.query.bind(db));
    const transaction = db.transaction.bind(db);
    const spies = [
        vi.spyOn(db, 'query').mockImplementation(query),
        vi.spyOn(db, 'transaction').mockImplementation((callback) =>
            transaction((tx) => {
                tx.query = record(tx.query.bind(tx));
                return callback(tx);
            }),
        ),
    ];
    try {
        await run();
    } finally {
        for (const spy of spies) spy.mockRestore();
    }
    return statements;
}
