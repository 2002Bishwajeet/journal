import { describe, it, expect } from 'vitest';
import { listFolders, listNotes, getNote, searchNotes, type ReadDeps, type NoteSummary } from '../../mcp/tools/read';
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
