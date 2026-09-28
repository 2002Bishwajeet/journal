import * as Y from 'yjs';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { FolderDriveProvider } from '@/lib/homebase/FolderDriveProvider';
import { AgentGrantsDriveProvider } from '@/lib/homebase/AgentGrantsDriveProvider';
import { fragmentToMarkdown } from '@/lib/yjs/fragmentToMarkdown';
import type { AgentGrants } from '@/lib/agent/grants';
import type { EncryptedKeyHeader, HomebaseFile } from '@homebase-id/js-lib/core';
import type { DocumentMetadata, NoteFileContent } from '@/types';
import type { NoteSummary } from './tools/read';
import { VersionConflictError, type NoteForEdit, type WriteDeps } from './tools/write';
import type { McpCredentials } from './credentials';
import { createClient } from './client';

function toNoteSummary(file: HomebaseFile<NoteFileContent>): NoteSummary | null {
    const uniqueId = file.fileMetadata.appData.uniqueId;
    const content = file.fileMetadata.appData.content;
    if (!uniqueId || !content) return null;

    return {
        id: uniqueId,
        title: content.title,
        folderId: file.fileMetadata.appData.groupId ?? '',
        tags: content.tags ?? [],
        modified: new Date(file.fileMetadata.updated).toISOString(),
        excludeFromAI: content.excludeFromAI,
    };
}

/**
 * Implements ReadDeps (mcp/tools/read.ts) and the drive half of WriteDeps
 * (mcp/tools/write.ts; `clientName` comes from the MCP server) against the real Homebase drive, using the same
 * NotesDriveProvider/FolderDriveProvider the app uses (imported directly, not through the
 * @/lib/homebase barrel, which also re-exports SyncService and pulls in PGlite).
 */
export function createDriveDeps(creds: McpCredentials): Omit<WriteDeps, 'clientName'> {
    const client = createClient(creds);
    const notesProvider = new NotesDriveProvider(client);
    const folderProvider = new FolderDriveProvider(client);
    const grantsProvider = new AgentGrantsDriveProvider(client);

    // Grants are re-fetched from the drive on every call (so a revocation applies on the
    // very next call); this only avoids re-parsing the payload when the versionTag hasn't
    // changed since the last call.
    let grantsCache: { versionTag: string; grants: AgentGrants } | null = null;

    async function loadGrants(): Promise<AgentGrants> {
        const { grants, versionTag } = await grantsProvider.load();
        if (versionTag) {
            if (grantsCache?.versionTag === versionTag) return grantsCache.grants;
            grantsCache = { versionTag, grants };
        }
        return grants;
    }

    async function listFolders(): Promise<{ id: string; name: string }[]> {
        const folders: { id: string; name: string }[] = [];
        let cursor: string | undefined;
        do {
            const page = await folderProvider.queryFolders(cursor);
            for (const file of page.folders) {
                const uniqueId = file.fileMetadata.appData.uniqueId;
                const content = file.fileMetadata.appData.content;
                if (uniqueId && content) folders.push({ id: uniqueId, name: content.name });
            }
            cursor = page.cursor || undefined;
        } while (cursor);
        return folders;
    }

    async function listNotes(): Promise<NoteSummary[]> {
        const notes: NoteSummary[] = [];
        let cursor: string | undefined;
        do {
            const page = await notesProvider.queryNotes(cursor, 100);
            for (const file of page.notes) {
                const summary = toNoteSummary(file);
                if (summary) notes.push(summary);
            }
            cursor = page.cursor || undefined;
        } while (cursor);
        return notes;
    }

    async function getNote(id: string): Promise<{ summary: NoteSummary; markdown: string } | null> {
        const file = await notesProvider.getNote(id);
        if (!file) return null;

        const summary = toNoteSummary(file);
        if (!summary) return null;

        const payload = await notesProvider.getNotePayload(file.fileId);
        let markdown = '';
        if (payload && payload.length > 0) {
            const ydoc = new Y.Doc();
            Y.applyUpdate(ydoc, payload);
            markdown = fragmentToMarkdown(ydoc.getXmlFragment('prosemirror'));
        }

        return { summary, markdown };
    }

    // The fetched file's key header, keyed by fileId, reused by the upload that follows
    // (as SyncService caches it) so the payload is encrypted with the file's own key.
    const keyHeaders = new Map<string, EncryptedKeyHeader | undefined>();

    async function fetchNoteForEdit(id: string): Promise<NoteForEdit | null> {
        const file = await notesProvider.getNote(id, undefined, { decrypt: false });
        if (!file) return null;

        // Fetched with decrypt:false so the header keeps its encrypted key header for the
        // upload; the content is still the encrypted string (getNote's type says otherwise)
        // and is decrypted separately.
        const content = await notesProvider.dsrToNoteFileContent(file as unknown as HomebaseFile, true);
        if (!content) return null;
        const appData = { ...file.fileMetadata.appData, content };
        const summary = toNoteSummary({ ...file, fileMetadata: { ...file.fileMetadata, appData } });
        if (!summary) return null;

        // Load the stored state, never a fresh doc, so the edit is causally after it.
        const doc = new Y.Doc();
        const payload = await notesProvider.getNotePayload(file.fileId, undefined, file.fileMetadata.updated);
        if (payload && payload.length > 0) Y.applyUpdate(doc, payload);

        const metadata: DocumentMetadata = {
            title: content.title,
            folderId: summary.folderId,
            tags: content.tags,
            timestamps: {
                created: new Date(file.fileMetadata.appData.userDate || file.fileMetadata.created).toISOString(),
                modified: summary.modified,
            },
            excludeFromAI: content.excludeFromAI ?? false,
            isPinned: content.isPinned,
            isPublic: content.isPublic,
            archivalStatus: file.fileMetadata.appData.archivalStatus,
            isCollaborative: content.isCollaborative,
            circleIds: content.circleIds,
            recipients: content.recipients,
            lastEditedBy: content.lastEditedBy,
        };

        keyHeaders.set(file.fileId, file.sharedSecretEncryptedKeyHeader);
        return { summary, doc, versionTag: file.fileMetadata.versionTag, fileId: file.fileId, metadata };
    }

    async function uploadNoteEdit(
        id: string,
        edit: { fileId: string; versionTag: string; metadata: DocumentMetadata; yjsBlob: Uint8Array }
    ): Promise<void> {
        await notesProvider.updateNote(
            id,
            edit.fileId,
            edit.versionTag,
            edit.metadata,
            undefined,
            undefined,
            edit.yjsBlob,
            keyHeaders.get(edit.fileId),
            {
                onVersionConflict: () => {
                    throw new VersionConflictError();
                },
            }
        );
    }

    async function createNote(uniqueId: string, metadata: DocumentMetadata, yjsBlob: Uint8Array): Promise<void> {
        await notesProvider.createNote(uniqueId, metadata, yjsBlob);
    }

    return { loadGrants, listFolders, listNotes, getNote, fetchNoteForEdit, uploadNoteEdit, createNote };
}
