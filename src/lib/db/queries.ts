import { MAIN_FOLDER_ID } from '../homebase';
import { getDatabase, ensureTrigramSearch } from './pglite';
import type { SearchIndexEntry, NoteListEntry, Folder, DocumentMetadata, SyncRecord, PendingImageUpload, SyncError, AdvancedSearchResult } from '@/types';

// Notes with archivalStatus 2 (Homebase "Removed") live in the Trash — exclude them
// from every active-note list. Single source of truth for the filter.
// Active = not archived (1) and not trashed (2).
const ACTIVE_NOTES_FILTER = `COALESCE((metadata->>'archivalStatus')::int, 0) = 0`;

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
    const preview = row.preview || '';
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

// Shared SQL for note-list reads — used by both the imperative getters and the
// live-query hooks so they never drift. Row key for note queries is 'doc_id'.
const NOTE_LIST_SELECT = `SELECT doc_id, title, LEFT(plain_text_content, 150) as preview, metadata FROM search_index`;
// Text comparison, not ::timestamp — every writer stores toISOString() output,
// where lexicographic order == chronological order, and sorting the raw text
// lets idx_search_metadata_modified serve the sort (a text→timestamp cast
// isn't IMMUTABLE, so it can't be indexed).
const MODIFIED_DESC = `ORDER BY metadata->'timestamps'->>'modified' DESC NULLS LAST`;
const PINNED_THEN_MODIFIED = `ORDER BY (metadata->>'isPinned')::boolean DESC NULLS LAST, (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST`;

export const NOTE_ROW_KEY = 'doc_id';
export const FOLDER_ROW_KEY = 'id';

export const NOTE_LIST_SQL = {
    active: `${NOTE_LIST_SELECT} WHERE ${ACTIVE_NOTES_FILTER} ${MODIFIED_DESC}`,
    byFolder: `${NOTE_LIST_SELECT} WHERE metadata->>'folderId' = $1 AND ${ACTIVE_NOTES_FILTER} ${MODIFIED_DESC}`,
    collaborative: `${NOTE_LIST_SELECT} WHERE (metadata->>'isCollaborative')::boolean = true AND ${ACTIVE_NOTES_FILTER} ${PINNED_THEN_MODIFIED}`,
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
        (COUNT(*) FILTER (WHERE (metadata->>'isCollaborative')::boolean = true AND ${ACTIVE_NOTES_FILTER}))::int AS collaborative
    FROM search_index`;

export type NoteCountsRow = { trashed: number; archived: number; collaborative: number };

export const FOLDERS_SQL = `SELECT id, name, created_at FROM folders ORDER BY name ASC`;

// Active notes' id → title/folder, for live-resolving internal-link titles.
// Active-only: links to archived/trashed notes resolve as "broken" rather than
// navigating to an editor route that can't load them.
export const NOTE_TITLE_MAP_SQL = `SELECT doc_id, title, metadata->>'folderId' AS folder_id FROM search_index WHERE ${ACTIVE_NOTES_FILTER}`;



// Document Updates (Yjs blobs)
export async function saveDocumentUpdate(docId: string, updateBlob: Uint8Array): Promise<void> {
    const db = await getDatabase();
    await db.query(
        'INSERT INTO document_updates (doc_id, update_blob) VALUES ($1, $2)',
        [docId, updateBlob]
    );
}

export async function getDocumentUpdates(docId: string): Promise<Uint8Array[]> {
    const db = await getDatabase();
    const result = await db.query<{ update_blob: Uint8Array }>(
        'SELECT update_blob FROM document_updates WHERE doc_id = $1 ORDER BY created_at ASC',
        [docId]
    );
    return result.rows.map(row => row.update_blob);
}

export async function deleteDocumentUpdates(docId: string): Promise<void> {
    const db = await getDatabase();
    await db.query('DELETE FROM document_updates WHERE doc_id = $1', [docId]);
}

// Atomically replace all of a doc's updates with a single compacted blob. The
// delete and insert run in ONE statement (a data-modifying CTE), so a crash or
// error between them can never leave the note with zero rows — the note's local
// history survives intact. Replaces the old non-atomic delete→save pairs.
export async function replaceDocumentUpdates(docId: string, blob: Uint8Array): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `WITH del AS (DELETE FROM document_updates WHERE doc_id = $1)
         INSERT INTO document_updates (doc_id, update_blob) VALUES ($1, $2)`,
        [docId, blob]
    );
}

// Search Index
export async function upsertSearchIndex(entry: SearchIndexEntry): Promise<void> {
    const db = await getDatabase();

    try {
        // Try the full insert with search_vector (for databases with FTS enabled)
        await db.query(
            `INSERT INTO search_index (doc_id, title, plain_text_content, metadata, search_vector, updated_at)
         VALUES ($1, $2, $3, $4, 
           setweight(to_tsvector('english', COALESCE($2, '')), 'A') ||
           setweight(to_tsvector('english', COALESCE($3, '')), 'B'),
           CURRENT_TIMESTAMP)
         ON CONFLICT (doc_id) DO UPDATE SET
           title = EXCLUDED.title,
           plain_text_content = EXCLUDED.plain_text_content,
           metadata = EXCLUDED.metadata,
           search_vector = EXCLUDED.search_vector,
           updated_at = CURRENT_TIMESTAMP`,
            [entry.docId, entry.title, entry.plainTextContent, JSON.stringify(entry.metadata)]
        );
    } catch (error) {
        // Fallback: insert without search_vector for legacy databases
        // This can happen if migration hasn't run yet
        console.warn('[upsertSearchIndex] Falling back to basic insert (search_vector column may not exist yet):', error);
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
}

/**
 * Update only metadata fields in search_index — does NOT touch plain_text_content.
 * Use this for metadata-only mutations (title change, pin toggle, etc.)
 * to avoid overwriting full content with a truncated preview.
 */
export async function updateSearchIndexMetadata(
    docId: string,
    title: string,
    metadata: DocumentMetadata,
): Promise<void> {
    const db = await getDatabase();
    // `linkedNoteIds` is editor-owned (written only by the content-save path).
    // Metadata-only writes (title, pin, tags, collaboration) must not clobber it
    // from a stale snapshot, so preserve the row's existing value via a jsonb overlay.
    await db.query(
        `UPDATE search_index
         SET title = $2,
             metadata = CASE
               WHEN metadata ? 'linkedNoteIds'
               THEN $3::jsonb || jsonb_build_object('linkedNoteIds', metadata->'linkedNoteIds')
               ELSE $3::jsonb
             END,
             search_vector = setweight(to_tsvector('english', COALESCE($2, '')), 'A') ||
                             setweight(to_tsvector('english', COALESCE(plain_text_content, '')), 'B'),
             updated_at = CURRENT_TIMESTAMP
         WHERE doc_id = $1`,
        [docId, title, JSON.stringify(metadata)]
    );
}

export async function getSearchIndexEntry(docId: string): Promise<SearchIndexEntry | null> {
    const db = await getDatabase();
    const result = await db.query<{
        doc_id: string;
        title: string;
        plain_text_content: string;
        metadata: DocumentMetadata;
    }>(
        'SELECT doc_id, title, plain_text_content, metadata FROM search_index WHERE doc_id = $1',
        [docId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
        docId: row.doc_id,
        title: row.title,
        plainTextContent: row.plain_text_content,
        metadata: row.metadata,
    };
}

export async function getAllDocuments(): Promise<SearchIndexEntry[]> {
    const db = await getDatabase();
    const result = await db.query<{
        doc_id: string;
        title: string;
        plain_text_content: string;
        metadata: DocumentMetadata;
    }>(
        `SELECT doc_id, title, plain_text_content, metadata FROM search_index 
     ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST`
    );
    return result.rows.map(row => ({
        docId: row.doc_id,
        title: row.title,
        plainTextContent: row.plain_text_content,
        metadata: row.metadata,
    }));
}

/**
 * Lightweight query for the note list sidebar.
 * Returns only title, a short preview, and metadata — NOT full content.
 */
export async function getNotesForList(): Promise<NoteListEntry[]> {
    const db = await getDatabase();
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
         WHERE ${ACTIVE_NOTES_FILTER}
         ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST`
    );
    return result.rows.map(toNoteListEntry);
}

