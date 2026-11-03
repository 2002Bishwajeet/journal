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
