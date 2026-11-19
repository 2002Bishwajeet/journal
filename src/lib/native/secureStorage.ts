import { STORAGE_KEY_AUTH_TOKEN, STORAGE_KEY_SHARED_SECRET } from '@/lib/homebase/config';
import { base64ToUint8Array, uint8ArrayToBase64 } from '@/lib/utils';

/**
 * The native app keeps the Homebase sign-in in the OS keychain, not in localStorage (#1429):
 * the app's shared secret (it decrypts the user's Homebase data) and its token. Journal and
 * odin-js read and write them through localStorage, synchronously, so at boot (main.tsx,
 * before the app renders) this reads the keychain entry (db_key.rs `auth_secrets`) into
 * memory, serves those keys from memory from then on, writing each change to the keychain,
 * and moves any values an older build left in localStorage into it. The peer tokens odin-js
 * caches for collaborators' identities are served from memory only: they grow with every
 * collaborator, past what Windows lets one keychain entry hold, and odin-js fetches one again
 * when it has none. A Linux without a keychain seals the sign-in in localStorage instead
 * (installSealedStorage). The web never loads this.
 */
const PEER_TOKEN_PREFIX = 'odin_peer_token_';
/** The keys in the keychain: db_key.rs SIGN_IN_KEYS. */
const SIGN_IN_KEYS = [STORAGE_KEY_SHARED_SECRET, STORAGE_KEY_AUTH_TOKEN];
const isSignInKey = (key: string) => SIGN_IN_KEYS.includes(key);

export const isSecretKey = (key: string) => isSignInKey(key) || key.startsWith(PEER_TOKEN_PREFIX);

type SecretsAnswer = { secrets: Record<string, string> } | 'unavailable';

/** db_key.rs SECRETS_CHANGED: another window changed the sign-in. Its payload is that window's label. */
const SECRETS_CHANGED = 'journal://auth-secrets-changed';

const keychain = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(`plugin:journal-db-key|${command}`, args);
};

/** Null until installSecureStorage or installSealedStorage. */
let secrets: Map<string, string> | null = null;
/** Sign-out's delete of the stored sign-in; before an install, what localStorage holds of it (the reset's). */
let deleteStored = () => SIGN_IN_KEYS.forEach((key) => localStorage.removeItem(key));
let writes: Promise<void> = Promise.resolve();
/** The latest write that failed since the last flush, or the last clear that worked. */
let failure: unknown = null;

function queue(write: () => Promise<unknown>, clears = false): void {
    writes = writes.then(write).then(
        () => { if (clears) failure = null; },
        (err: unknown) => {
            failure = err;
            console.error('[secureStorage] Could not save to the keychain:', err);
        },
    );
}

/**
 * Resolves once every change so far is in the keychain, and rejects when one of them couldn't
 * be written: await it before a reload or navigation.
 */
export async function flushSecureStorage(): Promise<void> {
    await writes;
    if (failure === null) return;
    const err = failure;
    failure = null;
    throw err;
}

/** Sign-out: forgets every secret and deletes the stored sign-in (the keychain's `clear_auth_secrets`). */
export function clearSecureStorage(): void {
    secrets?.clear();
    deleteStored();
}

/**
 * From now on localStorage's secret keys are `memory`'s, and `save` writes each sign-in change
 * through. Returns localStorage, its own methods, and the secret keys it holds.
 */
function serveFromMemory(memory: Map<string, string>, save: (key: string, value: string | null) => void) {
    const local = localStorage;
    const { getItem, setItem, removeItem } = Storage.prototype;
    const stored: string[] = [];
    for (let i = 0; i < local.length; i++) {
        const key = local.key(i);
        if (key !== null && isSecretKey(key)) stored.push(key);
    }
    Storage.prototype.getItem = function (this: Storage, key: string) {
        if (this !== local || !isSecretKey(key)) return getItem.call(this, key);
        return memory.get(key) ?? null;
    };
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if (this !== local || !isSecretKey(key)) return setItem.call(this, key, value);
        memory.set(key, String(value));
        save(key, String(value));
    };
    Storage.prototype.removeItem = function (this: Storage, key: string) {
        if (this !== local || !isSecretKey(key)) return removeItem.call(this, key);
        if (memory.delete(key)) save(key, null);
    };
    return { local, getItem, setItem, removeItem, stored };
}

