/**
 * Pure helpers for the table-of-contents feature.
 *
 * `extractHeadings` walks a ProseMirror doc and returns every heading in
 * document order; `readingTimeMinutes` turns a word count into an estimated
 * read time. Both are pure so they can be unit-tested without the DOM.
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface HeadingEntry {
    level: number;
    text: string;
    pos: number;
}

/**
 * Collect all heading nodes from the document in reading order.
 * `pos` is the ProseMirror position of the heading node (usable with
 * `editor.view.domAtPos(pos)` to scroll it into view).
 */
export function extractHeadings(doc: ProseMirrorNode): HeadingEntry[] {
    const headings: HeadingEntry[] = [];
    doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
            headings.push({
                level: node.attrs.level as number,
                text: node.textContent,
                pos,
            });
        }
    });
    return headings;
}

/**
 * Estimated reading time in whole minutes at ~200 wpm, floored at 1.
 * Callers should only render this when `words > 0`.
 */
export function readingTimeMinutes(words: number): number {
    return Math.max(1, Math.round(words / 200));
}
