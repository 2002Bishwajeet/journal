import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase } from './testDb';
import type { SearchIndexEntry, NoteListEntry, DocumentMetadata } from '@/types';

// Fixed UUIDs for the test notes (doc_id column is UUID type)
const T1 = 'a0000000-0000-4000-8000-000000000001';
const T2 = 'a0000000-0000-4000-8000-000000000002';
const T3 = 'a0000000-0000-4000-8000-000000000003';
const T4 = 'a0000000-0000-4000-8000-000000000004';

function makeNote(id: string, title: string, tags: string[]): SearchIndexEntry {
    return {
        docId: id,
        title,
        plainTextContent: `Content of ${title}`,
        metadata: {
            title,
            folderId: 'test-folder',
            tags,
            timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
            excludeFromAI: false,
        },
    };
}

// Local implementations of the tag queries, mirroring queries.ts logic,
// operating against the in-memory test database instance.
async function upsertSearchIndex(db: PGlite, entry: SearchIndexEntry): Promise<void> {
    await db.query(
        `INSERT INTO search_index (doc_id, title, plain_text_content, metadata, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (doc_id) DO UPDATE SET
           title = EXCLUDED.title,
           plain_text_content = EXCLUDED.plain_text_content,
           metadata = EXCLUDED.metadata,
           updated_at = CURRENT_TIMESTAMP`,
        [entry.docId, entry.title, entry.plainTextContent, JSON.stringify(entry.metadata)]
    );
}

async function getAllTags(db: PGlite): Promise<string[]> {
    const result = await db.query<{ tag: string }>(
        `SELECT DISTINCT jsonb_array_elements_text(metadata->'tags') AS tag
         FROM search_index
         WHERE jsonb_array_length(COALESCE(metadata->'tags', '[]'::jsonb)) > 0
         ORDER BY tag`
    );
    return result.rows.map(row => row.tag);
}

async function getNotesForListByTag(db: PGlite, tag: string): Promise<NoteListEntry[]> {
    const result = await db.query<{
        doc_id: string;
        title: string;
        preview: string;
        metadata: DocumentMetadata;
    }>(
        `SELECT doc_id, title,
                LEFT(plain_text_content, 150) as preview,
                metadata
         FROM search_index
         WHERE metadata->'tags' ? $1
         ORDER BY
            (metadata->>'isPinned')::boolean DESC NULLS LAST,
            updated_at DESC`,
        [tag]
    );
    return result.rows.map(row => ({
        docId: row.doc_id,
        title: row.title,
        preview: row.preview || '',
        metadata: row.metadata,
    }));
}

describe('Tag Queries', () => {
    let db: PGlite;

    beforeAll(async () => {
        db = await createTestDatabase();
        await upsertSearchIndex(db, makeNote(T1, 'Note 1', ['work', 'important']));
        await upsertSearchIndex(db, makeNote(T2, 'Note 2', ['personal', 'work']));
        await upsertSearchIndex(db, makeNote(T3, 'Note 3', []));
        await upsertSearchIndex(db, makeNote(T4, 'Note 4', ['important']));
    });

    afterAll(async () => {
        await closeTestDatabase();
    });

    it('getAllTags returns unique sorted tags', async () => {
        const tags = await getAllTags(db);
        expect(tags).toContain('work');
        expect(tags).toContain('personal');
        expect(tags).toContain('important');
        const workIndex = tags.indexOf('work');
        const personalIndex = tags.indexOf('personal');
        expect(personalIndex).toBeLessThan(workIndex);
    });

    it('getNotesForListByTag returns matching notes', async () => {
        const workNotes = await getNotesForListByTag(db, 'work');
        expect(workNotes).toHaveLength(2);
        expect(workNotes.map(n => n.docId).sort()).toEqual([T1, T2].sort());
    });

    it('getNotesForListByTag returns empty for non-existent tag', async () => {
        const notes = await getNotesForListByTag(db, 'nonexistent');
        expect(notes).toHaveLength(0);
    });

    it('notes without tags are excluded from tag queries', async () => {
        const tags = await getAllTags(db);
        const allTagNotes = await Promise.all(tags.map(t => getNotesForListByTag(db, t)));
        const allDocIds = allTagNotes.flat().map(n => n.docId);
        expect(allDocIds).not.toContain(T3);
    });
});
