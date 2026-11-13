import { getDatabase, ensureTrigramSearch } from '../pglite';
import type { NoteListEntry, DocumentMetadata, AdvancedSearchResult } from '@/types';
import { ACTIVE_NOTES_FILTER, NOTE_LIST_SELECT, MODIFIED_DESC } from './shared';
import { toNoteListEntry, type NoteListRow } from './noteList';
import { buildSearchPlan, type SearchPlan } from '@/lib/search/searchPlan';

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

// Trash (2) is never searchable; Archive (1) only when the caller opts in.
function visibilityFilter(includeArchived?: boolean): string {
    return includeArchived ? `COALESCE((s.metadata->>'archivalStatus')::int, 0) <> 2` : ACTIVE_NOTES_FILTER;
}

type Db = Awaited<ReturnType<typeof getDatabase>>;
interface HitRow {
    doc_id: string;
    title: string;
    metadata: DocumentMetadata;
}

const MODIFIED = `s.metadata->'timestamps'->>'modified'`;
// Below this many hits the next, slower stage runs.
const ENOUGH = 10;

/**
 * Search for the search dialog and the in-app agent (#1225). Staged so each
 * statement can use an index, and ordered in tiers, best first: title equals
 * the query (score 5+), title starts with it (4+), title contains it or
 * matches the full-text query (3+), body full-text match (2+), body substring
 * (1), typo-tolerant title match (0.5 and below). Inside a tier: rank, then
 * newest. Tiers are a whole point apart, so applyRecentBoost (+0.15 at most)
 * only reorders rows inside one.
 *
 * 1. Titles and full text, always. Needs no trigram index.
 * 2. Body substring, when stage 1 found fewer than 10 notes and the query has
 *    3+ characters: partial words longer than their stem (`meetin`), CJK, code.
 *    Waits for the lazy pg_trgm index build, which it uses.
 * 3. Typo-tolerant title match, when still fewer than 10 and 4+ characters.
 */
export async function advancedSearch(
    query: string,
    options: { includeArchived?: boolean } = {},
): Promise<AdvancedSearchResult[]> {
    const plan = buildSearchPlan(query);
    if (!plan.text) return [];
    const db = await getDatabase();
    const visible = visibilityFilter(options.includeArchived);
    const results: AdvancedSearchResult[] = [];
    try {
        results.push(...(await searchTitlesAndFullText(db, plan, visible)));
        if (results.length >= ENOUGH || plan.text.length < 3 || plan.kind === 'syntax') return results;
        await ensureTrigramSearch(db);
        results.push(...(await searchBodySubstring(db, plan, visible, results)));
        if (results.length >= ENOUGH || plan.text.length < 4 || plan.kind !== 'words') return results;
        results.push(...(await searchFuzzyTitles(db, plan, visible, results)));
    } catch (error) {
        console.error('[advancedSearch] Error:', error);
    }
    return results;
}

/** The full-text query as tsquery text; '' when there is none (only stop words, or symbols). */
async function fullTextQuery(db: Db, plan: SearchPlan): Promise<string> {
    if (plan.kind === 'symbols') return '';
    // The last word matches as its stem (`running` finds "runs") or as the
    // unstemmed start of a word (`init` finds "initiative"), so a word that is
    // not a stem yet (`runnin`) does not match everything that starts with `run`.
    const parts = [
        plan.head && `websearch_to_tsquery('english', $1)`,
        plan.prefix &&
            `(to_tsquery('english', quote_literal($${plan.head ? 2 : 1})) || to_tsquery('simple', quote_literal($${plan.head ? 2 : 1}) || ':*'))`,
    ].filter(Boolean);
    const { rows } = await db.query<{ tsq: string }>(
        `SELECT (${parts.join(' && ')})::text AS tsq`,
        [plan.head, plan.prefix].filter(Boolean),
    );
    return rows[0].tsq;
}

