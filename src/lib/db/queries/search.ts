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
                    OR search_vector @@ plainto_tsquery('journal', $1))
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
 * the query (score 6+), title starts with it (5+), title contains it or
 * matches the full-text query (4+), a tag matches it (3+), body full-text match
 * (2+), body substring (1), typo-tolerant title match (0.5 and below). Titles
 * and full text ignore accents (`cafe` finds "café", #1229). Inside a tier: rank
 * (ts_rank_cd), then newest. Tiers are a whole point apart, so
 * applyRecentBoost (+0.15 at most) only reorders rows inside one.
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
        plan.head && `websearch_to_tsquery('journal', $1)`,
        plan.prefix &&
            `(to_tsquery('journal', quote_literal($${plan.head ? 2 : 1})) || to_tsquery('simple', quote_literal(journal_unaccent($${plan.head ? 2 : 1})) || ':*'))`,
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

    const params = [tsq, plan.text, (/[\p{L}\p{N}]+/u.exec(plan.text)?.[0] ?? '').toLowerCase()];
    const param = (value: string) => `$${params.push(value)}`;
    // `t` is the lowercased, unaccented title, computed once per row. The title
    // is weight A in search_vector and the tags weight B, so the query
    // restricted to A matches in the title, and to B in the tags.
    const inWeight = (weight: string) =>
        tsq.replace(/('(?:[^']|'')*')(:\*)?/g, (_match, lexeme, star) => `${lexeme}:${star ? '*' : ''}${weight}`);
    const titleInFullText = tsq ? ` OR search_vector @@ ${param(inWeight('A'))}::tsquery` : '';
    // Version 1 rows (not rebuilt yet, searchReindex.ts) have the body at B.
    const inTags = tsq ? `WHEN vector_version = 2 AND search_vector @@ ${param(inWeight('B'))}::tsquery THEN 3` : '';
    const q = 'lower(journal_unaccent($2))';
    const tier = `CASE WHEN t = ${q} THEN 6
                       WHEN starts_with(t, ${q}) THEN 5
                       WHEN strpos(t, ${q}) > 0${titleInFullText} THEN 4
                       ${inTags}
                       ELSE 2 END`;
    // One UNION ALL branch per index: GIN full text, and the title (trigram
    // index once built). An OR across them would scan every note. OFFSET 0
    // keeps `t` from being inlined into every WHEN.
    const branch = (where: string, fts: boolean) =>
        `SELECT doc_id, ${tier} AS tier, ${fts} AS fts, modified
         FROM (SELECT s.doc_id, lower(journal_unaccent(s.title)) AS t, s.search_vector, s.vector_version, ${MODIFIED} AS modified
               FROM search_index s WHERE ${where} AND ${visible} OFFSET 0) b`;
    const branches = [
        tsq && branch('s.search_vector @@ $1::tsquery', true),
        titleBranch && branch(`journal_unaccent(s.title) ILIKE '%' || journal_unaccent(${param(plan.like)}) || '%'`, false),
    ].filter(Boolean);

    // ts_rank_cd costs ~15 µs a note, too much for a word in every note, so it
    // ranks only the 100 newest notes of the best tiers (a note in both
    // branches has the same tier and modified, so the newest 200 rows hold
    // them, full-text copy first; it is kept once, as a full-text hit), and
    // the best 50 of those are
    // returned. ts_headline only for those 50, and on ~2,000 characters around
    // a literal match of the query's first word: the first lowercase one, which
    // strpos finds without lowercasing the body, else the first in any case,
    // else the first without accents, else the body start.
    // enable_seqscan off: GIN's cost estimate for a prefix (`:*`) is so high that
    // the planner scans every note, reading every search_vector twice.
    const result = await db.transaction(async (tx) => {
        await tx.exec('SET LOCAL enable_seqscan = off');
        return tx.query<
            HitRow & { tier: number; rank: number; fts: boolean; title_highlight: string; content_highlight: string | null }
        >(
            `SELECT s.doc_id, s.title, s.metadata, top.tier, top.rank, top.fts,
                CASE WHEN top.fts THEN ts_headline('journal', s.title, $1::tsquery,
                    'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=5, MaxFragments=1')
                    ELSE s.title END AS title_highlight,
                CASE WHEN top.fts THEN ts_headline('journal',
                    SUBSTRING(s.plain_text_content FROM GREATEST(1, COALESCE(
                        NULLIF(strpos(s.plain_text_content, $3), 0),
                        NULLIF(strpos(lower(s.plain_text_content), $3), 0),
                        strpos(journal_unaccent(lower(s.plain_text_content)), journal_unaccent($3))) - 1000) FOR 2000),
                    $1::tsquery,
                    'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter= ... ')
                END AS content_highlight
             FROM (SELECT c.doc_id, c.tier, c.fts, c.modified,
                       CASE WHEN c.fts THEN ts_rank_cd(s.search_vector, $1::tsquery, 32) ELSE 0 END AS rank
                   FROM (SELECT * FROM (SELECT DISTINCT ON (doc_id) * FROM (${branches.join(' UNION ALL ')}
                                                                            ORDER BY tier DESC, modified DESC NULLS LAST, fts DESC
                                                                            LIMIT 200) u
                                        ORDER BY doc_id, fts DESC) d
                         ORDER BY tier DESC, modified DESC NULLS LAST
                         LIMIT 100) c
                   JOIN search_index s ON s.doc_id = c.doc_id
                   ORDER BY tier DESC, rank DESC, modified DESC NULLS LAST
                   LIMIT 50) top
             JOIN search_index s ON s.doc_id = top.doc_id
             ORDER BY top.tier DESC, top.rank DESC, top.modified DESC NULLS LAST`,
            params,
        );
    });
    return result.rows.map((row) => ({
        docId: row.doc_id,
        title: row.title,
        metadata: row.metadata,
        matchType: row.tier >= 4 ? 'title' : row.tier === 3 ? 'tag' : 'content',
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
    // Accent-sensitive, unlike the other stages: it runs on the trigram index of
    // the body as written, and an unaccented copy would double that index.
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
    // `<%`, not word_similarity() > x, so the title trigram index (on the
    // unaccented title) can serve it.
    await db.exec(`SET pg_trgm.word_similarity_threshold = 0.5`);
    const result = await db.query<HitRow & { similarity: number }>(
        `SELECT s.doc_id, s.title, s.metadata, word_similarity(journal_unaccent($1), journal_unaccent(s.title)) AS similarity
         FROM search_index s
         WHERE journal_unaccent($1) <% journal_unaccent(s.title) AND s.doc_id <> ALL($2::uuid[]) AND ${visible}
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
