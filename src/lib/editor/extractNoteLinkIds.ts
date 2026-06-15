import type { JSONContent } from '@tiptap/core';

/**
 * Walk a Tiptap document (editor.getJSON()) and collect the unique target
 * note ids of every `noteLink` node. Used on save to populate
 * `DocumentMetadata.linkedNoteIds`, which powers the backlinks live query.
 */
export function extractNoteLinkIds(doc: JSONContent | null | undefined): string[] {
    const ids = new Set<string>();

    const walk = (node: JSONContent | null | undefined): void => {
        if (!node) return;
        if (node.type === 'noteLink') {
            const noteId = node.attrs?.noteId;
            if (typeof noteId === 'string' && noteId) ids.add(noteId);
        }
        node.content?.forEach(walk);
    };

    walk(doc);
    return [...ids];
}
