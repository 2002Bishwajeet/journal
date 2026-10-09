import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createJournalMcpServer } from '../../mcp/createServer';
import type { NoteSummary } from '../../mcp/tools/read';
import type { WriteDeps } from '../../mcp/tools/write';
import type { AgentGrants } from '@/lib/agent/grants';
import type { DocumentMetadata } from '@/types';
import { createDoc } from '@/lib/agent/editEngine';
import { HTML_BLOCK_CDN_HOSTS } from '@/lib/liveBlocks';
import { REACT_BLOCK_IMPORTS } from '@/lib/reactBlockLibraries';
import GUIDE from '../../mcp/AUTHORING.md?raw';
import LIVE_BLOCKS_SOURCE from '@/lib/liveBlocks.ts?raw';

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
    it('registers exactly the five read tools and the eight write tools', async () => {
        const client = await connectedClient(makeFakeDeps());
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            'append_to_note',
            'clear_note_cover',
            'create_folder',
            'create_note',
            'delete_note',
            'get_authoring_guide',
            'get_note',
            'list_folders',
            'list_notes',
            'replace_in_note',
            'search_notes',
            'set_note_cover',
            'update_note',
        ]);
    });

    it('points the four markdown write tools, and only them, to the authoring guide in one line (#519)', async () => {
        const client = await connectedClient(makeFakeDeps());
        const { tools } = await client.listTools();
        const pointer = 'Supports rich blocks; call get_authoring_guide before writing anything beyond plain markdown.';
        const told = tools.filter((tool) => tool.description?.includes(pointer)).map((tool) => tool.name);
        expect(told.sort()).toEqual(MARKDOWN_TOOLS);
        for (const tool of tools) {
            // The long live-block text is in the guide now, not in every description.
            expect(tool.description).not.toContain('journal.storage');
            expect(tool.description).not.toContain('design system comes first');
        }
    });

    it('sends instructions of at most 30 lines in initialize, naming every feature and the guide (#519)', async () => {
        const client = await connectedClient(makeFakeDeps());
        const instructions = client.getInstructions() ?? '';
        expect(instructions.split('\n').length).toBeLessThanOrEqual(30);
        for (const feature of [
            'Headings',
            'Tables',
            'Task lists',
            'Callouts',
            'Toggles',
            'Math',
            'Footnotes',
            'Body images',
            'Covers',
            'set_note_cover',
            'mermaid',
            'svg',
            'html',
            'react',
            'id=',
            'dashboards',
            'games',
            'get_authoring_guide',
        ]) {
            expect(instructions).toContain(feature);
        }
    });

    it('get_authoring_guide takes no arguments and returns mcp/AUTHORING.md as it is (#519)', async () => {
        const client = await connectedClient(makeFakeDeps());
        const { tools } = await client.listTools();
        expect(tools.find((tool) => tool.name === 'get_authoring_guide')?.inputSchema.properties ?? {}).toEqual({});
        const result = await client.callTool({ name: 'get_authoring_guide', arguments: {} });
        expect(result.isError).toBeFalsy();
        expect(result.content).toEqual([{ type: 'text', text: GUIDE }]);
    });

    it('the README links to the guide instead of repeating it (#519)', () => {
        const readme = readFileSync(new URL('../../mcp/README.md', import.meta.url), 'utf8');
        expect(readme).toContain('(AUTHORING.md)');
        for (const section of ['### How an `html` block works', '#### Tailwind in a `react` block', '#### Charts in a `react` block']) {
            expect(GUIDE).toContain(section);
            expect(readme).not.toContain(section);
        }
        expect(readme).not.toContain('Designing an `html` block');
    });

    it('tells agents in initialize to design for the column and keep `wide` for content that needs room (#557)', async () => {
        const client = await connectedClient(makeFakeDeps());
        const instructions = client.getInstructions() ?? '';
        for (const text of ['~650px note column with a fluid layout', '```react wide id=k3f9', 'only when the content needs horizontal room', 'keep it when rewriting the block']) {
            expect(instructions).toContain(text);
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

describe('the authoring guide (#519)', () => {
    it("has Journal's design rules in order, and the theme variables (#424)", () => {
        const rules = [
            '1. **Prefer a native block whenever one can carry the content**',
            "2. **An `html` block uses the note's font, colours and the theme variables, and leaves\n   buttons, inputs and tables unstyled.**",
            '3. **Custom styling only where the content needs it**: a chart, a diagram, a game board.',
            '4. **By default, no page background, gradients, shadows, badge rows, emoji headers or\n   custom fonts.**',
            '5. **The block sizes itself to its content.**',
            'These rules apply to a `react` block unchanged',
        ];
        const positions = rules.map((rule) => GUIDE.indexOf(rule));
        expect(positions).not.toContain(-1);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        for (const name of ['--foreground', '--muted', '--muted-foreground', '--border', '--accent', '--radius', '--chart-2', '--chart-5']) {
            expect(GUIDE).toContain(`| \`${name}\` |`);
        }
        expect(GUIDE).toContain('Use `--chart-2` … `--chart-5` in order for data\nseries, and never raw colours.');
    });

    it('says how a block is laid out in the column, `wide` and fullscreen, in order (#557)', () => {
        for (const text of ['```` ```react wide id=k3f9 ````', 'up to about 1150px and centred on the column', 'up to 2400px tall', 'keep it when rewriting the block', 'Expand button']) {
            expect(GUIDE).toContain(text);
        }
        const rules = [
            '1. **Design for the note column first (about 650px), and keep the layout fluid**',
            '2. **`wide` only when the content needs the horizontal room**',
            'Never for a form, a counter,\n   a single chart or text.',
            'Prose stays in markdown at reading width, never inside a wide\n   block.',
            '3. **A wide block reads as a figure between paragraphs.**',
            "4. **Fullscreen is the reader's choice, not yours.**",
            '(`max-width: 65ch`)',
        ];
        const positions = rules.map((rule) => GUIDE.indexOf(rule));
        expect(positions).not.toContain(-1);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        for (const text of ['no fixed pixel widths', '`ResizeObserver`', '`ResponsiveContainer`', 'at 390px']) expect(GUIDE).toContain(text);
    });

    it('says what an html block may load: scripts, styles and fonts from the CDN hosts, and no other host (#409)', () => {
        for (const text of [
            'Scripts, stylesheets and fonts from three CDN hosts',
            'Images, fonts and media as `data:` URIs',
            '`fetch`, `XMLHttpRequest` and `WebSocket` all fail',
            "Tailwind's CDN script",
            'React needs its UMD build',
            'Babel standalone',
            'up to 1600px',
        ]) {
            expect(GUIDE).toContain(text);
        }
        // Every host the block's CSP allows, and no other.
        const named = new Set(GUIDE.match(/[\w.-]+\.(?:net|com|org|io)\b/g));
        expect([...named].sort()).toEqual(HTML_BLOCK_CDN_HOSTS.map((host) => new URL(host).host).sort());
    });

    it('says how a react block and journal.storage work (#410, #426, #427)', () => {
        for (const text of [
            'defines a component named `App`, or exports one as default',
            '`useState`,\n  `useEffect`, `useRef`, `useMemo` and `useReducer`',
            "`className` takes Tailwind classes, drawn in Journal's theme",
            'no `dark:` variant is needed',
            'Leave the colour props out',
            'State in the component is lost on reload',
            '`journal.storage.get(key)` and `journal.storage.set(key, value)`',
            'at most 64 KB',
            '**Keep the `id=…` part of the fence whenever you rewrite a\nblock**',
        ]) {
            expect(GUIDE).toContain(text);
        }
    });

    it('shows the syntax of every native block, and the complete examples', () => {
        for (const text of [
            '> [!info]',
            '> [!tip]',
            '> [!warning]',
            '> [!error]',
            '<summary>',
            '- [ ] ',
            '- [x] ',
            '| --- |',
            '$E = mc^2$',
            '$$\n',
            '[^1]: ',
            '![alt](/absolute/path/to/file.png)',
            'attachment://',
            'set_note_cover',
            '### A small dashboard',
            '### An interactive calculator',
            '### A chart',
            '### A mermaid diagram',
        ]) {
            expect(GUIDE).toContain(text);
        }
    });

    it('names every live-block language, react import and CDN host that the code allows', () => {
        // Read from the code (src/lib/liveBlocks.ts, src/lib/reactBlockLibraries.ts), so one added there and not here fails this test.
        const languages = [...LIVE_BLOCKS_SOURCE.matchAll(/lang === '([^']+)'/g)].map((match) => match[1]);
        expect(languages).toEqual(expect.arrayContaining(['mermaid', 'svg', 'html', 'react']));
        for (const language of languages) expect(GUIDE).toContain(`| \`${language}\` |`);
        // Every module a react block can import (#558), and no other.
        const importSentence = GUIDE.match(/It can import from (.+?), and from nothing else/s)?.[1] ?? '';
        expect([...importSentence.matchAll(/`([^`]+)`/g)].map((match) => match[1]).sort()).toEqual([...REACT_BLOCK_IMPORTS].sort());
        for (const host of HTML_BLOCK_CDN_HOSTS) expect(GUIDE).toContain(`\`${host}\``);
    });
});