/**
 * Lightweight query for the Trash view — notes with archivalStatus 2 (Removed).
 */
export async function getTrashedNotes(): Promise<NoteListEntry[]> {
    const db = await getDatabase();
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
         WHERE COALESCE((metadata->>'archivalStatus')::int, 0) = 2
         ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST`
    );
    return result.rows.map(toNoteListEntry);
}

/**
 * Lightweight query for the Archive view — notes with archivalStatus 1 (Archived).
 */
export async function getArchivedNotes(): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const result = await db.query<NoteListRow>(
        `SELECT doc_id, title,
                LEFT(plain_text_content, 150) as preview,
                metadata
         FROM search_index
         WHERE COALESCE((metadata->>'archivalStatus')::int, 0) = 1
         ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST`
    );
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



/**
 * Lightweight query for the note list sidebar, filtered by folder.
 * Returns only title, a short preview, and metadata — NOT full content.
 */
export async function getNotesForListByFolder(folderId: string): Promise<NoteListEntry[]> {
    const db = await getDatabase();
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
         WHERE metadata->>'folderId' = $1
           AND ${ACTIVE_NOTES_FILTER}
         ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST`,
        [folderId]
    );
    return result.rows.map(toNoteListEntry);
}

/**
 * Search active notes by title substring, for the `[[` note-link picker.
 * Excludes the current note (self-link) and archived/trashed notes. An empty
 * query returns the most-recently-modified active notes.
 */
export async function searchNotesByTitle(
    query: string,
    excludeId?: string,
    limit = 8,
): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const trimmed = query.trim();

    if (trimmed) {
        const result = await db.query<NoteListRow>(
            `${NOTE_LIST_SELECT}
             WHERE title ILIKE '%' || $1 || '%'
               AND ${ACTIVE_NOTES_FILTER}
               AND ($2::uuid IS NULL OR doc_id <> $2)
             ORDER BY title ASC
             LIMIT $3`,
            [trimmed, excludeId ?? null, limit],
        );
        return result.rows.map(toNoteListEntry);
    }

    const result = await db.query<NoteListRow>(
        `${NOTE_LIST_SELECT}
         WHERE ${ACTIVE_NOTES_FILTER}
           AND ($1::uuid IS NULL OR doc_id <> $1)
         ${MODIFIED_DESC}
         LIMIT $2`,
        [excludeId ?? null, limit],
    );
    return result.rows.map(toNoteListEntry);
}

