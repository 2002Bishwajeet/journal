import { useEffect, useState } from 'react';
import type { TabInfo } from './useTabManager';
import { forgetTabViews } from './useTabView';

/** Hidden tabs kept mounted besides the active one: the most recently used (#1487). */
export const MAX_HIDDEN_TABS = 3;

/**
 * Desktop tab keep-alive policy: a tab is mounted the first time it becomes
 * active and stays mounted (hidden) while it is one of the MAX_HIDDEN_TABS most
 * recently used, or until it is closed.
 *
 * Both halves matter. Tabs must not all mount at boot — each one builds a TipTap
 * editor and loads its Yjs document. And a recently used tab must not be
 * unmounted on a switch: unmounting runs the editor/provider cleanups, which
 * flush and compact the document (a full rewrite), destroy its Y.Doc and lose
 * undo history. `<Activity mode="hidden">` runs those same cleanups, which is why
 * the hidden tabs are hidden with CSS instead. Every mounted tab holds an editor,
 * a Y.Doc and its undo history, so the least recently used one beyond the cap is
 * unmounted like a closed tab, and comes back where it was left (useTabView).
 */
export function useMountedTabs(
    openTabs: TabInfo[],
    activeTabId: string | null,
): TabInfo[] {
    // Least recently active first.
    const [mountedIds, setMountedIds] = useState<string[]>([]);

    // Adjusted during render (React's "adjust state when props change" pattern),
    // so a newly activated tab is in the rendered set on this commit rather than
    // a paint later.
    if (activeTabId && mountedIds.at(-1) !== activeTabId) {
        const hidden = mountedIds.filter(
            (id) => id !== activeTabId && openTabs.some((t) => t.docId === id),
        );
        setMountedIds([...hidden.slice(-MAX_HIDDEN_TABS), activeTabId]);
    }

    // A closed tab's saved view goes with it: reopening the note starts at the top.
    useEffect(() => {
        forgetTabViews(new Set(openTabs.map((t) => t.docId)));
    }, [openTabs]);

    // Closed tabs leave openTabs and unmount — that teardown is wanted.
    return openTabs.filter(
        (t) => t.docId === activeTabId || mountedIds.includes(t.docId),
    );
}
