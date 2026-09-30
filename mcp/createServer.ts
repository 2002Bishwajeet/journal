import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as readTools from './tools/read';
import * as writeTools from './tools/write';
import type { WriteDeps } from './tools/write';

/**
 * Shared by the tools that take markdown: tells agents which fenced blocks render live in Journal.
 * The hosts are HTML_BLOCK_CDN_HOSTS in src/lib/liveBlocks.ts (mcpServer.test.ts holds the two together).
 */
const LIVE_BLOCKS =
    ' Fenced code blocks with language `mermaid`, `svg` or `html` render live in Journal. ' +
    'An `html` block is one self-contained document. Besides inline <script> and <style>, it may load ' +
    'scripts, styles and fonts only from cdn.jsdelivr.net, cdnjs.cloudflare.com and unpkg.com. ' +
    'Images must be `data:` URIs. There is no network access from script (fetch, XMLHttpRequest and WebSocket fail) and no storage. ' +
    "Tailwind's CDN script does not work. React needs its UMD build, and JSX needs Babel standalone, both from those hosts.";

/** A tool result carrying `x` as pretty-printed JSON text. */
function json(x: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(x, null, 2) }] };
}

/**
 * Builds the MCP server and wires its four read tools and four write tools to `deps`.
 * Lives outside mcp/server.ts (the CLI entry) so tests can connect it to an
 * in-memory transport with fake deps — no SDK/drive access needed for the real server to
 * be exercised. `clientName` comes from this server's own initialize handshake.
 */
export function createJournalMcpServer(driveDeps: Omit<WriteDeps, 'clientName'>): McpServer {
    const server = new McpServer({ name: 'journal-mcp', version: '0.1.0' });
    const deps: WriteDeps = { ...driveDeps, clientName: () => server.server.getClientVersion()?.name ?? '' };

    server.registerTool(
        'list_folders',
        {
            title: 'List folders',
            description: 'List the folders you have granted this agent access to, in Journal.',
            inputSchema: {},
        },
        async () => json(await readTools.listFolders(deps))
    );

    server.registerTool(
        'list_notes',
        {
            title: 'List notes',
            description: 'List granted Journal notes, newest first. Optionally scoped to one folder.',
            inputSchema: {
                folderId: z.string().optional(),
                limit: z.number().int().min(1).max(200).optional(),
            },
        },
        async ({ folderId, limit }) => json(await readTools.listNotes(deps, { folderId, limit }))
    );

    server.registerTool(
        'get_note',
        {
            title: 'Get note',
            description: 'Fetch one granted Journal note by id, with its body as markdown.',
            inputSchema: { id: z.string() },
        },
        async ({ id }) => json(await readTools.getNote(deps, { id }))
    );

    server.registerTool(
        'search_notes',
        {
            title: 'Search notes',
            description: 'Case-insensitive substring search over the title, tags and body of granted notes.',
            inputSchema: {
                query: z.string(),
                limit: z.number().int().min(1).optional(),
            },
        },
        async ({ query, limit }) => json(await readTools.searchNotes(deps, { query, limit }))
    );

    server.registerTool(
        'create_note',
        {
            title: 'Create note',
            description:
                'Create a Journal note from markdown in a folder you have granted Read+write access to.' + LIVE_BLOCKS,
            inputSchema: {
                title: z.string(),
                markdown: z.string(),
                folderId: z.string(),
                tags: z.array(z.string()).optional(),
            },
        },
        async ({ title, markdown, folderId, tags }) => json(await writeTools.createNote(deps, { title, markdown, folderId, tags }))
    );

    server.registerTool(
        'create_folder',
        {
            title: 'Create folder',
            description: 'Create a Journal folder. This agent gets Read+write access to it, so it can create notes there.',
            inputSchema: { name: z.string() },
        },
        async ({ name }) => json(await writeTools.createFolder(deps, { name }))
    );

    server.registerTool(
        'append_to_note',
        {
            title: 'Append to note',
            description:
                'Append markdown to the end of a Journal note with Read+write access. Merges with concurrent edits.' +
                LIVE_BLOCKS,
            inputSchema: { id: z.string(), markdown: z.string() },
        },
        async ({ id, markdown }) => json(await writeTools.appendToNote(deps, { id, markdown }))
    );

    server.registerTool(
        'replace_in_note',
        {
            title: 'Replace in note',
            description:
                "Replace one unique span of a Journal note's markdown (as returned by get_note) with new markdown. " +
                'old_text must match exactly once; include surrounding text if it is ambiguous.' +
                LIVE_BLOCKS,
            inputSchema: { id: z.string(), old_text: z.string(), new_text: z.string() },
        },
        async ({ id, old_text, new_text }) => json(await writeTools.replaceInNote(deps, { id, old_text, new_text }))
    );

    return server;
}
