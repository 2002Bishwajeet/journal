import { useEffect, useState } from 'react';
import { useDotYouClientContext } from '@/components/auth';
import { getSyncRecord } from '@/lib/db';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import type { CardImageFrom } from '@/lib/share/publicCard';

/**
 * An object URL of the 1200×630 card image a public note's link shows (#441, #434):
 * the uploaded one when it was drawn from `from`, else the same image drawn here.
 * Undefined while loading, and for a note that isn't public or has no content.
 */
export function useShareCardImage(noteId: string, from: CardImageFrom | undefined, isPublic: boolean): string | undefined {
    const dotYouClient = useDotYouClientContext();
    const [url, setUrl] = useState<string>();
    // A new object each render; the effect keys on its content.
    const fromKey = from && JSON.stringify(from);

    useEffect(() => {
        if (!isPublic || !fromKey || !dotYouClient) return;
        let alive = true;
        let objectUrl: string | undefined;
        void (async () => {
            const fileId = (await getSyncRecord(noteId))?.remoteFileId;
            if (!fileId) return;
            const image = await new NotesDriveProvider(dotYouClient).getCardImage(fileId, JSON.parse(fromKey) as CardImageFrom);
            if (!alive || !image) return;
            objectUrl = URL.createObjectURL(image);
            setUrl(objectUrl);
        })().catch((e) => console.warn('[useShareCardImage] no card image', e));
        return () => {
            alive = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            setUrl(undefined);
        };
    }, [noteId, fromKey, isPublic, dotYouClient]);

    return url;
}
