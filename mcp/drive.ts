import * as Y from 'yjs';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { FolderDriveProvider } from '@/lib/homebase/FolderDriveProvider';
import { AgentGrantsDriveProvider } from '@/lib/homebase/AgentGrantsDriveProvider';
import { fragmentToMarkdown } from '@/lib/yjs/fragmentToMarkdown';
import type { AgentGrants } from '@/lib/agent/grants';
import type { HomebaseFile } from '@homebase-id/js-lib/core';
import type { NoteFileContent } from '@/types';
import type { ReadDeps, NoteSummary } from './tools/read';
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
 * Implements ReadDeps (mcp/tools/read.ts) against the real Homebase drive, using the same
 * NotesDriveProvider/FolderDriveProvider the app uses (imported directly, not through the
 * @/lib/homebase barrel, which also re-exports SyncService and pulls in PGlite).
 */
export function createDriveDeps(creds: McpCredentials): ReadDeps {
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

    return { loadGrants, listFolders, listNotes, getNote };
}
