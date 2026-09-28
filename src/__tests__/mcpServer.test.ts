import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createJournalMcpServer } from '../../mcp/server';
import type { ReadDeps, NoteSummary } from '../../mcp/tools/read';
import type { AgentGrants } from '@/lib/agent/grants';

const GRANTS: AgentGrants = { version: 1, folders: { F1: 'read' }, notes: {} };

const NOTES: NoteSummary[] = [{ id: 'n1', title: 'Note One', folderId: 'F1', tags: [], modified: '2024-01-01T00:00:00.000Z' }];

function makeFakeDeps(): ReadDeps {
    return {
        loadGrants: async () => GRANTS,
        listFolders: async () => [{ id: 'F1', name: 'Folder One' }],
        listNotes: async () => NOTES,
        getNote: async (id) => {
            const summary = NOTES.find((note) => note.id === id);
            return summary ? { summary, markdown: 'body' } : null;
        },
    };
}

async function connectedClient(deps: ReadDeps): Promise<Client> {
    const server = createJournalMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
}

describe('createJournalMcpServer', () => {
    it('registers exactly the four read tools', async () => {
        const client = await connectedClient(makeFakeDeps());
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual(['get_note', 'list_folders', 'list_notes', 'search_notes']);
    });

    it('callTool list_notes returns the granted notes', async () => {
        const client = await connectedClient(makeFakeDeps());
        const result = await client.callTool({ name: 'list_notes', arguments: {} });
        const content = result.content as Array<{ type: string; text: string }>;
        const notes = JSON.parse(content[0].text);
        expect(notes).toEqual([{ id: 'n1', title: 'Note One', folderId: 'F1', modified: '2024-01-01T00:00:00.000Z', tags: [], access: 'read' }]);
    });
});
