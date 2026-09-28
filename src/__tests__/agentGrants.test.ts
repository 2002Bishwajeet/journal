import { describe, it, expect } from 'vitest';
import {
    EMPTY_GRANTS,
    resolveAccess,
    folderAccess,
    setFolderAccess,
    setNoteAccess,
    parseGrants,
    type AgentGrants,
} from '@/lib/agent/grants';

const NOTE_ID = '11111111-1111-1111-1111-111111111111';
const FOLDER_ID = '22222222-2222-2222-2222-222222222222';

describe('resolveAccess', () => {
    it('defaults to none when nothing is granted', () => {
        expect(resolveAccess(EMPTY_GRANTS, { noteId: NOTE_ID, folderId: FOLDER_ID })).toBe('none');
    });

    it('grants read via the folder', () => {
        const grants: AgentGrants = { version: 1, folders: { [FOLDER_ID]: 'read' }, notes: {} };
        expect(resolveAccess(grants, { noteId: NOTE_ID, folderId: FOLDER_ID })).toBe('read');
    });

    it('grants write via the folder', () => {
        const grants: AgentGrants = { version: 1, folders: { [FOLDER_ID]: 'write' }, notes: {} };
        expect(resolveAccess(grants, { noteId: NOTE_ID, folderId: FOLDER_ID })).toBe('write');
    });

    it('a note read override beats a folder write grant', () => {
        const grants: AgentGrants = {
            version: 1,
            folders: { [FOLDER_ID]: 'write' },
            notes: { [NOTE_ID]: 'read' },
        };
        expect(resolveAccess(grants, { noteId: NOTE_ID, folderId: FOLDER_ID })).toBe('read');
    });

    it('a note write override beats a folder none (ungranted folder)', () => {
        const grants: AgentGrants = { version: 1, folders: {}, notes: { [NOTE_ID]: 'write' } };
        expect(resolveAccess(grants, { noteId: NOTE_ID, folderId: FOLDER_ID })).toBe('write');
    });

    it('a note none override hides a note inside a write-granted folder', () => {
        const grants: AgentGrants = {
            version: 1,
            folders: { [FOLDER_ID]: 'write' },
            notes: { [NOTE_ID]: 'none' },
        };
        expect(resolveAccess(grants, { noteId: NOTE_ID, folderId: FOLDER_ID })).toBe('none');
    });

    it('excludeFromAI: true beats a note write grant', () => {
        const grants: AgentGrants = { version: 1, folders: {}, notes: { [NOTE_ID]: 'write' } };
        expect(
            resolveAccess(grants, { noteId: NOTE_ID, folderId: FOLDER_ID, excludeFromAI: true })
        ).toBe('none');
    });

    it('excludeFromAI: undefined is treated as false', () => {
        const grants: AgentGrants = { version: 1, folders: {}, notes: { [NOTE_ID]: 'write' } };
        expect(
            resolveAccess(grants, { noteId: NOTE_ID, folderId: FOLDER_ID, excludeFromAI: undefined })
        ).toBe('write');
    });
});

describe('folderAccess', () => {
    it('returns none for an ungranted folder', () => {
        expect(folderAccess(EMPTY_GRANTS, FOLDER_ID)).toBe('none');
    });

    it('returns the granted access', () => {
        const grants: AgentGrants = { version: 1, folders: { [FOLDER_ID]: 'write' }, notes: {} };
        expect(folderAccess(grants, FOLDER_ID)).toBe('write');
    });
});

describe('setFolderAccess', () => {
    it('does not mutate its input', () => {
        const grants: AgentGrants = { version: 1, folders: {}, notes: {} };
        const result = setFolderAccess(grants, FOLDER_ID, 'read');
        expect(grants.folders).toEqual({});
        expect(result.folders).toEqual({ [FOLDER_ID]: 'read' });
        expect(result).not.toBe(grants);
    });

    it('setting none deletes the key rather than storing it', () => {
        const grants: AgentGrants = { version: 1, folders: { [FOLDER_ID]: 'write' }, notes: {} };
        const result = setFolderAccess(grants, FOLDER_ID, 'none');
        expect(result.folders).toEqual({});
        expect(grants.folders).toEqual({ [FOLDER_ID]: 'write' });
    });
});

describe('setNoteAccess', () => {
    it('does not mutate its input', () => {
        const grants: AgentGrants = { version: 1, folders: {}, notes: {} };
        const result = setNoteAccess(grants, NOTE_ID, 'write');
        expect(grants.notes).toEqual({});
        expect(result.notes).toEqual({ [NOTE_ID]: 'write' });
        expect(result).not.toBe(grants);
    });

    it('null removes the note override', () => {
        const grants: AgentGrants = { version: 1, folders: {}, notes: { [NOTE_ID]: 'read' } };
        const result = setNoteAccess(grants, NOTE_ID, null);
        expect(result.notes).toEqual({});
        expect(grants.notes).toEqual({ [NOTE_ID]: 'read' });
    });
});

describe('parseGrants', () => {
    it('rejects null', () => {
        expect(parseGrants(null)).toEqual(EMPTY_GRANTS);
    });

    it('rejects an unknown version', () => {
        expect(parseGrants({ version: 2, folders: {}, notes: {} })).toEqual(EMPTY_GRANTS);
    });

    it('drops entries whose value is not a valid AgentAccess', () => {
        const result = parseGrants({ version: 1, folders: {}, notes: { a: 'admin' } });
        expect(result).toEqual({ version: 1, folders: {}, notes: {} });
    });

    it('round-trips a valid grants object', () => {
        const valid = {
            version: 1,
            folders: { [FOLDER_ID]: 'read' },
            notes: { [NOTE_ID]: 'write' },
        };
        expect(parseGrants(valid)).toEqual(valid);
    });
});
