import { useEffect, useRef } from 'react';
import { localDateKey } from '@/lib/reminderSchedule';
import { maybeRequestReview, recordNoteSaveDay } from '@/lib/native/review';
import type { NoteListEntry } from '@/types';

/**
 * #1439: on iOS and Android, closing a note back to the list is the calm moment to ask for
 * a rating. A close of a note edited today counts as a day of saving notes. `blocked`: the
 * paywall (or another gate) is up.
 */
export function useReviewPrompt(noteId: string | undefined, notes: NoteListEntry[], blocked: boolean): void {
    const previous = useRef(noteId);
    const latest = useRef({ notes, blocked });
    useEffect(() => {
        latest.current = { notes, blocked };
    });

    useEffect(() => {
        const closed = previous.current;
        previous.current = noteId;
        if (!closed || noteId) return;
        const { notes: current, blocked: gated } = latest.current;
        const now = new Date();
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const modified = current.find((note) => note.docId === closed)?.metadata.timestamps.modified;
        if (modified && localDateKey(new Date(modified), timeZone) === localDateKey(now, timeZone)) recordNoteSaveDay(now);
        void maybeRequestReview(current.length, gated);
    }, [noteId]);
}
