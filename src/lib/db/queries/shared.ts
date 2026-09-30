// Notes with archivalStatus 2 (Homebase "Removed") live in the Trash — exclude them
// from every active-note list. Single source of truth for the filter.
// Active = not archived (1) and not trashed (2).
const ACTIVE_NOTES_FILTER = `COALESCE((metadata->>'archivalStatus')::int, 0) = 0`;

// Shared SQL for note-list reads — used by both the imperative getters and the
// live-query hooks so they never drift. Row key for note queries is 'doc_id'.
const NOTE_LIST_SELECT = `SELECT doc_id, title, LEFT(plain_text_content, 150) as preview, metadata FROM search_index`;
// Text comparison, not ::timestamp — every writer stores toISOString() output,
// where lexicographic order == chronological order, and sorting the raw text
// lets idx_search_metadata_modified serve the sort (a text→timestamp cast
// isn't IMMUTABLE, so it can't be indexed).
const MODIFIED_DESC = `ORDER BY metadata->'timestamps'->>'modified' DESC NULLS LAST`;

export { ACTIVE_NOTES_FILTER, NOTE_LIST_SELECT, MODIFIED_DESC };
