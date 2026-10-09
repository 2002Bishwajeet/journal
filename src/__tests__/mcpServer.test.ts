import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createJournalMcpServer } from '../../mcp/createServer';
import type { NoteSummary } from '../../mcp/tools/read';
import type { WriteDeps } from '../../mcp/tools/write';
import type { AgentGrants } from '@/lib/agent/grants';
import type { DocumentMetadata } from '@/types';
import { createDoc } from '@/lib/agent/editEngine';
import { HTML_BLOCK_CDN_HOSTS } from '@/lib/liveBlocks';

const GRANTS: AgentGrants = { version: 1, folders: { F1: 'read' }, notes: {} };
const WRITE_GRANTS: AgentGrants = { version: 1, folders: { F1: 'write' }, notes: {} };

const NOTES: NoteSummary[] = [{ id: 'n1', title: 'Note One', folderId: 'F1', tags: [], modified: '2024-01-01T00:00:00.000Z' }];

type ServerDeps = Omit<WriteDeps, 'clientName'>;

/** The write tools that take markdown, sorted. */
const MARKDOWN_TOOLS = ['append_to_note', 'create_note', 'replace_in_note', 'update_note'];

const METADATA: DocumentMetadata = {
    title: 'Note One',
    folderId: 'F1',
    tags: [],
    timestamps: { created: '2024-01-01T00:00:00.000Z', modified: '2024-01-01T00:00:00.000Z' },
    excludeFromAI: false,
};

function makeFakeDeps(grants = GRANTS, uploads: DocumentMetadata[] = []): ServerDeps {
    return {
        loadGrants: async () => grants,
        listFolders: async () => [{ id: 'F1', name: 'Folder One' }],
        listNotes: async () => NOTES,
        getNote: async (id) => {
            const summary = NOTES.find((note) => note.id === id);
            return summary ? { summary, markdown: 'body' } : null;
        },
        fetchNoteForEdit: async (id) =>
            id === 'n1'
                ? { summary: NOTES[0], doc: createDoc('todo one\n\ntodo two'), versionTag: 'v1', fileId: 'f1', metadata: METADATA }
                : null,
        uploadNoteEdit: async (_id, edit) => {
            uploads.push(edit.metadata);
        },
        createNote: async () => {},
        createFolder: async () => {},
        grantFolder: async () => {},
        trashNote: async () => {},
        uploadNoteImage: async () => 'jrnl_img0',
    };
}

async function connectedClient(deps: ServerDeps): Promise<Client> {
    const server = createJournalMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
}

