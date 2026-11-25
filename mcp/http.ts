import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createJournalMcpServer, type McpDriveDeps } from './createServer';

/** The MCP endpoint's path: the resource is `https://mcp.cloudx.run/journal` once the tunnel routes `/journal` here. */
export const MCP_PATH = '/journal';

/**
 * Hosted MCP spike (#1504): the Journal tools over stateless Streamable HTTP. Every POST gets its own server and
 * transport, built from `getDeps()`, so nothing is kept between requests. GET (the server-to-client stream) and
 * DELETE (end a session) mean nothing without sessions, so they get 405.
 * No auth yet: the deps carry the keychain login's drive access, so only a loopback Host is accepted (DNS rebinding).
 */
export function createMcpHttpServer(getDeps: () => McpDriveDeps): Server {
    async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        if (new URL(req.url ?? '/', 'http://localhost').pathname !== MCP_PATH) return void res.writeHead(404).end();
        if (req.method !== 'POST') return void res.writeHead(405, { Allow: 'POST' }).end();
        const { port } = httpServer.address() as AddressInfo;
        const server = createJournalMcpServer(getDeps());
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
            enableDnsRebindingProtection: true,
            allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
        });
        res.on('close', () => void server.close());
        await server.connect(transport);
        await transport.handleRequest(req, res);
    }

    const httpServer = createServer((req, res) => {
        handle(req, res).catch(() => {
            if (!res.headersSent) res.writeHead(500);
            res.end();
        });
    });
    return httpServer;
}
