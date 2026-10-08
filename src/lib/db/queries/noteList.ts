import { getDatabase } from '../pglite';
import type { SearchIndexEntry, NoteListEntry, Folder, DocumentMetadata } from '@/types';
import { proseOnly } from '@/lib/previewText';
import { ACTIVE_NOTES_FILTER, NOTE_LIST_SELECT, MODIFIED_DESC } from './shared';

export type NoteListRow = { doc_id: string; title: string; preview: string; metadata: DocumentMetadata };

// Stable-identity mapping for note-list rows. PGlite re-runs the whole query on
// every write and returns fresh row objects, so a naive mapper would hand
// NoteItem a brand-new object for every row on every emission — defeating its
// React.memo so the entire list reconciles. Cache each produced entry by a
// signature over every field it copies (title, preview, and the full metadata —
// not just the modified timestamp, since archival/pin writes mutate metadata
// without bumping it): while a row's observable content is unchanged, return the
// SAME entry reference so memo holds; any change yields a new reference. Bounded
// by an LRU cap and reset via clearNoteListEntryCache() (see clearAllLocalData).
const NOTE_ENTRY_CACHE_LIMIT = 2000;
const noteEntryCache = new Map<string, { sig: string; entry: NoteListEntry }>();

export const toNoteListEntry = (row: NoteListRow): NoteListEntry => {
    const preview = proseOnly(row.preview || '');
    const sig = JSON.stringify([row.title, preview, row.metadata]);
    const cached = noteEntryCache.get(row.doc_id);
    if (cached && cached.sig === sig) {
        // Unchanged row: refresh LRU position, return the identical reference.
        noteEntryCache.delete(row.doc_id);
        noteEntryCache.set(row.doc_id, cached);
        return cached.entry;
    }
    const entry: NoteListEntry = {
        docId: row.doc_id,
        title: row.title,
        preview,
        metadata: row.metadata,
    };
    noteEntryCache.set(row.doc_id, { sig, entry });
    if (noteEntryCache.size > NOTE_ENTRY_CACHE_LIMIT) {
        const oldest = noteEntryCache.keys().next().value as string;
        noteEntryCache.delete(oldest);
    }
    return entry;
};

/** Reset the note-list entry identity cache — call whenever local data is wiped. */
export function clearNoteListEntryCache(): void {
    noteEntryCache.clear();
}

export const toFolder = (row: { id: string; name: string; created_at: Date }): Folder => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
});

const PINNED_THEN_MODIFIED = `ORDER BY (metadata->>'isPinned')::boolean DESC NULLS LAST, (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST`;
// "Shared with me": collaborative notes authored by someone other than the host ($1).
// metadata.authorOdinId first (what EditorPage uses), sync_records as fallback
// since handleRemoteNote can drop it from metadata. A NULL author (a note you
// shared) compares as NULL, so it's excluded.
const SHARED_WITH_ME_FILTER = `(metadata->>'isCollaborative')::boolean = true
    AND COALESCE(metadata->>'authorOdinId',
                 (SELECT sr.author_odin_id FROM sync_records sr WHERE sr.local_id = search_index.doc_id)) <> $1`;

export const NOTE_ROW_KEY = 'doc_id';
export const FOLDER_ROW_KEY = 'id';

export const NOTE_LIST_SQL = {
    active: `${NOTE_LIST_SELECT} WHERE ${ACTIVE_NOTES_FILTER} ${MODIFIED_DESC}`,
    byFolder: `${NOTE_LIST_SELECT} WHERE metadata->>'folderId' = $1 AND ${ACTIVE_NOTES_FILTER} ${MODIFIED_DESC}`,
    collaborative: `${NOTE_LIST_SELECT} WHERE ${SHARED_WITH_ME_FILTER} AND ${ACTIVE_NOTES_FILTER} ${PINNED_THEN_MODIFIED}`,
    trashed: `${NOTE_LIST_SELECT} WHERE COALESCE((metadata->>'archivalStatus')::int, 0) = 2 ${MODIFIED_DESC}`,
    archived: `${NOTE_LIST_SELECT} WHERE COALESCE((metadata->>'archivalStatus')::int, 0) = 1 ${MODIFIED_DESC}`,
    byTag: `${NOTE_LIST_SELECT} WHERE metadata->'tags' ? $1 AND ${ACTIVE_NOTES_FILTER} ORDER BY (metadata->>'isPinned')::boolean DESC NULLS LAST, updated_at DESC`,
    // Backlinks: active notes whose metadata.linkedNoteIds array contains $1.
    // Uses the same jsonb `?` element-exists operator as the tag filter.
    backlinks: `${NOTE_LIST_SELECT} WHERE metadata->'linkedNoteIds' ? $1 AND ${ACTIVE_NOTES_FILTER} ${MODIFIED_DESC}`,
} as const;

