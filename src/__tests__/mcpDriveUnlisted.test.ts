import { describe, it, expect, vi } from 'vitest';
import type { McpCredentials } from '../../mcp/credentials';

const content = {
    title: 'T',
    tags: [],
    excludeFromAI: false,
    isPublic: true,
    shareDescription: 'card text',
    shareIndexable: true,
    shareUnlisted: true,
};

vi.mock('../../mcp/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({ FolderDriveProvider: class {} }));
vi.mock('@/lib/homebase/AgentGrantsDriveProvider', () => ({ AgentGrantsDriveProvider: class {} }));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class {
        async getNote() {
            return {
                fileId: 'f1',
                fileMetadata: { created: 0, updated: 0, versionTag: 'v1', appData: { uniqueId: 'n1', groupId: 'F1', archivalStatus: 0 } },
            };
        }
        async dsrToContent() {
            return content;
        }
        async getNotePayload() {
            return null;
        }
    },
}));

describe('fetchNoteForEdit share fields', () => {
    it('keeps an unlisted public note unlisted when an agent edits it', async () => {
        const { createDriveDeps } = await import('../../mcp/drive');
        const deps = createDriveDeps({} as McpCredentials);
        const note = await deps.fetchNoteForEdit('n1');
        expect(note?.metadata).toMatchObject({
            isPublic: true,
            shareDescription: 'card text',
            shareIndexable: true,
            shareUnlisted: true,
        });
    });
});
