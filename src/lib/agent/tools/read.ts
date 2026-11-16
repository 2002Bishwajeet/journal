/**
 * Pure read-tool handlers for the Journal MCP server (#167). Depend only on injected
 * `ReadDeps` and the pure grants resolver (#165/#164) — no SDK, no drive access — so they
 * can be unit-tested with fakes and reused by the real server (mcp/drive.ts implements
 * ReadDeps against Homebase).
 */
import { resolveAccess, folderAccess, type AgentAccess, type AgentGrants } from '@/lib/agent/grants';
import type { LinkTarget } from '@/lib/agent/editEngine';

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
    /** `isPublic`: a shared folder, whose new notes start public (#618). */
    listFolders(): Promise<{ id: string; name: string; isPublic?: boolean }[]>;
    listNotes(): Promise<NoteSummary[]>;
    /** With `targets`, a link to a note not in it is only its label in the markdown (#561). */
    getNote(id: string, targets?: readonly LinkTarget[]): Promise<{ summary: NoteSummary; markdown: string } | null>;
    /** Ranked full-text hits with a short snippet. When absent, `searchNotes` scans note bodies instead. */
    searchNotes?(query: string, limit: number, filters?: SearchFilters): Promise<{ summary: NoteSummary; snippet: string }[]>;
    /** The note's plain text, for searching. When absent, `searchNotes` searches `getNote(...).markdown`. Never called for an ungranted note. */
    getNoteText?(note: NoteSummary): Promise<string | null>;
}

/** What `search_notes` narrows the notes to before it looks at any body. `tag` is exact; the dates are ISO, `modifiedAfter` inclusive and `modifiedBefore` exclusive. */
export interface SearchFilters {
    folderId?: string;
    tag?: string;
    modifiedAfter?: string;
    modifiedBefore?: string;
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

export interface NoteSearchResult extends NoteListResult {
    snippet?: string;
}

export interface NoteResult extends NoteListResult {
    markdown: string;
}

/** The fields `list_notes` can return; `access` is added only when a note is read-only. */
export const NOTE_LIST_FIELDS = ['id', 'title', 'folderId', 'modified', 'tags'] as const;
export type NoteListField = (typeof NOTE_LIST_FIELDS)[number];
const DEFAULT_LIST_FIELDS: readonly NoteListField[] = ['id', 'title', 'folderId', 'modified'];

const DEFAULT_LIST_NOTES_LIMIT = 50;
const MAX_LIST_NOTES_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 100;
const SNIPPET_LENGTH = 200;
/** Body fetches in flight at once while searching. */
const SEARCH_CONCURRENCY = 8;

export function noteAccess(grants: AgentGrants, note: NoteSummary): AgentAccess {
    return resolveAccess(grants, { noteId: note.id, folderId: note.folderId, excludeFromAI: note.excludeFromAI });
}

/** The notes the agent can see, which a note link may point at (#561). */
export function linkTargets(grants: AgentGrants, notes: NoteSummary[]): LinkTarget[] {
    return notes.filter((note) => noteAccess(grants, note) !== 'none').map(({ id, title }) => ({ id, title }));
}

export function toListResult(note: NoteSummary, access: AgentAccess): NoteListResult {
    return { id: note.id, title: note.title, folderId: note.folderId, modified: note.modified, tags: note.tags, access };
}

export async function listFolders(deps: ReadDeps): Promise<FolderResult[]> {
    const [grants, folders] = await Promise.all([deps.loadGrants(), deps.listFolders()]);
    return folders
        .map((folder) => ({ ...folder, access: folderAccess(grants, folder.id) }))
        .filter((folder) => folder.access !== 'none');
}

/** Granted notes, newest first, each with only `fields` (#1003), plus `access` when it is read. */
export async function listNotes(
    deps: ReadDeps,
    params: { folderId?: string; limit?: number; fields?: readonly NoteListField[] } = {}
): Promise<Partial<NoteListResult>[]> {
    const limit = Math.min(params.limit ?? DEFAULT_LIST_NOTES_LIMIT, MAX_LIST_NOTES_LIMIT);
    const fields = params.fields?.length ? params.fields : DEFAULT_LIST_FIELDS;
    const [grants, notes] = await Promise.all([deps.loadGrants(), deps.listNotes()]);

    return notes
        .filter((note) => !params.folderId || note.folderId === params.folderId)
        .map((note) => toListResult(note, noteAccess(grants, note)))
        .filter((note) => note.access !== 'none')
        .sort((a, b) => b.modified.localeCompare(a.modified))
        .slice(0, limit)
        .map((note) => ({
            ...Object.fromEntries(fields.map((field) => [field, note[field]])),
            ...(note.access === 'read' && { access: note.access }),
        }));
}

export async function getNote(deps: ReadDeps, params: { id: string }): Promise<NoteResult> {
    const [grants, notes] = await Promise.all([deps.loadGrants(), deps.listNotes()]);
    const result = await deps.getNote(params.id, linkTargets(grants, notes));
    if (!result) throw new Error(`Note not found: ${params.id}`);

    const access = noteAccess(grants, result.summary);
    if (access === 'none') throw new Error(`Note not found: ${params.id}`);

    return { ...toListResult(result.summary, access), markdown: result.markdown };
}

/** Lower-case, without diacritics: `Café` and `cafe` compare equal. */
export const normalizeSearchText = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The terms of a query: whitespace separates them and "double quotes" keep a phrase together. */
export function searchTerms(query: string): string[] {
    const terms: string[] = [];
    for (const [, phrase, word] of query.matchAll(/"([^"]*)"|(\S+)/g)) {
        const term = normalizeSearchText(phrase ?? word).replace(/\s+/g, ' ').trim();
        if (term) terms.push(term);
    }
    return terms;
}

