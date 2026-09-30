import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createJournalMcpServer } from '../../mcp/createServer';
import type { NoteSummary } from '../../mcp/tools/read';
import type { WriteDeps } from '../../mcp/tools/write';
import type { AgentGrants } from '@/lib/agent/grants';
import type { DocumentMetadata } from '@/types';
import { createDoc } from '@/lib/agent/editEngine';

const GRANTS: AgentGrants = { version: 1, folders: { F1: 'read' }, notes: {} };
const WRITE_GRANTS: AgentGrants = { version: 1, folders: { F1: 'write' }, notes: {} };

const NOTES: NoteSummary[] = [{ id: 'n1', title: 'Note One', folderId: 'F1', tags: [], modified: '2024-01-01T00:00:00.000Z' }];

type ServerDeps = Omit<WriteDeps, 'clientName'>;

const METADATA: DocumentMetadata = {
    title: 'Note One',
    folderId: 'F1',
    tags: [],
    timestamps: { created: '2024-01-01T00:00:00.000Z', modified: '2024-01-01T00:00:00.000Z' },
    excludeFromAI: false,
};

function makeFakeDeps(grants = GRANTS, uploads: DocumentMetadata[] = []): ServerDeps {
    return {
        loadGrants: async () => grants,
        listFolders: async () => [{ id: 'F1', name: 'Folder One' }],
        listNotes: async () => NOTES,
        getNote: async (id) => {
            const summary = NOTES.find((note) => note.id === id);
            return summary ? { summary, markdown: 'body' } : null;
        },
        fetchNoteForEdit: async (id) =>
            id === 'n1'
                ? { summary: NOTES[0], doc: createDoc('todo one\n\ntodo two'), versionTag: 'v1', fileId: 'f1', metadata: METADATA }
                : null,
        uploadNoteEdit: async (_id, edit) => {
            uploads.push(edit.metadata);
        },
        createNote: async () => {},
        createFolder: async () => {},
        grantFolder: async () => {},
    };
}

async function connectedClient(deps: ServerDeps): Promise<Client> {
    const server = createJournalMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
}

describe('createJournalMcpServer', () => {
    it('registers exactly the four read tools and the four write tools', async () => {
        const client = await connectedClient(makeFakeDeps());
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            'append_to_note',
            'create_folder',
            'create_note',
            'get_note',
            'list_folders',
            'list_notes',
            'replace_in_note',
            'search_notes',
        ]);
    });

    it('tells agents about live blocks in the markdown write tools only', async () => {
        const client = await connectedClient(makeFakeDeps());
        const { tools } = await client.listTools();
        for (const tool of tools) {
            const mentions = ['mermaid', 'svg', 'html'].every((word) => tool.description?.includes(word));
            expect(mentions).toBe(['create_note', 'append_to_note', 'replace_in_note'].includes(tool.name));
        }
    });

    it('tells agents how an html block should look in the three markdown write tools (#420)', async () => {
        const client = await connectedClient(makeFakeDeps());
        const { tools } = await client.listTools();
        const sentence =
            " An `html` block inherits the note's font, text colour and transparent background, so it should not set a page background or font, " +
            'should use `var(--foreground)`, `var(--muted)`, `var(--muted-foreground)`, `var(--border)`, `var(--accent)` and `var(--radius)` for anything it draws, ' +
            'and should avoid gradients, shadows and badge rows; prefer a callout or a table when one would do.';
        const told = tools.filter((tool) => tool.description?.includes(sentence)).map((tool) => tool.name);
        expect(told.sort()).toEqual(['append_to_note', 'create_note', 'replace_in_note']);
    });

    it('attributes writes to the client name from the initialize handshake', async () => {
        const uploads: DocumentMetadata[] = [];
        const client = await connectedClient(makeFakeDeps(WRITE_GRANTS, uploads));
        const result = await client.callTool({ name: 'append_to_note', arguments: { id: 'n1', markdown: 'agent line' } });
        expect(result.isError).toBeFalsy();
        expect(uploads.map((metadata) => metadata.lastEditedBy)).toEqual(['agent:test-client']);
    });

    it('returns the edit engine error verbatim as a tool error', async () => {
        const client = await connectedClient(makeFakeDeps(WRITE_GRANTS));
        const result = await client.callTool({
            name: 'replace_in_note',
            arguments: { id: 'n1', old_text: 'todo', new_text: 'done' },
        });
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([
            { type: 'text', text: 'replace_in_note: old_text matches 2 times; include more surrounding text' },
        ]);
    });

    it('callTool list_notes returns the granted notes', async () => {
        const client = await connectedClient(makeFakeDeps());
        const result = await client.callTool({ name: 'list_notes', arguments: {} });
        const content = result.content as Array<{ type: string; text: string }>;
        const notes = JSON.parse(content[0].text);
        expect(notes).toEqual([{ id: 'n1', title: 'Note One', folderId: 'F1', modified: '2024-01-01T00:00:00.000Z', tags: [], access: 'read' }]);
    });
});
