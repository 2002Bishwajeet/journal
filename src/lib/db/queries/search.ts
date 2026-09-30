import { getDatabase, ensureTrigramSearch } from '../pglite';
import type { NoteListEntry, DocumentMetadata, AdvancedSearchResult } from '@/types';
import { ACTIVE_NOTES_FILTER, NOTE_LIST_SELECT, MODIFIED_DESC } from './shared';
import { toNoteListEntry, type NoteListRow } from './noteList';

/**
 * Fast search for the `[[` note-link picker: title substring match plus
 * stemmed full-text content match (search_vector), title hits first, then
 * newest. Deliberately NOT advancedSearch — no ts_headline snippets, no
 * pg_trgm similarity, no 50-row scan; this path runs per keystroke on the
 * single-threaded PGlite and must stay cheap.
 * Excludes the current note (self-link) and archived/trashed notes. An empty
 * query returns the most-recently-modified active notes.
 */
export async function searchNotesForPicker(
    query: string,
    excludeId?: string,
    limit = 8,
): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const trimmed = query.trim();

    if (trimmed) {
        const result = await db.query<NoteListRow>(
            `${NOTE_LIST_SELECT}
             WHERE (title ILIKE '%' || $1 || '%'
                    OR search_vector @@ plainto_tsquery('english', $1))
               AND ${ACTIVE_NOTES_FILTER}
               AND ($2::uuid IS NULL OR doc_id <> $2)
             ORDER BY (title ILIKE '%' || $1 || '%') DESC,
                      metadata->'timestamps'->>'modified' DESC NULLS LAST
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

/**
 * Notes most frequently linked TO, for the `[[` picker's "Frequent" section.
 * Frequency = how many active notes list the target in metadata.linkedNoteIds
 * (each linking note counts once — the array is deduped on save). This is the
 * only usage signal stored locally; there is no note-open tracking.
 * Excludes the current note and non-active targets.
 */
export async function getFrequentlyLinkedNotes(
    excludeId?: string,
    limit = 4,
): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const result = await db.query<NoteListRow>(
        `SELECT t.doc_id, t.title, LEFT(t.plain_text_content, 150) as preview, t.metadata
         FROM (
             SELECT linked.id AS target_id, COUNT(*) AS links
             FROM search_index s,
                  jsonb_array_elements_text(s.metadata->'linkedNoteIds') AS linked(id)
             WHERE ${ACTIVE_NOTES_FILTER}
             GROUP BY linked.id
         ) freq
         JOIN search_index t ON t.doc_id = freq.target_id::uuid
         WHERE ${ACTIVE_NOTES_FILTER}
           AND ($1::uuid IS NULL OR t.doc_id <> $1)
         ORDER BY freq.links DESC, metadata->'timestamps'->>'modified' DESC NULLS LAST
         LIMIT $2`,
        [excludeId ?? null, limit],
    );
    return result.rows.map(toNoteListEntry);
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
                -- Prioritize: FTS rank, then title similarity, then content match.
                -- Bare output aliases only — an alias inside an expression like
                -- COALESCE(fts_rank, 0) is invalid in ORDER BY ("column does not
                -- exist") and made this whole query silently fall back to LIKE.
                fts_rank DESC NULLS LAST,
                title_similarity DESC NULLS LAST,
                content_similarity DESC NULLS LAST
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