const toTime = (date: string | undefined): number | undefined => {
    if (date === undefined) return undefined;
    const time = Date.parse(date);
    if (Number.isNaN(time)) throw new Error(`Not an ISO date: ${date}`);
    return time;
};

/** Whether `note` is inside `filters`. */
export function matchesSearchFilters(note: NoteSummary, filters: SearchFilters): boolean {
    const after = toTime(filters.modifiedAfter);
    const before = toTime(filters.modifiedBefore);
    const modified = Date.parse(note.modified);
    return (
        (!filters.folderId || note.folderId === filters.folderId) &&
        (!filters.tag || note.tags.some((tag) => tag.toLowerCase() === filters.tag!.toLowerCase())) &&
        (after === undefined || modified >= after) &&
        (before === undefined || modified < before)
    );
}

/** The index in `text` that holds the character at `normalizedIndex` of `normalizeSearchText(text)`. */
function originalIndex(text: string, normalizedIndex: number): number {
    let length = 0;
    let index = 0;
    for (const char of text) {
        length += normalizeSearchText(char).length;
        if (length > normalizedIndex) break;
        index += char.length;
    }
    return index;
}

/** About SNIPPET_LENGTH characters of `text` around `at`, cut at word boundaries, with … where it is cut. */
function snippetAround(text: string, at: number): string {
    let start = Math.max(0, at - SNIPPET_LENGTH / 3);
    let end = Math.min(text.length, start + SNIPPET_LENGTH);
    if (start > 0 && !/\s/.test(text[start - 1]) && !/\s/.test(text[start])) {
        const space = text.indexOf(' ', start);
        if (space !== -1 && space < at) start = space + 1;
    }
    if (end < text.length && !/\s/.test(text[end])) {
        const space = text.lastIndexOf(' ', end);
        if (space > at) end = space;
    }
    return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** The snippet of a whitespace-collapsed body that holds at least one of `terms`, around the first of them; undefined when none is in it. */
function snippetOf(flat: string, terms: string[]): string | undefined {
    const normalized = normalizeSearchText(flat);
    const positions = terms.map((term) => normalized.indexOf(term)).filter((position) => position !== -1);
    return positions.length ? snippetAround(flat, originalIndex(flat, Math.min(...positions))) : undefined;
}

export async function searchNotes(
    deps: ReadDeps,
    params: { query: string; limit?: number } & SearchFilters
): Promise<NoteSearchResult[]> {
    const { query, limit = DEFAULT_SEARCH_LIMIT, ...filters } = params;
    const terms = searchTerms(query);
    const filtered = Object.values(filters).some(Boolean);
    if (deps.searchNotes) {
        const [grants, hits] = await Promise.all([deps.loadGrants(), deps.searchNotes(query, limit, filters)]);
        return hits
            .map(({ summary, snippet }) => ({ ...toListResult(summary, noteAccess(grants, summary)), snippet }))
            .filter((note) => note.access !== 'none')
            .slice(0, limit);
    }
    if (terms.length === 0 && !filtered) return [];

    const [grants, allNotes] = await Promise.all([deps.loadGrants(), deps.listNotes()]);
    const targets = linkTargets(grants, allNotes);
    // Granted notes inside the filters, newest first. Nothing below touches an ungranted note.
    const notes = allNotes
        .filter((note) => noteAccess(grants, note) !== 'none' && matchesSearchFilters(note, filters))
        .sort((a, b) => b.modified.localeCompare(a.modified));
    const toResult = (note: NoteSummary, snippet?: string): NoteSearchResult => ({
        ...toListResult(note, noteAccess(grants, note)),
        ...(snippet ? { snippet } : {}),
    });
    if (terms.length === 0) return notes.slice(0, limit).map((note) => toResult(note));

    // Title and tag hits need no body: collect them over every note first, titles before tags.
    const titleHits: NoteSummary[] = [];
    const tagHits: NoteSummary[] = [];
    const rest: NoteSummary[] = [];
    for (const note of notes) {
        const title = normalizeSearchText(note.title);
        const withTags = `${title}\n${normalizeSearchText(note.tags.join('\n'))}`;
        if (terms.every((term) => title.includes(term))) titleHits.push(note);
        else if (terms.every((term) => withTags.includes(term))) tagHits.push(note);
        else rest.push(note);
    }
    const results = [...titleHits, ...tagHits].slice(0, limit).map((note) => toResult(note));

    // Then bodies, SEARCH_CONCURRENCY at a time, newest first, until `limit` results.
    const bodyHit = async (note: NoteSummary): Promise<NoteSearchResult | null> => {
        const body = deps.getNoteText ? await deps.getNoteText(note) : ((await deps.getNote(note.id, targets))?.markdown ?? null);
        const flat = (body ?? '').replace(/\s+/g, ' ').trim();
        const haystack = normalizeSearchText(`${note.title}\n${note.tags.join('\n')}\n${flat}`);
        return terms.every((term) => haystack.includes(term)) ? toResult(note, snippetOf(flat, terms)) : null;
    };
    for (let i = 0; i < rest.length && results.length < limit; i += SEARCH_CONCURRENCY) {
        const matches = await Promise.all(rest.slice(i, i + SEARCH_CONCURRENCY).map(bodyHit));
        for (const match of matches) if (match && results.length < limit) results.push(match);
    }
    return results;
}
