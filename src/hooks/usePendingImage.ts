import { useEffect, useState } from 'react';
import { getPendingImageUpload } from '@/lib/db';
import { useOnlineContext } from '@/hooks/useOnlineContext';
import type { PendingImageUpload } from '@/types';

export type PendingImageState = 'offline' | 'uploading' | 'failed' | 'remote';

const POLL_MS = 5000;

/**
 * A not-yet-uploaded image, shown from the bytes queued on this device (the
 * node's blob: src dies with the tab). No local row means another device added
 * it and hasn't uploaded it yet. Polls the row, since the sync service updates
 * it without notifying the editor.
 */
export function usePendingImage(pendingId: string): { url: string | undefined; state: PendingImageState } {
    const { isOnline } = useOnlineContext();
    const [url, setUrl] = useState<string>();
    // undefined until the first read
    const [status, setStatus] = useState<PendingImageUpload['status'] | null>();

    useEffect(() => {
        let alive = true;
        let objectUrl: string | undefined;
        const load = async () => {
            const row = await getPendingImageUpload(pendingId);
            if (!alive) return;
            if (row && !objectUrl) {
                objectUrl = URL.createObjectURL(new Blob([new Uint8Array(row.blobData)], { type: row.contentType }));
                setUrl(objectUrl);
            }
            setStatus(row ? row.status : null);
        };
        void load();
        const timer = setInterval(load, POLL_MS);
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
