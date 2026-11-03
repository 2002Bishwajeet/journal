import type { DocumentMetadata } from '@/types';
import { COLLABORATIVE_FOLDER_ID, MAIN_FOLDER_ID } from './config';

/**
 * The folder a share or a stop keeps the note in (#682): its own, except the hidden
 * collaborative folder sharing used to move it to, which becomes Main.
 */
export const sharedNoteFolderId = (folderId: string | undefined): string =>
    !folderId || folderId === COLLABORATIVE_FOLDER_ID ? MAIN_FOLDER_ID : folderId;

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
 * viewer, by name (#897) or through a viewers' circle (#682), and not as an editor.
 * Decided by the note's content, not the drive grant: a viewer of this note can edit
 * another one, which gives them Write on the whole drive.
 */
export function isViewOnly(
    metadata: Pick<DocumentMetadata, 'authorOdinId' | 'odinIds' | 'recipients' | 'viewerRecipients'>,
    host: string,
): boolean {
    return !!metadata.authorOdinId && metadata.authorOdinId !== host
        && (!!metadata.odinIds?.includes(host) || !!metadata.viewerRecipients?.includes(host))
        && !metadata.recipients?.includes(host);
}
