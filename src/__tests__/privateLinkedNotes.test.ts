import { describe, it, expect } from 'vitest';
import { privateLinkedNotes } from '@/lib/share/privateLinks';

const note = (docId: string, metadata: object = {}) => ({
    docId,
    title: `Note ${docId}`,
    metadata: metadata as never,
});

describe('privateLinkedNotes', () => {
    const notes = [note('a'), note('b'), note('c', { isPublic: true }), note('d', { archivalStatus: 2 })];

    it('lists only the linked notes that are private', () => {
        expect(privateLinkedNotes(['b', 'c'], notes)).toEqual([{ docId: 'b', title: 'Note b' }]);
    });

    it('ignores links to trashed notes and to notes that no longer exist', () => {
        expect(privateLinkedNotes(['d', 'gone'], notes)).toEqual([]);
    });

    it('returns nothing when the note has no links', () => {
        expect(privateLinkedNotes(undefined, notes)).toEqual([]);
        expect(privateLinkedNotes([], notes)).toEqual([]);
    });

    it('does not follow the linked notes own links', () => {
        const withNested = [note('b', { linkedNoteIds: ['a'] }), note('a')];
        expect(privateLinkedNotes(['b'], withNested).map((n) => n.docId)).toEqual(['b']);
    });
});
