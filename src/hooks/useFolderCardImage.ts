import { useEffect, useState } from 'react';
import { useDotYouClientContext } from '@/components/auth';
import { getSyncRecord } from '@/lib/db';
import { FolderDriveProvider } from '@/lib/homebase/FolderDriveProvider';

/**
 * An object URL of the 1200x630 card a shared folder's link shows (#644): the uploaded one
 * when it was drawn from this name and count, else the same card drawn here. Undefined
 * while loading, until `count` is known, and where the browser can't draw it.
 */
export function useFolderCardImage(folder: { id: string; name: string } | null, count: number | null): string | undefined {
    const dotYouClient = useDotYouClientContext();
    const [url, setUrl] = useState<string>();
    const folderId = folder?.id;
    const name = folder?.name;

    useEffect(() => {
        if (!folderId || name === undefined || count === null || !dotYouClient) return;
        let alive = true;
        let objectUrl: string | undefined;
        void (async () => {
            const fileId = (await getSyncRecord(folderId))?.remoteFileId;
            const image = await new FolderDriveProvider(dotYouClient).getCardImage(fileId, { name, count });
            if (!alive || !image) return;
            objectUrl = URL.createObjectURL(image);
            setUrl(objectUrl);
        })().catch((e) => console.warn('[useFolderCardImage] no card image', e));
        return () => {
            alive = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            setUrl(undefined);
        };
    }, [folderId, name, count, dotYouClient]);

    return url;
}
