import { base64ToUint8Array, uint8ArrayToBase64 } from '@/lib/utils';
import { readString, removeKey, writeString } from '@/lib/storage';

/**
 * A synchronous copy of a note's local edits, written when the page is hidden or
 * unloaded (#873). An edit's PGlite write is asynchronous, and with relaxed durability
 * its IndexedDB flush finishes after the COMMIT, so iOS Safari can unload the page (or
 * #806's back/forward-cache shutdown can stop the worker) before the edit reaches disk.
 * localStorage is written before the page goes away; the next load of the note applies
 * the copy, which persists whatever never made it.
 */
const KEY_PREFIX = 'journal-unsaved-edits:';

// Set on logout, so the pagehide of logout's own reload cannot write a note back.
let discarded = false;

export function saveUnsavedEdits(docId: string, update: Uint8Array): void {
    if (!discarded) writeString(KEY_PREFIX + docId, uint8ArrayToBase64(update));
}

export function readUnsavedEdits(docId: string): Uint8Array | null {
    const stored = readString(KEY_PREFIX + docId);
    return stored ? base64ToUint8Array(stored) : null;
}

export function removeUnsavedEdits(docId: string): void {
    removeKey(KEY_PREFIX + docId);
}

/** Logout: delete every note's copy and stop writing new ones in this page. */
export function discardAllUnsavedEdits(): void {
    discarded = true;
    try {
        // Backwards, as removing a key shifts the ones after it.
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key?.startsWith(KEY_PREFIX)) localStorage.removeItem(key);
        }
    } catch (error) {
        console.error('Failed to remove unsaved edits:', error);
    }
}
