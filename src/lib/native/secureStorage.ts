import { STORAGE_KEY_AUTH_TOKEN, STORAGE_KEY_SHARED_SECRET } from '@/lib/homebase/config';

/**
 * The native app keeps the Homebase sign-in in the OS keychain, not in localStorage (#1429):
 * the app's shared secret (it decrypts the user's Homebase data), its token, and the peer
 * tokens odin-js caches for collaborators' identities. Journal and odin-js read and write
 * them through localStorage, synchronously, so at boot (main.tsx, before the app renders)
 * this reads the keychain entry (db_key.rs `auth_secrets`) into memory, moves any values an
 * older build left in localStorage into it and deletes them there, and from then on serves
 * those keys from memory, writing each change to the keychain. The web never loads this.
 */
const PEER_TOKEN_PREFIX = 'odin_peer_token_';

export const isSecretKey = (key: string) =>
    key === STORAGE_KEY_SHARED_SECRET || key === STORAGE_KEY_AUTH_TOKEN || key.startsWith(PEER_TOKEN_PREFIX);

type SecretsAnswer = { secrets: Record<string, string> } | 'unavailable';

let writes: Promise<void> = Promise.resolve();

/** Resolves once every change so far is in the keychain: await it before a reload or navigation. */
export function flushSecureStorage(): Promise<void> {
    return writes;
}

export async function installSecureStorage(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    const answer = await invoke<SecretsAnswer>('plugin:journal-db-key|auth_secrets');
    // A Linux without a keychain: they stay in localStorage, as its database's key comes from a passphrase.
    if (answer === 'unavailable') return;
    const secrets = new Map(Object.entries(answer.secrets));
    const local = localStorage;
    const { getItem, setItem, removeItem } = Storage.prototype;

    const save = (key: string, value: string | null) => {
        writes = writes
            .then(() => invoke('plugin:journal-db-key|set_auth_secret', { key, value }))
            .then(() => {}, (err: unknown) => console.error('[secureStorage] Could not save to the keychain:', err));
    };

    // Into the keychain first, then out of localStorage.
    const leftInLocal: string[] = [];
    for (let i = 0; i < local.length; i++) {
        const key = local.key(i);
        if (key !== null && isSecretKey(key)) leftInLocal.push(key);
    }
    for (const key of leftInLocal) {
        const value = getItem.call(local, key)!;
        await invoke('plugin:journal-db-key|set_auth_secret', { key, value });
        secrets.set(key, value);
        removeItem.call(local, key);
    }

    Storage.prototype.getItem = function (this: Storage, key: string) {
        if (this !== local || !isSecretKey(key)) return getItem.call(this, key);
        return secrets.get(key) ?? null;
    };
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if (this !== local || !isSecretKey(key)) return setItem.call(this, key, value);
        secrets.set(key, String(value));
        save(key, String(value));
    };
    Storage.prototype.removeItem = function (this: Storage, key: string) {
        if (this !== local || !isSecretKey(key)) return removeItem.call(this, key);
        if (secrets.delete(key)) save(key, null);
    };
}