/**
 * Throws when the keychain can't be read: the boot shows its error screen, with Retry.
 * `passphrase` on a Linux without a keychain, where installSealedStorage follows.
 */
export async function installSecureStorage(): Promise<'keychain' | 'passphrase'> {
    const answer = await keychain<SecretsAnswer>('auth_secrets');
    if (answer === 'unavailable') return 'passphrase';
    const memory = new Map(Object.entries(answer.secrets));
    secrets = memory;
    deleteStored = () => queue(() => keychain('clear_auth_secrets'), true);
    // Before the move below: should it fail partway, a later write still goes to the keychain.
    const { local, getItem, removeItem, stored } = serveFromMemory(memory, (key, value) => {
        if (isSignInKey(key)) queue(() => keychain('set_auth_secret', { key, value }));
    });

    // Into the keychain first, then out of localStorage.
    for (const key of stored) {
        const value = getItem.call(local, key)!;
        if (isSignInKey(key)) await keychain('set_auth_secret', { key, value });
        memory.set(key, value);
        removeItem.call(local, key);
    }

    await followOtherWindows(memory);
    return 'keychain';
}

/** A sealed sign-in value in localStorage, as the unload copies of edits are (unsavedEdits.ts). */
const SEALED_PREFIX = 'sealed:';

/**
 * A Linux without a keychain (#1363): the sign-in stays in localStorage, sealed (sealed.ts)
 * with a key from the passphrase that HKDF keeps apart from the store key (databaseKey.ts
 * loadAuthSecretsKey). Called once the database has opened with the passphrase (nativeBoot.ts):
 * reads the sealed values into memory and seals the plaintext an older build left in its place.
 * Peer tokens go to memory, as with a keychain. Throws when the key can't be had; nothing is
 * served then, as the shim goes in first. A value that won't open is left out: signed out.
 */
export async function installSealedStorage(): Promise<void> {
    const { seal, unseal } = await import('@/lib/db/sealed');
    const { loadAuthSecretsKey } = await import('@/lib/db/databaseKey');
    const memory = new Map<string, string>();
    secrets = memory;
    const sealValue = async (key: string, value: string) =>
        SEALED_PREFIX + uint8ArrayToBase64(await seal(new TextEncoder().encode(value), key, loadAuthSecretsKey()));
    const { local, getItem, setItem, removeItem, stored } = serveFromMemory(memory, (key, value) => {
        if (!isSignInKey(key)) return;
        if (value === null) return removeItem.call(local, key);
        queue(async () => {
            const sealed = await sealValue(key, value);
            // Not when a newer value or a sign-out came while it sealed.
            if (memory.get(key) === value) setItem.call(local, key, sealed);
        });
    });
    deleteStored = () => SIGN_IN_KEYS.forEach((key) => removeItem.call(local, key));

    const key = loadAuthSecretsKey();
    await key;
    for (const name of stored) {
        const value = getItem.call(local, name)!;
        if (!isSignInKey(name)) {
            memory.set(name, value);
            removeItem.call(local, name);
        } else if (value.startsWith(SEALED_PREFIX)) {
            const sealed = base64ToUint8Array(value.slice(SEALED_PREFIX.length)) as Uint8Array<ArrayBuffer>;
            await unseal(sealed, name, key).then(
                (plain) => memory.set(name, new TextDecoder().decode(plain)),
                (err: unknown) => console.warn(`[secureStorage] Could not open the sealed ${name}:`, err),
            );
        } else {
            setItem.call(local, name, await sealValue(name, value));
            memory.set(name, value);
        }
    }
}

/** A sign-in or sign-out in another window (desktop quick capture) reaches this one's memory. */
async function followOtherWindows(memory: Map<string, string>): Promise<void> {
    try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const self = getCurrentWebviewWindow();
        await self.listen<string>(SECRETS_CHANGED, ({ payload }) => {
            if (payload === self.label) return;
            keychain<SecretsAnswer>('auth_secrets').then((fresh) => {
                if (fresh === 'unavailable') return;
                for (const key of [...memory.keys()]) if (isSignInKey(key) && !(key in fresh.secrets)) memory.delete(key);
                for (const [key, value] of Object.entries(fresh.secrets)) memory.set(key, value);
            }, (err: unknown) => console.warn('[secureStorage] Could not read another window\'s sign-in:', err));
        });
    } catch (err) {
        console.warn('[secureStorage] Sign-ins in other windows won\'t reach this one:', err);
    }
}
