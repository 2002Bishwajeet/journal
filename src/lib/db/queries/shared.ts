// Notes with archivalStatus 2 (Homebase "Removed") live in the Trash — exclude them
// from every active-note list. Single source of truth for the filter.
// Active = not archived (1) and not trashed (2).
const ACTIVE_NOTES_FILTER = `COALESCE((metadata->>'archivalStatus')::int, 0) = 0`;

// A note is locked (#1427) when it or its folder is. `row` names the search_index row.
const lockedNote = (row = 'search_index') => `(COALESCE((${row}.metadata->>'locked')::boolean, false)
    OR EXISTS (SELECT 1 FROM folders lf WHERE lf.locked AND lf.id::text = ${row}.metadata->>'folderId'))`;
const LOCKED_NOTE = lockedNote();

// Shared SQL for note-list reads — used by both the imperative getters and the
// live-query hooks so they never drift. Row key for note queries is 'doc_id'.
// A locked note's preview is never read.
const NOTE_LIST_SELECT = `SELECT doc_id, title, CASE WHEN ${LOCKED_NOTE} THEN '' ELSE LEFT(plain_text_content, 150) END as preview, metadata, ${LOCKED_NOTE} AS locked FROM search_index`;
// Text comparison, not ::timestamp — every writer stores toISOString() output,
// where lexicographic order == chronological order, and sorting the raw text
// lets idx_search_metadata_modified serve the sort (a text→timestamp cast
// isn't IMMUTABLE, so it can't be indexed).
const MODIFIED_DESC = `ORDER BY metadata->'timestamps'->>'modified' DESC NULLS LAST`;

export { ACTIVE_NOTES_FILTER, NOTE_LIST_SELECT, MODIFIED_DESC, LOCKED_NOTE, lockedNote };
