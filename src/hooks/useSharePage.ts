import { useParams } from 'react-router-dom';
import { usePublicNote } from '@/hooks/queries/usePublicNote';
import { usePublicAuthor, type PublicAuthor } from '@/hooks/usePublicAuthor';
import { countWords } from '@/lib/share/articleMeta';
import { readingTimeMinutes } from '@/lib/editor/extractHeadings';
import { coverForTheme } from '@/lib/editor/cover';
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme';
import type { SharedNoteData } from '@/lib/providers/ShareProvider';

export interface UseSharePageReturn {
    // Params
    identity: string | undefined;
    noteId: string | undefined;

    // Query state
    note: SharedNoteData | undefined;
    isLoading: boolean;
    error: Error | null;

    // Byline
    author: PublicAuthor;
    /** Estimated reading time; 0 when the note has no prose. */
    readingMinutes: number;
    /** The cover for the viewer's theme: the dark one in dark mode when the note has one. */
    cover: { src: string; positionY: number } | undefined;
}

/**
 * Hook that encapsulates SharePage logic including URL parameter extraction,
 * public note fetching and the article byline.
 */
export function useSharePage(): UseSharePageReturn {
    const { identity, noteId } = useParams<{ identity: string; noteId: string }>();

    const { data: note, isLoading, error } = usePublicNote(identity, noteId);
    const author = usePublicAuthor(identity && decodeURIComponent(identity));
    const isDark = useIsDarkTheme();

    const words = note ? countWords(note.content) : 0;

    return {
        identity,
        noteId,
        note,
        isLoading,
        error: error as Error | null,
        author,
        readingMinutes: words > 0 ? readingTimeMinutes(words) : 0,
        cover: note?.cover && coverForTheme(note.cover, isDark),
    };
}
