// Connects to the real Journal MCP server (mcp/) over stdio for the live
// tier (#206) -- proof that an MCP client reaches the same server a real
// agent would use, not a fake in-process stand-in (contrast with the
// InMemoryTransport fakes in src/__tests__/mcpServer.test.ts).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface JournalMcp {
    client: Client;
    stop(): Promise<void>;
}

/**
 * Spawns the Journal MCP server with the exact command mcp/README.md's
 * "Registering with an MCP client" section tells a real client to run
 * (`npm --prefix <repo> run --silent mcp`, i.e. `vite-node mcp/server.ts`),
 * so this proves the documented setup works, not a shortcut around it. Uses
 * whatever credentials this machine's OS keychain already holds -- the
 * caller is responsible for checking those exist first (see the skip logic
 * in e2e/agent-access/mcp-edit.live.spec.ts).
 */
export async function startJournalMcp(): Promise<JournalMcp> {
    const transport = new StdioClientTransport({
        command: 'npm',
        // process.cwd() is the repo root: Playwright always runs from there.
        args: ['--prefix', process.cwd(), 'run', '--silent', 'mcp'],
    });
    const client = new Client({ name: 'e2e-live', version: '0.0.0' });
    await client.connect(transport);
    return { client, stop: () => client.close() };
}

/**
 * Calls a tool and parses its result as JSON (mcp/createServer.ts's `json()`
 * helper wraps every tool's result as one pretty-printed JSON text block).
 * Throws the tool's own error message on failure.
 */
export async function callToolJson<T = unknown>(
    client: Client,
    name: string,
    args: Record<string, unknown> = {}
): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0]?.text ?? '';
    if (result.isError) throw new Error(text);
    return JSON.parse(text) as T;
}
