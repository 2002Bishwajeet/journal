import { useEffect, useState } from 'react';
import { getLocalImageBytes } from '@/lib/db';

/**
 * Object URL for an image uploaded from this device, whose bytes are kept
 * locally so it renders offline (#179); null when there is no local copy.
 * Local state, not react-query: the query cache is persisted, a blob URL is not.
 */
export function useLocalImage(fileId: string, payloadKey: string): string | null {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        let objectUrl: string | undefined;
        void getLocalImageBytes(fileId, payloadKey).then((row) => {
            if (!alive || !row) return;
            objectUrl = URL.createObjectURL(new Blob([new Uint8Array(row.blobData)], { type: row.contentType }));
            setUrl(objectUrl);
        });
        return () => {
            alive = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            setUrl(null);
        };
    }, [fileId, payloadKey]);

    return url;
}
