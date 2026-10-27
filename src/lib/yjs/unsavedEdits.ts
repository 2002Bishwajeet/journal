import { base64ToUint8Array, uint8ArrayToBase64 } from '@/lib/utils';
import { readString, removeKey, writeString } from '@/lib/storage';

/**
 * A synchronous copy of a note's local edits, written when the page is hidden or
 * unloaded (#873). An edit's PGlite write is asynchronous, and with relaxed durability
 * its IndexedDB flush finishes after the COMMIT, so iOS Safari can unload the page (or
 * #806's back/forward-cache shutdown can stop the worker) before the edit reaches disk.
 * localStorage is written before the page goes away; the next load of the note applies
 * the copy, which persists whatever never made it. Copies of other notes are pruned when
 * a note loads (see PGliteProvider.pruneUnsavedEdits).
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

/** With `copy`, only while the stored copy is still that one, not a newer one another page wrote. */
export function removeUnsavedEdits(docId: string, copy?: Uint8Array): void {
    if (copy && readString(KEY_PREFIX + docId) !== uint8ArrayToBase64(copy)) return;
    removeKey(KEY_PREFIX + docId);
}

/** The notes that have a copy. */
export function unsavedEditDocIds(): string[] {
    const docIds: string[] = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(KEY_PREFIX)) docIds.push(key.slice(KEY_PREFIX.length));
        }
    } catch {
        // Storage unavailable (private browsing): no copies
    }
    return docIds;
}

/** Logout: delete every note's copy and stop writing new ones in this page. */
export function discardAllUnsavedEdits(): void {
    discarded = true;
    for (const docId of unsavedEditDocIds()) removeKey(KEY_PREFIX + docId);
}
