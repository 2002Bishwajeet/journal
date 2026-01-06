import { useQuery } from '@tanstack/react-query';
import { shareProvider, type SharedNoteData } from '@/lib/providers/ShareProvider';

export const publicNoteQueryKey = (identity: string, noteId: string) =>
    ['public-note', identity, noteId] as const;

/**
 * Query hook to fetch a publicly shared note.
 */
export function usePublicNote(identity: string | undefined, noteId: string | undefined) {
    return useQuery<SharedNoteData>({
        queryKey: publicNoteQueryKey(identity ?? '', noteId ?? ''),
        queryFn: async () => {
            if (!identity || !noteId) {
                throw new Error('Invalid share link');
            }
            const data = await shareProvider.getPublicNote(
                decodeURIComponent(identity),
                noteId
            );
            if (!data) {
                throw new Error('Note not found or is not public');
            }
            return data;
        },
        enabled: !!identity && !!noteId,
        retry: 1, // Don't retry too much for 404s
        staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    });
}
