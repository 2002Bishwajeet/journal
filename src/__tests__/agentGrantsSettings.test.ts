/**
 * Settings → Agent access view-model (#168): pure-logic tests only, per #196's testing
 * policy (integration first, no DOM rendering, no fake Homebase drive).
 */
import { describe, it, expect } from 'vitest';
import {
    buildAgentAccessRows,
    nextGrantsFor,
} from '@/hooks/useAgentGrants';
import { EMPTY_GRANTS, type AgentGrants } from '@/lib/agent/grants';
import type { Folder, NoteListEntry } from '@/types';

const FOLDER_ID = '22222222-2222-2222-2222-222222222222';
const NOTE_ID = '11111111-1111-1111-1111-111111111111';

const folder: Folder = { id: FOLDER_ID, name: 'Work', createdAt: new Date() };

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

describe('buildAgentAccessRows', () => {
    it('folder write + no override: the note inherits write and has no override', () => {
        const grants: AgentGrants = { version: 1, folders: { [FOLDER_ID]: 'write' }, notes: {} };
        const rows = buildAgentAccessRows(grants, [folder], { [FOLDER_ID]: [note()] });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ folderId: FOLDER_ID, name: 'Work', access: 'write' });
        expect(rows[0].notes).toEqual([
            { noteId: NOTE_ID, title: 'Standup notes', access: 'write', override: null, locked: false },
        ]);
    });

    it('folder write + note none: the note is hidden despite the folder grant', () => {
        const grants: AgentGrants = {
            version: 1,
            folders: { [FOLDER_ID]: 'write' },
            notes: { [NOTE_ID]: 'none' },
        };
        const rows = buildAgentAccessRows(grants, [folder], { [FOLDER_ID]: [note()] });

        expect(rows[0].notes[0]).toEqual({
            noteId: NOTE_ID,
            title: 'Standup notes',
            access: 'none',
            override: 'none',
            locked: false,
        });
    });

    it('folder none + note read: the note override grants read on an ungranted folder', () => {
        const grants: AgentGrants = { version: 1, folders: {}, notes: { [NOTE_ID]: 'read' } };
        const rows = buildAgentAccessRows(grants, [folder], { [FOLDER_ID]: [note()] });

        expect(rows[0].access).toBe('none');
        expect(rows[0].notes[0]).toEqual({
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
        const rows = buildAgentAccessRows(grants, [folder], {
            [FOLDER_ID]: [note({ excludeFromAI: true })],
        });

        expect(rows[0].notes[0]).toEqual({
            noteId: NOTE_ID,
            title: 'Standup notes',
            access: 'none',
            override: 'write',
            locked: true,
        });
    });

    it('folders with no notes passed in get an empty notes array', () => {
        const rows = buildAgentAccessRows(EMPTY_GRANTS, [folder], {});
        expect(rows[0].notes).toEqual([]);
    });
});

describe('nextGrantsFor', () => {
    it('setting a folder to write saves folders[<id>] === "write"', () => {
        const next = nextGrantsFor(EMPTY_GRANTS, { type: 'folder', folderId: FOLDER_ID, access: 'write' });
        expect(next.folders[FOLDER_ID]).toBe('write');
    });

    it('setting a note to none saves notes[<id>] === "none"', () => {
        const next = nextGrantsFor(EMPTY_GRANTS, { type: 'note', noteId: NOTE_ID, access: 'none' });
        expect(next.notes[NOTE_ID]).toBe('none');
    });

    it('setting a note to null (same as folder) removes the override', () => {
        const grants: AgentGrants = { version: 1, folders: {}, notes: { [NOTE_ID]: 'read' } };
        const next = nextGrantsFor(grants, { type: 'note', noteId: NOTE_ID, access: null });
        expect(next.notes[NOTE_ID]).toBeUndefined();
    });

    it('does not mutate its input', () => {
        const next = nextGrantsFor(EMPTY_GRANTS, { type: 'folder', folderId: FOLDER_ID, access: 'read' });
        expect(EMPTY_GRANTS.folders).toEqual({});
        expect(next).not.toBe(EMPTY_GRANTS);
    });
});
