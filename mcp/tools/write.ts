/**
 * Pure write-tool handlers for the Journal MCP server (#169). Like mcp/tools/read.ts they
 * depend only on injected deps (mcp/drive.ts implements them against Homebase), so the
 * conflict/merge logic is unit-tested with fakes and real Yjs.
 *
 * Every edit is applied to the note's stored Yjs state (never a fresh doc), so the upload
 * is a causally-later update that the app CRDT-merges with anything typed meanwhile. The
 * upload carries the fetched versionTag; on a conflict the note is refetched and the same
 * operation re-applied to the fresh state.
 */
import * as Y from 'yjs';
import { formatGuidId } from '@homebase-id/js-lib/helpers';
import type { EncryptedKeyHeader } from '@homebase-id/js-lib/core';
import { getNewId } from '@/lib/utils';
import { folderAccess, type AgentAccess, type AgentGrants } from '@/lib/agent/grants';
import { agentEditor } from '@/lib/agent/attribution';
import { appendMarkdown, replaceInNote as replaceInDoc, createDoc, setMarkdown } from '@/lib/agent/editEngine';
import type { DocumentMetadata } from '@/types';
import { noteAccess, type ReadDeps, type NoteSummary } from './read';

/** Thrown by `uploadNoteEdit` when the note's versionTag is stale. */
export class VersionConflictError extends Error {
    constructor() {
        super('Version conflict');
        this.name = 'VersionConflictError';
    }
}

export interface NoteForEdit {
    summary: NoteSummary;
    doc: Y.Doc;
    versionTag: string;
    fileId: string;
    /** The fetched file's encrypted key header, handed back to `uploadNoteEdit`. */
    keyHeader?: EncryptedKeyHeader;
    metadata: DocumentMetadata;
}

export interface NoteEdit {
    fileId: string;
    versionTag: string;
    keyHeader?: EncryptedKeyHeader;
    metadata: DocumentMetadata;
    yjsBlob: Uint8Array;
}

export type WriteDeps = ReadDeps & {
    fetchNoteForEdit(id: string): Promise<NoteForEdit | null>;
    uploadNoteEdit(id: string, edit: NoteEdit): Promise<void>;
    createNote(uniqueId: string, metadata: DocumentMetadata, yjsBlob: Uint8Array): Promise<void>;
    createFolder(uniqueId: string, name: string): Promise<void>;
    /** Moves the note to Trash (Homebase archivalStatus 2), like the app's trashNote. */
    trashNote(id: string, fileId: string): Promise<void>;
    /** Sets one folder's grant in the grants file, keeping every other grant. */
    grantFolder(folderId: string, access: AgentAccess): Promise<void>;
    /** The MCP client's `clientInfo.name` from the initialize handshake ('' if absent). */
    clientName(): string;
};

const MAX_ATTEMPTS = 3;

function assertWritable(grants: AgentGrants, note: NoteForEdit | null, id: string): asserts note is NoteForEdit {
    const access = note ? noteAccess(grants, note.summary) : 'none';
    if (!note || access === 'none') throw new Error(`Note not found: ${id}`);
    if (access === 'read') throw new Error(`Note is read-only for agents: ${id}`);
}

async function editWithRetry(
    deps: WriteDeps,
    id: string,
    apply: (doc: Y.Doc) => void,
    opts: { metadata?: Partial<DocumentMetadata>; expectedModified?: string } = {}
): Promise<void> {
    const lastEditedBy = agentEditor(deps.clientName());
    const [grants, firstNote] = await Promise.all([deps.loadGrants(), deps.fetchNoteForEdit(id)]);
    let sent: { client: number; clock: number } | undefined;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // Access is re-checked on every fetch: a refetched note may have become excludeFromAI.
        const note = attempt === 0 ? firstNote : await deps.fetchNoteForEdit(id);
        assertWritable(grants, note, id);

        // A conflicting upload can still have been saved (#439). If the refetched doc already
        // holds its ops, the edit is in: re-applying it would duplicate it or fail on it.
        if (sent && Y.getState(note.doc.store, sent.client) >= sent.clock) return;

        // Checked against the note as the agent's call found it; an edit landing while
        // uploading merges like any concurrent edit.
        if (
            attempt === 0 &&
            opts.expectedModified !== undefined &&
            Date.parse(opts.expectedModified) !== Date.parse(note.summary.modified)
        ) {
            throw new Error(`Note changed since ${opts.expectedModified} (now ${note.summary.modified}); get_note it again: ${id}`);
        }

        apply(note.doc);
        const clock = Y.getState(note.doc.store, note.doc.clientID);
        // No ops of this doc's own (a title/tags-only edit, or ops merged in from an earlier
        // attempt) leaves the earlier record, if any, as what to detect.
        if (clock > 0) sent = { client: note.doc.clientID, clock };
        try {
            await deps.uploadNoteEdit(id, {
                fileId: note.fileId,
                versionTag: note.versionTag,
                keyHeader: note.keyHeader,
                metadata: { ...note.metadata, ...opts.metadata, lastEditedBy },
                yjsBlob: Y.encodeStateAsUpdate(note.doc),
            });
            return;
        } catch (err) {
            if (!(err instanceof VersionConflictError)) throw err;
        }
    }
    throw new Error(`Note changed too often while editing; try again: ${id}`);
}