export async function getCollaborativeNotesForList(): Promise<NoteListEntry[]> {
    const db = await getDatabase();
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
         WHERE (metadata->>'isCollaborative')::boolean = true
           AND ${ACTIVE_NOTES_FILTER}
         ORDER BY
            (metadata->>'isPinned')::boolean DESC NULLS LAST,
            (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST`
    );
    return result.rows.map(toNoteListEntry);
}

export async function deleteSearchIndexEntry(docId: string): Promise<void> {
    const db = await getDatabase();
    await db.query('DELETE FROM search_index WHERE doc_id = $1', [docId]);
}

/**
 * Update only the archivalStatus on a note's local metadata (0 active, 2 trashed),
 * preserving every other metadata field.
 */
export async function setNoteArchivalStatusLocal(docId: string, status: number): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `UPDATE search_index
         SET metadata = jsonb_set(metadata, '{archivalStatus}', to_jsonb($2::int)),
             updated_at = CURRENT_TIMESTAMP
         WHERE doc_id = $1`,
        [docId, status]
    );
}

// Folders
export async function getAllFolders(): Promise<Folder[]> {
    const db = await getDatabase();
    const result = await db.query<{
        id: string;
        name: string;
        created_at: Date;
    }>('SELECT id, name, created_at FROM folders ORDER BY name ASC');
    return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
    }));
}

export async function getFolderById(id: string): Promise<Folder | null> {
    const db = await getDatabase();
    const result = await db.query<{
        id: string;
        name: string;
        created_at: Date;
    }>('SELECT id, name, created_at FROM folders WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
    };
}

/**
 * Find a folder by exact name, returning the first-created match when several
 * share a name (folder names are not unique — see the find-or-create-folder
 * conventions for `Daily` and `Templates`).
 */
export async function getFolderByName(name: string): Promise<Folder | null> {
    const db = await getDatabase();
    const result = await db.query<{
        id: string;
        name: string;
        created_at: Date;
    }>('SELECT id, name, created_at FROM folders WHERE name = $1 ORDER BY created_at ASC LIMIT 1', [name]);
    if (result.rows.length === 0) return null;
    return toFolder(result.rows[0]);
}

export async function createFolder(id: string, name: string): Promise<void> {
    const db = await getDatabase();
    await db.query(
        'INSERT INTO folders (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [id, name]
    );
}

export async function deleteFolder(id: string): Promise<void> {
    // Prevent deleting the Main folder
    if (id === MAIN_FOLDER_ID) {
        throw new Error('Cannot delete the Main folder');
    }
    const db = await getDatabase();
    await db.query('DELETE FROM folders WHERE id = $1', [id]);
}



/**
 * Advanced search combining:
 * - Full-text search with ts_rank for relevance scoring
 * - Trigram similarity for fuzzy/typo-tolerant matching
 * - ts_headline for extracting highlighted context snippets
 */
export async function advancedSearch(query: string): Promise<AdvancedSearchResult[]> {
    const db = await getDatabase();
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
        return [];
    }

    // Prepare search patterns
    const likePattern = `%${trimmedQuery.toLowerCase()}%`;

    try {
        // pg_trgm + its indexes are loaded lazily (deferred out of app boot).
        // If this fails the catch below falls back to plain LIKE search.
        await ensureTrigramSearch(db);

        const result = await db.query<{
            doc_id: string;
            title: string;
            metadata: DocumentMetadata;
            fts_rank: number | null;
            title_similarity: number | null;
            content_similarity: number | null;
            title_highlight: string | null;
            content_highlight: string | null;
            title_like_match: boolean;
            content_like_match: boolean;
        }>(`
            WITH search_params AS (
                SELECT 
                    plainto_tsquery('english', $1) as tsq,
                    $1::text as raw_query,
                    $2::text as like_pattern
            )
            SELECT 
                s.doc_id,
                s.title,
                s.metadata,
                -- Full-text search rank (weighted: title A=1.0, content B=0.4)
                CASE 
                    WHEN s.search_vector @@ sp.tsq 
                    THEN ts_rank_cd(s.search_vector, sp.tsq, 32)
                    ELSE NULL 
                END as fts_rank,
                -- Trigram similarity for fuzzy matching
                similarity(s.title, sp.raw_query) as title_similarity,
                similarity(LEFT(s.plain_text_content, 1000), sp.raw_query) as content_similarity,
                -- Highlighted snippets using ts_headline
                CASE 
                    WHEN s.search_vector @@ sp.tsq THEN
                        ts_headline('english', s.title, sp.tsq, 
                            'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=5, MaxFragments=1')
                    WHEN LOWER(s.title) LIKE sp.like_pattern THEN
                        s.title
                    ELSE NULL
                END as title_highlight,
                CASE 
                    WHEN s.search_vector @@ sp.tsq THEN
                        ts_headline('english', s.plain_text_content, sp.tsq,
                            'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter= ... ')
                    WHEN LOWER(s.plain_text_content) LIKE sp.like_pattern THEN
                        -- For LIKE matches, extract context around the match
                        SUBSTRING(s.plain_text_content, 
                            GREATEST(1, POSITION(LOWER(sp.raw_query) IN LOWER(s.plain_text_content)) - 40),
                            120)
                    ELSE NULL
                END as content_highlight,
                -- Fallback exact substring matches
                LOWER(s.title) LIKE sp.like_pattern as title_like_match,
                LOWER(s.plain_text_content) LIKE sp.like_pattern as content_like_match
            FROM search_index s, search_params sp
            WHERE 
                -- Full-text search match
                s.search_vector @@ sp.tsq
                -- OR fuzzy title match (similarity > 0.3)
                OR similarity(s.title, sp.raw_query) > 0.3
                -- OR fuzzy content match  
                OR similarity(LEFT(s.plain_text_content, 1000), sp.raw_query) > 0.2
                -- OR exact substring match (fallback)
                OR LOWER(s.title) LIKE sp.like_pattern
                OR LOWER(s.plain_text_content) LIKE sp.like_pattern
            ORDER BY 
                -- Prioritize: FTS rank, then title similarity, then content match
                COALESCE(fts_rank, 0) DESC,
                COALESCE(title_similarity, 0) DESC,
                COALESCE(content_similarity, 0) DESC
            LIMIT 50
        `, [trimmedQuery, likePattern]);

        const results: AdvancedSearchResult[] = [];
        const highlightRegex = new RegExp(`(${trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');

        for (const row of result.rows) {
            // Determine match type and score
            let matchType: AdvancedSearchResult['matchType'] = 'content';
            let score = 0;

            if (row.fts_rank && row.fts_rank > 0) {
                // FTS match - check if it's in title or content
                if (row.title_highlight && row.title_highlight.includes('<mark>')) {
                    matchType = 'title';
                    score = row.fts_rank * 10; // Boost FTS matches
                } else {
                    matchType = 'content';
                    score = row.fts_rank * 5;
                }
            } else if ((row.title_similarity ?? 0) > 0.3) {
                matchType = 'fuzzy';
                score = row.title_similarity ?? 0;
            } else if ((row.content_similarity ?? 0) > 0.2) {
                matchType = 'fuzzy';
                score = (row.content_similarity ?? 0) * 0.8;
            } else if (row.title_like_match) {
                matchType = 'title';
                score = 0.9;
            } else if (row.content_like_match) {
                matchType = 'content';
                score = 0.7;
            }

            // Create highlighted content if not from FTS
            let contentHighlight = row.content_highlight;
            if (contentHighlight && !contentHighlight.includes('<mark>') && row.content_like_match) {
                // Add manual highlighting for LIKE matches
                contentHighlight = contentHighlight.replace(highlightRegex, '<mark>$1</mark>');
            }

            results.push({
                docId: row.doc_id,
                title: row.title,
                metadata: row.metadata,
                matchType,
                score,
                titleHighlight: row.title_highlight ?? undefined,
                contentHighlight: contentHighlight ?? undefined,
            });
        }

        // Sort by score descending (should already be sorted by SQL, but ensure consistency)
        return results.toSorted((a: AdvancedSearchResult, b: AdvancedSearchResult) => b.score - a.score);
    } catch (error) {
        console.error('[advancedSearch] Error:', error);
        // Fallback to simple LIKE search if advanced search fails
        return fallbackSearch(trimmedQuery);
    }
}

/**
 * Simple fallback search using LIKE pattern matching
 * Used when advanced search fails (e.g., extension not available)
 */
async function fallbackSearch(query: string): Promise<AdvancedSearchResult[]> {
    const db = await getDatabase();
    const searchPattern = `%${query.toLowerCase()}%`;

    const result = await db.query<{
        doc_id: string;
        title: string;
        plain_text_content: string;
        metadata: DocumentMetadata;
    }>(`
        SELECT doc_id, title, plain_text_content, metadata 
        FROM search_index 
        WHERE LOWER(title) LIKE $1 OR LOWER(plain_text_content) LIKE $1
        ORDER BY 
            CASE WHEN LOWER(title) LIKE $1 THEN 0 ELSE 1 END,
            (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST
        LIMIT 50
    `, [searchPattern]);

    const highlightRegex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');

    return result.rows.map((row, index) => {
        const isTitle = row.title.toLowerCase().includes(query.toLowerCase());

        // Extract context around match for content
        let contentHighlight: string | undefined;
        if (!isTitle && row.plain_text_content) {
            const lowerContent = row.plain_text_content.toLowerCase();
            const matchIndex = lowerContent.indexOf(query.toLowerCase());
            if (matchIndex >= 0) {
                const start = Math.max(0, matchIndex - 40);
                const end = Math.min(row.plain_text_content.length, matchIndex + query.length + 80);
                const snippet = row.plain_text_content.substring(start, end);
                // Add highlight markers
                contentHighlight = snippet.replace(highlightRegex, '<mark>$1</mark>');
                if (start > 0) contentHighlight = '...' + contentHighlight;
                if (end < row.plain_text_content.length) contentHighlight += '...';
            }
        }

        return {
            docId: row.doc_id,
            title: row.title,
            metadata: row.metadata,
            matchType: isTitle ? 'title' : 'content',
            score: 1 - (index * 0.01), // Simple decreasing score based on order
            titleHighlight: isTitle ? row.title : undefined,
            contentHighlight,
        };
    });
}

// App State persistence
export async function saveAppState(key: string, value: unknown): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `INSERT INTO app_state (key, value, updated_at) 
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE SET 
            value = EXCLUDED.value, 
            updated_at = CURRENT_TIMESTAMP`,
        [key, JSON.stringify(value)]
    );
}

