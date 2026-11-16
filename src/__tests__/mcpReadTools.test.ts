import { describe, it, expect } from 'vitest';
import { listFolders, listNotes, getNote, searchNotes, searchTerms, type ReadDeps, type NoteSummary } from '@/lib/agent/tools/read';
import { createNoteTextCache } from '../../mcp/noteTextCache';
import { TOOLS } from '@/lib/agent/tools/registry';
import type { AgentGrants } from '@/lib/agent/grants';

// F1 granted read, F2 granted none.
const FOLDERS = [
    { id: 'F1', name: 'Folder One' },
    { id: 'F2', name: 'Folder Two' },
];

// n1 in F1 (read via folder), n2 in F2 (none), n3 in F2 with a note-level write override,
// n4 in F1 but excludeFromAI: true (always none, regardless of its folder's grant).
const NOTES: NoteSummary[] = [
    { id: 'n1', title: 'Note One', folderId: 'F1', tags: [], modified: '2024-01-01T00:00:00.000Z' },
    { id: 'n2', title: 'Note Two', folderId: 'F2', tags: [], modified: '2024-01-02T00:00:00.000Z' },
    { id: 'n3', title: 'Note Three', folderId: 'F2', tags: [], modified: '2024-01-03T00:00:00.000Z' },
    {
        id: 'n4',
        title: 'Note Four',
        folderId: 'F1',
        tags: [],
        modified: '2024-01-04T00:00:00.000Z',
        excludeFromAI: true,
    },
];

const NOTE_BODIES: Record<string, string> = {
    n1: 'Body of note one.',
    n2: 'Body of note two mentions onlyinn2body.',
    n3: 'Body of note three contains uniquebodyword.',
    n4: 'Body of note four.',
};

const GRANTS: AgentGrants = {
    version: 1,
    folders: { F1: 'read' },
    notes: { n3: 'write' },
};

function makeDeps(grants: AgentGrants = GRANTS): { deps: ReadDeps; getNoteCalls: string[] } {
    const getNoteCalls: string[] = [];
    const deps: ReadDeps = {
        loadGrants: async () => grants,
        listFolders: async () => FOLDERS,
        listNotes: async () => NOTES,
        getNote: async (id: string) => {
            getNoteCalls.push(id);
            const summary = NOTES.find((note) => note.id === id);
            if (!summary) return null;
            return { summary, markdown: NOTE_BODIES[id] ?? '' };
        },
    };
    return { deps, getNoteCalls };
}

describe('mcp read tools', () => {
    it('list_folders returns only granted folders', async () => {
        const { deps } = makeDeps();
        expect(await listFolders(deps)).toEqual([{ id: 'F1', name: 'Folder One', access: 'read' }]);
    });

    it('list_notes returns only granted notes, newest first, and honours limit', async () => {
        const { deps } = makeDeps();
        const notes = await listNotes(deps);
        expect(notes.map((note) => note.id)).toEqual(['n3', 'n1']);

        const limited = await listNotes(deps, { limit: 1 });
        expect(limited.map((note) => note.id)).toEqual(['n3']);
    });

    it('list_notes returns the default fields, or the ones asked for, plus access only when read-only (#1003)', async () => {
        const { deps } = makeDeps();
        expect(await listNotes(deps)).toEqual([
            { id: 'n3', title: 'Note Three', folderId: 'F2', modified: '2024-01-03T00:00:00.000Z' },
            { id: 'n1', title: 'Note One', folderId: 'F1', modified: '2024-01-01T00:00:00.000Z', access: 'read' },
        ]);
        expect(await listNotes(deps, { fields: ['title', 'tags'] })).toEqual([
            { title: 'Note Three', tags: [] },
            { title: 'Note One', tags: [], access: 'read' },
        ]);
    });

    it('get_note rejects ungranted, excluded and missing notes with the same message shape', async () => {
        const { deps } = makeDeps();
        await expect(getNote(deps, { id: 'n2' })).rejects.toThrow('Note not found: n2');
        await expect(getNote(deps, { id: 'n4' })).rejects.toThrow('Note not found: n4');
        await expect(getNote(deps, { id: 'does-not-exist' })).rejects.toThrow('Note not found: does-not-exist');
    });

    it('get_note returns the markdown body for a granted note', async () => {
        const { deps } = makeDeps();
        const note = await getNote(deps, { id: 'n1' });
        expect(note.access).toBe('read');
        expect(note.markdown).toBe(NOTE_BODIES.n1);
    });

    it('search_notes never fetches the body of an ungranted note', async () => {
        const { deps, getNoteCalls } = makeDeps();
        const results = await searchNotes(deps, { query: 'onlyinn2body' });
        expect(results).toEqual([]);
        expect(getNoteCalls).not.toContain('n2');
    });

    it('search_notes matches a granted note body', async () => {
        const { deps } = makeDeps();
        const results = await searchNotes(deps, { query: 'uniquebodyword' });
        expect(results.map((note) => note.id)).toEqual(['n3']);
    });

    it('reflects a changed loadGrants result on the next call', async () => {
        let grants: AgentGrants = { version: 1, folders: {}, notes: {} };
        const deps: ReadDeps = {
            loadGrants: async () => grants,
            listFolders: async () => FOLDERS,
            listNotes: async () => NOTES,
            getNote: async () => null,
        };

        expect(await listFolders(deps)).toEqual([]);

        grants = { version: 1, folders: { F1: 'read' }, notes: {} };
        expect(await listFolders(deps)).toEqual([{ id: 'F1', name: 'Folder One', access: 'read' }]);
    });
});

