import { useEffect, useState, type CSSProperties } from 'react';
import { DotYouClient, ApiType, getPayloadBytes } from '@homebase-id/js-lib/core';
import { JOURNAL_DRIVE } from '@/lib/homebase/config';
import { parseAttachmentSrc } from '@/lib/utils/attachmentSrc';

export interface PublicNoteImageProps {
    identity: string;
    noteFileId: string;
    src: string;
    /** The note's modified time, so an edited note's images get a new URL (#543). */
    lastModified?: number;
    alt?: string;
    className?: string;
    style?: CSSProperties;
}

/**
 * Renders an `attachment://<fileId>/<payloadKey>` image on the public share
 * page. The payload is fetched anonymously via the Guest API — public notes
 * are unencrypted — and turned into an object URL that is revoked on cleanup.
 * Local state, not react-query: the app persists its query cache to
 * IndexedDB, and object URLs/raw bytes must not be persisted.
 *
 * Callers must render this keyed by `src` (e.g. `key={src}`): if the same
 * tree position later gets a different ref, a plain prop update would reuse
 * this instance's state (a stale/revoked object URL, or a stale failure)
 * instead of loading the new image.
 */
export function PublicNoteImage({ identity, noteFileId, src, lastModified, alt, className, style }: PublicNoteImageProps) {
    const ref = parseAttachmentSrc(src, noteFileId);
    const fileId = ref?.fileId;
    const payloadKey = ref?.payloadKey;

    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!fileId || !payloadKey) return;
        let cancelled = false;
        let url: string | null = null;

        (async () => {
            try {
                const client = new DotYouClient({ hostIdentity: identity, api: ApiType.Guest });
                const payload = await getPayloadBytes(client, JOURNAL_DRIVE, fileId, payloadKey, {
                    decrypt: false,
                    lastModified,
                });
                if (cancelled) return;
                if (!payload?.bytes) {
                    setFailed(true);
                    return;
                }
                url = URL.createObjectURL(new Blob([new Uint8Array(payload.bytes)], { type: payload.contentType }));
                setObjectUrl(url);
            } catch {
                if (!cancelled) setFailed(true);
            }
        })();

        return () => {
            cancelled = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [identity, fileId, payloadKey, lastModified]);

    if (!fileId || !payloadKey || failed) return null;

    if (!objectUrl) {
        return <span className="block h-48 w-full rounded bg-muted animate-pulse" aria-hidden="true" />;
    }

    return <img src={objectUrl} alt={alt} loading="lazy" className={className} style={style} />;
}
