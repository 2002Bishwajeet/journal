// @vitest-environment happy-dom
/**
 * #1429: the native app leaves no note text or Homebase secret in plaintext in its web view's
 * stores. The query cache and the unload copies of edits are sealed with a key from the
 * database's keychain key, the sign-in moves from localStorage to the keychain, and the web
 * keeps everything as it was. IndexedDB (idb-keyval) and the keychain are in memory here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

const { invoke, idb, keychain, events } = vi.hoisted(() => ({
    invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
    idb: new Map<string, unknown>(),
    keychain: { secrets: new Map<string, string>(), available: true, failWrites: false },
    /** The page's Tauri event listeners, by event name. */
    events: new Map<string, (event: { payload: unknown }) => unknown>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: () => ({
        label: 'main',
        listen: async (event: string, handler: (event: { payload: unknown }) => unknown) => { events.set(event, handler); },
    }),
}));
vi.mock('pglite-cipher', () => ({ importKek: async () => ({}) }));
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
    keychain.failWrites = false;
    events.clear();
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
                if (keychain.failWrites) throw 'the entry is too big';
                if (value === null) keychain.secrets.delete(key);
                else keychain.secrets.set(key, value);
                return null;
            }
            case 'clear_auth_secrets':
                keychain.secrets.clear();
                return null;
            case 'close_flushed':
                return null;
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

