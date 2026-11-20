// @vitest-environment happy-dom
/**
 * #1363, #1364: Settings -> Security in each state, and the lock screen. A page that only
 * claims a native platform, without Tauri, shows only "Show notes outside the app"; the app,
 * desktop or phone (Android only once opted in, #1435), shows that its notes are encrypted, and the lock where Touch ID, Windows
 * Hello, Face ID or a fingerprint can confirm the owner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement as h, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SecurityStatus } from '@/lib/appLock';
import type { NativePlatform } from '@/lib/native';
import { SyncContext, type SyncContextType } from '@/hooks/useSyncService';

const { invoke, retryDatabase, sync } = vi.hoisted(() => ({
    invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
    retryDatabase: vi.fn(async () => {}),
    sync: vi.fn(async () => {}),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@/lib/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/db')>()), retryDatabase }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import SecuritySection from '@/components/settings/sections/SecuritySection';
import { BootErrorScreen } from '@/components/layout/SplashScreen';
import { clearBootError, reportBootError } from '@/lib/bootProgress';
import { DatabaseLockedError, LOCKED_SESSION_KEY } from '@/lib/db/databaseKey';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let status: SecurityStatus;

async function render(element: ReactElement) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const syncContext = { sync } as unknown as SyncContextType;
    await act(async () => root.render(h(QueryClientProvider, { client }, h(SyncContext.Provider, { value: syncContext }, element))));
    // React Query answers on a later macrotask.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

function nativeApp(platform: NativePlatform) {
    window.__JOURNAL_NATIVE__ = { platform, plugins: [] };
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

const text = () => document.body.textContent ?? '';
const control = (id: string) => document.getElementById(id);
const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name);

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    status = { lockAvailable: true, lockOn: false, passphrase: false };
    invoke.mockReset();
    invoke.mockImplementation(async (cmd) => (cmd === 'plugin:journal-db-key|security_status' ? status : null));
    retryDatabase.mockClear();
    sync.mockReset();
    sync.mockImplementation(async () => {});
    vi.spyOn(window.location, 'reload').mockImplementation(() => {});
});

afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
    delete window.__JOURNAL_NATIVE__;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    clearBootError();
    vi.restoreAllMocks();
});

describe('Settings -> Security', () => {
    it('a page without Tauri shows only "Show notes outside the app"', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'ios', plugins: [] };
        await render(h(SecuritySection));
        expect(control('security-notes-outside-app')).not.toBeNull();
        expect(text()).not.toContain('encrypted');
        expect(control('security-app-lock')).toBeNull();
        expect(invoke).not.toHaveBeenCalled();
    });

    it('the Mac says its notes are encrypted and offers the lock, off', async () => {
        nativeApp('macos');
        await render(h(SecuritySection));
        expect(text()).toContain('Notes on this device are encrypted');
        expect(text()).toContain('The key is in the system keychain.');
        expect(text()).toContain('Ask for Touch ID or your password before Journal shows your notes.');
        expect(control('security-app-lock')?.getAttribute('aria-checked')).toBe('false');
        expect(control('security-lock-after')).toBeNull();
        expect(control('security-lock-now')).toBeNull();
    });

    it('with the lock on: Lock after (Never by default) and Lock now', async () => {
        nativeApp('windows');
        status.lockOn = true;
        await render(h(SecuritySection));
        expect(text()).toContain('Ask for Windows Hello');
        expect(control('security-app-lock')?.getAttribute('aria-checked')).toBe('true');
        expect((control('security-lock-after') as HTMLSelectElement).value).toBe('');
        expect(text()).toContain('Off while the app lock is on, unless you turn it on.');

        await act(async () => control('security-lock-now')!.click());
        await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalled());
        expect(invoke).toHaveBeenCalledWith('plugin:journal-db-key|lock_database', undefined);
        expect(sessionStorage.getItem(LOCKED_SESSION_KEY)).toBe('1');
    });

    it('turning the lock on asks the key command, then shows it on', async () => {
        nativeApp('macos');
        await render(h(SecuritySection));
        invoke.mockImplementation(async (cmd) => {
            if (cmd === 'plugin:journal-db-key|set_app_lock') status.lockOn = true;
            return cmd === 'plugin:journal-db-key|security_status' ? status : null;
        });
        await act(async () => control('security-app-lock')!.click());
        await vi.waitFor(async () => {
            await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
            expect(control('security-app-lock')?.getAttribute('aria-checked')).toBe('true');
        });
        expect(invoke).toHaveBeenCalledWith('plugin:journal-db-key|set_app_lock', { on: true });
        expect(control('security-lock-now')).not.toBeNull();
    });

    it('Linux: no lock, and a passphrase where there is no keychain', async () => {
        nativeApp('linux');
        status = { lockAvailable: false, lockOn: false, passphrase: true };
        await render(h(SecuritySection));
        expect(text()).toContain('Notes on this device are encrypted');
        expect(text()).toContain('This computer has no keychain (Secret Service), so your passphrase protects the key.');
        expect(control('security-app-lock')).toBeNull();
    });

    it.each([
        ['ios', 'The key is in the system keychain.', 'Ask for Face ID, Touch ID or your passcode before Journal shows your notes.'],
    ] as const)('the %s app says its notes are encrypted and offers the same lock', async (platform, key, lock) => {
        nativeApp(platform);
        status.lockOn = true;
        await render(h(SecuritySection));
        expect(text()).toContain('Notes on this device are encrypted');
        expect(text()).toContain(key);
        expect(text()).toContain(lock);
        expect(control('security-app-lock')?.getAttribute('aria-checked')).toBe('true');
        expect(control('security-lock-after')).not.toBeNull();
        expect(control('security-lock-now')).not.toBeNull();
    });

    it('a phone without Face ID or a fingerprint set up is encrypted, with no lock', async () => {
        nativeApp('ios');
        status.lockAvailable = false;
        await render(h(SecuritySection));
        expect(text()).toContain('Notes on this device are encrypted');
        expect(control('security-app-lock')).toBeNull();
    });

    it('Android, by default (#1435): the Experimental switch off, no encrypted line and no app lock, even with a fingerprint set up', async () => {
        nativeApp('android');
        await render(h(SecuritySection));
        expect(control('security-encryption')?.getAttribute('aria-checked')).toBe('false');
        expect(text()).toContain('Encrypt notes on this device');
        expect(text()).toContain('Experimental');
        expect(text()).toContain('Slower to open on large accounts.');
        expect(text()).not.toContain('encrypted');
        expect(control('security-app-lock')).toBeNull();
        expect(control('security-notes-outside-app')).not.toBeNull();
        expect(invoke).not.toHaveBeenCalledWith('plugin:journal-db-key|security_status', undefined);
    });

    it('Android, opted in: the switch on, the encrypted line and the app lock', async () => {
        nativeApp('android');
        localStorage.setItem('journal-android-encryption', 'true');
        await render(h(SecuritySection));
        expect(control('security-encryption')?.getAttribute('aria-checked')).toBe('true');
        expect(text()).toContain('Notes on this device are encrypted');
        expect(text()).toContain('The key is protected by the Android Keystore.');
        expect(control('security-app-lock')).not.toBeNull();
    });

    it('no switch outside Android', async () => {
        nativeApp('ios');
        await render(h(SecuritySection));
        expect(control('security-encryption')).toBeNull();
    });

    it('opting in asks first, then pushes unsynced changes before switching and restarting', async () => {
        nativeApp('android');
        let optedInDuringSync: string | null = 'unset';
        sync.mockImplementation(async () => {
            optedInDuringSync = localStorage.getItem('journal-android-encryption');
        });
        await render(h(SecuritySection));

        await act(async () => control('security-encryption')!.click());
        expect(text()).toContain('Encrypt notes on this device?');
        expect(sync).not.toHaveBeenCalled();
        expect(localStorage.getItem('journal-android-encryption')).toBeNull();

        await act(async () => button('Encrypt')!.click());
        await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalled());
        expect(sync).toHaveBeenCalledOnce();
        expect(optedInDuringSync).toBeNull();
        expect(localStorage.getItem('journal-android-encryption')).toBe('true');
    });

    it('cancelling the confirm changes nothing', async () => {
        nativeApp('android');
        await render(h(SecuritySection));
        await act(async () => control('security-encryption')!.click());
        await act(async () => button('Cancel')!.click());
        expect(sync).not.toHaveBeenCalled();
        expect(localStorage.getItem('journal-android-encryption')).toBeNull();
        expect(window.location.reload).not.toHaveBeenCalled();
    });

    it('opting out turns the app lock off, then pushes unsynced changes before switching and restarting', async () => {
        nativeApp('android');
        localStorage.setItem('journal-android-encryption', 'true');
        localStorage.setItem('journal-app-lock', 'true');
        status.lockOn = true;
        const steps: string[] = [];
        invoke.mockImplementation(async (cmd, args) => {
            if (cmd === 'plugin:journal-db-key|set_app_lock') steps.push(`lock ${String(args?.on)}`);
            return cmd === 'plugin:journal-db-key|security_status' ? status : null;
        });
        sync.mockImplementation(async () => {
            steps.push(`sync, opted in: ${localStorage.getItem('journal-android-encryption')}`);
        });
        await render(h(SecuritySection));

        await act(async () => control('security-encryption')!.click());
        await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalled());
        expect(steps).toEqual(['lock false', 'sync, opted in: true']);
        expect(localStorage.getItem('journal-app-lock')).toBe('false');
        expect(localStorage.getItem('journal-android-encryption')).toBe('false');
    });

    it('opting out stays on when the app lock would not turn off', async () => {
        nativeApp('android');
        localStorage.setItem('journal-android-encryption', 'true');
        localStorage.setItem('journal-app-lock', 'true');
        status.lockOn = true;
        invoke.mockImplementation(async (cmd) => {
            if (cmd === 'plugin:journal-db-key|set_app_lock') return 'cancelled';
            return cmd === 'plugin:journal-db-key|security_status' ? status : null;
        });
        await render(h(SecuritySection));

        await act(async () => control('security-encryption')!.click());
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
        expect(sync).not.toHaveBeenCalled();
        expect(localStorage.getItem('journal-android-encryption')).toBe('true');
        expect(window.location.reload).not.toHaveBeenCalled();
    });
});

describe('the lock screen', () => {
    it.each([
        ['cancelled', false],
        ['failed', true],
    ] as const)('shows no note when Touch ID is %s, and Unlock asks again', async (reason, saysFailed) => {
        sessionStorage.setItem(LOCKED_SESSION_KEY, '1');
        reportBootError(new DatabaseLockedError(reason));
        await render(h(BootErrorScreen));
        expect(text()).toContain('Journal is locked');
        expect(text().includes("Couldn't confirm it's you.")).toBe(saysFailed);

        await act(async () => button('Unlock')!.click());
        await vi.waitFor(() => expect(retryDatabase).toHaveBeenCalledOnce());
        expect(sessionStorage.getItem(LOCKED_SESSION_KEY)).toBeNull();
        await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalled());
    });

    it('a passphrase screen for a Linux without a keychain, which says when one was wrong', async () => {
        const error = Object.assign(new Error('Enter the passphrase'), { name: 'PassphraseNeededError', isNew: false, wrong: true });
        reportBootError(error);
        await render(h(BootErrorScreen));
        expect(text()).toContain('Enter your passphrase');
        expect(text()).toContain("That passphrase didn't open your notes.");
        expect(button('Reset local data and sync again')).toBeDefined();
    });
});