export async function getAppState<T>(key: string): Promise<T | null> {
    const db = await getDatabase();
    const result = await db.query<{ value: T }>(
        'SELECT value FROM app_state WHERE key = $1',
        [key]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].value;
}

export async function deleteAppState(key: string): Promise<void> {
    const db = await getDatabase();
    await db.query('DELETE FROM app_state WHERE key = $1', [key]);
}


export async function upsertSyncRecord(record: SyncRecord): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `INSERT INTO sync_records (local_id, entity_type, remote_file_id, version_tag, last_synced_at, sync_status, content_hash, encrypted_key_header, author_odin_id, global_transit_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (local_id) DO UPDATE SET
           entity_type = EXCLUDED.entity_type,
           remote_file_id = EXCLUDED.remote_file_id,
           version_tag = EXCLUDED.version_tag,
           last_synced_at = EXCLUDED.last_synced_at,
           sync_status = EXCLUDED.sync_status,
           content_hash = EXCLUDED.content_hash,
           encrypted_key_header = EXCLUDED.encrypted_key_header,
           author_odin_id = EXCLUDED.author_odin_id,
           global_transit_id = EXCLUDED.global_transit_id`,
        [
            record.localId,
            record.entityType,
            record.remoteFileId || null,
            record.versionTag || null,
            record.lastSyncedAt || null,
            record.syncStatus,
            record.contentHash || null,
            record.encryptedKeyHeader || null,
            record.authorOdinId || null,
            record.globalTransitId || null,
        ]
    );
}

