/**
 * `ReadDeps` over the app's local PGlite database, for the in-app agent (#697). Every
 * folder is granted 'write', so `resolveAccess` still hides `excludeFromAI` and locked notes
 * (#1427); trashed notes are left out here.
 */
import { matchesSearchFilters, type NoteSummary, type ReadDeps } from '@/lib/agent/tools/read';
import type { AgentGrants } from '@/lib/agent/grants';
import { toMarkdown } from '@/lib/agent/editEngine';
import { getDatabase } from '@/lib/db/pglite';
import { getAllFolders } from '@/lib/db/queries/folders';
import { advancedSearch } from '@/lib/db/queries/search';
import { LOCKED_NOTE } from '@/lib/db/queries/shared';
import { loadLocalYDoc } from '@/lib/yjs/loadDoc';
import type { DocumentMetadata } from '@/types';

const TRASHED = 2;
const SNIPPET_LENGTH = 300;

function toSummary(docId: string, title: string, metadata: DocumentMetadata, locked: boolean): NoteSummary {
    return {
        id: docId,
        title,
        folderId: metadata.folderId,
        tags: metadata.tags ?? [],
        modified: metadata.timestamps.modified,
        excludeFromAI: metadata.excludeFromAI,
        locked,
    };
}

/** The ids of every locked note: locked itself or in a locked folder (#1427). */
async function lockedNoteIds(): Promise<Set<string>> {
    const db = await getDatabase();
    const { rows } = await db.query<{ doc_id: string }>(`SELECT doc_id FROM search_index WHERE ${LOCKED_NOTE}`);
    return new Set(rows.map((row) => row.doc_id));
}

const isTrashed = (metadata: DocumentMetadata) => metadata.archivalStatus === TRASHED;

const toSnippet = (highlight: string | undefined) =>
    (highlight ?? '').replace(/<\/?mark>/g, '').slice(0, SNIPPET_LENGTH);

/** One note's summary, metadata and Yjs doc; null when it is missing, trashed or has no stored updates. */
export async function loadLocalNote(id: string) {
    const db = await getDatabase();
    const { rows } = await db.query<{ title: string; metadata: DocumentMetadata; locked: boolean }>(
        `SELECT title, metadata, ${LOCKED_NOTE} AS locked FROM search_index WHERE doc_id = $1`,
        [id]
    );
    if (rows.length === 0 || isTrashed(rows[0].metadata)) return null;
    const doc = await loadLocalYDoc(id);
    if (!doc) return null;
    return { summary: toSummary(id, rows[0].title, rows[0].metadata, rows[0].locked), metadata: rows[0].metadata, doc };
}

export function createLocalDeps(): ReadDeps {
    const listFolders = async () => (await getAllFolders()).map(({ id, name, isPublic }) => ({ id, name, isPublic }));

    return {
        listFolders,

        async loadGrants(): Promise<AgentGrants> {
            const folders = await listFolders();
            return { version: 1, folders: Object.fromEntries(folders.map((f) => [f.id, 'write' as const])), notes: {} };
        },

        async listNotes() {
            const db = await getDatabase();
            const { rows } = await db.query<{ doc_id: string; title: string; metadata: DocumentMetadata; locked: boolean }>(
                `SELECT doc_id, title, metadata, ${LOCKED_NOTE} AS locked FROM search_index
                 WHERE COALESCE((metadata->>'archivalStatus')::int, 0) <> ${TRASHED}`
            );
            return rows.map((row) => toSummary(row.doc_id, row.title, row.metadata, row.locked));
        },

        async getNote(id, targets) {
            const note = await loadLocalNote(id);
            return note && { summary: note.summary, markdown: toMarkdown(note.doc, targets) };
        },

        async searchNotes(query, _limit, filters = {}) {
            const locked = await lockedNoteIds();
            const hits = (await advancedSearch(query, { includeArchived: true })).map((hit) => ({
                summary: toSummary(hit.docId, hit.title, hit.metadata, locked.has(hit.docId)),
                snippet: toSnippet(hit.contentHighlight ?? hit.titleHighlight),
            }));
            // advancedSearch looks at the text, not the tags: a query that is exactly a tag also finds its notes.
            const tag = query.trim();
            if (tag) {
                const db = await getDatabase();
                const { rows } = await db.query<{ doc_id: string; title: string; metadata: DocumentMetadata }>(
                    `SELECT doc_id, title, metadata FROM search_index
                     WHERE metadata->'tags' ? $1 AND COALESCE((metadata->>'archivalStatus')::int, 0) <> ${TRASHED}`,
                    [tag]
                );
                const found = new Set(hits.map((hit) => hit.summary.id));
                for (const row of rows) {
                    if (!found.has(row.doc_id)) hits.push({ summary: toSummary(row.doc_id, row.title, row.metadata, locked.has(row.doc_id)), snippet: '' });
                }
            }
            return hits.filter((hit) => matchesSearchFilters(hit.summary, filters));
        },
    };
}
