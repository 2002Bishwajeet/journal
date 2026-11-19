/** #1427: the MCP server reads the drive, so a note's lock and its folder's come from their files. */
import { describe, it, expect, vi } from 'vitest';
import type { McpCredentials } from '../../mcp/credentials';
import { noteAccess } from '@/lib/agent/tools/read';

const file = (uniqueId: string, groupId: string, content: Record<string, unknown>) => ({
    fileId: `file-${uniqueId}`,
    fileMetadata: { created: 0, updated: 0, versionTag: 'v1', appData: { uniqueId, groupId, archivalStatus: 0, content } },
});

const NOTES = {
    open: file('open', 'F-OPEN', { title: 'Open', tags: [], excludeFromAI: false }),
    own: file('own', 'F-OPEN', { title: 'Own lock', tags: [], excludeFromAI: false, locked: true }),
    inVault: file('in-vault', 'F-VAULT', { title: 'In vault', tags: [], excludeFromAI: false }),
};

vi.mock('../../mcp/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/homebase/AgentGrantsDriveProvider', () => ({ AgentGrantsDriveProvider: class {} }));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class {
        async queryFolders(cursor?: string) {
            if (cursor) return { folders: [], cursor };
            return {
                folders: [
                    { fileMetadata: { appData: { uniqueId: 'F-OPEN', content: { name: 'Open' } } } },
                    { fileMetadata: { appData: { uniqueId: 'F-VAULT', content: { name: 'Vault', locked: true } } } },
                ],
                cursor: 'end',
            };
        }
    },
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class {
        async queryNotes(cursor?: string) {
            return cursor ? { notes: [], cursor } : { notes: Object.values(NOTES), cursor: 'end' };
        }
        async getNote(id: string) {
            return Object.values(NOTES).find((n) => n.fileMetadata.appData.uniqueId === id) ?? null;
        }
        async dsrToContent(dsr: { fileMetadata: { appData: { content: unknown } } }) {
            return dsr.fileMetadata.appData.content;
        }
        async getNotePayload() {
            return null;
        }
    },
}));

const GRANTS = { version: 1 as const, folders: { 'F-OPEN': 'write' as const, 'F-VAULT': 'write' as const }, notes: {} };

describe('MCP drive deps and locks', () => {
    it('marks a note locked itself or by its folder, so no tool grants it', async () => {
        const { createDriveDeps } = await import('../../mcp/drive');
        const deps = createDriveDeps({} as McpCredentials);
        const notes = await deps.listNotes();
        expect(Object.fromEntries(notes.map((n) => [n.id, n.locked]))).toEqual({ open: false, own: true, 'in-vault': true });
        expect(notes.filter((n) => noteAccess(GRANTS, n) !== 'none').map((n) => n.id)).toEqual(['open']);

        const edit = await deps.fetchNoteForEdit('in-vault');
        expect(edit?.summary.locked).toBe(true);
        expect(noteAccess(GRANTS, edit!.summary)).toBe('none');
        expect((await deps.fetchNoteForEdit('own'))?.metadata.locked).toBe(true);
    });
});