export async function getSyncRecord(localId: string): Promise<SyncRecord | null> {
    const db = await getDatabase();
    const result = await db.query<{
        local_id: string;
        entity_type: 'folder' | 'note';
        remote_file_id: string | null;
        version_tag: string | null;
        last_synced_at: string | null;
        sync_status: 'pending' | 'synced' | 'conflict' | 'error';
        content_hash: string | null;
        encrypted_key_header: string | null;
        author_odin_id: string | null;
        global_transit_id: string | null;
        dirty_generation: number;
    }>(
        'SELECT local_id, entity_type, remote_file_id, version_tag, last_synced_at, sync_status, content_hash, encrypted_key_header, author_odin_id, global_transit_id, dirty_generation FROM sync_records WHERE local_id = $1',
        [localId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
        localId: row.local_id,
        entityType: row.entity_type,
        remoteFileId: row.remote_file_id || undefined,
        versionTag: row.version_tag || undefined,
        lastSyncedAt: row.last_synced_at || undefined,
        syncStatus: row.sync_status,
        contentHash: row.content_hash || undefined,
        encryptedKeyHeader: row.encrypted_key_header || undefined,
        authorOdinId: row.author_odin_id || undefined,
        globalTransitId: row.global_transit_id || undefined,
        dirtyGeneration: row.dirty_generation ?? 0,
    };
}

export async function getSyncRecordByRemoteId(remoteFileId: string): Promise<SyncRecord | null> {
    const db = await getDatabase();
    const result = await db.query<{
        local_id: string;
        entity_type: 'folder' | 'note';
        remote_file_id: string | null;
        version_tag: string | null;
        last_synced_at: string | null;
        sync_status: 'pending' | 'synced' | 'conflict' | 'error';
    }>(
        'SELECT local_id, entity_type, remote_file_id, version_tag, last_synced_at, sync_status, content_hash FROM sync_records WHERE remote_file_id = $1',
        [remoteFileId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
        localId: row.local_id,
        entityType: row.entity_type,
        remoteFileId: row.remote_file_id || undefined,
        versionTag: row.version_tag || undefined,
        lastSyncedAt: row.last_synced_at || undefined,
        syncStatus: row.sync_status,
    };
}

export async function getPendingSyncRecords(entityType?: 'folder' | 'note'): Promise<SyncRecord[]> {
    const db = await getDatabase();
    const query = entityType
        ? `SELECT local_id, entity_type, remote_file_id, version_tag, last_synced_at, sync_status, content_hash, encrypted_key_header, author_odin_id, global_transit_id, dirty_generation
           FROM sync_records WHERE sync_status = 'pending' AND entity_type = $1`
        : `SELECT local_id, entity_type, remote_file_id, version_tag, last_synced_at, sync_status, content_hash, encrypted_key_header, author_odin_id, global_transit_id, dirty_generation
           FROM sync_records WHERE sync_status = 'pending'`;
    const params = entityType ? [entityType] : [];
    const result = await db.query<{
        local_id: string;
        entity_type: 'folder' | 'note';
        remote_file_id: string | null;
        version_tag: string | null;
        last_synced_at: string | null;
        sync_status: 'pending' | 'synced' | 'conflict' | 'error';
        content_hash: string | null;
        encrypted_key_header: string | null;
        author_odin_id: string | null;
        global_transit_id: string | null;
        dirty_generation: number;
    }>(query, params);
    return result.rows.map(row => ({
        localId: row.local_id,
        entityType: row.entity_type,
        remoteFileId: row.remote_file_id || undefined,
        versionTag: row.version_tag || undefined,
        lastSyncedAt: row.last_synced_at || undefined,
        syncStatus: row.sync_status,
        contentHash: row.content_hash || undefined,
        encryptedKeyHeader: row.encrypted_key_header || undefined,
        authorOdinId: row.author_odin_id || undefined,
        globalTransitId: row.global_transit_id || undefined,
        dirtyGeneration: row.dirty_generation ?? 0,
    }));
}

export async function markSynced(localId: string, remoteFileId: string, versionTag: string, contentHash?: string, encryptedKeyHeader?: string, authorOdinId?: string, globalTransitId?: string, expectedGeneration?: number): Promise<void> {
    const db = await getDatabase();
    // Generation guard: when the caller snapshotted a dirty_generation (from the
    // record it read before a slow push), only promote to 'synced' if no edit has
    // bumped the generation since — otherwise an edit made DURING the push would be
    // clobbered back to synced. version_tag/content_hash/key header are ALWAYS
    // recorded so a superseded push still captures what the server now has.
    await db.query(
        `UPDATE sync_records SET
           remote_file_id = $2,
           version_tag = $3,
           last_synced_at = CURRENT_TIMESTAMP,
           sync_status = CASE WHEN $8::int IS NULL OR dirty_generation = $8::int THEN 'synced' ELSE sync_status END,
           content_hash = $4,
           encrypted_key_header = COALESCE($5, encrypted_key_header),
           author_odin_id = COALESCE($6, author_odin_id),
           global_transit_id = COALESCE($7, global_transit_id)
         WHERE local_id = $1`,
        [localId, remoteFileId, versionTag, contentHash || null, encryptedKeyHeader || null, authorOdinId || null, globalTransitId || null, expectedGeneration ?? null]
    );
}

export async function updateSyncStatus(localId: string, status: SyncRecord['syncStatus']): Promise<void> {
    const db = await getDatabase();
    // Every write that sets 'pending' bumps dirty_generation so a concurrent push's
    // markSynced (which snapshotted the old generation) cannot clobber it.
    await db.query(
        `UPDATE sync_records SET
           sync_status = $2,
           dirty_generation = dirty_generation + CASE WHEN $2 = 'pending' THEN 1 ELSE 0 END
         WHERE local_id = $1`,
        [localId, status]
    );
}

export async function deleteSyncRecord(localId: string): Promise<void> {
    const db = await getDatabase();
    await db.query('DELETE FROM sync_records WHERE local_id = $1', [localId]);
}

// Pending Image Uploads

export async function savePendingImageUpload(upload: PendingImageUpload): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `INSERT INTO pending_image_uploads (id, note_doc_id, blob_data, content_type, status, retry_count, payload_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           retry_count = EXCLUDED.retry_count,
           payload_key = EXCLUDED.payload_key`,
        [
            upload.id,
            upload.noteDocId,
            upload.blobData,
            upload.contentType,
            upload.status,
            upload.retryCount,
            upload.payloadKey || null,
            upload.createdAt,
        ]
    );
}

