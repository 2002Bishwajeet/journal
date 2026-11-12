import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useDailyNote } from '@/hooks/useDailyNote';
import { useCanEditAnswer } from '@/hooks/useCanEdit';

// One open at a time, so a remount while it runs (StrictMode) can't create a second note.
let opening: Promise<string> | null = null;

/**
 * `/today` (the daily reminder's `journal://today`, #1123): opens today's note, creating
 * it like the Today button, and replaces `/today` with the note's route. Read-only
 * (#1176) creates nothing: it opens today's note only if it exists, else goes home.
 */
export function useTodayRedirect(): void {
    const navigate = useNavigate();
    const { openToday, findToday } = useDailyNote();
    // Waits for the answer, as it would create a note by itself.
    const canEdit = useCanEditAnswer();

    useEffect(() => {
        if (canEdit === undefined) return;
        let active = true;
        opening ??= (canEdit ? openToday() : findToday())
            .then((note) => (note ? `/${note.folderId}/${note.docId}` : '/'))
            .finally(() => {
                opening = null;
            });
        opening.then(
            (path) => {
                if (active) navigate(path, { replace: true });
            },
            () => {
                if (!active) return;
                toast.error("Couldn't open today's note");
                navigate('/', { replace: true });
            },
        );
        return () => {
            active = false;
        };
    }, [navigate, openToday, findToday, canEdit]);
}
