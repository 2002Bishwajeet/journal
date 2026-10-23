import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOLS } from '@/lib/agent/tools/registry';
import type { WriteDeps } from '@/lib/agent/tools/write';
import { loadImage } from './imageSource';

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
- Note links: [label](journal:note/<id>), or [[Note title]] for the one note you can see with that title.
- Link previews: a link alone on its line followed by <!-- preview -->, e.g. <https://journal.cloudx.run><!-- preview -->.
- Body images: ![alt](/absolute/path.png) or a data: URI is uploaded; keep the attachment:// srcs get_note returns.
- Galleries: two or more images on one line between <div data-gallery="row"> and </div>, with blank lines around them. data-gallery is row, grid, masonry or carousel.
- Covers: set_note_cover and clear_note_cover, not an image at the top of the body.
- Live blocks: a fenced block in mermaid (diagrams), svg (a static drawing), html (a sandboxed page with script) or react (a JSX component that can import recharts, lucide-react, d3, three, lodash, mathjs, papaparse and the journal-ui kit). Put an id after the language (\`\`\`html id=k3f9) and keep it when rewriting the block: it keys the block's saved state.

Interactive tools, calculators, dashboards, charts, simulations and small games are welcome in a note: build them as an html or react block. Use a native block (table, callout, toggle, task list, mermaid) when it can carry the content. Design a live block for the ~650px note column with a fluid layout (it is also shown at 390px: single column, nothing wider than the frame, tap targets usable without hover, so check it at 390px before you finish); add \`wide\` to its fence (\`\`\`react wide id=k3f9) only when the content needs horizontal room, and keep it when rewriting the block.

To change part of a note, call get_note with format "blocks" and edit_block that one block, table cell or attribute; everything else stays as it is.

Before writing anything beyond plain markdown, call get_authoring_guide: it has every block's syntax with examples, what a live block can load and do, the design rules that keep it matching the note in light and dark, and complete examples.`;

/** A tool result carrying `x` as pretty-printed JSON text. */
function json(x: unknown, notes: string[] = []) {
    return {
        content: [{ type: 'text' as const, text: JSON.stringify(x, null, 2) }, ...notes.map((text) => ({ type: 'text' as const, text }))],
    };
}

/**
 * Builds the MCP server and registers every tool in the shared registry (src/lib/agent/tools/registry.ts), bound to `deps`.
 * Lives outside mcp/server.ts (the CLI entry) so tests can connect it to an
 * in-memory transport with fake deps — no SDK/drive access needed for the real server to
 * be exercised. `clientName` comes from this server's own initialize handshake.
 */
export function createJournalMcpServer(driveDeps: Omit<WriteDeps, 'clientName' | 'loadImage'>): McpServer {
    const server = new McpServer({ name: 'journal-mcp', version: '0.1.0' }, { instructions: INSTRUCTIONS });
    const deps: WriteDeps = { ...driveDeps, loadImage, clientName: () => server.server.getClientVersion()?.name ?? '' };

    for (const tool of TOOLS) {
        server.registerTool(
            tool.name,
            { title: tool.title, description: tool.description, inputSchema: tool.input.shape },
            async (args: Record<string, unknown>) => {
                const { data, text, notes } = await tool.execute(deps, args);
                return text ? { content: [{ type: 'text' as const, text: String(data) }] } : json(data, notes);
            }
        );
    }

    return server;
}
