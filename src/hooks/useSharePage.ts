import { useParams } from 'react-router-dom';
import { usePublicNote } from '@/hooks/queries/usePublicNote';
import type { SharedNoteData } from '@/lib/providers/ShareProvider';

export interface UseSharePageReturn {
    // Params
    identity: string | undefined;
    noteId: string | undefined;

    // Query state
    note: SharedNoteData | undefined;
    isLoading: boolean;
    error: Error | null;
}

/**
 * Hook that encapsulates SharePage logic including URL parameter extraction
 * and public note fetching.
 */
export function useSharePage(): UseSharePageReturn {
    const { identity, noteId } = useParams<{ identity: string; noteId: string }>();

    const { data: note, isLoading, error } = usePublicNote(identity, noteId);

    return {
        identity,
        noteId,
        note,
        isLoading,
        error: error as Error | null,
    };
}
