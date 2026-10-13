import type { NoteListEntry } from '@/types';

/** Homebase archivalStatus for a note in Trash. */
const TRASHED = 2;

/**
 * The notes a note links to directly (one level) that are not public: the ones a
 * reader of its public page could not open. Links to notes that no longer exist
 * locally, or that are in Trash, are ignored.
 */
export function privateLinkedNotes(
    linkedNoteIds: readonly string[] | undefined,
    notes: readonly Pick<NoteListEntry, 'docId' | 'title' | 'metadata'>[],
): { docId: string; title: string }[] {
    if (!linkedNoteIds?.length) return [];
    const linked = new Set(linkedNoteIds);
    return notes
        .filter((n) => linked.has(n.docId) && !n.metadata.isPublic && n.metadata.archivalStatus !== TRASHED)
        .map((n) => ({ docId: n.docId, title: n.title }));
}
