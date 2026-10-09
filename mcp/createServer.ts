import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as readTools from './tools/read';
import * as writeTools from './tools/write';
import type { WriteDeps } from './tools/write';
// The full authoring reference (#519), inlined at build time so the packaged server carries it.
// mcpServer.test.ts checks it names every live-block language, react import and CDN host in code.
import AUTHORING_GUIDE from './AUTHORING.md?raw';

/** Sent once per session in `initialize` (#519): what a note can hold, and where the full guide is. */
const INSTRUCTIONS = `Journal is a notes app. A note has a title, tags, an optional cover image and a body, which these tools read and write as markdown. Everything below renders in Journal and on the note's public share page, in light and dark, and get_note returns it as the markdown you wrote.

A note can hold:
- Headings (# to ######), **bold**, *italic*, ~~strike~~, links, \`code\`, and fenced code with a language.
- Tables: GitHub-style pipe tables.
- Task lists: "- [ ] to do" and "- [x] done".
- Callouts: a blockquote whose first line is > [!info], > [!tip], > [!warning] or > [!error].
- Toggles: <details>, a <summary> line, a blank line, the body, a blank line, </details>.
- Math: inline $E = mc^2$, or a block of LaTeX between two $$ lines.
- Footnotes: text[^1], with "[^1]: the note" on its own line.
- Body images: ![alt](/absolute/path.png) or a data: URI is uploaded; keep the attachment:// srcs get_note returns.
- Covers: set_note_cover and clear_note_cover, not an image at the top of the body.
- Live blocks: a fenced block in mermaid (diagrams), svg (a static drawing), html (a sandboxed page with script) or react (a JSX component that can import recharts, lucide-react, d3, three, lodash, mathjs, papaparse and the journal-ui kit). Put an id after the language (\`\`\`html id=k3f9) and keep it when rewriting the block: it keys the block's saved state.

Interactive tools, calculators, dashboards, charts, simulations and small games are welcome in a note: build them as an html or react block. Use a native block (table, callout, toggle, task list, mermaid) when it can carry the content.

Before writing anything beyond plain markdown, call get_authoring_guide: it has every block's syntax with examples, what a live block can load and do, the design rules that keep it matching the note in light and dark, and complete examples.`;

/** Shared by the tools that take markdown, in place of the full guide. */
const RICH_BLOCKS = ' Supports rich blocks; call get_authoring_guide before writing anything beyond plain markdown.';

/** Shared by the tools that take markdown: an image in it can be a local file or a data: URI (#415). */
const BODY_IMAGES =
    ' Images: `![alt](/absolute/path/to/file.png)` (wrap the path in <> if it has spaces) or `![alt](data:image/png;base64,…)` ' +
    'is uploaded to the note and shown there; prefer a path, it costs no tokens. PNG, JPEG or WebP, at most 5 MB each; ' +
    'metadata such as EXIF and GPS is removed. If any image is invalid, the call fails and nothing is written. ' +
    '`https://` image URLs are kept as they are, not fetched or uploaded.';

/** A tool result carrying `x` as pretty-printed JSON text. */
function json(x: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(x, null, 2) }] };
}

/**
 * Builds the MCP server and wires its five read tools and eight write tools to `deps`.
 * Lives outside mcp/server.ts (the CLI entry) so tests can connect it to an
 * in-memory transport with fake deps — no SDK/drive access needed for the real server to
 * be exercised. `clientName` comes from this server's own initialize handshake.
 */
export function createJournalMcpServer(driveDeps: Omit<WriteDeps, 'clientName'>): McpServer {
    const server = new McpServer({ name: 'journal-mcp', version: '0.1.0' }, { instructions: INSTRUCTIONS });
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
        'get_authoring_guide',
        {
            title: 'Get authoring guide',
            description:
                'The full reference for writing Journal notes: every block a note can hold, with its markdown syntax and examples, ' +
                'how live blocks (mermaid, svg, html, react) run, and how to design them to match the note. Read it before writing rich content.',
            inputSchema: {},
        },
        async () => ({ content: [{ type: 'text' as const, text: AUTHORING_GUIDE }] })
    );

    server.registerTool(
        'create_note',
        {
            title: 'Create note',
            description:
                'Create a Journal note from markdown in a folder you have granted Read+write access to.' + BODY_IMAGES + RICH_BLOCKS,
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
                BODY_IMAGES +
                RICH_BLOCKS,
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
                BODY_IMAGES.replace('Images:', 'Images in new_text:') +
                RICH_BLOCKS,
            inputSchema: { id: z.string(), old_text: z.string(), new_text: z.string() },
        },
        async ({ id, old_text, new_text }) => json(await writeTools.replaceInNote(deps, { id, old_text, new_text }))
    );

    server.registerTool(
        'update_note',
        {
            title: 'Update note',
            description:
                "Rewrite a Journal note with Read+write access: its whole body as markdown, its title and/or its tags (tags replace the note's tags). " +
                'Use it instead of creating a second note. Blocks you keep exactly as get_note returned them stay untouched, note links and images included. ' +
                "Pass get_note's `modified` as expectedModified to refuse the edit if the note changed since. Merges with concurrent edits." +
                BODY_IMAGES +
                RICH_BLOCKS,
            inputSchema: {
                id: z.string(),
                markdown: z.string().optional(),
                title: z.string().optional(),
                tags: z.array(z.string()).optional(),
                expectedModified: z.string().optional(),
            },
        },
        async ({ id, markdown, title, tags, expectedModified }) =>
            json(await writeTools.updateNote(deps, { id, markdown, title, tags, expectedModified }))
    );

    server.registerTool(
        'delete_note',
        {
            title: 'Delete note',
            description:
                "Move a Journal note with Read+write access to Journal's Trash, where the owner can restore it. Never deletes permanently.",
            inputSchema: { id: z.string() },
        },
        async ({ id }) => json(await writeTools.deleteNote(deps, { id }))
    );

    server.registerTool(
        'set_note_cover',
        {
            title: 'Set note cover',
            description:
                "Set the cover image of a Journal note with Read+write access, replacing its cover. `image` is an absolute path to a file on this computer (preferred: it costs no tokens) or a base64 `data:` URI. " +
                'PNG, JPEG or WebP, at most 5 MB; metadata such as EXIF and GPS is removed before upload. Recommended size 2400×1260, at least 1200×630. ' +
                '`positionY` is the vertical focal point, 0 (top) to 100 (bottom), default 50. ' +
                "`dark: true` sets the cover shown in dark mode instead; the note must already have a cover. " +
                'Use this rather than an image in an html block: the cover also feeds the link preview of a public note.',
            inputSchema: {
                id: z.string(),
                image: z.string(),
                positionY: z.number().min(0).max(100).optional(),
                dark: z.boolean().optional(),
            },
        },
        async ({ id, image, positionY, dark }) => json(await writeTools.setNoteCover(deps, { id, image, positionY, dark }))
    );

    server.registerTool(
        'clear_note_cover',
        {
            title: 'Clear note cover',
            description:
                'Remove the cover image of a Journal note with Read+write access. This removes the dark-mode cover too; ' +
                'with `dark: true` only the dark-mode cover is removed.',
            inputSchema: { id: z.string(), dark: z.boolean().optional() },
        },
        async ({ id, dark }) => json(await writeTools.clearNoteCover(deps, { id, dark }))
    );

    return server;
}
