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
    ' Fenced code blocks with language `mermaid`, `svg`, `html` or `react` render live in Journal. ' +
    'An `html` block is one self-contained document. Besides inline <script> and <style>, it may load ' +
    'scripts, styles and fonts only from cdn.jsdelivr.net, cdnjs.cloudflare.com and unpkg.com. ' +
    'Images must be `data:` URIs. There is no network access from script (fetch, XMLHttpRequest and WebSocket fail) and no browser storage. ' +
    'To keep state in the note, an `html` or `react` block calls `journal.storage.get(key)` and `journal.storage.set(key, value)` ' +
    '(promises; JSON values; at most 64 KB per block), keyed by the `id=…` in its fence (```html id=k3f9): keep that id when rewriting a block. ' +
    "Tailwind's CDN script does not work. React needs its UMD build, and JSX needs Babel standalone, both from those hosts." +
    ' A `react` block is JSX that defines a component named `App`, or exports one as default. ' +
    "Journal compiles it and runs it on the app's own React, in the same sandbox as an `html` block, with no CDN script. " +
    'Hooks are on `React` (`React.useState`), and `useState`, `useEffect`, `useRef`, `useMemo` and `useReducer` also work without the prefix. ' +
    'It can import only from `react`, `recharts` and `lucide-react`. ' +
    "`className` takes Tailwind classes drawn in Journal's theme, in light and dark with no `dark:` variant: " +
    'prefer the theme names (`bg-muted`, `text-muted-foreground`, `border`); palette names such as `bg-blue-500` map to the theme too. ' +
    'Recharts charts take the theme without colour props: series use `--chart-2` … `--chart-5` in order, grid and axes the border and muted text colours. ' +
    'State is lost on reload unless kept with `journal.storage`.' +
    ' A block that needs room (a dashboard, a game, a simulation) can add `wide` to its fence (```react wide id=k3f9): ' +
    "it then spans the editor's full width instead of the note column, up to 2400px tall instead of 1600px; keep `wide` when rewriting the block. " +
    'Readers can open any `html` or `react` block fullscreen, so let its layout stretch.' +
    " Journal's design system comes first. " +
    '(1) Prefer a native block (callout, table, toggle, task list, mermaid) whenever one can carry the content. ' +
    "(2) An `html` block must use the note's font and colours, which it inherits, and the theme variables " +
    '(`var(--foreground)`, `var(--muted)`, `var(--muted-foreground)`, `var(--border)`, `var(--accent)`, `var(--radius)`, ' +
    "and `var(--chart-2)` to `var(--chart-5)` for data series), and leave buttons, inputs and tables unstyled so they get Journal's look. " +
    '(3) Custom styling is allowed only where the content needs it (a chart, a diagram, a game board), and still built from those variables. ' +
    'Use `--chart-2` … `--chart-5` in that order for data series, never raw colours (`--chart-1` is nearly the text colour). ' +
    '(4) No page background, gradients, shadows, badge rows, emoji headers or custom fonts. ' +
    '(5) The block sizes itself to its content: do not set a fixed page height or design for a whole screen. ' +
    'These rules apply to a `react` block unchanged.';

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
 * Builds the MCP server and wires its four read tools and eight write tools to `deps`.
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
                'Create a Journal note from markdown in a folder you have granted Read+write access to.' + BODY_IMAGES + LIVE_BLOCKS,
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
                BODY_IMAGES.replace('Images:', 'Images in new_text:') +
                LIVE_BLOCKS,
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
                LIVE_BLOCKS,
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
