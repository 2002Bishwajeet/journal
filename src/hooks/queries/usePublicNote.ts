import { useQuery } from '@tanstack/react-query';
import { shareProvider, type SharedNoteData } from '@/lib/providers/ShareProvider';

// 'v2': SharedNoteData gained a required `fileId` (#175) — versioned so a
// pre-existing IndexedDB-persisted cache entry (shaped without it, maxAge 7
// days) is never read as this shape; a stale entry would hide every image on
// the page until it happened to be refetched.
export const publicNoteQueryKey = (identity: string, noteId: string) =>
    ['public-note-v2', identity, noteId] as const;

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
        // Don't retry a definitive "not shared publicly" (403); allow one retry otherwise.
        retry: (failureCount, error) =>
            !(error as { isForbidden?: boolean })?.isForbidden && failureCount < 1,
        staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    });
}
