import { useEffect, useSyncExternalStore } from 'react';
import { notesVisibleOutsideApp, subscribeNotesVisibility } from '@/lib/native/bridge';
import { clearUserActivity, setUserActivity } from '@/lib/native/userActivity';

/**
 * macOS app: advertises the open note for Handoff while it is open, without its title
 * while notes are hidden outside the app. Does nothing on the web and in the public build.
 */
export function useUserActivity(noteId: string | null | undefined, title: string | undefined): void {
    const visible = useSyncExternalStore(subscribeNotesVisibility, notesVisibleOutsideApp);
    const shownTitle = visible ? title : undefined;

    // A new title or visibility replaces the activity; only closing the note clears it.
    useEffect(() => {
        if (noteId) void setUserActivity(noteId, shownTitle);
    }, [noteId, shownTitle]);

    useEffect(() => {
        if (!noteId) return;
        return () => void clearUserActivity();
    }, [noteId]);
}