export async function getPendingImageUploads(noteDocId?: string): Promise<PendingImageUpload[]> {
    const db = await getDatabase();
    const query = noteDocId
        ? `SELECT id, note_doc_id, blob_data, content_type, status, retry_count, payload_key, created_at 
           FROM pending_image_uploads WHERE note_doc_id = $1 AND status != 'synced' ORDER BY created_at ASC`
        : `SELECT id, note_doc_id, blob_data, content_type, status, retry_count, payload_key, created_at 
           FROM pending_image_uploads WHERE status != 'synced' ORDER BY created_at ASC`;
    const params = noteDocId ? [noteDocId] : [];
    const result = await db.query<{
        id: string;
        note_doc_id: string;
        blob_data: Uint8Array;
        content_type: string;
        status: 'pending' | 'uploading' | 'failed';
        retry_count: number;
        payload_key: string | null;
        created_at: string;
    }>(query, params);
    return result.rows.map(row => ({
        id: row.id,
        noteDocId: row.note_doc_id,
        blobData: row.blob_data,
        contentType: row.content_type,
        status: row.status,
        retryCount: row.retry_count,
        payloadKey: row.payload_key || undefined,
        createdAt: row.created_at,
    }));
}

export async function updateImageUploadStatus(id: string, status: string, payloadKey?: string): Promise<void> {
    const db = await getDatabase();
    if (payloadKey) {
        await db.query('UPDATE pending_image_uploads SET status = $2, payload_key = $3 WHERE id = $1', [id, status, payloadKey]);
    } else {
        await db.query('UPDATE pending_image_uploads SET status = $2 WHERE id = $1', [id, status]);
    }
}

export async function incrementImageRetryCount(id: string): Promise<void> {
    const db = await getDatabase();
    await db.query('UPDATE pending_image_uploads SET retry_count = retry_count + 1 WHERE id = $1', [id]);
}

export async function deletePendingImageUpload(id: string): Promise<void> {
    const db = await getDatabase();
    await db.query('DELETE FROM pending_image_uploads WHERE id = $1', [id]);
}



/**
 * Get count of pending sync items for UI display
 */
