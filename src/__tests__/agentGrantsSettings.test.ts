/**
 * Settings → Agent access view-model (#168): pure-logic tests only, per #196's testing
 * policy (integration first, no DOM rendering, no fake Homebase drive).
 */
import { describe, it, expect } from 'vitest';
import { buildNoteRows } from '@/hooks/useAgentGrants';
import { EMPTY_GRANTS, folderAccess, setFolderAccess, setNoteAccess, type AgentGrants } from '@/lib/agent/grants';
import type { NoteListEntry } from '@/types';

const FOLDER_ID = '22222222-2222-2222-2222-222222222222';
const NOTE_ID = '11111111-1111-1111-1111-111111111111';

function note(overrides: Partial<NoteListEntry['metadata']> = {}): NoteListEntry {
    return {
        docId: NOTE_ID,
        title: 'Standup notes',
        preview: '',
        metadata: {
            title: 'Standup notes',
            folderId: FOLDER_ID,
            timestamps: { created: '2020-01-01T00:00:00.000Z', modified: '2020-01-01T00:00:00.000Z' },
            excludeFromAI: false,
            ...overrides,
        },
    };
}

describe('buildNoteRows', () => {
    it('folder write + no override: the note inherits write and has no override', () => {
        const grants: AgentGrants = { version: 1, folders: { [FOLDER_ID]: 'write' }, notes: {} };
        const rows = buildNoteRows(grants, FOLDER_ID, [note()]);

        expect(folderAccess(grants, FOLDER_ID)).toBe('write');
        expect(rows).toEqual([
            { noteId: NOTE_ID, title: 'Standup notes', access: 'write', override: null, locked: false },
        ]);
    });

    it('folder write + note none: the note is hidden despite the folder grant', () => {
        const grants: AgentGrants = {
            version: 1,
            folders: { [FOLDER_ID]: 'write' },
            notes: { [NOTE_ID]: 'none' },
        };
        const rows = buildNoteRows(grants, FOLDER_ID, [note()]);

        expect(rows[0]).toEqual({
            noteId: NOTE_ID,
            title: 'Standup notes',
            access: 'none',
            override: 'none',
            locked: false,
        });
    });

    it('folder none + note read: the note override grants read on an ungranted folder', () => {
        const grants: AgentGrants = { version: 1, folders: {}, notes: { [NOTE_ID]: 'read' } };
        const rows = buildNoteRows(grants, FOLDER_ID, [note()]);

        expect(folderAccess(grants, FOLDER_ID)).toBe('none');
        expect(rows[0]).toEqual({
            noteId: NOTE_ID,
            title: 'Standup notes',
            access: 'read',
            override: 'read',
            locked: false,
        });
    });

    it('excludeFromAI: locked and access is always none, even with a write override', () => {
        const grants: AgentGrants = {
            version: 1,
            folders: { [FOLDER_ID]: 'write' },
            notes: { [NOTE_ID]: 'write' },
        };
        const rows = buildNoteRows(grants, FOLDER_ID, [note({ excludeFromAI: true })]);

        expect(rows[0]).toEqual({
            noteId: NOTE_ID,
            title: 'Standup notes',
            access: 'none',
            override: 'write',
            locked: true,
        });
    });

    it('a folder with no notes gets no rows', () => {
        expect(buildNoteRows(EMPTY_GRANTS, FOLDER_ID, [])).toEqual([]);
    });
});

// What useAgentGrants' setFolder/setNote hand to the save mutation. Null-removal and
// no-mutation are covered in agentGrants.test.ts.
describe('saved grants', () => {
    it('setting a folder to write saves folders[<id>] === "write"', () => {
        const next = setFolderAccess(EMPTY_GRANTS, FOLDER_ID, 'write');
        expect(next.folders[FOLDER_ID]).toBe('write');
    });

    it('setting a note to none saves notes[<id>] === "none"', () => {
        const next = setNoteAccess(EMPTY_GRANTS, NOTE_ID, 'none');
        expect(next.notes[NOTE_ID]).toBe('none');
    });
});
