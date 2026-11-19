import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { getSecurityStatus } from '@/lib/appLock';
import { usesEncryptedDatabase } from '@/lib/db/databaseKey';
import {
    getNoteLocksVersion,
    isFolderOpen,
    isNoteOpen,
    setFolderLocked,
    setNoteLocked,
    subscribeNoteLocks,
    unlockFolder,
    unlockNote,
    type LockResult,
    type OwnerCheck,
} from '@/lib/noteLock';
import type { Folder, NoteListEntry } from '@/types';
import { useSyncService } from './useSyncService';

// Asked once per launch: whether this device can confirm its owner doesn't change while it runs.
let availability: Promise<void> | undefined;
let available = false;
const availabilityListeners = new Set<() => void>();

function subscribeAvailability(listener: () => void): () => void {
    availabilityListeners.add(listener);
    if (!availability && usesEncryptedDatabase()) {
        availability = getSecurityStatus().then(
            (status) => {
                available = status.lockAvailable;
                availabilityListeners.forEach((l) => l());
            },
            (err: unknown) => {
                console.warn('[useNoteLock] security_status failed:', err);
                availability = undefined;
            },
        );
    }
    return () => availabilityListeners.delete(listener);
}

/**
 * Whether this device can lock notes (#1427): the native app, where Touch ID, Windows Hello,
 * Face ID or a fingerprint can confirm the owner. Never on the web or a Linux without one.
 */
export function useNoteLocksAvailable(): boolean {
    return useSyncExternalStore(subscribeAvailability, () => available);
}

/** Re-renders when a note or folder opens, or everything locks again. */
function useNoteLocksVersion(): number {
    return useSyncExternalStore(subscribeNoteLocks, getNoteLocksVersion);
}

function reportCheck(answer: OwnerCheck): void {
    if (answer === 'failed') toast.error("Couldn't confirm it's you");
}

function reportLock(result: LockResult, what: 'note' | 'folder'): void {
    if (result === 'shared') {
        toast.error(`Stop sharing this ${what} first`, {
            description:
                what === 'note'
                    ? "A locked note can't be public or shared with people."
                    : "A locked folder can't be shared, nor hold a public or shared note.",
        });
    } else if (result !== 'missing') reportCheck(result);
}

const onError = (what: string) => (err: unknown) => {
    console.error(`[useNoteLock] ${what} failed:`, err);
    toast.error(`Couldn't ${what}`);
};

/** The note's and folder's Lock and Remove lock actions; undefined where locks aren't offered. */
export function useNoteLockActions() {
    const available = useNoteLocksAvailable();
    const { syncNote, syncFolder } = useSyncService();
    if (!available) return undefined;

    const toggleNote = (note: NoteListEntry) => {
        const locked = !note.metadata.locked;
        setNoteLocked(note.docId, locked)
            .then((result) => {
                reportLock(result, 'note');
                if (result === 'done') void syncNote(note.docId).catch(() => undefined);
            })
            .catch(onError(locked ? 'lock the note' : 'remove the lock'));
    };
    const toggleFolder = (folder: Folder) => {
        const locked = !folder.locked;
        setFolderLocked(folder.id, locked)
            .then((result) => {
                reportLock(result, 'folder');
                if (result === 'done') void syncFolder(folder.id).catch(() => undefined);
            })
            .catch(onError(locked ? 'lock the folder' : 'remove the lock'));
    };
    return { toggleNote, toggleFolder };
}

/**
 * The open note's lock: `locked` while it, or its folder, is locked and not unlocked yet.
 * `canUnlock` is false where the owner can't be confirmed (the web).
 */
export function useNoteLockState(note: NoteListEntry | undefined, folders: readonly Folder[]) {
    useNoteLocksVersion();
    const available = useNoteLocksAvailable();
    const folderLocked = !!note && folders.some((f) => f.id === note.metadata.folderId && f.locked);
    const locked = !!note && (note.locked === true || folderLocked) && !isNoteOpen(note, folderLocked);
    return {
        locked,
        canUnlock: available,
        unlock: () => {
            if (!note) return;
            unlockNote(note, folderLocked).then(reportCheck).catch(onError('unlock the note'));
        },
    };
}

/** A locked folder's note list: locked until one Unlock opens all its notes. */
export function useFolderLockState(folder: Folder | undefined) {
    useNoteLocksVersion();
    const available = useNoteLocksAvailable();
    return {
        locked: !!folder?.locked && !isFolderOpen(folder.id),
        canUnlock: available,
        unlock: () => {
            if (!folder) return;
            unlockFolder(folder.id).then(reportCheck).catch(onError('unlock the folder'));
        },
    };
}
