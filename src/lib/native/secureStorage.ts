import { STORAGE_KEY_AUTH_TOKEN, STORAGE_KEY_SHARED_SECRET } from '@/lib/homebase/config';

/**
 * The native app keeps the Homebase sign-in in the OS keychain, not in localStorage (#1429):
 * the app's shared secret (it decrypts the user's Homebase data) and its token. Journal and
 * odin-js read and write them through localStorage, synchronously, so at boot (main.tsx,
 * before the app renders) this reads the keychain entry (db_key.rs `auth_secrets`) into
 * memory, serves those keys from memory from then on, writing each change to the keychain,
 * and moves any values an older build left in localStorage into it. The peer tokens odin-js
 * caches for collaborators' identities are served from memory only: they grow with every
 * collaborator, past what Windows lets one keychain entry hold, and odin-js fetches one again
 * when it has none. The web never loads this.
 */
const PEER_TOKEN_PREFIX = 'odin_peer_token_';
/** The keys in the keychain: db_key.rs SIGN_IN_KEYS. */
const isSignInKey = (key: string) => key === STORAGE_KEY_SHARED_SECRET || key === STORAGE_KEY_AUTH_TOKEN;

export const isSecretKey = (key: string) => isSignInKey(key) || key.startsWith(PEER_TOKEN_PREFIX);

type SecretsAnswer = { secrets: Record<string, string> } | 'unavailable';

/** db_key.rs SECRETS_CHANGED: another window changed the sign-in. Its payload is that window's label. */
const SECRETS_CHANGED = 'journal://auth-secrets-changed';

const keychain = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(`plugin:journal-db-key|${command}`, args);
};

/** Null until installSecureStorage, and on a Linux without a keychain. */
let secrets: Map<string, string> | null = null;
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

/** Sign-out: forgets every secret and deletes the keychain entry (`clear_auth_secrets`). */
export function clearSecureStorage(): void {
    if (!secrets) return;
    secrets.clear();
    queue(() => keychain('clear_auth_secrets'), true);
}

/** Throws when the keychain can't be read: the boot shows its error screen, with Retry. */
export async function installSecureStorage(): Promise<void> {
    const answer = await keychain<SecretsAnswer>('auth_secrets');
    // A Linux without a keychain: they stay in localStorage, as its database's key comes from a passphrase.
    if (answer === 'unavailable') return;
    const memory = new Map(Object.entries(answer.secrets));
    secrets = memory;
    const local = localStorage;
    const { getItem, setItem, removeItem } = Storage.prototype;
    const save = (key: string, value: string | null) => {
        if (isSignInKey(key)) queue(() => keychain('set_auth_secret', { key, value }));
    };

    // Before the move below: should it fail partway, a later write still goes to the keychain.
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

    // Into the keychain first, then out of localStorage.
    const leftInLocal: string[] = [];
    for (let i = 0; i < local.length; i++) {
        const key = local.key(i);
        if (key !== null && isSecretKey(key)) leftInLocal.push(key);
    }
    for (const key of leftInLocal) {
        const value = getItem.call(local, key)!;
        if (isSignInKey(key)) await keychain('set_auth_secret', { key, value });
        memory.set(key, value);
        removeItem.call(local, key);
    }

    await followOtherWindows(memory);
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
