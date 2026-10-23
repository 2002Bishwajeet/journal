/**
 * `ReadDeps` over the app's local PGlite database, for the in-app agent (#697). Every
 * folder is granted 'write', so `resolveAccess` still hides `excludeFromAI` notes; trashed
 * notes are left out here.
 */
import type { NoteSummary, ReadDeps } from '@/lib/agent/tools/read';
import type { AgentGrants } from '@/lib/agent/grants';
import { toMarkdown } from '@/lib/agent/editEngine';
import { getDatabase } from '@/lib/db/pglite';
import { getAllFolders } from '@/lib/db/queries/folders';
import { advancedSearch } from '@/lib/db/queries/search';
import { loadLocalYDoc } from '@/lib/yjs/loadDoc';
import type { DocumentMetadata } from '@/types';

const TRASHED = 2;
const SNIPPET_LENGTH = 300;

function toSummary(docId: string, title: string, metadata: DocumentMetadata): NoteSummary {
    return {
        id: docId,
        title,
        folderId: metadata.folderId,
        tags: metadata.tags ?? [],
        modified: metadata.timestamps.modified,
        excludeFromAI: metadata.excludeFromAI,
    };
}

const isTrashed = (metadata: DocumentMetadata) => metadata.archivalStatus === TRASHED;

const toSnippet = (highlight: string | undefined) =>
    (highlight ?? '').replace(/<\/?mark>/g, '').slice(0, SNIPPET_LENGTH);

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
            const { rows } = await db.query<{ doc_id: string; title: string; metadata: DocumentMetadata }>(
                `SELECT doc_id, title, metadata FROM search_index
                 WHERE COALESCE((metadata->>'archivalStatus')::int, 0) <> ${TRASHED}`
            );
            return rows.map((row) => toSummary(row.doc_id, row.title, row.metadata));
        },

        async getNote(id, targets) {
            const db = await getDatabase();
            const { rows } = await db.query<{ title: string; metadata: DocumentMetadata }>(
                'SELECT title, metadata FROM search_index WHERE doc_id = $1',
                [id]
            );
            if (rows.length === 0 || isTrashed(rows[0].metadata)) return null;
            const doc = await loadLocalYDoc(id);
            if (!doc) return null;
            return { summary: toSummary(id, rows[0].title, rows[0].metadata), markdown: toMarkdown(doc, targets) };
        },

        async searchNotes(query) {
            const hits = await advancedSearch(query);
            return hits
                .filter((hit) => !isTrashed(hit.metadata))
                .map((hit) => ({
                    summary: toSummary(hit.docId, hit.title, hit.metadata),
                    snippet: toSnippet(hit.contentHighlight ?? hit.titleHighlight),
                }));
        },
    };
}
