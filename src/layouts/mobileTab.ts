/**
 * The phone's bottom tab bar (#853). Two tabs are routes and keep a place of their
 * own; Search and Settings open sheets, so they are never the active tab.
 */
export type MobileTab = 'notes' | 'shared';

export const TAB_ROOTS: Record<MobileTab, string> = { notes: '/', shared: '/shared' };

/** `/shared` and `/shared/<note>` belong to Shared; every other route belongs to Notes. */
export function getMobileTab(pathname: string): MobileTab {
    return pathname === '/shared' || pathname.startsWith('/shared/') ? 'shared' : 'notes';
}

/**
 * Each route tab's last location (path and query). A note is never kept: the bar is
 * hidden inside a note, so coming back to a tab lands on its list, not on a note.
 */
export function createTabMemory() {
    const last: Record<MobileTab, string> = { ...TAB_ROOTS };
    return {
        visit(pathname: string, search: string) {
            const inNote = pathname.split('/').filter(Boolean).length > 1;
            if (!inNote) last[getMobileTab(pathname)] = pathname + search;
        },
        last: (tab: MobileTab) => last[tab],
    };
}