async function searchTitlesAndFullText(db: Db, plan: SearchPlan, visible: string): Promise<AdvancedSearchResult[]> {
    const tsq = await fullTextQuery(db, plan);
    const titleBranch = plan.kind !== 'syntax';
    if (!tsq && !titleBranch) return [];

    // The title is weight A in search_vector, so the query restricted to A matches in the title.
    const titleInFullText = tsq ? ` OR s.search_vector @@ $4::tsquery` : '';
    const tier = `CASE WHEN s.title ILIKE $2 THEN 5
                       WHEN s.title ILIKE $2 || '%' THEN 4
                       WHEN s.title ILIKE '%' || $2 || '%'${titleInFullText} THEN 3
                       ELSE 2 END`;
    // One UNION ALL branch per index: GIN full text, and the title (trigram
    // index once built). An OR across them would scan every note.
    const branches = [
        tsq &&
            `SELECT s.doc_id, ${tier} AS tier, ts_rank(s.search_vector, $1::tsquery, 32) AS rank, true AS fts, ${MODIFIED} AS modified
             FROM search_index s
             WHERE s.search_vector @@ $1::tsquery AND ${visible}`,
        titleBranch &&
            `SELECT s.doc_id, ${tier} AS tier, 0::real AS rank, false AS fts, ${MODIFIED} AS modified
             FROM search_index s
             WHERE s.title ILIKE '%' || $2 || '%' AND ${visible}
             ${tsq ? 'AND (s.search_vector @@ $1::tsquery) IS NOT TRUE' : ''}`,
    ].filter(Boolean);

    const params = [tsq, plan.like, (/[\p{L}\p{N}]+/u.exec(plan.text)?.[0] ?? '').toLowerCase()];
    if (tsq) params.push(tsq.replace(/('(?:[^']|'')*')(:\*)?/g, (_match, lexeme, star) => `${lexeme}:${star ? '*' : ''}A`));

    // ts_headline only for the rows returned, and on ~2,000 characters around
    // the first literal match of the query's first word (else the body start).
    // enable_seqscan off: GIN's cost estimate for a prefix (`:*`) is so high that
    // the planner scans every note, reading every search_vector twice.
    const result = await db.transaction(async (tx) => {
        await tx.exec('SET LOCAL enable_seqscan = off');
        return tx.query<
            HitRow & { tier: number; rank: number; fts: boolean; title_highlight: string; content_highlight: string | null }
        >(
            `SELECT s.doc_id, s.title, s.metadata, hit.tier, hit.rank, hit.fts,
                CASE WHEN hit.fts THEN ts_headline('english', s.title, $1::tsquery,
                    'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=5, MaxFragments=1')
                    ELSE s.title END AS title_highlight,
                CASE WHEN hit.fts THEN ts_headline('english',
                    SUBSTRING(s.plain_text_content FROM GREATEST(1, strpos(lower(s.plain_text_content), $3) - 1000) FOR 2000),
                    $1::tsquery,
                    'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter= ... ')
                END AS content_highlight
             FROM (${branches.join(' UNION ALL ')}
                   ORDER BY tier DESC, rank DESC, modified DESC NULLS LAST
                   LIMIT 50) hit
             JOIN search_index s ON s.doc_id = hit.doc_id
             ORDER BY hit.tier DESC, hit.rank DESC, hit.modified DESC NULLS LAST`,
            params,
        );
    });
    return result.rows.map((row) => ({
        docId: row.doc_id,
        title: row.title,
        metadata: row.metadata,
        matchType: row.tier >= 3 ? 'title' : 'content',
        score: row.tier + row.rank / 2,
        titleHighlight: row.title_highlight,
        contentHighlight: row.content_highlight ?? undefined,
    }));
}

async function searchBodySubstring(
    db: Db,
    plan: SearchPlan,
    visible: string,
    found: AdvancedSearchResult[],
): Promise<AdvancedSearchResult[]> {
    // Capped without an ORDER BY, so the trigram bitmap scan stops at 30 matches.
    const result = await db.query<HitRow & { snippet: string }>(
        `SELECT s.doc_id, s.title, s.metadata,
            SUBSTRING(s.plain_text_content FROM GREATEST(1, strpos(lower(s.plain_text_content), lower($2)) - 40) FOR 120) AS snippet
         FROM (SELECT s.doc_id FROM search_index s
               WHERE s.plain_text_content ILIKE '%' || $1 || '%' AND s.doc_id <> ALL($3::uuid[]) AND ${visible}
               LIMIT 30) hit
         JOIN search_index s ON s.doc_id = hit.doc_id
         ORDER BY ${MODIFIED} DESC NULLS LAST`,
        [plan.like, plan.text, found.map((r) => r.docId)],
    );
    const highlight = new RegExp(`(${plan.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return result.rows.map((row) => ({
        docId: row.doc_id,
        title: row.title,
        metadata: row.metadata,
        matchType: 'content',
        score: 1,
        contentHighlight: row.snippet.replace(highlight, '<mark>$1</mark>'),
    }));
}

async function searchFuzzyTitles(
    db: Db,
    plan: SearchPlan,
    visible: string,
    found: AdvancedSearchResult[],
): Promise<AdvancedSearchResult[]> {
    // `<%`, not word_similarity() > x, so the title trigram index can serve it.
    await db.exec(`SET pg_trgm.word_similarity_threshold = 0.5`);
    const result = await db.query<HitRow & { similarity: number }>(
        `SELECT s.doc_id, s.title, s.metadata, word_similarity($1, s.title) AS similarity
         FROM search_index s
         WHERE $1 <% s.title AND s.doc_id <> ALL($2::uuid[]) AND ${visible}
         ORDER BY similarity DESC, ${MODIFIED} DESC NULLS LAST
         LIMIT 10`,
        [plan.text, found.map((r) => r.docId)],
    );
    return result.rows.map((row) => ({
        docId: row.doc_id,
        title: row.title,
        metadata: row.metadata,
        matchType: 'fuzzy',
        score: row.similarity / 2,
    }));
}
