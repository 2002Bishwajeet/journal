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

/** The public page of a shared folder (#619): its notes, newest first, logged out. */
export function folderShareUrl(origin: string, identity: string, folderId: string): string {
    return `${origin}/share/${encodeURIComponent(identity)}/f/${folderId}`;
}