describe('search_notes terms, snippets, order, filters and cache (#1232)', () => {
    const note = (id: string, title: string, modified: string, extra: Partial<NoteSummary> = {}): NoteSummary => ({
        id,
        title,
        folderId: 'F1',
        tags: [],
        modified,
        ...extra,
    });

    /** Deps over `notes` and `bodies`; `fetched` counts body fetches per id. */
    function searchDeps(
        notes: NoteSummary[],
        bodies: Record<string, string>,
        grants: AgentGrants = { version: 1, folders: { F1: 'write' }, notes: {} }
    ) {
        const fetched: string[] = [];
        const text = createNoteTextCache(async (id) => {
            fetched.push(id);
            const summary = notes.find((n) => n.id === id)!;
            return { modified: summary.modified, text: bodies[id] ?? '' };
        });
        const deps: ReadDeps = {
            loadGrants: async () => grants,
            listFolders: async () => [],
            listNotes: async () => notes,
            getNote: async () => {
                throw new Error('getNote must not be called when getNoteText is there');
            },
            getNoteText: text,
        };
        return { deps, fetched };
    }

    it('splits the query into terms, keeping "phrases" together', () => {
        expect(searchTerms('budget  2026')).toEqual(['budget', '2026']);
        expect(searchTerms('"Travel   Budget" Café')).toEqual(['travel budget', 'cafe']);
        expect(searchTerms('  "" ')).toEqual([]);
    });

    it('matches every word wherever it is, with a snippet that shows one of them', async () => {
        const notes = [note('a', 'Plans', '2026-01-02T00:00:00Z')];
        const { deps } = searchDeps(notes, { a: 'Notes for the year. The 2026 travel budget is small.' });
        const results = await searchNotes(deps, { query: 'budget 2026' });
        expect(results.map((r) => r.id)).toEqual(['a']);
        expect(results[0].snippet).toContain('2026 travel budget');
        expect((await searchNotes(deps, { query: 'budget 2027' })).length).toBe(0);
    });

    it('matches a quoted phrase only as a phrase', async () => {
        const notes = [note('a', 'A', '2026-01-02T00:00:00Z'), note('b', 'B', '2026-01-01T00:00:00Z')];
        const { deps } = searchDeps(notes, { a: 'the travel budget', b: 'budget for travel' });
        expect((await searchNotes(deps, { query: '"travel budget"' })).map((r) => r.id)).toEqual(['a']);
        expect((await searchNotes(deps, { query: 'travel budget' })).map((r) => r.id)).toEqual(['a', 'b']);
    });

    it('ignores accents in either direction', async () => {
        const notes = [note('a', 'A', '2026-01-02T00:00:00Z'), note('b', 'B', '2026-01-01T00:00:00Z')];
        const { deps } = searchDeps(notes, { a: 'Lunch at the café', b: 'plain cafe' });
        expect((await searchNotes(deps, { query: 'cafe' })).map((r) => r.id)).toEqual(['a', 'b']);
        const cafe = await searchNotes(deps, { query: 'CAFÉ' });
        expect(cafe[0].snippet).toBe('Lunch at the café');
    });

    it('cuts a long snippet at word boundaries with ellipses', async () => {
        const body = `${'lorem ipsum '.repeat(60)}needle ${'dolor sit '.repeat(60)}`;
        const { deps } = searchDeps([note('a', 'A', '2026-01-02T00:00:00Z')], { a: body });
        const snippet = (await searchNotes(deps, { query: 'needle' }))[0].snippet!;
        expect(snippet.startsWith('…')).toBe(true);
        expect(snippet.endsWith('…')).toBe(true);
        expect(snippet).toContain('needle');
        expect(snippet.length).toBeLessThan(215);
        expect(snippet.slice(1, -1)).toMatch(/^[a-z]+( [a-z]+)*$/);
    });

    it('lists title hits, then tag hits, then body hits, each newest first, and stops fetching bodies at the limit', async () => {
        const notes = [
            note('body-new', 'Other', '2026-05-01T00:00:00Z'),
            note('tag', 'Other', '2026-04-01T00:00:00Z', { tags: ['Recipe'] }),
            note('title-old', 'Recipe ideas', '2026-01-01T00:00:00Z'),
            note('title-new', 'My recipe', '2026-03-01T00:00:00Z'),
            note('body-old', 'Other', '2026-02-01T00:00:00Z'),
        ];
        const { deps } = searchDeps(notes, { 'body-new': 'a recipe', 'body-old': 'a recipe' });
        const all = await searchNotes(deps, { query: 'recipe' });
        expect(all.map((r) => r.id)).toEqual(['title-new', 'title-old', 'tag', 'body-new', 'body-old']);
        expect(all[0].snippet).toBeUndefined();
        expect(all[3].snippet).toBe('a recipe');

        const { deps: fresh, fetched } = searchDeps(notes, {});
        expect((await searchNotes(fresh, { query: 'recipe', limit: 3 })).map((r) => r.id)).toEqual(['title-new', 'title-old', 'tag']);
        expect(fetched).toEqual([]);
    });

    it('filters by folder, tag and dates without fetching a body', async () => {
        const notes = [
            note('a', 'A', '2026-10-05T00:00:00Z', { tags: ['recipe'] }),
            note('b', 'B', '2026-09-05T00:00:00Z', { tags: ['recipe'] }),
            note('c', 'C', '2026-10-06T00:00:00Z', { tags: ['other'] }),
            note('d', 'D', '2026-10-07T00:00:00Z', { tags: ['Recipe'], folderId: 'F2' }),
        ];
        const grants: AgentGrants = { version: 1, folders: { F1: 'write', F2: 'write' }, notes: {} };
        const { deps, fetched } = searchDeps(notes, {}, grants);
        const ids = async (params: Parameters<typeof searchNotes>[1]) => (await searchNotes(deps, params)).map((r) => r.id);

        expect(await ids({ query: '', tag: 'recipe', modifiedAfter: '2026-10-01' })).toEqual(['d', 'a']);
        expect(await ids({ query: '', folderId: 'F2' })).toEqual(['d']);
        expect(await ids({ query: '', modifiedBefore: '2026-10-06' })).toEqual(['a', 'b']);
        expect(await ids({ query: '' })).toEqual([]);
        expect((await searchNotes(deps, { query: '', tag: 'recipe' }))[0].snippet).toBeUndefined();
        expect(fetched).toEqual([]);
        await expect(searchNotes(deps, { query: '', modifiedAfter: 'soon' })).rejects.toThrow('Not an ISO date');
    });

    it('fetches each body once across searches, and again only for a note whose modified changed', async () => {
        const notes = [note('a', 'A', '2026-01-02T00:00:00Z'), note('b', 'B', '2026-01-01T00:00:00Z')];
        const { deps, fetched } = searchDeps(notes, { a: 'x', b: 'x' });
        await searchNotes(deps, { query: 'nothing' });
        await searchNotes(deps, { query: 'else' });
        expect([...fetched].sort()).toEqual(['a', 'b']);

        notes[0] = note('a', 'A', '2026-02-02T00:00:00Z');
        await searchNotes(deps, { query: 'again' });
        expect([...fetched].sort()).toEqual(['a', 'a', 'b']);
    });

    it('drops the least recently used text past its bound', async () => {
        const fetched: string[] = [];
        const get = createNoteTextCache(async (id) => (fetched.push(id), { modified: 'm', text: 'xxxx' }), 8);
        const n = (id: string) => note(id, id, 'm');
        await get(n('a'));
        await get(n('b'));
        await get(n('a'));
        await get(n('c'));
        // c pushed b, the least recently used, out.
        await get(n('a'));
        await get(n('b'));
        expect(fetched).toEqual(['a', 'b', 'c', 'b']);
    });

    it('never fetches, caches or returns a note with access none, with or without filters', async () => {
        const notes = [
            note('ok', 'Budget', '2026-01-03T00:00:00Z', { tags: ['t'] }),
            note('hidden', 'Budget', '2026-01-02T00:00:00Z', { folderId: 'F2', tags: ['t'] }),
            note('ai', 'Budget', '2026-01-01T00:00:00Z', { tags: ['t'], excludeFromAI: true }),
        ];
        const { deps, fetched } = searchDeps(notes, { ok: 'x', hidden: 'budget', ai: 'budget' });
        expect((await searchNotes(deps, { query: 'budget' })).map((r) => r.id)).toEqual(['ok']);
        expect((await searchNotes(deps, { query: 'zzz' })).map((r) => r.id)).toEqual([]);
        expect((await searchNotes(deps, { query: '', tag: 't' })).map((r) => r.id)).toEqual(['ok']);
        expect((await searchNotes(deps, { query: 'budget', folderId: 'F2' })).map((r) => r.id)).toEqual([]);
        expect(fetched).not.toContain('hidden');
        expect(fetched).not.toContain('ai');
    });

    it('falls back to getNote markdown when the deps have no getNoteText', async () => {
        const { deps } = makeDeps();
        const results = await searchNotes(deps, { query: 'body uniquebodyword' });
        expect(results.map((r) => r.id)).toEqual(['n3']);
        expect(results[0].snippet).toContain('uniquebodyword');
    });

    it('rejects a limit over 100 in the schema', () => {
        const input = TOOLS.find((tool) => tool.name === 'search_notes')!.input;
        expect(input.safeParse({ query: 'x', limit: 500 }).success).toBe(false);
        expect(input.safeParse({ query: 'x', limit: 100, modifiedAfter: '2026-10-01' }).success).toBe(true);
        expect(input.safeParse({ query: 'x', modifiedBefore: 'tomorrow' }).success).toBe(false);
    });
});
