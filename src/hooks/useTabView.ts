import { useEffect, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';

interface TabView {
    scrollTop: number;
    anchor: number;
    head: number;
}

// Frames to wait for the note to grow tall enough to scroll back to (live blocks size late).
const RESTORE_FRAMES = 60;

/** Per open desktop tab: where its note was scrolled to and its selection. */
const views = new Map<string, TabView>();

/** Drops the saved view of every note whose tab is no longer open. */
export function forgetTabViews(openIds: ReadonlySet<string>): void {
    for (const id of views.keys()) if (!openIds.has(id)) views.delete(id);
}

/**
 * A desktop tab unmounted to free memory (useMountedTabs, #1487) comes back where it was
 * left: this keeps its note's scroll offset and selection while the tab is open, and puts
 * them back once the note has loaded again.
 */
export function useTabView(
    docId: string,
    editor: Editor | null,
    isLoading: boolean,
    scroller: RefObject<HTMLElement | null>,
    enabled: boolean,
): void {
    useEffect(() => {
        const el = scroller.current;
        if (!enabled || !editor || isLoading || !el) return;

        let frame = 0;
        const saved = views.get(docId);
        if (saved) {
            editor.commands.setTextSelection({ from: saved.anchor, to: saved.head });
            let frames = 0;
            const scroll = () => {
                if (el.scrollHeight - el.clientHeight < saved.scrollTop && ++frames < RESTORE_FRAMES) {
                    frame = requestAnimationFrame(scroll);
                    return;
                }
                el.scrollTop = saved.scrollTop;
            };
            scroll();
        }

        const save = () => {
            const { anchor, head } = editor.state.selection;
            // A hidden tab has no height, and reads as scrolled to the top.
            const scrollTop = el.clientHeight > 0 ? el.scrollTop : (views.get(docId)?.scrollTop ?? 0);
            views.set(docId, { scrollTop, anchor, head });
        };
        el.addEventListener('scroll', save, { passive: true });
        editor.on('selectionUpdate', save);
        return () => {
            cancelAnimationFrame(frame);
            el.removeEventListener('scroll', save);
            editor.off('selectionUpdate', save);
        };
    }, [docId, editor, isLoading, scroller, enabled]);
}
