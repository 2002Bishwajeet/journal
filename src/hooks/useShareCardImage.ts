import { useEffect, useState } from 'react';
import { useDotYouClientContext } from '@/components/auth';
import { getSyncRecord } from '@/lib/db';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import type { NoteCover } from '@/lib/editor/cover';

/**
 * An object URL of the 1200×630 card image a public note's link shows (#441): the
 * uploaded one when it matches the cover, else the same image drawn here. Undefined
 * while loading, and for a note that isn't public or has no uploaded cover.
 */
export function useShareCardImage(noteId: string, cover: NoteCover | null, isPublic: boolean): string | undefined {
    const dotYouClient = useDotYouClientContext();
    const [url, setUrl] = useState<string>();
    const src = cover && !cover.pendingId ? cover.src : undefined;
    const positionY = cover?.positionY ?? 50;

    useEffect(() => {
        if (!isPublic || !src || !dotYouClient) return;
        let alive = true;
        let objectUrl: string | undefined;
        void (async () => {
            const fileId = (await getSyncRecord(noteId))?.remoteFileId;
            if (!fileId) return;
            const image = await new NotesDriveProvider(dotYouClient).getCardImage(fileId, { src, positionY });
            if (!alive || !image) return;
            objectUrl = URL.createObjectURL(image);
            setUrl(objectUrl);
        })().catch((e) => console.warn('[useShareCardImage] no card image', e));
        return () => {
            alive = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            setUrl(undefined);
        };
    }, [noteId, src, positionY, isPublic, dotYouClient]);

    return url;
}
