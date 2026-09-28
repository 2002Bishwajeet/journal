import * as Y from 'yjs';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { FolderDriveProvider } from '@/lib/homebase/FolderDriveProvider';
import { AgentGrantsDriveProvider } from '@/lib/homebase/AgentGrantsDriveProvider';
import { toMarkdown } from '@/lib/agent/editEngine';
import { setFolderAccess, type AgentAccess } from '@/lib/agent/grants';
import type { HomebaseFile } from '@homebase-id/js-lib/core';
import type { DocumentMetadata, NoteFileContent } from '@/types';
import type { NoteSummary } from './tools/read';
import { VersionConflictError, type NoteEdit, type NoteForEdit, type WriteDeps } from './tools/write';
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
 * Follows `cursor` until the drive returns an empty page, dropping null items. Homebase
 * never returns an empty cursor: past the last result it keeps returning an empty page
 * with the same cursor, so the empty page is the only end signal.
 */
export async function collectPages<T>(
    fetchPage: (cursor: string | undefined) => Promise<{ items: (T | null)[]; cursor: string }>
): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | undefined;
    do {
        const page = await fetchPage(cursor);
        if (page.items.length === 0) break;
        for (const item of page.items) if (item) all.push(item);
        cursor = page.cursor || undefined;
    } while (cursor);
    return all;
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

    // Re-fetched from the drive on every call, so a revocation applies on the very next call.
    const loadGrants = async () => (await grantsProvider.load()).grants;

    const listFolders = () =>
        collectPages(async (cursor) => {
            const page = await folderProvider.queryFolders(cursor);
            const items = page.folders.map((file) => {
                const uniqueId = file.fileMetadata.appData.uniqueId;
                const content = file.fileMetadata.appData.content;
                return uniqueId && content ? { id: uniqueId, name: content.name } : null;
            });
            return { items, cursor: page.cursor };
        });

    const listNotes = () =>
        collectPages(async (cursor) => {
            const page = await notesProvider.queryNotes(cursor, 100);
            return { items: page.notes.map(toNoteSummary), cursor: page.cursor };
        });

    async function fetchNoteForEdit(id: string): Promise<NoteForEdit | null> {
        const file = await notesProvider.getNote(id, undefined, { decrypt: false });
        if (!file) return null;

        // Fetched with decrypt:false so the header keeps its encrypted key header for the
        // upload; the content is still the encrypted string (getNote's type says otherwise)
        // and is decrypted separately.
        // Load the stored state, never a fresh doc, so the edit is causally after it.
        const [content, payload] = await Promise.all([
            notesProvider.dsrToNoteFileContent(file as unknown as HomebaseFile, true),
            notesProvider.getNotePayload(file.fileId, undefined, file.fileMetadata.updated),
        ]);
        if (!content) return null;
        const appData = { ...file.fileMetadata.appData, content };
        const summary = toNoteSummary({ ...file, fileMetadata: { ...file.fileMetadata, appData } });
        if (!summary) return null;

        const doc = new Y.Doc();
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

        return {
            summary,
            doc,
            versionTag: file.fileMetadata.versionTag,
            fileId: file.fileId,
            // Reused by the upload that follows (as SyncService caches it) so the payload is
            // encrypted with the file's own key.
            keyHeader: file.sharedSecretEncryptedKeyHeader,
            metadata,
        };
    }

    async function getNote(id: string): Promise<{ summary: NoteSummary; markdown: string } | null> {
        const note = await fetchNoteForEdit(id);
        return note ? { summary: note.summary, markdown: toMarkdown(note.doc) } : null;
    }

    async function uploadNoteEdit(id: string, edit: NoteEdit): Promise<void> {
        await notesProvider.updateNote(
            id,
            edit.fileId,
            edit.versionTag,
            edit.metadata,
            undefined,
            undefined,
            edit.yjsBlob,
            edit.keyHeader,
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

    async function createFolder(uniqueId: string, name: string): Promise<void> {
        // Same shape as the app's folder push (SyncService).
        await folderProvider.createFolder(uniqueId, { name, isCollaborative: false, needsPassword: false });
    }

    async function grantFolder(folderId: string, access: AgentAccess): Promise<void> {
        // Read-modify-write; on a conflict (the owner saved grants meanwhile) reload and reapply.
        for (let attempt = 0; attempt < 3; attempt++) {
            const { grants, versionTag, fileId } = await grantsProvider.load();
            try {
                await grantsProvider.save(setFolderAccess(grants, folderId, access), versionTag, fileId);
                return;
            } catch (err) {
                if (!(err instanceof Error && err.message === 'AGENT_GRANTS_CONFLICT')) throw err;
            }
        }
        throw new Error('Agent grants changed too often; try again');
    }

    return { loadGrants, listFolders, listNotes, getNote, fetchNoteForEdit, uploadNoteEdit, createNote, createFolder, grantFolder };
}
