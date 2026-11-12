import { useEffect, useSyncExternalStore } from 'react';
import { notesVisibleOutsideApp, subscribeNotesVisibility } from '@/lib/native/bridge';
import { dockMenuNotes, setDockMenu } from '@/lib/native/dockMenu';
import { loadRecentNotes } from '@/lib/recentItems';

/**
 * macOS app: lists the last notes opened in the Dock menu, refreshed when a note opens and
 * when titles change. None while notes are hidden outside the app (New note and Today stay).
 * Does nothing on the web and in the public build.
 */
export function useDockMenu<T extends { docId: string; title: string; metadata: { archivalStatus?: number } }>(
    openNoteId: string | null | undefined,
    notes: T[],
): void {
    const visible = useSyncExternalStore(subscribeNotesVisibility, notesVisibleOutsideApp);

    // In an effect, after useRecordRecentNote has stored the note just opened.
    useEffect(() => {
        void setDockMenu(visible ? dockMenuNotes(loadRecentNotes(), notes) : []);
    }, [openNoteId, notes, visible]);
}
