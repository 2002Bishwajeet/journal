import { getDatabase } from '../pglite';
import type { NoteListEntry } from '@/types';
import { NOTE_LIST_SQL, toNoteListEntry, type NoteListRow } from './noteList';

// ============================================
// Tags
// ============================================

/** All distinct tags across all notes, sorted alphabetically (live query for useTags). */
export const TAGS_SQL = `SELECT DISTINCT jsonb_array_elements_text(metadata->'tags') AS tag
         FROM search_index
         WHERE jsonb_array_length(COALESCE(metadata->'tags', '[]'::jsonb)) > 0
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
 * Lightweight query for the note list sidebar, filtered by tag.
 * Returns only title, a short preview, and metadata — NOT full content.
 * Pinned notes appear first, then sorted by updated_at descending.
 */
export async function getNotesForListByTag(tag: string): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const result = await db.query<NoteListRow>(NOTE_LIST_SQL.byTag, [tag]);
    return result.rows.map(toNoteListEntry);
}
