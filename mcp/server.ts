import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as readTools from './tools/read';
import * as writeTools from './tools/write';
import type { WriteDeps } from './tools/write';
import { loadCredentials, deleteCredentials } from './credentials';

const USAGE = `Usage: journal-mcp [login [identity] | logout | --help]

  (no command)  Start the MCP server over stdio.
  login [id]    Register the Journal MCP app on your identity and save credentials.
  logout        Delete saved credentials from the OS keychain.
  --help        Show this message.
`;

/**
 * Builds the MCP server and wires its four read tools and three write tools to `deps`.
 * Exported (rather than only constructed in main()) so tests can connect it to an
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
        async () => {
            const folders = await readTools.listFolders(deps);
            return { content: [{ type: 'text', text: JSON.stringify(folders, null, 2) }] };
        }
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
        async ({ folderId, limit }) => {
            const notes = await readTools.listNotes(deps, { folderId, limit });
            return { content: [{ type: 'text', text: JSON.stringify(notes, null, 2) }] };
        }
    );

    server.registerTool(
        'get_note',
        {
            title: 'Get note',
            description: 'Fetch one granted Journal note by id, with its body as markdown.',
            inputSchema: { id: z.string() },
        },
        async ({ id }) => {
            const note = await readTools.getNote(deps, { id });
            return { content: [{ type: 'text', text: JSON.stringify(note, null, 2) }] };
        }
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
        async ({ query, limit }) => {
            const notes = await readTools.searchNotes(deps, { query, limit });
            return { content: [{ type: 'text', text: JSON.stringify(notes, null, 2) }] };
        }
    );

    server.registerTool(
        'create_note',
        {
            title: 'Create note',
            description: 'Create a Journal note from markdown in a folder you have granted Read+write access to.',
            inputSchema: {
                title: z.string(),
                markdown: z.string(),
                folderId: z.string(),
                tags: z.array(z.string()).optional(),
            },
        },
        async ({ title, markdown, folderId, tags }) => {
            const note = await writeTools.createNote(deps, { title, markdown, folderId, tags });
            return { content: [{ type: 'text', text: JSON.stringify(note, null, 2) }] };
        }
    );

    server.registerTool(
        'append_to_note',
        {
            title: 'Append to note',
            description:
                'Append markdown to the end of a Journal note with Read+write access. Merges with concurrent edits.',
            inputSchema: { id: z.string(), markdown: z.string() },
        },
        async ({ id, markdown }) => {
            const result = await writeTools.appendToNote(deps, { id, markdown });
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
    );

    server.registerTool(
        'replace_in_note',
        {
            title: 'Replace in note',
            description:
                "Replace one unique span of a Journal note's markdown (as returned by get_note) with new markdown. " +
                'old_text must match exactly once; include surrounding text if it is ambiguous.',
            inputSchema: { id: z.string(), old_text: z.string(), new_text: z.string() },
        },
        async ({ id, old_text, new_text }) => {
            const result = await writeTools.replaceInNote(deps, { id, old_text, new_text });
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
    );

    return server;
}

async function main(): Promise<void> {
    const [, , command, ...rest] = process.argv;

    if (command === '--help' || command === '-h') {
        console.error(USAGE);
        process.exit(0);
    }

    if (command === 'login') {
        const { login } = await import('./login');
        await login(rest[0]);
        return;
    }

    if (command === 'logout') {
        deleteCredentials();
        console.error('Logged out. Credentials removed from the OS keychain.');
        return;
    }

    if (command) {
        console.error(`Unknown command: ${command}\n\n${USAGE}`);
        process.exit(1);
    }

    const creds = loadCredentials();
    if (!creds) {
        console.error('Not logged in. Run: npm run mcp:login');
        process.exit(1);
    }

    // stdout is the MCP message stream. The edit engine's editor schema transitively loads
    // app code that logs with console.debug (e.g. DocumentBroadcast), which Node writes to
    // stdout and would corrupt the stream, so route non-error logging to stderr.
    console.log = console.info = console.debug = console.error;

    // Deferred: pulls in the Homebase drive providers and Yjs markdown extraction, which
    // --help/login/logout have no need for.
    const { createDriveDeps } = await import('./drive');
    const server = createJournalMcpServer(createDriveDeps(creds));
    await server.connect(new StdioServerTransport());
    // That same app code opens a BroadcastChannel that keeps Node alive, so exit when the
    // client closes our stdin instead of lingering as an orphaned process.
    process.stdin.on('end', () => process.exit(0));
}

// Only run the CLI when this file is executed as the entry script (vite-node
// mcp/server.ts), not when it's imported as a module — e.g. by the test suite, which
// connects createJournalMcpServer() to an in-memory transport instead. vite-node's CLI
// doesn't preserve the script's own path in process.argv[1] (it stays the vite-node
// binary), so the usual `import.meta.url === pathToFileURL(process.argv[1])` entry check
// can't distinguish the two here; Vitest's own `process.env.VITEST` flag can.
if (!process.env.VITEST) {
    main().catch((err) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}
