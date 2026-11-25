import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpHttpServer, MCP_PATH } from '../../mcp/http';
import type { McpDriveDeps } from '../../mcp/createServer';
import type { NoteSummary } from '@/lib/agent/tools/read';

const NOTES: NoteSummary[] = [{ id: 'n1', title: 'Note One', folderId: 'F1', tags: [], modified: '2024-01-01T00:00:00.000Z' }];

/** Only the read side is reached: list_notes, get_note and a read-only run_script. */
const DEPS = {
    loadGrants: async () => ({ version: 1, folders: { F1: 'read' }, notes: {} }),
    listFolders: async () => [{ id: 'F1', name: 'Folder One' }],
    listNotes: async () => NOTES,
    getNote: async (id: string) => (id === 'n1' ? { summary: NOTES[0], markdown: 'hello over http' } : null),
} as unknown as McpDriveDeps;

let httpServer: Server;
let url: URL;
let depsBuilt = 0;

beforeAll(async () => {
    httpServer = createMcpHttpServer(() => {
        depsBuilt++;
        return DEPS;
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    url = new URL(`http://127.0.0.1:${(httpServer.address() as AddressInfo).port}${MCP_PATH}`);
});

afterAll(() => new Promise<void>((resolve) => httpServer.close(() => resolve())));

async function connect(): Promise<Client> {
    const client = new Client({ name: 'http-test-client', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url));
    return client;
}

const text = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as { type: string; text: string }[])[0].text;

describe('mcp/http.ts (stateless Streamable HTTP)', () => {
    it('serves list_notes, get_note and run_script to an MCP client, with a fresh server per request and no session', async () => {
        const client = await connect();
        const transport = client.transport as StreamableHTTPClientTransport;
        expect(transport.sessionId).toBeUndefined();
        const builtBefore = depsBuilt;

        const listed = JSON.parse(text(await client.callTool({ name: 'list_notes', arguments: {} })));
        expect(JSON.stringify(listed)).toContain('Note One');
        expect(text(await client.callTool({ name: 'get_note', arguments: { id: 'n1' } }))).toContain('hello over http');
        const script = await client.callTool({ name: 'run_script', arguments: { code: 'const { markdown } = await journal.getNote("n1"); console.log(markdown);' } });
        expect(script.isError).toBeFalsy();
        expect(text(script)).toContain('hello over http');

        expect(depsBuilt - builtBefore).toBe(3);
        await client.close();
    });

    it('serves two clients at once', async () => {
        const [a, b] = await Promise.all([connect(), connect()]);
        const [ra, rb] = await Promise.all([a.listTools(), b.listTools()]);
        expect(ra.tools.map((tool) => tool.name)).toEqual(rb.tools.map((tool) => tool.name));
        expect(ra.tools.map((tool) => tool.name)).toContain('run_script');
        await Promise.all([a.close(), b.close()]);
    });

    it('answers 405 to GET and DELETE, 404 off the MCP path, and 403 to a non-loopback Host', async () => {
        expect((await fetch(url, { method: 'GET' })).status).toBe(405);
        expect((await fetch(url, { method: 'DELETE' })).status).toBe(405);
        expect((await fetch(new URL('/mcp', url), { method: 'POST' })).status).toBe(404);

        const { request } = await import('node:http');
        const status = await new Promise<number | undefined>((resolve, reject) => {
            const req = request(url, { method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }, (res) => {
                res.resume();
                resolve(res.statusCode);
            });
            req.on('error', reject);
            req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
        });
        expect(status).toBe(403);
    });
});
