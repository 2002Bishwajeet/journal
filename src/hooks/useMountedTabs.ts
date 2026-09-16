import { useState } from 'react';
import type { TabInfo } from './useTabManager';

/**
 * Desktop tab keep-alive policy: a tab is mounted the first time it becomes
 * active and stays mounted (hidden) until it is closed.
 *
 * Both halves matter. Tabs must not all mount at boot — each one builds a TipTap
 * editor and loads its Yjs document. And a mounted tab must never be unmounted
 * on a switch: unmounting runs the editor/provider cleanups, which flush and
 * compact the document (a full rewrite), destroy its Y.Doc and lose undo
 * history. `<Activity mode="hidden">` runs those same cleanups, which is why the
 * hidden tabs are hidden with CSS instead.
 */
export function useMountedTabs(
    openTabs: TabInfo[],
    activeTabId: string | null,
): TabInfo[] {
    const [mountedIds, setMountedIds] = useState<string[]>([]);

    // Adjusted during render (React's "adjust state when props change" pattern),
    // so a newly activated tab is in the rendered set on this commit rather than
    // a paint later.
    if (activeTabId && !mountedIds.includes(activeTabId)) {
        setMountedIds([...mountedIds, activeTabId]);
    }

    // Closed tabs leave openTabs and unmount — that teardown is wanted.
    return openTabs.filter(
        (t) => t.docId === activeTabId || mountedIds.includes(t.docId),
    );
}