// Single-row counts for the sidebar badges (trash / archive / shared). One live
// subscription replaces the three full-list subscriptions that previously ran at
// boot just to show counts. Filters mirror NOTE_LIST_SQL.{trashed,archived,collaborative}.
export const NOTE_COUNTS_SQL = `
    SELECT
        (COUNT(*) FILTER (WHERE COALESCE((metadata->>'archivalStatus')::int, 0) = 2))::int AS trashed,
        (COUNT(*) FILTER (WHERE COALESCE((metadata->>'archivalStatus')::int, 0) = 1))::int AS archived,
        (COUNT(*) FILTER (WHERE ${SHARED_WITH_ME_FILTER} AND ${ACTIVE_NOTES_FILTER}))::int AS collaborative
    FROM search_index`;

export type NoteCountsRow = { trashed: number; archived: number; collaborative: number };

export const FOLDERS_SQL = `SELECT id, name, created_at FROM folders ORDER BY name ASC`;

// Active notes' id → title/folder, for live-resolving internal-link titles.
// Active-only: links to archived/trashed notes resolve as "broken" rather than
// navigating to an editor route that can't load them.
export const NOTE_TITLE_MAP_SQL = `SELECT doc_id, title, metadata->>'folderId' AS folder_id FROM search_index WHERE ${ACTIVE_NOTES_FILTER}`;

/**
 * Lightweight query for the note list sidebar.
 * Returns only title, a short preview, and metadata — NOT full content.
 */
export async function getNotesForList(): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const result = await db.query<NoteListRow>(NOTE_LIST_SQL.active);
    return result.rows.map(toNoteListEntry);
}

/**
 * Lightweight query for the Trash view — notes with archivalStatus 2 (Removed).
 */
export async function getTrashedNotes(): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const result = await db.query<NoteListRow>(NOTE_LIST_SQL.trashed);
    return result.rows.map(toNoteListEntry);
}

/**
 * Lightweight query for the Archive view — notes with archivalStatus 1 (Archived).
 */
export async function getArchivedNotes(): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const result = await db.query<NoteListRow>(NOTE_LIST_SQL.archived);
    return result.rows.map(toNoteListEntry);
}

/**
 * Find a single ACTIVE (not archived/trashed) note by its exact title.
 * Backs the daily-note find-or-create flow: returns the most recently modified
 * match when several share a title, and null when none is active (so a trashed
 * note with today's title does not block creating a fresh one).
 */
export async function getActiveNoteByTitle(
    title: string,
): Promise<{ docId: string; folderId: string } | null> {
    const db = await getDatabase();
    const result = await db.query<{
        doc_id: string;
        folder_id: string;
    }>(
        `SELECT doc_id,
                metadata->>'folderId' AS folder_id
         FROM search_index
         WHERE title = $1
           AND ${ACTIVE_NOTES_FILTER}
         ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST
         LIMIT 1`,
        [title],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return { docId: row.doc_id, folderId: row.folder_id };
}

export async function getDocumentsByFolder(folderId: string): Promise<SearchIndexEntry[]> {
    const db = await getDatabase();
    const result = await db.query<{
        doc_id: string;
        title: string;
        plain_text_content: string;
        metadata: DocumentMetadata;
    }>(
        `SELECT doc_id, title, plain_text_content, metadata FROM search_index 
     WHERE metadata->>'folderId' = $1
       AND ${ACTIVE_NOTES_FILTER}
     ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST`,
        [folderId]
    );
    return result.rows.map(row => ({
        docId: row.doc_id,
        title: row.title,
        plainTextContent: row.plain_text_content,
        metadata: row.metadata,
    }));
}

/** Every note in a folder, including archived and trashed ones (for folder deletion). */
export async function getAllDocIdsByFolder(folderId: string): Promise<string[]> {
    const db = await getDatabase();
    const result = await db.query<{ doc_id: string }>(
        `SELECT doc_id FROM search_index WHERE metadata->>'folderId' = $1`,
        [folderId]
    );
    return result.rows.map(row => row.doc_id);
}


/**
 * Lightweight query for the note list sidebar, filtered by folder.
 * Returns only title, a short preview, and metadata — NOT full content.
 */
export async function getNotesForListByFolder(folderId: string): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const result = await db.query<NoteListRow>(NOTE_LIST_SQL.byFolder, [folderId]);
    return result.rows.map(toNoteListEntry);
}

export async function getCollaborativeNotesForList(hostOdinId: string): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const result = await db.query<NoteListRow>(NOTE_LIST_SQL.collaborative, [hostOdinId]);
    return result.rows.map(toNoteListEntry);
}
