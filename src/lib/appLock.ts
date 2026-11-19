import { APP_LOCK_KEY, appLockOn, changeNotesVisibility } from './native/bridge';
import { LOCKED_SESSION_KEY, setAndroidEncryption } from './db/databaseKey';
import { relockNotes } from './noteLock';

/**
 * The app lock (#1363, #1364). Its switch lives in the key command (src-tauri/src/db_key.rs):
 * with it on, the database key comes only after Touch ID, Windows Hello, Face ID or a fingerprint. The page keeps a
 * copy for what it decides on its own: notes outside the app, and the timeout.
 */

/** What Settings -> Security shows (db_key.rs `security_status`). */
export interface SecurityStatus {
    /** Touch ID, Windows Hello, Face ID or a fingerprint can confirm the owner, so the lock is offered (never on Linux). */
    lockAvailable: boolean;
    lockOn: boolean;
    /** The key comes from a passphrase: this Linux has no keychain. */
    passphrase: boolean;
}

async function invokeKey<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(`plugin:journal-db-key|${command}`, args);
}

export async function getSecurityStatus(): Promise<SecurityStatus> {
    const status = await invokeKey<SecurityStatus>('security_status');
    // The key command's copy wins, so a cleared localStorage can't show notes outside a locked app.
    if (status.lockOn !== appLockOn()) changeNotesVisibility(() => localStorage.setItem(APP_LOCK_KEY, String(status.lockOn)));
    return status;
}

/**
 * Turns the lock on (after Touch ID, Windows Hello, Face ID or a fingerprint) or off. Turning it on hides the notes
 * outside the app unless "Show notes outside the app" is on, and the bridge purges once.
 */
export async function setAppLock(on: boolean): Promise<'done' | 'cancelled' | 'failed'> {
    const refusal = await invokeKey<'cancelled' | 'failed' | null>('set_app_lock', { on });
    if (refusal) return refusal;
    changeNotesVisibility(() => localStorage.setItem(APP_LOCK_KEY, String(on)));
    return 'done';
}

/**
 * Android's "Encrypt notes on this device" (#1435). Turning it off turns the app lock off first,
 * as the lock gates the database key. `pushUnsynced` (the sync) sends this device's unsynced
 * changes, then the reload opens the other store, which starts empty and fills from Homebase
 * (pglite.ts; nothing is copied). The boot keeps the old store for a launch while it still has
 * changes the sync couldn't send.
 */
export async function switchAndroidEncryption(
    on: boolean,
    pushUnsynced: () => Promise<void>,
): Promise<'done' | 'cancelled' | 'failed'> {
    if (!on && appLockOn()) {
        const refusal = await setAppLock(false);
        if (refusal !== 'done') return refusal;
    }
    await pushUnsynced();
    setAndroidEncryption(on);
    window.location.reload();
    return 'done';
}

export const LOCK_AFTER_KEY = 'journal-app-lock-after';
/** The "Lock after" choices, in minutes hidden. */
export const LOCK_AFTER_MINUTES = [1, 5, 15, 60] as const;
const lockAfterListeners = new Set<() => void>();

/** Minutes hidden before the app locks itself, or null (the default) for never. Device-local. */
export function getLockAfterMinutes(): number | null {
    const minutes = Number(localStorage.getItem(LOCK_AFTER_KEY));
    return minutes > 0 ? minutes : null;
}

export function setLockAfterMinutes(minutes: number | null): void {
    if (minutes === null) localStorage.removeItem(LOCK_AFTER_KEY);
    else localStorage.setItem(LOCK_AFTER_KEY, String(minutes));
    lockAfterListeners.forEach((listener) => listener());
}

export function subscribeLockAfter(listener: () => void): () => void {
    lockAfterListeners.add(listener);
    return () => lockAfterListeners.delete(listener);
}

/**
 * Lock now, or the timeout: the key command forgets the key, and the page reloads into the
 * lock screen, so the key leaves with the database worker and no note stays on screen.
 * Every unlocked note and folder (#1427) locks again.
 */
export async function lockApp(): Promise<void> {
    relockNotes();
    await invokeKey('lock_database');
    sessionStorage.setItem(LOCKED_SESSION_KEY, '1');
    window.location.reload();
}

/** The lock screen's Unlock: the next key request asks Touch ID, Windows Hello, Face ID or a fingerprint. */
export function clearLockedSession(): void {
    sessionStorage.removeItem(LOCKED_SESSION_KEY);
}
