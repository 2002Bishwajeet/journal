import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { getDocumentUpdates } from '@/lib/db';
import { ydocFromUpdates } from '@/lib/yjs/loadDoc';
import {
    buildPublicCard,
    fallbackShareDescription,
    firstParagraphText,
    truncateAtWord,
} from '@/lib/share/publicCard';
import { useAuth } from '@/hooks/auth';
import { useNotes } from '@/hooks/useNotes';

interface NoteContent {
    blob: Uint8Array;
    defaultDescription: string;
}

/**
 * What a public note's link card will show: the description the Pages Function
 * will use, the first-paragraph default, and what its card image is drawn from. The note's content is
 * read once per mount (the share dialog mounts per open); the share fields come
 * from the live note list, so edits show as soon as they're saved.
 */
export function useShareCardPreview(noteId: string) {
    const { getIdentity } = useAuth();
    const { get } = useNotes();
    const metadata = get.data?.find((n) => n.docId === noteId)?.metadata;
    const [content, setContent] = useState<NoteContent>();

    useEffect(() => {
        let alive = true;
        void getDocumentUpdates(noteId).then((updates) => {
            if (!alive || updates.length === 0) return;
            const blob = Y.mergeUpdates(updates);
            const doc = ydocFromUpdates([blob]);
            try {
                setContent({
                    blob,
                    defaultDescription: truncateAtWord(firstParagraphText(doc)),
                });
            } finally {
                doc.destroy();
            }
        });
        return () => {
            alive = false;
        };
    }, [noteId]);

    const card = buildPublicCard(content?.blob, metadata ?? {});
    return {
        defaultDescription: content?.defaultDescription ?? '',
        description: card.description ?? fallbackShareDescription(getIdentity() || 'unknown'),
        cardImageFrom: card.cardImageFrom,
    };
}