/** The database's boot, which loads the key the stores are sealed with. */
const openDatabase = async () => (await import('@/lib/db/databaseKey')).loadDatabaseKey();
const keyRequests = () => invoke.mock.calls.filter(([cmd]) => cmd.endsWith('database_key')).length;

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
        await openDatabase();
        await storage.setItem(key, cacheWithMarker);
        expect(idb.get(key)).toBeInstanceOf(Uint8Array);
        expect(storedText()).not.toContain(MARKER);
        expect(await storage.getItem(key)).toBe(cacheWithMarker);
    });

    it('waits for the database\'s key and never asks the keychain itself: one Touch ID prompt', async () => {
        const { key, storage } = await queryCache();
        await openDatabase();
        await storage.setItem(key, cacheWithMarker);
        vi.resetModules();
        invoke.mockClear();

        const restored = (await queryCache()).storage.getItem(key);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(keyRequests()).toBe(0);
        await openDatabase();
        expect(await restored).toBe(cacheWithMarker);
        expect(keyRequests()).toBe(1);
    });

    it('fails closed with the app lock on: nothing restored, nothing written', async () => {
        const { key, storage } = await queryCache();
        await openDatabase();
        await storage.setItem(key, cacheWithMarker);
        vi.resetModules();
        invoke.mockClear();
        databaseKey = { locked: 'cancelled' };
        const locked = await queryCache();
        const restored = locked.storage.getItem(key);
        await expect(openDatabase()).rejects.toMatchObject({ name: 'DatabaseLockedError' });
        await expect(restored).rejects.toMatchObject({ name: 'DatabaseLockedError' });
        await expect(locked.storage.setItem(key, 'newer')).rejects.toMatchObject({ name: 'DatabaseLockedError' });
        expect(keyRequests()).toBe(1);

        // Unlock: the next attempt's key serves them.
        databaseKey = { key: KEY };
        await openDatabase();
        expect(await locked.storage.getItem(key)).toBe(cacheWithMarker);
    });

    it('fails closed when the key is missing from the keychain, or is another one', async () => {
        const { key, storage } = await queryCache();
        await openDatabase();
        await storage.setItem(key, cacheWithMarker);
        vi.resetModules();
        databaseKey = 'missing';
        const missing = (await queryCache()).storage.getItem(key);
        await openDatabase().catch(() => {});
        await expect(missing).rejects.toMatchObject({ name: 'DatabaseKeyMissingError' });
        vi.resetModules();
        databaseKey = { key: Array<number>(32).fill(8) };
        await openDatabase();
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

    it('moves the secret and the token from localStorage to the keychain, peer tokens to memory, and localStorage ends empty of them', async () => {
        localStorage.setItem('APSS', 'shared-secret');
        localStorage.setItem('BX0900', 'auth-token');
        localStorage.setItem('odin_peer_token_frodo.dotyou.cloud', '{"sharedSecret":"peer"}');
        localStorage.setItem('identity', 'sam.dotyou.cloud');
        await install();

        expect(Object.fromEntries(keychain.secrets)).toEqual({
            APSS: 'shared-secret',
            BX0900: 'auth-token',
        });
        expect(localStorage.getItem('odin_peer_token_frodo.dotyou.cloud')).toBe('{"sharedSecret":"peer"}');
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

    it('keeps peer tokens in memory only: one per collaborator would outgrow a Windows keychain entry', async () => {
        const { flushSecureStorage } = await install();
        localStorage.setItem('odin_peer_token_frodo.dotyou.cloud', '{"sharedSecret":"peer"}');
        await flushSecureStorage();
        expect(localStorage.getItem('odin_peer_token_frodo.dotyou.cloud')).toBe('{"sharedSecret":"peer"}');
        expect(raw(localStorage, 'odin_peer_token_frodo.dotyou.cloud')).toBeNull();
        expect(invoke.mock.calls.filter(([cmd]) => cmd.endsWith('set_auth_secret'))).toHaveLength(0);
        localStorage.removeItem('odin_peer_token_frodo.dotyou.cloud');
        expect(localStorage.getItem('odin_peer_token_frodo.dotyou.cloud')).toBeNull();
    });

    it('rejects the flush when a keychain write fails, so sign-in reports it', async () => {
        const { flushSecureStorage } = await install();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        keychain.failWrites = true;
        localStorage.setItem('APSS', 'shared-secret');
        await expect(flushSecureStorage()).rejects.toBe('the entry is too big');
        // Reported once; the next write starts clean.
        keychain.failWrites = false;
        localStorage.setItem('BX0900', 'auth-token');
        await expect(flushSecureStorage()).resolves.toBeUndefined();
        error.mockRestore();
    });

    it('deletes the whole entry on sign-out, even after a failed write', async () => {
        keychain.secrets.set('APSS', 'shared-secret');
        const { clearSecureStorage, flushSecureStorage } = await install();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        keychain.failWrites = true;
        localStorage.removeItem('APSS');
        clearSecureStorage();
        await expect(flushSecureStorage()).resolves.toBeUndefined();
        expect(keychain.secrets.size).toBe(0);
        expect(invoke.mock.calls.at(-1)?.[0]).toBe('plugin:journal-db-key|clear_auth_secrets');
    });

    it('throws when the keychain can\'t be read, so the boot shows its error screen', async () => {
        invoke.mockImplementation(async (cmd) => {
            if (cmd.endsWith('auth_secrets')) throw 'the keychain is locked';
            return null;
        });
        await expect(install()).rejects.toBe('the keychain is locked');
    });

    it('writes to the keychain after a move that failed partway', async () => {
        localStorage.setItem('APSS', 'shared-secret');
        keychain.failWrites = true;
        const storage = await import('@/lib/native/secureStorage');
        await expect(storage.installSecureStorage()).rejects.toBe('the entry is too big');
        keychain.failWrites = false;
        localStorage.setItem('BX0900', 'auth-token');
        await storage.flushSecureStorage();
        expect(keychain.secrets.get('BX0900')).toBe('auth-token');
        expect(raw(localStorage, 'BX0900')).toBeNull();
    });

    it('follows a sign-in or sign-out in another window, not its own', async () => {
        await install();
        const changed = events.get('journal://auth-secrets-changed')!;
        keychain.secrets.set('APSS', 'from-capture');
        await changed({ payload: 'capture' });
        await vi.waitFor(() => expect(localStorage.getItem('APSS')).toBe('from-capture'));

        localStorage.setItem('BX0900', 'mine');
        keychain.secrets.clear();
        await changed({ payload: 'main' });
        expect(localStorage.getItem('BX0900')).toBe('mine');
        await changed({ payload: 'capture' });
        await vi.waitFor(() => expect(localStorage.getItem('APSS')).toBeNull());
    });

    it('leaves localStorage to the sealed storage on a Linux without a keychain', async () => {
        keychain.available = false;
        localStorage.setItem('APSS', 'shared-secret');
        const storage = await import('@/lib/native/secureStorage');
        expect(await storage.installSecureStorage()).toBe('passphrase');
        expect(Storage.prototype.getItem).toBe(getItem);
        expect(raw(localStorage, 'APSS')).toBe('shared-secret');
    });
});

describe('the sealed sign-in on a Linux without a keychain', () => {
    const SALT = Array<number>(16).fill(3);
    beforeEach(() => {
        keychain.available = false;
        databaseKey = { passphrase: SALT };
    });

    /** A launch: the database opens with the passphrase, then the sign-in is unsealed. */
    const launch = async (passphrase = 'correct horse') => {
        const keys = await import('@/lib/db/databaseKey');
        keys.setPassphrase(passphrase);
        await keys.loadDatabaseKey();
        const storage = await import('@/lib/native/secureStorage');
        await storage.installSealedStorage();
        return storage;
    };
    /** A later launch, on what this one left in localStorage. */
    const relaunch = () => {
        Object.assign(MemoryStorage.prototype, { getItem, setItem, removeItem });
        vi.resetModules();
    };

    it('round-trips: a sign-in is stored sealed and the next launch reads it', async () => {
        const { flushSecureStorage } = await launch();
        localStorage.setItem('APSS', MARKER);
        localStorage.setItem('BX0900', 'auth-token');
        await flushSecureStorage();
        expect(raw(localStorage, 'APSS')).toMatch(/^sealed:/);
        expect(raw(localStorage, 'BX0900')).toMatch(/^sealed:/);
        expect(storedText()).not.toContain(MARKER);
        expect(invoke.mock.calls.filter(([cmd]) => cmd.endsWith('set_auth_secret'))).toHaveLength(0);

        relaunch();
        await launch();
        expect(localStorage.getItem('APSS')).toBe(MARKER);
        expect(localStorage.getItem('BX0900')).toBe('auth-token');
    });

    it('seals the plaintext an older build left in its place, and peer tokens go to memory', async () => {
        localStorage.setItem('APSS', MARKER);
        localStorage.setItem('odin_peer_token_frodo.dotyou.cloud', `{"sharedSecret":"${MARKER}"}`);
        localStorage.setItem('identity', 'sam.dotyou.cloud');
        await launch();
        expect(raw(localStorage, 'APSS')).toMatch(/^sealed:/);
        expect(raw(localStorage, 'odin_peer_token_frodo.dotyou.cloud')).toBeNull();
        expect(raw(localStorage, 'identity')).toBe('sam.dotyou.cloud');
        expect(storedText()).not.toContain(MARKER);
        expect(localStorage.getItem('APSS')).toBe(MARKER);
        expect(localStorage.getItem('odin_peer_token_frodo.dotyou.cloud')).toBe(`{"sharedSecret":"${MARKER}"}`);
    });

    it('fails closed: no key, nothing served; another passphrase\'s key, signed out', async () => {
        const { flushSecureStorage } = await launch();
        localStorage.setItem('APSS', 'shared-secret');
        await flushSecureStorage();
        const sealed = raw(localStorage, 'APSS');

        relaunch();
        databaseKey = 'missing';
        await (await import('@/lib/db/databaseKey')).loadDatabaseKey().catch(() => {});
        const storage = await import('@/lib/native/secureStorage');
        await expect(storage.installSealedStorage()).rejects.toThrow('missing from the system keychain');
        expect(localStorage.getItem('APSS')).toBeNull();

        relaunch();
        databaseKey = { passphrase: SALT };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await launch('another one');
        expect(localStorage.getItem('APSS')).toBeNull();
        expect(raw(localStorage, 'APSS')).toBe(sealed);
        warn.mockRestore();
    });

    it('writes nothing back for a sign-out that came while a seal ran', async () => {
        const { clearSecureStorage, flushSecureStorage } = await launch();
        localStorage.setItem('APSS', 'shared-secret');
        localStorage.setItem('BX0900', 'auth-token');
        localStorage.removeItem('APSS');
        clearSecureStorage();
        await flushSecureStorage();
        expect(raw(localStorage, 'APSS')).toBeNull();
        expect(raw(localStorage, 'BX0900')).toBeNull();
        expect(localStorage.getItem('BX0900')).toBeNull();
    });

    it('boots behind the passphrase screen: nothing renders before the database opens', async () => {
        const getDatabase = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Enter the passphrase'), { name: 'PassphraseNeededError' }));
        const first = await launch();
        localStorage.setItem('APSS', 'shared-secret');
        await first.flushSecureStorage();
        relaunch();
        vi.doMock('@/lib/db/pglite', () => ({ getDatabase, isLeftoverSession: () => false }));

        const showBootError = vi.fn();
        const { prepareNativeBoot } = await import('@/lib/native/nativeBoot');
        let ready: boolean | undefined;
        void prepareNativeBoot(showBootError).then((value) => { ready = value; });
        await vi.waitFor(() => expect(showBootError).toHaveBeenCalledOnce());
        expect(ready).toBeUndefined();

        // The screen's Unlock: the passphrase, then the database opens.
        const keys = await import('@/lib/db/databaseKey');
        keys.setPassphrase('correct horse');
        await keys.loadDatabaseKey();
        (await import('@/lib/bootProgress')).reportBootPhase('db-ready');
        await vi.waitFor(() => expect(ready).toBe(true));
        expect(localStorage.getItem('APSS')).toBe('shared-secret');
        vi.doUnmock('@/lib/db/pglite');
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
        await openDatabase();
        await storage.setItem(key, cacheWithMarker);

        const doc = new Y.Doc();
        doc.getText('body').insert(0, MARKER);
        const { saveUnsavedEdits, readUnsavedEdits } = await import('@/lib/yjs/unsavedEdits');
        await saveUnsavedEdits('note-1', Y.encodeStateAsUpdate(doc));

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

describe('the sealed unload copies of edits', () => {
    const update = (text: string) => {
        const doc = new Y.Doc();
        doc.getText('body').insert(0, text);
        return Y.encodeStateAsUpdate(doc);
    };
    const textOf = (copy: Uint8Array | null) => {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, copy!);
        return doc.getText('body').toString();
    };

    it('keeps the newer copy when an older seal finishes after it', async () => {
        const { saveUnsavedEdits, readUnsavedEdits } = await import('@/lib/yjs/unsavedEdits');
        // Both seals wait for the key; the older one is held back until after the newer lands.
        const subtle = crypto.subtle;
        const encrypt = subtle.encrypt.bind(subtle);
        let first = true;
        let releaseOlder!: () => void;
        const older = new Promise<void>((resolve) => { releaseOlder = resolve; });
        vi.spyOn(subtle, 'encrypt').mockImplementation(async (...args: Parameters<SubtleCrypto['encrypt']>) => {
            if (first) {
                first = false;
                await older;
            }
            return encrypt(...args);
        });
        const olderSave = saveUnsavedEdits('note-1', update('older'));
        const newerSave = saveUnsavedEdits('note-1', update('newer'));
        await openDatabase();
        await newerSave;
        releaseOlder();
        await olderSave;
        expect(textOf(await readUnsavedEdits('note-1'))).toBe('newer');
    });

    it('writes nothing back for a copy removed while its seal ran', async () => {
        const { saveUnsavedEdits, removeUnsavedEdits, unsavedEditDocIds } = await import('@/lib/yjs/unsavedEdits');
        const saved = saveUnsavedEdits('note-1', update('closed'));
        await removeUnsavedEdits('note-1');
        await openDatabase();
        await saved;
        expect(unsavedEditDocIds()).toEqual([]);
    });

    it('closing a desktop window answers once every open note\'s copy is written', async () => {
        const { installCloseFlush } = await import('@/lib/native/closeFlush');
        await installCloseFlush();
        const saveAll = vi.fn(async () => {});
        vi.doMock('@/lib/yjs/provider', () => ({ PGliteProvider: { saveAllBeforeClose: saveAll } }));
        await events.get('journal://flush-before-close')!({ payload: null });
        expect(saveAll).toHaveBeenCalledOnce();
        expect(invoke).toHaveBeenLastCalledWith('plugin:journal-db-key|close_flushed');

        // And when writing them failed: the window still closes.
        saveAll.mockRejectedValueOnce(new Error('no key'));
        await expect(events.get('journal://flush-before-close')!({ payload: null })).rejects.toThrow('no key');
        expect(invoke.mock.calls.filter(([cmd]) => cmd.endsWith('close_flushed'))).toHaveLength(2);
        vi.doUnmock('@/lib/yjs/provider');
    });
});

describe('what older builds left in plaintext, removed at boot', () => {
    it('strips the open tabs\' titles, deletes recent searches and seals the unload copies', async () => {
        localStorage.setItem('journal-open-tabs', JSON.stringify({ openTabs: [{ docId: 'note-1', title: MARKER }], activeTabId: 'note-1' }));
        localStorage.setItem('journal-recent-searches', JSON.stringify({ _v: 1, items: [MARKER] }));
        const doc = new Y.Doc();
        doc.getText('body').insert(0, MARKER);
        localStorage.setItem('journal-unsaved-edits:note-1', Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'));

        const { removePlaintextLeftovers } = await import('@/lib/native/plaintextLeftovers');
        removePlaintextLeftovers();
        expect(JSON.parse(raw(localStorage, 'journal-open-tabs')!)).toEqual({ openTabs: [{ docId: 'note-1', title: '' }], activeTabId: 'note-1' });
        expect(raw(localStorage, 'journal-recent-searches')).toBeNull();
        // Readable as it was until the database's key is in, then sealed.
        await openDatabase();
        await vi.waitFor(() => expect(raw(localStorage, 'journal-unsaved-edits:note-1')).toMatch(/^sealed:/));
        expect(storedText()).not.toContain(MARKER);
        const { readUnsavedEdits } = await import('@/lib/yjs/unsavedEdits');
        const copy = new Y.Doc();
        Y.applyUpdate(copy, (await readUnsavedEdits('note-1'))!);
        expect(copy.getText('body').toString()).toBe(MARKER);
    });
});

describe('the native boot', () => {
    it('reports a keychain read error as a boot error instead of booting signed out', async () => {
        invoke.mockImplementation(async (cmd) => {
            if (cmd.endsWith('auth_secrets')) throw 'the keychain is locked';
            return null;
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { prepareNativeBoot } = await import('@/lib/native/nativeBoot');
        expect(await prepareNativeBoot(() => {})).toBe(false);
        const { getBootError } = await import('@/lib/bootProgress');
        expect(getBootError()?.message).toContain('the keychain is locked');
    });

    it('boots with the shim installed, the leftovers gone and the close flush listening', async () => {
        localStorage.setItem('journal-recent-searches', JSON.stringify({ _v: 1, items: [MARKER] }));
        keychain.secrets.set('APSS', 'from-keychain');
        const { prepareNativeBoot } = await import('@/lib/native/nativeBoot');
        expect(await prepareNativeBoot(() => {})).toBe(true);
        expect(localStorage.getItem('APSS')).toBe('from-keychain');
        expect(raw(localStorage, 'journal-recent-searches')).toBeNull();
        await vi.waitFor(() => expect(events.has('journal://flush-before-close')).toBe(true));
    });

    it('Android with encryption paused (#1435): the sign-in stays in the keychain, the rest plain, no key asked', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'android' };
        localStorage.setItem('APSS', 'shared-secret');
        localStorage.setItem('journal-recent-searches', JSON.stringify({ _v: 1, items: ['a search'] }));
        const { prepareNativeBoot } = await import('@/lib/native/nativeBoot');
        expect(await prepareNativeBoot(() => {})).toBe(true);
        expect(keychain.secrets.get('APSS')).toBe('shared-secret');
        expect(raw(localStorage, 'APSS')).toBeNull();
        expect(raw(localStorage, 'journal-recent-searches')).not.toBeNull();

        const { key, storage } = await queryCache();
        await storage.setItem(key, MARKER);
        expect(idb.get(key)).toBe(MARKER);
        expect(keyRequests()).toBe(0);
    });
});
