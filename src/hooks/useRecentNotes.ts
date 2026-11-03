import { useEffect } from 'react';
import { loadRecentNotes, pushRecentNote, saveRecentNotes } from '@/lib/recentItems';

/** Records each note the user opens, whatever opened it, so Search can list it under Recent. */
export function useRecordRecentNote(openNoteId: string | null | undefined) {
    useEffect(() => {
        if (openNoteId) saveRecentNotes(pushRecentNote(loadRecentNotes(), openNoteId));
    }, [openNoteId]);
}