export async function createNote(
    deps: WriteDeps,
    params: { title: string; markdown: string; folderId: string; tags?: string[] }
): Promise<{ id: string; title: string; folderId: string }> {
    const grants = await deps.loadGrants();
    const writable =
        folderAccess(grants, params.folderId) === 'write' &&
        (await deps.listFolders()).some((folder) => folder.id === params.folderId);
    if (!writable) throw new Error(`Folder not found: ${params.folderId}`);

    const id = formatGuidId(getNewId());
    const now = new Date().toISOString();
    // Same shape as persistNewNote (src/hooks/useNotes.ts), plus the agent attribution.
    const metadata: DocumentMetadata = {
        title: params.title || 'Untitled',
        folderId: params.folderId,
        tags: params.tags ?? [],
        timestamps: { created: now, modified: now },
        excludeFromAI: false,
        isPinned: false,
        lastEditedBy: agentEditor(deps.clientName()),
    };
    await deps.createNote(id, metadata, Y.encodeStateAsUpdate(createDoc(params.markdown)));
    return { id, title: metadata.title, folderId: metadata.folderId };
}

/**
 * Creates a folder and grants the agent Read+write on it, so it can put notes there.
 * The only grant an agent ever writes, and only for a folder it just created, so no
 * existing note becomes visible. The owner can revoke it in Settings → Agent access.
 */
export async function createFolder(deps: WriteDeps, params: { name: string }): Promise<{ id: string; name: string }> {
    const name = params.name.trim();
    if (!name) throw new Error('Folder name is required');

    const id = formatGuidId(getNewId());
    await deps.createFolder(id, name);
    await deps.grantFolder(id, 'write');
    return { id, name };
}

export async function appendToNote(deps: WriteDeps, params: { id: string; markdown: string }): Promise<{ id: string }> {
    await editWithRetry(deps, params.id, (doc) => appendMarkdown(doc, params.markdown));
    return { id: params.id };
}

/** The engine's error (no match / several matches / lossy block) reaches the agent verbatim. */
export async function replaceInNote(
    deps: WriteDeps,
    params: { id: string; old_text: string; new_text: string }
): Promise<{ id: string }> {
    await editWithRetry(deps, params.id, (doc) => replaceInDoc(doc, params.old_text, params.new_text));
    return { id: params.id };
}

/**
 * Rewrites the body, title and/or tags as one edit on the stored Yjs state, so an open
 * editor merges it. With `expectedModified`, a note modified since is left unchanged.
 */
export async function updateNote(
    deps: WriteDeps,
    params: { id: string; markdown?: string; title?: string; tags?: string[]; expectedModified?: string }
): Promise<{ id: string }> {
    const { id, markdown, title, tags, expectedModified } = params;
    if (markdown === undefined && title === undefined && tags === undefined) {
        throw new Error('update_note: give markdown, title or tags');
    }
    const metadata: Partial<DocumentMetadata> = {
        ...(title !== undefined && { title: title || 'Untitled' }),
        ...(tags !== undefined && { tags }),
    };
    // The rewrite is diffed once, against the note as first fetched, and that update is merged
    // into any refetch: re-diffing against a refetched note would delete a concurrent edit.
    let rewrite: Uint8Array | undefined;
    const apply = (doc: Y.Doc) => {
        if (markdown === undefined) return;
        if (rewrite) return Y.applyUpdate(doc, rewrite);
        const before = Y.encodeStateVector(doc);
        setMarkdown(doc, markdown);
        rewrite = Y.encodeStateAsUpdate(doc, before);
    };
    await editWithRetry(deps, id, apply, { metadata, expectedModified });
    return { id };
}

/** Moves a note to Trash, where the owner can restore it. Never deletes permanently. */
export async function deleteNote(deps: WriteDeps, params: { id: string }): Promise<{ id: string; state: 'trashed' }> {
    const [grants, note] = await Promise.all([deps.loadGrants(), deps.fetchNoteForEdit(params.id)]);
    assertWritable(grants, note, params.id);
    await deps.trashNote(params.id, note.fileId);
    return { id: params.id, state: 'trashed' };
}
