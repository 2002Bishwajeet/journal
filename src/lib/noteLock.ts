/**
 * Locked notes and folders (#1427). The `locked` flag lives in the note's and the folder's
 * metadata and syncs through Homebase; a note in a locked folder is locked too. Opening one
 * asks Touch ID, Windows Hello, Face ID or a fingerprint through the key command
 * (src-tauri/src/db_key.rs `confirm_owner`). What is open lives in memory only: it closes on
 * Lock now (the page reloads), after the app lock's "Lock after" time hidden, and on
 * `relockNotes()`. A refused check is never kept.
 */
import {
    countSharedNotesInFolder,
    getFolderById,
    getSearchIndexEntry,
    getSyncRecord,
    setFolderLockedLocal,
    updateSearchIndexMetadata,
    updateSyncStatus,
    upsertSyncRecord,
} from '@/lib/db/queries';
import type { DocumentMetadata } from '@/types';

export type OwnerCheck = 'done' | 'cancelled' | 'failed';

/** Note ids, and folder ids of locked folders, opened since the last relock. */
const opened = new Set<string>();
const listeners = new Set<() => void>();

function changed(): void {
    listeners.forEach((listener) => listener());
}

export function subscribeNoteLocks(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Whether a locked note was opened: itself, or its locked folder. */
export function isNoteOpen(note: { docId: string; metadata: Pick<DocumentMetadata, 'folderId'> }, folderLocked: boolean): boolean {
    return opened.has(note.docId) || (folderLocked && opened.has(note.metadata.folderId));
}

export function isFolderOpen(folderId: string): boolean {
    return opened.has(folderId);
}

/** Closes every note and folder that was unlocked. */
export function relockNotes(): void {
    if (opened.size === 0) return;
    opened.clear();
    changed();
}

/** Asks the owner. Every call prompts: nothing is kept on either side. */
export async function confirmOwner(): Promise<OwnerCheck> {
    const { invoke } = await import('@tauri-apps/api/core');
    const refusal = await invoke<'cancelled' | 'failed' | null>('plugin:journal-db-key|confirm_owner');
    return refusal ?? 'done';
}

/** Unlock: one check opens the note, or every note of its folder when the folder is locked. */
export async function unlockNote(note: { docId: string; metadata: Pick<DocumentMetadata, 'folderId'> }, folderLocked: boolean): Promise<OwnerCheck> {
    const answer = await confirmOwner();
    if (answer === 'done') {
        opened.add(folderLocked ? note.metadata.folderId : note.docId);
        changed();
    }
    return answer;
}

export async function unlockFolder(folderId: string): Promise<OwnerCheck> {
    const answer = await confirmOwner();
    if (answer === 'done') {
        opened.add(folderId);
        changed();
    }
    return answer;
}

/** Why locking was refused: a shared note or folder has to stop being shared first. */
export type LockResult = OwnerCheck | 'shared' | 'missing';

const isShared = (metadata: DocumentMetadata) => !!metadata.isPublic || !!metadata.isCollaborative;

/**
 * Locks a note, or removes its lock after the owner confirms. A note that is public or shared
 * with people isn't locked. Marks the note pending, so the flag syncs to every device.
 */
export async function setNoteLocked(docId: string, locked: boolean): Promise<LockResult> {
    const current = await getSearchIndexEntry(docId);
    if (!current) return 'missing';
    if (locked && isShared(current.metadata)) return 'shared';
    if (!locked) {
        const answer = await confirmOwner();
        if (answer !== 'done') return answer;
    }
    await updateSearchIndexMetadata(docId, current.title, { ...current.metadata, locked });
    await updateSyncStatus(docId, 'pending');
    if (locked) {
        opened.delete(docId);
        changed();
    }
    return 'done';
}

/**
 * Locks a folder, or removes its lock after the owner confirms. A shared folder, or one that
 * holds a public or shared note, isn't locked. The caller pushes the folder.
 */
export async function setFolderLocked(folderId: string, locked: boolean): Promise<LockResult> {
    const folder = await getFolderById(folderId);
    if (!folder) return 'missing';
    if (locked && (folder.isPublic || (await countSharedNotesInFolder(folderId)) > 0)) return 'shared';
    if (!locked) {
        const answer = await confirmOwner();
        if (answer !== 'done') return answer;
    }
    await setFolderLockedLocal(folderId, locked);
    const record = await getSyncRecord(folderId);
    await upsertSyncRecord({ ...(record ?? { localId: folderId, entityType: 'folder' as const }), syncStatus: 'pending' });
    if (locked) {
        opened.delete(folderId);
        changed();
    }
    return 'done';
}
