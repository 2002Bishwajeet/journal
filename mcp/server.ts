// Journal MCP server — lets an AI agent read/search your Homebase notes,
// the way Notion's MCP exposes Notion pages.
//
// Run with vite-node (NOT plain node) so the app's `@/` aliases and
// `import.meta.env` resolve exactly as they do in the app:
//   npm run mcp        (see mcp/README.md for the one-time .env step)
//
// ponytail: reuses the app's NotesDriveProvider + yjs helpers verbatim.
// Auth reuses the existing browser app token (IDENTITY/APSS/BX0900) from .env;
// register a dedicated Homebase MCP app later if you want independent revocation.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DotYouClient, ApiType } from '@homebase-id/js-lib/core';
import { base64ToUint8Array } from '@homebase-id/js-lib/helpers';
import { getNewId } from '@/lib/utils';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { extractMarkdownFromYjs } from '@/lib/yjs-utils';

const { HOMEBASE_IDENTITY, HOMEBASE_SHARED_SECRET, HOMEBASE_AUTH_TOKEN } = process.env;
if (!HOMEBASE_IDENTITY || !HOMEBASE_SHARED_SECRET || !HOMEBASE_AUTH_TOKEN) {
  throw new Error(
    'Missing env. Copy IDENTITY/APSS/BX0900 from the app\'s browser localStorage ' +
      'into mcp/.env (see mcp/README.md).'
  );
}

const client = new DotYouClient({
  api: ApiType.App,
  hostIdentity: HOMEBASE_IDENTITY,
  sharedSecret: base64ToUint8Array(HOMEBASE_SHARED_SECRET),
  headers: { bx0900: HOMEBASE_AUTH_TOKEN },
});
const notes = new NotesDriveProvider(client);

const server = new McpServer({ name: 'journal', version: '0.1.0' });

server.registerTool(
  'list_notes',
  {
    title: 'List notes',
    description: 'List notes newest-first. Returns id, title, tags, and modified date.',
    inputSchema: { cursor: z.string().optional(), pageSize: z.number().max(100).optional() },
  },
  async ({ cursor, pageSize }) => {
    const { notes: page, cursor: next } = await notes.queryNotes(cursor, pageSize ?? 50);
    const rows = page.map((f) => ({
      id: f.fileMetadata.appData.uniqueId,
      title: f.fileMetadata.appData.content?.title ?? '(untitled)',
      tags: f.fileMetadata.appData.content?.tags ?? [],
      modified: f.fileMetadata.updated,
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ notes: rows, cursor: next }, null, 2) }] };
  }
);

server.registerTool(
  'get_note',
  {
    title: 'Get note',
    description: 'Fetch one note by its id and return its body as markdown.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const file = await notes.getNote(id);
    if (!file) return { content: [{ type: 'text', text: `No note with id ${id}` }], isError: true };
    const blob = await notes.getNotePayload(file.fileId);
    const markdown = await extractMarkdownFromYjs(id, blob ?? undefined);
    const title = file.fileMetadata.appData.content?.title ?? '(untitled)';
    return { content: [{ type: 'text', text: `# ${title}\n\n${markdown}` }] };
  }
);

server.registerTool(
  'search_notes',
  {
    title: 'Search notes',
    description: 'Case-insensitive substring search over note titles and tags.',
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const q = query.toLowerCase();
    const { notes: page } = await notes.queryNotes(undefined, 100);
    const hits = page
      .map((f) => ({
        id: f.fileMetadata.appData.uniqueId,
        title: f.fileMetadata.appData.content?.title ?? '(untitled)',
        tags: f.fileMetadata.appData.content?.tags ?? [],
      }))
      .filter((n) => n.title.toLowerCase().includes(q) || n.tags.some((t: string) => t.toLowerCase().includes(q)));
    return { content: [{ type: 'text', text: JSON.stringify(hits, null, 2) }] };
  }
);

server.registerTool(
  'create_note',
  {
    title: 'Create note',
    description:
      'Create a note with a title and optional tags. Body text is not yet supported ' +
      '(note bodies are Yjs documents — see README rung 2). Returns the new note id.',
    inputSchema: { title: z.string(), tags: z.array(z.string()).optional() },
  },
  async ({ title, tags }) => {
    const id = getNewId();
    await notes.createNote(id, { title, tags: tags ?? [] } as never);
    return { content: [{ type: 'text', text: `Created note ${id}` }] };
  }
);

await server.connect(new StdioServerTransport());
