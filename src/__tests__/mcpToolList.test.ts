import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createJournalMcpServer } from '../../mcp/createServer';

describe('MCP tools/list', () => {
    it('lists the same tools, titles, descriptions and input schemas as before the registry (#694)', async () => {
        const server = createJournalMcpServer({} as Parameters<typeof createJournalMcpServer>[0]);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'test-client', version: '0.0.0' });
        await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
        const { tools } = await client.listTools();
        const listed = tools.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }));
        expect(listed).toMatchSnapshot();
    });
});
