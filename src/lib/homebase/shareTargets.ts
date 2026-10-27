import type { DocumentMetadata } from '@/types';

/** A typed Homebase identity as a share stores it: no scheme or path, lowercased. */
export function normalizeOdinId(input: string): string {
    return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
}

/** A domain name, which is what a Homebase identity is. The server validates it again. */
export function isOdinId(odinId: string): boolean {
    return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(odinId);
}

/**
 * Whether `host` may only read this note: someone else's note that names the host as a
 * viewer and not as an editor (#897). Decided by the note's content, not the drive grant:
 * a viewer of this note can edit another one, which gives them Write on the whole drive.
 */
export function isViewOnly(
    metadata: Pick<DocumentMetadata, 'authorOdinId' | 'odinIds' | 'recipients'>,
    host: string,
): boolean {
    return !!metadata.authorOdinId && metadata.authorOdinId !== host
        && !!metadata.odinIds?.includes(host) && !metadata.recipients?.includes(host);
}
