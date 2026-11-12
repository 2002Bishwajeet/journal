import { hasNativePlugin, invokeNative, nativePlatform } from '@/lib/native';
import { resolveRecentNotes, type RecentNote } from '@/lib/recentItems';

// The macOS Dock menu (#1117): New note, Today and the last notes opened, built by the premium
// plugin (native/rust/dock_menu.rs). Its items open journal:// links (useNativeDeepLink).
const PLUGIN = 'journal-dock-menu';
export const DOCK_RECENT_LIMIT = 5;

export interface DockNote {
    id: string;
    title: string;
}

/** The recently opened notes the Dock lists: newest first, each once, live notes only, titles only. */
export function dockMenuNotes<T extends { docId: string; title: string; metadata: { archivalStatus?: number } }>(
    recent: RecentNote[],
    notes: T[],
): DockNote[] {
    const seen = new Set<string>();
    const out: DockNote[] = [];
    for (const note of resolveRecentNotes(recent, notes)) {
        if (seen.has(note.docId)) continue;
        seen.add(note.docId);
        out.push({ id: note.docId, title: note.title });
        if (out.length === DOCK_RECENT_LIMIT) break;
    }
    return out;
}

// The list last sent, so a re-render with the same notes sends nothing.
let sent: string | null = null;

/** Replaces the Dock menu's recent notes. Does nothing outside the macOS app. */
export async function setDockMenu(notes: DockNote[]): Promise<void> {
    const json = JSON.stringify(notes);
    if (json === sent || nativePlatform() !== 'macos' || !hasNativePlugin(PLUGIN)) return;
    sent = json;
    try {
        await invokeNative(PLUGIN, 'dock_menu_set', { notes });
    } catch (err) {
        sent = null;
        console.warn('[dockMenu] dock_menu_set failed:', err);
    }
}

/** `bridge:purge`: the Dock menu drops its recent notes at once. */
export function clearDockMenu(): Promise<void> {
    sent = null;
    return setDockMenu([]);
}
