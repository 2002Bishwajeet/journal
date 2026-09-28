/**
 * Pure read-tool handlers for the Journal MCP server (#167). Depend only on injected
 * `ReadDeps` and the pure grants resolver (#165/#164) — no SDK, no drive access — so they
 * can be unit-tested with fakes and reused by the real server (mcp/drive.ts implements
 * ReadDeps against Homebase).
 */
import { resolveAccess, folderAccess, type AgentAccess, type AgentGrants } from '@/lib/agent/grants';

export interface NoteSummary {
    id: string;
    title: string;
    folderId: string;
    tags: string[];
    modified: string;
    excludeFromAI?: boolean;
}

export interface ReadDeps {
    loadGrants(): Promise<AgentGrants>;
    listFolders(): Promise<{ id: string; name: string }[]>;
    listNotes(): Promise<NoteSummary[]>;
    getNote(id: string): Promise<{ summary: NoteSummary; markdown: string } | null>;
}

export interface FolderResult {
    id: string;
    name: string;
    access: AgentAccess;
}

export interface NoteListResult {
    id: string;
    title: string;
    folderId: string;
    modified: string;
    tags: string[];
    access: AgentAccess;
}

export interface NoteResult extends NoteListResult {
    markdown: string;
}

const DEFAULT_LIST_NOTES_LIMIT = 50;
const MAX_LIST_NOTES_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 20;

function noteAccess(grants: AgentGrants, note: NoteSummary): AgentAccess {
    return resolveAccess(grants, { noteId: note.id, folderId: note.folderId, excludeFromAI: note.excludeFromAI });
}

export async function listFolders(deps: ReadDeps): Promise<FolderResult[]> {
    const [grants, folders] = await Promise.all([deps.loadGrants(), deps.listFolders()]);
    return folders
        .map((folder) => ({ ...folder, access: folderAccess(grants, folder.id) }))
        .filter((folder) => folder.access !== 'none');
}

export async function listNotes(
    deps: ReadDeps,
    params: { folderId?: string; limit?: number } = {}
): Promise<NoteListResult[]> {
    const limit = Math.min(params.limit ?? DEFAULT_LIST_NOTES_LIMIT, MAX_LIST_NOTES_LIMIT);
    const [grants, notes] = await Promise.all([deps.loadGrants(), deps.listNotes()]);

    return notes
        .filter((note) => !params.folderId || note.folderId === params.folderId)
        .map((note) => ({
            id: note.id,
            title: note.title,
            folderId: note.folderId,
            modified: note.modified,
            tags: note.tags,
            access: noteAccess(grants, note),
        }))
        .filter((note) => note.access !== 'none')
        .sort((a, b) => b.modified.localeCompare(a.modified))
        .slice(0, limit);
}

export async function getNote(deps: ReadDeps, params: { id: string }): Promise<NoteResult> {
    const [grants, result] = await Promise.all([deps.loadGrants(), deps.getNote(params.id)]);
    if (!result) throw new Error(`Note not found: ${params.id}`);

    const access = noteAccess(grants, result.summary);
    if (access === 'none') throw new Error(`Note not found: ${params.id}`);

    return {
        id: result.summary.id,
        title: result.summary.title,
        folderId: result.summary.folderId,
        modified: result.summary.modified,
        tags: result.summary.tags,
        access,
        markdown: result.markdown,
    };
}

export async function searchNotes(
    deps: ReadDeps,
    params: { query: string; limit?: number }
): Promise<NoteListResult[]> {
    const limit = params.limit ?? DEFAULT_SEARCH_LIMIT;
    const query = params.query.toLowerCase();
    const [grants, notes] = await Promise.all([deps.loadGrants(), deps.listNotes()]);

    const granted = notes
        .map((note) => ({ note, access: noteAccess(grants, note) }))
        .filter((entry): entry is { note: NoteSummary; access: AgentAccess } => entry.access !== 'none');

    const results: NoteListResult[] = [];
    for (const { note, access } of granted) {
        if (results.length >= limit) break;

        const titleOrTagHit =
            note.title.toLowerCase().includes(query) || note.tags.some((tag) => tag.toLowerCase().includes(query));

        // Never fetch the body of a note that didn't already match by title/tag unless
        // needed — and never for an ungranted note (already filtered out above).
        const bodyHit = titleOrTagHit ? false : ((await deps.getNote(note.id))?.markdown ?? '').toLowerCase().includes(query);

        if (titleOrTagHit || bodyHit) {
            results.push({
                id: note.id,
                title: note.title,
                folderId: note.folderId,
                modified: note.modified,
                tags: note.tags,
                access,
            });
        }
    }
    return results;
}