export async function getPendingSyncCount(): Promise<{ notes: number; folders: number; images: number }> {
    const db = await getDatabase();

    const notesResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM sync_records WHERE entity_type = 'note' AND sync_status = 'pending'`
    );

    const foldersResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM sync_records WHERE entity_type = 'folder' AND sync_status = 'pending'`
    );

    const imagesResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM pending_image_uploads WHERE status != 'synced'`
    );

    return {
        notes: parseInt(notesResult.rows[0]?.count || '0', 10),
        folders: parseInt(foldersResult.rows[0]?.count || '0', 10),
        images: parseInt(imagesResult.rows[0]?.count || '0', 10),
    };
}

// ============================================
// Logout: Clear all local data
// ============================================

/**
 * Check if there are any pending (unsynced) changes.
 * Use this to warn the user before logout.
 */
export async function hasPendingChanges(): Promise<boolean> {
    const counts = await getPendingSyncCount();
    return counts.notes > 0 || counts.folders > 0 || counts.images > 0;
}

/**
 * Clear ALL local data. Call this on logout to prevent
 * data mixing between different Homebase identities.
 * 
 * WARNING: This is destructive and irreversible!
 */
export async function clearAllLocalData(): Promise<void> {
    const db = await getDatabase();

    console.log('[clearAllLocalData] Clearing all local data for logout...');

    await db.exec(`
        -- Clear all document content
        DELETE FROM document_updates;
        DELETE FROM search_index;
        
        -- Clear all folders (including Main - will be recreated on next login)
        DELETE FROM folders;
        
        -- Clear sync tracking
        DELETE FROM sync_records;
        DELETE FROM pending_image_uploads;
        DELETE FROM pending_image_deletions;
        DELETE FROM sync_errors;
        
        -- Clear job queue
        DELETE FROM job_queue;
        
        -- Clear app state (session, last sync time, etc.)
        DELETE FROM app_state;
    `);

    // Drop cached row identities so a re-login can't serve entries for wiped notes.
    clearNoteListEntryCache();

    console.log('[clearAllLocalData] All local data cleared successfully');
}

// ============================================
// Sync Error Tracking
// ============================================

/**
 * Save a sync error for tracking and retry
 */
export async function saveSyncError(error: Omit<SyncError, 'id' | 'createdAt'>): Promise<number> {
    const db = await getDatabase();
    const result = await db.query<{ id: number }>(
        `INSERT INTO sync_errors (entity_id, entity_type, operation, error_message, error_code, retry_count, next_retry_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
            error.entityId,
            error.entityType,
            error.operation,
            error.errorMessage,
            error.errorCode || null,
            error.retryCount,
            error.nextRetryAt || null,
        ]
    );
    return result.rows[0].id;
}

/**
 * Get all unresolved sync errors
 */
export async function getUnresolvedSyncErrors(): Promise<SyncError[]> {
    const db = await getDatabase();
    const result = await db.query<{
        id: number;
        entity_id: string;
        entity_type: 'folder' | 'note' | 'image';
        operation: 'push' | 'pull' | 'upload';
        error_message: string;
        error_code: string | null;
        retry_count: number;
        next_retry_at: string | null;
        created_at: string;
    }>(
        `SELECT id, entity_id, entity_type, operation, error_message, error_code, retry_count, next_retry_at, created_at
         FROM sync_errors WHERE resolved_at IS NULL 
         ORDER BY created_at DESC`
    );
    return result.rows.map(row => ({
        id: row.id,
        entityId: row.entity_id,
        entityType: row.entity_type,
        operation: row.operation,
        errorMessage: row.error_message,
        errorCode: row.error_code || undefined,
        retryCount: row.retry_count,
        nextRetryAt: row.next_retry_at || undefined,
        createdAt: row.created_at,
    }));
}

/**
 * Mark a sync error as resolved
 */
export async function resolveSyncError(errorId: number): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `UPDATE sync_errors SET resolved_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [errorId]
    );
}

/**
 * Resolve all errors for an entity (e.g., after successful sync)
 */
export async function resolveSyncErrorsForEntity(entityId: string): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `UPDATE sync_errors SET resolved_at = CURRENT_TIMESTAMP 
         WHERE entity_id = $1 AND resolved_at IS NULL`,
        [entityId]
    );
}

/**
 * Clear all resolved errors older than specified days
 */
export async function clearOldSyncErrors(daysOld: number = 7): Promise<number> {
    const db = await getDatabase();
    const result = await db.query(
        `DELETE FROM sync_errors 
         WHERE resolved_at IS NOT NULL 
         AND resolved_at < CURRENT_TIMESTAMP - INTERVAL '${daysOld} days'`
    );
    return result.affectedRows || 0;
}

/**
 * Get count of unresolved sync errors
 */
export async function getSyncErrorCount(): Promise<number> {
    const db = await getDatabase();
    const result = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM sync_errors WHERE resolved_at IS NULL`
    );
    return parseInt(result.rows[0]?.count || '0', 10);
}

// ============================================
// Migration: Create sync records for existing data
// ============================================

/**
 * Check if migration is needed (any notes/folders without sync records)
 */
export async function needsSyncMigration(): Promise<boolean> {
    const db = await getDatabase();

    // Check for notes without sync records
    const notesResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM search_index s 
         WHERE NOT EXISTS (SELECT 1 FROM sync_records r WHERE r.local_id = s.doc_id)`
    );

    // Check for folders without sync records
    const foldersResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM folders f 
         WHERE NOT EXISTS (SELECT 1 FROM sync_records r WHERE r.local_id = f.id)`
    );

    const notesCount = parseInt(notesResult.rows[0]?.count || '0', 10);
    const foldersCount = parseInt(foldersResult.rows[0]?.count || '0', 10);

    return notesCount > 0 || foldersCount > 0;
}

