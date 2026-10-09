import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createJournalMcpServer } from '../../mcp/createServer';
import type { NoteSummary } from '../../mcp/tools/read';
import type { WriteDeps } from '../../mcp/tools/write';
import type { AgentGrants } from '@/lib/agent/grants';
import type { DocumentMetadata } from '@/types';
import { toMarkdown } from '@/lib/agent/editEngine';

/**
 * Every feature the authoring guide documents (#519) round-trips through the MCP server:
 * markdown -> a write tool -> get_note -> the same markdown. The drive is stubbed at the
 * deps boundary; the stored note is the Yjs blob each upload carries, read back as drive.ts does.
 */

const GRANTS: AgentGrants = { version: 1, folders: { F1: 'write' }, notes: {} };

interface Stored {
    blob: Uint8Array;
    versionTag: number;
    metadata: DocumentMetadata;
}

function makeDeps(): { deps: Omit<WriteDeps, 'clientName'>; uploadedImages: () => number } {
    const store = new Map<string, Stored>();
    let images = 0;
    const docOf = (note: Stored) => {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, note.blob);
        return doc;
    };
    const summaryOf = (id: string, note: Stored): NoteSummary => ({
        id,
        title: note.metadata.title,
        folderId: note.metadata.folderId,
        tags: note.metadata.tags ?? [],
        modified: note.metadata.timestamps.modified,
    });
    const deps: Omit<WriteDeps, 'clientName'> = {
        loadGrants: async () => GRANTS,
        listFolders: async () => [{ id: 'F1', name: 'Notes' }],
        listNotes: async () => [...store].map(([id, note]) => summaryOf(id, note)),
        getNote: async (id) => {
            const note = store.get(id);
            return note ? { summary: summaryOf(id, note), markdown: toMarkdown(docOf(note)) } : null;
        },
        fetchNoteForEdit: async (id) => {
            const note = store.get(id);
            if (!note) return null;
            return { summary: summaryOf(id, note), doc: docOf(note), versionTag: String(note.versionTag), fileId: `file-${id}`, metadata: note.metadata };
        },
        uploadNoteEdit: async (id, edit) => {
            const note = store.get(id)!;
            store.set(id, { blob: edit.yjsBlob, versionTag: note.versionTag + 1, metadata: edit.metadata });
        },
        createNote: async (id, metadata, blob) => {
            store.set(id, { blob, versionTag: 1, metadata });
        },
        createFolder: async () => {},
        grantFolder: async () => {},
        trashNote: async (id) => void store.delete(id),
        uploadNoteImage: async (id) => {
            const note = store.get(id)!;
            store.set(id, { ...note, versionTag: note.versionTag + 1 });
            return `jrnl_img${images++}`;
        },
    };
    return { deps, uploadedImages: () => images };
}

async function connect(deps: Omit<WriteDeps, 'clientName'>): Promise<Client> {
    const server = createJournalMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'round-trip', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
}

async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    const [content] = result.content as Array<{ type: string; text: string }>;
    if (result.isError) throw new Error(content.text);
    return JSON.parse(content.text) as T;
}

const getMarkdown = async (client: Client, id: string) => (await call<{ markdown: string }>(client, 'get_note', { id })).markdown;

const FEATURES: Record<string, string> = {
    headings: '# Title\n\n## Section\n\n### Subsection\n\nA paragraph with **bold**, *italic*, ~~strike~~, `code` and a [link](https://journal.cloudx.run).',
    callout: '> [!warning]\n> Back up the database first.\n>\n> Then run the migration.',
    toggle: '<details>\n<summary>Full error log</summary>\n\nThe body, hidden until the reader opens it.\n\n</details>',
    'task list': '- [ ] Book the train\n- [x] Pack',
    'inline math': 'The energy is $E = mc^2$.',
    'block math': '$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$',
    footnotes: 'Journal syncs through Homebase.[^1] It works offline.[^2]\n\n[^1]: Your own identity.\n[^2]: Changes sync later.',
    table: '| Day | Distance |\n| --- | --- |\n| Mon | 5 km |\n| Wed | 8 km |',
    'mermaid block': '```mermaid id=r3l5\nflowchart LR\n  A[Write] --> B{Tests pass?}\n  B -- yes --> C[Merge]\n```',
    'svg block': '```svg id=c1rc\n<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#718968"/></svg>\n```',
    'html block': '```html id=t1p5\n<label>Bill <input id="bill" type="number" value="40"></label>\n<script>journal.storage.get("bill").then((v) => v && (bill.value = v));</script>\n```',
    'wide react block': "```react wide id=w1d3\nfunction App() {\n  return <p>A wide block</p>;\n}\n```",
    'react block': "```react id=d4sh\nimport { Heart } from 'lucide-react';\n\nfunction App() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(count + 1)}><Heart className=\"size-4\" /> {count}</button>;\n}\n```",
};

describe('MCP round trip of every documented feature (#519)', () => {
    for (const [feature, markdown] of Object.entries(FEATURES)) {
        it(`${feature}: create_note, then update_note with the same markdown, both read back unchanged`, async () => {
            const client = await connect(makeDeps().deps);
            const { id } = await call<{ id: string }>(client, 'create_note', { title: feature, markdown, folderId: 'F1' });
            expect(await getMarkdown(client, id)).toBe(markdown);

            await call(client, 'update_note', { id, markdown });
            expect(await getMarkdown(client, id)).toBe(markdown);
        });

        it(`${feature}: append_to_note reads back unchanged after the existing body`, async () => {
            const client = await connect(makeDeps().deps);
            const { id } = await call<{ id: string }>(client, 'create_note', { title: feature, markdown: 'Before.', folderId: 'F1' });
            await call(client, 'append_to_note', { id, markdown });
            expect(await getMarkdown(client, id)).toBe(`Before.\n\n${markdown}`);
        });
    }

    it('body image: a file path is uploaded once, and the attachment markdown get_note returns round-trips', async () => {
        const { deps, uploadedImages } = makeDeps();
        const client = await connect(deps);
        const path = fileURLToPath(new URL('./fixtures/images/cover-plain.webp', import.meta.url));
        const { id } = await call<{ id: string }>(client, 'create_note', { title: 'Trip', markdown: `Lisbon.\n\n![a tram](${path})`, folderId: 'F1' });
        const markdown = await getMarkdown(client, id);
        expect(markdown).toBe(`Lisbon.\n\n![a tram](attachment://file-${id}/jrnl_img0)`);

        await call(client, 'update_note', { id, markdown });
        expect(await getMarkdown(client, id)).toBe(markdown);
        expect(uploadedImages()).toBe(1);
    });
});
