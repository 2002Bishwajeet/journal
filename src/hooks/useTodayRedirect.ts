import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useDailyNote } from '@/hooks/useDailyNote';

// One open at a time, so a remount while it runs (StrictMode) can't create a second note.
let opening: Promise<string> | null = null;

/**
 * `/today` (the daily reminder's `journal://today`, #1123): opens today's note, creating
 * it like the Today button, and replaces `/today` with the note's route.
 */
export function useTodayRedirect(): void {
    const navigate = useNavigate();
    const { openToday } = useDailyNote();

    useEffect(() => {
        let active = true;
        opening ??= openToday()
            .then(({ docId, folderId }) => `/${folderId}/${docId}`)
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
    }, [navigate, openToday]);
}
