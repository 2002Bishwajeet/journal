import { getDatabase } from '../pglite';
import type { NoteListEntry } from '@/types';
import { NOTE_LIST_SQL, toNoteListEntry, type NoteListRow } from './noteList';
import { updateSyncStatus } from './syncRecords';

// ============================================
// Tags
// ============================================

/**
 * All distinct tags across all notes (trashed and archived included), sorted
 * alphabetically, each with the number of notes that carry it (live query for useTags).
 */
export const TAGS_SQL = `SELECT tag, COUNT(*)::int AS count
         FROM (SELECT jsonb_array_elements_text(metadata->'tags') AS tag
               FROM search_index
               WHERE jsonb_array_length(COALESCE(metadata->'tags', '[]'::jsonb)) > 0) AS note_tags
         GROUP BY tag
         ORDER BY tag`;

/**
 * Get all distinct tags across all notes, sorted alphabetically.
 */
export async function getAllTags(): Promise<string[]> {
    const db = await getDatabase();
    const result = await db.query<{ tag: string }>(TAGS_SQL);
    return result.rows.map(row => row.tag);
}

/**
 * Remove `tag` from every note that has it (trashed and archived included) and mark
 * each of those notes pending, in one transaction, so the next push uploads the new
 * tags. Leaves `modified`/`updated_at` alone so the notes keep their list order.
 * Returns the ids of the notes that changed.
 */
export async function deleteTagFromAllNotes(tag: string): Promise<string[]> {
    const db = await getDatabase();
    return db.transaction(async (tx) => {
        const result = await tx.query<{ doc_id: string }>(
            `UPDATE search_index
             SET metadata = jsonb_set(metadata, '{tags}', COALESCE(
                   (SELECT jsonb_agg(t ORDER BY i)
                    FROM jsonb_array_elements(metadata->'tags') WITH ORDINALITY AS e(t, i)
                    WHERE t <> to_jsonb($1::text)),
                   '[]'::jsonb))
             WHERE metadata->'tags' ? $1
             RETURNING doc_id`,
            [tag]
        );
        const docIds = result.rows.map(row => row.doc_id);
        for (const docId of docIds) {
            await updateSyncStatus(docId, 'pending', tx);
        }
        return docIds;
    });
}

/**
 * Lightweight query for the note list sidebar, filtered by tag.
 * Returns only title, a short preview, and metadata — NOT full content.
 * Pinned notes appear first, then sorted by updated_at descending.
 */
export async function getNotesForListByTag(tag: string): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const result = await db.query<NoteListRow>(NOTE_LIST_SQL.byTag, [tag]);
    return result.rows.map(toNoteListEntry);
}
