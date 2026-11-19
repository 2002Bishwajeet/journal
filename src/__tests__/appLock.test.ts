// @vitest-environment happy-dom
/**
 * #1363: the desktop app lock. The key command's answer with Touch ID mocked (success, cancel,
 * fail), the lock's wiring into notesVisibleOutsideApp(), Lock now, and the hidden timeout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

const { invoke, importKek, mocks } = vi.hoisted(() => ({
    invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
    importKek: vi.fn(async (bytes: Uint8Array) => ({ bytes: [...bytes] }) as unknown as CryptoKey),
    mocks: { encryptedStoreExists: false },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('pglite-cipher', () => ({ importKek }));
vi.mock('@/lib/db/pglite-migrate', () => ({ databaseExists: async () => mocks.encryptedStoreExists }));

import {
    DatabaseLockedError,
    LOCKED_SESSION_KEY,
    PASSPHRASE_ITERATIONS,
    derivePassphraseKey,
    loadDatabaseKey,
    setPassphrase,
} from '@/lib/db/databaseKey';
import { getSecurityStatus, lockApp, setAppLock, setLockAfterMinutes, getLockAfterMinutes } from '@/lib/appLock';
import { appLockOn, notesVisibleOutsideApp, setShowNotesOutsideApp } from '@/lib/native/bridge';
import { useLockWhenHidden } from '@/hooks/useAppLock';

/** What the key command answers, per command. */
let answers: Record<string, unknown>;
const KEY = Array<number>(32).fill(7);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mountLockWhenHidden() {
    function Probe() {
        useLockWhenHidden();
        return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(h(Probe)));
    return () => act(async () => root.unmount());
}

const calls = (command: string) => invoke.mock.calls.filter(([cmd]) => cmd === command);
const purges = () => calls('plugin:journal-bridge|bridge_wipe');

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    answers = {};
    invoke.mockReset();
    invoke.mockImplementation(async (cmd) => answers[cmd.replace('plugin:journal-db-key|', '')] ?? null);
    importKek.mockClear();
    mocks.encryptedStoreExists = false;
    window.__JOURNAL_NATIVE__ = { platform: 'macos', plugins: ['journal-bridge'] };
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
    delete window.__JOURNAL_NATIVE__;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('the key command with the app lock (auth mocked)', () => {
    it('opens with the key once Touch ID confirms the owner', async () => {
        answers.database_key = { key: KEY };
        await expect(loadDatabaseKey()).resolves.toEqual({ bytes: KEY });
    });

    it.each(['cancelled', 'failed'] as const)('shows the lock screen when Touch ID is %s', async (reason) => {
        answers.database_key = { locked: reason };
        const error = await loadDatabaseKey().catch((err: unknown) => err);
        expect(error).toBeInstanceOf(DatabaseLockedError);
        expect((error as DatabaseLockedError).reason).toBe(reason);
        expect(importKek).not.toHaveBeenCalled();
    });

    it('after Lock now, asks nobody until Unlock clears the session', async () => {
        answers.database_key = { key: KEY };
        sessionStorage.setItem(LOCKED_SESSION_KEY, '1');
        await expect(loadDatabaseKey()).rejects.toMatchObject({ name: 'DatabaseLockedError', reason: 'locked' });
        expect(invoke).not.toHaveBeenCalled();
    });
});

describe('the passphrase key (a Linux without a keychain)', () => {
    const salt = Array<number>(16).fill(3);

    it('asks for a passphrase, a new one when there is no database yet', async () => {
        answers.database_key = { passphrase: salt };
        await expect(loadDatabaseKey()).rejects.toMatchObject({ name: 'PassphraseNeededError', isNew: true });
        mocks.encryptedStoreExists = true;
        await expect(loadDatabaseKey()).rejects.toMatchObject({ name: 'PassphraseNeededError', isNew: false });
    });

    it('derives the key with PBKDF2-SHA256 and 600,000 iterations', async () => {
        expect(PASSPHRASE_ITERATIONS).toBe(600_000);
        const deriveBits = vi.spyOn(crypto.subtle, 'deriveBits');
        answers.database_key = { passphrase: salt };
        setPassphrase('correct horse');
        const key = (await loadDatabaseKey()) as unknown as { bytes: number[] };
        expect(deriveBits).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000 }),
            expect.anything(),
            256,
        );
        expect(key.bytes).toHaveLength(32);
        expect(key.bytes).toEqual([...(await derivePassphraseKey('correct horse', Uint8Array.from(salt)))]);
        expect(key.bytes).not.toEqual([...(await derivePassphraseKey('wrong horse', Uint8Array.from(salt)))]);
    });
});

