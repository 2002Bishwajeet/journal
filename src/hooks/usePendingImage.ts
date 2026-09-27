import { useEffect, useState } from 'react';
import { getPendingImageUpload, getPendingImageUploadStatus } from '@/lib/db';
import { useOnlineContext } from '@/hooks/useOnlineContext';
import type { PendingImageUpload } from '@/types';

export type PendingImageState = 'offline' | 'uploading' | 'failed' | 'remote';

const POLL_MS = 5000;

/**
 * A not-yet-uploaded image, shown from the bytes queued on this device (the
 * node's blob: src dies with the tab). FileHandler queues the row before it
 * inserts the node, so no local row means another device added the image. The
 * bytes are read once; after that only the status is polled, since the sync
 * service updates it without notifying the editor. Polling stops once the row
 * is gone: the upload was promoted or removed, and the node changes with it.
 */
export function usePendingImage(pendingId: string): { url: string | undefined; state: PendingImageState } {
    const { isOnline } = useOnlineContext();
    const [url, setUrl] = useState<string>();
    // undefined until the first read
    const [status, setStatus] = useState<PendingImageUpload['status'] | null>();

    useEffect(() => {
        let alive = true;
        let objectUrl: string | undefined;
        let timer: ReturnType<typeof setInterval> | undefined;
        void getPendingImageUpload(pendingId).then((row) => {
            if (!alive) return;
            setStatus(row ? row.status : null);
            if (!row) return;
            objectUrl = URL.createObjectURL(new Blob([new Uint8Array(row.blobData)], { type: row.contentType }));
            setUrl(objectUrl);
            timer = setInterval(async () => {
                const next = await getPendingImageUploadStatus(pendingId);
                if (!alive) return;
                if (next === null) clearInterval(timer);
                else setStatus(next);
            }, POLL_MS);
        });
        return () => {
            alive = false;
            clearInterval(timer);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [pendingId]);

    let state: PendingImageState;
    if (status === null) state = 'remote';
    else if (!isOnline) state = 'offline';
    else if (status === undefined || status === 'pending' || status === 'uploading') state = 'uploading';
    else state = 'failed';

    return { url, state };
}