describe('createJournalMcpServer', () => {
    it('registers exactly the four read tools and the eight write tools', async () => {
        const client = await connectedClient(makeFakeDeps());
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            'append_to_note',
            'clear_note_cover',
            'create_folder',
            'create_note',
            'delete_note',
            'get_note',
            'list_folders',
            'list_notes',
            'replace_in_note',
            'search_notes',
            'set_note_cover',
            'update_note',
        ]);
    });

    it('tells agents about live blocks in the markdown write tools only', async () => {
        const client = await connectedClient(makeFakeDeps());
        const { tools } = await client.listTools();
        for (const tool of tools) {
            const mentions = ['mermaid', 'svg', 'html'].every((word) => tool.description?.includes(word));
            expect(mentions).toBe(MARKDOWN_TOOLS.includes(tool.name));
        }
    });

    it("tells agents that Journal's design comes first, in order, in the four markdown write tools (#424)", async () => {
        const client = await connectedClient(makeFakeDeps());
        const { tools } = await client.listTools();
        const rules = [
            "Journal's design system comes first.",
            '(1) Prefer a native block (callout, table, toggle, task list, mermaid) whenever one can carry the content.',
            "(2) An `html` block must use the note's font and colours, which it inherits, and the theme variables",
            '`var(--chart-2)` to `var(--chart-5)` for data series',
            "leave buttons, inputs and tables unstyled so they get Journal's look.",
            '(3) Custom styling is allowed only where the content needs it (a chart, a diagram, a game board), and still built from those variables.',
            'Use `--chart-2` … `--chart-5` in that order for data series, never raw colours (`--chart-1` is nearly the text colour).',
            '(4) No page background, gradients, shadows, badge rows, emoji headers or custom fonts.',
            '(5) The block sizes itself to its content: do not set a fixed page height or design for a whole screen.',
        ];
        const described = tools.filter((tool) => MARKDOWN_TOOLS.includes(tool.name));
        expect(described).toHaveLength(4);
        for (const tool of described) {
            const positions = rules.map((rule) => tool.description!.indexOf(rule));
            expect(positions).not.toContain(-1);
            expect(positions).toEqual([...positions].sort((a, b) => a - b));
            for (const name of ['--foreground', '--muted', '--muted-foreground', '--border', '--accent', '--radius']) {
                expect(tool.description).toContain(`\`var(${name})\``);
            }
        }
        // Only the tools that take markdown carry it.
        const told = tools.filter((tool) => tool.description?.includes(rules[0])).map((tool) => tool.name);
        expect(told.sort()).toEqual(MARKDOWN_TOOLS);
    });

    it('tells agents what an html block may load: scripts, styles and fonts from three CDN hosts (#409)', async () => {
        const client = await connectedClient(makeFakeDeps());
        const { tools } = await client.listTools();
        const described = tools.filter((tool) => MARKDOWN_TOOLS.includes(tool.name));
        expect(described).toHaveLength(4);
        for (const tool of described) {
            for (const text of [
                'scripts, styles and fonts only from cdn.jsdelivr.net, cdnjs.cloudflare.com and unpkg.com',
                'Images must be `data:` URIs',
                'no network access from script',
                "Tailwind's CDN script does not work",
                'React needs its UMD build',
                'Babel standalone',
            ]) {
                expect(tool.description).toContain(text);
            }
            // Every host the block's CSP allows, and no other.
            expect(tool.description?.match(/[\w.-]+\.(?:net|com|org|io)\b/g)).toEqual(HTML_BLOCK_CDN_HOSTS.map((host) => new URL(host).host));
            expect(tool.description).not.toContain('no external scripts');
        }
    });

    it('tells agents how a react block works, and that the html design rules apply to it (#426)', async () => {
        const client = await connectedClient(makeFakeDeps());
        const { tools } = await client.listTools();
        const described = tools.filter((tool) => MARKDOWN_TOOLS.includes(tool.name));
        expect(described).toHaveLength(4);
        for (const tool of described) {
            for (const text of [
                '`mermaid`, `svg`, `html` or `react`',
                'defines a component named `App`',
                'or exports one as default',
                '`useState`, `useEffect`, `useRef`, `useMemo` and `useReducer`',
                // #427
                'It can import only from `react`, `recharts` and `lucide-react`.',
                "`className` takes Tailwind classes drawn in Journal's theme",
                'Recharts charts take the theme without colour props',
                'State is lost on reload',
                // #410
                '`journal.storage.get(key)` and `journal.storage.set(key, value)`',
                'keep that id when rewriting a block',
                'These rules apply to a `react` block unchanged.',
            ]) {
                expect(tool.description).toContain(text);
            }
            // The rules come before the sentence that applies them to react blocks.
            expect(tool.description!.indexOf('(5) The block sizes itself')).toBeLessThan(tool.description!.indexOf('These rules apply to a `react` block'));
        }
        const told = tools.filter((tool) => tool.description?.includes('named `App`')).map((tool) => tool.name);
        expect(told.sort()).toEqual(MARKDOWN_TOOLS);
    });

    it('tells agents about wide blocks and fullscreen (#557)', async () => {
        const client = await connectedClient(makeFakeDeps());
        const { tools } = await client.listTools();
        const told = tools.filter((tool) => tool.description?.includes('```react wide id=k3f9')).map((tool) => tool.name);
        expect(told.sort()).toEqual(MARKDOWN_TOOLS);
        for (const tool of tools.filter((t) => MARKDOWN_TOOLS.includes(t.name))) {
            for (const text of ['up to 2400px tall', 'keep `wide` when rewriting the block', 'fullscreen']) expect(tool.description).toContain(text);
        }
    });

    it('attributes writes to the client name from the initialize handshake', async () => {
        const uploads: DocumentMetadata[] = [];
        const client = await connectedClient(makeFakeDeps(WRITE_GRANTS, uploads));
        const result = await client.callTool({ name: 'append_to_note', arguments: { id: 'n1', markdown: 'agent line' } });
        expect(result.isError).toBeFalsy();
        expect(uploads.map((metadata) => metadata.lastEditedBy)).toEqual(['agent:test-client']);
    });

    it('returns the edit engine error verbatim as a tool error', async () => {
        const client = await connectedClient(makeFakeDeps(WRITE_GRANTS));
        const result = await client.callTool({
            name: 'replace_in_note',
            arguments: { id: 'n1', old_text: 'todo', new_text: 'done' },
        });
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([
            { type: 'text', text: 'replace_in_note: old_text matches 2 times; include more surrounding text' },
        ]);
    });

    it('callTool list_notes returns the granted notes', async () => {
        const client = await connectedClient(makeFakeDeps());
        const result = await client.callTool({ name: 'list_notes', arguments: {} });
        const content = result.content as Array<{ type: string; text: string }>;
        const notes = JSON.parse(content[0].text);
        expect(notes).toEqual([{ id: 'n1', title: 'Note One', folderId: 'F1', modified: '2024-01-01T00:00:00.000Z', tags: [], access: 'read' }]);
    });

    it('update_note, delete_note and the cover tools reject a read-only grant as tool errors', async () => {
        const client = await connectedClient(makeFakeDeps(GRANTS));
        for (const [name, args] of [
            ['update_note', { id: 'n1', markdown: 'new' }],
            ['delete_note', { id: 'n1' }],
            ['set_note_cover', { id: 'n1', image: '/no/such/file.png' }],
            ['clear_note_cover', { id: 'n1' }],
        ] as const) {
            const result = await client.callTool({ name, arguments: args });
            expect(result.isError).toBe(true);
            expect(result.content).toEqual([{ type: 'text', text: 'Note is read-only for agents: n1' }]);
        }
    });

    it('delete_note trashes the note and returns its state', async () => {
        const trashed: string[] = [];
        const client = await connectedClient({ ...makeFakeDeps(WRITE_GRANTS), trashNote: async (id) => void trashed.push(id) });
        const result = await client.callTool({ name: 'delete_note', arguments: { id: 'n1' } });
        const content = result.content as Array<{ type: string; text: string }>;
        expect(JSON.parse(content[0].text)).toEqual({ id: 'n1', state: 'trashed' });
        expect(trashed).toEqual(['n1']);
    });

    it('update_note sets the title and tags through the server', async () => {
        const uploads: DocumentMetadata[] = [];
        const client = await connectedClient(makeFakeDeps(WRITE_GRANTS, uploads));
        const result = await client.callTool({
            name: 'update_note',
            arguments: { id: 'n1', title: 'Renamed', tags: ['a'], expectedModified: '2024-01-01T00:00:00.000Z' },
        });
        expect(result.isError).toBeFalsy();
        expect(uploads).toMatchObject([{ title: 'Renamed', tags: ['a'], lastEditedBy: 'agent:test-client' }]);
    });
});