/**
 * Migrate existing notes and folders by creating sync records.
 * Only creates records for entities that don't have one yet.
 * Returns the number of records created.
 */
export async function migrateExistingDataToSync(): Promise<{ notes: number; folders: number }> {
    const db = await getDatabase();

    // Create sync records for notes without them
    const notesResult = await db.query(
        `INSERT INTO sync_records (local_id, entity_type, sync_status)
         SELECT s.doc_id, 'note', 'pending'
         FROM search_index s
         WHERE NOT EXISTS (SELECT 1 FROM sync_records r WHERE r.local_id = s.doc_id)
         ON CONFLICT (local_id) DO NOTHING`
    );

    // Create sync records for folders without them
    const foldersResult = await db.query(
        `INSERT INTO sync_records (local_id, entity_type, sync_status)
         SELECT f.id, 'folder', 'pending'
         FROM folders f
         WHERE NOT EXISTS (SELECT 1 FROM sync_records r WHERE r.local_id = f.id)
         ON CONFLICT (local_id) DO NOTHING`
    );

    return {
        notes: notesResult.affectedRows || 0,
        folders: foldersResult.affectedRows || 0,
    };
}

// ============================================
// Exponential Backoff Helpers
// ============================================

/**
 * Calculate next retry time using exponential backoff
 */
export function calculateNextRetryAt(retryCount: number, baseDelayMs: number = 5000): Date {
    // Exponential backoff: 5s, 10s, 20s, 40s, 80s, etc. with max of 5 minutes
    const delayMs = Math.min(baseDelayMs * Math.pow(2, retryCount), 5 * 60 * 1000);
    return new Date(Date.now() + delayMs);
}

/**
 * Update image upload with next retry time
 */
export async function updateImageRetryAt(id: string, nextRetryAt: Date): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `UPDATE pending_image_uploads SET next_retry_at = $2 WHERE id = $1`,
        [id, nextRetryAt.toISOString()]
    );
}

/**
 * Get image uploads that are ready for retry (next_retry_at has passed or is null)
 */
export async function getImageUploadsReadyForRetry(): Promise<PendingImageUpload[]> {
    const db = await getDatabase();
    const result = await db.query<{
        id: string;
        note_doc_id: string;
        blob_data: Uint8Array;
        content_type: string;
        status: 'pending' | 'uploading' | 'failed';
        retry_count: number;
        payload_key: string | null;
        next_retry_at: string | null;
        created_at: string;
    }>(
        `SELECT id, note_doc_id, blob_data, content_type, status, retry_count, payload_key, next_retry_at, created_at 
         FROM pending_image_uploads 
         WHERE status != 'synced' 
         AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
         ORDER BY created_at ASC`
    );
    return result.rows.map(row => ({
        id: row.id,
        noteDocId: row.note_doc_id,
        blobData: row.blob_data,
        contentType: row.content_type,
        status: row.status,
        retryCount: row.retry_count,
        payloadKey: row.payload_key || undefined,
        createdAt: row.created_at,
    }));
}

// ============================================
// Pending Image Deletions (for tracking remote payloads to delete)
// ============================================

/**
 * Save a pending image deletion (image was removed from editor)
 */
export async function savePendingImageDeletion(noteDocId: string, payloadKey: string): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `INSERT INTO pending_image_deletions (note_doc_id, payload_key)
         VALUES ($1, $2)
         ON CONFLICT (note_doc_id, payload_key) DO NOTHING`,
        [noteDocId, payloadKey]
    );
}

/**
 * Get all pending image deletions for a note
 */
export async function getPendingImageDeletions(noteDocId: string): Promise<string[]> {
    const db = await getDatabase();
    const result = await db.query<{ payload_key: string }>(
        `SELECT payload_key FROM pending_image_deletions WHERE note_doc_id = $1`,
        [noteDocId]
    );
    return result.rows.map(row => row.payload_key);
}

/**
 * Clear pending image deletions for a note (after successful sync)
 */
export async function clearPendingImageDeletions(noteDocId: string): Promise<void> {
    const db = await getDatabase();
    await db.query('DELETE FROM pending_image_deletions WHERE note_doc_id = $1', [noteDocId]);
}

// ============================================
// Tags
// ============================================

/**
 * Get all distinct tags across all notes, sorted alphabetically.
 */
export async function getAllTags(): Promise<string[]> {
    const db = await getDatabase();
    const result = await db.query<{ tag: string }>(
        `SELECT DISTINCT jsonb_array_elements_text(metadata->'tags') AS tag
         FROM search_index
         WHERE jsonb_array_length(COALESCE(metadata->'tags', '[]'::jsonb)) > 0
         ORDER BY tag`
    );
    return result.rows.map(row => row.tag);
}

/**
 * Lightweight query for the note list sidebar, filtered by tag.
 * Returns only title, a short preview, and metadata — NOT full content.
 * Pinned notes appear first, then sorted by updated_at descending.
 */
export async function getNotesForListByTag(tag: string): Promise<NoteListEntry[]> {
    const db = await getDatabase();
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
           AND ${ACTIVE_NOTES_FILTER}
         ORDER BY
            (metadata->>'isPinned')::boolean DESC NULLS LAST,
            updated_at DESC`,
        [tag]
    );
    return result.rows.map(toNoteListEntry);
}
