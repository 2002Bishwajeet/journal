import type { Editor } from '@tiptap/react';

/** Scrolls the heading at `pos` (from `extractHeadings`) to the top of the editor's scroll area. */
export function scrollToHeading(editor: Editor, pos: number, smooth: boolean): void {
    if (!editor.view || editor.isDestroyed) return;
    // pos is the position *before* the heading; pos + 1 lands inside it so the
    // resolved DOM node's closest heading element is the scroll target.
    const { node } = editor.view.domAtPos(pos + 1);
    const el = node instanceof HTMLElement ? node : node.parentElement;
    const target = el?.closest('h1, h2, h3, h4, h5, h6') ?? el;
    target?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}
