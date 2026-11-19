// @vitest-environment happy-dom
/**
 * #1429: the native app leaves no note text or Homebase secret in plaintext in its web view's
 * stores. The query cache and the unload copies of edits are sealed with a key from the
 * database's keychain key, the sign-in moves from localStorage to the keychain, and the web
 * keeps everything as it was. IndexedDB (idb-keyval) and the keychain are in memory here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

const { invoke, idb, keychain } = vi.hoisted(() => ({
    invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
    idb: new Map<string, unknown>(),
    keychain: { secrets: new Map<string, string>(), available: true },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('idb-keyval', () => ({
    get: async (key: string) => idb.get(key),
    set: async (key: string, value: unknown) => void idb.set(key, value),
    del: async (key: string) => void idb.delete(key),
}));

const MARKER = 'marker-1429-only-in-plaintext';
const KEY = Array<number>(32).fill(7);
let databaseKey: unknown;

/**
 * Web Storage as browsers have it, its methods on Storage.prototype, which the shim wraps.
 * happy-dom's binds them to each instance instead.
 */
class MemoryStorage {
    #items = new Map<string, string>();
    get length() { return this.#items.size; }
    key(i: number) { return [...this.#items.keys()][i] ?? null; }
    getItem(key: string) { return this.#items.get(key) ?? null; }
    setItem(key: string, value: string) { this.#items.set(key, String(value)); }
    removeItem(key: string) { this.#items.delete(key); }
    clear() { this.#items.clear(); }
}
const { getItem, setItem, removeItem } = MemoryStorage.prototype;
/** What is really stored, past the shim. */
const raw = (storage: Storage, key: string) => getItem.call(storage as unknown as MemoryStorage, key);

beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('Storage', MemoryStorage);
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    idb.clear();
    keychain.secrets = new Map();
    keychain.available = true;
    databaseKey = { key: KEY };
    invoke.mockReset();
    invoke.mockImplementation(async (cmd, args) => {
        switch (cmd.replace('plugin:journal-db-key|', '')) {
            case 'database_key':
                return databaseKey;
            case 'auth_secrets':
                return keychain.available ? { secrets: Object.fromEntries(keychain.secrets) } : 'unavailable';
            case 'set_auth_secret': {
                const { key, value } = args as { key: string; value: string | null };
                if (value === null) keychain.secrets.delete(key);
                else keychain.secrets.set(key, value);
                return null;
            }
        }
        throw new Error(`unexpected command ${cmd}`);
    });
    window.__JOURNAL_NATIVE__ = { platform: 'macos' };
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
    Object.assign(MemoryStorage.prototype, { getItem, setItem, removeItem });
    vi.unstubAllGlobals();
    delete window.__JOURNAL_NATIVE__;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

const web = () => {
    delete window.__JOURNAL_NATIVE__;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
};

const queryCache = async (sealed?: boolean) => {
    const { QUERY_CACHE_KEY, queryCacheStorage } = await import('@/lib/queryCache');
    return { key: QUERY_CACHE_KEY, storage: queryCacheStorage(sealed) };
};

const cacheWithMarker = JSON.stringify({ clientState: { queries: [{ state: { data: [{ title: MARKER }] } }] } });

/** Every IndexedDB value and localStorage item, base64 decoded too, to search for plaintext. */
function storedText(): string {
    const chunks = [...idb.values()].map((value) =>
        value instanceof Uint8Array ? Buffer.from(value).toString('latin1') : JSON.stringify(value));
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        const value = raw(localStorage, key) ?? '';
        chunks.push(key, value, Buffer.from(value.replace(/^sealed:/, ''), 'base64').toString('latin1'));
    }
    return chunks.join('\n');
}

describe('the sealed query cache', () => {
    it('round-trips, and stores ciphertext', async () => {
        const { key, storage } = await queryCache();
        await storage.setItem(key, cacheWithMarker);
        expect(idb.get(key)).toBeInstanceOf(Uint8Array);
        expect(storedText()).not.toContain(MARKER);
        expect(await storage.getItem(key)).toBe(cacheWithMarker);
    });

    it('fails closed with the app lock on and no key yet: nothing restored, nothing written', async () => {
        const { key, storage } = await queryCache();
        await storage.setItem(key, cacheWithMarker);
        vi.resetModules();
        localStorage.setItem('journal-app-lock', 'true');
        const locked = await queryCache();
        await expect(locked.storage.getItem(key)).rejects.toMatchObject({ name: 'DatabaseLockedError' });
        await expect(locked.storage.setItem(key, 'newer')).rejects.toMatchObject({ name: 'DatabaseLockedError' });
        // The keychain was never asked, so no Touch ID prompt.
        expect(invoke.mock.calls.filter(([cmd]) => cmd.endsWith('database_key'))).toHaveLength(1);
    });

    it('fails closed when the key is missing from the keychain, or is another one', async () => {
        const { key, storage } = await queryCache();
        await storage.setItem(key, cacheWithMarker);
        vi.resetModules();
        databaseKey = 'missing';
        await expect((await queryCache()).storage.getItem(key)).rejects.toMatchObject({ name: 'DatabaseKeyMissingError' });
        vi.resetModules();
        databaseKey = { key: Array<number>(32).fill(8) };
        await expect((await queryCache()).storage.getItem(key)).rejects.toThrow();
    });

    it('deletes, never restores, the plain copy an older build left', async () => {
        const { key, storage } = await queryCache();
        idb.set(key, cacheWithMarker);
        expect(await storage.getItem(key)).toBeUndefined();
        expect(idb.has(key)).toBe(false);
    });

    it('stays plain on the web, which loads no key', async () => {
        web();
        const { key, storage } = await queryCache();
        expect((await import('@/lib/db/databaseKey')).usesEncryptedDatabase()).toBe(false);
        await storage.setItem(key, cacheWithMarker);
        expect(idb.get(key)).toBe(cacheWithMarker);
        expect(await storage.getItem(key)).toBe(cacheWithMarker);
        expect(invoke).not.toHaveBeenCalled();
    });
});

describe('the Homebase sign-in in the keychain', () => {
    const install = async () => {
        const storage = await import('@/lib/native/secureStorage');
        await storage.installSecureStorage();
        return storage;
    };

    it('moves the secret, the token and peer tokens from localStorage to the keychain, and localStorage ends empty of them', async () => {
        localStorage.setItem('APSS', 'shared-secret');
        localStorage.setItem('BX0900', 'auth-token');
        localStorage.setItem('odin_peer_token_frodo.dotyou.cloud', '{"sharedSecret":"peer"}');
        localStorage.setItem('identity', 'sam.dotyou.cloud');
        await install();

        expect(Object.fromEntries(keychain.secrets)).toEqual({
            APSS: 'shared-secret',
            BX0900: 'auth-token',
            'odin_peer_token_frodo.dotyou.cloud': '{"sharedSecret":"peer"}',
        });
        expect(raw(localStorage, 'APSS')).toBeNull();
        expect(raw(localStorage, 'BX0900')).toBeNull();
        expect(raw(localStorage, 'odin_peer_token_frodo.dotyou.cloud')).toBeNull();
        // The identity is a public name, not a secret: it stays.
        expect(raw(localStorage, 'identity')).toBe('sam.dotyou.cloud');
        // Journal and odin-js read them as before.
        expect(localStorage.getItem('APSS')).toBe('shared-secret');
        expect(localStorage.getItem('BX0900')).toBe('auth-token');
    });

    it('serves a later launch from the keychain, and writes sign-in and sign-out there', async () => {
        keychain.secrets.set('APSS', 'from-keychain');
        const { flushSecureStorage } = await install();
        expect(localStorage.getItem('APSS')).toBe('from-keychain');

        localStorage.setItem('BX0900', 'new-token');
        localStorage.setItem('journal-theme-preference', 'dark');
        sessionStorage.setItem('APSS', 'session-only');
        await flushSecureStorage();
        expect(keychain.secrets.get('BX0900')).toBe('new-token');
        expect(raw(localStorage, 'BX0900')).toBeNull();
        expect(raw(localStorage, 'journal-theme-preference')).toBe('dark');
        expect(raw(sessionStorage, 'APSS')).toBe('session-only');

        localStorage.removeItem('APSS');
        localStorage.removeItem('BX0900');
        await flushSecureStorage();
        expect(keychain.secrets.size).toBe(0);
        expect(localStorage.getItem('APSS')).toBeNull();
    });

    it('leaves localStorage as it was on a Linux without a keychain', async () => {
        keychain.available = false;
        localStorage.setItem('APSS', 'shared-secret');
        await install();
        expect(Storage.prototype.getItem).toBe(getItem);
        expect(raw(localStorage, 'APSS')).toBe('shared-secret');
    });
});

describe('no note text or secret in plaintext (#1361-style marker)', () => {
    it('finds the marker nowhere in IndexedDB or localStorage in the native app', async () => {
        const { installSecureStorage, flushSecureStorage } = await import('@/lib/native/secureStorage');
        localStorage.setItem('APSS', MARKER);
        await installSecureStorage();
        localStorage.setItem('BX0900', MARKER);
        await flushSecureStorage();

        const { key, storage } = await queryCache();
        await storage.setItem(key, cacheWithMarker);

        const doc = new Y.Doc();
        doc.getText('body').insert(0, MARKER);
        const { saveUnsavedEdits, readUnsavedEdits } = await import('@/lib/yjs/unsavedEdits');
        saveUnsavedEdits('note-1', Y.encodeStateAsUpdate(doc));
        await vi.waitFor(() => expect(localStorage.length).toBeGreaterThan(0));

        const { saveRecentSearches, loadRecentSearches } = await import('@/lib/recentItems');
        saveRecentSearches([MARKER]);

        expect(storedText()).not.toContain(MARKER);
        expect(storedText()).toContain('journal-unsaved-edits:note-1');

        // And each reads back.
        const copy = new Y.Doc();
        Y.applyUpdate(copy, (await readUnsavedEdits('note-1'))!);
        expect(copy.getText('body').toString()).toBe(MARKER);
        expect(await storage.getItem(key)).toBe(cacheWithMarker);
        expect(loadRecentSearches()).toEqual([MARKER]);
        expect(localStorage.getItem('APSS')).toBe(MARKER);
    });

    it('keeps the web as it was: the unload copy and recent searches stay readable in localStorage', async () => {
        web();
        const doc = new Y.Doc();
        doc.getText('body').insert(0, MARKER);
        const { saveUnsavedEdits } = await import('@/lib/yjs/unsavedEdits');
        saveUnsavedEdits('note-1', Y.encodeStateAsUpdate(doc));
        expect(storedText()).toContain(MARKER);
        localStorage.clear();
        const { saveRecentSearches, loadRecentSearches } = await import('@/lib/recentItems');
        saveRecentSearches([MARKER]);
        expect(storedText()).toContain(MARKER);
        expect(loadRecentSearches()).toEqual([MARKER]);
    });
});
