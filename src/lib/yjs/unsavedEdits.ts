import { base64ToUint8Array, uint8ArrayToBase64 } from '@/lib/utils';
import { readString, removeKey, writeString } from '@/lib/storage';
import { usesEncryptedDatabase } from '@/lib/db/databaseKey';

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
/** A copy the native app sealed with its database's keychain key (#1429, sealed.ts). */
const SEALED_PREFIX = 'sealed:';

// Set on logout, so the pagehide of logout's own reload cannot write a note back.
let discarded = false;

/**
 * Each note's latest save or removal. A seal that finishes after a newer one started (or
 * after the copy was removed) writes nothing.
 */
const generations = new Map<string, number>();
const nextGeneration = (key: string) => {
    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    return generation;
};

/**
 * The native app seals the copy, which takes a moment: it lands when the app goes to the
 * background (visibilitychange), and a closing desktop window waits for it (closeFlush.ts).
 * Resolves once the copy is written, or wasn't (logged).
 */
export async function saveUnsavedEdits(docId: string, update: Uint8Array): Promise<void> {
    if (discarded) return;
    const key = KEY_PREFIX + docId;
    if (!usesEncryptedDatabase()) {
        writeString(key, uint8ArrayToBase64(update));
        return;
    }
    const generation = nextGeneration(key);
    try {
        const { seal } = await import('@/lib/db/sealed');
        const sealed = await seal(update as Uint8Array<ArrayBuffer>, key);
        if (!discarded && generations.get(key) === generation) writeString(key, SEALED_PREFIX + uint8ArrayToBase64(sealed));
    } catch (err) {
        console.warn('[unsavedEdits] Could not seal the unload copy:', err);
    }
}

/** The native app: seals the plaintext copies an older build left (#1429), once the database's key is in. */
export async function sealPlaintextCopies(): Promise<void> {
    await Promise.all(unsavedEditDocIds().map((docId) => {
        const stored = readString(KEY_PREFIX + docId);
        return stored && !stored.startsWith(SEALED_PREFIX) ? saveUnsavedEdits(docId, base64ToUint8Array(stored)) : undefined;
    }));
}

/** Android, once encryption is paused (#1435): the sealed copies, whose key goes with the encrypted store. */
export function removeSealedCopies(): void {
    for (const docId of unsavedEditDocIds()) {
        if (readString(KEY_PREFIX + docId)?.startsWith(SEALED_PREFIX)) removeKey(KEY_PREFIX + docId);
    }
}

/** Null too for a sealed copy the store key can't open (the app is locked). */
export async function readUnsavedEdits(docId: string): Promise<Uint8Array | null> {
    const key = KEY_PREFIX + docId;
    const stored = readString(key);
    if (!stored) return null;
    if (!stored.startsWith(SEALED_PREFIX)) return base64ToUint8Array(stored);
    const { unseal } = await import('@/lib/db/sealed');
    return unseal(base64ToUint8Array(stored.slice(SEALED_PREFIX.length)) as Uint8Array<ArrayBuffer>, key).catch(() => null);
}

/** With `copy`, only while the stored copy is still that one, not a newer one another page wrote. */
export async function removeUnsavedEdits(docId: string, copy?: Uint8Array): Promise<void> {
    if (copy) {
        const stored = await readUnsavedEdits(docId);
        if (!stored || uint8ArrayToBase64(stored) !== uint8ArrayToBase64(copy)) return;
    }
    nextGeneration(KEY_PREFIX + docId);
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
