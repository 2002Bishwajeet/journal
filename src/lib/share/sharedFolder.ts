import type { DocumentMetadata, Folder } from '@/types';

/**
 * The share fields a note starts with when it is created in `folder` (#618). A note
 * created in a shared folder is public, and indexable as the Share dialog publishes
 * it; in any other folder (or one that isn't known) it starts private.
 */
export function newNoteShareFields(
    folder: Pick<Folder, 'isPublic'> | null | undefined
): Pick<DocumentMetadata, 'isPublic' | 'shareIndexable'> {
    return folder?.isPublic ? { isPublic: true, shareIndexable: true } : {};
}

/**
 * Whether a note is public after it moves from folder `from` to `to` (#622). Moving into
 * a shared folder makes it public and moving out of one into a private folder makes it
 * private; between two shared or two private folders it keeps its state (so a note that
 * was individually public stays public across private folders). An unknown folder counts
 * as private.
 */
export function publicAfterMove(
    from: Pick<Folder, 'isPublic'> | null | undefined,
    to: Pick<Folder, 'isPublic'> | null | undefined,
    wasPublic: boolean | undefined
): boolean {
    const fromShared = !!from?.isPublic;
    const toShared = !!to?.isPublic;
    return fromShared === toShared ? !!wasPublic : toShared;
}

/** The public page of a shared folder (#619): its notes, newest first, logged out. */
export function folderShareUrl(origin: string, identity: string, folderId: string): string {
    return `${origin}/share/${encodeURIComponent(identity)}/f/${folderId}`;
}