describe('notesVisibleOutsideApp and the app lock', () => {
    it('turning the lock on hides the notes and purges once', async () => {
        answers.set_app_lock = null;
        await expect(setAppLock(true)).resolves.toBe('done');
        expect(calls('plugin:journal-db-key|set_app_lock')[0][1]).toEqual({ on: true });
        expect(appLockOn()).toBe(true);
        expect(notesVisibleOutsideApp()).toBe(false);
        await setAppLock(true);
        await vi.waitFor(() => expect(purges()).toEqual([['plugin:journal-bridge|bridge_wipe', { reason: 'hidden' }]]));
    });

    it('"Show notes outside the app" on keeps them visible under the lock, with no purge', async () => {
        setShowNotesOutsideApp(true);
        await setAppLock(true);
        expect(notesVisibleOutsideApp()).toBe(true);
        await Promise.resolve();
        expect(purges()).toHaveLength(0);
    });

    it('encryption alone changes nothing', () => {
        // The desktop app (always encrypted) with no lock.
        expect(notesVisibleOutsideApp()).toBe(true);
    });

    it('a refused Touch ID leaves the lock off and the notes visible', async () => {
        answers.set_app_lock = 'cancelled';
        await expect(setAppLock(true)).resolves.toBe('cancelled');
        expect(appLockOn()).toBe(false);
        expect(notesVisibleOutsideApp()).toBe(true);
        expect(purges()).toHaveLength(0);
    });

    it('turning the lock off shows the notes again', async () => {
        await setAppLock(true);
        await setAppLock(false);
        expect(notesVisibleOutsideApp()).toBe(true);
    });

    it("takes the key command's lock state, so a cleared copy can't show notes", async () => {
        answers.security_status = { lockAvailable: true, lockOn: true, passphrase: false };
        await getSecurityStatus();
        expect(appLockOn()).toBe(true);
        expect(notesVisibleOutsideApp()).toBe(false);
        await vi.waitFor(() => expect(purges()).toHaveLength(1));
    });
});

describe('Lock now and the hidden timeout', () => {
    const reload = () => vi.spyOn(window.location, 'reload').mockImplementation(() => {});

    it('Lock now forgets the key and reloads into the lock screen', async () => {
        const reloaded = reload();
        await lockApp();
        expect(calls('plugin:journal-db-key|lock_database')).toHaveLength(1);
        expect(sessionStorage.getItem(LOCKED_SESSION_KEY)).toBe('1');
        expect(reloaded).toHaveBeenCalledOnce();
    });

    it('"Lock after" is off by default', () => {
        expect(getLockAfterMinutes()).toBeNull();
        setLockAfterMinutes(5);
        expect(getLockAfterMinutes()).toBe(5);
        setLockAfterMinutes(null);
        expect(getLockAfterMinutes()).toBeNull();
    });

    function setVisibility(state: 'hidden' | 'visible') {
        Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    }

    it('locks after the chosen minutes hidden, and not before', async () => {
        vi.useFakeTimers();
        const reloaded = reload();
        await setAppLock(true);
        setLockAfterMinutes(5);
        const unmount = await mountLockWhenHidden();

        setVisibility('hidden');
        await vi.advanceTimersByTimeAsync(4 * 60_000);
        setVisibility('visible');
        expect(reloaded).not.toHaveBeenCalled();

        setVisibility('hidden');
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(calls('plugin:journal-db-key|lock_database')).toHaveLength(1);
        expect(reloaded).toHaveBeenCalledOnce();
        await unmount();
    });

    it('never locks itself with "Lock after" off or the lock off', async () => {
        vi.useFakeTimers();
        const reloaded = reload();
        setLockAfterMinutes(1);
        const unmount = await mountLockWhenHidden();
        setVisibility('hidden');
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        setVisibility('visible');
        expect(reloaded).not.toHaveBeenCalled();
        await unmount();
    });
});
