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
import { folderAccess } from '@/lib/agent/grants';
import { agentEditor } from '@/lib/agent/attribution';
import { appendMarkdown, replaceInNote as replaceInDoc, createDoc } from '@/lib/agent/editEngine';
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
    /** The MCP client's `clientInfo.name` from the initialize handshake ('' if absent). */
    clientName(): string;
};

const MAX_ATTEMPTS = 3;

async function editWithRetry(deps: WriteDeps, id: string, apply: (doc: Y.Doc) => void): Promise<void> {
    const lastEditedBy = agentEditor(deps.clientName());
    const [grants, firstNote] = await Promise.all([deps.loadGrants(), deps.fetchNoteForEdit(id)]);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // Access is re-checked on every fetch: a refetched note may have become excludeFromAI.
        const note = attempt === 0 ? firstNote : await deps.fetchNoteForEdit(id);
        const access = note ? noteAccess(grants, note.summary) : 'none';
        if (!note || access === 'none') throw new Error(`Note not found: ${id}`);
        if (access === 'read') throw new Error(`Note is read-only for agents: ${id}`);

        apply(note.doc);
        try {
            await deps.uploadNoteEdit(id, {
                fileId: note.fileId,
                versionTag: note.versionTag,
                keyHeader: note.keyHeader,
                metadata: { ...note.metadata, lastEditedBy },
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
